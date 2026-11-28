# Pulse upgrade log

What each phase of the upgrade built. Read this, and DECISIONS.md, before starting a phase.

## Database move: D1 → Postgres on Neon (before Phase 0)

**Why:** the owner asked for Pulse's database to be Postgres before the upgrade phases start.

**What was built**
- `worker/pg.ts`: gives Postgres D1's API, so the Worker's ~240 queries kept their shape. `withDatabase()` in
  `worker/index.ts` picks Postgres (Hyperdrive) or the old D1 database from the `DATABASE` variable.
- SQL changed for Postgres:
  - sign-in matches usernames with `lower(username) = lower(?)`
  - `INSERT OR IGNORE` became `ON CONFLICT DO NOTHING` (assignments, notifications, demo data)
  - the activity-log search uses `ILIKE`
- `scripts/db.mjs`:
  - `migrate`, `status` and `exec` for the Neon branches
  - `copy`, which loads a D1 export into empty Postgres tables, keeps row order and serial numbers, and checks every table's row count
- `scripts/dev-api.mjs`: `npm run dev:api` runs locally against the Neon `dev` branch.
- `wrangler.jsonc`:
  - adds the `nodejs_compat` flag, which the driver needs
  - adds the `HYPERDRIVE` binding and the `DATABASE` variable
  - renames the D1 binding to `D1`
- New dependency: `postgres` 3.4.5.

**Migrations:** `migrations/0001_postgres_baseline.sql`, the whole schema: 19 tables and their indexes. The D1
migrations 0001–0020 moved to `migrations-d1/`.

**Neon and Cloudflare setup:**
- Neon project `wild-sunset-31993352`, Singapore, Postgres 18; `production` branch is live, `dev` is for local testing.
- Hyperdrive config `pulse-db` (`477f668798e640ce9af8d41f9cef1042`) points at `production`, with caching off.
- Smart Placement is on.

**New permissions, endpoints, screens:** none. Nothing changes for people using Pulse.

**Tested (local Worker → Neon `dev`, loaded with a copy of the local D1 data):**
- Postman collection: every failure also happens on D1. The QA "create user" test uses a password that the
  12-character policy now refuses, so the tests after it fail too (17 checks). The only Postgres-only failures were
  local connection timeouts to Singapore. Each of those requests passed when repeated.
- End-to-end script, 32 of 32 passed:
  - sign-in, including usernames typed in different capitals
  - two-step codes, including one-time use and recovery codes
  - adding a passkey and signing in with it
  - view-only links: read-only, no contact details, revoking works
  - `/executive`
  - feature requests and developer visibility
  - the activity log and its search, ignoring capitals
  - daily digests, the Monday Briefing, notifications and Ask Pulse
- Concept Notes: developers see only their own.

## Phase 0: sign-in lockout

**What was built**
- Too many wrong passwords on one account within 15 minutes (default 5) locks it for 15 minutes. Too many failed
  sign-ins from one internet address (default 20 in 15 minutes) refuses that address. Wrong two-step codes count too.
- A locked account, a refused address, an unknown username and a wrong password all get the same message.
- The counters are in Postgres, so the limits hold across every copy of the Worker.
- Each lock is in the activity log, and everyone who can manage users gets a bell alert.
- Settings → People shows a **Locked accounts** card and a red "Locked" flag, each with an **Unlock** button.
- New page **Settings → Administration → Sign-in security** for the attempt limit, the lock length and the
  per-address limit. The built-in admin account can be locked, but always unlocks itself within 15 minutes.
- Retention: failed sign-in counters are removed after 24 hours (`SIGNIN_FAILURE_HOURS`).
- Ask Pulse: people who manage users can ask who is locked out.
- Demo data: a locked demo account and a few failed attempts (`demo-lf-*`).
- Postman: 20 new requests for the rules, the lock, the same-message rule and unlocking. The "Admin creates a user"
  fixture password no longer contains the username, so the checks after it pass again.

**Migrations:** `migrations/0002_signin_lockout.sql`: the `login_failures` table with indexes on
(user_id, at), (ip, at) and (at); `users.locked_until` (BIGINT ms) and `users.locked_at`. The same change for the
D1 fallback is `migrations-d1/0021_signin_lockout.sql`.

**New permissions:** none. Unlocking and the sign-in rules use `manage_users`. By default only Admin has it;
Manager, Team Leader, Projects Assistant, Developer and Standard user don't, unless Settings → Roles & permissions
gives it to them.

**New endpoints**
- `PUT /api/settings/signin` with `{ attempts, lockMinutes, ipAttempts }` (needs `manage_users`). Values are kept within bounds.
- `POST /api/users/:id/unlock` (needs `manage_users`): 400 if the account isn't locked, 404 if there's no such user.
- `GET /api/data` now sends `signinRules`, and `lockedUntil`/`lockedAt` on users, to people who can manage users only.

**New screens:** Settings → Administration → Sign-in security; the Locked accounts card in Settings → People.

## Phase 1: work items, keys, hierarchy, collaboration

**What was built**
- **Project keys:** every project has a key of 2 to 10 capital letters. New projects get a suggested key from
  their name, which can be changed until the project's first work item exists.
- **Work items numbered per project,** such as INFRA-1. Types: Epic, Story, Task, Bug and Sub-task, in the
  hierarchy Epic → Story/Task/Bug → Sub-task, checked on the server.
- **Fields:**
  - summary, Markdown description, type, status and resolution, on hold
  - priority (Highest to Lowest), assignee, reporter, labels, component, story points
  - original and remaining estimate, start and due dates
  - created, updated and resolved dates
- **Statuses** To Do, In Progress, In Review and Done, each in a category.
- **Progress roll-up:** epics show how much of their work is done. A project can take its progress from its
  work items.
- **Feature requests are now work items** (source "client request"), with nothing lost. The Feature requests page,
  its pop-up and /api/features work as before, and each request shows its work item key.
- **Status history** for every status change. For the existing requests it was rebuilt from the activity log.
- **Collaboration on every work item:**
  - Markdown comments, with @mentions that alert the person mentioned if they can see the item; you can edit and
    delete your own comments
  - watchers, who are alerted to changes
  - links: blocks, relates to, duplicates and clones
  - cloning
  - attachments of up to 10 MB
  - time tracking: logged, remaining and original estimate
- **Screens:**
  - a **Work items** tab on each project, with filters (open or done, My work, type, status, priority, assignee,
    label and search), sorting, 50 items at a time, and quick create
  - each work item's page, at `#/projects/<id>/items/<KEY-n>`
  - **My work** on the Dashboard: your items, either open, due this week, overdue or done
  - a Key field when adding a project
- **Activity log:** every work item change is recorded with before and after values, and there's a new "Work items"
  filter.
- **Ask Pulse** knows the work items each person may see.
- **Retention:** work items and everything on them last for the life of the project.
- **Demo data:** the demo projects get keys; the demo requests are work items; projects being built have epics,
  stories, tasks, bugs and sub-tasks, with comments, links and logged time; and one project takes its progress
  from its work items.
- **Postman:** 46 new requests.

**Migration:** `migrations/0003_work_items.sql`.
- New tables, each with indexes for its queries:
  - `work_statuses`
  - `work_items`
  - `work_item_labels`
  - `status_history`
  - `work_item_comments`
  - `work_item_watchers`
  - `work_item_links`
  - `work_logs`
- New columns: `systems.key`, `systems.item_seq`, `systems.progress_from_items` and `documents.work_item_id`.
- Moves `features` into `work_items` and replaces the table with a `features` view.
- Adds the new permissions to roles already saved in Settings.

**New permissions and their defaults**

| Permission | Admin | Manager | Team Leader | Projects Assistant | Developer | Standard user |
| --- | --- | --- | --- | --- | --- | --- |
| Create work items (`create_work_items`) | yes | yes | yes | yes | yes | no |
| Edit and assign any work item (`edit_work_items`) | yes | yes | yes | no | no | no |
| Delete work items (`delete_work_items`) | yes | yes | yes | no | no | no |
| Log time on work items (`log_time`) | yes | yes | yes | no | yes | no |

Developers also edit the items assigned to them, and the ones they reported.

