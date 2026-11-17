# Decisions

Choices made during the Pulse upgrade that later phases must follow. Newest last.

## Database: Postgres on Neon, through Cloudflare Hyperdrive (before Phase 0, 2026-11-16)

- **Pulse's database is Postgres 18**, hosted on Neon: project `wild-sunset-31993352` (organization
  `org-crimson-cherry-74821077`), region AWS Asia Pacific (Singapore). The Worker reaches it through the
  Cloudflare Hyperdrive config `pulse-db` (binding `HYPERDRIVE`).
- **Hyperdrive caching is OFF.** Every read must see the latest write: sessions, two-step tickets, locks and
  the page reload after a save. Don't turn it on.
- **Smart Placement is on** (`placement.mode = "smart"`), so the Worker runs near the Singapore database and
  a page's several queries stay short hops. Neon can't move a project between regions. Moving closer to
  Harare would mean a new Neon project (Frankfurt or London) and a data copy.
- The phase prompts say "D1"; read that as "the Postgres database" from now on.
- **Neon branches:** `production` is live. `dev` is for local testing (`npm run dev:api`) and holds test
  data only, including the QA accounts used by the Postman collection. Their password is `QA_PASSWORD` in
  `.dev.vars`; pass it to Newman with `--env-var qaPassword=…`. Connection strings live
  only in `frontend/.dev.vars` as `PG_MAIN` (production) and `PG_DEV`, which is never committed.
- **Migrations:** `frontend/migrations/` now holds Postgres migrations, starting from
  `0001_postgres_baseline.sql`, which matches the D1 schema after its 20 migrations. Use the next free number.
  `npm run db:migrate` applies them to live and `npm run db:migrate:dev` to dev. Applied files are recorded
  in the `schema_migrations` table. The old SQLite migrations moved to `frontend/migrations-d1/` and are
  history only.
- **The Worker's queries keep D1's shape.** `worker/pg.ts` gives Postgres D1's API (`prepare`, `bind`,
  `first`, `all`, `run`, `batch`), turns `?` into `$1…`, and runs a batch as one transaction. Write new SQL
  in Postgres syntax with `?` placeholders:
  - `ON CONFLICT DO NOTHING`, not `INSERT OR IGNORE`
  - `lower(x) = lower(?)` or `ILIKE`, not `COLLATE NOCASE`
  - `LIKE` is case-sensitive in Postgres
- **Column conventions are unchanged from D1,** so existing code and reports behave the same:
  - dates and times are ISO-8601 `TEXT`
  - expiry times are milliseconds as `BIGINT`
  - yes/no flags are `INTEGER` 0/1
  - `systems` and `password_history` keep a `rowid BIGSERIAL` column for insertion order
  - New tables follow the same conventions unless a phase needs otherwise; a `BIGSERIAL` id is fine for log-style tables.
- **Counts come back as numbers:** the adapter parses `bigint` and `numeric` as JavaScript numbers, as D1 did.
- **Fallback:** the D1 database stays bound as `D1`. Setting `DATABASE` to `"d1"` in `wrangler.jsonc` and
  redeploying switches back. D1 stopped receiving changes at the move, so it only holds data up to then, and
  it falls further behind the schema as phases add migrations. It is a short-term safety net, not a second
  database to maintain.
- `neon init` added `frontend/neon.ts` and the `@neon/config` and `@neon/env` packages. These are for Neon's own
  CLI (`neon deploy`, branch policy); Pulse's code doesn't use them. Its env file `frontend/.env.local` and
  `.neon` are gitignored.

## Phase 0: sign-in lockout (2026-11-16)

- **No new permission.** Unlocking accounts and changing the sign-in rules use `manage_users`, the permission that
  already covers resetting passwords and two-step. Only people who can manage users see who is locked, in
  Settings → People, in `/api/data` (`lockedUntil`, `signinRules`) and in Ask Pulse.
- **One counter table, `login_failures`:** a row per failed attempt (`at` in milliseconds, username as typed and
  lower-cased, `user_id` when the account exists, IP, reason). The account limit counts `password` and `two_step`
  rows since the later of 15 minutes ago and the end of the last lock. The address limit counts every row from that IP.
  Rows older than 24 hours are removed on each failure and by the weekday clean-up.
