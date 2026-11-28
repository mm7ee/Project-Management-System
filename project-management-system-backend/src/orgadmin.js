/** @import { Role } from '../../project-management-system-frontend/src/data/roles' */
/** @import { Blueprint } from '../../project-management-system-frontend/src/data/workspaceTemplates' */
// Organisation administration, added by the administrator module (phase 1, migration 0017):
//   - the organisation profile (time zone, working days and hours, contact email); its branding is worker/branding.js
//   - inviting people by email, one at a time or from a CSV file
//   - deactivating and reactivating accounts
//   - copying a workspace's configuration into a new one
//   - the administration audit log
// The older routes (workspaces, people, memberships) are in worker/index.js. Everything here runs with the
// organisation's handle (orgDb), which row-level security limits to this organisation; only the Organisation
// Administrators reach it, except a workspace's own audit log.
import { BRAND } from "../../project-management-system-frontend/src/data/brand";
import { auditEntry, adminAudit, changed } from "./audit";
import { hashPassword, newToken, tokenHash } from "./auth";
import { HttpError, body, json } from "./http";
import { readDelivery, securityEmail, sendEmail, noteFailure } from "./notify";
import { ROLES, ROLE_LABEL } from "../../project-management-system-frontend/src/data/roles";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, parseCsv } from "../../project-management-system-frontend/src/data/csv";
import { WORKSPACE_ICONS } from "../../project-management-system-frontend/src/data/orgAdmin";
import { applyBlueprint, exportBlueprint } from "./blueprints";
import { orgBrandingApi } from "./branding";
import { themeApi } from "./theme";
import { BUILT_IN_TEMPLATES } from "../../project-management-system-frontend/src/data/workspaceTemplates";

export const INVITE_HOURS = 72;
const AUDIT_PAGE = 100;

/**
 * @typedef {Object} OrgContext
 * @property {Env} env
 * @property {Request} req
 * @property {ExecutionContext} ctx
 * @property {string} path
 * @property {string} method
 * @property {{ id: string; name: string; org_admin: number | boolean }} me
 * @property {Scope} scope
 * @property {D1Database} odb      the organisation's handle (no workspace)
 * @property {boolean} orgAdmin   signed in as an Organisation Administrator (not a link or an API token)
 * @property {boolean} canAudit   has the audit_log permission in the open workspace
 */

/**
 * The routes in this file, or null for any other path.
 * @param {OrgContext} c
 * @returns {Promise<Response | null>}
 */
export async function orgAdminApi(c) {
  const { path, method } = c;
  if (path === "/api/audit-log" && method === "GET") {
    if (!c.canAudit) throw new HttpError(403, "You don't have permission to do that");
    return auditList(c, c.scope.workspaceId);
  }
  if (!path.startsWith("/api/org/")) return null;
  const known =
    path === "/api/org/profile" ||
    path === "/api/org/branding" ||
    /^\/api\/org\/theme(\/draft|\/publish|\/rollback|\/off)?$/.test(path) ||
    path === "/api/org/invites" ||
    path === "/api/org/people/import" ||
    path === "/api/org/audit" ||
    path === "/api/org/templates" ||
    /^\/api\/org\/templates\/[a-f0-9]{12}$/.test(path) ||
    /^\/api\/org\/people\/[a-z0-9._-]{1,80}\/(deactivate|reactivate)$/.test(path);
  if (!known) return null;
  if (!c.orgAdmin) throw new HttpError(403, "Only your organisation's administrators can change this: it applies to every workspace", "org_admin_only");
  if (path === "/api/org/profile" && method === "GET") return json({ profile: await profile(c.odb, c.scope.orgId) });
  if (path === "/api/org/profile" && method === "PUT") return saveProfile(c);
  if (path === "/api/org/branding") return orgBrandingApi(c);
  if (path.startsWith("/api/org/theme")) {
    return themeApi({
      env: c.env, req: c.req, method, sub: path.slice("/api/org/theme".length), db: c.odb, orgId: c.scope.orgId, me: c.me,
      audit: (action, detail) => auditEntry(c.odb, c.req, c.me, { action, type: "organization", id: c.scope.orgId, before: null, after: detail }).run(),
    });
  }
  if (path === "/api/org/invites" && method === "POST") {
    const b = /** @type {Record<string, unknown>} */ (await body(c.req));
    const spaces = await workspaceIndex(c.odb);
    const person = cleanInvite(b, spaces, await takenUsernames(c.odb));
    const made = await invite(c, person);
    return json(made, 201);
  }
  if (path === "/api/org/people/import" && method === "POST") return importPeople(c);
  if (path === "/api/org/audit" && method === "GET") return auditList(c, new URL(c.req.url).searchParams.get("workspace"));
  if (path === "/api/org/templates" && method === "GET") return json(await templateList(c.odb));
  if (path === "/api/org/templates" && method === "POST") return saveTemplate(c);
  const tpl = path.match(/^\/api\/org\/templates\/([a-f0-9]{12})$/);
  if (tpl && method === "DELETE") {
    const row = /** @type {{ name: string } | null} */ (await c.odb.prepare("SELECT name FROM workspace_templates WHERE id = ?").bind(tpl[1]).first());
    if (!row) throw new HttpError(404, "Template not found");
    await c.odb.batch([c.odb.prepare("DELETE FROM workspace_templates WHERE id = ?").bind(tpl[1]), auditEntry(c.odb, c.req, c.me, { action: "template_deleted", type: "setting", id: tpl[1], before: { name: row.name } })]);
    return json({ ok: true });
  }
  const active = path.match(/^\/api\/org\/people\/([a-z0-9._-]{1,80})\/(deactivate|reactivate)$/);
  if (active && method === "POST") return setActive(c, active[1], active[2] === "reactivate");
  throw new HttpError(404, "Not found");
}

