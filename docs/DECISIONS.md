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

## Phase 5: integrations, admin schemes and Service Desk lite (2026-11-17)

- **One visibility rule.** Who may see a work item is decided in one place, `worker/access.ts`: an SQL fragment
  and a check on one item. Lists, item pages, boards, the timeline, agile reports, PQL, dashboards, subscriptions,
  sprint health, notifications, Ask Pulse, view-only links, the API, webhooks and automation all use it. Before
  this phase, four modules each had their own copy of the developers' rule.
- **Security levels.** An item with a level is seen by:
  - administrators
  - its assignee and reporter
  - the roles and people the level names

  The assignee and reporter always see it, so nobody is handed work they can't open.
  - **View-only links** never see items with a level.
  - **Choosing a level:** you may give an item only a level you belong to. Only people at an item's level (and
    administrators) may lift it or change it.
  - **Deleting a level** that items use is refused.
  - **Two levels are seeded:** "Confidential – Managers only" (the Manager role) and "HR only" (people an
    administrator adds).
- **Where a level holds back what's shared:**
  - **The Monday Briefing** goes to many people, so its sprint figures leave out items with a level.
  - **The Teams channel** never gets a post about an item with a level, whether from a notification scheme or an
    automation rule.
  - **Outbound webhooks** never send items with a level.
  - **Automation** still acts on every item, with full rights. Its notify action only tells people who may see
    the item.
  - **Feature requests** are work items, so a confidential client request is hidden on the Feature requests page,
    in `GET /api/data`, on its routes and in Ask Pulse. Daily digests and the Monday Briefing leave confidential
    client requests out. The public /executive page shows totals only, with no titles, so it still counts them.
- **Notification schemes:**
  - **Events:** created, assigned, changed, moved status, commented.
  - **Who:** for each event, an administrator ticks the assignee, reporter, watchers, project lead, @mentioned
    people and/or everyone with a role.
  - **How:** bell, email and/or one Teams post.
  - **Defaults:** the seeded schemes do what Pulse did before.
  - **Rules for everyone told:** nobody hears about their own change, everyone told must be able to see the
    item, and each person can opt out of any event in Settings → Notifications. Email still follows each
    person's own email setting.
  - **Workflow moves:** a move's own "notify" rule (Phase 2) still tells its people, whatever the scheme.
- **Custom fields** belong to a workspace, with kinds text, number, date, single select, multi select and person.
  - **Storage:** values are rows in `custom_field_values`, one per chosen option for a multi select, so they can
    be searched and reported on.
  - **Screens:** administrators choose where each field appears (create form, editable on the item, shown on the
    item, board cards) and whether it's required.
  - **Required fields** are checked on the create form and on `POST /api/items`. They aren't checked for feature
    requests, service desk requests or automation sub-tasks, which come from other forms.
  - **A field's kind can't change** after it's made.
  - **Changes** are logged as "field:<name>" with before and after values.
- **Custom fields in PQL** are used by name, in quotes when the name has spaces: `"Customer tier" = Gold`. Fields
  with the same name in several workspaces are searched together. Select fields compare by choice label. `!=`
  doesn't match empty, as for the built-in fields. Custom fields can't be used in ORDER BY.
- **GitHub:**
  - **The secret** is sealed with MFA_KEY in `integration_secrets`, like the email and Teams keys, and never sent
    back.
  - **Checking a call:** Pulse compares the `X-Hub-Signature-256` HMAC in constant time, and counts each
    delivery id once.
  - **What it reads:** pushes (commits, and a branch the push created), branch creation and pull requests.
  - **Finding keys:** any key-shaped text in a commit message, branch name or pull request title or body; branch
    names may be in lower case.
  - **Only real items:** links are made only to items that exist.
- **Personal API tokens:**
  - **What a token is:** `pulse_` and 64 hex characters, read or read-and-write, expiring after 7 to 365 days, at
    most 10 live per person.
  - **Storage:** only the SHA-256 hash is kept, with the first characters to tell tokens apart.
  - **Who it acts as:** a token is its owner. It has the owner's permissions and visibility, and stops working if
    the owner's role loses "Use personal API tokens".
  - **Limits:** read tokens may only GET. Tokens can't touch accounts, sign-in, tokens, view-only links, settings
    or integrations. Each token may make 120 requests a minute (counted in Postgres per token per minute).
  - **Logging:** changes made with a token are logged as the owner, with `viaApiToken` naming the token.
  - **Who sees them:** administrators (manage_users) see and revoke everyone's tokens.
- **Outbound webhooks:**
  - **Events:** created, updated, moved status, commented, for every project or one.
  - **Addresses:** https only, and never local or private addresses.
  - **Signing:** each webhook has its own secret (`whsec_…`, sealed, shown once), and the body is signed in
    `X-Pulse-Signature`.
  - **Retries:** Pulse tries once at once and again 15 seconds later. After that the hourly cron retries after
    about 1, 2, 4 and 8 hours, and a delivery is marked failed after six tries. An administrator can retry it.
  - **Sources:** webhooks go out from the same place automation hears about events, so changes made by rules and
    the portal are sent too.
- **Service desk:**
  - **Project:** requests land in one project, chosen in Settings. Choosing it gives that project the new Service
    desk workflow, but only if its items' statuses fit; otherwise the choice is refused.
  - **The workflow:** To Do → In Progress ⇄ Waiting for customer → Resolved → Closed, plus Change Approval. The
    two new statuses are "Waiting for customer" (In Progress category) and "Resolved" (Done).
  - **Changes** must pass through Phase 2's Change Approval status. Its "Approve change" move needs a Manager and
    a comment.
  - **Work items:** requests are work items with source `service_desk`, plus a row in `sd_requests` for the
    customer and SLA alert stamps. The customer's answers are copied, with the question as it was asked.
- **The portal:**
  - **Links** work like view-only links: a secret shown once, kept as a hash, expiring and revocable.
  - **Who raised what:** a customer's browser keeps a random requester key, kept as a hash, so it can list and
    open only the requests it raised. Signed-in staff use Service desk → Raise a request and My requests.
  - **What customers see:** the portal shows only public replies and the customer's own messages, never internal
    notes, other requests or internal items.
  - **Who requests are from:** portal requests are reported by the link's maker and logged as "<name> (customer)".
  - **Limits:** up to 30 requests an hour per link.
- **Replies and the SLA clock:**
  - **Replies to the customer:** staff tick "Reply to the customer" on a comment. Only people who work the
    service desk may.
  - **First response:** the first reply to the customer stops the first-response clock.
  - **The customer's reply:** when the customer replies while the request is waiting for them, it moves back to
    In Progress and the clock runs again.
  - **Telling the customer:** they hear by email about replies, status changes and resolution, or under the bell
    for staff customers. These emails have no link into Pulse.
- **SLAs:**
  - **Targets:** first response and resolution, per request type and priority, in business minutes. Business
    hours are Monday to Friday, 08:00 to 17:00 Harare time (a nine-hour day), less the editable public holidays
    and the time spent waiting for the customer.
  - **Calculation:** the clock is worked out when it's read (`src/data/servicedesk.ts`, unit tested), not stored.
  - **Alerts:** the hourly cron warns the assignee at 75% of a target. On a breach it alerts the assignee and
    everyone who sets up the service desk, once per target.
  - **Holidays:** Zimbabwe's 2026 and 2027 public holidays are seeded, with Sunday holidays kept on the Monday.
- **Reports** count first replies and resolutions met against breached, the number of requests by type and week,
  and the average business time to resolve. They follow the reader's visibility.
- **New permissions:**
  - **Use personal API tokens** (`use_api`): every role but Standard user.
  - **Work the service desk** (`work_service_desk`): every role but Standard user.
  - **Set up the service desk** (`manage_service_desk`): Admin and Manager.
  - **Connect GitHub and manage webhooks** (`manage_integrations`): Admin.
  - **Manage notification schemes, security levels and custom fields** (`manage_schemes`): Admin.
  - **Raising requests** needs no permission: any signed-in account may.