- **The lock lives on `users`** (`locked_until` milliseconds, `locked_at` ISO), so a sign-in check reads one row.
- **Wrong two-step codes count towards the lock,** so someone holding the password can't keep guessing codes. A
  locked account's pending two-step or passkey step is refused too.
- **The same message for every refusal:** a wrong password, an unknown username, a locked account and a refused
  address all get 401 "Wrong username or password. After N wrong tries, sign-in pauses for a while." An unknown
  username is still checked against a dummy hash, so it takes as long as a real one.
- **The built-in admin (`admin`) can be locked, but never for more than 15 minutes,** whatever the setting.
- **The settings live in Settings → Administration → Sign-in security** (settings key `signin_rules`): attempts 3–20
  (default 5), lock 5–1440 minutes (default 15), per-address 10–500 (default 20). The 15-minute window is fixed.
- **A successful sign-in or an unlock clears that account's counter.**
- **Administrators are told under the bell** (`account_locked`) when an account locks, and the lock, unlock, refused
  address and rule changes go in the activity log under "Failed sign-ins" and "Administration".
- **The D1 fallback got the same migration** (`migrations-d1/0021_signin_lockout.sql`, applied to D1), so falling
  back to D1 still lets people sign in.
- **Backing up the live database before a release** (the phase prompts' `wrangler d1 export` no longer applies):
  1. `npm run db:backup -- ../backup-before-phase-N.sql` writes every row, and the list of applied migrations, as
     INSERTs, then checks the file holds every row. Restore by migrating an empty database and running the file with
     `node scripts/db.mjs exec`. `backup-*.sql` is gitignored.
  2. Also make a Neon branch `backup-before-phase-N` from `production`, an instant copy that can be restored in Neon.

## Phase 1: work items (2026-11-17)

- **Feature requests are work items.** The `features` table became a database **view** of the same name, columns
  and values over `work_items WHERE source = 'client_request'`, so every reader (GET /api/data, digests, the
  Monday Briefing, Ask Pulse, /executive, reports) works unchanged. The /api/features endpoints write through
  the work item code (`worker/workitems.ts`). A work item keeps the old request id, so nothing that pointed at
  one broke. The migration checked on a copy of the live data that all 66 requests read back identically.
- **Mapping a request's fields:**

  | Request field | Work item |
  | --- | --- |
  | Bug fix | Bug |
  | New module, change, enhancement | Story |
  | The request type itself | a label: `new-module`, `change`, `enhancement` or `bug-fix` |
  | Not started | To Do |
  | In progress | In Progress |
  | Testing | In Review |
  | Completed | Done, resolution Done |
  | Cancelled | Done, resolution Won't do |
  | On hold | In Progress, flagged **on hold** (`on_hold`) |
  | Critical priority | Highest |

  Highest and Lowest read back as Critical and Low.
- **Statuses** are rows in `work_statuses` (To Do, In Progress, In Review, Done), each in a category (`TODO`,
  `IN_PROGRESS`, `DONE`). Code decides "done" by category, never by the status name, ready for Phase 2.
- **Resolution:** an item in a Done-category status has a resolution, Done or Won't do. "Won't do" items don't count
  towards epic roll-ups or project progress. Leaving Done clears the resolution and the resolved date.
- **Numbering** uses `systems.item_seq`, raised and read in the same statement that inserts the item
  (`WITH n AS (UPDATE ... RETURNING item_seq) INSERT ...`), so two items created at once can't share a number. A
  deleted item's number isn't reused. Moving an item to another project gives it the next number there.
- **Keys** live in `systems.key` (unique, `^[A-Z]{2,10}$`). The suggestion is the initials of a name of several
  words, ignoring small words such as "and" and "of" (Leave Planner → LP), or the first five letters of a one-word
  name (Infrastructure → INFRA). A letter is added when the key is taken. The migration gave existing projects
  keys by the same rule. A key is fixed once any work item exists in the project.
- **Visibility:** developers without `manage_features` see only the work items assigned to them or that they
  reported. This applies in lists, item pages, links, the parent list, attachments, comments and alerts, Ask Pulse
  and project history, as with feature requests. Everyone else sees every item. View-only links read items and
  comments but never attachments, and change nothing.
- **Editing:**
  - "Edit and assign any work item" (`edit_work_items`) may change anything.
  - Without it, the **assignee**, and the **reporter** if they have `create_work_items`, may edit the item, but may
    assign it only to themselves.
  - For client requests, `manage_features` counts as edit-any, and the old feature request rules still apply
    on the Feature requests page.
- **Assignees:** anyone except Standard users; client requests go to developers only, as before. Making someone a
  Standard user unassigns their work items.
- **Watchers:** the reporter and assignee watch automatically, and a new assignee starts watching. Watchers get
  a bell alert (kind `watching`) for field changes, comments, links and attachments, except for their own changes.
  An @mention (kind `mentioned`) only reaches people who can see the item. Someone mentioned isn't also sent the
  watcher alert for the same comment.
- **Deleting** an item deletes its sub-tasks and every item's attachments, comments, links, time and history.
  Children of a deleted epic stay, without an epic. Deleting a project deletes its work items.
- **Attachments** are rows in `documents` with `work_item_id` set, stored the same way (1 MB chunks, 10 MB per file).
  They're left out of the project's Documents list, and downloading one checks the item's visibility.
- **Time** is stored in minutes and shown as Jira does, with 8-hour days ("1d 2h"). Logging time lowers the
  remaining estimate by the time logged, unless a new remaining figure is given. Removing a log adds it back.
- **Project progress from work items** (`systems.progress_from_items`): the share of stories, tasks and bugs that are
  done. Epics and sub-tasks are left out because their work is inside those. It's recalculated whenever an item
  changes, and each change is logged as `system_progress` with `fromWorkItems`. While it's on, progress can't be
  set by hand.
- **Clone** copies the type, summary ("CLONE - ..."), description, priority, parent, labels, component, points,
  estimate and dates. It starts in To Do, reported by whoever cloned it, and links back with "clones".
- **Descriptions and comments are Markdown,** shown by Pulse's own small renderer (`src/components/Markdown.tsx`).
  It never inserts HTML from the text, and only makes http(s) and mailto links.
- **The D1 fallback is retired from this phase on.** D1 has no work item tables, so switching back to it would break
  feature requests. The restore path is the backup file and the Neon backup branch.

## Phase 2: workflows and boards (2026-11-17)

- **Statuses are one shared list** (`work_statuses`), each in a category (To Do, In Progress or Done). A workflow
  uses some of them (`workflow_statuses`, in board order, with one where items start). Sharing means "Done" is the
  same everywhere, and a workspace board can line projects up even when their workflows differ.
- **A project's workflow** is its own (`systems.workflow_id`) if it has one, else its workspace's
  (`workspace_workflows`), else the Default. The Default can't be deleted, and it stays the default; to change what
  most projects use, give their workspaces another workflow.
- **Every status change is a workflow move,** checked on the server: the item page's "Move to…", a board drag, or a
  PATCH with `status`. A move must exist from the current status, or be one of the moves allowed "from any status".
  The conditions and validators are evaluated by one shared function (`src/data/workflows.ts`), so the browser
  greys out exactly what the server would refuse.
- **Conditions are combined with AND.** Several "role" conditions on one move mean any of those roles.
  **Administrators pass role conditions,** as they keep every permission elsewhere in Pulse. So "only a Manager
  deploys" lets Managers and Administrators deploy. Anyone moving an item must also be allowed to edit it (Phase 1).
- **Validators:**
  - A comment, an assignee or a field can be given with the move; the board and item page ask for them in a small
    pop-up.
  - "All sub-tasks done" can't be answered in the pop-up, so the move is refused with the reason.
  - A post-function that assigns someone counts as setting an assignee.
- **Post-functions** run after the move:
  - Assign to a person, to someone with a role (the project's lead first, then its developers, then anyone with that
    role, by name), or to the reporter; or clear the assignee.
  - Set the resolution.
  - Notify the watchers (who hear anyway), the assignee, the reporter or every person with a role. Developers only
    hear about items they can see.
  - A client request can only be assigned to a developer, so a post-function that would give it to anyone else is
    skipped.
- **The seeded Infrastructure deployment workflow** adds two moves the brief didn't name, so work can go back:
  "Failed testing" (Testing → In Progress) and "Reject change" (Change Approval → In Progress, with a comment). Close
  sets the resolution to Done, and Deployed counts as done.
- **Feature requests still change status from their own page.** A new status there is turned into this project's
  workflow status:
  - not started → where items start
  - in progress → the first in-progress status
  - testing → an in-progress status named for review, testing or approval
  - completed or cancelled → the first done status
  - on hold → stays put, flagged

  Pulse then walks the shortest chain of moves this person is allowed to make without giving anything extra. If
  there's none (for example a move needs a comment), the request is refused and the person is told to move it from
  the work item. The features view treats any in-progress status named for review, testing or approval as "Testing".
- **New items start where their workflow starts.** A feature request logged as already in progress or done is
  created there and then moved on by the same walk.
- **Changing workflows never strands items.** Any change that would leave items in a status their workflow no longer
  has is refused (409, `needs_moves`) with the statuses and counts; the editor asks where each should go and retries.
  This covers removing a status from a workflow, deleting a status, and changing a workspace's or project's workflow.
  Every item moved this way gets a status history row, and the change is logged as `work_items_moved`.
- **Moving a project to another workspace,** or removing its workspace, takes the new workspace's workflow, unless
  some of its items are in statuses that workflow doesn't have. Then the project keeps its old workflow as its own,
  and an administrator can switch it in Settings, choosing where the items go. Renaming a workspace carries its
  workflow and board with it.
- **Boards** (`boards`, `board_columns`, `board_column_statuses`): one per project and one per workspace, created
  the first time someone opens them.
  - A project's board starts with a column per status of its workflow. A workspace's board starts with To Do,
    In Progress and Done, covering every status.
  - A status can be in one column of a board.
  - Statuses added to a workflow later aren't added to boards automatically; the board says which statuses aren't
    on it.
  - Columns, their WIP limits, the board's name and its default swimlanes need "Add, delete and edit systems".
    Choosing swimlanes while viewing is personal and isn't saved.
- **Cards** are the project's (or workspace's) work items except epics, which show as swimlanes and on cards.
  Finished items show for 14 days after their last change. The board shows at most 400 cards, and says so when there
  are more. A card is **blocked** when an unfinished item blocks it, or it's on hold. Developers see only their own
  cards, and WIP counts for them count only their own items.
