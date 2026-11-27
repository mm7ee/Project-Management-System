// The demo organisation, from the command line (worker/ modules leave off ".js", so this runs through vite-node):
//   npm run demo:org -- dev [--reset]       the Neon dev branch (PG_DEV in .dev.vars)
//   npm run demo:org -- stage [--reset]     a branch of production (PG_STAGE)
//   npm run demo:org -- main --live         the live database: only when asked for
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemo } from "./demo-org.mjs";
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const target = args[0];
  const key = { main: "PG_MAIN", dev: "PG_DEV", stage: "PG_STAGE" }[target ?? ""];
  if (!key) {
    console.error("Usage: npm run demo:org -- dev|stage [--reset]   (main needs --live)");
    process.exit(1);
  }
  if (target === "main" && !args.includes("--live")) {
    console.error("Refusing to put a demo organisation in the live database. Add --live only if that's really wanted.");
    process.exit(1);
  }
  const vars = readFileSync(join(root, ".dev.vars"), "utf8");
  const val = (/** @type {string} */ k) => process.env[k] ?? vars.split(/\r?\n/).find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim().replace(/^["']|["']$/g, "");
  const url = val(key);
  if (!url) {
    console.error(`${key} isn't in .dev.vars`);
    process.exit(1);
  }
  const { default: postgres } = await import("postgres");
  const { pgDatabase } = await import("../worker/pg.js");
  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  try {
    const r = await buildDemo({ root: pgDatabase(url, { idle_timeout: 10, retry_dropped: true }), sql, env: { MFA_KEY: val("MFA_KEY") }, reset: args.includes("--reset"), log: (s) => console.log(s) });
    console.log(`\nDemo Co is ready (${target}).`);
    console.log(`  Organisation code: ${r.code}`);
    console.log(`  Usernames: ${r.usernames.join(", ")}`);
    console.log(`  Password (all of them, shown once): ${r.password}`);
  } finally {
    await sql.end();
  }
  process.exit(0);
}