- **Documentation:** the API reference is `docs/API.md`, with a short version in Settings (Security & privacy →
  API tokens, and Integrations). The "Running the System" PDF isn't in the repository and wasn't changed.

## Chat (2026-11-23)

- **Three kinds of conversation:** direct messages (two people, one per pair, can't be left), group chats (named, up
  to 50 people) and one channel per project (`chat_conversations.id = 'p-<system id>'`, made the first time anyone
  needs it). Migration `0008_chat.sql`: `chat_conversations`, `chat_members`, `chat_messages`.
- **No new permission.** Everyone signed in can chat; view-only links can't. A direct message or group is seen only
  by its members (anyone else gets 404). A project channel can be read and joined by anyone signed in. Its lead and
  developers are added when they open Chat (`GET /api/chat?sync=1`), unless they left it before (`left_at` is kept).
- **Polling, not WebSockets**, to stay within the Workers Free request limit and avoid a Durable Object behind the
  gateway Worker: the open conversation every 3 s, the list every 15 s, the sidebar badge every 60 s, and nothing while
  the tab is hidden (`src/data/chat.ts`). A poll returns new messages (`after`), older ones edited or deleted since
  the last poll (`since`, with 10 s overlap), and read positions. `read=1` marks the conversation read in the same request.
- **Moderation:** people edit and delete their own messages. Someone with `manage_users` may delete others' messages
  in groups and channels (never in direct messages) and remove people from a group, as can the group's creator.
  Deleted messages keep their place with the words removed.
- **Notifications under the bell** (kind `chat`, linking to `#/chat/<id>`, never email). In a direct message or group,
  a new message notifies the other members once per unread run: the dedupe key is
  `chat-unread:<conversation>:<their last_read_id>`, so a burst is one notification and the next comes after they
  catch up. Anyone who read the conversation in the last 12 seconds (`chat_members.read_at`, migration
  `0009_chat_read_at.sql`) is reading it now and isn't notified. Project channels notify only @mentions, to keep
  busy channels off the bell. An @mention gets its own "mentioned you" notification (key `chat:<message id>`).
  Reading a conversation marks its notifications read. Unread messages also show as the badge beside Chat.
- **Activity log:** group creation, renames and membership changes, and moderators' deletions. Messages themselves
  are never logged.
- **Endpoints:** `GET /api/chat`, `GET /api/chat/unread`, `GET /api/chat/channels`, `POST /api/chat/projects/:id/join`,
  `POST /api/chat/direct`, `POST /api/chat/groups`, `GET`/`PUT /api/chat/:id`, `POST /api/chat/:id/members`,
  `DELETE /api/chat/:id/members/:userId|me`, `GET`/`POST /api/chat/:id/messages`, `PUT`/`DELETE /api/chat/:id/messages/:mid`.

## Self-service password reset (2026-11-24)

- **Flow:** "Forgot your password?" on the sign-in card takes a username or email address (an email counts only when
  exactly one person has it). Pulse emails a link, `#/reset-password/<token>`, which works once and only for 30
  minutes. The token sits in the hash, so it never reaches a server log or a Referer header, and the page drops it
  from the address bar once used. Only its SHA-256 is stored (`password_resets`, migration `0010_password_resets.sql`).
- **No enumeration:** the reply is the same sentence whether or not the account exists, was emailed or hit a limit,
  and the email is sent after the reply (`ctx.waitUntil`), so timing doesn't tell either.
- **No email to send to** (no address on the account, or email not connected in Settings): administrators get a
  bell notification ("X forgot their password", at most one per person per day) to confirm it's them and issue a
  temporary password in Settings → People, as before.
- **Limits:** 5 requests per IP address per 15 minutes, and 3 sends per account per hour; over either, nothing is
  sent and the reply doesn't change. Requests are kept 24 hours, then removed (retention clean-up).
- **The new password** follows the usual policy and can't be one of the last 5. Saving it signs out every device,
  clears any sign-in lock (holding the email proves enough), cancels other unused links, and emails a "your password
  was changed" notice. It does not sign you in, and two-step verification still applies at the next sign-in.
- **Activity log:** `password_reset_requested` (with the outcome) and `password_reset_by_email`.
- **Endpoints (no sign-in):** `POST /api/password/forgot`, `POST /api/password/reset/check`, `POST /api/password/reset`.

## Feature request insights for managers (2026-11-25)

- **Where:** Feature requests → **Insights** (a List / Insights switch in the page header), for anyone with the
  `reports` permission (managers and administrators by default). Built from the requests the page already has:
  nothing new is fetched, no migration. The maths is in `src/data/featureInsights.ts` (tested); the charts in
  `src/components/FeatureInsights.tsx`, using the reports chart kit's validated colours, tooltips and legends.
- **The reading:** plain sentences (backlog grew or shrank, typical delivery time against the period before, how
  many are past the promised date, the oldest critical/high request, a client holding 40%+ of the backlog) and five
  tiles, each compared with the period before by arrow and words, not colour alone. Periods: 4 weeks, quarter,
  6 months; optional workspace.
- **Charts:** weekly flow as mirrored bars (in above the line, delivered and cancelled below) with the open backlog
  as a separate strip on the same weeks (never a second axis); an ageing dot plot of every open request by age
  (square-root scale) in priority lanes, coloured by schedule (late / dated / no date), click to open; requests per
  client (delivered, open, open-and-late) with on-time rate; delivery time per type as median and 80th percentile.
- **Definitions:** a cancelled request leaves the backlog at its last update; "on time" means delivered on or before
  the expected date (the day itself counts); lead time is request to delivery.

## Request update: choose Pulse chat, email or Teams (2026-11-25)

- **The choice:** the Request update form offers Pulse chat, Email and Teams (one or more). Email and Teams are
  greyed out until an administrator connects them in Settings → Notifications; a view-only link can't use chat.
  The browser remembers the last choice. Whatever is chosen, the project lead and developers are also told under
  the bell, so a request is never lost.
- **Pulse chat** posts a message in the project's channel (`p-<project id>`) from the person asking, @mentioning
  the lead and developers (the channel is made, and they are added, if needed). The bell notification then links to
  that message. No separate chat notification is raised, so nobody hears twice.
- **Email** goes straight to each team member with an address, whatever their email-alert setting: the person
  asking chose it, like sending an email themselves. The reply says who has no address.
- **Teams** posts to the connected channel; the reply says if Teams refused it.
- `requests.via` (migration `0011_request_channels.sql`) records the choice; the request card and activity log show
  it. A client that sends no choice gets the old behaviour (bell, plus Teams when connected).

## Managers: a high-level menu, with the analysis under Reports (2026-11-25)

- **Reports is one hub with tabs:** Projects (the projects report as before), Feature requests (the Insights view),
  Delivery (the agile charts, opening on created-vs-resolved across a workspace rather than a sprint burndown),
  and Service desk (its reports). Everyone with Reports gets the tabs; the last tab used is remembered per browser.
- **Managers' sidebar** (role `manager` with the Reports permission): Dashboard, Projects, Reports, then Chat,
  Concept Notes and Settings. Feature requests, Boards, Search and Service desk are left out of their menu: they
  see that work through Reports and the project pages instead of the day-to-day lists. Their permissions are
  unchanged, so links (notifications, a project's work items, a feature request) still open as before.
- Other roles' menus are unchanged.

## Reports → Overview: an interactive BI dashboard (2026-11-25)

- The first Reports tab, and where Reports opens by default. Built from the data the page already has (projects,
  feature requests, blockers, people): nothing new is fetched, no migration.
- **Layout:** a workspace slicer (tiles), five headline figures, then projects by stage (donut), schedule by
  workspace, feature requests by client, requests by type and priority, progress by project lead, requests over
  12 months, and a portfolio treemap (each project sized by open requests, coloured by schedule).
- **Cross-filtering, as in Power BI:** clicking a tile, slice, legend entry or bar toggles a filter for the whole
  page; filters show as removable chips with Clear all. Each chart is computed with every filter except its own,
  so its own choices stay visible and highlighted while the others dim. Project filters narrow the requests;
  request filters (client, type) narrow the projects to those with a matching request. Logic in `src/data/bi.ts`
  (tested), charts in `src/components/reports/BiDashboard.tsx`.
- Priority is ordinal, so it's one hue stepped light to strong (towards white on dark themes so the low end stays
  visible), not four unrelated colours. Schedule uses the reserved status colours with a legend.
