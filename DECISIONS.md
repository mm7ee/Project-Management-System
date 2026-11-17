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
