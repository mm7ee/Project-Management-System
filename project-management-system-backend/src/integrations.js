/** @import { ItemContext, ItemEvent, ItemRow } from './workitems' */
/** @import { ApiToken, DevLink, DevLinkKind, TokenScope, Webhook, WebhookDelivery, WebhookEvent } from '../../project-management-system-frontend/src/data/admin' */
// Integrations: GitHub (an inbound webhook whose HMAC signature is checked with a secret sealed by
// MFA_KEY; commits, branches and pull requests that mention a key show on that work item), personal API
// tokens (scoped, expiring, stored as a hash, rate-limited, with the owner's permissions), and outbound
// webhooks for work item events (signed with HMAC, retried with backoff). Webhooks and GitHub need
// "manage_integrations"; tokens need "use_api".
import { BRAND } from "../../project-management-system-frontend/src/data/brand";
import { newToken, openSecret, sealSecret, tokenHash } from "./auth";
import { renderTemplate } from "../../project-management-system-frontend/src/data/automation";
import { HttpError, body, json } from "./http";
import { SELECT, keyOf } from "./workitems";
import { API_RATE_LIMIT, MAX_TOKENS_PER_PERSON, OLD_TOKEN_PREFIX, TOKEN_DAYS, TOKEN_PREFIX, WEBHOOK_BACKOFF_MINUTES, WEBHOOK_EVENTS, WEBHOOK_MAX_ATTEMPTS } from "../../project-management-system-frontend/src/data/admin";
const enc = new TextEncoder();
const hex =
  /** @param {ArrayBuffer} buf
   * @returns {string}
   */ (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
/**
 * @param {string} secret
 * @param {string} payload
 * @returns {Promise<string>}
 */
async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}
/**
 * Compares two strings in constant time.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/**
 * @param {Env} env
 * @returns {string}
 */
function mfaKey(env) {
  if (!env.MFA_KEY) throw new HttpError(500, "The server's MFA_KEY secret is missing, so secrets can't be sealed");
  return env.MFA_KEY;
}
// ---------- GitHub ----------
const KEY_IN_TEXT = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})\b/g;
/**
 * The work item keys mentioned in some text (case doesn't matter in branch names).
 * @param {string} text
 * @returns {string[]}
 */
export function keysIn(text) {
  return [...new Set([...text.matchAll(KEY_IN_TEXT)].map((m) => `${m[1].toUpperCase()}-${Number(m[2])}`))];
}
/**
 * What a GitHub event says, as development links.
 * @param {string} event
 * @param {Record<string, unknown>} p
 * @returns {LinkFound[]}
 */
