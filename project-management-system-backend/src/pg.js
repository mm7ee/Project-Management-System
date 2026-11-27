// the system's database is Postgres (Neon), reached through Cloudflare Hyperdrive. The Worker was written
// against D1's small API (prepare → bind → first/all/run, and batch), so this file gives Postgres that
// same API: queries keep their `?` placeholders and their shape, and a batch runs as one transaction,
// as it did on D1. The few SQL differences (case-insensitive matching, ignoring duplicates) are written
// in Postgres form where they're used.
import postgres from "postgres";
/**
 * `?` placeholders become `$1, $2, …`, skipping any `?` inside quoted text.
 * @param {string} query
 * @returns {string}
 */
export function numberPlaceholders(query) {
  let out = "";
  let n = 0;
  /** @type {string | null} */ let quote = null;
  for (const ch of query) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      out += `$${++n}`;
    } else out += ch;
  }
  return out;
}
/** D1 accepted undefined (as null) and Uint8Array (as a blob); Postgres wants null and bytes it can send. */
const toParam =
  /**
   * @param {unknown} v
   * @returns {unknown}
   */ (v) => {
    if (v === undefined) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  };
// ---------- tenants ----------
// A scoped handle runs each query in its own short transaction that first switches to the pulse_app role
// (which can't bypass row-level security) and sets the tenant: SET LOCAL lasts only for that transaction,
// which is what Hyperdrive's transaction pooling keeps (a session-level SET would be reset). The prologue and
// the query are sent together (pipelined), so this costs one extra round trip for BEGIN and one for COMMIT.
// With no tenant set ("" for both), row-level security shows nothing and accepts nothing: forgetting the
// scope fails closed. Migration 0014 creates the role and the policies.
const SAFE_ID = /^[A-Za-z0-9_-]{0,64}$/;
/** @type {Scope} */ export const NO_TENANT = Object.freeze({ orgId: "", workspaceId: "" });
/**
 * @param {Scope} s
 * @returns {Scope}
 */
function checkScope(s) {
  if (!s || typeof s.orgId !== "string" || typeof s.workspaceId !== "string" || !SAFE_ID.test(s.orgId) || !SAFE_ID.test(s.workspaceId)) {
    throw new Error("Not a valid tenant");
  }
  if (s.workspaceId && !s.orgId) throw new Error("A workspace needs its organisation");
  return Object.freeze({ orgId: s.orgId, workspaceId: s.workspaceId });
}
/**
 * The statements that open a scoped transaction. The ids are checked against SAFE_ID above, so they can be
 * written into the text (the simple protocol, which allows several statements, takes no parameters).
 * @param {Scope} s
 */
const prologue = (s) => `SET LOCAL ROLE pulse_app; SELECT set_config('app.org_id', '${s.orgId}', true), set_config('app.workspace_id', '${s.workspaceId}', true)`;

/**
 * The env for work done for one tenant: its database handle sees that tenant only.
 * @param {Env} env
 * @param {Scope} scope
 * @returns {Env}
 */
export const tenantEnv = (env, scope) => ({ ...env, DB: env.ROOT.withScope(scope) });

/**
 * Tests only (`retry_dropped`): runners whose query is tried once more when the connection dropped under it. From
 * a laptop the database is far away and the way there drops connections; in production (Hyperdrive, next to the
 * database) nothing is ever retried.
 * @type {WeakSet<Function>}
 */
const RETRYING = new WeakSet();
const DROPPED = new Set(["ECONNRESET", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "EPIPE", "ETIMEDOUT"]);
/**
 * @template T
 * @param {Function} runner
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function againOnDrop(runner, run) {
  try {
    return await run();
  } catch (e) {
    if (!RETRYING.has(runner) || !DROPPED.has(/** @type {{ code?: string }} */ (e)?.code ?? "")) throw e;
    return run();
  }
}