- **WIP counts** cover every item in a column's statuses, regardless of the quick filters (epics excluded). A
  column turns amber above its limit. Settings → Workload limits lists every board's limits and how full each is.
- **Boards go in the sidebar** under Workspace, next to Feature requests: it fits Pulse's navigation, and the
  Boards page picks a workspace's board or a project's.
- **Permissions:** the new "Edit workflows" (`manage_workflows`) goes to Admin and Team Leader. Workflows change how
  every project works, so it isn't given to Managers by default; an administrator can add it to any role.

## Phase 3: sprints, timeline and agile reports (2026-11-17)

- **Scrum is switched on per project** (`systems.agile_mode`, Kanban by default) by anyone who can edit systems, from
  the project's Work items tab. A Scrum project gets a **Backlog** tab, and its board shows only the running
  sprint (a workspace board does the same for its Scrum projects). Switching back to Kanban waits until the running
  sprint is completed.
- **"Plan and run sprints"** (`manage_sprints`) goes to Admin, Manager and Team Leader. It covers creating, editing,
  starting, completing and deleting sprints, and moving items into or out of them. Re-ranking the backlog also
  works with "Edit and assign any work item". Story points are typed in the backlog through the normal work item
  edit rules.
- **The backlog** is ranked by `work_items.backlog_rank`; smaller is higher. Existing items were ranked in the order
  they were created, and new items go to the bottom. A move places items just above the item they're dropped on,
  between its neighbours' ranks, so nothing else needs renumbering. Epics stay out of sprints: plan their stories,
  tasks and bugs. The backlog shows the top 500 and says how many there are in all.
