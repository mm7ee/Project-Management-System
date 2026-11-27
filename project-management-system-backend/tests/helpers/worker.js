// Runs the real Worker (worker/index.js) in the test process against a real Postgres. By default that is PGlite,
// in this process, with every migration applied (tests/helpers/pglite.js): npm test runs it, here and in CI. With
// PULSE_DB=dev (or stage) it is the Neon "dev" branch (or a branch of production), never the live database.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import worker from "../../src/index.js";
import { databaseOver, pgDatabase } from "../../src/pg.js";
import { migratedPglite, pgliteClient, pgliteSql } from "./pglite.js";

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
/** Which database the database tests use: "pglite" (the default), or a Neon address. Refuses the live database. */
export function testDatabase() {
  const which = process.env.PULSE_DB;
  if (!which || which === "pglite") return "pglite";
  const key = { dev: "PG_DEV", stage: "PG_STAGE" }[which];
  if (!key) throw new Error(`PULSE_DB must be dev or stage, not "${which}"`);
  const url = devVar(key);
  if (!url) throw new Error(`${key} isn't set (in .dev.vars or the environment)`);
  const live = devVar("PG_MAIN");
  if (live && new URL(live).host === new URL(url).host) throw new Error(`${key} points at the live database`);
  return url;
}

/**
 * One test file's database: `root`, the Worker's own adapter over it (handed to the Worker as PG_ROOT), and
 * `sql`, a direct postgres.js-style connection for setting up and checking rows.
 * @param {string} target "pglite" or a Neon address (testDatabase)
 */
export async function testBackend(target) {
  if (target === "pglite") {
    const pg = await migratedPglite();
    const client = pgliteClient(pg);
    return { root: databaseOver(() => client), sql: /** @type {any} */ (pgliteSql(pg)), close: () => pg.close() };
  }
  // From a laptop the database is far away: connections are closed when idle and a dropped query is tried again.
  const sql = postgres(target, { max: 2, idle_timeout: 10, onnotice: () => undefined });
  return { root: pgDatabase(target, { idle_timeout: 10, retry_dropped: true }), sql, close: () => sql.end() };
}

/**
 * A client for one test file: calls the Worker as a browser would, keeping each person's cookie.
 * @param {{ root: TenantDatabase }} backend
 */
export function workerClient(backend) {
  /** @type {Promise<unknown>[]} */ let pending = [];
  // In Workers each request's connection ends with the request. Here they would pile up, so one adapter is shared,
  // handed to the Worker as PG_ROOT (withDatabase in worker/index.js). It is the same adapter code the Worker uses,
  // and it scopes each request the same way.
  const shared = backend.root;
  /** Everything sent to the stand-in Workers AI (Ask Pulse), to check what a question could reveal. */
  /** @type {unknown[]} */ const aiInputs = [];
  const env = /** @type {any} */ ({
    PG_ROOT: shared,
    DATABASE: "postgres",
    AI: {
      run: async (/** @type {string} */ _model, /** @type {Record<string, unknown>} */ input) => {
        aiInputs.push(input);
        if (input.stream) return new ReadableStream({ start: (c) => c.close() });
        return { response: "project = NOPE" };
      },
    },
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
  return { call, signIn, root: shared, aiInputs };
}

