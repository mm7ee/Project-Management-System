# Project Management System (PMS)

A multi-tenant project management system, **PMS** for short. Each organisation signs in to its own branded space (its
logo, name and colour); the platform itself stays neutral. The name lives in one place,
`project-management-system-frontend/src/data/brand.js`. It follows every project from idea to live: progress, feature requests from
clients, work items on boards and sprints, blockers, documents, Concept Notes and sign-offs, a service desk, and
team chat. Managers get reports and insights on top of it all, and **Ask AI** answers questions about the live
data in plain English.

**Live:** https://pulse.utsa--wanza--ortfolio.workers.dev

## What's in it

| Area | What it does |
| --- | --- |
| Dashboard and Projects | Every project's stage, progress, schedule and health, with blockers and update requests |
| Concept Notes | Propose a project, collect the sign-offs, and turn an approved note into a project |
| Feature requests | What clients ask for, with priority, delivery date and developer, plus an Insights view |
| Organisations and workspaces | Several organisations, each with its own workspaces (Development, Marketing, HR …), isolated by the database; a Platform console and an admin console |
| Work items, boards, sprints | Jira-style issues with each workspace's own item types, Kanban and Scrum boards, backlog, timeline |
| Workflows | A workflow per workspace and per item type, edited on a diagram as a draft, published as versions, with approvals; built-in workspace templates |
| SLAs | First-response and resolution targets for work items in the organisation's working hours, with warnings and breaches |
| Search | PQL queries, saved filters, email subscriptions and custom dashboards |
| Automation | When / If / Then rules: events, due dates, schedules, webhooks and buttons; conditions; actions that move, assign, email, message, call webhooks or create work in another workspace; tested before use, retried and logged |
| Service desk | A customer portal, queues, and response and resolution targets in business hours |
| Chat | Direct messages, group chats and a channel for each project |
| Reports | Projects, feature requests, delivery (agile charts) and service desk, in one place |
| Notifications | Under the bell, by email (Resend) and to a Teams channel |
| Security | Roles and permissions, two-step verification (app or passkey), sign-in lockout, self-service password reset, audit log |
| Integrations | GitHub webhooks, outbound webhooks and personal API tokens |

## How it's built

```
Browser ──► "pulse" Worker (gateway) ──► "omni-tracker" Worker ──► Hyperdrive ──► Postgres on Neon (Singapore)
                                           │  serves the React app (static assets)
                                           │  and the JSON API under /api
                                           └─► Workers AI (Ask AI) · Resend (email) · Teams webhook
```

- **Front end:** React 18 and Vite, in JavaScript with JSDoc types that `npm run build` checks (`tsc --checkJs`), with hand-written SVG charts. Routing uses the URL hash.
- **API:** one Cloudflare Worker, `project-management-system-backend/src/`. Every permission check happens here; the
  UI only hides what a user can't do. The same Worker serves the front end's build.
- **Database:** Postgres 18 on Neon, reached through Cloudflare Hyperdrive. `src/pg.js` gives it a small
  D1-shaped API (`prepare` → `bind` → `first`/`all`/`run`, and `batch` as one transaction).
- **Placement:** the Worker is pinned to `aws:ap-southeast-1`, next to the database, so each page's queries are
  short hops.
- **Tenancy:** every query runs in its organisation and workspace, enforced by Postgres row-level security
  (`src/pg.js`, migrations 0013–0014). See `docs/multi-tenancy-plan.md` and `docs/DECISIONS.md`.
- **Scheduled jobs:** one cron trigger, every 5 minutes. `src/schedule.js` decides what's due:
  - **Every run:** automation (schedules, due dates, retries) and work item SLAs.
  - **Hourly:** filter subscriptions.
  - **At their time:** daily digests, the Monday briefing and the retention clean-up.

## Repository layout

