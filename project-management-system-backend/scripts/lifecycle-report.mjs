// Prints where an organisation's projects sit in their lifecycle (after migration 0026), from a Neon branch.
//   node scripts/lifecycle-report.mjs dev|main [organisation code, default omnicontact]
// Read-only: one SELECT.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [target = "dev", code = "omnicontact"] = process.argv.slice(2);
const key = { dev: "PG_DEV", main: "PG_MAIN" }[target];
if (!key) throw new Error("Usage: node scripts/lifecycle-report.mjs dev|main [code]");
const vars = readFileSync(join(root, ".dev.vars"), "utf8");
const url = process.env[key] ?? vars.match(new RegExp(`^${key}=["']?([^"'\\r\\n]+)`, "m"))?.[1];
if (!url) throw new Error(`No ${key} in .dev.vars`);
const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  const rows = await sql`
    SELECT w.name AS workspace, s.data::jsonb->>'name' AS project, s.data::jsonb->>'status' AS status, l.stage_code, l.state, h.reason
    FROM systems s JOIN organizations o ON o.id = s.organization_id JOIN workspaces w ON w.id = s.workspace_id
    LEFT JOIN project_lifecycle l ON l.system_id = s.id
    LEFT JOIN LATERAL (SELECT reason FROM project_stage_history x WHERE x.system_id = s.id ORDER BY x.id LIMIT 1) h ON true
    WHERE o.code = ${code} ORDER BY l.stage_code NULLS FIRST, w.name, 2`;
  const by = {};
  for (const r of rows) by[r.stage_code ?? "NOT MAPPED"] = (by[r.stage_code ?? "NOT MAPPED"] ?? 0) + 1;
  console.log(`${target}: ${rows.length} projects in ${code}`, by);
  for (const r of rows) console.log(`  ${(r.stage_code ?? "—").padEnd(12)} ${r.state ?? ""}\t${r.workspace} | ${r.project} (${r.status}) ${r.reason ? `· ${r.reason}` : ""}`);
} finally {
  await sql.end();
}