- **Printing (added 2026-11-25):** Print / PDF on the Overview prints A4 landscape (the page size is set only for
  that print, so other pages print as before) with a letterhead: the Omni Contact logo, the Pulse name, the title,
  when it was generated and what it was filtered to. Paper always gets the light palette, whatever the screen theme;
  the slicer and filter chips stay on screen (the letterhead names the filters). Page 1 holds the figures and six
  charts, page 2 the portfolio map.

## Dashboard design system (2026-11-25)

- **Use the tokens.** New styles take spacing, type, radius, elevation, semantic and chart colours from the tokens
  at the top of `src/styles.css` (`--sp-*`, `--fs-*`, `--r-*`, `--e-*`, `--success/warning/danger/info/neutral`,
  `--cat-*`, `--focus`). A theme changes values only, never names.
- **Omni Contact colours:** Penn Blue #011f5b (sidebar, sign-in, buttons, headings, avatars), royal blue #0039a6
  (links, focus, information), sky #1ba9e1 and gold #f2a900 as accents, the signature red #ed0000 for the heartbeat.
  Omni Contact's site refuses automated reads, so these come from what Pulse already used; swap in official hex
  codes if they differ.
- **Chart colour by job:** series identity uses `--cat-1…8` in that fixed order (never cycled; a ninth series
  folds into "Other"). Status colours (`--st-*`, `--danger` etc.) are for meaning only and always come with a word
  or an icon. Both palettes were checked with the dataviz validator (colour-blind separation of neighbours, light
  on #ffffff, dark on #13163a); re-run it if a value changes.
- **One card:** header (icon, title, actions) → body → optional footer ("Updated …", "View all"). Gadgets always
  have a skeleton, an empty state and an inline error with Retry.
- **Layout:** a 12-column grid. Saved custom dashboards keep their column choice (12, 6 or 4 spans) so nobody's
  dashboard reorders.
- **Focus is always visible:** never `outline: 0` without a replacement (`box-shadow: var(--ring)` or the global
  ring). Small text must reach 4.5:1 in both themes.
- **Themes:** there are two, light and dark (`data-theme="futuristic"`, shown as "Dark"). Dark keeps a restrained
  glow (card hairline, hover glow), never at the cost of contrast.

## Chat: files, emoji, GIFs, stickers, reactions, replies, pins and search (2026-11-25)

- **Migration `0012_chat_rich.sql`:** `chat_messages` gains `meta` (JSON: a GIF or a sticker), `reply_to`, `pinned_at`
  and `pinned_by`; new tables `chat_files` + `chat_file_chunks` (1 MB chunks in Postgres, like project documents) and
  `chat_reactions` (one row per person, emoji and message).
- **Files:** up to 10 files of up to 10 MB each per message. They're uploaded first (`POST /api/chat/:id/files`) and
  attached when the message is sent; until then only the uploader can fetch them, and the weekday clean-up deletes
  any not sent within a day. Served from `GET /api/chat/:id/files/:fileId` to anyone who may read the conversation,
  with the same rules as documents: only PNG, JPEG, GIF, WebP and PDF open in the browser; everything else downloads;
  `nosniff` and a sandboxing CSP on every file. Deleting a message deletes its files and reactions.
- **GIFs:** GIPHY search, proxied by the Worker (`GET /api/chat/gifs?q=`), so the key never reaches the browser and
  only search words leave Pulse. Rating G only. **Off until an administrator sets the `GIPHY_API_KEY` Worker secret**
  (`npx wrangler secret put GIPHY_API_KEY`); the picker says so until then. A sent GIF keeps only GIPHY's id and its
  `media*.giphy.com` address (checked on the server, so a "GIF" can't load an image from anywhere else). The picker
  shows "Powered by GIPHY", as GIPHY's terms ask. People can always attach their own GIF files.
- **Stickers:** Pulse's own set of 16 (original artwork: icons, brand gradients, short phrases), drawn in the UI
  (`src/components/ChatExtras.tsx`). The server accepts only their ids (`STICKERS` in `src/data/chat.ts`).
- **Emoji:** a built-in picker (`src/data/emoji.ts`, search words per emoji, recently used remembered per browser),
  drawn by the system's emoji font, so nothing is downloaded.
- **Reactions:** click to add, again to remove (`POST /api/chat/:id/messages/:mid/reactions`). Only real emoji are
  accepted (`isEmoji`), up to 20 different ones per message. Reacting in a project channel joins it, like writing.
- **Replies** quote the original (who and the first words, or "Message deleted"); clicking the quote scrolls to it.
- **Pins:** anyone in the conversation pins or unpins a message for everyone (`POST …/pin`); `GET /api/chat/:id/pins`
  lists them. Deleting a message unpins it.
- **Search in a conversation:** `GET /api/chat/:id/search?q=` (2+ characters) matches words and file names, newest
  first, 50 at most. `%` and `_` match literally.
- **How others see changes:** reactions, pins, edits and deletions all move `updated_at`, so the next poll's
  `changed` list carries them (no new polling).
- **Not logged:** like messages, files, reactions and pins aren't written to the activity log.

## Reports → Projects: health (RAG), shared figures and exports (2026-11-25)

- **Health is RAG, named `rag` in code** (`System.health` already means Stable / Maintenance). One rule,
  `src/data/projectHealth.ts`, used by the Worker and the browser alike. Only projects being built are rated;
  ideas, upcoming, live and completed projects are "Not rated". Thresholds (`RAG_RULES`), change them only there:
  - **Red (Off track)** if any of: past the due date; an open blocker older than 7 days; no progress update for
    2 × the stall limit; more than 25 points behind the expected pace; more than 20% of open work items overdue.
  - **Amber (At risk)** if any of: due within 7 days and below 80%; any open blocker; stalled (the stall limit);
    more than 10 points behind pace; more than 10% of open work items overdue.
  - **Green (On track)** otherwise.
  - Expected pace is the share of the time from start to due date that has passed. Every reason is kept, red
    first, and shown on hover and in the export.
- **"Overdue update request":** open for more than 3 working days (Mon–Fri).
- **"Needs attention" is one rule everywhere** (`needsAttention`): overdue, due within 7 days, blocked, or
  stalled. The dashboard, the top bar, the executive page and Reports all call it. The executive page used to
  leave out "due within 7 days", so its count can rise by the projects due this week.
- **The report is worked out by the Worker** (`worker/projectReports.ts`): a handful of grouped queries (no query
  per project), work items always through `itemAccess`, then `buildProjectReport` (`src/data/projectReport.ts`)
  turns the counts into rows, health and totals. The screen and the exports show that one result, so they match.
- **Who:** signed in with "Generate reports" only. View-only links are refused, even though they carry `reports`
  for the screens they can open.
- **Which projects:** delivered projects whose life overlaps the period; open projects started by its end; and
  every project not started yet (the pipeline). Default period: the last 90 days.
- **Progress over time** comes from the activity log's `system_progress` entries (kept 365 days): each project's
  progress at the end of each week, averaged over the projects under way that week.
- **Exports:**
  - **Excel**, built by the Worker with a small writer of its own (`worker/xlsx.ts`, no dependency), one sheet
    per section plus every visible work item as raw rows.
  - **PDF** through the browser's print dialog ("Save as PDF"), not a PDF library: a branded cover (logo, period,
    filters, generated by and at), A4 landscape, the light palette whatever the theme, "Page n of m" in the footer.
  - Every export is written to the activity log.
- **Not done yet:** emailing the report on a schedule.

## JavaScript with JSDoc types, not TypeScript (2026-11-25)

- **The code is JavaScript:** `.js` for logic and the Worker, `.jsx` for React components. Types are written as JSDoc
  and still checked: `npm run build` runs `tsc` with `allowJs` + `checkJs` (strict) for the app and the Worker, so a
  type mistake still fails the build before deploy.
- **Earlier entries name `.ts` / `.tsx` files:** read them as `.js` / `.jsx` (same folder, same name).
- **One file stays TypeScript:** `worker/env.d.ts`, a declaration file describing the Cloudflare runtime (`D1Database`,
  `Env`, `ExecutionContext`). It never runs, and JSDoc can't declare global types.
- **How types are written:**
  - Types and interfaces: `/** @typedef {…} Name */` (or `@typedef {Object}` with `@property`). An interface that
    extended another is `@typedef {Base & NameOwn} Name`, its own fields in `NameOwn`.
  - Types from another file: `/** @import { Name } from './file' */` at the top. When the first thing after those
    lines is a commented declaration, put `export {};` between them, or TypeScript reads the imports as that
    declaration's documentation and can't see them elsewhere in the file.
  - Casts: `/** @type {T} */ (value)`; the brackets are required. An explicit generic call such as `api<T>(…)` is
    written `/** @type {Promise<T>} */ (/** @type {unknown} */ (api(…)))`.
  - React state and refs: type the starting value, `useState(/** @type {T[]} */ ([]))`,
    `useRef(/** @type {HTMLDivElement | null} */ (null))`.
  - Generic helpers: `@template {keyof X} K` with its constraint, as TypeScript's `<K extends keyof X>` had.
  - Rest parameters: `@param {...unknown} values` (the element type, not an array).

## @mentions while typing, and in feature requests (2026-11-25)

- **Suggestions:** typing `@` and a letter in a work item's comment, comment edit or description box, or a feature
  request's Details or Developer notes, lists up to 6 people (username, or any word of their name, starting with the
  letters). ↑/↓ and Enter/Tab insert `@username `; Escape closes the list only. One component,
  `MentionTextarea` (`src/components/WorkItemBits.jsx`); chat keeps its own composer.