**New endpoints** (all at `/api/items`; GET /api/data doesn't carry work items)
- `GET /api/items` lists one page at a time. Filters: `system`, `type`, `status`, `priority`, `assignee` (`me`/`none`/id),
  `reporter`, `label`, `component`, `source`, `parent`, `state` (open/done), `due` (overdue/week) and `q`. Sorting:
  `sort` and `dir`. Paging: `limit` and `offset`.
- `POST /api/items` creates an item.
- `GET`, `PATCH` and `DELETE /api/items/:key` read, change and delete one.
- `POST /api/items/:key/clone` clones it.
- `GET` and `POST /api/items/:key/comments` list and add comments; `PATCH` and `DELETE .../comments/:id` edit and
  delete your own.
- `POST` and `DELETE /api/items/:key/watch` start and stop watching.
- `POST /api/items/:key/links` and `DELETE .../links/:id` add and remove links.
- `POST /api/items/:key/attachments` (multipart) and `DELETE .../attachments/:id` add and remove attachments.
- `POST /api/items/:key/worklogs` and `DELETE .../worklogs/:id` log and remove time.
- `PATCH /api/systems/:id` now also takes `key` and `progressFromItems`.

## Phase 2: configurable workflows and Kanban boards

**What was built**
- **Workflows:**
  - statuses, each in a category
  - the moves allowed between them
  - conditions (roles, assignee only, reporter only)
  - validators (a comment, an assignee, a field filled in, all sub-tasks done)
  - post-functions (assign to a person, a role or the reporter; clear the assignee; set the resolution; notify)

  Each workspace is given a workflow, and a project can use its own. Every rule is enforced on the server.
- **Two seeded workflows:**
  - **Default:** To Do → In Progress → In Review → Done, and back to To Do from anywhere. Every existing work item is
    already in it.
  - **Infrastructure deployment:** Backlog → In Progress → Testing → Change Approval → Deployed → Closed. Only a
    Manager may deploy, and deploying needs a comment.
- **Settings → Administration → Workflows:**
  - which workflow each workspace and project uses
  - each workflow's statuses (order, where items start, usage counts) and moves with their rules
  - a simple diagram of the workflow
  - the shared status list

  Whenever a change would strand work items, it asks where they should go.
- **Moving items:**
  - The item page's Status shows "Move to…", listing this workflow's moves; ones you can't make are greyed out with
    the reason.
  - A move that needs something opens a small pop-up.
  - Feature requests change status through the same moves.
- **Boards:** one per project (a new **Board** tab) and one per workspace (the new **Boards** page in the sidebar).
  - Columns each show one or more statuses, and can have a WIP limit; a column over its limit turns amber with its
    count.
  - Dragging a card makes the move, asking for a comment or field when needed; if the move isn't allowed, the card
    stays put with a message. Every card also has a "Move…" list for the keyboard and screen readers.
  - Swimlanes: none, assignee, epic or priority.
  - Quick filters: Only my items, Bugs, Due this week, Blocked and a label.
  - Cards show the key, summary, type, priority, assignee, story points, due date, epic and a blocked flag.
  - On a phone, the columns stack into one.
- **WIP limits** are listed beside the developer workload limits in Settings → Workload limits.
- **Ask Pulse** knows each item's status by name, and the boards' WIP limits (for people who see every item).
- **Activity log:** a "Workflows & boards" filter; status changes read by name, with the move that made them.
- **Demo data:** "Fleet & Transport Booking" uses the Infrastructure deployment workflow, with items in each of its
  statuses. "WhatsApp Customer Channel" has a board with WIP limits and swimlanes by epic.
- **Postman:** 32 new requests.

**Migration:** `migrations/0004_workflows_boards.sql`.
- New tables:
  - `workflows`
  - `workflow_statuses`
  - `workflow_transitions`
  - `workflow_rules`
  - `workspace_workflows`
  - `boards`
  - `board_columns`
  - `board_column_statuses`
- New column: `systems.workflow_id`.
- Five new statuses: Backlog, Testing, Change Approval, Deployed, Closed.
- Seeds both workflows.
- Rebuilds the `features` view, so "Testing" is any in-progress status named for review, testing or approval.

**New permission and its defaults**

| Permission | Admin | Manager | Team Leader | Projects Assistant | Developer | Standard user |
| --- | --- | --- | --- | --- | --- | --- |
| Edit workflows (`manage_workflows`) | yes | no | yes | no | no | no |

Board columns and WIP limits use the existing "Add, delete and edit systems".

**New endpoints**
- `GET /api/statuses` lists the shared statuses. `POST /api/statuses` adds one; `PATCH` and `DELETE
  /api/statuses/:id` edit and delete one (deleting takes `moveTo` when items use it).
- `GET /api/workflows` returns the workflows, statuses, assignments and usage. `POST /api/workflows` creates one
  (`copyFrom`). `PUT /api/workflows/:id` saves its statuses and moves (with `moves` when items need somewhere to go).
  `DELETE /api/workflows/:id` deletes one.
- `PUT /api/workflow-assignments` changes which workflow each workspace and project uses (with `moves` when needed).
- `GET /api/items/:key/transitions` lists the moves you may make. `POST /api/items/:key/transitions` takes
  `transitionId` or `to`, plus `comment` and `fields`. `PATCH /api/items/:key` with `status` makes the same move.
- `GET /api/boards?system=<id>` or `?workspace=<name>` returns a board, with the quick filters `mine`, `type`, `due`,
  `blocked` and `label`. `PUT /api/boards/:id` saves its name, swimlanes and columns. `GET /api/boards/wip` lists
  every board's WIP limits.

**New screens:**
- Settings → Administration → Workflows
- the project's Board tab (`#/projects/<id>/board`)
- the Boards page in the sidebar
- the move pop-up
- board columns
- WIP limits in Settings → Workload limits

## Phase 3: sprints, timeline and agile reports

**What was built**
- **Optional sprints:** a project can plan in sprints (Scrum) or stay Kanban.
  - **Backlog** tab: open sprints, then the backlog, ranked by dragging (or with Up and Down buttons for the
    keyboard). Story points are typed in place, with a total for the selected items.
  - **Sprint planning:** a sprint has a name, a goal, a start date and a length of 1 to 4 weeks. Items are dragged in
    (or moved with "Move to…"), with a capacity hint from past velocity.
  - **Starting a sprint** sets its commitment and alerts its assignees. The board then shows only that sprint.
  - **Completing a sprint** moves unfinished items to the backlog or the next sprint, and keeps a snapshot:
    committed, completed, added, removed and not completed.
  - Only one sprint runs per project at a time.
- **Timeline:** a **Timeline** tab on each project, and a Board / Timeline switch on the Boards page for workspaces.
  - Bars for epics, with their items underneath; at workspace level, the projects and their epics.
  - Drag a bar to move it, or its ends to change its start or due date. A date dialog does the same from the
    keyboard. Changes are permission-checked and logged.
  - Drag from a bar's dot onto another bar to say it blocks that one; a warning shows when the blocker ends after
    the blocked item starts.
  - A today line, zoom (weeks, months, quarters) and print / PDF.
- **Agile reports** on the Reports page, each with a "what to look for" note, a table of the figures, CSV export and
  print / PDF:
  - **Burndown:** work remaining in the sprint, against an ideal line.
  - **Burnup:** work completed against total scope.
  - **Velocity:** points committed and completed in the last 6 sprints.
  - **Sprint report:** completed, not completed, added mid-sprint and removed.
  - **Cumulative flow:** items in each status over time.
  - **Control chart:** cycle time per item, with a rolling average and outliers.
  - **Created vs resolved:** whether the backlog is growing.
  - **Lead and cycle time:** medians and the 85th percentile.

  They work for one project or a whole workspace, and developers see reports built from only their own items.
- **Sprint health** (days left, points done of the sprint's points) in the Monday Briefing and Ask Pulse.
- **Activity log:** a "Sprints" filter.
- **Demo data:** "WhatsApp Customer Channel" plans in sprints: six finished sprints with snapshots, a running one and
  a planned one.
- **Postman:** 34 new requests.

**Migration:** `migrations/0005_sprints.sql`.
- New tables: `sprints` (one active per project, by a unique index), `sprint_items` and `sprint_snapshots`.
- New columns: `systems.agile_mode`, `work_items.sprint_id` and `work_items.backlog_rank`.
- New indexes for the reports.

**New permission and its defaults**

| Permission | Admin | Manager | Team Leader | Projects Assistant | Developer | Standard user |
| --- | --- | --- | --- | --- | --- | --- |
| Plan and run sprints (`manage_sprints`) | yes | yes | yes | no | no | no |

**New endpoints**
- `GET /api/backlog?system=<id>` returns the sprints and the ranked backlog. `POST /api/backlog/rank` re-ranks items
  and moves them into or out of a sprint (`system`, `keys`, `target`, `before`).
- `POST /api/sprints` creates a sprint; `PATCH` and `DELETE /api/sprints/:id` edit and delete one. `POST
  /api/sprints/:id/start` starts it, and `POST /api/sprints/:id/complete` completes it (`moveTo`: `backlog`, `next`
  or a sprint id).
- `GET /api/timeline?system=<id>` or `?workspace=<name>` returns the timeline.
- `GET /api/reports/agile/sprints?system=`, `/burndown?sprint=`, `/sprint?sprint=`, `/flow?system=|workspace=&days=`
  and `/cycle?system=|workspace=&days=` return the report data.
- `PATCH /api/systems/:id` now also takes `agileMode`.

**New screens:**
- the project's Backlog and Timeline tabs
- the Boards page's Timeline
- the sprint form and the "Complete sprint" pop-up
- the date dialog
- Agile reports on the Reports page
- the "Plan in sprints" switch on the Work items tab

## Phase 4: PQL, saved filters, dashboards and automation

**What was built**
- **Search** in the sidebar, in two modes:
  - **Basic:** choose projects, types, statuses, priorities and an assignee, and type words. The query it makes is
    shown in PQL.
  - **PQL**, like Jira's JQL: `project = INFRA AND status != Done AND assignee = currentUser() ORDER BY priority`.
    - Suggestions appear as you type: fields, operators, functions and values (arrow keys, then Enter or Tab).
    - Mistakes get a "did you mean …?" with the wrong part highlighted.
  - **Ask in plain English:** Pulse writes the PQL for you to check.
  - **Results:** a table you sort by clicking a heading (which rewrites ORDER BY), "Show more", and CSV export of up
    to 1,000 items.
- **Saved filters:**
  - private, or shared with a role, a workspace or everyone
  - star favourites
  - **subscribe** to have the results sent daily or weekly at a chosen hour, under the bell and by email
- **Ask Pulse:** "Turn this into a search" under an answer shows the question as PQL, with "Open in Search" and
  "Save as filter".
- **Dashboards:**
  - The Dashboard page has a picker. "Pulse overview" is the existing dashboard and stays the default.
  - New dashboards are personal or shared, with one, two or three columns.
  - Each gadget reads a saved filter. The eight kinds are filter results, pie chart, created vs resolved, sprint
    health, workload, overdue, two-dimensional statistics and recent activity.
  - An editor adds, removes, moves and configures gadgets.
- **Automation:** Settings → Administration → Automation.
  - A rule is "when … if … then …":
    - **when:** a trigger, or a schedule
    - **if:** an optional PQL condition
    - **then:** up to 10 actions (move status, assign, set a field, comment, notify, create a sub-task, link)
  - Each rule has an on/off switch, "Run now" and a run log.
  - Loop protection: rules can set off other rules up to 3 levels deep, and each rule has a limit of runs a minute.
  - Three example rules come switched off.
- **One hourly cron** (`0 * * * *`) replaces the three. Each run does the subscriptions and scheduled rules, plus the
  daily digests (weekdays 07:00 Harare) and the Monday Briefing (08:00) when they're due. This keeps the account
  within the Workers Free limit of 5 cron triggers, which refused the first deploy.
- **Activity log:** "Filters & dashboards" and "Automation" filters, with readable descriptions.
- **Retention:** run logs are kept 90 days. When a person is removed, their favourites and subscriptions are
  removed too.
- **Demo data:** five saved filters (one with a favourite and a subscription) and a "Delivery (demo)" dashboard with
  all eight gadget kinds.
- **Postman:** 29 new requests. **Unit tests:** `npm test` runs 31 tests (Vitest: PQL and the cron timetable), and CI runs them before every
  deploy.

**Migration:** `migrations/0006_search_dashboards_automation.sql`.
- New tables:
  - `saved_filters`, `filter_favourites`, `filter_subscriptions`
  - `dashboards`, `dashboard_gadgets`
  - `automation_rules`, `automation_actions`, `automation_runs`
- It seeds the three example rules (off).
- If roles have saved permissions, it adds the new permissions' defaults to them.

**New permissions and their defaults**

| Permission | Admin | Manager | Team Leader | Projects Assistant | Developer | Standard user |
| --- | --- | --- | --- | --- | --- | --- |
| Share filters and dashboards (`share_searches`) | yes | yes | yes | yes | no | no |
| Manage automation rules (`manage_automation`) | yes | no | yes | no | no | no |

Everyone signed in can search and keep private filters and dashboards. View-only links can't use any of it.

**New endpoints**
- **Search**
  - `POST /api/search` (`pql`, `offset`, `limit` up to 100) returns `{ items, total, offset }`. A PQL mistake is a
    400 with `code: "pql"` and `start`/`end`.
  - `GET /api/search/fields` returns the fields, functions and known values.
- **Saved filters**
  - `GET /api/filters` lists them and `POST /api/filters` saves one. `PUT` and `DELETE /api/filters/:id` change and
    delete one.
  - `POST` and `DELETE /api/filters/:id/favourite` star and unstar one.
  - `POST /api/filters/:id/subscriptions` (`frequency`, `weekday`, `hour`) subscribes, and `DELETE
    /api/filters/:id/subscriptions/:sid` stops a subscription.
- **Dashboards**
  - `GET /api/dashboards` lists them and `POST /api/dashboards` saves one. `PUT` and `DELETE /api/dashboards/:id`
    change and delete one (with `gadgets`).
  - `GET /api/dashboards/:id/gadgets/:gid` returns one gadget's data, for the person viewing it.
- **Ask Pulse:** `POST /api/ask/pql` (`question`) returns `{ pql, error? }`.
- **Automation**
  - `GET /api/automation/rules` lists the rules and `POST /api/automation/rules` adds one. `PUT` and `DELETE
    /api/automation/rules/:id` change and delete one.
  - `GET /api/automation/rules/:id/runs` returns the run log.
  - `POST /api/automation/rules/:id/run` runs a rule now (`itemKey` for item rules).

**New screens:**
- Search, with its saved filters panel, the "Save filter" dialog and the subscriptions dialog
- the dashboard picker, custom dashboards and the dashboard editor
- Settings → Administration → Automation: the rule list, the rule editor and the run log
- "Turn this into a search" in Ask Pulse

## Phase 5: integrations, admin schemes and Service Desk lite

**What was built**
- **GitHub integration:**
  - A signed inbound webhook. Commits, branches and pull requests that mention a key appear in the item's new
    **Development** panel.
  - Setup, with step-by-step instructions, in Settings → Administration → Integrations.
- **REST API:**
  - **Personal API tokens** in Settings → Security & privacy. They are read or read-and-write, expire, are shown
    once and kept as a hash, can be revoked, and allow 120 requests a minute. Administrators see and revoke
    everyone's.
  - **Outbound webhooks** for created, updated, moved and commented events, signed with HMAC-SHA256 and retried
    with backoff, with a deliveries log, a test button and retry.
  - **Documentation:** `docs/API.md`, and an API reference in Settings.
- **Notification schemes:** for each event, the recipients (assignee, reporter, watchers, project lead, a role,
  @mentioned) and the channels (bell, email, Teams). People opt out of events in Settings → Notifications.
- **Security levels** on work items, enforced everywhere work items appear. Two are seeded.
- **Custom fields** per workspace (text, number, date, single select, multi select, person):
  - choice of screens (create, edit, view, board cards) and whether each is required
  - in PQL (with suggestions), saved filters, CSV export and board cards
- **Service Desk lite:**
  - **Request types:** Incident, Service request, Change and Question, each with its own questions.
  - **A portal:** links for people without an account, plus Raise a request and My requests for staff.
  - **Queues:** Unassigned, My open requests, SLA at risk, Breached, All open.
  - **SLA clocks** for first response and resolution, in business hours (Mon–Fri 08:00–17:00 Harare), with
    editable holidays, paused while waiting for the customer, warning at 75% and alerting on a breach.
  - **Customers** hear by email.
  - **Replies:** to the customer, or internal notes.
  - **Reports:** SLA met against breached, volume by type and by week, and the average time to resolve.
  - **Changes** go through Change Approval.
- **Ask Pulse knows:** the service desk queues (people who work them), custom field values and security levels of
  the items listed, your API tokens, and (for integration managers) GitHub and the webhooks. All of it follows
  each person's visibility.
- **Activity log:** "Integrations & API", "Schemes, levels & fields" and "Service desk" filters, with readable
  descriptions.
- **Retention:** rules for every new table. Webhook deliveries and GitHub delivery records are kept 30 days;
  expired tokens and portal links 90 days; API counters 24 hours. A removed person's tokens and opt-outs go with
  them.
- **Demo data** (with the `demo-` prefix):
  - two confidential bugs, and the demo manager in "HR only"
  - a "Client tier" select and an "Estimated value" number on 40 items
  - GitHub links on six items
  - six service desk requests
  - a portal link, a revoked token and an opt-out
- **Postman:** 39 new requests. **Unit tests:** 47 (PQL with custom fields, the SLA clock, the cron timetable).

**Migration:** `migrations/0007_integrations_admin_service_desk.sql`.
- **New tables:**
  - `security_levels`, `security_level_grants`
  - `custom_fields`, `custom_field_options`, `custom_field_values`
  - `integration_secrets`, `dev_links`, `github_deliveries`
  - `api_tokens`, `api_token_usage`
  - `webhooks`, `webhook_deliveries`
  - `notification_schemes`, `notification_optouts`
  - `service_desk_config`, `request_types`, `request_type_fields`, `request_type_field_options`
  - `sla_targets`, `public_holidays`, `portal_links`
  - `sd_requests`, `sd_answers`, `sd_pauses`
- **New columns:** `work_items.security_level`, `work_item_comments.public` and `work_item_comments.customer_name`.
  `work_items.source` may now be `service_desk`.
- **Seeds:**
  - the statuses "Waiting for customer" and "Resolved"
  - the Service desk workflow
  - two security levels and the default notification schemes
  - four request types with their questions, and SLA targets
  - Zimbabwe's 2026–2027 public holidays
- If roles have saved permissions, it adds the new permissions' defaults to them.

**New permissions and their defaults**

| Permission | Admin | Manager | Team Leader | Projects Assistant | Developer | Standard user |
| --- | --- | --- | --- | --- | --- | --- |
| Connect GitHub and manage webhooks (`manage_integrations`) | yes | no | no | no | no | no |
| Use personal API tokens (`use_api`) | yes | yes | yes | yes | yes | no |
| Manage notification schemes, security levels and custom fields (`manage_schemes`) | yes | no | no | no | no | no |
| Work the service desk and reply to customers (`work_service_desk`) | yes | yes | yes | yes | yes | no |
| Set up the service desk (`manage_service_desk`) | yes | yes | no | no | no | no |

**New endpoints**
- **Security levels:** `GET` and `POST /api/security-levels`; `PUT` and `DELETE /api/security-levels/:id`.
- **Custom fields:**
  - `GET` and `POST /api/custom-fields` (`?workspace=`); `PUT` and `DELETE /api/custom-fields/:id`; `PUT
    /api/custom-fields/order`.
  - Work items take `customFields` and `securityLevel` on create and edit.
- **Notifications:** `GET` and `PUT /api/notification-schemes`; `GET` and `PUT /api/me/notification-optouts`.
- **GitHub:** `GET`, `PUT` and `DELETE /api/integrations/github`. `POST /api/integrations/github/webhook` is called
  by GitHub, signed.
- **API tokens:** `GET /api/tokens` (`?all=1` for administrators), `POST /api/tokens`, `DELETE /api/tokens/:id`.
  Any endpoint takes `Authorization: Bearer pulse_…`.
- **Webhooks:**
  - `GET` and `POST /api/webhooks`; `PUT` and `DELETE /api/webhooks/:id`
  - `GET /api/webhooks/:id/deliveries`, `POST /api/webhooks/:id/test`, `POST /api/webhooks/deliveries/:id/retry`
- **Service desk:**
  - **Set-up:** `GET` and `PUT /api/service-desk/config`; `POST`, `PUT` and `DELETE /api/service-desk/types[/:id]`;
    `PUT /api/service-desk/holidays`; `POST /api/service-desk/portal-links` and `DELETE
    /api/service-desk/portal-links/:id`.
  - **Work:** `GET /api/service-desk/queues?queue=` and `GET /api/service-desk/reports?days=`.
  - **Staff portal:** `POST /api/service-desk/requests`; `GET /api/service-desk/my-requests[/:key]`; `POST
    /api/service-desk/my-requests/:key/reply`.
  - **Comments:** `POST /api/items/:key/comments` takes `public` (a reply to the customer).
- **Customer portal** (by `x-portal-token` and `x-requester-key`): `GET /api/portal`; `GET` and `POST
  /api/portal/requests`; `GET /api/portal/requests/:key`; `POST /api/portal/requests/:key/reply`.

**New screens:**
- the Service desk page (queues, raise a request, my requests, reports) in the sidebar
- the customer portal at `/portal/<link>`
- Settings → Administration: Integrations, Notification schemes, Security levels, Custom fields, Service desk
- Settings → Security & privacy: API tokens and the API reference
- Settings → Notifications: work item notifications
- on the item page: Security level, More fields, Development, the service desk request, and "Reply to the customer"
- on the create form: "More fields" (custom fields and the security level)
- custom fields on board cards

## Dashboard design pass (2026-11-25)

**Why:** the owner asked for a visual upgrade of the home dashboard and the custom dashboards, in Omni Contact's
colours, with no change to behaviour, data or permissions.

**What changed**
- **Design tokens** at the top of `src/styles.css`, with the same names in light and dark: a 4px spacing scale
  (`--sp-*`), a type scale (`--fs-page`, `--fs-section`, `--fs-gadget`, `--fs-body`, `--fs-small`, `--fs-caption`,
  `--fs-kpi`), radii (`--r-sm/md/lg/pill`), three elevations (`--e-1/2/3`), semantic colours
  (`--success/warning/danger/info/neutral` with `-ink` and `-tint`), a categorical chart palette (`--cat-1…8`,
  `--cat-other`), a focus colour (`--focus`, `--ring`) and motion (`--dur`, `--ease`).
- **One card style** for overview panels and gadgets: header (icon, title, actions), body, optional footer.
  `Panel` takes optional `icon` and `footer`; Reports cards pick up the same look.
- **Page header** for every dashboard: name, one line about it, and the picker, Edit and New dashboard grouped on
  the right. The old breadcrumb is gone.
- **Overview:** a full-width KPI row (In progress, Due this week, Need attention, Live). Each tile leads with its
  number, names itself with an icon, and states its trend in words with an icon. "Due this week" replaced the
  Projects total, which the stage donut still shows. "View all" on Needs attention, Upcoming deadlines and Your
  projects opens the matching Projects tab.
- **12-column grid:** the overview's rows are 8 + 4 and 4 + 4 + 4 (6 + 6 + 12 under 1100px, one column under
  700px). Custom dashboards keep their saved one, two or three columns, drawn as 12, 6 or 4 spans.
- **Gadgets:** a skeleton while loading, an empty state (icon, a line, and "Edit dashboard" for its owner), an
  inline error with Retry, and an "Updated …" footer. Pie slices beyond eight fold into "Other".
- **Charts and tables:** series use the categorical palette; status colours are kept for meaning (stage, schedule,
  overdue, late). Numbers are right-aligned in tabular figures, headers stick when a table scrolls, rows highlight
  on hover.
- **Accessibility:** a visible focus ring on every control in both themes; `--faint` darkened to #676c85 (AA on
  cards and the canvas); `--gold-ink` to #8a6000; gadget titles use `--heading` (they failed AA in dark);
  red text uses `--danger-ink`; timeline entries with nothing to open are text, not buttons.