```
project-management-system-frontend/   the screens (React and Vite)
  src/                 React app (components/, data/ for types and shared logic, also used by the API)
  public/              static files
  tests/               Vitest tests of the shared logic
  index.html, vite.config.js
project-management-system-backend/    the API, database and deployment
  src/                 the API Worker (index.js routes; a module per area)
  database/migrations/ Postgres schema changes, applied in order (migrations-d1/: the old D1 history)
  database/backups/    backups of production (ignored by git)
  scripts/db.mjs       migrate, status, backup and run SQL against a database
  scripts/demo-data.mjs  demo records for presentations (every id starts "demo-")
  scripts/demo-org.mjs   the demo organisation "Demo Co" (Development and Marketing workspaces)
  scripts/platform-admin.mjs  makes the first Platform Administrator
  tests/               Vitest tests that run the real Worker on PGlite
  gateway/             the "pulse" Worker that fronts the app (deployed by hand)
  postman/             Postman collection and environments for the API
  docs/API.md          the API reference
  wrangler.jsonc       the Worker: the API plus the front end's dist/ as its assets
docs/                  guides, DECISIONS.md (read before changing a feature), UPGRADE-LOG.md
```

It deploys as **one** Worker: the backend's `npm run build` builds the front end first, and `wrangler.jsonc` serves
`../project-management-system-frontend/dist`. The API imports shared rules from the front end's `src/data/`, so
both folders need `npm install`.

## Running it locally

You need Node 22 and access to the Neon project.

1. Clone the repository and install dependencies:
   ```sh
   git clone https://github.com/mm7ee/Project-Management-System.git "Project Management System"
   cd "Project Management System"
   npm run install:all      # npm install in both folders
   npx wrangler@4 login     # once: Ask AI's Workers AI binding runs on Cloudflare even locally
   ```
2. Create `project-management-system-backend/.dev.vars` with these values. Ask the project owner for them; never commit this file.
   ```
   MFA_KEY=...        # encrypts two-step secrets; must match the deployed Worker's secret
   PG_MAIN=...        # production database connection string (migrations and backups)
   PG_DEV=...         # the Neon "dev" branch, used when running locally
   QA_PASSWORD=...    # the QA accounts' password, for smoke tests
   ```
3. Run it. The backend always uses the Neon **dev** branch (and applies any new migrations to it first), never
   production.

   | To run | From the repository root | Or in its own folder | Open |
   | --- | --- | --- | --- |
   | **Both** | `npm run dev` | `npm run dev:all` (backend) | http://localhost:5173 |
   | **Frontend only** | `npm run dev:frontend` | `npm run dev` (frontend) | http://localhost:5173 |
   | **Backend only** | `npm run dev:backend` | `npm run dev` (backend) | http://127.0.0.1:8787/api/... |
   | **The built app, as deployed** | | `npm run dev:api` (backend) | http://127.0.0.1:8787 |

   - **Both:** one terminal, each line labelled `[frontend]` or `[backend]`. Ctrl+C stops both, and if one stops,
     so does the other. In VS Code, **Terminal → Run Task → PMS: frontend + backend** does the same in two
     panels.
   - **Frontend only:** the screens with live reloading. Vite sends `/api` to http://127.0.0.1:8787. If the backend
     isn't running, API calls answer 503 with a message saying so. Set `PULSE_API` to point it elsewhere.
   - **Backend only:** the API, without building the screens. Until the frontend is built, the page at
     http://127.0.0.1:8787 just points you to the frontend.
   - **The two can start and stop in any order.** Start the backend later and the frontend picks it up.
4. Run the tests: `npm test` at the root runs both folders' tests (or `npm test` in either folder).
   ```sh
   npm test
   ```

## Deploying

Every push to `main` deploys. GitHub Actions (`.github/workflows/deploy.yml`) runs `npm ci` and `npm test` in both
folders, then `wrangler deploy` from the backend for the `omni-tracker` Worker (it keeps its original name: renaming the repository didn't change
it, and the two-step verification key is stored on it). It needs the repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

The pipeline does **not** touch the database. When a change adds a migration, release it in this order:

```sh
cd project-management-system-backend
npm run db:backup -- database/backups/backup-before-<change>.sql   # a full copy of production first
npm run db:migrate                                   # apply new migrations to production
npm run db:status                                    # confirm they show as applied
git push origin main                                 # then deploy the code that needs them
```

Pushing code before its migration is applied breaks the live site. Backups go in `database/backups/` and are
ignored by git (`backup-*.sql`).