- **Feature requests notify mentions:** a request's endpoints create and edit its work item quietly (they send their
  own "assigned to you" alerts), so mentions in its Details or Developer notes are handled there: the people
  **newly** mentioned are told, as named recipients (`extra`) of `item_created` (new request) or `item_updated`
  (edited). So it works whatever the scheme's "mentioned" switch says; the scheme still decides email, and
  visibility and personal opt-outs still apply. You're never told about your own mention.

## Multi-tenancy (2026-11-26, phase (a) of five)

The plan, with the audit behind it, is `docs/multi-tenancy-plan.md`. The owner approved every recommendation in its
section 12. Rules every later feature must follow:

- **Three levels.** Platform (organisations, Platform Administrators), organisation (people, sign-in, two-step,
  delivery, roles, and shared configuration: statuses, workflows, security levels, notification schemes, holidays,
  templates) and workspace (all project data and everything made from it).
- **Every new table says whose it is:**
  - Organisation tables: `organization_id`, `NOT NULL`, with a foreign key to `organizations`.
  - Workspace tables: also `workspace_id`, `NOT NULL`, indexed, with a foreign key `(organization_id, workspace_id)`
    to `workspaces (organization_id, id)`.
  - A child table points at its parent by `(workspace_id, parent_id)` → `parent (workspace_id, id)`, so the database
    refuses a row in another workspace than its parent's. The parent needs `UNIQUE (workspace_id, id)`.
  - Organisation-level references (statuses, workflows, levels) use `(organization_id, …)` the same way.
- **Unique per tenant, never globally:** usernames and project keys per organisation; workspace names and keys per
  organisation; everything else per workspace.
- **People are referenced without foreign keys** (assignee, owner, author …): a removed person's history stays, shown
  as "Former user", as before.
- **The activity log** is per workspace. Events about people, sign-in and organisation settings have no workspace and
  are for Organisation Administrators only.
- **Workspace scoping decisions (approved):**
  - Sign-in: organisation code → username and password → two-step → choose among your own workspaces.
  - Row-level security will back up the code, once its cost through Hyperdrive is measured (phase (b)).
  - Chat (direct and group too), digests, the Monday Briefing, tokens, share links and the portal are per workspace.
  - No view across workspaces for now.
  - Projects don't move between workspaces.
  - `/executive` becomes a per-workspace secret link.
  - Platform Administrators are separate accounts that can't open an organisation's data.
  - The Admin role becomes a workspace role, and "Organisation Administrator" is the `users.org_admin` flag.
- **Migration `0013_tenancy_schema.sql`:**
  - Creates Omnicontact, turns the old workspace list into rows, and makes every existing person a member of every
    workspace with their current role. Administrators become Organisation Administrators.
  - Places every row by its parent. Rows with no parent of their own go to "Projects"; projects with no workspace go
    to the first workspace, as the app showed them.
  - Nothing is dropped silently. Placements that need a look are in `tenancy_report`. Rows that can't be kept (parent
    gone, or linking two workspaces) are copied whole into `tenancy_orphans` before removal, and the reverse script
    puts them back.
- **Until phase (b) ships, the old code runs on the new schema:**
  - Insert triggers fill `organization_id` and `workspace_id` from the parent.
  - Renaming or removing a workspace, and moving a project to another workspace, are refused (the database can't tell
    a rename from a remove-and-add). Adding a workspace works, and everyone joins it.
  - Phase (b) sets the columns in code and replaces these triggers.
- **Reverse migrations** live in `migrations/down/` and are run by hand (`node scripts/db.mjs exec dev
  migrations/down/<file>`). `db.mjs migrate` only reads `migrations/*.sql`, so it never runs them.
- **Dry run before any real database:** `node scripts/tenancy-dry-run.mjs dev|stage` runs the migration in a
  transaction, reports rows per table per workspace, and rolls back. It refuses the live database. `stage` is a Neon
  branch made from production (`PG_STAGE` in `.dev.vars`).
- **Database tests:**
  - `tests/helpers/worker.js` runs the real Worker against a real database. They refuse the live database.
  - Superseded in phase (b): they run on PGlite by default (below).

## Multi-tenancy, phase (b): the database enforces the tenant (2026-11-26)

- **Row-level security is the enforcement, not only a backstop.** About 710 raw SQL strings can't be made to
  filter reliably by hand, so Postgres does it:
  - **The role:** migration 0014 adds `pulse_app`, which can't bypass RLS and can't sign in. The Worker's own role
    (`neondb_owner`) bypasses RLS, so it switches to `pulse_app` per query.
  - **Per query:** each query runs in its own short transaction, `SET LOCAL ROLE pulse_app` plus
    `set_config('app.org_id' / 'app.workspace_id', …, true)`, pipelined with the query (`worker/pg.js`).
    `SET LOCAL` is what Hyperdrive's transaction pooling keeps. No Hyperdrive or credential change was needed.
  - **Fails closed:** `env.DB` starts with no tenant, and with no tenant RLS shows nothing and accepts nothing.
  - **The owner handle:** `env.ROOT` skips RLS, and is used on purpose only for:
    - working out who is asking (sessions, tokens, links, portal links, GitHub secrets, by their hash)
    - sign-in and password reset
    - the cron's list of workspaces
    - retention clean-up
    - the organisation's project keys (the uniqueness check)
    - the legacy `/executive`, which reads each workspace through its own handle
  - **Everything after identity:** `db`, `env.DB` and the background work started from a request (automation,
    notifications, webhooks) get the request's scope.
- **Every new table needs a policy:**
  - **Workspace tables:** `USING (workspace_id = current_setting('app.workspace_id', true))` and the same
    `WITH CHECK`, plus the organisation.
  - **Organisation tables:** the same on `organization_id`.
  - **Grants:** never grant a table to `pulse_app` without its policy.
  - **Defaults:** the tenant columns default to the request's tenant, so inserts don't repeat them.
- **Views run with the reader's rights** (`security_invoker = true`), or RLS doesn't apply through them
  (`features`, `users`).