// ---------- the organisation profile ----------

/**
 * @param {D1Database} odb
 * @param {string} orgId
 */
async function profile(odb, orgId) {
  const r = /** @type {Record<string, string | null> | null} */ (
    await odb.prepare("SELECT name, code, time_zone, work_days, work_start, work_end, contact_email, updated_at FROM organizations WHERE id = ?").bind(orgId).first()
  );
  if (!r) throw new HttpError(404, "Not found");
  // The logo and colour are the organisation's branding now (worker/branding.js, /api/org/branding).
  return {
    name: r.name,
    code: r.code,
    timeZone: r.time_zone,
    workDays: String(r.work_days).split(",").map(Number),
    workStart: r.work_start,
    workEnd: r.work_end,
    contactEmail: r.contact_email,
  };
}

/**
 * A time zone the runtime knows, such as Africa/Harare.
 * @param {unknown} v
 * @returns {string}
 */
export function cleanTimeZone(v) {
  const tz = String(v ?? "").trim();
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) throw new HttpError(400, "Choose a time zone, such as Africa/Harare");
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new HttpError(400, `${tz} isn't a time zone PMS knows`);
  }
  return tz;
}

/** @param {OrgContext} c */
async function saveProfile(c) {
  const b = /** @type {Record<string, unknown>} */ (await body(c.req));
  const before = await profile(c.odb, c.scope.orgId);
  const timeZone = b.timeZone === undefined ? String(before.timeZone) : cleanTimeZone(b.timeZone);
  const days = b.workDays === undefined ? before.workDays : Array.isArray(b.workDays) ? [...new Set(b.workDays.map(Number))].sort() : [];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new HttpError(400, "Choose at least one working day");
  const time = /** @param {unknown} v @param {string} fallback */ (v, fallback) => {
    const t = v === undefined ? fallback : String(v);
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)) throw new HttpError(400, "Working hours are times like 08:00");
    return t;
  };
  const workStart = time(b.workStart, String(before.workStart));
  const workEnd = time(b.workEnd, String(before.workEnd));
  if (workEnd <= workStart) throw new HttpError(400, "The working day must end after it starts");
  const contactEmail = b.contactEmail === undefined ? before.contactEmail : b.contactEmail === null || b.contactEmail === "" ? null : String(b.contactEmail).trim();
  if (contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpError(400, "That contact email doesn't look right");
  const now = new Date().toISOString();
  const after = { timeZone, workDays: days, workStart, workEnd, contactEmail };
  const diff = changed({ timeZone: before.timeZone, workDays: before.workDays, workStart: before.workStart, workEnd: before.workEnd, contactEmail: before.contactEmail }, after);
  if (!diff) return json({ profile: before });
  await c.odb.batch([
    c.odb
      .prepare("UPDATE organizations SET time_zone = ?, work_days = ?, work_start = ?, work_end = ?, contact_email = ?, updated_at = ? WHERE id = ?")
      .bind(timeZone, days.join(","), workStart, workEnd, contactEmail, now, c.scope.orgId),
    auditEntry(c.odb, c.req, c.me, { action: "organization_profile_updated", type: "organization", id: c.scope.orgId, before: diff.before, after: diff.after }),
  ]);
  return json({ profile: await profile(c.odb, c.scope.orgId) });
}