- **Dark theme:** a sky-to-royal hairline on each card and a soft glow on hover; the same contrast as before.
- Removed dead CSS (`.dash-hero`, `.dash-kpis`, `.dash-kpi`, `.dash-list`, `.dash-deadline`, `.dash-picker`).

Files: `src/styles.css`, `src/components/DashboardPage.tsx`, `src/components/CustomDashboards.tsx`,
`src/components/Panel.tsx`. No API, query, permission or route changed.

## Chat: files, emoji, GIFs, stickers and more (2026-11-25)

**Why:** the owner asked for documents, emoji, GIFs and stickers in chat, plus other useful chat features.

**What was built**
- **Attach files** with the paperclip, by pasting, or by dragging onto the conversation: up to 10 per message, 10 MB
  each. Images show in the message (click for full size); PDFs open in a new tab; other files download.
- **Emoji picker** with search, groups and recently used; emoji go in at the cursor.
- **GIFs** from GIPHY (search and trending), once an administrator adds a `GIPHY_API_KEY` Worker secret.
- **Stickers:** 16 Pulse stickers (Thank you!, Shipped!, Looks good, Blocked, Coffee break …).
- **Reactions** on any message: three quick ones on the toolbar, or any emoji; counts show who reacted on hover.
- **Reply** to a message with a quote that jumps back to the original.
- **Pin** messages; a Pinned panel lists them.
- **Search** a conversation by words or file names; results jump to the message.
- **Copy text** from a message's toolbar.
- The conversation list previews GIFs, stickers and files ("GIF", "Sticker: Shipped!", "📎 plan.pdf").
- Notifications for a message with no words say what was sent.

**New endpoints:** `GET /api/chat/gifs`, `POST /api/chat/:id/files`, `GET /api/chat/:id/files/:fileId`,
`POST /api/chat/:id/messages/:mid/reactions`, `POST /api/chat/:id/messages/:mid/pin`, `GET /api/chat/:id/pins`,
`GET /api/chat/:id/search`. `POST /api/chat/:id/messages` also takes `files`, `gif`, `sticker` and `replyTo`.

**Migration:** `0012_chat_rich.sql`. Run `npm run db:migrate` before deploying.

**Tests:** `tests/chatRich.test.ts` (emoji-only reactions, GIPHY-only GIFs, sticker ids, previews).

## Reports → Projects, rebuilt (2026-11-25)

**Why:** the owner asked for a Projects report that shows quickly how every project is doing, with exports
managers can present.

