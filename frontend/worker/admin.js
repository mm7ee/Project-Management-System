/** @import { NotificationScheme } from '../src/data/admin' */
/** @import { ItemContext } from './workitems' */
/** @import { NotificationEvent, SecurityLevel } from '../src/data/admin' */
/** @import { Role } from '../src/data/roles' */
// Administration schemes (Settings → Administration): notification schemes and security levels, which
// need "manage_schemes", and each person's notification opt-outs (Settings → Notifications).
import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { loadSchemes } from "./schemes";
import { levelsFor } from "./access";
import { NOTIFICATION_EVENTS } from "../src/data/admin";
import { ROLES, ROLE_LABEL } from "../src/data/roles";
const EVENTS = NOTIFICATION_EVENTS.map((e) => e.key);
/**
 * @param {D1Database} db
 * @returns {Promise<SecurityLevel[]>}
 */
async function loadLevels(db) {
  const [levels, grants, counts] = await Promise.all([
    /** @type {Promise<D1Result<{ id: string; name: string; description: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, description FROM security_levels ORDER BY position, name").all())),
    /** @type {Promise<D1Result<{ level_id: string; role: string | null; user_id: string | null; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT level_id, role, user_id FROM security_level_grants ORDER BY id").all())),
    /** @type {Promise<D1Result<{ id: string; n: number; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT security_level AS id, COUNT(*) AS n FROM work_items WHERE security_level IS NOT NULL GROUP BY 1").all())),
  ]);
  return levels.results.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    roles: grants.results.filter((g) => g.level_id === l.id && g.role).map((g) => /** @type {Role} */ (g.role)),
    people: grants.results.filter((g) => g.level_id === l.id && g.user_id).map((g) => /** @type {NonNullable<typeof g.user_id>} */ (g.user_id)),
    items: Number(counts.results.find((x) => x.id === l.id)?.n ?? 0),
  }));
}
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function adminApi(c, path, method) {
  if (!path.startsWith("/api/notification-schemes") && !path.startsWith("/api/security-levels") && !path.startsWith("/api/me/notification-optouts")) return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req } = c;
  const need = () => {
    if (!c.can("manage_schemes")) throw new HttpError(403, "You don't have permission to manage schemes");
  };
  // ----- each person's opt-outs -----
  if (path === "/api/me/notification-optouts" && method === "GET") {
    const rows = await /** @type {Promise<D1Result<{ event: NotificationEvent; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT event FROM notification_optouts WHERE user_id = ?").bind(c.me.id).all()));
    return json({ optOuts: rows.results.map((r) => r.event), schemes: await loadSchemes(db) });
  }
  if (path === "/api/me/notification-optouts" && method === "PUT") {
    const list = (await /** @type {Promise<{ optOuts?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).optOuts;
    const events = [...new Set((Array.isArray(list) ? list : []).map(String))].filter(/** @returns {e is NotificationEvent} */ (e) => EVENTS.includes(/** @type {NotificationEvent} */ (e)));
    const before = (await /** @type {Promise<D1Result<{ event: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT event FROM notification_optouts WHERE user_id = ?").bind(c.me.id).all()))).results.map((r) => r.event);
    await db.batch([db.prepare("DELETE FROM notification_optouts WHERE user_id = ?").bind(c.me.id), ...events.map((e) => db.prepare("INSERT INTO notification_optouts (user_id, event) VALUES (?, ?)").bind(c.me.id, e))]);
    const label = /** @param {string} e */ (e) => NOTIFICATION_EVENTS.find((x) => x.key === e)?.label ?? e;
    await c.audit("notification_optouts_updated", null, { from: before.map(label), to: events.map(label) });
    return json({ optOuts: events });
  }
  // ----- notification schemes -----
  if (path === "/api/notification-schemes" && method === "GET") {
    need();
    return json(await loadSchemes(db));
  }
  if (path === "/api/notification-schemes" && method === "PUT") {
    need();
    const list = (await /** @type {Promise<{ schemes?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).schemes;
    if (!Array.isArray(list)) throw new HttpError(400, "Send the schemes");
    const before = await loadSchemes(db);
    /** @type {D1PreparedStatement[]} */ const stmts = [];
    /** @type {Record<string, { from: string; to: string }>} */ const changes = {};
    const describe = /** @param {(typeof before)[number]} s */ (s) =>
      [
        [s.assignee && "assignee", s.reporter && "reporter", s.watchers && "watchers", s.lead && "project lead", s.mentioned && "@mentioned", s.role && `every ${ROLE_LABEL[s.role]}`].filter(Boolean).join(", ") || "nobody",
        [s.bell && "bell", s.email && "email", s.teams && "Teams"].filter(Boolean).join(" + ") || "no channel",
      ].join(" by ");
    for (const raw of list) {
      const s = /** @type {Record<string, unknown>} */ (raw ?? {});
      const event = /** @type {NotificationEvent} */ (String(s.event));
      if (!EVENTS.includes(event)) throw new HttpError(400, "Unknown event");
      const role = s.role ? String(s.role) : null;
      if (role && !ROLES.includes(/** @type {Role} */ (role))) throw new HttpError(400, "Unknown role");
      const next = {
        event,
        assignee: !!s.assignee,
        reporter: !!s.reporter,
        watchers: !!s.watchers,
        lead: !!s.lead,
        mentioned: !!s.mentioned,
        ...(role ? { role: /** @type {Role} */ (role) } : {}),
        bell: !!s.bell,
        email: !!s.email,
        teams: !!s.teams,
      };
      const prev = /** @type {NotificationScheme} */ (before.find((b) => b.event === event));
      if (describe(prev) !== describe(next)) changes[/** @type {{ key: NotificationEvent; label: string; help: string; }} */ (NOTIFICATION_EVENTS.find((e) => e.key === event)).label] = { from: describe(prev), to: describe(next) };
      stmts.push(
        db
          .prepare(
            `INSERT INTO notification_schemes (event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (event) DO UPDATE SET notify_assignee = excluded.notify_assignee, notify_reporter = excluded.notify_reporter, notify_watchers = excluded.notify_watchers,
               notify_lead = excluded.notify_lead, notify_mentioned = excluded.notify_mentioned, notify_role = excluded.notify_role, by_bell = excluded.by_bell,
               by_email = excluded.by_email, by_teams = excluded.by_teams, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          )
          .bind(event, +next.assignee, +next.reporter, +next.watchers, +next.lead, +next.mentioned, role, +next.bell, +next.email, +next.teams, c.me.id, c.now),
      );
    }
    if (stmts.length) await db.batch(stmts);
    if (Object.keys(changes).length) await c.audit("notification_scheme_updated", null, { changes });
    return json(await loadSchemes(db));
  }
  // ----- security levels -----
  if (path === "/api/security-levels" && method === "GET") {
    const all = await loadLevels(db);
    // Everyone sees the levels they may give items (to choose one); managers of schemes see them all.
    if (c.can("manage_schemes")) return json(all);
    const mine = await levelsFor(db, c.viewer);
    return json(all.filter((l) => mine.includes(l.id)).map((l) => ({ ...l, people: [], items: 0 })));
  }
  const readLevel = /** @param {{ name?: unknown; description?: unknown; roles?: unknown; people?: unknown }} b */ async (b) => {
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) throw new HttpError(400, "A security level needs a name");
    const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map(String))].filter(/** @returns {r is Role} */ (r) => ROLES.includes(/** @type {Role} */ (r)) && r !== "admin");
    const people = [...new Set((Array.isArray(b.people) ? b.people : []).map(String))].slice(0, 200);
    if (people.length) {
      const found = await /** @type {Promise<D1Result<{ id: string; }>>} */ (
        /** @type {unknown} */ (
          db
            .prepare(`SELECT id FROM users WHERE id IN (${people.map(() => "?").join(", ")})`)
            .bind(...people)
            .all()
        )
      );
      if (found.results.length !== people.length) throw new HttpError(400, "One of those people isn't in Pulse");
    }
    return {
      name,
      description: String(b.description ?? "")
        .trim()
        .slice(0, 200),
      roles,
      people,
    };
  };
  const grants = /** @param {string} id @param {string[]} roles @param {string[]} people */ (id, roles, people) => [
    db.prepare("DELETE FROM security_level_grants WHERE level_id = ?").bind(id),
    ...roles.map((r) => db.prepare("INSERT INTO security_level_grants (level_id, role) VALUES (?, ?)").bind(id, r)),
    ...people.map((u) => db.prepare("INSERT INTO security_level_grants (level_id, user_id) VALUES (?, ?)").bind(id, u)),
  ];
  const nameOf = /** @param {string[]} ids */ async (ids) => {
    if (!ids.length) return [];
    const rows = await /** @type {Promise<D1Result<{ name: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT name FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY name`)
          .bind(...ids)
          .all()
      )
    );
    return rows.results.map((r) => r.name);
  };
  if (path === "/api/security-levels" && method === "POST") {
    need();
    const l = await readLevel(await body(req));
    if (await db.prepare("SELECT 1 FROM security_levels WHERE lower(name) = lower(?)").bind(l.name).first()) throw new HttpError(409, `There's already a level called ${l.name}`);
    const id = newToken().slice(0, 16);
    await db.batch([db.prepare("INSERT INTO security_levels (id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM security_levels), ?, ?)").bind(id, l.name, l.description, c.now, c.now), ...grants(id, l.roles, l.people)]);
    await c.audit("security_level_created", null, { level: l.name, roles: l.roles.map((r) => ROLE_LABEL[r]), people: await nameOf(l.people) });
    return json(
      (await loadLevels(db)).find((x) => x.id === id),
      201,
    );
  }
  const m = path.match(/^\/api\/security-levels\/([a-z0-9-]{4,40})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    need();
    const before = (await loadLevels(db)).find((x) => x.id === m[1]);
    if (!before) throw new HttpError(404, "Security level not found");
    if (method === "DELETE") {
      if (before.items) throw new HttpError(400, `${before.items} work items use ${before.name}. Give them another level (or none) first.`);
      await db.prepare("DELETE FROM security_levels WHERE id = ?").bind(before.id).run();
      await c.audit("security_level_deleted", null, { level: before.name });
      return json({ ok: true });
    }
    const l = await readLevel(await body(req));
    if (l.name.toLowerCase() !== before.name.toLowerCase() && (await db.prepare("SELECT 1 FROM security_levels WHERE lower(name) = lower(?)").bind(l.name).first())) {
      throw new HttpError(409, `There's already a level called ${l.name}`);
    }
    await db.batch([db.prepare("UPDATE security_levels SET name = ?, description = ?, updated_at = ? WHERE id = ?").bind(l.name, l.description, c.now, before.id), ...grants(before.id, l.roles, l.people)]);
    await c.audit("security_level_updated", null, {
      level: l.name,
      from: { name: before.name, roles: before.roles.map((r) => ROLE_LABEL[r]), people: await nameOf(before.people) },
      to: { name: l.name, roles: l.roles.map((r) => ROLE_LABEL[r]), people: await nameOf(l.people) },
    });
    return json((await loadLevels(db)).find((x) => x.id === before.id));
  }
  throw new HttpError(404, "Not found");
}