- **People:**
  - **Tables:** the table is `accounts`, one row per person per organisation. The `users` view shows each person
    with their role in the open workspace, and only that workspace's members. Outside a workspace it shows the
    account's own role.
  - **Writes through the view:** a role change goes to the membership. Removing someone removes their membership
    here, and the account once they have no workspace left.
  - **Organisation-wide uniqueness:** usernames are checked organisation-wide (organisation-scoped handle), because
    members of other workspaces can't be seen from this one.
- **Roles are per workspace** (`workspace_members.role`). Organisation-wide alerts (an account locked, a forgotten
  password) go to Organisation Administrators (`org_admin`), each under the bell of their first workspace.
- **Configuration ids are unique per tenant:**
  - **Per organisation:** statuses, workflows, moves, security levels.
  - **Per workspace:** request types, their questions and choices, and automation rules and actions.
  - **Why:** every tenant can have its own `TODO` or `service-desk`, which the code names.
  - **Seeding:** `tenancy_seed_organization` and `tenancy_seed_workspace` copy configuration into a new tenant with
    the same ids. Phase (d) should seed from a clean template, not from Omnicontact's own.
- **Settings by level:** `org_settings` (roles, two-step policy, sign-in rules, delivery) and `workspace_settings`
  (workload limits, the Monday Briefing), only through `worker/settings.js`. `pulse_app` can't read the old
  `settings` table.
- **New ids** for projects, templates and people get a random ending (`hr-portal-3f9a1c`). A "-2" would say the name
  is taken in another organisation.
- **Project keys are unique per organisation:**
  - The "taken" check reads the organisation's keys as the owner, so a key used in another workspace of the same
    organisation shows as "taken". Nothing else about that project is revealed.
  - Two organisations may use the same key.