**What was built**
- **Server-side figures:** new endpoints `GET /api/reports/projects/summary`, `/trends` and `/export.xlsx`.
  Before, the page added everything up in the browser from `/api/data`, so the `reports` permission wasn't
  enforced and work items weren't counted at all.
- **Health (RAG)** for every project being built, with its reasons on hover. The rule is in DECISIONS.md.
- **Layout:** six figures, then charts (health, stage, schedule, progress over time, items created vs resolved,
  burn-up, throughput by project), then resourcing (developers over the workload limit flagged), then a sortable,
  searchable project table with progress against the expected pace.
- **Filters** for period, stage, schedule, health, lead and workspace, kept in the address
  (`#/reports/projects?…`) so a filtered report can be bookmarked and shared.
- **Exports:** an Excel workbook (6 sheets, including every visible work item) and a branded PDF via the print
  dialog. They replace the two CSVs and the plain print.
- **One "needs attention" rule** for the dashboard, top bar, executive page and Reports.
- Every chart and table has loading, empty and error states (with Retry).

**Files**
- New: `src/data/projectHealth.ts`, `src/data/projectReport.ts`, `worker/projectReports.ts`, `worker/xlsx.ts`,
  `tests/projectReport.test.ts`.
- Rewritten: `src/components/reports/ReportsPage.tsx`.
- Changed:
  - `src/components/reports/ReportsHub.tsx`, `src/App.tsx`: the route and the signed-in user.
  - `src/components/DashboardPage.tsx`, `src/data/showcase.ts`: the shared attention rule.
  - `src/data/project.ts`, `src/components/SystemCard.tsx`: `lastUpdateOf`, shared with the Worker.
  - `src/components/reports/Charts.tsx`: charts used only by the old page removed.
  - `src/styles.css`, `worker/index.ts`, `docs/API.md`, `postman/Pulse.postman_collection.json`.

**No migration.**

## TypeScript → JavaScript (2026-11-25)

**Why:** the owner asked for the code to be JavaScript.

**What changed**
- All 143 source files and the two configs (`vite.config`, `neon`) are now `.js` / `.jsx`, with their types as JSDoc.
  `tsc --checkJs` still checks them on every build: 0 errors, as before.
- `tsconfig.json` and `worker/tsconfig.json` gain `allowJs` and `checkJs`; `wrangler.jsonc` points at
  `worker/index.js`; `index.html` at `src/main.jsx`.
- Done mechanically, then checked: the TypeScript compiler annotated every cast, generic call, non-null assertion
  and typed arrow function as JSDoc first, `ts-to-jsdoc` converted the files, and the last ~90 type errors were
  fixed by hand against the original TypeScript (commit before this one on `main`).
- Verified: `npm run build` (type check + production bundle), all 117 tests, the Worker bundles (`wrangler deploy
  --dry-run`), and the app loads in the browser from both the dev server and the production build.
- No behaviour changes intended; no migration.

## Multi-tenancy, phase (a): organisations and workspaces in the schema (2026-11-26)

**Why:** the owner asked for Pulse to hold several organisations, each with several workspaces, strictly
separated. The plan is `docs/multi-tenancy-plan.md`, and the rules are in DECISIONS.md. This phase is the schema
only; nothing changes for people using Pulse, except that workspaces can't be renamed and projects can't move
between workspaces until phase (b).

**What was built**
- **Migration `migrations/0013_tenancy_schema.sql`:**
  - **New tables:** `organizations`, `workspaces`, `workspace_members`. Also `tenancy_legacy`, `tenancy_report` and
    `tenancy_orphans`, which record the move.
  - **Organisation columns:** `organization_id` on the 19 organisation tables and `users`, and `users.org_admin`.
  - **Workspace columns:** `organization_id` and `workspace_id` on the 57 workspace tables.
  - **Database rules:** composite foreign keys between workspace rows; usernames and project keys unique per
    organisation; insert triggers for the old code; the rename and move guard.
- **Reverse:** `migrations/down/0013_tenancy_schema.down.sql`.
- **Dry run:** `scripts/tenancy-dry-run.mjs` (see DECISIONS.md).
- **Tests:**
  - `tests/helpers/worker.js` runs the real Worker against a real database.
  - `tests/tenancy.phaseA.test.js` has 10 checks that the current code works on the migrated schema and writes every
    row to the right workspace.

**Tested on the Neon dev branch**
- Dry run: 0 rows set aside, 0 references cleared, and 27 placements to check (12 projects with no workspace, 6
  filters, 6 dashboards, 3 example automation rules). The migration took 4.9 s.
- Applied, undone with the reverse script, and applied again.
- `PULSE_DB=dev npx vitest run tests/tenancy.phaseA.test.js`: 9 of 10 passed in a full run. The tenth (the main
  pages load) failed on a dropped network connection to Neon, then passed when run again.
- `npm test`: 117 passed and the 10 database tests were skipped. `tsc` on the app and the Worker: 0 errors.

**To release this phase** (by hand, before any phase (b) code):
1. Make a Neon branch from `production`, put its address in `.dev.vars` as `PG_STAGE`, and run
   `node scripts/tenancy-dry-run.mjs stage --out tenancy-dry-run.md`. Read the placements.
2. Back up: `npm run db:backup -- ../backup-before-tenancy.sql`, and make a Neon branch `backup-before-tenancy`.
3. `npm run db:migrate`. No deploy is needed: the Worker is unchanged.

**New permissions, endpoints, screens:** none.

## Multi-tenancy, phase (b): the Worker and the database scope everything (2026-11-26)

**Why:** phase (b) of the plan. Every request, background job and integration sees one organisation and one
workspace, enforced by Postgres row-level security. The rules are in DECISIONS.md.

**What was built**
- **Migration `migrations/0014_tenancy_enforcement.sql`** (reverse: `migrations/down/0014_tenancy_enforcement.down.sql`):
  - **Access:** the `pulse_app` role and RLS policies on every tenant table.
  - **Defaults:** tenant columns default to the request's tenant.
  - **Phase (a)'s stopgaps go:** the triggers and guards are replaced by `tenancy_derive`.
  - **People:** `users` becomes `accounts` plus the `users` view.
  - **Ids and keys:** configuration ids and global keys become per tenant.
  - **Settings:** split into `org_settings` and `workspace_settings`.
  - **Service desk:** every workspace gets its own request types.
  - **Seeding:** seed functions for new tenants.
- **Worker:**
  - **`worker/pg.js`:** scoped handles, a transaction per query, and batches that refuse mixed tenants.
  - **`worker/settings.js`:** settings by level.
  - **`worker/index.js`:**
    - identity first, then everything scoped
    - sessions carry their workspace, and the role comes from the membership
    - `GET /api/me/workspaces` and `POST /api/me/workspace`, and `tenant` in `/api/data`
    - organisation-wide project keys
    - random endings on new ids
    - activity by level
    - the cron per workspace
    - the workspace list editor refused
  - **Other modules:** tokens, portal links and GitHub each scoped to their workspace; organisation-wide alerts;
    conflict targets for the new keys; the service desk set-up inserted when missing; project history 404s for
    another workspace.
- **App:** a workspace switcher in the top bar (`src/components/WorkspaceSwitcher.jsx`).
- **Tests:**
  - **`tests/tenancy.isolation.test.js`, 13 checks:** two organisations × two workspaces, five people. It covers:
    - lists, the bell, chat, reports and activity
    - people
    - 404s, read or changed
    - PQL (the same key in two organisations)
    - gadgets, Ask Pulse and @mentions
    - view-only links and tokens
    - switching
    - the database's own refusals
  - **`tests/tenantScope.test.js`, 9 checks:** the adapter's tenant checks.
  - **Retired:** `tests/tenancy.phaseA.test.js` (phase (a)'s stopgaps are gone).
- **New dev dependency:** `@electric-sql/pglite` 0.5.16 (exact). The database tests run in `npm test` and CI.
- **Docs:** `docs/API.md` (organisations and workspaces; token, link and GitHub scope); Postman: a "Workspaces
  (multi-tenancy)" folder with 4 requests.

**Tested**
- `npm test`: 139 passed in 12 files, including the 13 isolation checks on PGlite in about 7 seconds.
- **The suite catches leaks:** with RLS switched off on `saved_filters`, 4 checks fail. With it off on `work_items`,
  the database check fails while the API stays isolated through the `systems` policy.
- `tsc` on the app and the Worker: 0 errors. `vite build` passes.
- **Neon dev branch:** 0014 applied, undone and applied again. Against dev the isolation run kept losing this
  laptop's connection to Singapore (DNS too), so it is verified on PGlite.

**Not done yet**
- **RLS cost through Hyperdrive:** two extra round trips per query (BEGIN and COMMIT), measured only once deployed.
- **Ask Pulse wording:** the prompt still calls Pulse "Omni Contact's project tracker" for every organisation
  (phase (e)).
- **Phases (c)–(e).**

**To release** (by hand, with 0013 already applied):
1. Dry run on a Neon branch of production:
   `node scripts/tenancy-dry-run.mjs stage --migration 0014_tenancy_enforcement.sql`.
2. Back up: `npm run db:backup -- ../backup-before-tenancy-b.sql`, plus a Neon branch.
3. `npm run db:migrate`, then deploy at once. The phase (a) Worker can't run on 0014.

## Multi-tenancy, phase (c): signing in to an organisation, and choosing a workspace (2026-11-26)

**What was built**
- **Sign-in asks for the organisation first:**
  - **Where the code comes from:** typed, or from a link `#/o/<code>`. This device then remembers it, with a
    "Change" link beside it.
  - **Then:** username and password, the second step, and, for someone in several workspaces, a choice of which to
    open, with the last one used on this device first.
- **The code is never checked on its own:** it goes with the password. An unknown or suspended organisation, a
  username not in it, a username shared by organisations (when no code is given) and a wrong password all get the
  same message after the same work. Workspaces are listed only after a correct sign-in, and only your own.
- **The API:**
  - `POST /api/login` and `POST /api/password/forgot` take `organization`.
  - A successful sign-in returns your workspaces.
  - Someone in no workspace is told so (403 `no_workspace`), after the right password only.
- **Browser storage:** the last dashboard and the last board are remembered per workspace, so one workspace's
  choices never appear in another. The organisation code and the last workspace per organisation are remembered
  per device (`src/data/tenant.js`).
- **The top-bar switcher** remembers the workspace you switch to.

**Tests:** `tests/tenancy.signin.test.js`, 7 checks on PGlite:
- the code decides whose account a username is
- codes match whatever their capitals
- every refusal is identical
- workspaces shown only after sign-in, and only yours
- someone in no workspace
- forgot password replies identically
- a suspended organisation's sessions stop working

`npm test`: 146 passed. `vite build` passes.

**To release:** nothing to migrate. It ships with phase (b)'s deploy, or after it.

## Multi-tenancy, phase (d): Platform and Organisation administration (2026-11-26)

**What was built**
- **Migration `migrations/0015_platform_admin.sql`** (reverse: `migrations/down/0015_platform_admin.down.sql`):
  - `platform_admins`, `platform_sessions`, `platform_challenges` and `platform_activity`, none of them readable by
    `pulse_app`
  - the template organisation and workspace, from the seeded configuration only
- **`/platform`** (`src/components/PlatformPage.jsx`, `worker/platform.js`):
  - signing in: password, authenticator app (set up at the first sign-in), then your own password
  - organisations: a table with counts, a new organisation (configuration from the template, a Projects workspace,
    its first administrator), rename, suspend, reactivate, archive, add an administrator
- **`scripts/platform-admin.mjs create|list dev|stage|main`:** makes the first Platform Administrator.
- **Settings → Organisation** (`src/components/OrgAdmin.jsx`, the `/api/org` routes in `worker/index.js`), for
  Organisation Administrators:
  - workspaces: add, rename, archive, reactivate
  - people: add (temporary password), a role per workspace in a table, Organisation Administrator or not, remove
- **Organisation-wide settings** (roles, two-step, sign-in security, email & Teams) are Organisation Administrators'
  only, in the server and the screens.
- **Docs:** `docs/admin-guide-organisations.md`, the admin guide. `docs/API.md` has organisation and platform
  administration. Postman: 4 more requests in "Workspaces (multi-tenancy)".

**Tests:** `tests/tenancy.admin.test.js`, 10 checks on PGlite:
- **Platform sign-in:** the authenticator app is required, the same code can't be used twice, and refusals are
  identical.
- **Temporary password:** must be replaced first.
- **Platform and organisation sessions** can't reach each other's API.
- **New organisations:** the template's configuration, a Projects workspace, and the first administrator, who must
  choose a password.
- **The platform list** shows counts only.
- **Organisation administration:** workspaces, people, roles per workspace, and sessions ending on leaving a
  workspace.
- **Isolation:** no reaching another organisation's workspaces or people.
- **Organisation settings** for Organisation Administrators only, with the last one protected.
- **Suspending** ends sessions and refuses sign-ins; reactivating restores them.

`npm test`: 156 passed. `tsc` (app and Worker): 0 errors. `vite build` passes. On the Neon dev branch, 0015 applied,
undone and applied again; its template matches PGlite's.

**To release:** apply 0015 with 0014, before the deploy. Then make the first Platform Administrator with
`node scripts/platform-admin.mjs create main <username> "<Full name>"`.

## Multi-tenancy, phase (e): links, GitHub, digests and wording (2026-11-26)

**What was built**
- **Migration `migrations/0016_showcase_links.sql`** (reverse in `migrations/down/`): executive page links, with
  row-level security.
- **`/executive/<link>`:**
  - the page reads its link and shows that workspace's totals, named for its organisation and workspace
  - Settings → View-only links → Executive page links makes and revokes them (`src/components/ShareLinks.jsx` now
    serves both kinds)
  - the public `/executive` without a link is gone
- **GitHub:** one secret per workspace, a secret another workspace uses is refused, and the set-up screen explains
  it.
- **Digests and the Monday Briefing:** titled with their workspace.
- **Wording:**
  - Ask Pulse and the digest openings no longer say "Omni Contact's project tracker"; the snapshot names the
    organisation and workspace
  - neutral email footers and install description
  - workspace and organisation names on the Excel report, the printed report cover and the service desk portal
- **Docs:** `docs/API.md` (executive page links), `docs/admin-guide-organisations.md` (inside each workspace).
  Postman: a public check that the executive page needs its link.

**Tests:** `tests/tenancy.integrations.test.js`, 5 checks on PGlite:
- an executive link shows its own workspace's totals only, and no names
- every refusal is the same 404
- Ask Pulse names the right organisation and never "Omni Contact"
- GitHub: a shared secret is refused, and a delivery links only in the signing workspace even when another
  organisation has the same key
- the Monday Briefing goes out per workspace, named for it, from the real hourly cron

`npm test`: 161 passed in 15 files. `tsc` (app and Worker): 0 errors. `vite build` passes. Migration 0016 is applied
on the Neon dev branch.

## Releasing multi-tenancy phases (b) to (e) together

Phase (a) (migration 0013) is on main. Phases (b)–(e) are committed locally, not pushed, because pushing deploys and
the deployed Worker needs 0014–0016 in the live database.

1. **Dry run on a copy of production:**
   - Make a Neon branch from `production`.
   - Put its address in `.dev.vars` as `PG_STAGE`.
   - If 0013 isn't live yet, run `node scripts/tenancy-dry-run.mjs stage` and read the placements.
   - Apply the migrations to the branch in order with `node scripts/db.mjs exec stage migrations/<file>`. (Or point
     `PG_DEV` at the branch and run `npm run db:migrate:dev`.)
   - Optionally run `PULSE_DB=stage npx vitest run tests/tenancy` against it. It's slow from a laptop (see phase
     (b)); the same suite runs on PGlite in `npm test`.
