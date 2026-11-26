/** @import { Role } from '../src/data/roles' */
// Organisation administration, added by the administrator module (phase 1, migration 0017):
//   - the organisation profile (logo, colour, time zone, working days and hours, contact email) and its logo
//   - inviting people by email, one at a time or from a CSV file
//   - deactivating and reactivating accounts
//   - copying a workspace's configuration into a new one
//   - the administration audit log
// The older routes (workspaces, people, memberships) are in worker/index.js. Everything here runs with the
// organisation's handle (orgDb), which row-level security limits to this organisation; only the Organisation
// Administrators reach it, except the logo (anyone signed in to the organisation) and a workspace's own audit log.
import { auditEntry, adminAudit, changed } from "./audit";
import { hashPassword, newToken, tokenHash } from "./auth";
import { HttpError, body, json } from "./http";
import { readDelivery, securityEmail, sendEmail, noteFailure } from "./notify";
import { ROLES, ROLE_LABEL } from "../src/data/roles";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, parseCsv } from "../src/data/csv";
import { WORKSPACE_ICONS } from "../src/data/orgAdmin";

export const INVITE_HOURS = 72;
const LOGO_MAX_BYTES = 140_000; // as base64 in the data: URL, under the database's 200,000-character limit
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
  if (path === "/api/org/logo" && method === "GET") return logo(c);
  if (path === "/api/audit-log" && method === "GET") {
    if (!c.canAudit) throw new HttpError(403, "You don't have permission to do that");
    return auditList(c, c.scope.workspaceId);
  }
  if (!path.startsWith("/api/org/")) return null;
  const known =
    path === "/api/org/profile" ||
    path === "/api/org/invites" ||
    path === "/api/org/people/import" ||
    path === "/api/org/audit" ||
    /^\/api\/org\/people\/[a-z0-9._-]{1,80}\/(deactivate|reactivate)$/.test(path);
  if (!known) return null;
  if (!c.orgAdmin) throw new HttpError(403, "Only your organisation's administrators can change this: it applies to every workspace", "org_admin_only");
  if (path === "/api/org/profile" && method === "GET") return json({ profile: await profile(c.odb, c.scope.orgId) });
  if (path === "/api/org/profile" && method === "PUT") return saveProfile(c);
  if (path === "/api/org/invites" && method === "POST") {
    const b = /** @type {Record<string, unknown>} */ (await body(c.req));
    const spaces = await workspaceIndex(c.odb);
    const person = cleanInvite(b, spaces, await takenUsernames(c.odb));
    const made = await invite(c, person);
    return json(made, 201);
  }
  if (path === "/api/org/people/import" && method === "POST") return importPeople(c);
  if (path === "/api/org/audit" && method === "GET") return auditList(c, new URL(c.req.url).searchParams.get("workspace"));
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
    await odb.prepare("SELECT name, code, colour, time_zone, work_days, work_start, work_end, contact_email, logo IS NOT NULL AS has_logo, updated_at FROM organizations WHERE id = ?").bind(orgId).first()
  );
  if (!r) throw new HttpError(404, "Not found");
  return {
    name: r.name,
    code: r.code,
    colour: r.colour,
    timeZone: r.time_zone,
    workDays: String(r.work_days).split(",").map(Number),
    workStart: r.work_start,
    workEnd: r.work_end,
    contactEmail: r.contact_email,
    logo: r.has_logo ? `/api/org/logo?v=${encodeURIComponent(String(r.updated_at))}` : null,
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
    throw new HttpError(400, `${tz} isn't a time zone Pulse knows`);
  }
  return tz;
}

