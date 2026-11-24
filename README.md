# Pulse

Omni Contact's projects tracker. Pulse follows every project from idea to live: progress, feature requests from
clients, work items on boards and sprints, blockers, documents, Concept Notes and sign-offs, a service desk, and
team chat. Managers get reports and insights on top of it all, and **Ask Pulse** answers questions about the live
data in plain English.

**Live:** https://pulse.utsa--wanza--ortfolio.workers.dev

## What's in it

| Area | What it does |
| --- | --- |
| Dashboard and Projects | Every project's stage, progress, schedule and health, with blockers and update requests |
| Concept Notes | Propose a project, collect the sign-offs, and turn an approved note into a project |
| Feature requests | What clients ask for, with priority, delivery date and developer, plus an Insights view |
| Work items, boards, sprints | Jira-style issues, Kanban and Scrum boards, backlog, timeline and workflows |
| Search | PQL queries, saved filters, email subscriptions and custom dashboards |
| Automation | Rules that run on events or a schedule |
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
                                           └─► Workers AI (Ask Pulse) · Resend (email) · Teams webhook
```

- **Front end:** React 18, TypeScript and Vite, with hand-written SVG charts. Routing uses the URL hash.
- **API:** one Cloudflare Worker, `frontend/worker/`. Every permission check happens here; the UI only hides what
  a user can't do.
- **Database:** Postgres 18 on Neon, reached through Cloudflare Hyperdrive. `worker/pg.ts` gives it a small
  D1-shaped API (`prepare` → `bind` → `first`/`all`/`run`, and `batch` as one transaction).
- **Placement:** the Worker is pinned to `aws:ap-southeast-1`, next to the database, so each page's queries are
  short hops.
- **Scheduled jobs:** one hourly cron trigger. `worker/schedule.ts` decides what's due: daily digests, the Monday
  briefing, filter subscriptions, automation rules and the retention clean-up.

## Repository layout

```
frontend/              the app: everything is built and deployed from here
  src/                 React app (components/, data/ for types and shared logic)
  worker/              the API Worker (index.ts routes; a module per area)
  migrations/          Postgres schema changes, applied in order
  scripts/db.mjs       migrate, status, backup and run SQL against a database
  scripts/demo-data.mjs  demo records for presentations (every id starts "demo-")
  tests/               Vitest unit tests
  gateway/             the "pulse" Worker that fronts the app (deployed by hand)
docs/                  API reference and guides
postman/               Postman collection and environments for the API
DECISIONS.md           why things are the way they are: read before changing a feature
UPGRADE-LOG.md         what each upgrade phase built
```

## Running it locally

You need Node 22 and access to the Neon project.

1. Install dependencies:
   ```sh
   cd frontend
   npm install
   ```
2. Create `frontend/.dev.vars` with these values. Ask the project owner for them; never commit this file.
   ```
   MFA_KEY=...        # encrypts two-step secrets; must match the deployed Worker's secret
   PG_MAIN=...        # production database connection string (migrations and backups)
   PG_DEV=...         # the Neon "dev" branch, used when running locally
   QA_PASSWORD=...    # the QA accounts' password, for smoke tests
   ```
3. Start the API and app against the dev database:
   ```sh
   npm run dev:api
   ```
   This builds the app, applies any new migrations to the **dev** branch, and serves Pulse at
   http://127.0.0.1:8787. For faster front-end work, run `npm run dev` (Vite) alongside it.
4. Run the tests:
   ```sh
   npm test
   ```

## Deploying

Every push to `main` deploys. GitHub Actions (`.github/workflows/deploy.yml`) runs `npm ci`, `npm test`, then
`wrangler deploy` for the `omni-tracker` Worker. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

The pipeline does **not** touch the database. When a change adds a migration, release it in this order:

```sh
cd frontend
npm run db:backup -- ../backup-before-<change>.sql   # a full copy of production first
npm run db:migrate                                   # apply new migrations to production
npm run db:status                                    # confirm they show as applied
git push origin main                                 # then deploy the code that needs them
```

Pushing code before its migration is applied breaks the live site. Backups are written to the repository root
and ignored by git (`backup-*.sql`).

The gateway Worker rarely changes. To deploy it by hand, from `frontend/`:

```sh
npx wrangler@4 deploy --config gateway/wrangler.jsonc
```

## Useful commands

All of these run from `frontend/`.

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Build, migrate the dev branch, and serve Pulse locally |
| `npm run dev` | Vite dev server for the front end |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Type-check the app and Worker, then build |
| `npm run db:status` | Which migrations production has applied |
| `npm run db:migrate` | Apply new migrations to **production** |
| `npm run db:migrate:dev` | Apply new migrations to the dev branch |
| `npm run db:backup -- <file>` | Back up production to a SQL file |
| `npm run demo:seed` / `demo:remove` | Add or remove demo data on production |

## Conventions

- **Migrations** are numbered SQL files (`0012_<what>.sql`). They are applied once each, tracked in
  `schema_migrations`, and are never edited after release.
- **Shared rules** (permissions, password policy, limits) live in `src/data/` and are used by both the Worker and
  the UI, so the server enforces exactly what the screen shows.
- **Decisions** worth remembering go in `DECISIONS.md`, with the date.
- **Secrets** stay out of the repository: `.dev.vars`, `.env*` and backups are ignored by git.

## API

Other systems can use Pulse's API with a personal API token (Settings → Security & privacy → API tokens). See
[docs/API.md](docs/API.md) and the Postman collection in [postman/](postman/).
