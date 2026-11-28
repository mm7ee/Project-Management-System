// PGlite (Postgres compiled to WebAssembly, in this process) as the tests' database: every migration in
// migrations/ applied in order, the same as `npm run db:migrate`, so the tests run against the real schema, real
// row-level security and the real pulse_app role, with no network and no secrets. Each test file gets its own.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const MIGRATIONS = fileURLToPath(new URL("../../database/migrations/", import.meta.url));

/** A fresh database with every migration applied. */
export async function migratedPglite() {
  // Counts and big numbers as numbers, as the Worker's own client returns them.
  // pgvector, as on Neon (migration 0029: the passages Ask AI searches).
  const pg = await PGlite.create({ extensions: { vector }, parsers: { 20: (/** @type {string} */ x) => Number(x), 1700: (/** @type {string} */ x) => Number(x) } });
  await pg.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.transaction(async (tx) => {
      await tx.exec(readFileSync(MIGRATIONS + f, "utf8"));
      await tx.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [f, new Date().toISOString()]);
    });
  }
  return pg;
}

/**
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }>; exec: (text: string) => Promise<{ rows: any[] }[]> }} Executor
 */
/**
 * PGlite in the shape worker/pg.js drives (the part of postgres.js it uses), so the Worker's own scoping code runs
 * over it unchanged: `unsafe(text, params)` → rows with `count`; `.simple()` → several statements at once;
 * `begin(fn)` → a transaction, where fn may return an array of queries, run in the order given.
 * @param {PGlite} pg
 */
export function pgliteClient(pg) {
  /** @param {Executor} on */
  const runner = (on) => ({
    /** @param {string} text @param {unknown[]} [params] */
    unsafe(text, params = []) {
      /** @type {Promise<any> | null} */ let started = null;
      const run = () => (started ??= on.query(text, params).then((r) => Object.assign([...r.rows], { count: r.affectedRows ?? r.rows.length })));
      return {
        then: (/** @type {any} */ ok, /** @type {any} */ fail) => run().then(ok, fail),
        catch: (/** @type {any} */ fail) => run().catch(fail),
        simple: () => on.exec(text).then((rs) => rs.at(-1)?.rows ?? []),
      };
    },
  });
  const client = {
    ...runner(pg),
    /** @param {(tx: ReturnType<typeof runner>) => unknown} fn */
    begin: (fn) =>
      pg.transaction(async (tx) => {
        const out = await fn(runner(tx));
        return Array.isArray(out) ? Promise.all(out) : out;
      }),
  };
  return /** @type {any} */ (client);
}

/**
 * A postgres.js-like tagged template over PGlite, for the tests' own set-up and checks (db`…`, db.unsafe, db.begin).
 * @param {Executor & { transaction?: (fn: (tx: any) => Promise<any>) => Promise<any> }} on
 */
export function pgliteSql(on) {
  /** @param {TemplateStringsArray} strings @param {...unknown} values */
  const sql = (strings, ...values) => on.query(strings.reduce((text, s, i) => text + (i ? `$${i}` : "") + s, ""), values).then((r) => r.rows);
  sql.unsafe = (/** @type {string} */ text, /** @type {unknown[]} */ params = []) => (params.length ? on.query(text, params).then((r) => r.rows) : on.exec(text).then((rs) => rs.at(-1)?.rows ?? []));
  sql.begin = (/** @type {(tx: any) => Promise<any>} */ fn) => /** @type {NonNullable<typeof on.transaction>} */ (on.transaction)((tx) => fn(pgliteSql(tx)));
  sql.end = async () => undefined;
  return sql;
}
