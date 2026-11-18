// Integrations: GitHub (an inbound webhook whose HMAC signature is checked with a secret sealed by
// MFA_KEY; commits, branches and pull requests that mention a key show on that work item), personal API
// tokens (scoped, expiring, stored as a hash, rate-limited, with the owner's permissions), and outbound
// webhooks for work item events (signed with HMAC, retried with backoff). Webhooks and GitHub need
// "manage_integrations"; tokens need "use_api".

import { newToken, openSecret, sealSecret, tokenHash } from "./auth";
import { HttpError, body, json } from "./http";
import { SELECT, keyOf, type ItemContext, type ItemEvent, type ItemRow } from "./workitems";
import {
  API_RATE_LIMIT,
  MAX_TOKENS_PER_PERSON,
  TOKEN_DAYS,
  TOKEN_PREFIX,
  WEBHOOK_BACKOFF_MINUTES,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  type ApiToken,
  type DevLink,
  type DevLinkKind,
  type TokenScope,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from "../src/data/admin";

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Compares two strings in constant time. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function mfaKey(env: Env): string {
  if (!env.MFA_KEY) throw new HttpError(500, "The server's MFA_KEY secret is missing, so secrets can't be sealed");
  return env.MFA_KEY;
}

// ---------- GitHub ----------

const KEY_IN_TEXT = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})\b/g;

/** The work item keys mentioned in some text (case doesn't matter in branch names). */
export function keysIn(text: string): string[] {
  return [...new Set([...text.matchAll(KEY_IN_TEXT)].map((m) => `${m[1].toUpperCase()}-${Number(m[2])}`))];
}

interface LinkFound {
  kind: DevLinkKind;
  repo: string;
  ref: string;
  title: string;
  url: string;
  author: string;
  state?: "open" | "merged" | "closed";
  at: string;
  text: string; // where to look for keys
}