- **The 404 rule** comes mostly from RLS: another workspace's row isn't found. An endpoint that reads only the
  children of an id (a project's history) must check the parent first.
- **The activity log:**
  - The open workspace's entries, plus organisation-wide ones (no workspace) for Organisation Administrators only.
  - Sign-in counts are for Organisation Administrators.
  - `tenancy_org_action()` in the database decides which actions are organisation-wide.
- **Tokens, view-only links, portal links and GitHub each work in one workspace:**
  - **Tokens and links:** the one they were made in.
  - **GitHub:** the one whose secret signed the delivery.
- **Switching workspace:** `POST /api/me/workspace` checks membership every time. A workspace that isn't yours, in
  your organisation or another, is 404. The sessions foreign key to `workspace_members` refuses it in the database
  too.
- **The cron** loops over active organisations × active workspaces, each job with that workspace's handle. Digests
  and the Monday Briefing are per workspace, to its members. Retention runs once, as the owner.
- **`/executive` until phase (e):** Omnicontact's totals across its workspaces, never cached by shared caches.
- **The workspace list editor** (`PUT /api/settings/workspaces`) is refused with 409. Organisation Administrators
  manage workspaces (phase (d)).
- **Tests run on PGlite by default** (`@electric-sql/pglite` 0.5.16, pinned):
  - **How:** every migration is applied to an in-process Postgres, the real Worker is called, and the same adapter
    code (`databaseOver` in `worker/pg.js`) runs over a small PGlite shim (`tests/helpers/pglite.js`).
  - **Where:** `npm test` runs them, here and in CI. `PULSE_DB=dev` runs them against the Neon dev branch instead.
  - **Proven:** switching one table's RLS off makes the suite fail (checked for `saved_filters`).
- **Test-only adapter options** (`idle_timeout`, `retry_dropped`) are for running against Neon from far away. The
  Worker never sets them and never retries a query.

## Multi-tenancy, phase (d): Platform and Organisation Administrators (2026-11-26)

- **Platform Administrators** are separate accounts (`platform_admins`), outside every organisation:
  - **What they do:** make, rename, suspend and archive organisations, and give each an administrator.
  - **What they see:** each organisation's name, code, status, and counts of workspaces, people and administrators.
    Never anything inside one.
  - **Signing in:** `/platform`, a password and **always** an authenticator app, set up at the first sign-in. A
    temporary password must be replaced first.
  - **Their session:** its own cookie (`pulse_platform`, `Path=/api/platform`, `SameSite=Strict`, 8 hours), so it
    can't reach the rest of the API, and an organisation's session can't reach theirs.
  - **Access:** their tables are the owner's only (revoked from `pulse_app`), and they have their own activity log
    (`platform_activity`).
  - **The first one** is made from the command line (`scripts/platform-admin.mjs`) by whoever holds the connection
    string.
- **A new organisation** starts in one transaction, with:
  - a copy of the **template**
  - one workspace, "Projects"
  - its first Organisation Administrator, with a temporary password shown once, and its sign-in link (`#/o/<code>`)
- **The template** (`pulse-template`, archived, so nobody can sign in to it) holds only the configuration the
  migrations seeded, by its fixed ids, as Omnicontact had it at migration 0015: 11 statuses, 3 workflows with their
  moves and rules, 2 security levels (role grants only), notification schemes, holidays, and 4 request types with
  questions and SLA targets. Anything Omnicontact made itself, and any rule naming one of its people, is left out.
  **New workspaces** start from the template workspace's request types.
- **Suspending or archiving an organisation** ends its sessions at once. Its links, portal links and tokens stop
  working (every identity checks the organisation's status). Nothing is deleted. Organisation codes don't change.
- **Organisation Administrators** (`accounts.org_admin`) manage their organisation in Settings → Organisation (the
  `/api/org` routes), with the organisation-wide handle:
  - **Workspaces:** add, rename (the name is kept in step on projects, boards, workflow choices and custom fields),
    archive. Not the last active one, nor the one you have open.
  - **People:** add (temporary password), memberships and a role per workspace, Organisation Administrator or not,
    remove.
  - **Rules:** there must always be one Organisation Administrator. You can't remove yourself, or take away your own
    administrator role in the workspace you have open.
  - **Leaving a workspace** ends that person's sessions in it (the sessions' foreign key to the membership).
  - **Organisation-wide settings** (roles & permissions, two-step rules, sign-in security, email & Teams) are changed
    by Organisation Administrators only. The server refuses others with 403 `org_admin_only`, and the screens show
    those pages only to them.
- **The workspace Administrator role** keeps everything inside its workspace (workflows, boards, automation, fields,
  integrations, service desk, its People page). The People page there adds and removes members of that workspace.
- **Admin guide:** `docs/admin-guide-organisations.md`.

## Multi-tenancy, phase (e): what goes outside Pulse stays in one workspace (2026-11-26)

- **The executive page is a secret link per workspace** (`showcase_links`, migration 0016):
  - **Who makes them:** people who manage users, for the open workspace, with the token shown once and kept as a
    hash. They expire after 7 to 365 days and can be revoked.
  - **What it shows:** that workspace's totals only, read through its own handle, with the organisation and
    workspace names. Nothing is cached by shared caches.
  - **Refusals:** no link, a wrong, revoked or expired one, or a suspended organisation's all get the same 404.
  - **Gone:** the public `/executive` (Omnicontact's totals, with no link). Send leadership a link instead.
- **GitHub:** each workspace connects with its own secret, and a secret already used by another workspace is
  refused (409). The others are decrypted only to compare. A delivery is handled by the workspace whose secret
  signed it, so a key that exists in two organisations (SAME-1) is linked only in the signer's.
- **Digests and the Monday Briefing** are per workspace, titled with its name ("Monday Briefing for HR: …"). The
  briefing's extra email list is an organisation setting, so those addresses get one briefing per workspace.
- **Pulse never tells an organisation it is someone else's:**
  - **Ask Pulse and the digest openings:** their instructions are neutral, and each snapshot begins with
    `ORGANISATION: … · WORKSPACE: …`.
  - **Visible wording:** email footers, the app's install description, the Excel report header (the workspace), the
    printed report cover (the organisation), the service desk portal heading (the organisation) and the forced
    password change message name the organisation or nothing.
  - **Not changed:** the Omni Contact logos (sidebar, sign-in page, reports, executive page) are Pulse's own
    branding as a product. Branding each organisation (white-labelling) would be a separate decision.
- **API tokens** can't use executive links or organisation administration, as for view-only links.

## Administrator module, phase 1: roles, and organisation and workspace administration (2026-11-26)

The plan, and the 13 recommendations approved with "continue", are in `docs/admin-module-plan.md`.

- **Roles stay the six keys, plus a read-only Viewer (`reader`, migration 0017):**
  - The six keys are what existing data and permissions use. The Administrator role in a workspace is the brief's
    "Workspace Admin".
  - **Viewer** has no permissions, whatever Roles & permissions says. The Worker refuses its every request other
    than GET (`403 read_only`), except:
    - their own account
    - notifications
    - chat
    - searching and Ask Pulse (reads sent as POST)
  - The check comes before any route, so a route that forgets a permission check still can't be used.
  - Viewers, like Standard users, can't be assigned work.
  - The brief's granular names map to the existing permission keys:
    - `workflow.edit` → `manage_workflows`
    - `automation.create` → `manage_automation`
    - `user.invite` → Organisation Administrator
    - fields → `manage_schemes`
  - New keys come with the phases that need them.
- **One admin console, in the Settings menu:**
  - **Organisation:** Profile, Workspaces, Members & roles, Roles & permissions, Audit log.
  - **This workspace:** Workflows, Fields, Automations, Users, Audit log, Activity log.
  - **Settings:** the rest.
  - Not a second menu beside Settings. Templates joins "This workspace" in phase 2.
- **Organisation profile:**
  - Logo (PNG, JPEG or WebP under 100 KB, never SVG), colour, time zone, working days and hours, and contact email.
  - The app's role may update only those columns (a column grant and an UPDATE policy). Name, code and status stay
    with the Platform Administrators.
  - The logo and colour show **only after sign-in**: in the sidebar, served from `/api/org/logo` to the
    organisation's own people. The sign-in page stays plain, so it never reveals which organisations exist.
  - The time zone is stored now and used by schedules from phase 3. Until then, Harare time is used as before.
- **Workspaces:**
  - Icon (from a fixed list), colour, description, and visibility: members only, or the whole organisation.
  - Opening an organisation-wide workspace makes you its **Viewer** (a membership the administrators see and can
    change), never more.
  - "Start from a copy of …" copies the workflow choice, custom fields with their options, automation rules
    (**switched off**, to be checked) and workload limits. It copies no projects, items or history.
- **People:**
  - **Invite by email:** the account plus a one-time "choose your password" link (the password reset mechanism),
    valid 72 hours. It is emailed when email is set up. Otherwise the administrator gets the link once, like a
    temporary password.
  - **CSV import:** checks every row first and invites nobody if any row is wrong.
  - **Deactivate:**
    - It keeps the account, memberships and history.
    - It ends sessions and makes reset links and API tokens stop working.
    - Sign-in treats it like an unknown username: same message, same work.
  - **Remove** stays as it was. There must always be one *active* Organisation Administrator.
- **Audit log (`audit_log`):**
  - Every administration change, with who, when, from which address, and the values before and after (only what
    changed; a new logo is recorded as "replaced", not the image).
  - Each entry is saved in the same transaction as its change.
  - **Append-only:** the app's role may only insert and read, and a trigger refuses UPDATE, DELETE and TRUNCATE even
    to the owner.
  - The one exception is deleting the whole organisation.
  - Organisation Administrators see all of it. People with `audit_log` in a workspace see that workspace's entries.
  - The older activity log stays for everything else.
- **Deleting an organisation (changes "nothing is deleted"):**
  - Only an archived organisation, after its code is typed, and only **30 days later**, by the hourly job.
  - Until then it can be called off, and reactivating or suspending it calls it off too.
  - `tenancy_purge_organization` removes every row carrying its `organization_id` in one transaction, or nothing.
  - A record stays in `platform_activity`.
- **Toasts and a confirmation dialog** (`components/AdminKit.jsx`):
  - The dialog is a native `<dialog>`, which keeps focus inside and closes on Esc.
  - Cancel is focused first.
  - Destructive actions say what happens. Removing a person or deleting an organisation needs the name or code
    typed.

## Administrator module, phase 2: workflows per workspace, item types, versions and templates (2026-11-26)

- **Workflows belong to a workspace (migration 0018):**
  - The organisation's existing workflows became its **templates**.
  - Every workspace got its own copy of each workflow it used, and its projects and its setting point at the copies.
    A new workspace gets a copy of the organisation's default (a database trigger, however the workspace is made).
  - **Isolation, in the database:**
    - Row-level security lets a workspace read its own workflows and the templates, and change only its own.
    - The organisation's handle (its administrators) changes the templates.
    - A trigger refuses any workspace, project or item type pointing at another workspace's workflow, even through
      the owner.
  - Statuses stay the organisation's one list, so the categories (To Do, In Progress, Done) line reports up across
    workspaces. Any workspace may add a status. One that another workspace's workflow uses is renamed or
    recategorised only by an Organisation Administrator, and isn't deleted.
- **Item types per workspace:**
  - Each type (Campaign, Leave Request …) is one of the five built-in **kinds**, which decides where it sits in the
    hierarchy and how boards, sprints, the timeline and PQL treat it.
  - `work_items.type` stays the kind, and `work_items.item_type` names the type. A trigger keeps them in step.
  - So none of the code built on the five kinds (about 70 places) changed, and a Campaign works like an Epic
    everywhere.
  - The built-in five can be renamed or switched off, never deleted. A type of the workspace's own is deleted only
    when no item uses it.
- **A workflow per item type:** an item follows its type's workflow, else its project's, else the workspace's.
  Changing any of these moves the affected items' statuses only where the new workflow lacks them, and asks where
  first (as before).
- **Draft, publish, versions:**
  - A workflow is edited as a draft (kept on the server, so work isn't lost) and published.
  - Each publish is kept as a version; the first also keeps how it was before, as version 1.
  - **Restore** publishes an old version again as a new one, so history is never rewritten. The app's role can't
    update versions.
  - Items don't carry a version: after a publish, all of them follow the current one, and the status moves are
    asked for at publish time. Plain `PUT /api/workflows/:id` still publishes straight away, for scripts.
- **The canvas:**
  - React Flow 12.3.6 (`@xyflow/react`, MIT, pinned), loaded only on the Workflows page as its own chunk.
  - Dragging between statuses adds a move, and Delete removes one.
  - The table below lists the same moves with their rules, and is the accessible way to edit. The diagram is also
    described for screen readers.
  - Box positions aren't saved; boxes are laid out in workflow order.
- **Rules:** a "Clear a field" post-function is new. Conditions, validators, approvals-by-comment, assigning, the
  resolution and notifying were already there.
  - **No attachment validator:** Pulse has no attachments on work items yet.
  - **Approvals** (named approvers, N of M) are phase 4.
- **Custom fields:**
  - New kinds: long text, money (with a currency), checkbox and link.
  - Links are only `http(s)://`, so they can't run script when clicked.
  - A **default value** applies on create, when the field is left out. Required fields are still checked only when
    the form or API sends custom fields, as before, so automation and older clients aren't refused.
  - A field can be **for some item types**: the others neither show it nor accept it.
  - **No file field:** it waits for attachment storage. The Marketing template's "Asset files" is a link to the
    folder.
- **Workspace blueprints (`worker/blueprints.js`):** a workspace's set-up without its work (statuses, workflows, item
  types, fields; automation rules for copies only). One mechanism serves three uses:
  - **Built-in templates** (`src/data/workspaceTemplates.js`): Software Development, Marketing, HR and Projects,
    with the brief's statuses, types and fields.
  - **The organisation's own templates**, saved from a workspace without its automation rules, which name its
    people.
  - **Copying a workspace** (phase 1's copy now makes the workflow the new workspace's own).
  - Applying one is a single transaction, through the new workspace's own handle, and only for a workspace with no
    projects. If it fails, the half-made workspace is removed.
  - Statuses are matched to the organisation's by name, or added.
  - **Not built in:** sprints are already a per-project choice (Agile mode), and the Marketing "content calendar" is
    the existing Timeline.

## Administrator module, phase 3: the automation engine (2026-11-26)

- **Built on the existing engine**, not beside it. Rules still act as "Automation: <name>" through the same code
  people use, so workflow rules, history, the activity log and alerts apply.
- **Triggers:** added "assigned", "due date near" (N hours), "due date passed", schedules, an incoming webhook, and a
  manual button.
  - Schedules run every day, working day, week or month at a time, **in the organisation's time zone** (phase 1's
    profile). Older hourly schedules read as the same schedule.
  - SLA and approval triggers come with phase 4.
- **Conditions:** AND/OR groups (up to 3 levels, 25 conditions) built from dropdowns, evaluated in
  `src/data/automation.js`.
  - It's shared with the screens and unit-tested.
  - Choices compare by label, so a preset's "Severity is Critical" works in any workspace with such a field.
  - PQL stays as an advanced extra condition.
- **Actions:**
  - **New:** add a label, clear a field, create an item, email, WhatsApp/SMS, a signed webhook, escalate.
  - **Assignment:** round-robin (a cursor on the rule) or least loaded (fewest open items) between a role or named
    people.
  - **Due dates:** "+2wd" counts the organisation's working days.
  - **Once per run:** in bulk runs (schedules, sprints, webhooks without an item), "create an item" and "call a
    webhook" happen once, not once per matching item. That's how a weekly task is made once a week.
- **Creating items in another workspace:**
  - It goes through that workspace's own handle, never the owner's, so row-level security still holds.
  - It's allowed only if the rule's owner is a member there whose role may create work items. This is checked when
    saving and again when running.
  - Items in two workspaces can't be linked (links are per workspace), so each gets a comment naming the other.
- **Smart values:** `{{item.key}}`, `{{item.title}}`, `{{workspace.name}}`, `{{trigger.user.name}}` … (the older
  `{key}` style still works).
  - Values are escaped for HTML in emails and for JSON in webhook payloads, so an item's title can't inject markup
    or break the JSON.
  - Events now carry who caused them (`by`), for `{{trigger.user.name}}`.
- **Secrets:**
  - A webhook action's signing secret is made on save, sealed with `MFA_KEY` and shown once.
  - Calls carry `X-Pulse-Signature: sha256=<HMAC>`, and only `https://` addresses are allowed.
  - A webhook trigger's address is a random secret, kept as a hash and shown once. Wrong or switched-off addresses
    get the same 404.
  - Secrets are never sent to the browser again.
- **WhatsApp/SMS:** a provider interface (`worker/messaging.js`) with no provider yet. The run log records what
  would have been sent; connecting one means implementing `providerFor` with keys in Worker secrets.
- **A job ledger in Postgres (`automation_jobs`), not Cloudflare Queues** (decision 9: no new paid service):
  - Each run is a job with an idempotency key, run straight away.
  - A failure **before anything changed** is retried after 1, 2, 4 and 8 minutes by the cron. A failure after a
    change isn't retried, since doing it again could do it twice.
  - After 5 tries the job is failed, and the owner is told once a day.
  - Time-based triggers record each occasion in `automation_fired`, so they fire once per item and due date, or once
    per schedule day.
- **The cron runs every 5 minutes** (still one trigger, within the free plan):
  - automation every run
  - digests, the Monday Briefing, subscriptions and organisation deletion in the first run of the hour, as before
- **Loop protection:**
  - a depth of 5 (was 3)
  - 10 runs an hour of a rule on one item
  - the rule's runs a minute
  - 600 runs a minute across the organisation
- **The test run** goes through the same action code in a "dry" mode that changes nothing and says what it would
  do. The run log keeps each condition's result and each action's outcome.
- **Organisation rules:**
  - Copies, one per workspace, sharing an id, made through each workspace's own handle. The alternative, rules
    without a workspace, would have meant loosening row-level security on rules.
  - Only Organisation Administrators change or delete them, and that changes every copy.
  - A new workspace gets the organisation-wide ones.
- **Presets** (the brief's seven) are added switched off, matched to the workspace by status, type and field names,
  with a list of what didn't match.
  - The Marketing "Approved → Scheduled" preset needs a status called Approved, which the Marketing template doesn't
    have (its approval step is "Client/Manager Approval"). It says so when added.

## Administrator module, phase 4: SLAs, approvals, webhook payloads and the demo organisation (2026-11-27)

- **Work item SLAs:**
  - **Their own calendar** (`src/data/workCalendar.js`): the organisation's time zone, working days and hours (phase
    1's profile) and its public holidays, daylight saving included. The service desk keeps its own Harare 08:00–17:00
    clock; changing it was out of scope and would move its existing targets.
  - **Policies** are per workspace, for some item types and priorities or all. The first matching active one
    applies.
  - **First response** is the first comment or status change by someone other than the reporter. **Resolution** is
    reaching a Done status. Being on hold doesn't pause the clock (the service desk's "waiting for customer" pause
    is a request feature).
  - **States are worked out when asked**, not stored: running, at risk (past the warning share), breached, met,
    missed.
  - **The cron** looks at up to 500 open items per workspace every 5 minutes and records each warning and breach
    once (`item_sla_events`), so people are told once.
- **Approvals:**
  - **A rule** ("Approval is needed", a validator) on a move. Its value is JSON: a person, a role, or N of a list.
  - **A move with it doesn't happen.** It becomes a pending approval stored with what the person sent (comment,
    fields), and the item waits: other moves are refused until it's decided or cancelled. This is the brief's
    "Pending approval state", without adding a status to every workflow.
  - **The person asking never approves their own move.** Approvers are resolved when asked (active members of the
    workspace).
  - **Deciding:** a rejection needs a reason, ends it, and is added as a comment. Enough approvals make the move
    through the normal move code, skipping only the checks that were done when it was asked. If the move is no
    longer possible (the workflow changed), the approval is cancelled and says why.
  - **Who sees it:** to anyone but its approvers, an approval is a 404, like everything else that isn't theirs.
  - **Votes can't be changed:** the app's role can't update or delete them.
  - Approval and SLA events are automation triggers.
