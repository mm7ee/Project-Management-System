// OmniTrack Worker: serves the built app (ASSETS) and the JSON API under /api.
// Every permission check happens here; the UI only hides what a user can't do.

import { hashPassword, newToken, tempPassword, tokenHash, verifyPassword } from "./auth";
import { STATUS_META, initials, type Status, type System } from "../src/data/systems";
import {
  FEATURE_KINDS,
  FEATURE_STATUSES,
  PRIORITIES,
  type Feature,
  type FeatureKind,
  type FeatureStatus,
  type Priority,
} from "../src/data/features";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  START_KEYS,
  cleanPrefs,
  permissionsFor,
  type Permission,
  type Role,
  type RolePermissions,
  type UpdateRequest,
  type User,
} from "../src/data/roles";

const COOKIE = "omni_session";
const SESSION_DAYS = 7;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

interface UserRow {
  id: string;
  username: string;
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
  role: Role;
  password_hash: string;
  prefs: string;
  must_change_password: number;
}

const toUser = (r: UserRow, projectIds: string[] = []): User => ({
  id: r.id,
  username: r.username,
  name: r.name,
  title: r.title,
  role: r.role,
  ...(r.email ? { email: r.email } : {}),
  ...(r.phone ? { phone: r.phone } : {}),
  ...(projectIds.length ? { projectIds } : {}),
  ...(r.must_change_password ? { mustChangePassword: true } : {}),
});

interface FeatureRow {
  id: string;
  system_id: string;
  title: string;
  description: string;
  kind: FeatureKind;
  client: string;
  status: FeatureStatus;
  priority: Priority;
  assignee: string | null;
  notes: string | null;
  due_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const toFeature = (r: FeatureRow): Feature => ({
  id: r.id,
  systemId: r.system_id,
  title: r.title,
  description: r.description,
  kind: r.kind,
  client: r.client,
  status: r.status,
  priority: r.priority,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.assignee ? { assignee: r.assignee } : {}),
  ...(r.notes ? { notes: r.notes } : {}),
  ...(r.due_at ? { dueAt: r.due_at } : {}),
  ...(r.completed_at ? { completedAt: r.completed_at } : {}),
});

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function cookieToken(req: Request): string | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

function sessionCookie(token: string, req: Request, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---------- data access ----------

async function roleMatrix(db: D1Database): Promise<RolePermissions> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'role_permissions'").first<{ value: string }>();
  return row ? { ...DEFAULT_ROLE_PERMISSIONS, ...JSON.parse(row.value) } : DEFAULT_ROLE_PERMISSIONS;
}

async function currentUser(req: Request, db: D1Database): Promise<UserRow | null> {
  const token = cookieToken(req);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await tokenHash(token), Date.now())
    .first<UserRow>();
}

async function getSystem(db: D1Database, id: string): Promise<System> {
  const row = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(id).first<{ data: string }>();
  if (!row) throw new HttpError(404, "System not found");
  return JSON.parse(row.data);
}

/** The projects a developer is assigned to. */
async function projectsOf(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db.prepare("SELECT system_id FROM assignments WHERE user_id = ?").bind(userId).all<{ system_id: string }>();
  return rows.results.map((r) => r.system_id);
}

async function adminCount(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>())!.n;
}

// ---------- validation ----------

const STATUSES = Object.keys(STATUS_META) as Status[];

function checkStatus(s: unknown): Status {
  if (!STATUSES.includes(s as Status)) throw new HttpError(400, "Unknown status");
  return s as Status;
}

function checkProgress(p: unknown): number {
  const n = Number(p);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, "Progress must be 0–100");
  return Math.round(n);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new HttpError(400, `Unknown ${field}`);
  return v as T;
}