- **Sprints** last 1 to 4 weeks, and `end_date` is the last day. Only one runs per project at a time, and the database
  enforces this with a unique index. Names default to "KEY Sprint N". Only a sprint that hasn't started can be
  deleted; its items go back to the backlog.
- **`sprint_items` records scope:**
  - when each item joined a sprint, whether that was after it started, and its points then
  - when it left during a running sprint
  - how it ended: completed, not completed or removed

  Leaving a sprint that hasn't started leaves no record. Moving an item to another project takes it out of its
  sprint.
- **The snapshot when a sprint completes:**
  - **committed:** the items in it when it started, at their points then
  - **added:** items that joined after the start, at their points then
  - **removed:** items that left during it
  - **completed and not completed:** the items in it at the end, at their points at the end

  Unfinished items go to the backlog, a chosen future sprint, or the next sprint, which is made if there isn't one.
  The capacity hint and velocity use the average completed points of the last three finished sprints.
- **Burndown and burnup** are rebuilt day by day from `sprint_items` and `status_history`. Each item counts at its
  current story points; a sprint where nothing has points is counted in items instead, and the report says so. The
  ideal line runs from the committed amount to zero over the sprint's days.
- **Cumulative flow** counts work items (not epics) in each status at the end of each day, replayed from status
  history. **Created vs resolved** is the same window, totalled by week.