- **Outgoing webhooks** can carry their own JSON with smart values, escaped for JSON and still signed. Incoming
  webhooks and webhook actions were phase 3.
- **The demo organisation** (`scripts/demo-org.mjs`, `npm run demo:org -- dev`):
  - **Demo Co:** Development from the Software template and Marketing from the Marketing template, six people
    (including a read-only Viewer), projects and work.
  - **Rules:** the preset rules (switched on where they matched), an SLA for urgent bugs, and an approval step out of
    Client/Manager Approval.
  - **It's built through the real Worker,** so it is also an end-to-end check (`tests/demoOrg.test.js` runs it on
    PGlite).
  - **The live database** needs `--live`.
  - It runs through `vite-node`, because the Worker's imports leave off file extensions, as the bundler allows.

## Project Management System (PMS), and branding per organisation (2026-11-27)

- **The name lives in one place:** `src/data/brand.js` (`BRAND`). Renaming the product again is a change to that
  file; `index.html` gets it at build time. "Ask Pulse" is **Ask AI**, a name that reads well under any
  organisation's brand and survives another rename.
- **The branding rules:**
  - **The platform is neutral.** Before an organisation is chosen (the platform page, `/platform`, the loading
    splash) nothing carries any organisation's name, logo or colour. The platform's own identity is the PMS
    wordmark and its graphite and steel tokens; it never uses an image logo.
  - **An organisation brands its own space, and only that:** its sign-in page, the app once signed in, its emails,
    exports, view-only links, executive page and customer portal. "Powered by Project Management System" stays in
    small print.
  - **Status colours never change with the brand.** Success, warning, danger, info, the status pills and the chart
    palette are fixed. The accent sets three variables (`--accent-solid`, `--accent-light`, `--accent-dark`), which
    the older names (`--navy`, `--cyan`…) follow. The sidebar is neutral graphite unless the organisation sets its
    own sidebar and highlight colours (added 2026-11-27, migration 0023; Omnicontact's are its Penn blue and sky
    blue from before the rename). Those are made safe the same way: the sidebar darkened until its text reaches
    AA, the highlight lightened to 3:1 and its ink to AA.