/** What a GitHub event says, as development links. */
function linksFromGitHub(event: string, p: Record<string, unknown>): LinkFound[] {
  const repo = String((p.repository as { full_name?: string } | undefined)?.full_name ?? "");
  const repoUrl = String((p.repository as { html_url?: string } | undefined)?.html_url ?? "");
  if (!repo) return [];
  const out: LinkFound[] = [];
  if (event === "push") {
    const ref = String(p.ref ?? "");
    const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : "";
    for (const c of (p.commits as Record<string, unknown>[] | undefined) ?? []) {
      const message = String(c.message ?? "");
      out.push({
        kind: "commit",
        repo,
        ref: String(c.id ?? "").slice(0, 40),
        title: message.split("\n")[0].slice(0, 200),
        url: String(c.url ?? ""),
        author: String((c.author as { name?: string } | undefined)?.name ?? "").slice(0, 100),
        at: String(c.timestamp ?? new Date().toISOString()),
        text: `${message} ${branch}`,
      });
    }
    if (branch && p.created) out.push({ kind: "branch", repo, ref: branch, title: branch, url: `${repoUrl}/tree/${branch}`, author: String((p.pusher as { name?: string } | undefined)?.name ?? ""), at: new Date().toISOString(), text: branch });
  }
  if (event === "create" && p.ref_type === "branch") {
    const branch = String(p.ref ?? "");
    out.push({ kind: "branch", repo, ref: branch, title: branch, url: `${repoUrl}/tree/${branch}`, author: String((p.sender as { login?: string } | undefined)?.login ?? ""), at: new Date().toISOString(), text: branch });
  }
  if (event === "pull_request") {
    const pr = (p.pull_request ?? {}) as Record<string, unknown>;
    const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
    out.push({
      kind: "pull_request",
      repo,
      ref: String(pr.number ?? ""),
      title: String(pr.title ?? "").slice(0, 200),
      url: String(pr.html_url ?? ""),
      author: String((pr.user as { login?: string } | undefined)?.login ?? ""),
      state,
      at: String(pr.updated_at ?? new Date().toISOString()),
      text: `${pr.title ?? ""} ${(pr.head as { ref?: string } | undefined)?.ref ?? ""} ${pr.body ?? ""}`,
    });
  }
  return out.filter((l) => /^https:\/\/github\.com\//.test(l.url) && l.ref);
}

/** POST /api/integrations/github/webhook: called by GitHub, signed with the shared secret. No session. */
export async function githubWebhook(env: Env, req: Request): Promise<Response> {
  const db = env.DB;
  const raw = await req.text();
  if (raw.length > 5_000_000) throw new HttpError(413, "Too large");
  const row = await db.prepare("SELECT sealed FROM integration_secrets WHERE kind = 'github'").first<{ sealed: string }>();
  if (!row) throw new HttpError(404, "GitHub isn't connected");
  const secret = await openSecret(row.sealed, mfaKey(env));
  const given = req.headers.get("x-hub-signature-256") ?? "";
  if (!sameText(given, `sha256=${await hmacHex(secret, raw)}`)) throw new HttpError(401, "The signature doesn't match");
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = (req.headers.get("x-github-delivery") ?? "").slice(0, 80);
  if (event === "ping") return json({ ok: true, message: "Pulse is listening" });
  if (delivery && (await db.prepare("SELECT 1 FROM github_deliveries WHERE delivery_id = ?").bind(delivery).first())) return json({ ok: true, duplicate: true });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "That isn't JSON");
  }
  const found = linksFromGitHub(event, payload);
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let linked = 0;
  for (const l of found) {
    for (const key of keysIn(l.text)) {
      const [project, number] = key.split("-");
      const item = await db.prepare("SELECT w.id FROM work_items w JOIN systems s ON s.id = w.system_id WHERE s.key = ? AND w.number = ?").bind(project, Number(number)).first<{ id: string }>();
      if (!item) continue;
      linked++;
      stmts.push(
        db
          .prepare(
            `INSERT INTO dev_links (id, item_id, kind, repo, ref, title, url, author, state, at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (item_id, kind, repo, ref) DO UPDATE SET title = excluded.title, url = excluded.url, state = excluded.state, at = excluded.at, updated_at = excluded.updated_at`,
          )
          .bind(newToken().slice(0, 16), item.id, l.kind, l.repo.slice(0, 200), l.ref.slice(0, 200), l.title, l.url.slice(0, 500), l.author, l.state ?? null, l.at, now, now),
      );
    }
  }
  if (delivery) stmts.push(db.prepare("INSERT INTO github_deliveries (delivery_id, event, linked, received_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(delivery, event.slice(0, 40), linked, now));
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true, linked });
}

export async function devLinksFor(db: D1Database, itemId: string): Promise<DevLink[]> {
  const rows = await db
    .prepare("SELECT * FROM dev_links WHERE item_id = ? ORDER BY CASE kind WHEN 'pull_request' THEN 0 WHEN 'branch' THEN 1 ELSE 2 END, at DESC LIMIT 100")
    .bind(itemId)
    .all<{ id: string; kind: DevLinkKind; repo: string; ref: string; title: string; url: string; author: string; state: DevLink["state"] | null; at: string }>();
  return rows.results.map((r) => ({ id: r.id, kind: r.kind, repo: r.repo, ref: r.ref, title: r.title, url: r.url, author: r.author, ...(r.state ? { state: r.state } : {}), at: r.at }));
}

// ---------- personal API tokens ----------

export interface TokenAuth {
  tokenId: string;
  name: string;
  scope: TokenScope;
  userId: string;
}