- **Cycle time** runs from the first move into an In Progress status to resolved; **lead time** runs from created to
  resolved. Items resolved "won't do" are left out. The control chart shows each finished item, a rolling average
  of five, and an outlier line at two standard deviations above the mean.
- **Reports respect visibility:** developers who see only their own items get reports from only those items. The
  reports are on the Reports page, which needs the "reports" permission, under "Agile reports".
- **The timeline** reuses existing data:
  - an item's bar is its start and due dates
  - an epic without dates spans its items (striped, and not draggable)
  - a project's bar is its start and due date
  - dependencies are Phase 1 "blocks" links
  - dragging a bar, or choosing dates in the keyboard-friendly dialog, saves through the normal work item or
    project edit, so it's permission-checked and logged
  - a warning shows when a blocking item ends after the item it blocks starts
  - in a workspace, an epic's items load when it's expanded
- **Sprint health** (days left, points done against the sprint's points, the points committed, and "behind" when
  the share done trails the share of days gone by more than 20 points) goes to Ask Pulse and as a "Sprints" section
  in the Monday Briefing. For developers who see only their own items, Ask Pulse counts only those.
- **New bell alert:** `sprint`, sent to the assignees in a sprint when it starts.

## Phase 4: search, saved filters, dashboards and automation (2026-11-17)

- **PQL (Pulse Query Language)** follows Jira's JQL. One parser (`src/data/pql.ts`) serves the browser (suggestions
  and errors as you type) and the Worker; the Worker compiles it to SQL (`worker/pql.ts`).
  - Each field maps to a fixed SQL fragment, and every value the user typed is a bound parameter. No user text is
    ever placed into SQL, so a query like `summary ~ "'; DROP TABLE …"` is only text. Unit tests check this
    (`npm test`).
  - ORDER BY accepts only listed fields. With no ORDER BY, results come newest-updated first.
  - **`!=` and `NOT IN` work as in Jira:** they don't match empty values. `assignee != mutsa` leaves out unassigned
    items; add `OR assignee IS EMPTY` to include them.
  - Priority compares by rank, so `priority >= High` means High or Highest, and `ORDER BY priority DESC` puts
    Highest first, as in Jira.
  - `text ~` looks in the summary, description and comments; `summary ~` and `description ~` look in one each.
  - A plain date (`2026-11-01`) compares by day. Relative dates (`-7d`, `-2w`, `1m`) and `now()` compare to the
    moment. Week functions use Harare time, with weeks starting on Monday.
  - An unknown field, function or value gets a "did you mean …?" suggestion (when it is within two edits, or a third of the word for long words), and the error
    points at where it is in the query.
- **Visibility is the only rule PQL enforces.** Pulse has no per-item security levels. Every query is wrapped in the
  same rule as the rest of the app: a developer without "Log and assign feature requests" sees only items they're
  assigned to or reported. That covers search, CSV export, gadgets, subscriptions and Ask Pulse.
- **Sharing filters and dashboards** needs a new permission, "Share filters and dashboards" (`share_searches`),
  given to Admin, Manager, Team Leader and Projects Assistant. Without it, people can still save private filters and
  dashboards.
  - They can be shared with a role, a workspace or everyone.
  - A workspace share is seen by people who lead or work on a project in that workspace. Anyone who may share sees
    every workspace's shares.
  - Only the owner can change or delete a filter or dashboard. Anyone who can see a filter can star it and subscribe
    to it.