- **Showing an organisation before sign-in** reverses the admin module's phase 1 decision ("the sign-in page stays
  plain"):
  - A public lookup by code (`GET /api/public/org/:code/branding`) tells a visitor whether a code exists. This was
    accepted for State B, with these limits:
    - codes are never listed or searched
    - unknown, suspended, archived and template organisations get one identical 404 (and the sign-in page one
      message)
    - the reply carries only the name, accent, shades, tint and image addresses
    - lookups are limited per address: 30 codes that lead nowhere in 10 minutes, then every lookup is refused
      (counted in `login_failures` as `org_code`, kept out of sign-in's own address limits). Cloudflare's
      rate-limit binding was the first plan, but live it counts per location and didn't refuse 160 quick
      lookups, so it is only a first line.
  - Sign-in itself is unchanged: one generic message, the dummy-hash check, nothing about usernames.
- **Workspaces are chosen after sign-in, never on the sign-in page:** listing an organisation's workspaces to anyone
  with its code would reveal more than its name, logo and colour.
- **Unsafe accents are adjusted, not refused:** for each theme, the colour itself if it reaches WCAG AA (4.5:1 as
  text on that theme's surfaces, and with white or dark text on it), else the nearest shade of the same hue that
  does. Buttons use a shade that always carries white text. The settings page shows the shades it will use. The
  administrator's colour is kept as chosen; the shades are worked out when read.
- **Logos:**
  - PNG, WebP or JPEG only; **SVG is refused**, so no sanitiser to get wrong.
  - The browser resizes and re-encodes each image (which also strips what's hidden in the file).
  - The Worker checks the real type from the bytes, the size (≤ 200 KB) and the dimensions (a logo fits 480 × 160,
    the icon 256 × 256).
  - Stored in Postgres (`organization_branding`, one row per organisation, row-level security); no R2 is bound.
  - Served publicly with the version in the address, cached for a year, `nosniff`.
- **No logo, no problem:** a monogram of up to two initials in the accent stands in everywhere (sign-in page,
  sidebar, favicon, emails), so no organisation looks broken.
- **Omnicontact's logos are data now:** they moved from the app's public files into Omnicontact's branding row
  (migration 0021). A test fails if anything else refers to them, or if the product names Omni Contact as itself.
  Omnicontact's accent is its indigo `#2c3280`; its signature red isn't used, since red stays the danger colour.
- **Internal names are kept for now** (`docs/rename-list.md` lists them, with the risk of renaming each):
  - the `omni-tracker` Worker (its MFA_KEY can't move)
  - the `pulse.` address
  - the cookies, the `pulse_` token prefix and the `X-Pulse-Signature` header
  - the database role and the browser storage keys

## The platform landing page (2026-11-27)

- **Neutral:** no logo (the PMS wordmark is type), no organisation's name, logo or colour, and nothing that lists
  or searches organisations. A test checks this (`tests/noOrgBranding.test.js`).
- **No claims:** no user counts, testimonials, "trusted by" strips or customer data. The illustrations are
  placeholders: grey bars, a board, a timeline.
- **The name comes from `src/data/brand.js`,** like everywhere else.
- **Motion respects reduced motion:**
  - **What may move:** only transform and opacity animate.
  - **With reduced motion** (the system setting or the account's): a still composition, the turning word stopped
    and nothing looping.
  - **Pausing:** animations pause while the tab is hidden, and the art pauses off screen.
- **Calm over spectacle:** of three directions ("Glass and Kanban", "Command centre", "Clean timeline"), the calm one
  was chosen. There is one wide timeline behind the page and one small loop (the board); there is no parallax,
  cursor spotlight or colour mesh.
- **The behaviour is the sign-in page's,** unchanged. Choosing an organisation is the one designed moment: its colour
  floods in and the card becomes its sign-in page.
- **Fast first paint:**
  - **Only what the page needs loads first:** the signed-in app, the platform, executive and portal pages load on
    demand.
  - **Fonts don't block,** and a metric-matched fallback keeps the layout still.
  - **The landing page's own budget:** about 25 KB gzipped of script and styles; it is 5.3 KB.
- **The theme toggle** follows the device until someone chooses, and the choice is remembered on that device only.
  Signing in applies the account's own theme.

## Themes from the logo (2026-11-27)

- **Only a ThemeSpec is ever stored or sent** (`src/data/logoTheme.js` `cleanThemeSpec`): `v`, `primary` and
  `secondary` as OKLCH numbers, `variation`, `vibrancy`, `radius`, `font` (from a fixed list of system stacks: no
  downloads), `source` and `askAdmin`. The Worker cleans it before storing and again whenever it is read. The CSS is
  built in the browser by `themeCss`, which writes only the variables in `THEME_VARIABLES` with values it made itself.
  Never store CSS, never accept colours as strings into the style sheet.
- **Status colours are never generated** (success, warning, danger, info, the status pills).
- **Buttons always carry white text** (the app's rule), in light and dark: the button fill is darkened until white
  passes, never given dark text.
- **A published theme replaces the accent and sidebar colours**; without one the organisation keeps them. Turning a
  theme off archives it; nothing is deleted (the app's role has no DELETE on `organization_themes`).
- **Versions are never rewritten:** publishing the draft keeps its number; rolling back publishes a copy of the old
  version as a new one.
- **A new logo never silently changes a live theme:** it publishes only for an organisation that has never had one;
  otherwise it is a draft and the administrators are told.
- **The logo is read in the administrator's browser** (only the organisation's own uploaded logo). The server never
  decodes images.

## Project lifecycles (2026-11-27)

- **Templates are data,** per organisation (optionally per workspace), validated by `src/data/lifecycle.js`
  `cleanTemplate`, versioned like workflows: a draft is published as a version, and **a project stays on the version it
  started with**. Only Organisation Administrators change templates (row-level security: only the organisation's
  handle writes them). The stages of a published version are repeated as rows (`lifecycle_stages`) for reports.
- **The rules are one module, shared:** the server enforces the gates (`evaluateGate`); the screen shows exactly the
  server's "missing" list. Never check a gate only in the browser.
- **Moves:** advance (the gate met; lead, Manager, Administrator or the stage's owner), send back (only to stages the
  template names, with a reason), skip (only where allowed, requested with a justification, approved by a Manager or
  Administrator who didn't ask). Every move is a `project_stage_history` row the app can't change or delete, and an
  activity log entry.
- **Sign-offs:** named people or roles, each with an optional alternate. **Segregation of duties** (the default): whoever
  uploaded the version being signed can't sign it; their alternate does. A named signatory who isn't an active member
  is replaced by their alternate. A decision is made once (a trigger refuses changes). A decline needs a comment and
  goes to the stage the template names. PCN Sign Off reuses the Concept Note's own signatories, not a copy.
- **Locked documents:** the approved version of a stage's deliverable is locked; closing locks them all. A trigger
  refuses changing or deleting a locked document; a project with locked documents can't be deleted.
- **The project's Status follows its stage** (draft → Idea, sign-offs and assessments → Upcoming, work → In progress,
  testing → Testing, deployment and closure → To deploy; closed → Live). Progress follows the stage weights unless the
  project takes its progress from work items.
- **Time is business time** on the organisation's calendar (`workCalendar.js`). The 5-minute cron warns at 80% of a
  stage's target, escalates once when it's overdue, and reminds pending signatories every N business days.
- **Reused, not rebuilt:** work items for checklist tasks and bugs from failed tests; the service desk Change request at
  Deployment (approved through Change Approval); notifications; automation (trigger `stage_changed`); Ask PMS.
- **The stage mapping** of existing projects is the SQL function `lifecycle_map_projects`, tested against
  `mapExistingProject` so the two never disagree. A project the rules can't place is left without a lifecycle and
  reported, never guessed. Earlier stages are recorded as migrated; their gates aren't required after the fact.
- **Omnicontact's named signatories** (Waraidzo, Mutsa, with alternates) are proposed, pending its approval; they are
  template data, changed in Settings → Project Lifecycle.