class Statement {
  runner;
  text;
  params;
  scope;
  /**
   * @param {() => Sql} runner
   * @param {string} text
   * @param {unknown[]} [params=[]]
   * @param {Scope | null} [scope=null]
   */
  constructor(runner, text, params = [], scope = null) {
    this.runner = runner;
    this.text = text;
    this.params = params;
    this.scope = scope;
  }
  /**
   * @param {...unknown} values
   * @returns {D1PreparedStatement}
   */
  bind(...values) {
    return new Statement(this.runner, this.text, values.map(toParam), this.scope);
  }
  /**
   * @param {Runner} [on] a transaction already set up (a batch); otherwise one is opened for a scoped handle
   * @returns {Promise<D1Result>}
   */
  async exec(on) {
    /** @type {any} */ let rows;
    if (on) rows = await on.unsafe(this.text, /** @type {never[]} */ (this.params));
    else if (!this.scope) rows = await againOnDrop(this.runner, () => this.runner().unsafe(this.text, /** @type {never[]} */ (this.params)));
    else {
      const s = this.scope;
      const out = /** @type {any[]} */ (
        /** @type {unknown} */ (
          await againOnDrop(this.runner, () =>
            this.runner().begin((tx) => /** @type {any} */ ([tx.unsafe(prologue(s)).simple(), tx.unsafe(this.text, /** @type {never[]} */ (this.params))])),
          )
        )
      );
      rows = out[1];
    }
    return { results: /** @type {unknown[]} */ ([...rows]), success: true, meta: { changes: rows.count ?? 0 } };
  }
  /**
   * @template [T=Record<string, unknown>]
   * @returns {Promise<T | null>}
   */
  async first() {
    return /** @type {T | undefined} */ ((await this.exec()).results[0]) ?? null;
  }
  /**
   * @template [T=Record<string, unknown>]
   * @returns {Promise<D1Result<T>>}
   */
  async all() {
    return /** @type {D1Result<T>} */ (await this.exec());
  }
  /**
   * @returns {Promise<D1Result>}
   */
  run() {
    return this.exec();
  }
}
/**
 * A D1-shaped database on Postgres. One connection per request (Hyperdrive keeps the real ones open),
 * made on first use, so requests that never touch the database never connect. This is the root handle
 * (the owner, no tenant); `withScope` gives handles that see one tenant.
 * @param {string} connectionString
 * @param {{ idle_timeout?: number; retry_dropped?: boolean }} [options] tests only, from a laptop to the database far
 *   away: close connections after this many idle seconds, and try a query once more when its connection dropped
 * @returns {TenantDatabase}
 */
export function pgDatabase(connectionString, { retry_dropped = false, ...options } = {}) {
  /** @type {Sql | null} */ let sql = null;
  return databaseOver(clientFor(connectionString, options, () => sql, (s) => (sql = s)), retry_dropped);
}
/**
 * The postgres.js client, made on first use.
 * @param {string} connectionString
 * @param {Record<string, unknown>} options
 * @param {() => Sql | null} get
 * @param {(s: Sql) => void} set
 * @returns {() => Sql}
 */
function clientFor(connectionString, options, get, set) {
  return () => {
    const ready = get();
    if (ready) return ready;
    const made = postgres(connectionString, {
      max: 5,
      // Hyperdrive caches prepared statements; looking up custom types would cost a round trip every time.
      fetch_types: false,
      prepare: true,
      // Counts and big numbers come back as numbers, as they did from D1 (none get near 2^53).
      types: {
        bigint: { to: 20, from: [20], serialize: /** @param {number} x */ (x) => String(x), parse: /** @param {string} x */ (x) => Number(x) },
        numeric: { to: 1700, from: [1700], serialize: /** @param {number} x */ (x) => String(x), parse: /** @param {string} x */ (x) => Number(x) },
      },
      onnotice: () => undefined,
      ...options,
    });
    set(made);
    return made;
  };
}
/**
 * The handles (root, and scoped ones from it) over any client with the part of postgres.js this file uses:
 * `unsafe(text, params)` (rows, with `count`), `unsafe(text).simple()` for several statements, and
 * `begin(fn)`, where fn may return an array of queries to run in order. In production that is postgres.js;
 * the tests give PGlite the same shape (tests/helpers/pglite.js), so the same scoping code is what they test.
 * @param {() => Sql} client
 * @param {boolean} [retry_dropped=false]
 * @returns {TenantDatabase}
 */
export function databaseOver(client, retry_dropped = false) {
  if (retry_dropped) RETRYING.add(client);
  /**
   * @param {Scope | null} scope
   * @returns {TenantDatabase}
   */
  const handle = (scope) => ({
    scope,
    withScope: (s) => handle(checkScope(s)),
    prepare: /** @param {string} query */ (query) => new Statement(client, numberPlaceholders(query), [], scope),
    // D1 ran a batch as one transaction: all of it happens, or none of it.
    async batch(statements) {
      if (!statements.length) return [];
      return /** @type {D1Result[]} */ (
        /** @type {unknown} */ (
          await againOnDrop(client, () => client().begin(async (tx) => {
            if (scope) await tx.unsafe(prologue(scope)).simple();
            /** @type {D1Result[]} */ const results = [];
            for (const s of statements) {
              const st = /** @type {Statement} */ (s);
              // A statement prepared on another tenant's handle must not run inside this tenant's transaction.
              if (st.scope !== scope && (st.scope?.orgId !== scope?.orgId || st.scope?.workspaceId !== scope?.workspaceId)) {
                throw new Error("A batch mixes statements of different tenants");
              }
              results.push(await st.exec(/** @type {Runner} */ (/** @type {unknown} */ (tx))));
            }
            return results;
          }))
        )
      );
    },
  });
  return handle(null);
}
/** @typedef {ReturnType<typeof postgres>} Sql */
/** @typedef {Pick<Sql, "unsafe">} Runner */