// ---------- inviting people ----------

/**
 * @typedef {{ id: string; name: string; key: string }} WorkspaceRef
 * @typedef {{ email: string; name: string; username: string; title: string; orgAdmin: boolean; workspaces: Map<string, Role> }} InvitePerson
 */

/** @param {D1Database} odb @returns {Promise<WorkspaceRef[]>} */
async function workspaceIndex(odb) {
  return /** @type {WorkspaceRef[]} */ ((await odb.prepare("SELECT id, name, key FROM workspaces WHERE status = 'active'").all()).results);
}

/** @param {D1Database} odb @returns {Promise<Set<string>>} */
async function takenUsernames(odb) {
  return new Set((/** @type {{ u: string }[]} */ ((await odb.prepare("SELECT lower(username) AS u FROM accounts").all()).results)).map((r) => r.u));
}

/**
 * A role by its key or by the name PMS shows. "Viewer" is the read-only role; "Standard user" is `viewer`.
 * @param {unknown} v
 * @returns {Role | null}
 */
export function roleFrom(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "viewer" || s === "read-only" || s === "read only" || s === "reader") return "reader";
  if (s === "standard user" || s === "standard") return "viewer";
  if (s === "workspace admin" || s === "workspace administrator") return "admin";
  for (const r of ROLES) if (r === s || ROLE_LABEL[r].toLowerCase() === s) return r;
  return null;
}

/**
 * A username from an email address, made unique within the organisation.
 * @param {string} email
 * @param {Set<string>} taken  lower-cased; the chosen name is added
 * @returns {string}
 */
