// Runs the frontend and the backend together, in one terminal (npm run dev at the repository root, or
// npm run dev:all here):
//   backend   the API on http://127.0.0.1:8787, against the Neon dev branch (npm run dev here)
//   frontend  Vite on http://localhost:5173, sending /api to the backend (npm run dev in the frontend)
// Each line is labelled with where it came from. Ctrl+C, or either one stopping, stops both.

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = (/** @type {string} */ p) => fileURLToPath(new URL(p, import.meta.url));
const parts = [
  { name: "backend ", colour: 35, cwd: here("../") },
  { name: "frontend", colour: 36, cwd: here("../../project-management-system-frontend/") },
];

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    // On Windows npm runs under a shell: end the whole process tree, or wrangler and Vite keep running.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-c.pid, "SIGTERM"); // its process group (started detached)
      } catch {
        c.kill("SIGTERM");
      }
    }
  }
  process.exitCode = code;
}

for (const part of parts) {
  const child = spawn("npm", ["run", "dev"], {
    cwd: part.cwd,
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  children.push(child);
  const label = `\x1b[${part.colour}m[${part.name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream?.on("data", (/** @type {Buffer} */ chunk) => {
      const lines = (rest + chunk.toString()).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(label + line + "\n");
    });
  }
  child.on("exit", (code) => {
    if (!stopping) {
      process.stdout.write(`${label}stopped (${code ?? "signal"}), so the other one is stopping too.\n`);
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
console.log("PMS: the backend on http://127.0.0.1:8787 and the frontend on http://localhost:5173. Open the frontend. Ctrl+C stops both.");