2. **Back up live:** `npm run db:backup -- ../backup-before-tenancy.sql`, plus a Neon branch
   `backup-before-tenancy` from `production`.
3. **Migrate live:** `npm run db:migrate` applies 0014, 0015 and 0016 (and 0013, if not yet applied).
4. **Deploy straight away:** `git push`. CI runs `npm test`, including the PGlite isolation suite, then deploys. The
   Worker running before this push can't work on 0014.
5. **Make the first Platform Administrator:** `node scripts/platform-admin.mjs create main <username> "<Full name>"`.
   They sign in at `/platform`.
6. **Tell people:**
   - The sign-in page now asks for the organisation code: `omnicontact`, or send the link `…/#/o/omnicontact`.
   - Old `/executive` addresses stop working; make links in Settings → View-only links.
   - API tokens reach only the workspace they were made in.
7. **Afterwards:** watch response times. Each query now has two extra round trips to the database (BEGIN and
   COMMIT), next to the Worker.

**If something goes wrong:** the reverse migrations are in `migrations/down/` (0016, 0015, 0014, newest first). They
refuse to run once a second organisation exists. Otherwise restore the backup or the Neon branch.

## Administrator module, phase 1: roles, and organisation and workspace administration (2026-11-26)

**What was built** (plan: `docs/admin-module-plan.md`; decisions: DECISIONS.md)
- **Migration `migrations/0017_admin_console.sql`** (reverse in `migrations/down/`):
  - the Viewer role
  - organisation profile columns, workspace icon, colour, description and visibility
  - `accounts.deactivated_at`
  - the append-only `audit_log`
  - `organizations.delete_after`, and `tenancy_purge_organization`
- **Worker:**
  - `worker/orgadmin.js`: profile and logo, invitations, CSV import, deactivate and reactivate, copying a workspace's
    configuration, the audit log
  - `worker/audit.js`: one audit helper, saved with each change
  - `worker/index.js`:
    - the Viewer gate
    - deactivated accounts refused at sign-in, sessions, reset links and tokens
    - organisation-wide workspaces in the switcher
    - before/after entries for workspaces, people, memberships and role permissions
  - `worker/platform.js`: deleting an organisation 30 days after asking, and the hourly purge
- **Screens:**
  - Settings is now grouped: Organisation / This workspace / Settings
  - `OrgAdmin.jsx` is split into Profile, Workspaces (with an edit form, icons, colours, visibility, start-from-copy),
    Members & roles (invite, CSV import, deactivate) and Audit log
  - `AdminKit.jsx`: toasts, confirmation dialog, help text, empty states
  - the workspace switcher shows icons and organisation-wide workspaces
  - the sidebar shows the organisation's logo and colour
  - the Platform page can delete archived organisations
- **Docs:**
  - `docs/API.md` (organisation administration, Viewers, platform deletion)
  - `docs/admin-guide-organisations.md`
  - Postman (organisation profile, invites, CSV check, audit log)

**Tests:**
- `tests/admin.rbac.test.js`, 12 checks:
  - a Viewer can't change anything, can't be assigned, and can't be given permissions
  - Marketing and Development don't see each other's work
  - only Organisation Administrators reach organisation administration, and never another organisation's
  - profile and logo
  - invitation through to sign-in
  - CSV import that checks first
  - deactivate and reactivate
  - copying a workspace
  - organisation-wide workspaces
  - the audit log can't be changed even by the owner
  - deleting an organisation removes it alone, only when due
- `tests/csvImport.test.js`, 4 unit checks.
- Switching off the Viewer gate makes the suite fail.

`npm test`: 177 passed in 17 files. `tsc` (app and Worker): 0 errors. `vite build` passes.

Migration 0017 is applied on the Neon dev branch. Its reverse was run there, then it was applied again.

