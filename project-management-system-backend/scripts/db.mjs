// Pulse's database tool for Postgres (Neon). Reads the connection strings from .dev.vars (never committed):
//   PG_MAIN=postgresql://…   the live database (Neon branch "main")
//   PG_DEV=postgresql://…    for local testing (Neon branch "dev")
//
//   node scripts/db.mjs migrate main|dev          apply new files in migrations/, in order, once each
//   node scripts/db.mjs status  main|dev          which migrations are applied, and row counts
//   node scripts/db.mjs exec    main|dev <file>   run a .sql file (e.g. demo data) in one transaction
//   node scripts/db.mjs copy    main|dev <dump>   load a D1 export (wrangler d1 export … --output=dump.sql)
//                                                 into empty tables, then check every row arrived
//   node scripts/db.mjs backup  main|dev <file>   write every row (and the applied migrations) to a .sql file
//                                                 of INSERTs; restore by migrating an empty database and running it
//
// npm scripts wrap the common ones: db:migrate, db:migrate:dev, db:status, demo:seed, demo:remove.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, target, file] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function connectionString(which) {
  const key = { main: "PG_MAIN", dev: "PG_DEV" }[which];
  if (!key) fail(`Say which database: main (live) or dev. Usage: node scripts/db.mjs ${command ?? "<command>"} main|dev`);
  if (process.env[key]) return process.env[key];
  let vars = "";
  try {
    vars = readFileSync(join(root, ".dev.vars"), "utf8");
  } catch {
    fail("No .dev.vars file. Add PG_MAIN and PG_DEV to it (see the top of this script).");
  }
  const line = vars.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) fail(`${key} isn't in .dev.vars yet.`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

if (!["migrate", "status", "exec", "copy", "backup"].includes(command)) fail("Usage: node scripts/db.mjs migrate|status|exec|copy|backup main|dev [file]");

const url = connectionString(target);
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "(unreadable address)";
  }
})();
const sql = postgres(url, { max: 1, onnotice: () => undefined, types: { bigint: postgres.BigInt } });
const label = `${target} (${host})`;

async function migrate() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = readdirSync(join(root, "database", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !done.has(f));
  if (!pending.length) return console.log(`${label}: no migrations to apply.`);
  for (const f of pending) {
    const text = readFileSync(join(root, "database", "migrations", f), "utf8");
    // Each file applies completely or not at all.
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name, applied_at) VALUES (${f}, ${new Date().toISOString()})`;
    });
    console.log(`${label}: applied ${f}`);
  }
}

async function tables() {
  return (
    await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name`
  ).map((r) => r.table_name);
}

