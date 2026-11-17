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
