// Runs the real Worker (worker/index.js) in the test process against a real Postgres: the Neon "dev"
// branch, or a branch of production for staging (never the live database). Database tests only run when
// PULSE_DB says which: `PULSE_DB=dev npx vitest run tests/tenancy` (npm test skips them).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import worker from "../../worker/index.js";
import { pgDatabase } from "../../worker/pg.js";

const VARS = fileURLToPath(new URL("../../.dev.vars", import.meta.url));
/** @param {string} key */
export function devVar(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(VARS, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}
/** Which database the database tests use, or null to skip them. Refuses the live database. */
export function testDatabase() {
  const which = process.env.PULSE_DB;
  if (!which) return null;
  const key = { dev: "PG_DEV", stage: "PG_STAGE" }[which];
  if (!key) throw new Error(`PULSE_DB must be dev or stage, not "${which}"`);
  const url = devVar(key);
  if (!url) throw new Error(`${key} isn't set (in .dev.vars or the environment)`);
  const live = devVar("PG_MAIN");
  if (live && new URL(live).host === new URL(url).host) throw new Error(`${key} points at the live database`);
  return url;
}

/**
 * A client for one test file: calls the Worker as a browser would, keeping each person's cookie.
 * @param {string} url
 */
export function workerClient(url) {
  /** @type {Promise<unknown>[]} */ let pending = [];
  // In Workers each request's connection ends with the request. Here they would pile up until the database
  // refused more, so one adapter is shared, handed over through the Worker's "use env.D1 as the database"
  // switch (withDatabase in worker/index.js). It is the same Postgres adapter the Worker builds itself.
  const shared = pgDatabase(url);
  const env = /** @type {any} */ ({
    D1: shared,
    DATABASE: "d1",
    MFA_KEY: devVar("MFA_KEY") ?? "test-only-key",
    PUBLIC_URL: "http://localhost",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  });
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => pending.push(p), passThroughOnException() {} };
  /**
   * @param {string} path
   * @param {{ method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> }} [o]
   */
  async function call(path, o = {}) {
    const headers = { "content-type": "application/json", ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) };
    const res = await worker.fetch(new Request(`http://localhost${path}`, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), env, /** @type {any} */ (ctx));
    // Background work (notifications, automation, audit) finishes before the next step looks at the database.
    const now = pending;
    pending = [];
    await Promise.allSettled(now);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
  }
  /** Signs in (password only: the QA accounts have no two-step) and returns the session cookie. */
  async function signIn(/** @type {string} */ username, /** @type {string} */ password) {
    const r = await call("/api/login", { method: "POST", body: { username, password } });
    if (r.status !== 200 || !r.cookie) throw new Error(`Sign-in as ${username} failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.cookie;
  }
  return { call, signIn };
}

/** A direct database connection, for setting up and checking rows. */
export const database = (/** @type {string} */ url) => postgres(url, { max: 2, onnotice: () => undefined });