export function usernameFor(email, taken) {
  const base =
    email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 28) || "user";
  let name = base.length >= 3 ? base : `${base}-user`.slice(0, 28);
  for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 28)}${n}`;
  taken.add(name);
  return name;
}

/**
 * Checks one person to invite. Throws an HttpError (400 or 409) describing the first problem.
 * @param {Record<string, unknown>} b  { email, name, username?, title?, orgAdmin?, workspaces: [{ workspaceId, role }] }
 * @param {WorkspaceRef[]} spaces
 * @param {Set<string>} taken  lower-cased usernames already used; the new one is added
 * @returns {InvitePerson}
 */
export function cleanInvite(b, spaces, taken) {
  const email = String(b.email ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new HttpError(400, "Give an email address to send the invitation to");
  const name = String(b.name ?? "")
    .trim()
    .slice(0, 80);
  if (!name) throw new HttpError(400, "Give their full name");
  let username;
  if (b.username !== undefined && b.username !== null && b.username !== "") {
    username = String(b.username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "Username: 3–32 letters, numbers, dots, dashes");
    if (taken.has(username)) throw new HttpError(409, `The username ${username} is taken`);
    taken.add(username);
  } else username = usernameFor(email, taken);
  if (!Array.isArray(b.workspaces) || !b.workspaces.length) throw new HttpError(400, "Add them to at least one workspace");
  /** @type {Map<string, Role>} */ const workspaces = new Map();
  for (const m of b.workspaces) {
    const ws = spaces.find((w) => w.id === m?.workspaceId);
    if (!ws) throw new HttpError(404, "Workspace not found");
    const role = roleFrom(m?.role);
    if (!role) throw new HttpError(400, "Unknown role");
    workspaces.set(ws.id, role);
  }
  return { email, name, username, title: String(b.title ?? "").trim().slice(0, 80), orgAdmin: !!b.orgAdmin, workspaces };
}

/**
 * Makes the account and its one-time "choose your password" link, and emails it when email is set up. Without
 * email, the link is returned for the administrator to pass on (shown once; only its hash is kept).
 * @param {OrgContext} c
 * @param {InvitePerson} p
 * @returns {Promise<{ id: string; username: string; emailed: boolean; link?: string }>}
 */
async function invite(c, p) {
  const { odb, env, req } = c;
  if (await odb.prepare("SELECT 1 FROM accounts WHERE lower(email) = ?").bind(p.email).first()) throw new HttpError(409, `Someone in your organisation already uses ${p.email}`);
  const id = `${p.username.replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${newToken().slice(0, 6)}`;
  const token = newToken();
  const at = Date.now();
  const nowIso = new Date(at).toISOString();
  const first = /** @type {Role} */ ([...p.workspaces.values()][0]);
  await odb.batch([
    // Nobody knows this password: they choose theirs through the link.
    odb
      .prepare("INSERT INTO accounts (id, username, name, title, email, role, password_hash, must_change_password, org_admin) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .bind(id, p.username, p.name, p.title, p.email, first, await hashPassword(newToken()), p.orgAdmin ? 1 : 0),
    ...[...p.workspaces].map(([w, role]) => odb.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").bind(w, id, role, nowIso)),
    odb
      .prepare("INSERT INTO password_resets (id, created_at, login, user_id, ip, outcome, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)")
      .bind(newToken().slice(0, 16), at, p.username, id, req.headers.get("cf-connecting-ip"), await tokenHash(token), at + INVITE_HOURS * 3_600_000),
    auditEntry(odb, req, c.me, {
      action: "person_invited",
      type: "invite",
      id,
      after: { name: p.name, username: p.username, email: p.email, orgAdmin: p.orgAdmin, workspaces: Object.fromEntries(p.workspaces) },
    }),
  ]);
  const org = /** @type {{ name: string; code: string }} */ (await odb.prepare("SELECT name, code FROM organizations WHERE id = ?").bind(c.scope.orgId).first());
  const link = `${env.PUBLIC_URL ?? new URL(req.url).origin}/#/reset-password/${token}`;
  const delivery = await readDelivery(odb);
  if (delivery.resendKey && delivery.from && env.MFA_KEY) {
    const mail = securityEmail(
      `You're invited to ${org.name} on ${BRAND.shortName}`,
      [
        `Hi ${p.name}, ${c.me.name} has invited you to ${org.name}'s ${BRAND.productName}.`,
        `Your username is ${p.username} and your organisation code is ${org.code}. Choose your password with the link below; it works once, within ${INVITE_HOURS} hours.`,
      ],
      { label: "Choose your password", url: link },
    );
    c.ctx.waitUntil(sendEmail(env, delivery, p.email, mail.subject, mail.html, mail.text).catch((e) => noteFailure(odb, "Email", e)));
    return { id, username: p.username, emailed: true };
  }
  return { id, username: p.username, emailed: false, link };
}

/**
 * People from a CSV file: a header row naming the columns (email, name, username, title, workspace, role, orgadmin),
 * then one row per person, or several rows for one email to put them in several workspaces. "workspace" is a
 * workspace's key or name (several separated by ;). Everything is checked first; if any row has a problem, nobody is
 * invited and every problem is listed.
 * @param {OrgContext} c
 */
