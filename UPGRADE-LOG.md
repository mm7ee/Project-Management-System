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
