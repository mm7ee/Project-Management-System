# PMS: backend

The API (a Cloudflare Worker), the database's migrations, and deployment.

```
src/                 the API Worker (index.js routes; a module per area)
database/
  migrations/        Postgres schema changes, applied in order, once each
  migrations-d1/     the old D1 database's history (read-only)
  backups/           backups of production (ignored by git)
gateway/             the "pulse" Worker in front of the app (deployed by hand)
scripts/             database tool, demo data, the demo organisation, the first Platform Administrator
tests/               Vitest tests that run the real Worker on PGlite (an in-process Postgres)
postman/             Postman collection and environments
docs/API.md          the API reference
wrangler.jsonc       the Worker "omni-tracker": the API, plus the frontend's dist/ as its assets
.dev.vars            secrets and database addresses (never committed)
```

It is deployed as one Worker with the frontend: `npm run build` builds `../project-management-system-frontend`
first. Install packages in both folders.

| Command | What it does |
| --- | --- |
| `npm run dev` | The API on its own at http://127.0.0.1:8787 (Neon dev branch), without building the frontend |
| `npm run dev:all` | The API and the frontend together, in one terminal (the same as `npm run dev` at the root) |
| `npm run dev:api` | Build the frontend and serve the whole app at http://127.0.0.1:8787, as deployed |
| `npm test` | The API tests |
| `npm run build` | Build the frontend and type-check the Worker |
| `npm run db:status` | Which migrations production has applied |
| `npm run db:backup -- database/backups/backup-before-<change>.sql` | Back up production |
| `npm run db:migrate` | Apply new migrations to **production** (before pushing the code that needs them) |
| `npm run deploy` | Deploy by hand (pushing to `main` does this) |

More in the main [README](../README.md).
