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

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** Workers AI: runs a model on Cloudflare's network. */
interface Ai {
  // A { response } object, or a ReadableStream of server-sent events when called with stream: true.
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai; // Workers AI binding, for Ask OmniPulse
  MFA_KEY?: string; // encrypts two-step verification secrets; a Worker secret (.dev.vars locally)
}