- **Gadgets run the saved filter as the viewer**, not as the owner. A shared dashboard therefore never shows anyone
  more than they could find with Search. A gadget's filter must be one its owner can see when the dashboard is saved.
  If the filter is deleted later, the gadget says so.
- **The eight gadget kinds:**
  - filter results
  - pie chart, by a chosen field
  - created vs resolved, last 30 days
  - sprint health
  - workload by assignee
  - overdue
  - two-dimensional statistics, two chosen fields
  - recent activity, from the activity log entries for the filter's items

  Group-by fields come from a fixed list. The existing Dashboard stays as "Pulse overview": the default, and the
  only one on view-only links. The browser remembers which dashboard was last opened.
- **One cron trigger, every hour.** The Cloudflare account is on Workers Free, which allows 5 cron triggers across
  all its Workers, and the first Phase 4 deploy was refused for a sixth. Pulse now has a single `0 * * * *`
  trigger instead of three. `worker/schedule.ts` works out what each run is due to do, from its scheduled time:
  - every hour: filter subscriptions and scheduled automation rules
  - weekdays at 07:00 Harare: the retention clean-up and daily digests, as before
  - Mondays at 08:00 Harare: the Monday Briefing, as before

  Unit tests cover the timetable.
- **Subscriptions** run from the hourly cron, at the hour chosen in Harare time, daily or weekly.
  They arrive under the bell with the results as a digest, and by email once email is connected (following the
  person's "email summaries" setting). Each one sends at most once per hour slot.
- **Ask Pulse writes PQL.** "Turn this into a search" under an answer (and "Ask in plain English" on the Search page)
  sends the question to Workers AI with the PQL grammar, the project keys, statuses and usernames. The answer is
  parsed, and if it doesn't parse, the model gets one retry with the error. The PQL is always shown before it's
  run or saved, and running it applies the normal visibility rule. Not offered on view-only links.
- **Automation rules** need a new permission, "Manage automation rules" (`manage_automation`), given to Admin and
  Team Leader.
  - **Triggers:** created, moved status (optionally to one status), a field changed (optionally one field), comment
    added, all sub-tasks done, sprint started or completed, or a schedule (a weekday or every day, at an hour).
  - **Scope:** every project, one workspace or one project. **Condition:** optional PQL, which the item must match.
    For scheduled and sprint rules, it picks the items to act on.
  - **Actions:**
    - move to a status (by name or `category:DONE`), through the project's workflow, so it obeys the moves allowed
      and their required fields
    - assign (a person, nobody, the reporter, the project lead, or someone with a role on the project)
    - set a field
    - add a comment
    - notify
    - create a sub-task
    - link to another item
- **Rules act as "Automation: rule name".** That name appears in history, comments and the activity log. A rule runs
  with full rights (it needs no permissions of its own), but only within its scope and condition.
  - Rules run after the response (`ctx.waitUntil`), so nobody waits for them.
  - A rule's own changes can set off other rules, up to 3 levels deep; beyond that they're logged as "skipped".
  - Each rule has a limit of runs a minute (default 10, at most 100). Runs over the limit are logged as skipped.
  - Every run, including skipped ones, goes in `automation_runs` with what set it off, the item, the result and what
    it changed. Run logs are kept 90 days.
- **Notify** sends to the assignee, the reporter, the watchers, a person, everyone with a role, or the Teams
  channel, by bell, email and/or Teams. Bulk runs (scheduled and sprint rules) send each person one message listing
  the items, not one per item.
- **Three example rules are seeded, all off:**
  - a Highest-priority bug is assigned to the project's Team Leader and posted to Teams
  - when all sub-tasks are done, the parent moves to Done
  - every Monday at 08:00, the assignees of overdue items are reminded by bell and email
- **Storage:** new data is in real columns and tables (`saved_filters`, `filter_favourites`, `filter_subscriptions`,
  `dashboards`, `dashboard_gadgets`, `automation_rules`, `automation_actions`, `automation_runs`). None of it is in
  `GET /api/data`. When a person is removed, the weekday clean-up removes their favourites and subscriptions. Their filters and dashboards stay,
  shown as by "Former user", until someone deletes them.
- **New bell alerts:** `subscription` (a filter's results) and `automation` (a rule's notify action).
