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
