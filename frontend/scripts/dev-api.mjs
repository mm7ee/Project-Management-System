// Runs the Worker locally (wrangler dev on port 8787) against the Neon "dev" branch: local Hyperdrive
// connects straight to the address in PG_DEV (.dev.vars), so the live database is never touched.

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

let dev = process.env.PG_DEV;
if (!dev) {
  try {
    dev = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("PG_DEV="))
      ?.slice(7)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    // reported below
  }
}
if (!dev) {
  console.error("PG_DEV isn't in .dev.vars. Add the Neon dev branch's connection string first.");
  process.exit(1);
}

const child = spawn("npx", ["--yes", "wrangler@4", "dev", "--port", "8787", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: dev },
});
child.on("exit", (code) => process.exit(code ?? 0));