The gateway Worker rarely changes. To deploy it by hand, from `project-management-system-backend/`:

```sh
npx wrangler@4 deploy --config gateway/wrangler.jsonc
```

## Useful commands

All of these run from `project-management-system-backend/`. Running the app is under
[Running it locally](#running-it-locally).

| Command | What it does |
| --- | --- |
| `npm run dev` | The API on its own, against the dev branch |
| `npm run dev:all` | The API and the frontend together |
| `npm run dev:api` | Build, migrate the dev branch, and serve the whole app locally, as deployed |
| `npm test` | Tests (Vitest); each folder has its own |
| `npm run build` | Build the front end, then type-check the Worker |
| `npm run db:status` | Which migrations production has applied |
| `npm run db:migrate` | Apply new migrations to **production** |
| `npm run db:migrate:dev` | Apply new migrations to the dev branch |
| `npm run db:backup -- <file>` | Back up production to a SQL file |
| `npm run demo:seed` / `demo:remove` | Add or remove demo data on production |
| `npm run demo:org -- dev [--reset]` | The demo organisation Demo Co on the dev branch (`main` needs `--live`) |
| `node scripts/platform-admin.mjs create main <username> "<Name>"` | The first Platform Administrator |

## Conventions

- **Migrations** are numbered SQL files (`0012_<what>.sql`). They are applied once each, tracked in
  `schema_migrations`, and are never edited after release.
- **Shared rules** (permissions, password policy, limits) live in `src/data/` and are used by both the Worker and
  the UI, so the server enforces exactly what the screen shows.
- **Decisions** worth remembering go in `docs/DECISIONS.md`, with the date.
- **Secrets** stay out of the repository: `.dev.vars`, `.env*` and backups are ignored by git.

## Administration

The full guide is [docs/admin-guide-organisations.md](docs/admin-guide-organisations.md). In short:

**Setting up**
1. **The first Platform Administrator:** `node scripts/platform-admin.mjs create main <username> "<Full name>"`
   prints a temporary password. They sign in at `/platform` and set up an authenticator app.
2. **An organisation:** on `/platform`, **New organisation**, with a name, a code (people type it at sign-in) and its
   first administrator.
3. **That administrator,** under Settings → **Organisation**:
   - fills in the **Profile** (logo, colour, time zone, working days and hours)
   - adds **Workspaces** (blank, from a template, or a copy of another)
   - invites **Members** by email or CSV, with a role in each workspace (Viewer is read-only)
4. **Every change** to the organisation, workspaces, people and roles is in the **Audit log**.

To try it all, `npm run demo:org -- dev` makes Demo Co on the dev branch: Development and Marketing workspaces,
six people, work, SLAs, approvals and rules.

**Creating a workflow:** Settings → This workspace → **Workflows**.
1. **New workflow** (a copy of this workspace's or a template), or pick one.
2. Add its statuses and choose where items start.
3. On the **Diagram**, drag from one status to another to add a move.
4. In the table, give each move rules:
   - **who may:** a role, the assignee
   - **needs first:** a comment, a field, sub-tasks done, **approval** by a person, a role or N of M people
   - **then:** assign, set the resolution, clear a field, notify
5. **Save draft**, then **Publish**. PMS asks where items in removed statuses go, and keeps every version to
   restore.
6. At the top, choose which workflow the workspace, a project or an item type uses. Item types are under
   **Item types**; SLAs under **SLAs**.

**Creating an automation:** Settings → This workspace → **Automations**.
1. **New rule**, or **From a preset**.
2. **When:** an item is created, moved, assigned or changed; a due date is near or passed; a schedule; a webhook; a
   button.
3. **If:** conditions in AND/OR groups (or PQL).
4. **Then:** up to 10 actions, with smart values such as `{{item.key}}`.
5. **Test** it on an item (nothing changes), save, switch it on, and watch its **Run log**.

## API

Other systems can use PMS's API with a personal API token (Settings → Security & privacy → API tokens). See
[project-management-system-backend/docs/API.md](project-management-system-backend/docs/API.md) and the Postman
collection in [project-management-system-backend/postman/](project-management-system-backend/postman/).
