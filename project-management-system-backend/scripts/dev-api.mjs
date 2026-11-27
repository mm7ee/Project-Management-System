// Runs the Worker locally (wrangler dev on port 8787) against the Neon "dev" branch: local Hyperdrive
// connects straight to the address in PG_DEV (.dev.vars), so the live database is never touched.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// The Worker serves the frontend's build as its assets, and wrangler needs that folder to exist. Running the API
// on its own (npm run dev) doesn't build it, so an empty one with a pointer page stands in until a real build.
const dist = new URL("../../project-management-system-frontend/dist/", import.meta.url);
if (!existsSync(dist)) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    new URL("index.html", dist),
    "<!doctype html><meta charset=utf-8><title>Pulse API</title><p>This is the Pulse API on its own. Open the frontend at <a href=\"http://localhost:5173\">http://localhost:5173</a> (npm run dev in project-management-system-frontend), or run npm run dev:api here to serve a built copy of the pages.</p>",
  );
}

const child = spawn("npx", ["--yes", "wrangler@4", "dev", "--port", "8787", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: dev },
});
child.on("exit", (code) => process.exit(code ?? 0));