/** An optional YYYY-MM-DD date; empty clears it. */
function checkDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${field} must be a date`);
  }
  return v;
}

function checkRole(r: unknown): Role {
  if (!ROLES.includes(r as Role)) throw new HttpError(400, "Unknown role");
  return r as Role;
}

function checkPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  return p;
}

const text = (v: unknown, field: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  return v.trim().slice(0, 500);
};

// ---------- audit trail ----------

const AUDIT_DAYS = 365;

/** Appends one entry to the activity log. Never fails the request it describes. */
async function audit(
  db: D1Database,
  req: Request,
  who: { id: string | null; name: string },
  action: string,
  target: string | null = null,
  detail: Record<string, unknown> = {},
) {
  try {
    await db
      .prepare("INSERT INTO activity (at, user_id, actor, action, target, detail, ip, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        new Date().toISOString(),
        who.id,
        who.name.slice(0, 64),
        action,
        target,
        JSON.stringify(detail),
        req.headers.get("cf-connecting-ip"),
        (req.headers.get("user-agent") ?? "").slice(0, 300),
      )
      .run();
  } catch (e) {
    console.error("audit write failed", e);
  }
}

const ACTIVITY_KINDS: Record<string, string[]> = {
  signin: ["login", "logout", "logout_all"],
  failed: ["login_failed"],
  account: ["password_changed", "password_set_after_reset", "profile_updated"],
  systems: ["system_created", "system_progress", "system_updated", "system_developers", "system_deleted", "request_created", "request_dismissed"],
  features: ["feature_created", "feature_updated", "feature_deleted"],
  admin: ["user_created", "user_updated", "user_password_reset", "user_deleted", "roles_updated"],
};

// ---------- the API ----------

async function api(req: Request, env: Env, path: string): Promise<Response> {
  const db = env.DB;
  const method = req.method;

  if (path === "/api/login" && method === "POST") {
    const { username, password } = await body<{ username?: string; password?: string }>(req);
    const row = await db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .bind(String(username ?? "").trim())
      .first<UserRow>();
    // Same error either way, so usernames can't be probed.
    if (!row || !(await verifyPassword(String(password ?? ""), row.password_hash))) {
      const tried = String(username ?? "").trim().slice(0, 64);
      await audit(db, req, { id: row?.id ?? null, name: row?.name ?? (tried || "(blank)") }, "login_failed", null, { username: tried });
      throw new HttpError(401, "Wrong username or password");
    }
    const token = newToken();
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await tokenHash(token), row.id, Date.now() + SESSION_DAYS * 86_400_000)
      .run();
    await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
    await audit(db, req, row, "login", null, row.must_change_password ? { temporaryPassword: true } : {});
    await db.prepare("DELETE FROM activity WHERE at < ?").bind(new Date(Date.now() - AUDIT_DAYS * 86_400_000).toISOString()).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, req, SESSION_DAYS * 86_400) });
  }

  if (path === "/api/logout" && method === "POST") {
    const token = cookieToken(req);
    if (token) {
      const hash = await tokenHash(token);
      const who = await db
        .prepare("SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
        .bind(hash)
        .first<{ id: string; name: string }>();
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
      if (who) await audit(db, req, who, "logout");
    }
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", req, 0) });
  }

  // Everything below needs a signed-in user.
  const me = await currentUser(req, db);
  if (!me) throw new HttpError(401, "Not signed in");

  // After an admin reset, the only things a user may do are choose a new password or sign out.
  if (me.must_change_password && !["/api/me/password", "/api/logout", "/api/logout-all"].includes(path)) {
    throw new HttpError(403, `Hi ${me.name}, you signed in with a temporary password`, "password_change_required");
  }
  const matrix = await roleMatrix(db);
  const perms = permissionsFor(me.role, matrix);
  const can = (p: Permission) => perms.includes(p);
  const need = (p: Permission) => {
    if (!can(p)) throw new HttpError(403, "You don't have permission to do that");
  };
  const now = new Date().toISOString();

  if (path === "/api/data" && method === "GET") {
    const [systems, users, requests, assigned, features] = await Promise.all([
      db.prepare("SELECT data FROM systems ORDER BY sort, rowid").all<{ data: string }>(),
      db.prepare("SELECT * FROM users ORDER BY name").all<UserRow>(),
      db.prepare("SELECT * FROM requests ORDER BY created_at DESC").all<Record<string, string>>(),
      db
        .prepare("SELECT a.user_id, a.system_id FROM assignments a JOIN systems s ON s.id = a.system_id ORDER BY s.sort, s.rowid")
        .all<{ user_id: string; system_id: string }>(),
      db.prepare("SELECT * FROM features ORDER BY created_at DESC").all<FeatureRow>(),
    ]);
    const projectsByUser = new Map<string, string[]>();
    for (const a of assigned.results) projectsByUser.set(a.user_id, [...(projectsByUser.get(a.user_id) ?? []), a.system_id]);
    return json({
      me: toUser(me, projectsByUser.get(me.id)),
      prefs: cleanPrefs(JSON.parse(me.prefs || "{}"), START_KEYS),
      permissions: perms,
      roleMatrix: matrix,
      systems: systems.results.map((r) => JSON.parse(r.data)),
      users: await (async () => {
        const list = users.results.map((u) => toUser(u, projectsByUser.get(u.id)));
        if (!can("audit_log")) return list;
        const last = await db
          .prepare("SELECT user_id, MAX(at) AS at FROM activity WHERE action = 'login' GROUP BY user_id")
          .all<{ user_id: string; at: string }>();
        const byUser = new Map(last.results.map((r) => [r.user_id, r.at]));
        return list.map((u) => (byUser.has(u.id) ? { ...u, lastLogin: byUser.get(u.id) } : u));
      })(),
      requests: requests.results.map(
        (r): UpdateRequest => ({
          id: r.id,
          systemId: r.system_id,
          requestedBy: r.requested_by,
          message: r.message,
          createdAt: r.created_at,
        }),
      ),
      features: features.results.map(toFeature),
    });
  }

  if (path === "/api/me/password" && method === "POST") {
    const { current, next } = await body<{ current?: string; next?: string }>(req);
    // A forced change follows a sign-in with the temporary password, so it needs no "current".
    if (!me.must_change_password && !(await verifyPassword(String(current ?? ""), me.password_hash))) {
      throw new HttpError(400, "Current password is wrong");
    }
    const fresh = checkPassword(next);
    if (await verifyPassword(fresh, me.password_hash)) throw new HttpError(400, "Choose a password different from the current one");
    await db
      .prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
      .bind(await hashPassword(fresh), me.id)
      .run();
    await audit(db, req, me, me.must_change_password ? "password_set_after_reset" : "password_changed");
    return json({ ok: true });
  }

  if (path === "/api/me/prefs" && method === "PUT") {
    const prefs = cleanPrefs(await body<unknown>(req), START_KEYS);
    await db.prepare("UPDATE users SET prefs = ? WHERE id = ?").bind(JSON.stringify(prefs), me.id).run();
    return json(prefs);
  }

  // Everyone may keep their own contact details current (they feed the lead contact buttons).
  if (path === "/api/me" && method === "PATCH") {
    const b = await body<{ email?: string; phone?: string }>(req);
    const email = b.email !== undefined ? text(b.email, "Email") ?? null : me.email;
    const phone = b.phone !== undefined ? text(b.phone, "Phone") ?? null : me.phone;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right");
    if (phone && !/^\+?[\d\s()-]{7,20}$/.test(phone)) throw new HttpError(400, "Phone: digits, spaces and an optional leading +");
    await db.prepare("UPDATE users SET email = ?, phone = ? WHERE id = ?").bind(email, phone, me.id).run();
    const fields = [email !== me.email && "email", phone !== me.phone && "phone"].filter(Boolean);
    if (fields.length) await audit(db, req, me, "profile_updated", me.id, { fields });
    return json({ ok: true });
  }

  if (path === "/api/logout-all" && method === "POST") {
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.id).run();
    await audit(db, req, me, "logout_all");
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", req, 0) });
  }

  // ----- systems -----
  // A developer can work on several projects (the assignments table). Setting a project's
  // developers assigns the listed ones to it and unassigns the rest; their other projects stay.
  const checkDevelopers = async (list: unknown) => {
    if (!Array.isArray(list)) throw new HttpError(400, "Developers must be a list");
    const ids = [...new Set(list.map(String))];
    const devs = await db.prepare("SELECT id, name FROM users WHERE role = 'developer'").all<{ id: string; name: string }>();
    const byId = new Map(devs.results.map((d) => [d.id, d]));
    for (const id of ids) if (!byId.has(id)) throw new HttpError(400, "Only users with the developer role can be assigned");
    return { ids, byId };
  };
  const setDevelopers = async (systemId: string, list: unknown) => {
    const { ids, byId } = await checkDevelopers(list);
    const rows = await db.prepare("SELECT user_id FROM assignments WHERE system_id = ?").bind(systemId).all<{ user_id: string }>();
    const before = rows.results.map((r) => r.user_id);
    const added = ids.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !ids.includes(id));
    const stmts = [
      ...added.map((id) => db.prepare("INSERT OR IGNORE INTO assignments (user_id, system_id) VALUES (?, ?)").bind(id, systemId)),
      ...removed.map((id) => db.prepare("DELETE FROM assignments WHERE user_id = ? AND system_id = ?").bind(id, systemId)),
    ];
    if (stmts.length) await db.batch(stmts);
    return {
      added: added.map((id) => ({ name: byId.get(id)!.name })),
      removed: removed.map((id) => byId.get(id)?.name ?? id),
    };
  };

  if (path === "/api/systems" && method === "POST") {
    need("manage_systems");
    const b = await body<Partial<System> & { developers?: string[] }>(req);
    const name = text(b.name, "Name", true)!;
    let id = slug(name);
    for (let n = 2; await db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(id).first(); n++) id = `${slug(name)}-${n}`;
    const status = checkStatus(b.status ?? "WIP");
    // Validate before inserting, so a bad list doesn't leave a half-created system behind.
    if (b.developers !== undefined) await checkDevelopers(b.developers);
    const system: System = {
      id,
      name,
      short: initials(name),
      description: text(b.description, "Description") ?? "",
      url: text(b.url, "URL") ?? "",
      status,
      owner: "Systems Team",
      engagement: 0,
      progress: checkProgress(b.progress ?? 0),
      startedAt: text(b.startedAt, "Start date", true)!,
      ...(b.finishedAt ? { finishedAt: text(b.finishedAt, "Delivered on") } : {}),
      ...(b.dueAt ? { dueAt: text(b.dueAt, "Due date") } : {}),
      ...(b.health ? { health: b.health === "Maintenance" ? "Maintenance" : "Stable" } : {}),
      ...(b.lead ? { lead: text(b.lead, "Lead") } : {}),
      updatedAt: now,
      updatedBy: initials(me.name),
    };
    const sort = (await db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM systems").first<{ s: number }>())!.s;
    await db.prepare("INSERT INTO systems (id, sort, data) VALUES (?, ?, ?)").bind(id, sort, JSON.stringify(system)).run();
    await audit(db, req, me, "system_created", id, { name, status, progress: system.progress });
    if (b.developers?.length) await audit(db, req, me, "system_developers", id, { name, ...(await setDevelopers(id, b.developers)) });
    return json(system, 201);
  }

  const sysMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)$/);
  if (sysMatch && method === "PATCH") {
    const id = sysMatch[1];
    const current = await getSystem(db, id);
    const b = await body<Partial<System> & { developers?: string[] }>(req);
    const next: System = { ...current };

    // Progress, status and maintenance are "progress updates": the assigned developer may post them.
    const touchesProgress =
      b.progress !== undefined || b.status !== undefined || b.health !== undefined || b.maintenanceNote !== undefined;
    if (touchesProgress) {
      const allowed = can("edit_any") || can("manage_systems") || (can("edit_assigned") && (await projectsOf(db, me.id)).includes(id));
      if (!allowed) throw new HttpError(403, "You can only update projects you're assigned to");
      if (b.progress !== undefined) next.progress = checkProgress(b.progress);
      if (b.status !== undefined) next.status = checkStatus(b.status);
      if (b.health !== undefined) {
        const health = b.health === "Maintenance" ? "Maintenance" : "Stable";
        if (health === "Maintenance" && current.health !== "Maintenance") next.maintenanceSince = now;
        next.health = health;
      }
      if (b.maintenanceNote !== undefined) next.maintenanceNote = text(b.maintenanceNote, "Maintenance note");
      if (next.health !== "Maintenance") {
        delete next.maintenanceNote;
        delete next.maintenanceSince;
      }
      if (next.progress === 100 && (next.status === "LIVE" || next.status === "COMPLETED") && !next.finishedAt) {
        next.finishedAt = now;
      }
      next.updatedAt = now;
      next.updatedBy = initials(me.name);
    }

    const detailFields = ["name", "description", "url", "lead", "dueAt", "startedAt"] as const;
    if (detailFields.some((f) => b[f] !== undefined)) {
      need("manage_systems");
      if (b.name !== undefined) next.name = text(b.name, "Name", true)!;
      if (b.description !== undefined) next.description = text(b.description, "Description") ?? "";
      if (b.url !== undefined) next.url = text(b.url, "URL") ?? "";
      if (b.startedAt !== undefined) next.startedAt = text(b.startedAt, "Start date", true)!;
      if (b.dueAt !== undefined) next.dueAt = text(b.dueAt, "Due date");
      if (b.lead !== undefined) {
        const lead = text(b.lead, "Lead");
        if (lead && !(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(lead).first())) throw new HttpError(400, "Unknown lead");
        next.lead = lead;
      }
    }

    if (b.developers !== undefined) {
      need("manage_systems");
      const result = await setDevelopers(id, b.developers);
      if (result.added.length || result.removed.length) await audit(db, req, me, "system_developers", id, { name: next.name, ...result });
    }

    const stmts = [db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(next), id)];
    // Posting progress answers any open update requests for this project.
    if (touchesProgress) stmts.push(db.prepare("DELETE FROM requests WHERE system_id = ?").bind(id));
    await db.batch(stmts);
    if (touchesProgress) {
      const snap = (s: System) => ({ progress: s.progress, status: s.status, health: s.health ?? null });
      await audit(db, req, me, "system_progress", id, {
        name: next.name,
        from: snap(current),
        to: snap(next),
        ...(next.maintenanceNote && next.maintenanceNote !== current.maintenanceNote ? { note: next.maintenanceNote } : {}),
      });
    }
    const changed = detailFields.filter((f) => b[f] !== undefined && b[f] !== current[f]);
    if (changed.length) {
      await audit(db, req, me, "system_updated", id, {
        name: next.name,
        fields: changed,
        ...(changed.includes("lead") ? { lead: { from: current.lead ?? null, to: next.lead ?? null } } : {}),
      });
    }
    return json(next);
  }

  if (sysMatch && method === "DELETE") {
    need("manage_systems");
    const id = sysMatch[1];
    const gone = await getSystem(db, id);
    await db.batch([
      db.prepare("DELETE FROM systems WHERE id = ?").bind(id),
      db.prepare("DELETE FROM requests WHERE system_id = ?").bind(id),
      db.prepare("DELETE FROM assignments WHERE system_id = ?").bind(id),
      db.prepare("DELETE FROM features WHERE system_id = ?").bind(id),
    ]);
    await audit(db, req, me, "system_deleted", id, { name: gone.name });
    return json({ ok: true });
  }

  // ----- update requests -----
  if (path === "/api/requests" && method === "POST") {
    need("request_updates");
    const b = await body<{ systemId?: string; message?: string }>(req);
    const system = await getSystem(db, String(b.systemId ?? ""));
    const id = newToken().slice(0, 16);
    await db
      .prepare("INSERT INTO requests (id, system_id, requested_by, message, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, system.id, me.id, text(b.message, "Message") ?? "", now)
      .run();
    await audit(db, req, me, "request_created", system.id, { name: system.name, message: text(b.message, "Message") ?? "" });
    return json({ ok: true }, 201);
  }

  const reqMatch = path.match(/^\/api\/requests\/([a-f0-9]+)$/);
  if (reqMatch && method === "DELETE") {
    const r = await db.prepare("SELECT * FROM requests WHERE id = ?").bind(reqMatch[1]).first<Record<string, string>>();
    if (!r) throw new HttpError(404, "Request not found");
    const mayDismiss = r.requested_by === me.id || can("manage_systems") || (await projectsOf(db, me.id)).includes(r.system_id);
    if (!mayDismiss) throw new HttpError(403, "You can't dismiss this request");
    await db.prepare("DELETE FROM requests WHERE id = ?").bind(r.id).run();
    const sys = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(r.system_id).first<{ data: string }>();
    await audit(db, req, me, "request_dismissed", r.system_id, { name: sys ? JSON.parse(sys.data).name : r.system_id });
    return json({ ok: true });
  }

  // ----- feature requests -----
  // Anyone with manage_features logs, edits and assigns them; the assigned developer keeps
  // the status and their notes current.
  const checkAssignee = async (v: unknown): Promise<string | null> => {
    const id = text(v, "Developer");
    if (!id) return null;
    if (!(await db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'developer'").bind(id).first())) {
      throw new HttpError(400, "Only users with the developer role can be assigned");
    }
    return id;
  };

  if (path === "/api/features" && method === "POST") {
    need("manage_features");
    const b = await body<Partial<Feature>>(req);
    const system = await getSystem(db, String(b.systemId ?? ""));
    const status = oneOf(b.status ?? "NOT_STARTED", FEATURE_STATUSES, "status");
    const f: FeatureRow = {
      id: newToken().slice(0, 16),
      system_id: system.id,
      title: text(b.title, "Feature", true)!,
      description: text(b.description, "Description") ?? "",
      kind: oneOf(b.kind ?? "CHANGE", FEATURE_KINDS, "request type"),
      client: text(b.client, "Requested by") ?? "",
      status,
      priority: oneOf(b.priority ?? "MEDIUM", PRIORITIES, "priority"),
      assignee: await checkAssignee(b.assignee),
      notes: text(b.notes, "Notes") ?? null,
      due_at: checkDate(b.dueAt, "Expected delivery"),
      created_by: me.id,
      created_at: now,
      updated_at: now,
      completed_at: status === "COMPLETED" ? now : null,
    };
    await db
      .prepare(
        `INSERT INTO features (id, system_id, title, description, kind, client, status, priority, assignee, notes, due_at, created_by, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(f.id, f.system_id, f.title, f.description, f.kind, f.client, f.status, f.priority, f.assignee, f.notes, f.due_at, f.created_by, f.created_at, f.updated_at, f.completed_at)
      .run();
    await audit(db, req, me, "feature_created", system.id, {
      name: system.name,
      title: f.title,
      priority: f.priority,
      ...(f.client ? { client: f.client } : {}),
      ...(f.assignee ? { assignee: f.assignee } : {}),
    });
    return json(toFeature(f), 201);
  }

  const featMatch = path.match(/^\/api\/features\/([a-f0-9]+)$/);
  if (featMatch && method === "PATCH") {
    const row = await db.prepare("SELECT * FROM features WHERE id = ?").bind(featMatch[1]).first<FeatureRow>();
    if (!row) throw new HttpError(404, "Feature request not found");
    const b = await body<Partial<Feature>>(req);
    const manager = can("manage_features");
    const developerFields = ["status", "notes"] as const;
    const otherFields = ["title", "description", "kind", "client", "priority", "assignee", "dueAt", "systemId"] as const;
    if (!manager) {
      if (row.assignee !== me.id) throw new HttpError(403, "Only the assigned developer or a manager can update this request");
      if (otherFields.some((k) => b[k] !== undefined)) throw new HttpError(403, "You can update the status and your notes only");
    }
    const next: FeatureRow = { ...row };
    if (b.status !== undefined) next.status = oneOf(b.status, FEATURE_STATUSES, "status");
    if (b.notes !== undefined) next.notes = text(b.notes, "Notes") ?? null;
    if (b.title !== undefined) next.title = text(b.title, "Feature", true)!;
    if (b.description !== undefined) next.description = text(b.description, "Description") ?? "";
    if (b.kind !== undefined) next.kind = oneOf(b.kind, FEATURE_KINDS, "request type");
    if (b.client !== undefined) next.client = text(b.client, "Requested by") ?? "";
    if (b.priority !== undefined) next.priority = oneOf(b.priority, PRIORITIES, "priority");
    if (b.assignee !== undefined) next.assignee = await checkAssignee(b.assignee);
    if (b.dueAt !== undefined) next.due_at = checkDate(b.dueAt, "Expected delivery");
    if (b.systemId !== undefined) next.system_id = (await getSystem(db, String(b.systemId))).id;
    if (next.status === "COMPLETED" && row.status !== "COMPLETED") next.completed_at = now;
    if (next.status !== "COMPLETED") next.completed_at = null;

    const columns: Record<(typeof developerFields)[number] | (typeof otherFields)[number], keyof FeatureRow> = {
      status: "status",
      notes: "notes",
      title: "title",
      description: "description",
      kind: "kind",
      client: "client",
      priority: "priority",
      assignee: "assignee",
      dueAt: "due_at",
      systemId: "system_id",
    };
    const changed = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => next[columns[k]] !== row[columns[k]]);
    if (!changed.length) return json(toFeature(row));
    next.updated_at = now;
    await db
      .prepare(
        `UPDATE features SET system_id = ?, title = ?, description = ?, kind = ?, client = ?, status = ?, priority = ?,
         assignee = ?, notes = ?, due_at = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      )
      .bind(next.system_id, next.title, next.description, next.kind, next.client, next.status, next.priority, next.assignee, next.notes, next.due_at, next.updated_at, next.completed_at, row.id)
      .run();
    const sys = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(next.system_id).first<{ data: string }>();
    await audit(db, req, me, "feature_updated", next.system_id, {
      name: sys ? JSON.parse(sys.data).name : next.system_id,
      title: next.title,
      fields: changed,
      ...(changed.includes("status") ? { status: { from: row.status, to: next.status } } : {}),
      ...(changed.includes("priority") ? { priority: { from: row.priority, to: next.priority } } : {}),
      ...(changed.includes("assignee") ? { assignee: { from: row.assignee, to: next.assignee } } : {}),
    });
    return json(toFeature(next));
  }

  if (featMatch && method === "DELETE") {
    need("manage_features");
    const row = await db.prepare("SELECT * FROM features WHERE id = ?").bind(featMatch[1]).first<FeatureRow>();
    if (!row) throw new HttpError(404, "Feature request not found");
    await db.prepare("DELETE FROM features WHERE id = ?").bind(row.id).run();
    const sys = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(row.system_id).first<{ data: string }>();
    await audit(db, req, me, "feature_deleted", row.system_id, { name: sys ? JSON.parse(sys.data).name : row.system_id, title: row.title });
    return json({ ok: true });
  }

  // ----- users, roles and permissions -----
  const checkProjects = async (list: unknown): Promise<string[]> => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw new HttpError(400, "Projects must be a list");
    const ids = [...new Set(list.map(String))];
    for (const id of ids) await getSystem(db, id);
    return ids;
  };
  if (path === "/api/users" && method === "POST") {
    need("manage_users");
    const b = await body<Partial<User> & { password?: string }>(req);
    const username = text(b.username, "Username", true)!.toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "Username: 3–32 letters, numbers, dots, dashes");
    if (await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) throw new HttpError(409, "That username is taken");
    const role = checkRole(b.role ?? "viewer");
    const projectIds = role === "developer" ? await checkProjects(b.projectIds) : [];
    let id = slug(username);
    for (let n = 2; await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first(); n++) id = `${slug(username)}-${n}`;
    await db
      .prepare(
        `INSERT INTO users (id, username, name, title, email, phone, role, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        username,
        text(b.name, "Name", true),
        text(b.title, "Title") ?? "",
        text(b.email, "Email") ?? null,
        text(b.phone, "Phone") ?? null,
        role,
        await hashPassword(checkPassword(b.password)),
      )
      .run();
    if (projectIds.length) {
      await db.batch(projectIds.map((p) => db.prepare("INSERT INTO assignments (user_id, system_id) VALUES (?, ?)").bind(id, p)));
    }
    await audit(db, req, me, "user_created", id, { name: text(b.name, "Name", true), username, role });
    return json({ ok: true, id }, 201);
  }

  const resetMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)\/reset-password$/);
  if (resetMatch && method === "POST") {
    need("manage_users");
    if (resetMatch[1] === me.id) throw new HttpError(400, "Change your own password in Settings");
    const row = await db.prepare("SELECT id, name FROM users WHERE id = ?").bind(resetMatch[1]).first<{ id: string; name: string }>();
    if (!row) throw new HttpError(404, "User not found");
    const temp = tempPassword();
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").bind(await hashPassword(temp), row.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
    ]);
    await audit(db, req, me, "user_password_reset", row.id, { name: row.name });
    // Shown once to the administrator; only its hash is stored.
    return json({ password: temp });
  }

  const userMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)$/);
  if (userMatch && method === "PATCH") {
    need("manage_users");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userMatch[1]).first<UserRow>();
    if (!row) throw new HttpError(404, "User not found");
    const b = await body<Partial<User> & { password?: string }>(req);
    const role = b.role !== undefined ? checkRole(b.role) : row.role;
    if (row.role === "admin" && role !== "admin" && (await adminCount(db)) <= 1) {
      throw new HttpError(400, "There must always be at least one administrator");
    }
    const before = await projectsOf(db, row.id);
    const projectIds = role !== "developer" ? [] : b.projectIds !== undefined ? await checkProjects(b.projectIds) : before;
    await db
      .prepare(
        `UPDATE users SET name = ?, title = ?, email = ?, phone = ?, role = ?,
         password_hash = COALESCE(?, password_hash), must_change_password = ? WHERE id = ?`,
      )
      .bind(
        b.name !== undefined ? text(b.name, "Name", true) : row.name,
        b.title !== undefined ? text(b.title, "Title") ?? "" : row.title,
        b.email !== undefined ? text(b.email, "Email") ?? null : row.email,
        b.phone !== undefined ? text(b.phone, "Phone") ?? null : row.phone,
        role,
        b.password ? await hashPassword(checkPassword(b.password)) : null,
        // A password an admin sets for someone else is temporary: they choose their own at sign-in.
        b.password && row.id !== me.id ? 1 : row.must_change_password,
        row.id,
      )
      .run();
    const added = projectIds.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !projectIds.includes(p));
    if (added.length || removed.length) {
      await db.batch([
        ...added.map((p) => db.prepare("INSERT OR IGNORE INTO assignments (user_id, system_id) VALUES (?, ?)").bind(row.id, p)),
        ...removed.map((p) => db.prepare("DELETE FROM assignments WHERE user_id = ? AND system_id = ?").bind(row.id, p)),
      ]);
    }
    // Feature requests can only be assigned to developers.
    if (role !== "developer" && row.role === "developer") {
      await db.prepare("UPDATE features SET assignee = NULL WHERE assignee = ?").bind(row.id).run();
    }
    // A password reset signs the user out everywhere.
    if (b.password) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
    const fieldsChanged = (["name", "title", "email", "phone"] as const).filter((f) => {
      const was = row[f] ?? "";
      return b[f] !== undefined && (b[f] ?? "") !== was;
    });
    const changes: Record<string, unknown> = {};
    if (role !== row.role) changes.role = { from: row.role, to: role };
    if (added.length || removed.length) changes.projects = { added, removed };
    if (fieldsChanged.length) changes.fields = fieldsChanged;
    if (b.password) changes.passwordSet = true;
    if (Object.keys(changes).length) await audit(db, req, me, "user_updated", row.id, { name: b.name ?? row.name, ...changes });
    return json({ ok: true });
  }

  if (userMatch && method === "DELETE") {
    need("manage_users");
    if (userMatch[1] === me.id) throw new HttpError(400, "You can't delete your own account");
    const row = await db
      .prepare("SELECT role, name, username FROM users WHERE id = ?")
      .bind(userMatch[1])
      .first<{ role: Role; name: string; username: string }>();
    if (!row) throw new HttpError(404, "User not found");
    if (row.role === "admin" && (await adminCount(db)) <= 1) throw new HttpError(400, "There must always be at least one administrator");
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM requests WHERE requested_by = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM assignments WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("UPDATE features SET assignee = NULL WHERE assignee = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM users WHERE id = ?").bind(userMatch[1]),
    ]);
    await audit(db, req, me, "user_deleted", userMatch[1], { name: row.name, username: row.username, role: row.role });
    return json({ ok: true });
  }

  if (path === "/api/roles" && method === "PUT") {
    need("manage_users");
    const b = await body<Partial<RolePermissions>>(req);
    const valid = new Set(DEFAULT_ROLE_PERMISSIONS.admin);
    const next = { ...matrix };
    for (const role of ROLES) {
      if (role === "admin" || !Array.isArray(b[role])) continue;
      next[role] = b[role]!.filter((p): p is Permission => valid.has(p as Permission));
    }
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('role_permissions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next))
      .run();
    const changes: Record<string, { added: Permission[]; removed: Permission[] }> = {};
    for (const role of ROLES) {
      const added = next[role].filter((p) => !matrix[role].includes(p));
      const removed = matrix[role].filter((p) => !next[role].includes(p));
      if (added.length || removed.length) changes[role] = { added, removed };
    }
    if (Object.keys(changes).length) await audit(db, req, me, "roles_updated", null, { changes });
    return json(next);
  }

  // ----- activity log -----
  if (path === "/api/activity" && method === "GET") {
    need("audit_log");
    const q = new URL(req.url).searchParams;
    const limit = Math.min(500, Math.max(1, Number(q.get("limit")) || 100));
    const where: string[] = [];
    const args: unknown[] = [];
    const before = Number(q.get("before"));
    if (before > 0) {
      where.push("id < ?");
      args.push(before);
    }
    const user = q.get("user");
    if (user) {
      where.push("user_id = ?");
      args.push(user);
    }
    const kind = ACTIVITY_KINDS[q.get("kind") ?? ""];
    if (kind) {
      where.push(`action IN (${kind.map(() => "?").join(", ")})`);
      args.push(...kind);
    }
    const search = (q.get("q") ?? "").trim().slice(0, 64);
    if (search) {
      where.push("(actor LIKE ? OR detail LIKE ? OR ip LIKE ?)");
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const rows = await db
      .prepare(`SELECT * FROM activity ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
      .bind(...args, limit + 1)
      .all<{ id: number; at: string; user_id: string | null; actor: string; action: string; target: string | null; detail: string; ip: string | null; agent: string | null }>();
    const page = rows.results.slice(0, limit);
    const items = page.map((r) => ({
      id: r.id,
      at: r.at,
      userId: r.user_id,
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: JSON.parse(r.detail || "{}"),
      ip: r.ip,
      agent: r.agent,
    }));
    const next = rows.results.length > limit ? page.at(-1)!.id : null;
    let stats: Record<string, number> | undefined;
    if (!before) {
      const day = new Date(Date.now() - 86_400_000).toISOString();
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const s = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM activity WHERE action = 'login' AND at >= ?) AS signins24h,
             (SELECT COUNT(*) FROM activity WHERE action = 'login_failed' AND at >= ?) AS failed24h,
             (SELECT COUNT(DISTINCT user_id) FROM activity WHERE action = 'login' AND at >= ?) AS active7d,
             (SELECT COUNT(*) FROM activity WHERE action NOT IN ('login', 'logout', 'logout_all', 'login_failed') AND at >= ?) AS changes7d`,
        )
        .bind(day, day, week, week)
        .first<Record<string, number>>();
      stats = s ?? undefined;
    }
    return json({ items, next, ...(stats ? { stats } : {}) });
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, path);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};
