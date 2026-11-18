// Administration schemes (Settings → Administration): notification schemes and security levels, which
// need "manage_schemes", and each person's notification opt-outs (Settings → Notifications).

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { loadSchemes } from "./schemes";
import { levelsFor } from "./access";
import type { ItemContext } from "./workitems";
import { NOTIFICATION_EVENTS, type NotificationEvent, type SecurityLevel } from "../src/data/admin";
import { ROLES, ROLE_LABEL, type Role } from "../src/data/roles";

const EVENTS = NOTIFICATION_EVENTS.map((e) => e.key);

async function loadLevels(db: D1Database): Promise<SecurityLevel[]> {
  const [levels, grants, counts] = await Promise.all([
    db.prepare("SELECT id, name, description FROM security_levels ORDER BY position, name").all<{ id: string; name: string; description: string }>(),
    db.prepare("SELECT level_id, role, user_id FROM security_level_grants ORDER BY id").all<{ level_id: string; role: string | null; user_id: string | null }>(),
    db.prepare("SELECT security_level AS id, COUNT(*) AS n FROM work_items WHERE security_level IS NOT NULL GROUP BY 1").all<{ id: string; n: number }>(),
  ]);
  return levels.results.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    roles: grants.results.filter((g) => g.level_id === l.id && g.role).map((g) => g.role as Role),
    people: grants.results.filter((g) => g.level_id === l.id && g.user_id).map((g) => g.user_id!),
    items: Number(counts.results.find((x) => x.id === l.id)?.n ?? 0),
  }));
}

export async function adminApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/notification-schemes") && !path.startsWith("/api/security-levels") && !path.startsWith("/api/me/notification-optouts")) return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req } = c;
  const need = () => {
    if (!c.can("manage_schemes")) throw new HttpError(403, "You don't have permission to manage schemes");
  };

  // ----- each person's opt-outs -----
  if (path === "/api/me/notification-optouts" && method === "GET") {
    const rows = await db.prepare("SELECT event FROM notification_optouts WHERE user_id = ?").bind(c.me.id).all<{ event: NotificationEvent }>();
    return json({ optOuts: rows.results.map((r) => r.event), schemes: await loadSchemes(db) });
  }
  if (path === "/api/me/notification-optouts" && method === "PUT") {
    const list = (await body<{ optOuts?: unknown }>(req)).optOuts;
    const events = [...new Set((Array.isArray(list) ? list : []).map(String))].filter((e): e is NotificationEvent => EVENTS.includes(e as NotificationEvent));
    const before = (await db.prepare("SELECT event FROM notification_optouts WHERE user_id = ?").bind(c.me.id).all<{ event: string }>()).results.map((r) => r.event);
    await db.batch([
      db.prepare("DELETE FROM notification_optouts WHERE user_id = ?").bind(c.me.id),
      ...events.map((e) => db.prepare("INSERT INTO notification_optouts (user_id, event) VALUES (?, ?)").bind(c.me.id, e)),
    ]);
    const label = (e: string) => NOTIFICATION_EVENTS.find((x) => x.key === e)?.label ?? e;
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
    const list = (await body<{ schemes?: unknown }>(req)).schemes;
    if (!Array.isArray(list)) throw new HttpError(400, "Send the schemes");
    const before = await loadSchemes(db);
    const stmts: D1PreparedStatement[] = [];
    const changes: Record<string, { from: string; to: string }> = {};
    const describe = (s: (typeof before)[number]) =>
      [
        [s.assignee && "assignee", s.reporter && "reporter", s.watchers && "watchers", s.lead && "project lead", s.mentioned && "@mentioned", s.role && `every ${ROLE_LABEL[s.role]}`].filter(Boolean).join(", ") || "nobody",
        [s.bell && "bell", s.email && "email", s.teams && "Teams"].filter(Boolean).join(" + ") || "no channel",
      ].join(" by ");
    for (const raw of list) {
      const s = (raw ?? {}) as Record<string, unknown>;
      const event = String(s.event) as NotificationEvent;
      if (!EVENTS.includes(event)) throw new HttpError(400, "Unknown event");
      const role = s.role ? String(s.role) : null;
      if (role && !ROLES.includes(role as Role)) throw new HttpError(400, "Unknown role");
      const next = {
        event,
        assignee: !!s.assignee,
        reporter: !!s.reporter,
        watchers: !!s.watchers,
        lead: !!s.lead,
        mentioned: !!s.mentioned,
        ...(role ? { role: role as Role } : {}),
        bell: !!s.bell,
        email: !!s.email,
        teams: !!s.teams,
      };
      const prev = before.find((b) => b.event === event)!;
      if (describe(prev) !== describe(next)) changes[NOTIFICATION_EVENTS.find((e) => e.key === event)!.label] = { from: describe(prev), to: describe(next) };
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

  const readLevel = async (b: { name?: unknown; description?: unknown; roles?: unknown; people?: unknown }) => {
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!name) throw new HttpError(400, "A security level needs a name");
    const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map(String))].filter((r): r is Role => ROLES.includes(r as Role) && r !== "admin");
    const people = [...new Set((Array.isArray(b.people) ? b.people : []).map(String))].slice(0, 200);
    if (people.length) {
      const found = await db.prepare(`SELECT id FROM users WHERE id IN (${people.map(() => "?").join(", ")})`).bind(...people).all<{ id: string }>();
      if (found.results.length !== people.length) throw new HttpError(400, "One of those people isn't in Pulse");
    }
    return { name, description: String(b.description ?? "").trim().slice(0, 200), roles, people };
  };
  const grants = (id: string, roles: string[], people: string[]) => [
    db.prepare("DELETE FROM security_level_grants WHERE level_id = ?").bind(id),
    ...roles.map((r) => db.prepare("INSERT INTO security_level_grants (level_id, role) VALUES (?, ?)").bind(id, r)),
    ...people.map((u) => db.prepare("INSERT INTO security_level_grants (level_id, user_id) VALUES (?, ?)").bind(id, u)),
  ];
  const nameOf = async (ids: string[]) => {
    if (!ids.length) return [];
    const rows = await db.prepare(`SELECT name FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY name`).bind(...ids).all<{ name: string }>();
    return rows.results.map((r) => r.name);
  };

  if (path === "/api/security-levels" && method === "POST") {
    need();
    const l = await readLevel(await body(req));
    if (await db.prepare("SELECT 1 FROM security_levels WHERE lower(name) = lower(?)").bind(l.name).first()) throw new HttpError(409, `There's already a level called ${l.name}`);
    const id = newToken().slice(0, 16);
    await db.batch([
      db
        .prepare("INSERT INTO security_levels (id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM security_levels), ?, ?)")
        .bind(id, l.name, l.description, c.now, c.now),
      ...grants(id, l.roles, l.people),
    ]);
    await c.audit("security_level_created", null, { level: l.name, roles: l.roles.map((r) => ROLE_LABEL[r]), people: await nameOf(l.people) });
    return json((await loadLevels(db)).find((x) => x.id === id), 201);
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