/** @param {OrgContext} c */
async function saveProfile(c) {
  const b = /** @type {Record<string, unknown>} */ (await body(c.req));
  const before = await profile(c.odb, c.scope.orgId);
  const colour = b.colour === null || b.colour === "" ? null : String(b.colour ?? before.colour ?? "").toLowerCase();
  if (colour !== null && !/^#[0-9a-f]{6}$/.test(colour)) throw new HttpError(400, "A colour is # and six hex digits, such as #1f6feb");
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
  // The logo: a PNG, JPEG or WebP data: URL (never SVG, which can carry script), or null to remove it.
  /** @type {string | null | undefined} */ let logo;
  if (b.logo === null) logo = null;
  else if (b.logo !== undefined) {
    logo = String(b.logo);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new HttpError(400, "The logo must be a PNG, JPEG or WebP image");
    if (logo.length > LOGO_MAX_BYTES) throw new HttpError(400, "The logo must be under 100 KB");
  }
  const now = new Date().toISOString();
  const after = { colour, timeZone, workDays: days, workStart, workEnd, contactEmail };
  const diff = changed(
    { colour: before.colour, timeZone: before.timeZone, workDays: before.workDays, workStart: before.workStart, workEnd: before.workEnd, contactEmail: before.contactEmail },
    after,
  );
  const logoChange = logo === undefined ? null : logo === null ? (before.logo ? "removed" : null) : "replaced";
  if (!diff && !logoChange) return json({ profile: before });
  await c.odb.batch([
    c.odb
      .prepare(
        `UPDATE organizations SET colour = ?, time_zone = ?, work_days = ?, work_start = ?, work_end = ?, contact_email = ?,
         logo = CASE WHEN ? THEN ? ELSE logo END, updated_at = ? WHERE id = ?`,
      )
      .bind(colour, timeZone, days.join(","), workStart, workEnd, contactEmail, logo !== undefined, logo ?? null, now, c.scope.orgId),
    auditEntry(c.odb, c.req, c.me, {
      action: "organization_profile_updated",
      type: "organization",
      id: c.scope.orgId,
      // The image itself isn't copied into the log; only that it changed.
      before: { ...(diff?.before ?? {}), ...(logoChange ? { logo: before.logo ? "set" : "none" } : {}) },
      after: { ...(diff?.after ?? {}), ...(logoChange ? { logo: logoChange } : {}) },
    }),
  ]);
  return json({ profile: await profile(c.odb, c.scope.orgId) });
}

/** The organisation's logo, for anyone signed in to it. @param {OrgContext} c */
async function logo(c) {
  const r = /** @type {{ logo: string | null } | null} */ (await c.odb.prepare("SELECT logo FROM organizations WHERE id = ?").bind(c.scope.orgId).first());
  const m = r?.logo?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) throw new HttpError(404, "No logo");
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  // Private: only this organisation's people may see it. The address changes with each new logo (?v=).
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "private, max-age=604800", "x-content-type-options": "nosniff" } });
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
 * A role by its key or by the name Pulse shows. "Viewer" is the read-only role; "Standard user" is `viewer`.
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
      `You're invited to ${org.name} on Pulse`,
      [
        `Hi ${p.name}, ${c.me.name} has invited you to ${org.name}'s Pulse.`,
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

// ---------- copying a workspace's configuration ----------

/**
 * Copies a workspace's configuration into another of the same organisation, with no work data: the workflow it
 * uses, its custom fields and their options, its automation rules (switched off, to be checked before use) and its
 * workload limits. Both workspaces must already be known to belong to `orgId` (checked by the caller with the
 * organisation's handle); this runs as the owner because it writes across two workspaces.
 * @param {Env} env
 * @param {string} orgId
 * @param {string} from
 * @param {string} to
 */
export async function cloneWorkspaceConfig(env, orgId, from, to) {
  const root = env.ROOT;
  const now = new Date().toISOString();
  const target = /** @type {{ name: string }} */ (await root.prepare("SELECT name FROM workspaces WHERE organization_id = ? AND id = ?").bind(orgId, to).first());
  /** @type {D1PreparedStatement[]} */ const writes = [];
  const wf = /** @type {{ workflow_id: string } | null} */ (await root.prepare("SELECT workflow_id FROM workspace_workflows WHERE organization_id = ? AND workspace_id = ?").bind(orgId, from).first());
  if (wf) {
    writes.push(
      root
        .prepare("INSERT INTO workspace_workflows (organization_id, workspace_id, workspace, workflow_id) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id) DO UPDATE SET workflow_id = excluded.workflow_id")
        .bind(orgId, to, target.name, wf.workflow_id),
    );
  }
  const fields = /** @type {Record<string, unknown>[]} */ ((await root.prepare("SELECT * FROM custom_fields WHERE organization_id = ? AND workspace_id = ? ORDER BY position").bind(orgId, from).all()).results);
  const options = /** @type {Record<string, unknown>[]} */ ((await root.prepare("SELECT * FROM custom_field_options WHERE organization_id = ? AND workspace_id = ? ORDER BY position").bind(orgId, from).all()).results);
  for (const f of fields) {
    const id = newToken().slice(0, 12);
    writes.push(
      root
        .prepare(
          "INSERT INTO custom_fields (id, organization_id, workspace_id, workspace, name, kind, description, required, on_create, on_edit, on_view, on_board, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, orgId, to, target.name, f.name, f.kind, f.description, f.required, f.on_create, f.on_edit, f.on_view, f.on_board, f.position, now, now),
    );
    for (const o of options.filter((x) => x.field_id === f.id)) {
      writes.push(root.prepare("INSERT INTO custom_field_options (id, organization_id, workspace_id, field_id, label, position) VALUES (?, ?, ?, ?, ?, ?)").bind(newToken().slice(0, 12), orgId, to, id, o.label, o.position));
    }
  }
  const rules = /** @type {Record<string, unknown>[]} */ ((await root.prepare("SELECT * FROM automation_rules WHERE organization_id = ? AND workspace_id = ? AND scope = 'workspace'").bind(orgId, from).all()).results);
  const actions = /** @type {Record<string, unknown>[]} */ ((await root.prepare("SELECT * FROM automation_actions WHERE organization_id = ? AND workspace_id = ? ORDER BY position").bind(orgId, from).all()).results);
  for (const r of rules) {
    const id = newToken().slice(0, 12);
    writes.push(
      root
        .prepare(
          `INSERT INTO automation_rules (id, organization_id, workspace_id, name, description, enabled, scope, scope_value, trigger, trigger_value, schedule_weekday, schedule_hour, condition_pql, max_per_minute, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 'workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, orgId, to, r.name, r.description, target.name, r.trigger, r.trigger_value, r.schedule_weekday, r.schedule_hour, r.condition_pql, r.max_per_minute, r.created_by, now, now),
    );
    for (const a of actions.filter((x) => x.rule_id === r.id)) {
      writes.push(
        root
          .prepare("INSERT INTO automation_actions (id, organization_id, workspace_id, rule_id, position, kind, field, value, value2) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(newToken().slice(0, 12), orgId, to, id, a.position, a.kind, a.field, a.value, a.value2),
      );
    }
  }
  const limits = /** @type {{ value: string } | null} */ (await root.prepare("SELECT value FROM workspace_settings WHERE organization_id = ? AND workspace_id = ? AND key = 'workload_limits'").bind(orgId, from).first());
  if (limits) {
    writes.push(
      root
        .prepare("INSERT INTO workspace_settings (organization_id, workspace_id, key, value) VALUES (?, ?, 'workload_limits', ?) ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value")
        .bind(orgId, to, limits.value),
    );
  }
  if (writes.length) await root.batch(writes);
  return { workflow: !!wf, fields: fields.length, rules: rules.length };
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
