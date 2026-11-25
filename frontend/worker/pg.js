// Pulse's database is Postgres (Neon), reached through Cloudflare Hyperdrive. The Worker was written
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
class Statement {
  runner;
  text;
  params;
  /**
   * @param {() => Runner} runner
   * @param {string} text
   * @param {unknown[]} [params=[]]
   */
  constructor(runner, text, params = []) {
    this.runner = runner;
    this.text = text;
    this.params = params;
  }
  /**
   * @param {...unknown} values
   * @returns {D1PreparedStatement}
   */
  bind(...values) {
    return new Statement(this.runner, this.text, values.map(toParam));
  }
  /**
   * @param {Runner} [on=this.runner()]
   * @returns {Promise<D1Result>}
   */
  async exec(on = this.runner()) {
    const rows = await on.unsafe(this.text, /** @type {never[]} */ (this.params));
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
 * made on first use, so requests that never touch the database never connect.
 * @param {string} connectionString
 * @returns {D1Database}
 */
export function pgDatabase(connectionString) {
  /** @type {Sql | null} */ let sql = null;
  const client = /** @returns {Sql} */ () =>
    (sql ??= postgres(connectionString, {
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
    }));
  return {
    prepare: /** @param {string} query */ (query) => new Statement(client, numberPlaceholders(query)),
    // D1 ran a batch as one transaction: all of it happens, or none of it.
    async batch(statements) {
      if (!statements.length) return [];
      return /** @type {D1Result[]} */ (
        /** @type {unknown} */ (
          await client().begin(async (tx) => {
            /** @type {D1Result[]} */ const results = [];
            for (const s of statements) results.push(await /** @type {Statement} */ (s).exec(/** @type {Runner} */ (/** @type {unknown} */ (tx))));
            return results;
          })
        )
      );
    },
  };
}
/** @typedef {ReturnType<typeof postgres>} Sql */
/** @typedef {Pick<Sql, "unsafe">} Runner */