/** Paths a token may never use: accounts, sign-in, tokens, links and integration settings. */
const TOKEN_BLOCKED = [/^\/api\/me(\/|$)/, /^\/api\/tokens/, /^\/api\/logout/, /^\/api\/users/, /^\/api\/settings\//, /^\/api\/share-links/, /^\/api\/integrations/, /^\/api\/webhooks/, /^\/api\/mfa/];

/**
 * A request with "Authorization: Bearer pulse_…": the token's owner, or an error. Read tokens may only
 * read. Each token may make API_RATE_LIMIT requests a minute.
 */
export async function tokenAuth(db: D1Database, req: Request, path: string): Promise<TokenAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX)) throw new HttpError(401, "That isn't a Pulse API token");
  const row = await db
    .prepare("SELECT t.id, t.user_id, t.name, t.scope, t.expires_at, t.revoked_at, t.last_used_at FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?")
    .bind(await tokenHash(token))
    .first<{ id: string; user_id: string; name: string; scope: TokenScope; expires_at: string; revoked_at: string | null; last_used_at: string | null }>();
  if (!row || row.revoked_at || row.expires_at <= new Date().toISOString()) throw new HttpError(401, "This API token has expired or been revoked", "token_invalid");
  if (TOKEN_BLOCKED.some((r) => r.test(path))) throw new HttpError(403, "API tokens can't be used for accounts, sign-in, tokens, links or integrations");
  if (row.scope === "read" && !["GET", "HEAD"].includes(req.method)) throw new HttpError(403, "This token can only read. Make a write token to change things.");
  const minute = Math.floor(Date.now() / 60_000);
  const used = await db
    .prepare("INSERT INTO api_token_usage (token_id, minute, requests) VALUES (?, ?, 1) ON CONFLICT (token_id, minute) DO UPDATE SET requests = api_token_usage.requests + 1 RETURNING requests")
    .bind(row.id, minute)
    .first<{ requests: number }>();
  if (Number(used?.requests ?? 1) > API_RATE_LIMIT) {
    throw new HttpError(429, `Too many requests: up to ${API_RATE_LIMIT} a minute per token`, "rate_limited", { retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60) });
  }
  if (Number(used?.requests ?? 1) === 1) await db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return { tokenId: row.id, name: row.name, scope: row.scope, userId: row.user_id };
}

interface TokenRow {
  id: string;
  user_id: string;
  user_name?: string | null;
  name: string;
  prefix: string;
  scope: TokenScope;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
const toToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  userId: r.user_id,
  ...(r.user_name ? { userName: r.user_name } : {}),
  name: r.name,
  prefix: r.prefix,
  scope: r.scope,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
  ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
});

// ---------- outbound webhooks ----------

const EVENT_OF: Partial<Record<ItemEvent["type"], WebhookEvent>> = {
  item_created: "created",
  field_changed: "updated",
  item_transitioned: "transitioned",
  comment_added: "commented",
};
const COLUMN: Record<WebhookEvent, string> = { created: "on_created", updated: "on_updated", transitioned: "on_transitioned", commented: "on_commented" };

function checkWebhookUrl(raw: unknown): string {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new HttpError(400, "That address doesn't look right");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "Webhooks must use https://");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) {
    throw new HttpError(400, "Webhooks must go to an address on the internet");
  }
  if (u.href.length > 500) throw new HttpError(400, "That address is too long");
  return u.href;
}

