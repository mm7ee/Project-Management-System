// Platform Administrators (multi-tenancy, phase (d)): accounts outside every organisation, who create, rename,
// suspend and archive organisations and give each its first administrator. They can't open an organisation's
// data: nothing here reads projects, work items or anything else inside an organisation, and their cookie only
// goes to /api/platform, so it can't reach the rest of the API. Signing in always needs an authenticator app
// (set up at the first sign-in). Everything runs on the owner connection (env.ROOT): these tables are outside
// every tenant, and pulse_app can't read them.
import { hashPassword, newToken, newTotpSecret, openSecret, sealSecret, tempPassword, tokenHash, totpUri, verifyPassword, verifyTotp } from "./auth";
import { HttpError, body, json } from "./http";
import { passwordProblem } from "../src/data/password";

const COOKIE = "pulse_platform";
const SESSION_HOURS = 8;
const TICKET_MINUTES = 10;
const MAX_CODE_TRIES = 5;
const WINDOW_MINUTES = 15;
const ACCOUNT_TRIES = 5;
const ADDRESS_TRIES = 20;
const REFUSED = "Wrong username, password or code.";
const DUMMY_HASH = `pbkdf2$100000$${"00".repeat(16)}$${"00".repeat(32)}`;
const TEMPLATE_ORG = "pulse-template";
const TEMPLATE_WORKSPACE = "pulse-template-ws";

/**
 * @param {Request} req
 * @returns {string | null}
 */
function platformToken(req) {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}
/**
 * Only sent to /api/platform, never readable by scripts, never sent from another site.
 * @param {string} token
 * @param {Request} req
 * @param {number} maxAge
 */