async function status() {
  const applied = await sql`SELECT name, applied_at FROM schema_migrations ORDER BY name`.catch(() => []);
  const files = readdirSync(join(root, "database", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  console.log(`${label}`);
  for (const f of files) {
    const a = applied.find((r) => r.name === f);
    console.log(`  ${a ? "applied" : "PENDING"}  ${f}${a ? `  (${a.applied_at})` : ""}`);
  }
  for (const t of await tables()) {
    const [{ n }] = await sql.unsafe(`SELECT COUNT(*) AS n FROM "${t}"`);
    console.log(`  ${String(n).padStart(6)}  ${t}`);
  }
}

async function exec() {
  if (!file) fail("Give the .sql file to run.");
  const text = readFileSync(file, "utf8");
  await sql.begin((tx) => tx.unsafe(text));
  console.log(`${label}: ran ${file}`);
}

/** Loads a D1 export into Postgres: SQLite reads the export exactly, then each row is copied across. */
async function copy() {
  if (!file) fail("Give the D1 export to copy from (wrangler d1 export omni-tracker --remote --output=<file>).");
  const { DatabaseSync } = await import("node:sqlite");
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync(file, "utf8"));
  const liteTables = new Set(lite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const pgTables = await tables();

  // Refuse to mix with existing data: copying is for an empty, freshly migrated database.
  for (const t of pgTables) {
    const [{ n }] = await sql.unsafe(`SELECT COUNT(*) AS n FROM "${t}"`);
    if (Number(n) > 0) fail(`${label}: "${t}" already has ${n} rows. Copy only into an empty database.`);
  }

  const report = [];
  await sql.begin(async (tx) => {
    for (const t of pgTables) {
      if (!liteTables.has(t)) {
        report.push([t, 0, 0, "not in the export"]);
        continue;
      }
      const pgCols = (
        await tx`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t} ORDER BY ordinal_position`
      ).map((r) => r.column_name);
      const liteCols = lite.prepare(`PRAGMA table_info("${t}")`).all().map((r) => r.name);
      // rowid is SQLite's own row number; it keeps the order rows were added in.
      const cols = pgCols.filter((c) => liteCols.includes(c) || c === "rowid");
      const select = cols.map((c) => (c === "rowid" && !liteCols.includes("rowid") ? "rowid AS rowid" : `"${c}"`)).join(", ");
      const rows = lite.prepare(`SELECT ${select} FROM "${t}"`).all();
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map((r) => {
          const out = {};
          for (const c of cols) out[c] = r[c] instanceof Uint8Array ? Buffer.from(r[c]) : r[c];
          return out;
        });
        await tx`INSERT INTO ${tx(t)} ${tx(chunk, cols)}`;
      }
      // Serial columns carry on from the highest copied value.
      for (const c of cols) {
        const [{ seq }] = await tx`SELECT pg_get_serial_sequence(${t}, ${c}) AS seq`;
        if (seq) await tx.unsafe(`SELECT setval('${seq}', GREATEST((SELECT COALESCE(MAX("${c}"), 0) FROM "${t}"), 1))`);
      }
      const [{ n }] = await tx.unsafe(`SELECT COUNT(*) AS n FROM "${t}"`);
      report.push([t, rows.length, Number(n), Number(n) === rows.length ? "ok" : "MISMATCH"]);
    }
    if (report.some((r) => r[3] === "MISMATCH")) throw new Error("Row counts don't match; nothing was copied.");
  });

  const skipped = [...liteTables].filter((t) => !pgTables.includes(t) && !t.startsWith("_cf_") && !t.startsWith("sqlite_"));
  console.log(`${label}: copied from ${file}`);
  for (const [t, from, to, note] of report) console.log(`  ${String(from).padStart(6)} → ${String(to).padStart(6)}  ${t}  ${note}`);
  if (skipped.length) console.log(`  not copied (no such table in Postgres): ${skipped.join(", ")}`);
}

/** A SQL literal for one value, as postgres.js returns it. */
function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'::bytea`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Writes every table's rows as INSERTs, in one snapshot, then checks the file holds them all. */
async function backup() {
  if (!file) fail("Give the file to write, e.g. database/backups/backup-before-phase-1.sql");
  const { writeFileSync } = await import("node:fs");
  const out = [`-- Pulse backup of ${target} (${host}), ${new Date().toISOString()}.`, "-- Restore: migrate an empty database, then run this file (node scripts/db.mjs exec <db> <file>).", "BEGIN;"];
  const counts = [];
  await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
    // Every column, and which are serial, in one round trip (the database is far away).
    const columns = await tx`
      SELECT table_name, column_name, pg_get_serial_sequence(quote_ident(table_name), column_name) AS seq
      FROM information_schema.columns c
      WHERE table_schema = 'public'
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
      ORDER BY table_name, ordinal_position`;
    const names = [...new Set(columns.map((c) => c.table_name))].filter((t) => t !== "schema_migrations");
    for (const t of ["schema_migrations", ...names]) {
      const mine = columns.filter((c) => c.table_name === t);
      const cols = mine.map((c) => c.column_name);
      const rows = await tx.unsafe(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${t}"`);
      out.push(`-- ${t}: ${rows.length} rows`);
      if (t === "schema_migrations") out.push("DELETE FROM schema_migrations;");
      for (const r of rows) out.push(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => literal(r[c])).join(", ")});`);
      for (const c of mine.filter((c) => c.seq)) {
        out.push(`SELECT setval('${c.seq}', GREATEST((SELECT COALESCE(MAX("${c.column_name}"), 0) FROM "${t}"), 1));`);
      }
      counts.push([t, rows.length]);
    }
  });
  out.push("COMMIT;", "");
  writeFileSync(file, out.join("\n"));
  const written = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("INSERT INTO")).length;
  const total = counts.reduce((a, [, n]) => a + n, 0);
  console.log(`${label}: backed up to ${file}`);
  for (const [t, n] of counts) console.log(`  ${String(n).padStart(6)}  ${t}`);
  if (written !== total) fail(`The file holds ${written} rows but the database has ${total}. Don't rely on it.`);
  console.log(`  ${total} rows written and checked.`);
}

try {
  await { migrate, status, exec, copy, backup }[command]();
} catch (e) {
  console.error(`${label}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