/** The body sent for an event: the item as other systems need it. */
async function payloadFor(db: D1Database, env: Env, e: ItemEvent, r: ItemRow, deliveryEvent: WebhookEvent) {
  const people = await db
    .prepare(`SELECT id, username, name FROM users WHERE id IN (?, ?)`)
    .bind(r.assignee ?? "", r.reporter)
    .all<{ id: string; username: string; name: string }>();
  const person = (id: string | null) => {
    const p = people.results.find((x) => x.id === id);
    return p ? { username: p.username, name: p.name } : null;
  };
  let comment: { id: string; body: string; author: string; createdAt: string } | undefined;
  if (e.type === "comment_added") {
    const k = await db
      .prepare("SELECT k.id, k.body, k.created_at, COALESCE(k.customer_name, u.name, 'Former user') AS author FROM work_item_comments k LEFT JOIN users u ON u.id = k.author_id WHERE k.item_id = ? ORDER BY k.created_at DESC, k.id DESC LIMIT 1")
      .bind(r.id)
      .first<{ id: string; body: string; created_at: string; author: string }>();
    if (k) comment = { id: k.id, body: k.body, author: k.author, createdAt: k.created_at };
  }
  return {
    event: WEBHOOK_EVENTS.find((x) => x.key === deliveryEvent)!.header,
    sentAt: new Date().toISOString(),
    item: {
      key: keyOf(r),
      url: `${env.PUBLIC_URL ?? ""}/#/projects/${r.system_id}/items/${keyOf(r)}`,
      project: { key: r.project_key, name: r.project_name },
      type: r.type,
      summary: r.summary,
      status: r.status_name,
      statusCategory: r.status_category,
      priority: r.priority,
      assignee: person(r.assignee),
      reporter: person(r.reporter),
      labels: r.labels ? r.labels.split(",") : [],
      dueDate: r.due_date,
      storyPoints: r.story_points == null ? null : Number(r.story_points),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
      source: r.source,
    },
    ...(e.type === "field_changed" ? { changed: e.fields } : {}),
    ...(e.type === "item_transitioned" ? { from: e.from, to: e.to } : {}),
    ...(comment ? { comment } : {}),
  };
}

/** One attempt at one delivery. */
async function attempt(env: Env, id: number): Promise<boolean> {
  const db = env.DB;
  const d = await db
    .prepare("SELECT d.*, h.url, h.secret_sealed FROM webhook_deliveries d JOIN webhooks h ON h.id = d.webhook_id WHERE d.id = ?")
    .bind(id)
    .first<{ id: number; event: string; payload: string; attempts: number; url: string; secret_sealed: string }>();
  if (!d) return false;
  const tries = Number(d.attempts) + 1;
  let code: number | null = null;
  let error: string | null = null;
  try {
    const secret = await openSecret(d.secret_sealed, mfaKey(env));
    const res = await fetch(d.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Pulse-Webhooks/1",
        "x-pulse-event": d.event,
        "x-pulse-delivery": String(d.id),
        "x-pulse-signature": `sha256=${await hmacHex(secret, d.payload)}`,
      },
      body: d.payload,
      signal: AbortSignal.timeout(10_000),
    });
    code = res.status;
    if (!res.ok) error = `The receiver answered ${res.status}`;
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  const now = Date.now();
  if (!error) {
    await db.prepare("UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, last_status = ?, last_error = NULL, delivered_at = ?, next_attempt_at = NULL WHERE id = ?").bind(tries, code, new Date(now).toISOString(), id).run();
    return true;
  }
  const done = tries >= WEBHOOK_MAX_ATTEMPTS;
  const wait = WEBHOOK_BACKOFF_MINUTES[Math.min(tries - 1, WEBHOOK_BACKOFF_MINUTES.length - 1)];
  await db
    .prepare("UPDATE webhook_deliveries SET status = ?, attempts = ?, last_status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?")
    .bind(done ? "failed" : "pending", tries, code, error, done ? null : new Date(now + wait * 60_000).toISOString(), id)
    .run();
  return false;
}

/**
 * Sends an event to the webhooks that want it: one try now and one 15 seconds later; after that the
 * hourly cron retries with backoff (1, 2, 4 and 8 hours). Items with a security level are never sent.
 */