function linksFromGitHub(event, p) {
  const repo = String(/** @type {{ full_name?: string } | undefined} */ (p.repository)?.full_name ?? "");
  const repoUrl = String(/** @type {{ html_url?: string } | undefined} */ (p.repository)?.html_url ?? "");
  if (!repo) return [];
  /** @type {LinkFound[]} */ const out = [];
  if (event === "push") {
    const ref = String(p.ref ?? "");
    const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : "";
    for (const c of /** @type {Record<string, unknown>[] | undefined} */ (p.commits) ?? []) {
      const message = String(c.message ?? "");
      out.push({
        kind: "commit",
        repo,
        ref: String(c.id ?? "").slice(0, 40),
        title: message.split("\n")[0].slice(0, 200),
        url: String(c.url ?? ""),
        author: String(/** @type {{ name?: string } | undefined} */ (c.author)?.name ?? "").slice(0, 100),
        at: String(c.timestamp ?? new Date().toISOString()),
        text: `${message} ${branch}`,
      });
    }
    if (branch && p.created) out.push({ kind: "branch", repo, ref: branch, title: branch, url: `${repoUrl}/tree/${branch}`, author: String(/** @type {{ name?: string } | undefined} */ (p.pusher)?.name ?? ""), at: new Date().toISOString(), text: branch });
  }
  if (event === "create" && p.ref_type === "branch") {
    const branch = String(p.ref ?? "");
    out.push({ kind: "branch", repo, ref: branch, title: branch, url: `${repoUrl}/tree/${branch}`, author: String(/** @type {{ login?: string } | undefined} */ (p.sender)?.login ?? ""), at: new Date().toISOString(), text: branch });
  }
  if (event === "pull_request") {
    const pr = /** @type {Record<string, unknown>} */ (p.pull_request ?? {});
    const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
    out.push({
      kind: "pull_request",
      repo,
      ref: String(pr.number ?? ""),
      title: String(pr.title ?? "").slice(0, 200),
      url: String(pr.html_url ?? ""),
      author: String(/** @type {{ login?: string } | undefined} */ (pr.user)?.login ?? ""),
      state,
      at: String(pr.updated_at ?? new Date().toISOString()),
      text: `${pr.title ?? ""} ${/** @type {{ ref?: string } | undefined} */ (pr.head)?.ref ?? ""} ${pr.body ?? ""}`,
    });
  }
  return out.filter((l) => /^https:\/\/github\.com\//.test(l.url) && l.ref);
}
/**
 * POST /api/integrations/github/webhook: called by GitHub, signed with the shared secret. No session.
 * @param {Env} env
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export async function githubWebhook(env, req) {
  const raw = await req.text();
  if (raw.length > 5_000_000) throw new HttpError(413, "Too large");
  // Each workspace connects GitHub with its own secret. A delivery belongs to the workspace whose secret signed
  // it, and everything after this is done with that workspace's handle, so keys can only match its own items.
  const secrets = await /** @type {Promise<D1Result<{ organization_id: string; workspace_id: string; sealed: string; }>>} */ (
    /** @type {unknown} */ (env.ROOT.prepare("SELECT s.organization_id, s.workspace_id, s.sealed FROM integration_secrets s JOIN workspaces w ON w.id = s.workspace_id AND w.status = 'active' JOIN organizations o ON o.id = s.organization_id AND o.status = 'active' WHERE s.kind = 'github'").all())
  );
  if (!secrets.results.length) throw new HttpError(404, "GitHub isn't connected");
  const given = req.headers.get("x-hub-signature-256") ?? "";
  /** @type {{ organization_id: string; workspace_id: string } | null} */ let owner = null;
  for (const s of secrets.results) {
    if (sameText(given, `sha256=${await hmacHex(await openSecret(s.sealed, mfaKey(env)), raw)}`)) {
      owner = s;
      break;
    }
  }
  if (!owner) throw new HttpError(401, "The signature doesn't match");
  const db = env.ROOT.withScope({ orgId: owner.organization_id, workspaceId: owner.workspace_id });
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = (req.headers.get("x-github-delivery") ?? "").slice(0, 80);
  if (event === "ping") return json({ ok: true, message: `${BRAND.shortName} is listening` });
  if (delivery && (await db.prepare("SELECT 1 FROM github_deliveries WHERE delivery_id = ?").bind(delivery).first())) return json({ ok: true, duplicate: true });
  /** @type {Record<string, unknown>} */ let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "That isn't JSON");
  }
  const found = linksFromGitHub(event, payload);
  const now = new Date().toISOString();
  /** @type {D1PreparedStatement[]} */ const stmts = [];
  let linked = 0;
  for (const l of found) {
    for (const key of keysIn(l.text)) {
      const [project, number] = key.split("-");
      const item = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT w.id FROM work_items w JOIN systems s ON s.id = w.system_id WHERE s.key = ? AND w.number = ?").bind(project, Number(number)).first()));
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
/**
 * @param {D1Database} db
 * @param {string} itemId
 * @returns {Promise<DevLink[]>}
 */
export async function devLinksFor(db, itemId) {
  const rows = await /** @type {Promise<D1Result<{ id: string; kind: DevLinkKind; repo: string; ref: string; title: string; url: string; author: string; state: DevLink["state"] | null; at: string; }>>} */ (
    /** @type {unknown} */ (db.prepare("SELECT * FROM dev_links WHERE item_id = ? ORDER BY CASE kind WHEN 'pull_request' THEN 0 WHEN 'branch' THEN 1 ELSE 2 END, at DESC LIMIT 100").bind(itemId).all())
  );
  return rows.results.map((r) => ({ id: r.id, kind: r.kind, repo: r.repo, ref: r.ref, title: r.title, url: r.url, author: r.author, ...(r.state ? { state: r.state } : {}), at: r.at }));
}
/**
 * Paths a token may never use: accounts, sign-in, tokens, links and integration settings.
 * @type {RegExp[]}
 */
const TOKEN_BLOCKED = [/^\/api\/me(\/|$)/, /^\/api\/tokens/, /^\/api\/logout/, /^\/api\/users/, /^\/api\/settings\//, /^\/api\/share-links/, /^\/api\/showcase-links/, /^\/api\/org(\/|$)/, /^\/api\/integrations/, /^\/api\/webhooks/, /^\/api\/mfa/];
/**
 * The headers a signed delivery carries: X-PMS-Event, X-PMS-Delivery, X-PMS-Signature and so on, and the same values
 * under their names from before the rename (X-Pulse-…), so receiving systems set up then keep working.
 * @param {Record<string, string>} values  event, delivery, signature, rule…
 * @param {string} agent
 * @returns {Record<string, string>}
 */
export function webhookHeaders(values, agent) {
  /** @type {Record<string, string>} */ const h = { "user-agent": agent };
  for (const [k, v] of Object.entries(values)) {
    h[`x-pms-${k}`] = v;
    h[`x-pulse-${k}`] = v;
  }
  return h;
}

/**
 * A request with "Authorization: Bearer pms_…" (or, made before the rename, "pulse_…"): the token's owner, or an error. Read tokens may only
 * read. Each token may make API_RATE_LIMIT requests a minute.
 * The token belongs to one workspace (the one it was made in): the request is scoped to it.
 * @param {TenantDatabase} root the owner handle: a token is found by its hash before its tenant is known
 * @param {Request} req
 * @param {string} path
 * @returns {Promise<TokenAuth | null>}
 */
export async function tokenAuth(root, req, path) {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX) && !token.startsWith(OLD_TOKEN_PREFIX)) throw new HttpError(401, `That isn't a ${BRAND.shortName} API token`);
  const row = await /** @type {Promise<{ id: string; user_id: string; name: string; scope: TokenScope; expires_at: string; revoked_at: string | null; last_used_at: string | null; organization_id: string; workspace_id: string; } | null>} */ (
    /** @type {unknown} */ (
      root
        .prepare("SELECT t.id, t.user_id, t.name, t.scope, t.expires_at, t.revoked_at, t.last_used_at, t.organization_id, t.workspace_id FROM api_tokens t JOIN accounts u ON u.id = t.user_id WHERE t.token_hash = ?")
        .bind(await tokenHash(token))
        .first()
    )
  );
  if (!row || row.revoked_at || row.expires_at <= new Date().toISOString()) throw new HttpError(401, "This API token has expired or been revoked", "token_invalid");
  if (TOKEN_BLOCKED.some((r) => r.test(path))) throw new HttpError(403, "API tokens can't be used for accounts, sign-in, tokens, links or integrations");
  if (row.scope === "read" && !["GET", "HEAD"].includes(req.method)) throw new HttpError(403, "This token can only read. Make a write token to change things.");
  const db = root.withScope({ orgId: row.organization_id, workspaceId: row.workspace_id });
  const minute = Math.floor(Date.now() / 60_000);
  const used = await /** @type {Promise<{ requests: number; } | null>} */ (
    /** @type {unknown} */ (db.prepare("INSERT INTO api_token_usage (token_id, minute, requests) VALUES (?, ?, 1) ON CONFLICT (token_id, minute) DO UPDATE SET requests = api_token_usage.requests + 1 RETURNING requests").bind(row.id, minute).first())
  );
  if (Number(used?.requests ?? 1) > API_RATE_LIMIT) {
    throw new HttpError(429, `Too many requests: up to ${API_RATE_LIMIT} a minute per token`, "rate_limited", { retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60) });
  }
  if (Number(used?.requests ?? 1) === 1) await db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return { tokenId: row.id, name: row.name, scope: row.scope, userId: row.user_id, orgId: row.organization_id, workspaceId: row.workspace_id };
}
const toToken =
  /**
   * @param {TokenRow} r
   * @returns {ApiToken}
   */ (r) => ({
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
/** @type {Partial<Record<ItemEvent["type"], WebhookEvent>>} */ const EVENT_OF = {
  item_created: "created",
  field_changed: "updated",
  item_transitioned: "transitioned",
  comment_added: "commented",
};
/** @type {Record<WebhookEvent, string>} */ const COLUMN = { created: "on_created", updated: "on_updated", transitioned: "on_transitioned", commented: "on_commented" };
/**
 * @param {unknown} raw
 * @returns {string}
 */
function checkWebhookUrl(raw) {
  /** @type {URL} */ let u;
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
/**
 * The body sent for an event: the item as other systems need it.
 * @param {D1Database} db
 * @param {Env} env
 * @param {ItemEvent} e
 * @param {ItemRow} r
 * @param {WebhookEvent} deliveryEvent
 */
async function payloadFor(db, env, e, r, deliveryEvent) {
  const people = await /** @type {Promise<D1Result<{ id: string; username: string; name: string; }>>} */ (
    /** @type {unknown} */ (
      db
        .prepare(`SELECT id, username, name FROM users WHERE id IN (?, ?)`)
        .bind(r.assignee ?? "", r.reporter)
        .all()
    )
  );
  const person = /** @param {string | null} id */ (id) => {
    const p = people.results.find((x) => x.id === id);
    return p ? { username: p.username, name: p.name } : null;
  };
  /** @type {{ id: string; body: string; author: string; createdAt: string } | undefined} */ let comment;
  if (e.type === "comment_added") {
    const k = await /** @type {Promise<{ id: string; body: string; created_at: string; author: string; } | null>} */ (
      /** @type {unknown} */ (db.prepare("SELECT k.id, k.body, k.created_at, COALESCE(k.customer_name, u.name, 'Former user') AS author FROM work_item_comments k LEFT JOIN users u ON u.id = k.author_id WHERE k.item_id = ? ORDER BY k.created_at DESC, k.id DESC LIMIT 1").bind(r.id).first())
    );
    if (k) comment = { id: k.id, body: k.body, author: k.author, createdAt: k.created_at };
  }
  return {
    event: /** @type {{ key: WebhookEvent; label: string; header: string; }} */ (WEBHOOK_EVENTS.find((x) => x.key === deliveryEvent)).header,
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
/**
 * One attempt at one delivery.
 * @param {Env} env
 * @param {number} id
 * @returns {Promise<boolean>}
 */
async function attempt(env, id) {
  const db = env.DB;
  const d = await /** @type {Promise<{ id: number; event: string; payload: string; attempts: number; url: string; secret_sealed: string; } | null>} */ (
    /** @type {unknown} */ (db.prepare("SELECT d.*, h.url, h.secret_sealed FROM webhook_deliveries d JOIN webhooks h ON h.id = d.webhook_id WHERE d.id = ?").bind(id).first())
  );
  if (!d) return false;
  const tries = Number(d.attempts) + 1;
  /** @type {number | null} */ let code = null;
  /** @type {string | null} */ let error = null;
  try {
    const secret = await openSecret(d.secret_sealed, mfaKey(env));
    const res = await fetch(d.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...webhookHeaders(
          { event: d.event, delivery: String(d.id), signature: `sha256=${await hmacHex(secret, d.payload)}` },
          "PMS-Webhooks/1",
        ),
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
 * @param {Env} env
 * @param {ItemEvent} e
 * @returns {Promise<void>}
 */
export async function dispatchWebhooks(env, e) {
  const kind = EVENT_OF[e.type];
  if (!kind || !("itemId" in e)) return;
  const db = env.DB;
  const hooks = await /** @type {Promise<D1Result<{ id: string; system_id: string | null; payload_template: string | null; }>>} */ (/** @type {unknown} */ (db.prepare(`SELECT id, system_id, payload_template FROM webhooks WHERE enabled = 1 AND ${COLUMN[kind]} = 1`).all()));
  if (!hooks.results.length) return;
  const r = await /** @type {Promise<ItemRow | null>} */ (/** @type {unknown} */ (db.prepare(`${SELECT} WHERE w.id = ?`).bind(e.itemId).first()));
  if (!r || r.security_level) return;
  const wanted = hooks.results.filter((h) => !h.system_id || h.system_id === r.system_id);
  if (!wanted.length) return;
  const standard = await payloadFor(db, env, e, r, kind);
  const payload = JSON.stringify(standard);
  // A webhook with its own template gets its JSON, filled with smart values escaped for JSON.
  const values = /** @type {Record<string, string>} */ ({
    "event": standard.event,
    "item.key": standard.item.key,
    "item.title": standard.item.summary,
    "item.summary": standard.item.summary,
    "item.status": standard.item.status,
    "item.priority": standard.item.priority,
    "item.type": r.item_type_name ?? standard.item.type,
    "item.url": standard.item.url,
    "item.assignee.name": standard.item.assignee?.name ?? "nobody",
    "item.reporter.name": standard.item.reporter?.name ?? "",
    "item.dueDate": standard.item.dueDate ?? "",
    "project.name": standard.item.project.name,
  });
  const bodyFor = /** @param {{ payload_template: string | null }} h */ (h) => {
    if (!h.payload_template) return payload;
    const out = renderTemplate(h.payload_template, values, "json");
    try {
      JSON.parse(out);
      return out;
    } catch {
      return payload;
    }
  };
  const header = /** @type {{ key: WebhookEvent; label: string; header: string; }} */ (WEBHOOK_EVENTS.find((x) => x.key === kind)).header;
  /** @type {number[]} */ const ids = [];
  for (const h of wanted) {
    const row = await /** @type {Promise<{ id: number; } | null>} */ (
      /** @type {unknown} */ (db.prepare("INSERT INTO webhook_deliveries (webhook_id, event, item_key, payload, status, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?) RETURNING id").bind(h.id, header, keyOf(r), bodyFor(h), new Date().toISOString(), new Date().toISOString()).first())
    );
    if (row) ids.push(Number(row.id));
  }
  /** @type {number[]} */ const failed = [];
  for (const id of ids) if (!(await attempt(env, id))) failed.push(id);
  if (failed.length) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    for (const id of failed) await attempt(env, id);
  }
}
/**
 * Hourly: deliveries whose next try is due.
 * @param {Env} env
 * @returns {Promise<number>}
 */
export async function retryWebhooks(env) {
  const due = await /** @type {Promise<D1Result<{ id: number; }>>} */ (/** @type {unknown} */ (env.DB.prepare("SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 200").bind(new Date().toISOString()).all()));
  for (const d of due.results) await attempt(env, Number(d.id));
  return due.results.length;
}
const toHook =
  /**
   * @param {HookRow} h
   * @returns {Webhook}
   */ (h) => ({
    id: h.id,
    name: h.name,
    url: h.url,
    ...(h.system_id ? { systemId: h.system_id } : {}),
    events: WEBHOOK_EVENTS.map((e) => e.key).filter((k) => Number(h[/** @type {keyof HookRow} */ (COLUMN[k])])),
    enabled: !!h.enabled,
    ...(h.payload_template ? { payloadTemplate: h.payload_template } : {}),
    createdAt: h.created_at,
    ...(h.last_status ? { lastDelivery: { status: /** @type {"pending" | "delivered" | "failed"} */ (h.last_status), at: /** @type {NonNullable<typeof h.last_at>} */ (h.last_at), ...(h.last_code ? { code: Number(h.last_code) } : {}), ...(h.last_error ? { error: h.last_error } : {}) } } : {}),
  });
const HOOKS_SQL = `SELECT h.*, d.status AS last_status, COALESCE(d.delivered_at, d.created_at) AS last_at, d.last_status AS last_code, d.last_error
  FROM webhooks h LEFT JOIN LATERAL (SELECT * FROM webhook_deliveries x WHERE x.webhook_id = h.id ORDER BY x.id DESC LIMIT 1) d ON TRUE`;
// ---------- the API ----------
/**
 * @param {ItemContext} c
 * @param {Env} env
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function integrationsApi(c, env, path, method) {
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
      /** @type {Promise<{ updated_by: string; updated_at: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT updated_by, updated_at FROM integration_secrets WHERE kind = 'github'").first())),
      /** @type {Promise<D1Result<{ event: string; linked: number; received_at: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT event, linked, received_at FROM github_deliveries ORDER BY received_at DESC LIMIT 10").all())),
    ]);
    const links = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM dev_links").first()));
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
    const secret = String((await /** @type {Promise<{ secret?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).secret ?? "").trim();
    if (secret.length < 20 || secret.length > 200 || /\s/.test(secret)) throw new HttpError(400, "Use a secret of 20 to 200 characters, with no spaces");
    // A delivery belongs to the workspace whose secret signed it, so no two workspaces may share one. The others'
    // are read as the owner only to compare; nothing about them is returned.
    const scope = /** @type {TenantDatabase} */ (db).scope;
    const others = /** @type {D1Result<{ sealed: string }>} */ (
      await env.ROOT.prepare("SELECT sealed FROM integration_secrets WHERE kind = 'github' AND workspace_id <> ?").bind(scope?.workspaceId ?? "").all()
    );
    for (const o of others.results) {
      if (sameText(await openSecret(o.sealed, mfaKey(env)), secret)) throw new HttpError(409, "Choose a different secret: each workspace connects GitHub with its own");
    }
    await db
      .prepare("INSERT INTO integration_secrets (kind, sealed, updated_by, updated_at) VALUES ('github', ?, ?, ?) ON CONFLICT (workspace_id, kind) DO UPDATE SET sealed = excluded.sealed, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
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
    const rows = await /** @type {Promise<D1Result<TokenRow>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT t.*, u.name AS user_name FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id ${all ? "" : "WHERE t.user_id = ?"} ORDER BY t.created_at DESC LIMIT 500`)
          .bind(...(all ? [] : [c.me.id]))
          .all()
      )
    );
    return json(rows.results.map(toToken));
  }
  if (path === "/api/tokens" && method === "POST") {
    if (!c.can("use_api")) throw new HttpError(403, "You don't have permission to use API tokens");
    const b = await /** @type {Promise<{ name?: unknown; scope?: unknown; days?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) throw new HttpError(400, "Name the token after what will use it");
    /** @type {TokenScope} */ const scope = b.scope === "write" ? "write" : "read";
    const days = TOKEN_DAYS.includes(Number(b.days)) ? Number(b.days) : 30;
    const live = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(c.me.id, c.now).first()));
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
    const row = await /** @type {Promise<TokenRow | null>} */ (/** @type {unknown} */ (db.prepare("SELECT t.*, u.name AS user_name FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?").bind(m[1]).first()));
    if (!row || (row.user_id !== c.me.id && !c.can("manage_users"))) throw new HttpError(404, "Token not found");
    if (row.revoked_at) return json(toToken(row));
    await db.prepare("UPDATE api_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ?").bind(c.now, c.me.id, row.id).run();
    await c.audit("api_token_revoked", null, { token: row.name, owner: row.user_name ?? row.user_id, byAdministrator: row.user_id !== c.me.id });
    return json(toToken({ ...row, revoked_at: c.now }));
  }
  // ----- outbound webhooks -----
  if (path.startsWith("/api/webhooks")) needIntegrations();
  if (path === "/api/webhooks" && method === "GET") return json((await /** @type {Promise<D1Result<HookRow>>} */ (/** @type {unknown} */ (db.prepare(`${HOOKS_SQL} ORDER BY h.created_at`).all()))).results.map(toHook));
  const readHook = /** @param {{ name?: unknown; url?: unknown; systemId?: unknown; events?: unknown; enabled?: unknown; payloadTemplate?: unknown }} b */ async (b) => {
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) throw new HttpError(400, "Name the webhook");
    const url = checkWebhookUrl(b.url);
    const events = (Array.isArray(b.events) ? b.events : []).map(String).filter(/** @returns {e is WebhookEvent} */ (e) => WEBHOOK_EVENTS.some((x) => x.key === e));
    if (!events.length) throw new HttpError(400, "Choose at least one event");
    const systemId = b.systemId ? String(b.systemId) : null;
    if (systemId && !(await db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(systemId).first())) throw new HttpError(404, "System not found");
    // Its own JSON, with smart values ({{item.key}} …), or the system's standard payload when empty.
    const template = b.payloadTemplate ? String(b.payloadTemplate).slice(0, 8000) : null;
    if (template) {
      try {
        JSON.parse(renderTemplate(template, {}, "json").replace(/\{\{[^}]*\}\}/g, "x"));
      } catch {
        throw new HttpError(400, "The payload must be JSON (smart values go inside quotes)");
      }
    }
    return { name, url, events, systemId, enabled: b.enabled === false ? 0 : 1, template };
  };
  const flags = /** @param {WebhookEvent[]} events */ (events) => WEBHOOK_EVENTS.map((e) => (events.includes(e.key) ? 1 : 0));
  if (path === "/api/webhooks" && method === "POST") {
    const h = await readHook(await body(req));
    const count = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM webhooks").first()));
    if (Number(count?.n ?? 0) >= 20) throw new HttpError(400, "Up to 20 webhooks");
    const id = newToken().slice(0, 16);
    const secret = `whsec_${newToken()}`;
    await db
      .prepare(
        `INSERT INTO webhooks (id, name, url, secret_sealed, system_id, on_created, on_updated, on_transitioned, on_commented, enabled, payload_template, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, h.name, h.url, await sealSecret(secret, mfaKey(env)), h.systemId, ...flags(h.events), h.enabled, h.template, c.me.id, c.now, c.now)
      .run();
    await c.audit("webhook_created", h.systemId, { webhook: h.name, url: new URL(h.url).origin, events: h.events });
    const row = await /** @type {Promise<HookRow | null>} */ (/** @type {unknown} */ (db.prepare(`${HOOKS_SQL} WHERE h.id = ?`).bind(id).first()));
    // The signing secret is shown once.
    return json({ ...toHook(/** @type {NonNullable<typeof row>} */ (row)), secret }, 201);
  }
  m = path.match(/^\/api\/webhooks\/([a-f0-9]{8,20})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    const before = await /** @type {Promise<HookRow | null>} */ (/** @type {unknown} */ (db.prepare(`${HOOKS_SQL} WHERE h.id = ?`).bind(m[1]).first()));
    if (!before) throw new HttpError(404, "Webhook not found");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM webhooks WHERE id = ?").bind(before.id).run();
      await c.audit("webhook_deleted", before.system_id, { webhook: before.name });
      return json({ ok: true });
    }
    const h = await readHook(await body(req));
    await db
      .prepare("UPDATE webhooks SET name = ?, url = ?, system_id = ?, on_created = ?, on_updated = ?, on_transitioned = ?, on_commented = ?, enabled = ?, payload_template = ?, updated_at = ? WHERE id = ?")
      .bind(h.name, h.url, h.systemId, ...flags(h.events), h.enabled, h.template, c.now, before.id)
      .run();
    const prev = toHook(before);
    await c.audit("webhook_updated", h.systemId, {
      webhook: h.name,
      from: { name: prev.name, url: new URL(prev.url).origin, events: prev.events, enabled: prev.enabled, project: prev.systemId ?? "every project" },
      to: { name: h.name, url: new URL(h.url).origin, events: h.events, enabled: !!h.enabled, project: h.systemId ?? "every project" },
    });
    return json(toHook(/** @type {HookRow} */ (await /** @type {Promise<HookRow | null>} */ (/** @type {unknown} */ (db.prepare(`${HOOKS_SQL} WHERE h.id = ?`).bind(before.id).first())))));
  }
  m = path.match(/^\/api\/webhooks\/([a-f0-9]{8,20})\/deliveries$/);
  if (m && method === "GET") {
    const rows = await /** @type {Promise<D1Result<Record<string, string | number | null>>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 50").bind(m[1]).all()));
    return json(
      rows.results.map(
        /** @returns {WebhookDelivery} */ (d) => ({
          id: Number(d.id),
          event: String(d.event),
          ...(d.item_key ? { itemKey: String(d.item_key) } : {}),
          status: /** @type {WebhookDelivery["status"]} */ (d.status),
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
    const hook = await /** @type {Promise<{ id: string; name: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name FROM webhooks WHERE id = ?").bind(m[1]).first()));
    if (!hook) throw new HttpError(404, "Webhook not found");
    const row = await /** @type {Promise<{ id: number; } | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare("INSERT INTO webhook_deliveries (webhook_id, event, payload, status, next_attempt_at, created_at) VALUES (?, 'ping', ?, 'pending', ?, ?) RETURNING id")
          .bind(hook.id, JSON.stringify({ event: "ping", sentAt: c.now, message: `A test from ${BRAND.shortName}` }), c.now, c.now)
          .first()
      )
    );
    const ok = await attempt(env, Number(/** @type {NonNullable<typeof row>} */ (row).id));
    const d = await /** @type {Promise<{ last_status: number | null; last_error: string | null; } | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare("SELECT last_status, last_error FROM webhook_deliveries WHERE id = ?")
          .bind(/** @type {NonNullable<typeof row>} */ (row).id)
          .first()
      )
    );
    return json({ ok, ...(d?.last_status ? { code: Number(d.last_status) } : {}), ...(d?.last_error ? { error: d.last_error } : {}) });
  }
  m = path.match(/^\/api\/webhooks\/deliveries\/(\d{1,12})\/retry$/);
  if (m && method === "POST") {
    const d = await /** @type {Promise<{ id: number; status: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id, status FROM webhook_deliveries WHERE id = ?").bind(Number(m[1])).first()));
    if (!d) throw new HttpError(404, "Delivery not found");
    if (d.status === "delivered") return json({ ok: true });
    await db
      .prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = LEAST(attempts, ?) WHERE id = ?")
      .bind(WEBHOOK_MAX_ATTEMPTS - 1, d.id)
      .run();
    return json({ ok: await attempt(env, Number(d.id)) });
  }
  throw new HttpError(404, "Not found");
}
/**
 * Ask AI: the person's own API tokens, and (for integration managers) the webhooks and GitHub.
 * @param {ItemContext} c
 * @returns {Promise<string[]>}
 */
export async function askIntegrationLines(c) {
  if (c.guest) return [];
  /** @type {string[]} */ const lines = [];
  const tokens = await /** @type {Promise<D1Result<{ name: string; scope: string; expires_at: string; last_used_at: string | null; }>>} */ (
    /** @type {unknown} */ (c.db.prepare("SELECT name, scope, expires_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at").bind(c.me.id, c.now).all())
  );
  if (tokens.results.length) {
    lines.push("", "YOUR API TOKENS (name | scope | expires | last used)", ...tokens.results.map((t) => [t.name, t.scope, t.expires_at.slice(0, 10), t.last_used_at?.slice(0, 10) ?? "never"].join(" | ")));
  }
  if (c.can("manage_integrations")) {
    const hooks = await /** @type {Promise<D1Result<HookRow>>} */ (/** @type {unknown} */ (c.db.prepare(`${HOOKS_SQL} ORDER BY h.created_at`).all()));
    const gh = await c.db.prepare("SELECT 1 FROM integration_secrets WHERE kind = 'github'").first();
    lines.push("", `GITHUB: ${gh ? "connected" : "not connected"}`);
    if (hooks.results.length) {
      lines.push("WEBHOOKS (name | events | on | last delivery)", ...hooks.results.map((h) => [h.name, toHook(h).events.join(", "), h.enabled ? "on" : "off", h.last_status ? `${h.last_status} ${h.last_at?.slice(0, 16)}` : "none yet"].join(" | ")));
    }
  }
  return lines;
}
/**
 * @typedef {Object} LinkFound
 * @property {DevLinkKind} kind
 * @property {string} repo
 * @property {string} ref
 * @property {string} title
 * @property {string} url
 * @property {string} author
 * @property {"open" | "merged" | "closed"} [state]
 * @property {string} at
 * @property {string} text
 */
/**
 * @typedef {Object} TokenAuth
 * @property {string} tokenId
 * @property {string} name
 * @property {TokenScope} scope
 * @property {string} userId
 * @property {string} orgId
 * @property {string} workspaceId the workspace the token was made in, and the only one it reaches
 */
/**
 * @typedef {Object} TokenRow
 * @property {string} id
 * @property {string} user_id
 * @property {string | null} [user_name]
 * @property {string} name
 * @property {string} prefix
 * @property {TokenScope} scope
 * @property {string} created_at
 * @property {string} expires_at
 * @property {string | null} last_used_at
 * @property {string | null} revoked_at
 */
/**
 * @typedef {Object} HookRow
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {string | null} [payload_template]
 * @property {string | null} system_id
 * @property {number} on_created
 * @property {number} on_updated
 * @property {number} on_transitioned
 * @property {number} on_commented
 * @property {number} enabled
 * @property {string} created_at
 * @property {string | null} last_status
 * @property {string | null} last_at
 * @property {number | null} last_code
 * @property {string | null} last_error
 */