**Not yet checked:** the new screens in a browser (the tests drive the Worker's API, not the pages).

**Release (before pushing, see the 2026-11-26 incident):**
1. In `frontend`, run `npm run db:status`. Only 0017 should be pending.
2. `npm run db:backup -- ../backup-before-0017.sql`
3. `npm run db:migrate`
4. `npm run db:status` again.
5. Push.
6. Check sign-in and Settings → Organisation on the live site.

## Administrator module, phase 2: workflow designer, versions and templates (2026-11-26)

**What was built** (decisions: DECISIONS.md)
- **Migration `migrations/0018_workflow_designer.sql`** (reverse in `migrations/down/`):
  - workflows per workspace (each workspace gets its own copies; the organisation's become templates), with
    row-level security and an ownership trigger
  - `item_types`, and `work_items.item_type` with its trigger
  - `workflow_drafts`, `workflow_versions`
  - `workspace_templates`
  - custom field kinds, defaults, item types and currency
  - new workspaces get the five built-in types and a copy of the default workflow
- **Worker:**
  - `worker/workflows.js` (rewritten): templates, drafts, publish, versions, restore, item types, assignments per
    workspace, project and item type
  - `worker/blueprints.js`: export and apply a workspace's set-up
  - `worker/orgadmin.js`: templates, and workspace copies through blueprints
  - `worker/workitems.js`: `itemType` on create and update, a workflow per type, the "clear a field" post-function,
    fields per type
  - `worker/customfields.js`: the new kinds, defaults, fields per type
  - PQL: the new field kinds
- **Screens:**
  - Workflows: a React Flow diagram you edit, draft / publish / discard, versions with restore, templates marked,
    and who uses which workflow (workspace, projects, item types)
  - Settings → This workspace → **Item types**
  - Settings → Organisation → **Templates**
  - Add workspace → **Start from** a template
  - the custom field editor: default, currency, item types
  - item forms offer the workspace's types and only their fields
- **Dependency:** `@xyflow/react` 12.3.6, pinned, in a chunk of its own (178 KB, 58 KB gzipped) loaded only by the
  Workflows page.
- **Docs:** `docs/API.md` (workflows, item types, templates), `docs/admin-guide-organisations.md` (templates, item
  types, creating a workflow, fields).

**Tests:**
- `tests/workflow.designer.test.js`, 7 checks on PGlite:
  - each workspace's workflow is its own, invisible and unusable from another (and the database refuses it directly)
  - templates are read-only except to Organisation Administrators
  - draft → publish with status moves → versions → restore
  - item types, with a workflow per type, and isolated per workspace
  - the new field kinds, defaults, per-type fields and link safety
  - a workspace from the Marketing template, saved as an organisation template and used again
  - the clear-field post-function
- `tests/transitionEngine.test.js`, 11 unit checks: moves out of a status, conditions, validators, assignment
  satisfying "someone must be assigned", sub-tasks, and every built-in template a valid, completable workflow.

`npm test`: 195 passed in 19 files. `tsc` (app and Worker): 0 errors. `vite build` passes.

Migration 0018 is applied on the Neon dev branch; its reverse was run there, then it was applied again.

**Not yet checked:** the screens in a browser, including the diagram.

**Release:** 0017 and 0018 go live together, before pushing.
1. **Dry run first.** This one rewrites every workspace's workflow references.
   - Make a Neon branch from production.
   - Put its address in `.dev.vars` as `PG_STAGE`.
   - Run `node scripts/tenancy-dry-run.mjs stage --migration migrations/0018_workflow_designer.sql`, after applying
     0017 there.
2. `npm run db:status`. 0017 and 0018 should be pending.
3. `npm run db:backup -- ../backup-before-0018.sql`
4. `npm run db:migrate`
5. `npm run db:status` again.
6. Push.
7. On the live site, check:
   - Settings → Workflows
   - creating and moving a work item

## Administrator module, phase 3: the automation engine (2026-11-26)

**What was built** (decisions: DECISIONS.md)
- **Migration `migrations/0019_automation_engine.sql`** (reverse in `migrations/down/`):
  - new triggers and actions
  - condition groups, trigger settings, owners, round-robin cursor, organisation rules
  - webhook addresses and signing secrets
  - `automation_jobs` (retries) and `automation_fired` (once per occasion)
  - each run's detail
- **Worker:**
  - `worker/automation.js` (rebuilt):
    - conditions, the new triggers and actions
    - jobs with back-off, loop limits, failure alerts
    - the test run, presets, the webhook and manual triggers
    - cross-workspace items, organisation rules
  - `worker/messaging.js`: the WhatsApp/SMS adapter
  - `src/data/automation.js`: conditions, smart values, schedules, working days, presets
  - `worker/schedule.js` and `wrangler.jsonc`: the cron runs every 5 minutes
  - `worker/index.js`:
    - the `/api/hooks/automation/<secret>` route
    - events carry who caused them
    - new workspaces join organisation rules
- **Screens:**
  - Settings → Automations is a When / If / Then builder:
    - a condition builder with AND/OR groups
    - pickers for statuses, types, people, roles and fields
    - every action's settings
    - smart values to copy
    - a Test dialog (also for unsaved rules)
    - presets
    - the run log with each condition's result
    - organisation rules
    - webhook address and secrets shown once
  - Work items show their rules' buttons.
- **Docs:** `docs/API.md` (Automation), `docs/admin-guide-organisations.md` (Automations).

**Tests:**
- `tests/automation.engine.test.js`, 12 checks on PGlite:
  - conditions and the run log
  - round-robin and least-loaded assignment
  - the test run changes nothing
  - a self-triggering rule stops at the depth limit
  - a signed webhook, retried with back-off and done
  - a job failing 5 times stops and tells the owner
  - due soon, due passed and schedules fire once
  - the webhook trigger (and its 404s)
  - the manual button
  - cross-workspace creation only for an owner allowed there
  - organisation rules (copies, administrators only, new workspaces)
  - presets matched with warnings
- `tests/automationEval.test.js`, 17 unit checks:
  - AND/OR and nesting
  - every operator
  - custom fields
  - refusals
  - smart values escaped for HTML and JSON
  - schedules across time zones
  - working days
- Switching off the cross-workspace owner check makes the suite fail.

`npm test`: 220 passed in 21 files. `tsc` (app and Worker): 0 errors. `vite build` passes.

Migration 0019 is applied on the Neon dev branch; its reverse was run there, then it was applied again.

**Not yet checked:** the screens in a browser; the cron every 5 minutes on Cloudflare (it runs the same code as the
tests call).

**Release:** 0017, 0018 and 0019 go together, before pushing (see phase 2 for the dry run).
- After the push, the cron runs every 5 minutes.
- Existing scheduled rules keep their hour, now in the organisation's time zone (Harare unless changed).

## Administrator module, phase 4: SLAs, approvals, webhook payloads and the demo organisation (2026-11-27)

**What was built** (decisions: DECISIONS.md)
- **Migration `migrations/0020_sla_approvals_webhooks.sql`** (reverse in `migrations/down/`):
  - `sla_policies`, `item_sla_events`
  - `approvals`, `approval_votes` (votes can't be changed)
  - SLA and approval automation triggers
  - `webhooks.payload_template`
- **Worker:**
  - `worker/sla.js`: policies API, each item's SLA, the 5-minute check with notifications and automation events
  - `worker/approvals.js`: asking, approving N of M, rejecting with a reason, cancelling, history, "waiting for me"
  - `worker/workitems.js`: moves with an approval rule wait; items carry `approval` and `sla`
  - `worker/workflows.js`: the approval rule checked on save
  - `worker/integrations.js`: webhook payload templates
  - `src/data/workCalendar.js`: working time in the organisation's time zone
- **Screens:**
  - on the work item: **Waiting for approval** (approve, reject with reason, cancel) and the **SLA**
  - Settings → This workspace → **SLAs**
  - the workflow rule "Approval is needed" (a role, a person, or N of several)
  - the webhook form's payload field
- **The demo organisation:** `scripts/demo-org.mjs` with `scripts/demo-org-cli.mjs` (`npm run demo:org -- dev`).
  Demo Co is made on the Neon dev branch.
- **Docs:**
  - `README.md`: what's in it, scheduling, and Administration (setting up, creating a workflow, creating an
    automation)
  - `docs/API.md`: SLAs and approvals
  - `docs/admin-guide-organisations.md`: SLAs and approvals

**Tests:**
- `tests/sla.approvals.test.js`, 6 checks:
  - an SLA's first response by someone else
  - a breach told once to the right people, setting off automation
  - an approval waits, is hidden from the wrong people and needs a reason to reject
  - two of three approvals make the move, and automation hears of it
  - approval rules checked on save
  - webhook payload templates escaped for JSON
- `tests/workCalendar.test.js`, 5 unit checks: working hours, weekends, holidays, time zones and daylight saving,
  adding working time, SLA states.
- `tests/demoOrg.test.js`, 5 checks: Demo Co built through the Worker, the critical-bug rule assigning, isolation and
  the Viewer, the approval step, `--reset`.
- Letting anyone approve makes the suite fail.

`npm test`: 236 passed in 24 files. `tsc` (app and Worker): 0 errors. `vite build` passes.

Migration 0020 is applied on the Neon dev branch; its reverse was run there, then it was applied again.

**Not yet checked:** the screens in a browser.

**Release:** 0017, 0018, 0019 and 0020 go together, before pushing.
1. Dry-run 0018 on a branch of production (phase 2).
2. `npm run db:status`
3. `npm run db:backup -- ../backup-before-admin-module.sql`
4. `npm run db:migrate`
5. `npm run db:status` again.
6. Push.
7. Check sign-in, Settings → Workflows, Automations and SLAs, and moving a work item.

## Project Management System (PMS), and branding per organisation (2026-11-27)

The product is now **Project Management System (PMS)**, and each organisation brands its own space. Plan:
`docs/branding-plan.md` (approved); every renamed string: `docs/rename-list.md`; decisions: DECISIONS.md.

**What was built**
- **The name in one place:** `src/data/brand.js` (`BRAND`: product name, short name, tagline, support email,
  assistant name, "Powered by"). Screens, the Worker (emails, digests, the Monday Briefing, notifications, Teams,
  Ask AI's instructions, the manifest, passkeys, exports) and `index.html` (filled in at build time) read it.
  "Ask Pulse" is **Ask AI**.
- **State A, the platform page:** the PMS wordmark, one line of value, the organisation code and "Find your
  organisation" (help only: nothing is listed or searched). Neutral platform tokens, a CSS gradient and dot grid, the
  PMS favicon (an SVG of the letters) and PMS app icons (`scripts/make-icons.mjs`).
- **State B, the organisation's sign-in page:** its logo or monogram, "Sign in to {name}", its accent on the button
  and focus rings, its tint, "Not your organisation?", "Powered by Project Management System". The tab reads
  "{name} · PMS" with its icon or monogram. Unknown, suspended and archived codes go back to State A with one
  message. Workspaces are still chosen after sign-in.
- **State C, signed in:** the organisation's logo (the dark variant; the sidebar is always dark) and the workspace
  pill; on narrow screens its mark in the top bar. The accent sets three variables (`--accent-solid`,
  `--accent-light`, `--accent-dark`); status colours and the chart palette never change. The palette that was
  Omni Contact's (indigo, royal blue, red, sky cyan) is now neutral graphite and steel by default.
- **Outside the app:** emails (alerts, digests, the Monday Briefing, invitations, password resets, service desk
  replies) carry the organisation's logo, name and accent; Teams posts its name; the PDF cover, BI letterhead,
  printed footer and Excel heading its name and logo; the executive page and the customer portal its branding.
  "Powered by Project Management System" is in small print.
- **Branding settings:** Settings → Organisation → **Branding**: display name, logo for light and for dark
  backgrounds, square icon, accent, sign-in tint, the contrast check and a live preview of A, B and C in each theme.
  The logo and colour left the Profile page.
- **Migration `0021_branding.sql`** (reverse in `migrations/down/`): `organization_branding` under row-level security;
  every organisation's old logo and colour copied in; Omnicontact's two logos and indigo moved into its row. The
  public `omni-logo*.png` files, `src/brand.js` and `PulseMark` are deleted.
- **Worker:** `src/branding.js`:
  - `GET /api/public/org/:code/branding` and its images, limited per address (30 codes that lead nowhere
    in 10 minutes, counted in the database; Cloudflare's `BRANDING_LIMIT` binding is a first line), one 404 for every
    organisation nobody may see
  - `GET/PUT /api/org/branding` and `/api/platform/organizations/:id/branding`
  - images checked from their bytes (PNG, WebP or JPEG; never SVG), size and dimensions
  - branding in `/api/me/workspaces`, `/api/data`, `/api/showcase` and `/api/portal`

**Tests**
- Frontend:
  - `tests/branding.test.js` (12): the contrast maths, safe shades on every theme's surfaces, button shades, the
    monogram
  - `tests/noOrgBranding.test.js` (4): nothing outside Omnicontact's row refers to its logo or website, the product
    never names Omni Contact, State A carries no organisation, branding sets only the accent variables
- Backend:
  - `tests/branding.test.js` (7): the public lookup returns only the allowed fields; unknown, suspended, archived and
    template organisations get the same 404; 429 after a burst; uploads (SVG, HTML renamed .png, wrong type,
    oversize, wrong dimensions); who may change it; nothing crosses organisations (row-level security included); the
    Platform Administrator route
  - `tests/brandEmail.test.js` (4): the organisation's logo, monogram, name and accent in emails; neutral without
    one; escaping
- `npm test`: 263 passed in 28 files (86 frontend, 177 backend). `tsc` (app and Worker): 0 errors. `vite build`
  passes.

**Screenshots:** `docs/screenshots/branding/` (contact sheet `index.html`):
- States A, B and C for Omnicontact and Demo Co (no logo)
- light, dark and futuristic, at 1440, 1024, 768 and 390 px
- very wide and very tall logos

They were taken on the Neon dev branch, where 0021 is applied; its reverse was run there, then it was applied again.

**Release:** apply 0021 before pushing (it adds the table the new code reads).
1. `npm run db:status`
2. `npm run db:backup -- database/backups/backup-before-branding.sql`
3. Dry-run 0021 on a copy of production.
4. `npm run db:migrate`
5. `npm run db:status`
6. Push. The `BRANDING_LIMIT` rate-limit binding deploys with the Worker.
7. Check State A at `/`, State B at `/#/o/omnicontact`, signing in, and Settings → Organisation → Branding.

A later release drops `organizations.logo` and `.colour` (0017), which nothing reads now.

## Branding: the remaining pieces (2026-11-27)

- **Platform Administrators** change an organisation's branding on `/platform`: **Branding** on its row opens the
  same settings page (contrast check, uploads, preview), through `/api/platform/organizations/:id/branding`.
- **About:** "Powered by Project Management System" (and the support address, once `BRAND.supportEmail` is set) at
  the foot of Settings: the one place inside an organisation's space that names the product.
- **Migration `0022_drop_profile_logo.sql`** (reverse in `migrations/down/`) drops `organizations.logo` and
  `.colour` (0017), unused since 0021. The reverse puts them back filled from the branding, so 0021's and 0017's
  reverses still run. Applied on the Neon dev branch; reversed there, then applied again.
- `docs/admin-guide-organisations.md`: Branding, and the new sign-in steps.

`npm test`: 264 passed. `tsc` (app and Worker): 0 errors.

**Release:** `npm run db:status`, `db:backup`, `db:migrate` (0022), `db:status`, then push.

## The platform landing page (State A), redesigned: "Clean timeline" (2026-11-27)

Three directions were mocked up; "Clean timeline" was chosen.

**What was built**
- **`src/components/LandingPage.jsx`**, with its own section in `components/landing.css` (`.lp-a-*`):
  - **Hero:** the PMS wordmark (still), "Plan. Track. Deliver." with the last word turning over (Deliver, Ship,
    Report, Succeed; the static line is what screen readers get), the tagline, and six feature chips (Boards,
    Sprints, Timeline, Reports, Service desk, Ask AI) that lift and glow on hover.
  - **Behind the page:** a wide project timeline whose bars fill in, with a "Today" line, over the dot grid. A soft
    ring of light grows from behind the code card now and then.
  - **Under the card:** a small board where one card travels To do → In progress → Done and is ticked.
  - **Futuristic:** neon edges and faint scan lines.
- **The same behaviour:** the code field (now lower-cased as it's typed), Continue (Enter submits), "Find your
  organisation" (an inline panel), the remembered-device note, and one message for every code that leads nowhere.
- **Micro-interactions:**
  - **Focus:** a glow in the platform accent, and the field's icon turns.
  - **Continue:** the arrow slides on hover. While checking, it shows a spinner and a shimmer.
  - **A refusal:** the card shakes once, and the message is announced.
  - **Moving to State B:** the organisation's accent floods out from Continue, and the card morphs into its sign-in
    page (View Transitions; a crossfade where the browser has none).
- **Theme:** a toggle in the top-right corner (light → dark → futuristic), following the device until someone picks.
  It is remembered on the device; signing in applies the account's own choice.
- **Motion:** only transform and opacity animate. With reduced motion (the system setting or the account's), a
  still composition: bars full, the card in Done and ticked. Animations pause while the tab is hidden, and the art
  pauses off screen.
- **Speed:**
  - **Code on demand:** the signed-in app now loads only once someone is in (`src/SignedInApp.jsx`, split out of
    `App.jsx`), and so do the platform, executive and portal pages. The sign-in page's script fell from 290 KB to
    73 KB gzipped.
  - **Fonts:** loaded without holding up the first paint, with an early connection to the font server and a
    fallback sized to Inter's measurements, so the swap doesn't move the page.
  - **The landing page's own size:** 5.3 KB gzipped (2.2 KB script, 3.1 KB styles).

**Lighthouse** (the production build, served locally):

| | Performance | Accessibility | Best Practices | LCP | CLS |
| --- | --- | --- | --- | --- | --- |
| Phone (simulated) | 92 | 100 | 96 | 1.8 s | 0.001 |
| Desktop | 100 | 100 | 96 | 0.5 s | 0 |

- **Before:** phone Performance was 79 and LCP 4.2 s.
- **Best Practices:** loses points only for the 401 the browser logs while the app checks whether anyone is signed
  in.
- **Phone LCP misses the 1.5 s target:** what remains is the whole app stylesheet (45 KB gzipped) and the sign-in
  check. Splitting the stylesheet is the next step.

**Screenshots:** `docs/screenshots/landing/` (contact sheet `index.html`, and `landing-a-to-b.gif`):
- every theme at 1440, 1024, 768 and 390 px
- reduced motion
- an unknown code
- State B after the transition, for Omnicontact and Demo Co

`npm test`: 267 passed (86 frontend, 181 backend). `tsc` (app and Worker): 0 errors. `vite build` passes.
`tests/noOrgBranding.test.js` also checks the landing page: no image, no organisation, no data and no customer
claims.

**Not done:**
- No Privacy link: there is no privacy page yet.
- The footer's Help link appears once `BRAND.supportEmail` is set.

## An organisation's own sidebar (2026-11-27)

- **What's new:** an organisation may set its own **sidebar colour** and **sidebar highlight** (Settings → Organisation →
  Branding, with the preview). Without them the sidebar stays neutral graphite with the accent.
- **Made safe:** `src/data/branding.js` `sidebarTheme` darkens the sidebar until its text reaches AA, and lightens the
  highlight to 3:1 and its ink to AA. Status colours are unchanged.
- **Migration `0023_branding_sidebar.sql`** (reverse in `migrations/down/`) adds the two columns and gives Omnicontact
  its colours from before the rename: Penn blue `#011f5b` with sky blue `#1ba9e1`. With them comes the fine grid and the
  glow on the active page.
- **Tests:** any sidebar and highlight is readable, and Omnicontact's come through; saving, clearing and refusing
  them; the public lookup carries them. `npm test`: 271 passed.
- **Where it was tried:** applied on the Neon dev branch, reversed there, then applied again.

## Themes generated from an organisation's logo (2026-11-27)

Plan and the algorithm (approved): `docs/adaptive-theming-plan.md`. Sample gallery from the approval step:
`docs/design/adaptive-theme-preview.html` (Omnicontact and two invented logos, every variation, light and dark).

- **What's new:** Settings → Organisation → Branding → **Theme**. "We generated a theme from your logo": the colours
  found, the roles (primary, secondary, neutral tint; swap them, or pick the primary by hand), the three variations
  (Subtle, **Balanced** by default, Immersive) drawn in light and dark, fine-tuning (vibrancy, corners, font), a live
  preview (dashboard, board, report, sign-in, email, PDF; light and dark; desktop and mobile), then **Save draft →
  Preview as me → Publish**, with a history where any version can be restored, and a way to turn the theme off.
  Platform Administrators have the same on an organisation's Branding page in `/platform`.
- **The engine** (`src/data/logoTheme.js`, shared by the app and the Worker): logo analysis in OKLab (k-means,
  weighted by area and saturation, ignoring transparency, soft edges, white/grey backgrounds and near-white/black),
  roles, OKLCH generation with the contrast fixer (body text 7:1, other text 4.5:1, focus and accents 3:1; with
  `prefers-contrast: more` every text pair 7:1), and chart colours kept apart under protanopia, deuteranopia and
  tritanopia (patterns for any pair that still clashes).
- **Applied** by `src/brandTheme.js` from the published ThemeSpec: light, dark (re-tuned, not inverted), the futuristic
  theme's link colour, and the high-contrast version. Swapping themes crossfades (200 ms view transition) unless
  reduced motion is on. `forced-colors` gets system colours; print drops the header band. A dark one-colour logo with
  no dark version is shown in white on dark surfaces; others keep the light plate.
- **A new logo** generates a theme: an organisation that has never published one gets it published at once
  (Balanced); otherwise it is saved as a draft and the other administrators get a notification. Nothing reaches
  anyone until it is published.
- **Without a published theme nothing changes:** the accent (and Omnicontact's sidebar colours from 0023) as before.
- **Migration `0024_organization_themes.sql`** (reverse in `migrations/down/`): versions per organisation (at most one
  draft and one published), row-level security, no DELETE for the app's role.
- **API:** `GET /api/org/theme`, `PUT|DELETE /api/org/theme/draft`, `POST /api/org/theme/publish | rollback | off`,
  and the same under `/api/platform/organizations/:id/theme`. The branding view gains `theme`.
- **Tests:** `tests/logoTheme.test.js` (12 fixture logos × 3 variations × 3 vibrancies × light/dark × normal/high
  contrast; colour-vision distinctness; spec validation; the style sheet holds only known variables with hex, px or
  listed font values; dark-logo handling) and the theme part of `tests/branding.test.js` (only administrators,
  auto-publish, drafts, publish, rollback, off, audit, tenant isolation including row-level security, Platform
  Administrator). `npm test`: 295 passed (112 frontend, 183 backend). `tsc`: 0 errors.
- **Tried in Chrome** against the Neon dev branch (migration applied there): Omnicontact's logo → one muted navy,
  strengthened to the same hue, a neighbouring violet second colour; all 30 pairs pass; Preview as me re-themes the
  app.
- **Not done:** density per organisation (it stays a personal setting); per-workspace hue shifts and an evening
  palette (deferred, as agreed in the plan); visual snapshot tests and a GIF (the Chrome screenshots in `docs/screenshots/theme/` stand in for now).

## The workspace card at the top of the sidebar (2026-11-27)

- **What's new:** under the organisation's logo, a card says which workspace you're in: "You're in", the name in
  large type, its icon on a tile of its colour with a slow "you are here" ring, a bar in its colour down the left edge,
  your role there, its key (only when it adds something), and a dot per workspace ("1 of 2"). It replaces the small
  workspace pill.
- **Switching:** with more than one workspace, the card opens a list (icon, name, your role; organisation-wide ones
  marked view only) and switches straight away, like the top bar's switcher (`switchWorkspace`, shared).
- Reduced motion stops the ring and the list's animation; forced colours get system colours. No migration.
- Screenshots: `docs/screenshots/workspace-card/`. `npm test` (frontend): 112 passed.

## Project lifecycles, and Omnicontact's 16 stages (2026-11-27)

Plan, template, mock-ups and the dry-run mapping (approved): `docs/lifecycle-plan.md`, `docs/design/`. Staff guide:
`docs/omnicontact-project-lifecycle.md`.

- **Engine** (`src/data/lifecycle.js`, shared; `src/lifecycle.js`, the Worker): templates per organisation with phases
  and stages (type, responsible roles, owner, target in business days, weight, exit criteria, deliverables, sign-offs,
  testing, deployment, moves, automation hooks), versions, gates checked by the server, advance / send back / skip,
  sign-off rounds with segregation of duties and alternates, locked signed versions, the registers (risks, security
  findings with risk acceptance, test cases and runs, environments, deployment and closure records).
- **Omnicontact's lifecycle** (`src/data/lifecycleTemplates.js`): the 16 stages in six phases with the brief's gates;
  named signatories proposed (Waraidzo, Mutsa; alternates Mutsa, Admin), awaiting approval. A standard version with
  role signatories is there for any organisation to start from.
- **Screens:** the project's **Lifecycle** tab (stage tracker by phase, stage panel with gate, checklist, deliverables
  and versions, sign-offs, registers, moves, requests, history) and a compact tracker on the Overview; **Pipeline** in
  the sidebar (by stage, filter by phase, lead, workspace); **Settings → Project Lifecycle** (templates, versions,
  drag-to-reorder stage editor, gates, sign-offs, moves); a lifecycle section in **Reports → Projects** and a
  Lifecycle sheet in its Excel export.
- **Automation and notifications:** on entering a stage, the responsible people are told, sign-offs are requested,
  checklist items can become work items, Deployment raises the service desk change request; a failed test raises a
  bug; stages due soon and overdue, and pending sign-offs, are reminded and escalated on business time (cron); the
  automation trigger "A project moves to another lifecycle stage"; Ask PMS knows each project's stage and days in it.
  New notification kinds `stage` and `signoff`.
- **Migrations:** `0025_project_lifecycle.sql` (tables, row-level security, locks, the automation trigger) and
  `0026_omnicontact_lifecycle.sql` (generated by `scripts/lifecycle-migration.mjs`: Omnicontact's template and the
  stage mapping, `lifecycle_map_projects`). Reverses in `migrations/down/`. Applied on the Neon dev branch: all 39 of
  its Omnicontact projects placed, none flagged (`node scripts/lifecycle-report.mjs dev`).
- **Tables (all tenant-scoped):** lifecycle_templates, lifecycle_stages, project_lifecycle, project_stage_history,
  stage_checklist_items, stage_signoffs, stage_requests, risk_register, security_findings, test_cases, test_runs,
  project_environments, stage_records. **Reused:** documents (stage, deliverable, version, lock), work_items (the
  stage that made a task or bug), the Concept Note's signatories, service desk Change requests, notifications,
  automation rules.
- **Tests:** frontend `tests/lifecycle.test.js` (30: templates, every gate kind, the QAT threshold, security findings
  blocking QAT, moves, skip, sign-offs and segregation of duties, business-hours SLA timing, progress, the mapping
  rules) and backend `tests/lifecycle.test.js` (8, through the Worker: template isolation including row-level
  security, gate enforcement, decline → back, locking (also in the database), skip approval, QAT and risk acceptance,
  send-back, closing, history and audit, pipeline and report, the mapping migration against the code's rules).
  `npm test`: 333 passed (142 frontend, 191 backend). `tsc`: 0 errors. Postman: 9 lifecycle requests.
- **Screenshots:** `docs/screenshots/lifecycle/` (stage tracker and Dev Work, BRS Sign Off in light and dark, the
  Overview strip, the pipeline, the template editor, the report).
- **Not done:** signing from an email link signs in first and opens the project's Lifecycle tab (there is no
  one-click approve in the email itself); the Monday Briefing and daily digest don't have a lifecycle section yet.

## Project documents from the organisation's templates (2026-11-28)

Guide: `docs/project-documents.md`. Screenshots: `docs/screenshots/documents/`.

- **A Documents tab on every project** lists the templates in lifecycle order (Concept Note, BRS, BSS, UAT script,
  Change Request, Release Notes, Changelog), each with its state and one button to write, continue, print or open it.
- **BRS, BSS and Release Notes are written in PMS** from the templates (`src/data/documentKits.js`: one editor and one
  printed layout for all three). They're prefilled from the project and its Concept Note, saved as you type, and
  printed under the organisation's letterhead. Submitting a version makes it the stage's deliverable, so the existing
  sign-off, segregation of duties and locking apply. The BSS comes with its standard NFRN, SECN and RRN requirements,
  security headers, documentation and deployment tables, ready to edit. A submitted BSS is linked to the signed BRS.
- **UAT script:** UAT test cases now have a scenario, the tester assigned, the expected result, and a Waived result
  (set aside from the pass rate). The script prints in the template's layout, results chart included.
- **Change Request form:** the Deployment stage's record is now the whole form: request, the change, technical
  details, risk and impact, the three approvers and change closure. It prints in the form's layout. The gate still
  checks the plan, rollback plan, date and approver.
- **Release Notes and Changelog:** the bug fixes and finished features since the last release are filled in from
  the work items; each published release goes into the changelog (Added, Changed, Deprecated / removed, Fixed,
  Security).
- **Concept Note:** the type "Systems & Services" (from the template) is added.
- **Fixed:** a QAT pass rate just under the threshold (94.7%) was shown as "95%"; it is now rounded down.
- **Migration `0027_project_documents.sql`** (reverse in `migrations/down/`): `project_documents` (drafts and frozen
  versions, row-level security, a trigger refusing changes to a submitted version), test case scenario and tester, the
  waived result, a larger stage record.
- **Tests:** `tests/documentKits.test.js` (frontend, 9) and a documents test in `tests/lifecycle.test.js` (backend:
  prefill, incomplete submit refused, submit → deliverable → gate → sign-off → locked, frozen versions, the next
  draft, release notes → changelog, the UAT script's columns and waived, another organisation's 404). `npm test`: 343
  passed (151 frontend, 192 backend).
- **Not included:** the Econet logo (printouts use the organisation's own letterhead); Word (.docx) export (print or
  save as PDF instead).

## Project page, phase 1: the overview endpoint (2026-11-28)

Design: `docs/design/project-cockpit-mockups.html`, screenshots in `docs/design/cockpit/`. Decisions: DECISIONS.md,
"Project page".

- **`GET /api/systems/:id/overview`** returns everything the new project page's Overview needs in one call: the
  header (lead, team, workspace, health and its reasons), the lifecycle stepper, the KPI tiles (progress, forecast
  finish, open, overdue and done work items, blockers, High/Critical risks, security findings, test pass rates), what
  needs attention (ranked, each with its action), the next 14 days, and the series for the burn-up, created vs
  resolved, cumulative flow, time in each stage and workload charts, plus 30-day sparklines. The screens come in the
  next phases.
- **Health now counts the lifecycle:** a stage over its target is At risk, at twice its target Off track, in Reports →
  Projects as on the project page. Some projects' health in Reports changes.
- **Forecasts:** a Monte Carlo forecast from work-item throughput (50% and 85% dates, or "not enough history"), and one
  from the remaining stages' targets.
- **Workload limits** gain the weekly hours per person (`capacityHours`, default 30).
- **Fixed:** assigning a developer to a project failed with a database error.
- **No migration.** Tests: `tests/cockpit.test.js` (frontend, 12: health with the stage, the forecasts including too
  little history, the attention ranking) and `tests/overview.test.js` (backend, 5: a restricted item left out, the
  figures equal to Reports → Projects and to their PQL lists, header, stepper, attention, forecast and series, the
  stage in health in both places, another organisation's 404). `npm test`: 360 passed (163 frontend, 197 backend).
  Postman: three requests under "Overview".

## Project page, phase 2: header, stepper and KPI tiles (2026-11-28)

Screenshots (dev data): `docs/design/cockpit/live-*.png`.

- **A sticky project header** on every tab: the project's name and key, its workspace, the lead and the team (with
  "+N"), its status, its health with the reasons on hover or focus, the stage and its clock ("day 7 of 5 · 2 over"),
  and the quick actions the person may use: Advance stage (enabled only when the gate is met, saying what's missing
  otherwise), Request update, Add work item (opens the list with the summary box ready), Copy link, and a menu
  (Update progress, Documents, Open the app). The tabs live in the header; on a phone they're a list.
- **The lifecycle stepper:** the 16 stages by phase, each with its state as an icon and words (done with its date,
  sent back before, current, over its target, skipped, placed here when the lifecycle started, upcoming). Clicking one
  opens its drawer: what its gate needs, its sign-offs, its deliverables and its history, with a link to the
  Lifecycle tab. Below 900px it folds into "Stage 6 of 16", which opens the full list.
- **KPI tiles** with 30-day sparklines: overall progress, forecast finish (with how it was worked out), open and
  overdue work items (each opens Search with its PQL list), blockers, High/Critical risks, and security findings or,
  in testing, the QAT and UAT pass rates. They swipe sideways on a phone.
- The old header, tabs and lifecycle strip are gone; the rest of the Overview is unchanged until phase 3.

## Project page, phase 3: what needs attention, the summary, stage comments (2026-11-28)

- **What needs attention** takes the place of the blocker band: blockers, sign-offs waiting on someone, the stage over
  its target, overdue work items, update requests and stale updates, most urgent first, each with one button (Resolve
  with Undo, Send reminder, Open, Show all in Search, Post update).
- **Summary:** three plain sentences written by Workers AI from the project's figures only; if it quotes a number the
  figures don't have, the plain summary is shown instead. Regenerate, and when it was written.
- **Next 14 days:** work items and epics due, sprints ending, the stage's target and the project's due date.
- **Comments on a stage**, in the stage drawer.
- The activity log describes stage moves, sign-off requests and stage comments in words.
- **Migration `0028_project_page.sql`** (reverse in `migrations/down/`): `project_summaries` (per project and viewer)
  and `stage_comments` (a record), both with row-level security.
- **Tests:** `tests/projectSummary.test.js` (frontend, 6: the facts, the plain summary, the number check) and two more in
  `tests/overview.test.js` (backend: the summary from what the viewer may see, kept per viewer, the plain one when the AI
  quotes an unknown number or writes one in words, Regenerate's 30 seconds; stage comments, their checks, another
  organisation's 404, and that the app can't change one).

## Project page, phase 4: the charts (2026-11-28)

Screenshots (dev data): `docs/design/cockpit/live-p4-*.png`.

- **Five charts on the Overview:** the burn-up with its forecast cone (50% and 85% dates, today, the due date), created
  vs resolved, cumulative flow, time in each stage against its target, and this week's workload against the weekly
  capacity.
- Each says what it shows in one line ("18 resolved and 1 created in the last 8 weeks: the open list is shrinking"),
  shows exact values on hover or focus, has a **Data table**, and **opens the work items behind what you click** in
  Search.
- **No migration.** The overview adds each team member's username (for their list).
- **Tests:** `tests/chartInsights.test.js` (frontend, 6) and one more in `tests/overview.test.js` (backend: each chart
  part's list has the chart's count). `npm test`: 375 passed (175 frontend, 200 backend).

## Project page, phase 5: the other tabs (2026-11-28)

Screenshots (dev data): `docs/design/cockpit/live-p5-*.png`.

- **Risks & Security:** the 5×5 heat map (click a square to filter), the risk register, and security findings by
  severity and age.
- **Testing:** each suite's pass rate and its trend, failing tests linked to their bugs, and every test case.
- **Team:** each person's role, hours logged here, open and done work, and how much of their open work is here.
- **Activity:** the project's history with filters and a search.
- **Chat:** the project's channel, inside the project page.
- Every tab has its own address; `#/projects/WCC/…` (the project's key) works too.
- **No migration.** Tests: `tests/projectTabs.test.js` (frontend, 2: the pass-rate trend, the activity filters) and one
  more in `tests/overview.test.js` (backend: the team's hours and open work through the visibility rule).
  `npm test`: 378 passed (177 frontend, 201 backend).

## Project page: the Work tab, the critical path, document previews (2026-11-28)

Screenshots (dev data): `docs/design/cockpit/live-p5b-*.png`.

- **Work tab:** List, Board and Backlog in one tab. On the list, **save your filters as a view** (one click to bring
  them back), the filters you last used are remembered for each project, and **select several items to change their
  status, assignee or priority together**.
- **Timeline:** the **critical path** (the chain of dependencies that decides when the linked work finishes) is
  outlined and named; switch it off with the checkbox.
- **Documents:** every file and link with its version, whether it's signed and locked and by whom, and a **Preview** of
  PDFs and images without leaving the page.
- **No migration.** Saved views and remembered filters are part of each person's preferences.
- **Tests:** `tests/workTab.test.js` (frontend, 8: the preferences' cleaning and caps, the critical path including a loop)
  and one more in `tests/overview.test.js` (backend: preferences cleaned on save, each person's own).

## Project page, phase 6: inline edits, shortcuts, search, the last tab (2026-11-28)

- **Change things where you see them:** on the Work list, a work item's status, assignee and due date; in the header
  (Lead and dates), the project's lead and its start and due dates. Each change shows at once, and **Undo** is there for
  a few seconds.
- **Keyboard shortcuts:** `g` then `o` / `w` / `l` / `t` / `r` / `d` / `m` / `a` / `c` to go to a tab, `a` to add a work item,
  `?` for the list (or the Shortcuts button, bottom right).
- **Search this project** with Ctrl/Cmd+K or `/`: its work items, its tabs and its actions.
- **Back where you left off:** opening a project takes you to the tab you last had open on it.
- **No migration.** Tests: `tests/shortcuts.test.js` (frontend, 4). `npm test`: 391 passed (189 frontend, 202 backend).

## Project page, phase 7: the one-pager (2026-11-28)

Example: `docs/design/cockpit/project-one-pager.pdf`. The drill-down GIF: `docs/design/cockpit/kpi-drill-down.gif`.
Screenshots: `docs/design/cockpit/final-*.png`.

- **One-pager:** the header's One-pager button shows one A4 page (the project, its health and stage, the KPI tiles, the
  summary, what needs attention, the risks, the next 14 days and the burn-up) under the organisation's letterhead; Print
  / Save as PDF.
- **Sample data** for the project page on the dev branch: `node scripts/demo-cockpit.mjs` (with `npm run dev:api`
  running).
- **No migration.**