export async function dispatchWebhooks(env: Env, e: ItemEvent): Promise<void> {
  const kind = EVENT_OF[e.type];
  if (!kind || !("itemId" in e)) return;
  const db = env.DB;
  const hooks = await db.prepare(`SELECT id, system_id FROM webhooks WHERE enabled = 1 AND ${COLUMN[kind]} = 1`).all<{ id: string; system_id: string | null }>();
  if (!hooks.results.length) return;
  const r = await db.prepare(`${SELECT} WHERE w.id = ?`).bind(e.itemId).first<ItemRow>();
  if (!r || r.security_level) return;
  const wanted = hooks.results.filter((h) => !h.system_id || h.system_id === r.system_id);
  if (!wanted.length) return;
  const payload = JSON.stringify(await payloadFor(db, env, e, r, kind));
  const header = WEBHOOK_EVENTS.find((x) => x.key === kind)!.header;
  const ids: number[] = [];
  for (const h of wanted) {
    const row = await db
      .prepare("INSERT INTO webhook_deliveries (webhook_id, event, item_key, payload, status, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?) RETURNING id")
      .bind(h.id, header, keyOf(r), payload, new Date().toISOString(), new Date().toISOString())
      .first<{ id: number }>();
    if (row) ids.push(Number(row.id));
  }
  const failed: number[] = [];
  for (const id of ids) if (!(await attempt(env, id))) failed.push(id);
  if (failed.length) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    for (const id of failed) await attempt(env, id);
  }
}

/** Hourly: deliveries whose next try is due. */
export async function retryWebhooks(env: Env): Promise<number> {
  const due = await env.DB
    .prepare("SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 200")
    .bind(new Date().toISOString())
    .all<{ id: number }>();
  for (const d of due.results) await attempt(env, Number(d.id));
  return due.results.length;
}

interface HookRow {
  id: string;
  name: string;
  url: string;
  system_id: string | null;
  on_created: number;
  on_updated: number;
  on_transitioned: number;
  on_commented: number;
  enabled: number;
  created_at: string;
  last_status: string | null;
  last_at: string | null;
  last_code: number | null;
  last_error: string | null;
}
const toHook = (h: HookRow): Webhook => ({
  id: h.id,
  name: h.name,
  url: h.url,
  ...(h.system_id ? { systemId: h.system_id } : {}),
  events: WEBHOOK_EVENTS.map((e) => e.key).filter((k) => Number(h[COLUMN[k] as keyof HookRow])),
  enabled: !!h.enabled,
  createdAt: h.created_at,
  ...(h.last_status ? { lastDelivery: { status: h.last_status as "pending" | "delivered" | "failed", at: h.last_at!, ...(h.last_code ? { code: Number(h.last_code) } : {}), ...(h.last_error ? { error: h.last_error } : {}) } } : {}),
});
const HOOKS_SQL = `SELECT h.*, d.status AS last_status, COALESCE(d.delivered_at, d.created_at) AS last_at, d.last_status AS last_code, d.last_error
  FROM webhooks h LEFT JOIN LATERAL (SELECT * FROM webhook_deliveries x WHERE x.webhook_id = h.id ORDER BY x.id DESC LIMIT 1) d ON TRUE`;

// ---------- the API ----------

