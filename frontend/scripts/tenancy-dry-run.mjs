// Dry run of the tenancy migration (migrations/0013_tenancy_schema.sql): runs the real file inside a
// transaction, reports what it would do, then rolls everything back. Nothing is changed.
//
//   node scripts/tenancy-dry-run.mjs dev            the Neon "dev" branch (PG_DEV in .dev.vars)
//   node scripts/tenancy-dry-run.mjs stage          a Neon branch made from production (PG_STAGE in .dev.vars)
//   … --out report.md                               also write the report to a file
//
// It refuses the live database (PG_MAIN): make a branch of production in Neon and point PG_STAGE at it.
//
// The report: rows per table before and after, per workspace; every placement that needs a look
// (tenancy_report); and every row that would be set aside (tenancy_orphans), by table and reason.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args[0];
const outAt = args.indexOf("--out");
const outFile = outAt >= 0 ? args[outAt + 1] : null;
const MIGRATION = "0013_tenancy_schema.sql";

function fail(message) {
  console.error(message);
  process.exit(1);
}
const key = { dev: "PG_DEV", stage: "PG_STAGE" }[target];
if (target === "main") fail("The dry run never connects to the live database. Make a Neon branch from production, put its address in .dev.vars as PG_STAGE, and run: node scripts/tenancy-dry-run.mjs stage");
if (!key) fail("Usage: node scripts/tenancy-dry-run.mjs dev|stage [--out report.md]");
function connectionString() {
  if (process.env[key]) return process.env[key];
  let vars = "";
  try {
    vars = readFileSync(join(root, ".dev.vars"), "utf8");
  } catch {
    fail("No .dev.vars file.");
  }
  const line = vars.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) fail(`${key} isn't in .dev.vars yet.`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}
const url = connectionString();
// Belt and braces: even under another name, never the live database's address.
const live = (() => {
  try {
    const vars = readFileSync(join(root, ".dev.vars"), "utf8");
    const line = vars.split(/\r?\n/).find((l) => l.startsWith("PG_MAIN="));
    return line ? new URL(line.slice(8).trim().replace(/^["']|["']$/g, "")).host : null;
  } catch {
    return null;
  }
})();
const host = new URL(url).host;
if (live && host === live) fail(`${key} points at the live database (${host}). Use a branch of production instead.`);

const sql = postgres(url, { max: 1, onnotice: () => undefined, types: { bigint: postgres.BigInt } });
const n = (v) => Number(v);
const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

class Rollback extends Error {}

const started = Date.now();
try {
  await sql.begin(async (tx) => {
    const applied = await tx`SELECT 1 FROM schema_migrations WHERE name = ${MIGRATION}`.catch(() => []);
    if (applied.length) fail(`${MIGRATION} is already applied on ${target}.`);
    const tables = (
      await tx`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name`
    ).map((r) => r.table_name);
    const before = new Map();
    for (const t of tables) before.set(t, n((await tx.unsafe(`SELECT count(*) AS c FROM "${t}"`))[0].c));

    const t0 = Date.now();
    await tx.unsafe(readFileSync(join(root, "migrations", MIGRATION), "utf8"));
    const took = Date.now() - t0;

    const workspaces = await tx`SELECT w.id, w.name, w.key, o.name AS org FROM workspaces w JOIN organizations o ON o.id = w.organization_id ORDER BY w.position`;
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const members = await tx`SELECT workspace_id, count(*) AS c FROM workspace_members GROUP BY workspace_id`;

    say(`# Tenancy migration: dry run on ${target} (${host})`);
    say();
    say(`Run at ${new Date().toISOString()}. The migration took ${(took / 1000).toFixed(1)} s, then everything was rolled back.`);
    say();
    say(`## Workspaces created (organisation "${workspaces[0]?.org}")`);
    say();
    say("| Workspace | Key | Members |");
    say("| --- | --- | ---: |");
    for (const w of workspaces) say(`| ${w.name} | ${w.key} | ${n(members.find((m) => m.workspace_id === w.id)?.c ?? 0)} |`);
    say();

    say("## Rows per table per workspace");
    say();
    say("Before is the row count now; after is once migrated. They differ only by rows set aside.");
    say();
    const cols = ["Table", "Before", "After", ...workspaces.map((w) => w.name), "Organisation-wide"];
    say(`| ${cols.join(" | ")} |`);
    say(`| ${cols.map((_, i) => (i ? "---:" : "---")).join(" | ")} |`);
    let mismatch = false;
    const orphanCounts = new Map((await tx`SELECT table_name, count(*) AS c FROM tenancy_orphans GROUP BY table_name`).map((r) => [r.table_name, n(r.c)]));
    for (const t of tables) {
      const after = n((await tx.unsafe(`SELECT count(*) AS c FROM "${t}"`))[0].c);
      const hasWs = (await tx`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t} AND column_name = 'workspace_id'`).length > 0;
      const per = hasWs ? await tx.unsafe(`SELECT workspace_id, count(*) AS c FROM "${t}" GROUP BY workspace_id`) : [];
      const cells = workspaces.map((w) => (hasWs ? String(n(per.find((p) => p.workspace_id === w.id)?.c ?? 0)) : "–"));
      const orgWide = hasWs ? String(n(per.find((p) => p.workspace_id === null)?.c ?? 0)) : String(after);
      const set = orphanCounts.get(t) ?? 0;
      if (before.get(t) - set !== after) mismatch = true;
      say(`| ${t} | ${before.get(t)} | ${after}${set ? ` (${set} set aside)` : ""} | ${cells.join(" | ")} | ${orgWide} |`);
    }
    say();
    if (mismatch) say("**Warning:** some table's count changed by more than the rows set aside. Look before migrating.");

    const report = await tx`SELECT table_name, row_id, workspace_id, outcome, reason FROM tenancy_report ORDER BY outcome, table_name, id`;
    for (const [outcome, title] of [
      ["default_workspace", "Placed in a default workspace (check these)"],
      ["reference_cleared", "References cleared (the row stays; one link to another workspace is removed)"],
      ["moved_to_orphans", "Set aside in tenancy_orphans (kept whole, removed from the table)"],
      ["summary", "Summary"],
    ]) {
      const rows = report.filter((r) => r.outcome === outcome);
      say(`## ${title}: ${rows.length}`);
      say();
      if (!rows.length) {
        say("None.");
        say();
        continue;
      }
      say("| Table | Row | Workspace | Why |");
      say("| --- | --- | --- | --- |");
      for (const r of rows) say(`| ${r.table_name} | ${r.row_id ?? ""} | ${wsName.get(r.workspace_id) ?? (r.workspace_id ? r.workspace_id : outcome === "default_workspace" ? "Projects" : "")} | ${String(r.reason).replace(/\|/g, "\\|")} |`);
      say();
    }
    say(`Finished in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error(`\nThe migration failed on ${target}; nothing was changed:\n${e.message}`);
    if (e.where) console.error(e.where);
    await sql.end();
    process.exit(1);
  }
}
await sql.end();
if (outFile) {
  writeFileSync(outFile, lines.join("\n") + "\n");
  console.log(`\nWritten to ${outFile}`);
}