async function importPeople(c) {
  const b = /** @type {{ csv?: unknown; check?: unknown }} */ (await body(c.req));
  const rows = parseCsv(String(b.csv ?? ""));
  if (rows.length < 2) throw new HttpError(400, "The file needs a header row and at least one person");
  const header = rows[0].map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const col = /** @param {(typeof IMPORT_COLUMNS)[number]} name */ (name) => header.indexOf(name);
  for (const need of /** @type {const} */ (["email", "name", "workspace", "role"])) {
    if (col(need) < 0) throw new HttpError(400, `The header row needs a "${need}" column`);
  }
  const unknown = rows[0].filter((_, i) => !(/** @type {readonly string[]} */ (IMPORT_COLUMNS).includes(header[i])));
  if (unknown.length) throw new HttpError(400, `Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  const spaces = await workspaceIndex(c.odb);
  const taken = await takenUsernames(c.odb);
  const existing = new Set((/** @type {{ e: string }[]} */ ((await c.odb.prepare("SELECT lower(email) AS e FROM accounts WHERE email IS NOT NULL").all()).results)).map((r) => r.e));
  /** @type {Map<string, { line: number; raw: Record<string, unknown>; workspaces: { workspaceId: string; role: string }[] }>} */ const people = new Map();
  /** @type {{ line: number; problem: string }[]} */ const problems = [];
  const cell = /** @param {string[]} r @param {(typeof IMPORT_COLUMNS)[number]} name */ (r, name) => (col(name) >= 0 ? (r[col(name)] ?? "") : "");
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const email = cell(r, "email").toLowerCase();
    const roleName = cell(r, "role");
    if (!roleFrom(roleName)) return void problems.push({ line, problem: `Unknown role "${roleName}"` });
    const names = cell(r, "workspace")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return void problems.push({ line, problem: "No workspace" });
    /** @type {{ workspaceId: string; role: string }[]} */ const ws = [];
    for (const n of names) {
      const w = spaces.find((s) => s.key === n.toUpperCase() || s.name.toLowerCase() === n.toLowerCase());
      if (!w) return void problems.push({ line, problem: `No active workspace called "${n}"` });
      ws.push({ workspaceId: w.id, role: roleName });
    }
    const was = people.get(email);
    if (was) was.workspaces.push(...ws);
    else
      people.set(email, {
        line,
        raw: { email, name: cell(r, "name"), username: cell(r, "username") || undefined, title: cell(r, "title"), orgAdmin: /^(y|yes|true|1)$/i.test(cell(r, "orgadmin")) },
        workspaces: ws,
      });
  });
  if (people.size > MAX_IMPORT_ROWS) throw new HttpError(400, `Import up to ${MAX_IMPORT_ROWS} people at a time`);
  /** @type {{ line: number; person: InvitePerson }[]} */ const ready = [];
  for (const [email, p] of people) {
    if (existing.has(email)) {
      problems.push({ line: p.line, problem: `Someone in your organisation already uses ${email}` });
      continue;
    }
    try {
      ready.push({ line: p.line, person: cleanInvite({ ...p.raw, workspaces: p.workspaces }, spaces, taken) });
    } catch (e) {
      problems.push({ line: p.line, problem: e instanceof Error ? e.message : "Not valid" });
    }
  }
  if (problems.length) {
    problems.sort((a, b2) => a.line - b2.line);
    return json({ error: `${problems.length} row${problems.length > 1 ? "s have" : " has"} a problem; nobody was invited`, code: "import_invalid", problems }, 400);
  }
  // "Check" only reports what would happen.
  if (b.check) return json({ people: ready.map((r) => ({ line: r.line, name: r.person.name, username: r.person.username, email: r.person.email, workspaces: Object.fromEntries(r.person.workspaces) })) });
  /** @type {{ line: number; name: string; username: string; email: string; emailed: boolean; link?: string }[]} */ const made = [];
  for (const r of ready) {
    const m = await invite(c, r.person);
    made.push({ line: r.line, name: r.person.name, username: m.username, email: r.person.email, emailed: m.emailed, ...(m.link ? { link: m.link } : {}) });
  }
  await adminAudit(c.odb, c.req, c.me, { action: "people_imported", type: "invite", after: { count: made.length } });
  return json({ people: made }, 201);
}

// ---------- deactivating ----------

/**
 * Deactivated: can't sign in, their sessions end and their API tokens stop working; their history, memberships and
 * assignments stay. Reactivating lets them sign in again with the password they had.
 * @param {OrgContext} c
 * @param {string} id
 * @param {boolean} on
 */
async function setActive(c, id, on) {
  const p = /** @type {{ id: string; name: string; org_admin: number; deactivated_at: string | null } | null} */ (
    await c.odb.prepare("SELECT id, name, org_admin, deactivated_at FROM accounts WHERE id = ?").bind(id).first()
  );
  if (!p) throw new HttpError(404, "Person not found");
  if (!on && p.id === c.me.id) throw new HttpError(409, "You can't deactivate yourself");
  if (!!p.deactivated_at === !on) return json({ ok: true });
  if (!on && p.org_admin) {
    const left = Number((/** @type {{ n: number }} */ (await c.odb.prepare("SELECT COUNT(*) AS n FROM accounts WHERE org_admin = 1 AND deactivated_at IS NULL").first())).n);
    if (left <= 1) throw new HttpError(409, "Keep at least one active Organisation Administrator");
  }
  const now = new Date().toISOString();
  await c.odb.batch([
    c.odb.prepare("UPDATE accounts SET deactivated_at = ? WHERE id = ?").bind(on ? null : now, p.id),
    ...(on ? [] : [c.odb.prepare("DELETE FROM sessions WHERE user_id = ?").bind(p.id), c.odb.prepare("UPDATE password_resets SET expires_at = ? WHERE user_id = ? AND used_at IS NULL").bind(Date.now(), p.id)]),
    auditEntry(c.odb, c.req, c.me, { action: on ? "person_reactivated" : "person_deactivated", type: "person", id: p.id, before: { name: p.name, active: !on }, after: { name: p.name, active: on } }),
  ]);
  return json({ ok: true });
}

// ---------- a workspace's look and visibility ----------

/**
 * The icon, colour, description and visibility sent for a workspace; only what was sent.
 * @param {Record<string, unknown>} b
 * @returns {{ icon?: string; colour?: string | null; description?: string; visibility?: "private" | "organization" }}
 */
export function cleanWorkspaceStyle(b) {
  /** @type {{ icon?: string; colour?: string | null; description?: string; visibility?: "private" | "organization" }} */ const out = {};
  if (b.icon !== undefined) {
    if (!(/** @type {readonly string[]} */ (WORKSPACE_ICONS).includes(String(b.icon)))) throw new HttpError(400, "Choose one of the workspace icons");
    out.icon = String(b.icon);
  }
  if (b.colour !== undefined) {
    const v = b.colour === null || b.colour === "" ? null : String(b.colour).toLowerCase();
    if (v !== null && !/^#[0-9a-f]{6}$/.test(v)) throw new HttpError(400, "A colour is # and six hex digits, such as #1f6feb");
    out.colour = v;
  }
  if (b.description !== undefined) out.description = String(b.description ?? "").trim().slice(0, 300);
  if (b.visibility !== undefined) {
    if (b.visibility !== "private" && b.visibility !== "organization") throw new HttpError(400, "A workspace is private or open to the organisation");
    out.visibility = b.visibility;
  }
  return out;
}

// ---------- templates for new workspaces ----------

/** What a template sets up, in a line. @param {Blueprint} bp */
const summaryOf = (bp) => ({
  statuses: bp.workflows.find((w) => w.key === bp.workspaceWorkflow)?.statuses.map((s) => bp.statuses.find((x) => x.key === s.status)?.name ?? s.status) ?? [],
  itemTypes: bp.itemTypes.filter((t) => t.active !== false).map((t) => t.name),
  fields: bp.fields.map((f) => f.name),
});

/** The built-in templates and the organisation's own. @param {D1Database} odb */
async function templateList(odb) {
  const own = /** @type {{ id: string; name: string; description: string; data: string; created_at: string; created_by: string | null }[]} */ (
    (await odb.prepare("SELECT id, name, description, data, created_at, created_by FROM workspace_templates ORDER BY lower(name)").all()).results
  );
  return {
    builtIn: BUILT_IN_TEMPLATES.map((t) => ({ id: `builtin:${t.id}`, name: t.name, description: t.description, icon: t.icon, key: t.key, ...summaryOf(t.blueprint) })),
    organisation: own.map((t) => ({ id: `org:${t.id}`, name: t.name, description: t.description, createdAt: t.created_at, ...summaryOf(JSON.parse(t.data)) })),
  };
}

/**
 * A template by its reference: "builtin:<id>" or "org:<id>" (this organisation's).
 * @param {D1Database} odb  the organisation's handle
 * @param {string} ref
 * @returns {Promise<{ name: string; blueprint: Blueprint }>}
 */
export async function templateBlueprint(odb, ref) {
  const [kind, id] = ref.split(":");
  if (kind === "builtin") {
    const t = BUILT_IN_TEMPLATES.find((x) => x.id === id);
    if (t) return { name: t.name, blueprint: t.blueprint };
  }
  if (kind === "org" && /^[a-f0-9]{12}$/.test(id ?? "")) {
    const row = /** @type {{ name: string; data: string } | null} */ (await odb.prepare("SELECT name, data FROM workspace_templates WHERE id = ?").bind(id).first());
    if (row) return { name: row.name, blueprint: JSON.parse(row.data) };
  }
  throw new HttpError(404, "Template not found");
}

/** Saves one of the organisation's workspaces' set-up as a template. @param {OrgContext} c */
async function saveTemplate(c) {
  const b = /** @type {{ workspaceId?: unknown; name?: unknown; description?: unknown }} */ (await body(c.req));
  const ws = /** @type {{ id: string; name: string } | null} */ (await c.odb.prepare("SELECT id, name FROM workspaces WHERE id = ?").bind(String(b.workspaceId ?? "")).first());
  if (!ws) throw new HttpError(404, "Workspace not found");
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "Name the template");
  if (BUILT_IN_TEMPLATES.some((t) => t.name.toLowerCase() === name.toLowerCase()) || (await c.odb.prepare("SELECT 1 FROM workspace_templates WHERE lower(name) = lower(?)").bind(name).first())) {
    throw new HttpError(409, `There's already a template called ${name}`);
  }
  const bp = await exportBlueprint(c.env.ROOT.withScope({ orgId: c.scope.orgId, workspaceId: ws.id }), ws.id);
  // Templates set up new workspaces of any kind: the automation rules (which name this workspace's people and
  // projects) and workload limits stay with the workspace.
  const data = { ...bp, rules: [], limits: null };
  const id = newToken().slice(0, 12);
  await c.odb.batch([
    c.odb
      .prepare("INSERT INTO workspace_templates (id, name, description, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, name, String(b.description ?? "").trim().slice(0, 300), JSON.stringify(data), c.me.id, new Date().toISOString()),
    auditEntry(c.odb, c.req, c.me, { action: "template_saved", type: "setting", id, workspaceId: ws.id, after: { name, from: ws.name } }),
  ]);
  return json({ template: { id: `org:${id}`, name, ...summaryOf(data) } }, 201);
}

// ---------- copying a workspace's configuration ----------

/**
 * Copies a workspace's set-up into a new, empty workspace of the same organisation, with no work: its workflows (as
 * the new workspace's own), item types, custom fields, automation rules (switched off, to be checked before use) and
 * workload limits (worker/blueprints.js). Both workspaces must already be known to belong to `orgId` (checked by the
 * caller with the organisation's handle); each side is read or written through its own workspace's handle.
 * @param {Env} env
 * @param {string} orgId
 * @param {string} from
 * @param {string} to
 * @param {string} toName
 */
export async function cloneWorkspaceConfig(env, orgId, from, to, toName) {
  const bp = await exportBlueprint(env.ROOT.withScope({ orgId, workspaceId: from }), from);
  const r = await applyBlueprint(env.ROOT.withScope({ orgId, workspaceId: to }), to, toName, bp, { rules: true });
  return { workflows: r.workflows, itemTypes: r.itemTypes, fields: r.fields, rules: r.rules };
}

// ---------- the audit log ----------

/**
 * Newest first, a page at a time (?before=<id>). Organisation Administrators see every entry, or one workspace's
 * (?workspace=<id>); people with the audit permission see their open workspace's only.
 * @param {OrgContext} c
 * @param {string | null} workspaceId
 */
async function auditList(c, workspaceId) {
  const q = new URL(c.req.url).searchParams;
  const before = Number(q.get("before") ?? 0);
  const where = ["TRUE"];
  /** @type {unknown[]} */ const args = [];
  if (workspaceId) {
    where.push("a.workspace_id = ?");
    args.push(workspaceId);
  }
  if (Number.isSafeInteger(before) && before > 0) {
    where.push("a.id < ?");
    args.push(before);
  }
  const action = q.get("action");
  if (action && /^[a-z_]{1,60}$/.test(action)) {
    where.push("a.action = ?");
    args.push(action);
  }
  const rows = /** @type {Record<string, unknown>[]} */ (
    (
      await c.odb
        .prepare(`SELECT a.*, w.name AS workspace_name FROM audit_log a LEFT JOIN workspaces w ON w.id = a.workspace_id WHERE ${where.join(" AND ")} ORDER BY a.id DESC LIMIT ${AUDIT_PAGE + 1}`)
        .bind(...args)
        .all()
    ).results
  );
  const parse = /** @param {unknown} v */ (v) => (typeof v === "string" ? JSON.parse(v) : null);
  return json({
    entries: rows.slice(0, AUDIT_PAGE).map((r) => ({
      id: Number(r.id),
      at: r.at,
      actor: r.actor,
      actorId: r.actor_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      workspace: r.workspace_name ?? null,
      before: parse(r.before),
      after: parse(r.after),
      ip: r.ip,
    })),
    more: rows.length > AUDIT_PAGE,
  });
}