const platformCookie = (token, req, maxAge) =>
  `${COOKIE}=${token}; Path=/api/platform; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
/** @param {Env} env */
function sealKey(env) {
  if (!env.MFA_KEY) throw new HttpError(500, "Two-step verification isn't configured on the server (MFA_KEY is missing)");
  return env.MFA_KEY;
}
/**
 * @param {unknown} v
 * @returns {string}
 */
export function cleanCode(v) {
  const code = String(v ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 32);
  return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(code) ? code : "";
}
/**
 * @param {unknown} v
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function text(v, field, max) {
  const s = String(v ?? "").trim();
  if (!s) throw new HttpError(400, `${field} is required`);
  return s.slice(0, max);
}
/**
 * @param {TenantDatabase} db
 * @param {Request} req
 * @param {{ id: string | null; name: string }} who
 * @param {string} action
 * @param {string | null} target
 * @param {Record<string, unknown>} [detail]
 */
async function log(db, req, who, action, target, detail = {}) {
  await db
    .prepare("INSERT INTO platform_activity (at, admin_id, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(new Date().toISOString(), who.id, who.name.slice(0, 64), action, target, JSON.stringify(detail), req.headers.get("cf-connecting-ip"))
    .run()
    .catch((e) => console.error("platform log failed", e));
}
/**
 * Failed platform sign-ins share login_failures (no organisation; the name is marked "platform:").
 * @param {TenantDatabase} db
 * @param {Request} req
 * @param {string} name
 */
async function tooManyFailures(db, req, name) {
  const since = Date.now() - WINDOW_MINUTES * 60_000;
  const ip = req.headers.get("cf-connecting-ip");
  const [account, address] = await Promise.all([
    /** @type {Promise<{ n: number } | null>} */ (db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE username = ? AND at > ?").bind(`platform:${name}`, since).first()),
    ip ? /** @type {Promise<{ n: number } | null>} */ (db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?").bind(ip, since).first()) : Promise.resolve({ n: 0 }),
  ]);
  return Number(account?.n ?? 0) >= ACCOUNT_TRIES || Number(address?.n ?? 0) >= ADDRESS_TRIES;
}
/**
 * @param {TenantDatabase} db
 * @param {Request} req
 * @param {string} name
 */
async function recordFailure(db, req, name) {
  await db
    .prepare("INSERT INTO login_failures (id, at, username, user_id, ip, reason) VALUES (?, ?, ?, NULL, ?, 'password')")
    .bind(newToken().slice(0, 16), Date.now(), `platform:${name}`.slice(0, 64), req.headers.get("cf-connecting-ip"))
    .run();
}

/**
 * The /api/platform routes, or null for any other path.
 * @param {Env} env
 * @param {Request} req
 * @param {string} path
 * @returns {Promise<Response | null>}
 */
export async function platformApi(env, req, path) {
  if (!path.startsWith("/api/platform/")) return null;
  const db = env.ROOT;
  const method = req.method;

  // ---------- signing in: password, then the authenticator app (set up the first time) ----------
  if (path === "/api/platform/login" && method === "POST") {
    const b = /** @type {{ username?: unknown; password?: unknown }} */ (await body(req));
    const name = String(b.username ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 64);
    const row = /** @type {{ id: string; name: string; password_hash: string; mfa_secret: string | null } | null} */ (
      await db.prepare("SELECT id, name, password_hash, mfa_secret FROM platform_admins WHERE lower(username) = ?").bind(name).first()
    );
    const ok = await verifyPassword(String(b.password ?? ""), row?.password_hash ?? DUMMY_HASH);
    if ((await tooManyFailures(db, req, name)) || !row || !ok) {
      await recordFailure(db, req, name);
      await log(db, req, { id: row?.id ?? null, name: name || "(blank)" }, "platform_login_failed", null, {});
      throw new HttpError(401, REFUSED);
    }
    const ticket = newToken();
    const pending = row.mfa_secret ? null : newTotpSecret();
    await db.batch([
      db.prepare("DELETE FROM platform_challenges WHERE expires_at < ? OR admin_id = ?").bind(Date.now(), row.id),
      db
        .prepare("INSERT INTO platform_challenges (token_hash, admin_id, pending_secret, expires_at) VALUES (?, ?, ?, ?)")
        .bind(await tokenHash(ticket), row.id, pending ? await sealSecret(pending, sealKey(env)) : null, Date.now() + TICKET_MINUTES * 60_000),
    ]);
    // First sign-in: the app is set up now, with this secret, before anything else is possible.
    return json(pending ? { ticket, setup: { secret: pending, uri: totpUri(pending, `platform:${name}`) } } : { ticket });
  }
  if (path === "/api/platform/login/code" && method === "POST") {
    const b = /** @type {{ ticket?: unknown; code?: unknown }} */ (await body(req));
    const hash = await tokenHash(String(b.ticket ?? ""));
    const ch = /** @type {{ admin_id: string; pending_secret: string | null; attempts: number } | null} */ (
      await db.prepare("SELECT admin_id, pending_secret, attempts FROM platform_challenges WHERE token_hash = ? AND expires_at > ?").bind(hash, Date.now()).first()
    );
    if (!ch) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const row = /** @type {{ id: string; name: string; username: string; mfa_secret: string | null; mfa_last_step: number } | null} */ (
      await db.prepare("SELECT id, name, username, mfa_secret, mfa_last_step FROM platform_admins WHERE id = ?").bind(ch.admin_id).first()
    );
    if (!row) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const sealed = ch.pending_secret ?? row.mfa_secret;
    const step = sealed ? await verifyTotp(await openSecret(sealed, sealKey(env)), String(b.code ?? "")) : null;
    if (step === null || step <= Number(row.mfa_last_step)) {
      const tries = ch.attempts + 1;
      await recordFailure(db, req, row.username);
      await log(db, req, row, "platform_login_failed", null, { reason: "wrong code" });
      if (tries >= MAX_CODE_TRIES) {
        await db.prepare("DELETE FROM platform_challenges WHERE token_hash = ?").bind(hash).run();
        throw new HttpError(401, "Too many wrong codes. Enter your password again.", "mfa_expired");
      }
      await db.prepare("UPDATE platform_challenges SET attempts = ? WHERE token_hash = ?").bind(tries, hash).run();
      throw new HttpError(401, REFUSED);
    }
    const token = newToken();
    await db.batch([
      db.prepare("DELETE FROM platform_challenges WHERE token_hash = ?").bind(hash),
      db.prepare("UPDATE platform_admins SET mfa_secret = COALESCE(?, mfa_secret), mfa_last_step = ?, last_login_at = ? WHERE id = ?").bind(ch.pending_secret, step, new Date().toISOString(), row.id),
      db.prepare("INSERT INTO platform_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)").bind(await tokenHash(token), row.id, Date.now() + SESSION_HOURS * 3_600_000),
    ]);
    await log(db, req, row, ch.pending_secret ? "platform_mfa_set_up" : "platform_login", null, {});
    return json({ ok: true }, 200, { "set-cookie": platformCookie(token, req, SESSION_HOURS * 3600) });
  }

  // ---------- everything else needs a platform session ----------
  const token = platformToken(req);
  const me = token
    ? /** @type {{ id: string; name: string; username: string; password_hash: string; must_change_password: number } | null} */ (
        await db
          .prepare("SELECT a.id, a.name, a.username, a.password_hash, a.must_change_password FROM platform_sessions s JOIN platform_admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?")
          .bind(await tokenHash(token), Date.now())
          .first()
      )
    : null;
  if (!me) throw new HttpError(401, "Not signed in", "platform_signin");
  if (path === "/api/platform/logout" && method === "POST") {
    await db.prepare("DELETE FROM platform_sessions WHERE token_hash = ?").bind(await tokenHash(/** @type {string} */ (token))).run();
    await log(db, req, me, "platform_logout", null);
    return json({ ok: true }, 200, { "set-cookie": platformCookie("", req, 0) });
  }
  if (path === "/api/platform/me" && method === "GET") return json({ id: me.id, name: me.name, username: me.username, mustChangePassword: !!me.must_change_password });
  if (path === "/api/platform/me/password" && method === "POST") {
    const b = /** @type {{ current?: unknown; password?: unknown }} */ (await body(req));
    if (!(await verifyPassword(String(b.current ?? ""), me.password_hash))) throw new HttpError(400, "Your current password isn't right");
    const fresh = String(b.password ?? "");
    const problem = passwordProblem(fresh, { username: me.username, name: me.name });
    if (problem) throw new HttpError(400, problem, "password_policy");
    if (await verifyPassword(fresh, me.password_hash)) throw new HttpError(400, "Choose a new password", "password_reused");
    await db.batch([
      db.prepare("UPDATE platform_admins SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(await hashPassword(fresh), me.id),
      db.prepare("DELETE FROM platform_sessions WHERE admin_id = ? AND token_hash <> ?").bind(me.id, await tokenHash(/** @type {string} */ (token))),
    ]);
    await log(db, req, me, "platform_password_changed", me.id);
    return json({ ok: true });
  }
  if (me.must_change_password) throw new HttpError(403, "Choose your own password first", "password_change_required");

  // ---------- organisations ----------
  if (path === "/api/platform/organizations" && method === "GET") {
    // What a Platform Administrator may know about an organisation: its name, code, status, when it was made, and
    // how many workspaces and people it has. Nothing inside it.
    const rows = /** @type {D1Result<Record<string, unknown>>} */ (
      await db
        .prepare(
          `SELECT o.id, o.name, o.code, o.status, o.created_at,
                  (SELECT COUNT(*) FROM workspaces w WHERE w.organization_id = o.id AND w.status = 'active') AS workspaces,
                  (SELECT COUNT(*) FROM accounts a WHERE a.organization_id = o.id) AS people,
                  (SELECT COUNT(*) FROM accounts a WHERE a.organization_id = o.id AND a.org_admin = 1) AS admins
           FROM organizations o WHERE o.id <> ? ORDER BY o.created_at`,
        )
        .bind(TEMPLATE_ORG)
        .all()
    );
    return json({
      organizations: rows.results.map((r) => ({ id: r.id, name: r.name, code: r.code, status: r.status, createdAt: r.created_at, workspaces: Number(r.workspaces), people: Number(r.people), admins: Number(r.admins) })),
    });
  }
  if (path === "/api/platform/organizations" && method === "POST") {
    const b = /** @type {{ name?: unknown; code?: unknown; admin?: { username?: unknown; name?: unknown; email?: unknown } }} */ (await body(req));
    const name = text(b.name, "The organisation's name", 80);
    const code = cleanCode(b.code);
    if (!code) throw new HttpError(400, "A code is 1–32 lower-case letters, numbers and dashes, such as acme or acme-zw");
    if (code === TEMPLATE_ORG) throw new HttpError(409, "That code is taken");
    if (await db.prepare("SELECT 1 FROM organizations WHERE code = ?").bind(code).first()) throw new HttpError(409, "That code is taken");
    const admin = newAdmin(b.admin);
    const orgId = newToken().slice(0, 16);
    const wsId = newToken().slice(0, 16);
    const accountId = `${admin.username.replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${newToken().slice(0, 6)}`;
    const temp = tempPassword();
    const now = new Date().toISOString();
    // One transaction: the organisation, its configuration from the template, a first workspace "Projects" (with
    // the template's service desk request types) and its first administrator, who must choose a password at the
    // first sign-in.
    await db.batch([
      db.prepare("INSERT INTO organizations (id, name, code, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(orgId, name, code, now, now),
      db.prepare("SELECT tenancy_seed_organization(?, ?)").bind(orgId, TEMPLATE_ORG),
      db.prepare("INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (?, ?, 'Projects', 'PROJECTS', 0, ?, ?)").bind(wsId, orgId, now, now),
      db.prepare("SELECT tenancy_seed_workspace(?, ?)").bind(wsId, TEMPLATE_WORKSPACE),
      db
        .prepare("INSERT INTO accounts (id, username, name, email, role, password_hash, must_change_password, organization_id, org_admin) VALUES (?, ?, ?, ?, 'admin', ?, 1, ?, 1)")
        .bind(accountId, admin.username, admin.name, admin.email, await hashPassword(temp), orgId),
      db.prepare("INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, 'admin', ?)").bind(orgId, wsId, accountId, now),
    ]);
    await log(db, req, me, "organization_created", orgId, { name, code, admin: admin.username });
    return json(
      {
        organization: { id: orgId, name, code, status: "active" },
        admin: { username: admin.username, temporaryPassword: temp },
        signInLink: `${env.PUBLIC_URL ?? new URL(req.url).origin}/#/o/${code}`,
      },
      201,
    );
  }
  const orgMatch = path.match(/^\/api\/platform\/organizations\/([A-Za-z0-9_-]{1,64})(\/admins)?$/);
  if (orgMatch) {
    const org = /** @type {{ id: string; name: string; code: string; status: string } | null} */ (
      orgMatch[1] === TEMPLATE_ORG ? null : await db.prepare("SELECT id, name, code, status FROM organizations WHERE id = ?").bind(orgMatch[1]).first()
    );
    if (!org) throw new HttpError(404, "Organisation not found");
    // Rename, suspend (nobody in it can sign in or use a link or token until it's active again), or archive.
    if (!orgMatch[2] && method === "PATCH") {
      const b = /** @type {{ name?: unknown; status?: unknown }} */ (await body(req));
      const name = b.name === undefined ? org.name : text(b.name, "The organisation's name", 80);
      const status = b.status === undefined ? org.status : String(b.status);
      if (!["active", "suspended", "archived"].includes(status)) throw new HttpError(400, "Status is active, suspended or archived");
      await db.batch([
        db.prepare("UPDATE organizations SET name = ?, status = ?, updated_at = ? WHERE id = ?").bind(name, status, new Date().toISOString(), org.id),
        // Leaving "active" ends every session in it at once (they would stop working anyway).
        ...(status !== "active" ? [db.prepare("DELETE FROM sessions WHERE organization_id = ?").bind(org.id)] : []),
      ]);
      await log(db, req, me, status !== org.status ? `organization_${status === "active" ? "reactivated" : status}` : "organization_renamed", org.id, { from: { name: org.name, status: org.status }, to: { name, status } });
      return json({ organization: { ...org, name, status } });
    }
    // Another administrator for an organisation that has lost all of its own.
    if (orgMatch[2] && method === "POST") {
      const admin = newAdmin(await body(req));
      if (await db.prepare("SELECT 1 FROM accounts WHERE organization_id = ? AND lower(username) = lower(?)").bind(org.id, admin.username).first()) throw new HttpError(409, "That username is taken in this organisation");
      const ws = /** @type {{ id: string } | null} */ (await db.prepare("SELECT id FROM workspaces WHERE organization_id = ? AND status = 'active' ORDER BY position, name LIMIT 1").bind(org.id).first());
      if (!ws) throw new HttpError(409, "This organisation has no active workspace");
      const accountId = `${admin.username.replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${newToken().slice(0, 6)}`;
      const temp = tempPassword();
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare("INSERT INTO accounts (id, username, name, email, role, password_hash, must_change_password, organization_id, org_admin) VALUES (?, ?, ?, ?, 'admin', ?, 1, ?, 1)")
          .bind(accountId, admin.username, admin.name, admin.email, await hashPassword(temp), org.id),
        db.prepare("INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, 'admin', ?)").bind(org.id, ws.id, accountId, now),
      ]);
      await log(db, req, me, "organization_admin_added", org.id, { username: admin.username });
      return json({ admin: { username: admin.username, temporaryPassword: temp }, signInLink: `${env.PUBLIC_URL ?? new URL(req.url).origin}/#/o/${org.code}` }, 201);
    }
  }
  throw new HttpError(404, "Not found");
}
/**
 * An organisation's first (or a new) administrator, as given.
 * @param {unknown} v
 * @returns {{ username: string; name: string; email: string | null }}
 */
function newAdmin(v) {
  const a = /** @type {{ username?: unknown; name?: unknown; email?: unknown }} */ (v ?? {});
  const username = String(a.username ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "The administrator's username: 3–32 letters, numbers, dots, dashes");
  const email = String(a.email ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right");
  return { username, name: text(a.name, "The administrator's name", 80), email: email ? email.slice(0, 200) : null };
}
