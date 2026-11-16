// Pulse's database is Postgres (Neon), reached through Cloudflare Hyperdrive. The Worker was written
// against D1's small API (prepare → bind → first/all/run, and batch), so this file gives Postgres that
// same API: queries keep their `?` placeholders and their shape, and a batch runs as one transaction,
// as it did on D1. The few SQL differences (case-insensitive matching, ignoring duplicates) are written
// in Postgres form where they're used.

import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
type Runner = Pick<Sql, "unsafe">;

/** `?` placeholders become `$1, $2, …`, skipping any `?` inside quoted text. */
export function numberPlaceholders(query: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
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
const toParam = (v: unknown): unknown => {
  if (v === undefined) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
};

class Statement implements D1PreparedStatement {
  constructor(
    private readonly runner: () => Runner,
    readonly text: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(this.runner, this.text, values.map(toParam));
  }

  async exec(on: Runner = this.runner()): Promise<D1Result> {
    const rows = await on.unsafe(this.text, this.params as never[]);
    return { results: [...rows] as unknown[], success: true, meta: { changes: rows.count ?? 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return ((await this.exec()).results[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return (await this.exec()) as D1Result<T>;
  }

  run(): Promise<D1Result> {
    return this.exec();
  }
}

/**
 * A D1-shaped database on Postgres. One connection per request (Hyperdrive keeps the real ones open),
 * made on first use, so requests that never touch the database never connect.
 */
export function pgDatabase(connectionString: string): D1Database {
  let sql: Sql | null = null;
  const client = (): Sql =>
    (sql ??= postgres(connectionString, {
      max: 5,
      // Hyperdrive caches prepared statements; looking up custom types would cost a round trip every time.
      fetch_types: false,
      prepare: true,
      // Counts and big numbers come back as numbers, as they did from D1 (none get near 2^53).
      types: {
        bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
        numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      },
      onnotice: () => undefined,
    }));
  return {
    prepare: (query: string) => new Statement(client, numberPlaceholders(query)),
    // D1 ran a batch as one transaction: all of it happens, or none of it.
    async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
      if (!statements.length) return [];
      return (await client().begin(async (tx) => {
        const results: D1Result[] = [];
        for (const s of statements) results.push(await (s as Statement).exec(tx as unknown as Runner));
        return results;
      })) as unknown as D1Result[];
    },
  };
}
