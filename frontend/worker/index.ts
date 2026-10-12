// OmniTrack Worker: serves the built app (ASSETS) and the JSON API under /api.
// Every permission check happens here; the UI only hides what a user can't do.

import { hashPassword, newToken, tempPassword, tokenHash, verifyPassword } from "./auth";
import { STATUS_META, initials, type Status, type System } from "../src/data/systems";
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
  project_id: string | null;
  password_hash: string;
  prefs: string;
  must_change_password: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  name: r.name,
  title: r.title,
  role: r.role,
  ...(r.email ? { email: r.email } : {}),
  ...(r.phone ? { phone: r.phone } : {}),
  ...(r.project_id ? { projectId: r.project_id } : {}),
  ...(r.must_change_password ? { mustChangePassword: true } : {}),
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
      throw new HttpError(401, "Wrong username or password");
    }
    const token = newToken();
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await tokenHash(token), row.id, Date.now() + SESSION_DAYS * 86_400_000)
      .run();
    await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, req, SESSION_DAYS * 86_400) });
  }

  if (path === "/api/logout" && method === "POST") {
    const token = cookieToken(req);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await tokenHash(token)).run();
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
    const [systems, users, requests] = await Promise.all([
      db.prepare("SELECT data FROM systems ORDER BY sort, rowid").all<{ data: string }>(),
      db.prepare("SELECT * FROM users ORDER BY name").all<UserRow>(),
      db.prepare("SELECT * FROM requests ORDER BY created_at DESC").all<Record<string, string>>(),
    ]);
    return json({
      me: toUser(me),
      prefs: cleanPrefs(JSON.parse(me.prefs || "{}"), START_KEYS),
      permissions: perms,
      roleMatrix: matrix,
      systems: systems.results.map((r) => JSON.parse(r.data)),
      users: users.results.map(toUser),
      requests: requests.results.map(
        (r): UpdateRequest => ({
          id: r.id,
          systemId: r.system_id,
          requestedBy: r.requested_by,
          message: r.message,
          createdAt: r.created_at,
        }),
      ),
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
    return json({ ok: true });
  }

  if (path === "/api/logout-all" && method === "POST") {
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.id).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", req, 0) });
  }

  // ----- systems -----
  if (path === "/api/systems" && method === "POST") {
    need("manage_systems");
    const b = await body<Partial<System>>(req);
    const name = text(b.name, "Name", true)!;
    let id = slug(name);
    for (let n = 2; await db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(id).first(); n++) id = `${slug(name)}-${n}`;
    const status = checkStatus(b.status ?? "WIP");
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
    return json(system, 201);
  }

  const sysMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)$/);
  if (sysMatch && method === "PATCH") {
    const id = sysMatch[1];
    const current = await getSystem(db, id);
    const b = await body<Partial<System>>(req);
    const next: System = { ...current };

    // Progress, status and maintenance are "progress updates": the assigned developer may post them.
    const touchesProgress =
      b.progress !== undefined || b.status !== undefined || b.health !== undefined || b.maintenanceNote !== undefined;
    if (touchesProgress) {
      const allowed = can("edit_any") || can("manage_systems") || (can("edit_assigned") && me.project_id === id);
      if (!allowed) throw new HttpError(403, "You can only update the project you're assigned to");
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

    const stmts = [db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(next), id)];
    // Posting progress answers any open update requests for this project.
    if (touchesProgress) stmts.push(db.prepare("DELETE FROM requests WHERE system_id = ?").bind(id));
    await db.batch(stmts);
    return json(next);
  }

  if (sysMatch && method === "DELETE") {
    need("manage_systems");
    const id = sysMatch[1];
    await getSystem(db, id);
    await db.batch([
      db.prepare("DELETE FROM systems WHERE id = ?").bind(id),
      db.prepare("DELETE FROM requests WHERE system_id = ?").bind(id),
      db.prepare("UPDATE users SET project_id = NULL WHERE project_id = ?").bind(id),
    ]);
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
    return json({ ok: true }, 201);
  }

  const reqMatch = path.match(/^\/api\/requests\/([a-f0-9]+)$/);
  if (reqMatch && method === "DELETE") {
    const r = await db.prepare("SELECT * FROM requests WHERE id = ?").bind(reqMatch[1]).first<Record<string, string>>();
    if (!r) throw new HttpError(404, "Request not found");
    const mayDismiss = r.requested_by === me.id || me.project_id === r.system_id || can("manage_systems");
    if (!mayDismiss) throw new HttpError(403, "You can't dismiss this request");
    await db.prepare("DELETE FROM requests WHERE id = ?").bind(r.id).run();
    return json({ ok: true });
  }

  // ----- users, roles and permissions -----
  if (path === "/api/users" && method === "POST") {
    need("manage_users");
    const b = await body<Partial<User> & { password?: string }>(req);
    const username = text(b.username, "Username", true)!.toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "Username: 3–32 letters, numbers, dots, dashes");
    if (await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) throw new HttpError(409, "That username is taken");
    const role = checkRole(b.role ?? "viewer");
    const projectId = role === "developer" ? text(b.projectId, "Project") : undefined;
    if (projectId) await getSystem(db, projectId);
    let id = slug(username);
    for (let n = 2; await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first(); n++) id = `${slug(username)}-${n}`;
    await db
      .prepare(
        `INSERT INTO users (id, username, name, title, email, phone, role, project_id, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        username,
        text(b.name, "Name", true),
        text(b.title, "Title") ?? "",
        text(b.email, "Email") ?? null,
        text(b.phone, "Phone") ?? null,
        role,
        projectId ?? null,
        await hashPassword(checkPassword(b.password)),
      )
      .run();
    return json({ ok: true, id }, 201);
  }

  const resetMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)\/reset-password$/);
  if (resetMatch && method === "POST") {
    need("manage_users");
    if (resetMatch[1] === me.id) throw new HttpError(400, "Change your own password in Settings");
    const row = await db.prepare("SELECT id FROM users WHERE id = ?").bind(resetMatch[1]).first<{ id: string }>();
    if (!row) throw new HttpError(404, "User not found");
    const temp = tempPassword();
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").bind(await hashPassword(temp), row.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
    ]);
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
    let projectId = b.projectId !== undefined ? text(b.projectId, "Project") ?? null : row.project_id;
    if (role !== "developer") projectId = null;
    if (projectId) await getSystem(db, projectId);
    await db
      .prepare(
        `UPDATE users SET name = ?, title = ?, email = ?, phone = ?, role = ?, project_id = ?,
         password_hash = COALESCE(?, password_hash), must_change_password = ? WHERE id = ?`,
      )
      .bind(
        b.name !== undefined ? text(b.name, "Name", true) : row.name,
        b.title !== undefined ? text(b.title, "Title") ?? "" : row.title,
        b.email !== undefined ? text(b.email, "Email") ?? null : row.email,
        b.phone !== undefined ? text(b.phone, "Phone") ?? null : row.phone,
        role,
        projectId,
        b.password ? await hashPassword(checkPassword(b.password)) : null,
        // A password an admin sets for someone else is temporary: they choose their own at sign-in.
        b.password && row.id !== me.id ? 1 : row.must_change_password,
        row.id,
      )
      .run();
    // A password reset signs the user out everywhere.
    if (b.password) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
    return json({ ok: true });
  }

  if (userMatch && method === "DELETE") {
    need("manage_users");
    if (userMatch[1] === me.id) throw new HttpError(400, "You can't delete your own account");
    const row = await db.prepare("SELECT role FROM users WHERE id = ?").bind(userMatch[1]).first<{ role: Role }>();
    if (!row) throw new HttpError(404, "User not found");
    if (row.role === "admin" && (await adminCount(db)) <= 1) throw new HttpError(400, "There must always be at least one administrator");
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM requests WHERE requested_by = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM users WHERE id = ?").bind(userMatch[1]),
    ]);
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
    return json(next);
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
