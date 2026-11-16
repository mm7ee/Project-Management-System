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
