// The slice of the Cloudflare Workers runtime this Worker uses (keeps us off the
// @cloudflare/workers-types dependency).

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

/** Whose data a query may see: one organisation and, within it, one workspace ("" for organisation-wide work). */
interface Scope {
  orgId: string;
  workspaceId: string;
}

/**
 * The Postgres database (worker/pg.js). A handle with a scope runs every query as the pulse_app role with that
 * tenant set, so row-level security shows and accepts only that tenant's rows. The root handle (no scope) is the
 * owner and sees everything: only for working out who is asking, the cron's loops and the clean-up.
 */
interface TenantDatabase extends D1Database {
  readonly scope: Scope | null;
  withScope(scope: Scope): TenantDatabase;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** Workers AI: runs a model on Cloudflare's network. */
interface Ai {
  // A { response } object, or a ReadableStream of server-sent events when called with stream: true.
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  // Documents (PDF, Office, HTML…) as Markdown, on Cloudflare (Ask AI reads uploads with it).
  toMarkdown?(files: { name: string; blob: Blob }[]): Promise<{ name: string; mimeType?: string; format: "markdown" | "error"; data?: string; error?: string; tokens?: number }[]>;
}

/** Cloudflare Hyperdrive: a pooled, cached connection to the Postgres database. */
interface Hyperdrive {
  connectionString: string;
}

interface Env {
  DB: TenantDatabase; // scoped to the request's tenant once known; before that, to no tenant (sees nothing). Set by withDatabase()
  ROOT: TenantDatabase; // the owner: identity, cron loops, clean-up. Never for reading a tenant's data on its behalf
  PG_ROOT?: TenantDatabase; // tests: a ready database instead of HYPERDRIVE
  HYPERDRIVE?: Hyperdrive; // Postgres on Neon
  D1?: D1Database; // the old D1 database: retired (Phase 1), still bound, never used
  DATABASE?: "postgres" | "d1"; // must be "postgres"; "d1" is refused since multi-tenancy
  ASSETS: Fetcher;
  AI?: Ai; // Workers AI binding, for the assistant (Ask AI)
  BRANDING_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> }; // per-address limit on the public branding lookup
  MFA_KEY?: string; // encrypts two-step verification secrets; a Worker secret (.dev.vars locally)
  PUBLIC_URL?: string; // the system's address, for links in emails and Teams posts
  GIPHY_API_KEY?: string; // turns on GIF search in chat; a Worker secret (wrangler secret put GIPHY_API_KEY)
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