export async function integrationsApi(c: ItemContext, env: Env, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/integrations") && !path.startsWith("/api/tokens") && !path.startsWith("/api/webhooks")) return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req } = c;
  const needIntegrations = () => {
    if (!c.can("manage_integrations")) throw new HttpError(403, "You don't have permission to manage integrations");
  };

  // ----- GitHub -----
  if (path === "/api/integrations/github" && method === "GET") {
    needIntegrations();
    const [row, recent] = await Promise.all([
      db.prepare("SELECT updated_by, updated_at FROM integration_secrets WHERE kind = 'github'").first<{ updated_by: string; updated_at: string }>(),
      db.prepare("SELECT event, linked, received_at FROM github_deliveries ORDER BY received_at DESC LIMIT 10").all<{ event: string; linked: number; received_at: string }>(),
    ]);
    const links = await db.prepare("SELECT COUNT(*) AS n FROM dev_links").first<{ n: number }>();
    return json({
      connected: !!row,
      ...(row ? { updatedAt: row.updated_at, updatedBy: row.updated_by } : {}),
      webhookUrl: `${new URL(req.url).origin}/api/integrations/github/webhook`,
      links: Number(links?.n ?? 0),
      recent: recent.results.map((r) => ({ event: r.event, linked: Number(r.linked), at: r.received_at })),
    });
  }
  if (path === "/api/integrations/github" && (method === "PUT" || method === "DELETE")) {
    needIntegrations();
    if (method === "DELETE") {
      await db.prepare("DELETE FROM integration_secrets WHERE kind = 'github'").run();
      await c.audit("integration_updated", null, { integration: "GitHub", changed: ["disconnected"] });
      return json({ connected: false });
    }
    const secret = String((await body<{ secret?: unknown }>(req)).secret ?? "").trim();
    if (secret.length < 20 || secret.length > 200 || /\s/.test(secret)) throw new HttpError(400, "Use a secret of 20 to 200 characters, with no spaces");
    await db
      .prepare("INSERT INTO integration_secrets (kind, sealed, updated_by, updated_at) VALUES ('github', ?, ?, ?) ON CONFLICT (kind) DO UPDATE SET sealed = excluded.sealed, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(await sealSecret(secret, mfaKey(env)), c.me.id, c.now)
      .run();
    // The log says what changed, never the secret.
    await c.audit("integration_updated", null, { integration: "GitHub", changed: ["webhook secret"] });
    return json({ connected: true, updatedAt: c.now });
  }

  // ----- personal API tokens -----
  if (path === "/api/tokens" && method === "GET") {
    const all = new URL(req.url).searchParams.get("all") === "1";
    if (all && !c.can("manage_users")) throw new HttpError(403, "Only administrators see everyone's tokens");
    const rows = await db
      .prepare(`SELECT t.*, u.name AS user_name FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id ${all ? "" : "WHERE t.user_id = ?"} ORDER BY t.created_at DESC LIMIT 500`)
      .bind(...(all ? [] : [c.me.id]))
      .all<TokenRow>();
    return json(rows.results.map(toToken));
  }
  if (path === "/api/tokens" && method === "POST") {
    if (!c.can("use_api")) throw new HttpError(403, "You don't have permission to use API tokens");
    const b = await body<{ name?: unknown; scope?: unknown; days?: unknown }>(req);
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!name) throw new HttpError(400, "Name the token after what will use it");
    const scope: TokenScope = b.scope === "write" ? "write" : "read";
    const days = TOKEN_DAYS.includes(Number(b.days)) ? Number(b.days) : 30;
    const live = await db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(c.me.id, c.now).first<{ n: number }>();
    if (Number(live?.n ?? 0) >= MAX_TOKENS_PER_PERSON) throw new HttpError(400, `Up to ${MAX_TOKENS_PER_PERSON} live tokens each; revoke one first`);
    const token = `${TOKEN_PREFIX}${newToken()}`;
    const id = newToken().slice(0, 16);
    const expires = new Date(Date.parse(c.now) + days * 86_400_000).toISOString();
    await db
      .prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, c.me.id, name, await tokenHash(token), token.slice(0, TOKEN_PREFIX.length + 6), scope, c.now, expires)
      .run();
    await c.audit("api_token_created", null, { token: name, scope, days });
    // Shown once; only its hash is kept.
    return json({ ...toToken({ id, user_id: c.me.id, name, prefix: token.slice(0, TOKEN_PREFIX.length + 6), scope, created_at: c.now, expires_at: expires, last_used_at: null, revoked_at: null }), token }, 201);
  }
  let m = path.match(/^\/api\/tokens\/([a-f0-9]{8,20})$/);
  if (m && method === "DELETE") {
    const row = await db.prepare("SELECT t.*, u.name AS user_name FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?").bind(m[1]).first<TokenRow>();
    if (!row || (row.user_id !== c.me.id && !c.can("manage_users"))) throw new HttpError(404, "Token not found");
    if (row.revoked_at) return json(toToken(row));
    await db.prepare("UPDATE api_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ?").bind(c.now, c.me.id, row.id).run();
    await c.audit("api_token_revoked", null, { token: row.name, owner: row.user_name ?? row.user_id, byAdministrator: row.user_id !== c.me.id });
    return json(toToken({ ...row, revoked_at: c.now }));
  }

  // ----- outbound webhooks -----
  if (path.startsWith("/api/webhooks")) needIntegrations();
  if (path === "/api/webhooks" && method === "GET") return json((await db.prepare(`${HOOKS_SQL} ORDER BY h.created_at`).all<HookRow>()).results.map(toHook));

  const readHook = async (b: { name?: unknown; url?: unknown; systemId?: unknown; events?: unknown; enabled?: unknown }) => {
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!name) throw new HttpError(400, "Name the webhook");
    const url = checkWebhookUrl(b.url);
    const events = (Array.isArray(b.events) ? b.events : []).map(String).filter((e): e is WebhookEvent => WEBHOOK_EVENTS.some((x) => x.key === e));
    if (!events.length) throw new HttpError(400, "Choose at least one event");
    const systemId = b.systemId ? String(b.systemId) : null;
    if (systemId && !(await db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(systemId).first())) throw new HttpError(404, "System not found");
    return { name, url, events, systemId, enabled: b.enabled === false ? 0 : 1 };
  };
  const flags = (events: WebhookEvent[]) => WEBHOOK_EVENTS.map((e) => (events.includes(e.key) ? 1 : 0));

  if (path === "/api/webhooks" && method === "POST") {
    const h = await readHook(await body(req));
    const count = await db.prepare("SELECT COUNT(*) AS n FROM webhooks").first<{ n: number }>();
    if (Number(count?.n ?? 0) >= 20) throw new HttpError(400, "Up to 20 webhooks");
    const id = newToken().slice(0, 16);
    const secret = `whsec_${newToken()}`;
    await db
      .prepare(
        `INSERT INTO webhooks (id, name, url, secret_sealed, system_id, on_created, on_updated, on_transitioned, on_commented, enabled, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, h.name, h.url, await sealSecret(secret, mfaKey(env)), h.systemId, ...flags(h.events), h.enabled, c.me.id, c.now, c.now)
      .run();
    await c.audit("webhook_created", h.systemId, { webhook: h.name, url: new URL(h.url).origin, events: h.events });
    const row = await db.prepare(`${HOOKS_SQL} WHERE h.id = ?`).bind(id).first<HookRow>();
    // The signing secret is shown once.
    return json({ ...toHook(row!), secret }, 201);
  }
  m = path.match(/^\/api\/webhooks\/([a-f0-9]{8,20})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    const before = await db.prepare(`${HOOKS_SQL} WHERE h.id = ?`).bind(m[1]).first<HookRow>();
    if (!before) throw new HttpError(404, "Webhook not found");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM webhooks WHERE id = ?").bind(before.id).run();
      await c.audit("webhook_deleted", before.system_id, { webhook: before.name });
      return json({ ok: true });
    }
    const h = await readHook(await body(req));
    await db
      .prepare("UPDATE webhooks SET name = ?, url = ?, system_id = ?, on_created = ?, on_updated = ?, on_transitioned = ?, on_commented = ?, enabled = ?, updated_at = ? WHERE id = ?")
      .bind(h.name, h.url, h.systemId, ...flags(h.events), h.enabled, c.now, before.id)
      .run();
    const prev = toHook(before);
    await c.audit("webhook_updated", h.systemId, {
      webhook: h.name,
      from: { name: prev.name, url: new URL(prev.url).origin, events: prev.events, enabled: prev.enabled, project: prev.systemId ?? "every project" },
      to: { name: h.name, url: new URL(h.url).origin, events: h.events, enabled: !!h.enabled, project: h.systemId ?? "every project" },
    });
    return json(toHook((await db.prepare(`${HOOKS_SQL} WHERE h.id = ?`).bind(before.id).first<HookRow>())!));
  }
  m = path.match(/^\/api\/webhooks\/([a-f0-9]{8,20})\/deliveries$/);
  if (m && method === "GET") {
    const rows = await db.prepare("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 50").bind(m[1]).all<Record<string, string | number | null>>();
    return json(
      rows.results.map(
        (d): WebhookDelivery => ({
          id: Number(d.id),
          event: String(d.event),
          ...(d.item_key ? { itemKey: String(d.item_key) } : {}),
          status: d.status as WebhookDelivery["status"],
          attempts: Number(d.attempts),
          ...(d.next_attempt_at ? { nextAttemptAt: String(d.next_attempt_at) } : {}),
          ...(d.last_status ? { lastStatus: Number(d.last_status) } : {}),
          ...(d.last_error ? { lastError: String(d.last_error) } : {}),
          createdAt: String(d.created_at),
          ...(d.delivered_at ? { deliveredAt: String(d.delivered_at) } : {}),
        }),
      ),
    );
  }
  m = path.match(/^\/api\/webhooks\/([a-f0-9]{8,20})\/test$/);
  if (m && method === "POST") {
    const hook = await db.prepare("SELECT id, name FROM webhooks WHERE id = ?").bind(m[1]).first<{ id: string; name: string }>();
    if (!hook) throw new HttpError(404, "Webhook not found");
    const row = await db
      .prepare("INSERT INTO webhook_deliveries (webhook_id, event, payload, status, next_attempt_at, created_at) VALUES (?, 'ping', ?, 'pending', ?, ?) RETURNING id")
      .bind(hook.id, JSON.stringify({ event: "ping", sentAt: c.now, message: "A test from Pulse" }), c.now, c.now)
      .first<{ id: number }>();
    const ok = await attempt(env, Number(row!.id));
    const d = await db.prepare("SELECT last_status, last_error FROM webhook_deliveries WHERE id = ?").bind(row!.id).first<{ last_status: number | null; last_error: string | null }>();
    return json({ ok, ...(d?.last_status ? { code: Number(d.last_status) } : {}), ...(d?.last_error ? { error: d.last_error } : {}) });
  }
  m = path.match(/^\/api\/webhooks\/deliveries\/(\d{1,12})\/retry$/);
  if (m && method === "POST") {
    const d = await db.prepare("SELECT id, status FROM webhook_deliveries WHERE id = ?").bind(Number(m[1])).first<{ id: number; status: string }>();
    if (!d) throw new HttpError(404, "Delivery not found");
    if (d.status === "delivered") return json({ ok: true });
    await db.prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = LEAST(attempts, ?) WHERE id = ?").bind(WEBHOOK_MAX_ATTEMPTS - 1, d.id).run();
    return json({ ok: await attempt(env, Number(d.id)) });
  }

  throw new HttpError(404, "Not found");
}

/** Ask Pulse: the person's own API tokens, and (for integration managers) the webhooks and GitHub. */
export async function askIntegrationLines(c: ItemContext): Promise<string[]> {
  if (c.guest) return [];
  const lines: string[] = [];
  const tokens = await c.db.prepare("SELECT name, scope, expires_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at").bind(c.me.id, c.now).all<{ name: string; scope: string; expires_at: string; last_used_at: string | null }>();
  if (tokens.results.length) {
    lines.push("", "YOUR API TOKENS (name | scope | expires | last used)", ...tokens.results.map((t) => [t.name, t.scope, t.expires_at.slice(0, 10), t.last_used_at?.slice(0, 10) ?? "never"].join(" | ")));
  }
  if (c.can("manage_integrations")) {
    const hooks = await c.db.prepare(`${HOOKS_SQL} ORDER BY h.created_at`).all<HookRow>();
    const gh = await c.db.prepare("SELECT 1 FROM integration_secrets WHERE kind = 'github'").first();
    lines.push("", `GITHUB: ${gh ? "connected" : "not connected"}`);
    if (hooks.results.length) {
      lines.push("WEBHOOKS (name | events | on | last delivery)", ...hooks.results.map((h) => [h.name, toHook(h).events.join(", "), h.enabled ? "on" : "off", h.last_status ? `${h.last_status} ${h.last_at?.slice(0, 16)}` : "none yet"].join(" | ")));
    }
  }
  return lines;
}
