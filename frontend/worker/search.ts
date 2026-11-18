// Search (PQL), saved filters with favourites and email subscriptions, dashboards whose gadgets read
// saved filters, and turning a plain-English question into PQL. Every query runs as the person
// asking (or subscribed, or viewing the dashboard), under their visibility rules.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { compile, loadLookup } from "./pql";
import { raise, type Alert } from "./notify";
import { SELECT, keyOf, toSummary, type ItemContext, type ItemRow } from "./workitems";
import { ASK_MODEL } from "./ask";
import { FIELDS, FUNCTIONS, PqlError, customFieldDefs, parse } from "../src/data/pql";
import { customFieldsByName, customValuesFor } from "./customfields";
import { ROLES, type Role } from "../src/data/roles";
import { itemAccess, roleMatrix, viewerOfUser, type Viewer } from "./access";
import { GADGETS, shareLabel, type Dashboard, type Gadget, type GadgetKind, type SavedFilter, type ShareScope } from "../src/data/search";
import { TYPE_META, WORK_PRIORITY_META } from "../src/data/workitems";
import { daysLeft } from "../src/data/sprints";

const SCOPES: ShareScope[] = ["private", "role", "workspace", "everyone"];
const MAX_PAGE = 100;

export type { Viewer };

/** A PQL query as SQL under this person's visibility: the WHERE clause, its parameters and the ORDER BY. */
export async function filterSql(db: D1Database, pql: string, viewer: Viewer, now: number) {
  // Custom fields are fields too: "Customer tier" = Gold.
  const q = parse(pql, customFieldDefs([...(await customFieldsByName(db)).values()]));
  const compiled = compile(q, await loadLookup(db, q, viewer.id, now));
  const vis = itemAccess(viewer);
  return { where: `(${compiled.where}) AND ${vis.sql}`, params: [...compiled.params, ...vis.args], orderBy: compiled.orderBy };
}

/** A page of results. */
export async function runQuery(db: D1Database, pql: string, viewer: Viewer, now: number, limit = 50, offset = 0) {
  const f = await filterSql(db, pql, viewer, now);
  const rows = await db
    .prepare(`${SELECT.replace("SELECT w.*,", "SELECT COUNT(*) OVER () AS total_count, w.*,")} WHERE ${f.where} ORDER BY ${f.orderBy} LIMIT ? OFFSET ?`)
    .bind(...f.params, limit, offset)
    .all<ItemRow & { total_count: number }>();
  let total = rows.results[0]?.total_count;
  if (total === undefined) {
    total = offset
      ? Number(
          (await db.prepare(`SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id WHERE ${f.where}`).bind(...f.params).first<{ n: number }>())?.n ?? 0,
        )
      : 0;
  }
  return { rows: rows.results, total: Number(total), offset };
}

/** PQL problems as a 400 the Search page can point at. */
function pqlError(e: unknown): never {
  if (e instanceof PqlError) throw new HttpError(400, e.message, "pql", { start: e.start, end: e.end });
  throw e;
}

export async function viewerFor(db: D1Database, userId: string): Promise<Viewer | null> {
  const u = await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(userId).first<{ id: string; role: Role }>();
  return u ? viewerOfUser(u, await roleMatrix(db)) : null;
}

/**
 * The SQL that limits saved filters or dashboards (alias x) to those this person may see: their own,
 * everyone's, their role's, or a workspace's they work in (or any workspace's, with "Share filters").
 */
async function shareVisibility(c: ItemContext): Promise<{ sql: string; args: unknown[] }> {
  const mine = await c.db
    .prepare(
      `SELECT DISTINCT (s.data::json ->> 'workspace') AS w FROM systems s
       WHERE (s.data::json ->> 'lead') = ? OR EXISTS (SELECT 1 FROM assignments a WHERE a.system_id = s.id AND a.user_id = ?)`,
    )
    .bind(c.me.id, c.me.id)
    .all<{ w: string | null }>();
  const workspaces = mine.results.map((r) => r.w).filter((w): w is string => !!w);
  const any = c.can("share_searches");
  return {
    sql: `(x.owner_id = ? OR x.share_scope = 'everyone' OR (x.share_scope = 'role' AND x.share_value = ?) OR (x.share_scope = 'workspace' AND (${any ? "TRUE" : workspaces.length ? `x.share_value IN (${workspaces.map(() => "?").join(", ")})` : "FALSE"})))`,
    args: [c.me.id, c.me.role, ...(any ? [] : workspaces)],
  };
}

async function checkShare(c: ItemContext, scope: unknown, value: unknown): Promise<{ scope: ShareScope; value: string | null }> {
  const s = (scope ?? "private") as ShareScope;
  if (!SCOPES.includes(s)) throw new HttpError(400, "Share with nobody, a role, a workspace or everyone");
  if (s !== "private" && !c.can("share_searches")) throw new HttpError(403, "You don't have permission to share filters and dashboards");
  if (s === "role") {
    if (!ROLES.includes(value as Role)) throw new HttpError(400, "Choose the role to share with");
    return { scope: s, value: String(value) };
  }
  if (s === "workspace") {
    const ws = await c.db.prepare("SELECT value FROM settings WHERE key = 'workspaces'").first<{ value: string }>();
    const list = ws ? (JSON.parse(ws.value) as string[]) : ["Projects", "HR"];
    if (!list.includes(String(value))) throw new HttpError(400, "Choose the workspace to share with");
    return { scope: s, value: String(value) };
  }
  return { scope: s, value: null };
}

const viewerOf = (c: ItemContext): Viewer => c.viewer;
const owns = (c: ItemContext, ownerId: string) => ownerId === c.me.id || c.can("manage_users");

interface FilterRow {
  id: string;
  name: string;
  description: string;
  pql: string;
  owner_id: string;
  owner_name: string | null;
  share_scope: ShareScope;
  share_value: string | null;
  updated_at: string;
  favourite: boolean;
}

/** The value lists the editor suggests, as this person may see them. */
async function fieldValues(c: ItemContext) {
  const [statuses, users, projects, labels, components, sprints, ws] = await Promise.all([
    c.db.prepare("SELECT name FROM work_statuses ORDER BY position").all<{ name: string }>(),
    c.db.prepare("SELECT username FROM users WHERE role <> 'viewer' ORDER BY username").all<{ username: string }>(),
    c.db.prepare("SELECT key FROM systems ORDER BY key").all<{ key: string }>(),
    c.db.prepare("SELECT label, COUNT(*) AS n FROM work_item_labels GROUP BY label ORDER BY n DESC LIMIT 50").all<{ label: string }>(),
    c.db.prepare("SELECT DISTINCT component FROM work_items WHERE component IS NOT NULL AND component <> '' ORDER BY component LIMIT 50").all<{ component: string }>(),
    c.db.prepare("SELECT name FROM sprints WHERE state <> 'CLOSED' OR completed_at > ? ORDER BY start_date DESC LIMIT 30").bind(new Date(Date.parse(c.now) - 180 * 86_400_000).toISOString()).all<{ name: string }>(),
    c.db.prepare("SELECT value FROM settings WHERE key = 'workspaces'").first<{ value: string }>(),
  ]);
  return {
    project: projects.results.map((r) => r.key),
    type: Object.values(TYPE_META).map((m) => m.label),
    status: statuses.results.map((r) => r.name),
    statusCategory: ["To Do", "In Progress", "Done"],
    priority: Object.values(WORK_PRIORITY_META).map((m) => m.label),
    assignee: users.results.map((r) => r.username),
    reporter: users.results.map((r) => r.username),
    labels: labels.results.map((r) => r.label),
    component: components.results.map((r) => r.component),
    sprint: [...new Set(sprints.results.map((r) => r.name))],
    resolution: ["Done", "Won't do"],
    source: ["client request", "service desk", "internal"],
    // Custom fields' choices (select fields), by field name.
    ...Object.fromEntries(
      (
        await c.db
          .prepare("SELECT f.name, o.label FROM custom_field_options o JOIN custom_fields f ON f.id = o.field_id ORDER BY f.name, o.position")
          .all<{ name: string; label: string }>()
      ).results.reduce((m, r) => m.set(r.name, [...(m.get(r.name) ?? []), r.label]), new Map<string, string[]>()),
    ),
    workspace: ws ? (JSON.parse(ws.value) as string[]) : ["Projects", "HR"],
  };
}

/** Group-by expressions a pie or two-dimensional gadget may use: a fixed list, never typed text. */
const GROUP_SQL: Record<string, string> = {
  status: "st.name",
  statusCategory: "CASE st.category WHEN 'TODO' THEN 'To Do' WHEN 'IN_PROGRESS' THEN 'In Progress' ELSE 'Done' END",
  priority: "initcap(lower(w.priority))",
  type: "CASE w.type WHEN 'SUBTASK' THEN 'Sub-task' ELSE initcap(lower(w.type)) END",
  assignee: "COALESCE((SELECT u.name FROM users u WHERE u.id = w.assignee), 'Unassigned')",
  reporter: "COALESCE((SELECT u.name FROM users u WHERE u.id = w.reporter), 'Former user')",
  project: "s.key",
  component: "COALESCE(NULLIF(w.component, ''), 'No component')",
  resolution: "CASE w.resolution WHEN 'DONE' THEN 'Done' WHEN 'WONT_DO' THEN 'Won''t do' ELSE 'Unresolved' END",
  sprint: "COALESCE((SELECT sp.name FROM sprints sp WHERE sp.id = w.sprint_id), 'No sprint')",
};
const FROM = "FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id";

/** One gadget's data, for this viewer. */
async function gadgetData(c: ItemContext, g: Gadget & { pql: string | null }) {
  if (!g.pql && g.pql !== "") return { empty: "Choose a saved filter for this gadget." };
  const v = viewerOf(c);
  const now = Date.parse(c.now);
  const f = await filterSql(c.db, g.pql ?? "", v, now);
  const today = c.now.slice(0, 10);
  switch (g.kind) {
    case "filter_results": {
      const r = await runQuery(c.db, g.pql ?? "", v, now, g.maxRows);
      return { items: r.rows.map(toSummary), total: r.total };
    }
    case "pie": {
      const expr = GROUP_SQL[g.field ?? "status"] ?? GROUP_SQL.status;
      const rows = await c.db.prepare(`SELECT ${expr} AS label, COUNT(*) AS n ${FROM} WHERE ${f.where} GROUP BY 1 ORDER BY n DESC`).bind(...f.params).all<{ label: string; n: number }>();
      return { slices: rows.results.map((r) => ({ label: r.label, count: Number(r.n) })) };
    }
    case "two_d": {
      const a = GROUP_SQL[g.field ?? "status"] ?? GROUP_SQL.status;
      const b = GROUP_SQL[g.field2 ?? "assignee"] ?? GROUP_SQL.assignee;
      const rows = await c.db.prepare(`SELECT ${a} AS row, ${b} AS col, COUNT(*) AS n ${FROM} WHERE ${f.where} GROUP BY 1, 2`).bind(...f.params).all<{ row: string; col: string; n: number }>();
      return { cells: rows.results.map((r) => ({ row: r.row, col: r.col, count: Number(r.n) })) };
    }
    case "created_resolved": {
      const since = new Date(now - 29 * 86_400_000).toISOString().slice(0, 10);
      const [created, resolved] = await Promise.all([
        c.db.prepare(`SELECT substr(w.created_at, 1, 10) AS d, COUNT(*) AS n ${FROM} WHERE ${f.where} AND w.created_at >= ? GROUP BY 1`).bind(...f.params, since).all<{ d: string; n: number }>(),
        c.db.prepare(`SELECT substr(w.resolved_at, 1, 10) AS d, COUNT(*) AS n ${FROM} WHERE ${f.where} AND w.resolved_at >= ? GROUP BY 1`).bind(...f.params, since).all<{ d: string; n: number }>(),
      ]);
      const days = Array.from({ length: 30 }, (_, i) => new Date(Date.parse(since) + i * 86_400_000).toISOString().slice(0, 10));
      const at = (list: { d: string; n: number }[], d: string) => Number(list.find((x) => x.d === d)?.n ?? 0);
      return { days, created: days.map((d) => at(created.results, d)), resolved: days.map((d) => at(resolved.results, d)) };
    }
    case "sprint_health": {
      const rows = await c.db
        .prepare(
          `SELECT sp.id, sp.name, sp.end_date, s.key AS project, COALESCE(SUM(w.story_points), 0) AS scope,
             COALESCE(SUM(w.story_points) FILTER (WHERE st.category = 'DONE'), 0) AS done, COUNT(*) AS items,
             COUNT(*) FILTER (WHERE st.category = 'DONE') AS done_items
           ${FROM} JOIN sprints sp ON sp.id = w.sprint_id
           WHERE ${f.where} AND sp.state = 'ACTIVE' GROUP BY sp.id, sp.name, sp.end_date, s.key ORDER BY sp.end_date`,
        )
        .bind(...f.params)
        .all<{ id: string; name: string; end_date: string; project: string; scope: number; done: number; items: number; done_items: number }>();
      return {
        sprints: rows.results.map((r) => ({
          name: r.name,
          project: r.project,
          endDate: r.end_date,
          daysLeft: daysLeft(r.end_date, now),
          scope: Number(r.scope),
          done: Number(r.done),
          items: Number(r.items),
          doneItems: Number(r.done_items),
        })),
      };
    }
    case "workload": {
      const rows = await c.db
        .prepare(
          `SELECT ${GROUP_SQL.assignee} AS name, COUNT(*) AS n, COALESCE(SUM(w.story_points), 0) AS points,
             COUNT(*) FILTER (WHERE w.due_date < ?) AS late
           ${FROM} WHERE ${f.where} AND st.category <> 'DONE' GROUP BY 1 ORDER BY n DESC LIMIT ?`,
        )
        .bind(today, ...f.params, g.maxRows)
        .all<{ name: string; n: number; points: number; late: number }>();
      return { people: rows.results.map((r) => ({ name: r.name, open: Number(r.n), points: Number(r.points), late: Number(r.late) })) };
    }
    case "overdue": {
      const rows = await c.db
        .prepare(`${SELECT} WHERE ${f.where} AND st.category <> 'DONE' AND w.due_date < ? ORDER BY w.due_date, s.key, w.number LIMIT ?`)
        .bind(...f.params, today, g.maxRows)
        .all<ItemRow>();
      return { items: rows.results.map(toSummary) };
    }
    case "activity": {
      const keys = await c.db.prepare(`SELECT s.key || '-' || w.number AS k ${FROM} WHERE ${f.where} ORDER BY w.updated_at DESC LIMIT 200`).bind(...f.params).all<{ k: string }>();
      if (!keys.results.length) return { entries: [] };
      const ks = keys.results.map((k) => k.k);
      const rows = await c.db
        .prepare(`SELECT id, at, user_id, actor, action, target, detail FROM activity WHERE (detail::json ->> 'key') IN (${ks.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT ?`)
        .bind(...ks, g.maxRows)
        .all<{ id: number; at: string; user_id: string | null; actor: string; action: string; target: string | null; detail: string }>();
      return { entries: rows.results.map((r) => ({ id: Number(r.id), at: r.at, userId: r.user_id, actor: r.actor, action: r.action, target: r.target, detail: JSON.parse(r.detail || "{}"), ip: null, agent: null })) };
    }
  }
}

interface DashRow {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string | null;
  share_scope: ShareScope;
  share_value: string | null;
  layout: Dashboard["layout"];
}

async function dashboardsFor(c: ItemContext, id?: string): Promise<Dashboard[]> {
  const vis = await shareVisibility(c);
  const rows = await c.db
    .prepare(`SELECT x.*, u.name AS owner_name FROM dashboards x LEFT JOIN users u ON u.id = x.owner_id WHERE ${vis.sql}${id ? " AND x.id = ?" : ""} ORDER BY x.owner_id = ? DESC, x.name`)
    .bind(...vis.args, ...(id ? [id] : []), c.me.id)
    .all<DashRow>();
  if (!rows.results.length) return [];
  const ids = rows.results.map((r) => r.id);
  const gadgets = await c.db
    .prepare(
      `SELECT g.*, f.name AS filter_name FROM dashboard_gadgets g LEFT JOIN saved_filters f ON f.id = g.filter_id
       WHERE g.dashboard_id IN (${ids.map(() => "?").join(", ")}) ORDER BY g.column_index, g.position`,
    )
    .bind(...ids)
    .all<{ id: string; dashboard_id: string; kind: GadgetKind; filter_id: string | null; filter_name: string | null; title: string; column_index: number; position: number; field: string | null; field2: string | null; max_rows: number }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    ownerName: r.owner_name ?? "Former user",
    shareScope: r.share_scope,
    ...(r.share_value ? { shareValue: r.share_value } : {}),
    layout: r.layout,
    mine: r.owner_id === c.me.id,
    gadgets: gadgets.results
      .filter((g) => g.dashboard_id === r.id)
      .map((g) => ({
        id: g.id,
        kind: g.kind,
        ...(g.filter_id ? { filterId: g.filter_id, filterName: g.filter_name ?? undefined } : {}),
        title: g.title,
        column: Number(g.column_index),
        position: Number(g.position),
        ...(g.field ? { field: g.field } : {}),
        ...(g.field2 ? { field2: g.field2 } : {}),
        maxRows: Number(g.max_rows),
      })),
  }));
}

export async function searchApi(c: ItemContext, env: Env, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/search") && !path.startsWith("/api/filters") && !path.startsWith("/api/dashboards") && path !== "/api/ask/pql") return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req } = c;
  const now = Date.parse(c.now);

  // ----- search -----
  if (path === "/api/search" && method === "POST") {
    const b = await body<{ pql?: unknown; offset?: unknown; limit?: unknown }>(req);
    const pql = String(b.pql ?? "").slice(0, 2000);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(b.limit) || 50));
    const offset = Math.max(0, Number(b.offset) || 0);
    try {
      const r = await runQuery(db, pql, viewerOf(c), now, limit, offset);
      // Custom field values ride along, for the table and CSV.
      const custom = await customValuesFor(db, r.rows.map((x) => x.id));
      return json({ items: r.rows.map((x) => ({ ...toSummary(x), customFields: custom.get(x.id) ?? [] })), total: r.total, offset });
    } catch (e) {
      pqlError(e);
    }
  }
  if (path === "/api/search/fields" && method === "GET") {
    const custom = customFieldDefs([...(await customFieldsByName(db)).values()]);
    return json({ fields: FIELDS, custom, functions: FUNCTIONS, values: await fieldValues(c) });
  }

  // ----- saved filters -----
  if (path === "/api/filters" && method === "GET") {
    const vis = await shareVisibility(c);
    const rows = await db
      .prepare(
        `SELECT x.*, u.name AS owner_name, EXISTS (SELECT 1 FROM filter_favourites ff WHERE ff.filter_id = x.id AND ff.user_id = ?) AS favourite
         FROM saved_filters x LEFT JOIN users u ON u.id = x.owner_id WHERE ${vis.sql} ORDER BY favourite DESC, x.name`,
      )
      .bind(c.me.id, ...vis.args)
      .all<FilterRow>();
    const subs = await db.prepare("SELECT * FROM filter_subscriptions WHERE user_id = ?").bind(c.me.id).all<Record<string, string | number | null>>();
    return json(
      rows.results.map(
        (r): SavedFilter => ({
          id: r.id,
          name: r.name,
          description: r.description,
          pql: r.pql,
          ownerId: r.owner_id,
          ownerName: r.owner_name ?? "Former user",
          shareScope: r.share_scope,
          ...(r.share_value ? { shareValue: r.share_value } : {}),
          favourite: !!r.favourite,
          mine: r.owner_id === c.me.id,
          subscriptions: subs.results
            .filter((s) => s.filter_id === r.id)
            .map((s) => ({
              id: String(s.id),
              frequency: s.frequency as "daily" | "weekly",
              ...(s.weekday != null ? { weekday: Number(s.weekday) } : {}),
              hour: Number(s.hour),
              ...(s.last_sent_at ? { lastSentAt: String(s.last_sent_at) } : {}),
            })),
          updatedAt: r.updated_at,
        }),
      ),
    );
  }

  const checkFilter = async (b: { name?: unknown; description?: unknown; pql?: unknown }) => {
    const name = String(b.name ?? "").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "A filter needs a name");
    const pql = String(b.pql ?? "").trim().slice(0, 2000);
    try {
      await filterSql(db, pql, viewerOf(c), now);
    } catch (e) {
      pqlError(e);
    }
    return { name, pql, description: String(b.description ?? "").trim().slice(0, 300) };
  };

  if (path === "/api/filters" && method === "POST") {
    const b = await body<{ name?: unknown; description?: unknown; pql?: unknown; shareScope?: unknown; shareValue?: unknown }>(req);
    const f = await checkFilter(b);
    const share = await checkShare(c, b.shareScope, b.shareValue);
    const id = newToken().slice(0, 16);
    await db
      .prepare("INSERT INTO saved_filters (id, name, description, pql, owner_id, share_scope, share_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, f.name, f.description, f.pql, c.me.id, share.scope, share.value, c.now, c.now)
      .run();
    await c.audit("filter_created", null, { filter: f.name, pql: f.pql, shared: shareLabel(share.scope, share.value ?? undefined) });
    return json({ id }, 201);
  }

  let m = path.match(/^\/api\/filters\/([a-z0-9-]{4,40})$/);
  const getFilter = async (id: string) => {
    const vis = await shareVisibility(c);
    const row = await db.prepare(`SELECT x.* FROM saved_filters x WHERE x.id = ? AND ${vis.sql}`).bind(id, ...vis.args).first<FilterRow>();
    if (!row) throw new HttpError(404, "Filter not found");
    return row;
  };
  if (m && method === "PUT") {
    const row = await getFilter(m[1]);
    if (!owns(c, row.owner_id)) throw new HttpError(403, "Only whoever saved this filter can change it");
    const b = await body<{ name?: unknown; description?: unknown; pql?: unknown; shareScope?: unknown; shareValue?: unknown }>(req);
    const f = await checkFilter({ name: b.name ?? row.name, description: b.description ?? row.description, pql: b.pql ?? row.pql });
    const share = await checkShare(c, b.shareScope ?? row.share_scope, b.shareValue ?? row.share_value);
    await db
      .prepare("UPDATE saved_filters SET name = ?, description = ?, pql = ?, share_scope = ?, share_value = ?, updated_at = ? WHERE id = ?")
      .bind(f.name, f.description, f.pql, share.scope, share.value, c.now, row.id)
      .run();
    await c.audit("filter_updated", null, {
      filter: f.name,
      from: { name: row.name, pql: row.pql, shared: shareLabel(row.share_scope, row.share_value ?? undefined) },
      to: { name: f.name, pql: f.pql, shared: shareLabel(share.scope, share.value ?? undefined) },
    });
    return json({ ok: true });
  }
  if (m && method === "DELETE") {
    const row = await getFilter(m[1]);
    if (!owns(c, row.owner_id)) throw new HttpError(403, "Only whoever saved this filter can delete it");
    await db.prepare("DELETE FROM saved_filters WHERE id = ?").bind(row.id).run();
    await c.audit("filter_deleted", null, { filter: row.name, pql: row.pql });
    return json({ ok: true });
  }
  m = path.match(/^\/api\/filters\/([a-z0-9-]{4,40})\/favourite$/);
  if (m && (method === "POST" || method === "DELETE")) {
    const row = await getFilter(m[1]);
    await (method === "POST"
      ? db.prepare("INSERT INTO filter_favourites (filter_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(row.id, c.me.id, c.now)
      : db.prepare("DELETE FROM filter_favourites WHERE filter_id = ? AND user_id = ?").bind(row.id, c.me.id)
    ).run();
    return json({ favourite: method === "POST" });
  }
  m = path.match(/^\/api\/filters\/([a-z0-9-]{4,40})\/subscriptions$/);
  if (m && method === "POST") {
    const row = await getFilter(m[1]);
    const b = await body<{ frequency?: unknown; weekday?: unknown; hour?: unknown }>(req);
    const frequency = b.frequency === "weekly" ? "weekly" : b.frequency === "daily" ? "daily" : null;
    if (!frequency) throw new HttpError(400, "Choose daily or weekly");
    const hour = Number(b.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, "Choose an hour from 0 to 23");
    const weekday = frequency === "weekly" ? Number(b.weekday) : null;
    if (frequency === "weekly" && (!Number.isInteger(weekday) || weekday! < 1 || weekday! > 7)) throw new HttpError(400, "Choose a day of the week");
    const count = await db.prepare("SELECT COUNT(*) AS n FROM filter_subscriptions WHERE user_id = ?").bind(c.me.id).first<{ n: number }>();
    if (Number(count?.n) >= 20) throw new HttpError(400, "You can have up to 20 subscriptions");
    const id = newToken().slice(0, 16);
    await db.prepare("INSERT INTO filter_subscriptions (id, filter_id, user_id, frequency, weekday, hour, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, row.id, c.me.id, frequency, weekday, hour, c.now).run();
    await c.audit("filter_subscribed", null, { filter: row.name, frequency, weekday, hour });
    return json({ id }, 201);
  }
  m = path.match(/^\/api\/filters\/([a-z0-9-]{4,40})\/subscriptions\/([a-z0-9-]{4,40})$/);
  if (m && method === "DELETE") {
    const row = await getFilter(m[1]);
    const done = await db.prepare("DELETE FROM filter_subscriptions WHERE id = ? AND filter_id = ? AND user_id = ?").bind(m[2], row.id, c.me.id).run();
    if (!done.meta.changes) throw new HttpError(404, "Subscription not found");
    await c.audit("filter_unsubscribed", null, { filter: row.name });
    return json({ ok: true });
  }

  // ----- dashboards -----
  if (path === "/api/dashboards" && method === "GET") return json(await dashboardsFor(c));
  const saveGadgets = async (dashboardId: string, list: unknown) => {
    if (!Array.isArray(list)) throw new HttpError(400, "Gadgets must be a list");
    if (list.length > 20) throw new HttpError(400, "Up to 20 gadgets on a dashboard");
    const vis = await shareVisibility(c);
    const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM dashboard_gadgets WHERE dashboard_id = ?").bind(dashboardId)];
    for (const [i, raw] of list.entries()) {
      const g = raw as Record<string, unknown>;
      const kind = g.kind as GadgetKind;
      if (!(kind in GADGETS)) throw new HttpError(400, "Unknown gadget");
      let filterId: string | null = null;
      if (g.filterId) {
        const f = await db.prepare(`SELECT x.id FROM saved_filters x WHERE x.id = ? AND ${vis.sql}`).bind(String(g.filterId), ...vis.args).first<{ id: string }>();
        if (!f) throw new HttpError(400, "A gadget's filter isn't one you can use");
        filterId = f.id;
      }
      const field = g.field && GROUP_SQL[String(g.field)] ? String(g.field) : null;
      const field2 = g.field2 && GROUP_SQL[String(g.field2)] ? String(g.field2) : null;
      const rows = Math.min(50, Math.max(1, Number(g.maxRows) || 10));
      stmts.push(
        db
          .prepare("INSERT INTO dashboard_gadgets (id, dashboard_id, kind, filter_id, title, column_index, position, field, field2, max_rows) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(typeof g.id === "string" && /^[a-z0-9-]{4,40}$/.test(g.id) ? g.id : newToken().slice(0, 16), dashboardId, kind, filterId, String(g.title ?? "").slice(0, 80), Math.max(0, Math.min(2, Number(g.column) || 0)), i, field, field2, rows),
      );
    }
    await db.batch(stmts);
  };
  if (path === "/api/dashboards" && method === "POST") {
    const b = await body<{ name?: unknown; layout?: unknown; shareScope?: unknown; shareValue?: unknown; gadgets?: unknown }>(req);
    const name = String(b.name ?? "").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "A dashboard needs a name");
    const layout = ["one", "two", "three"].includes(String(b.layout)) ? String(b.layout) : "two";
    const share = await checkShare(c, b.shareScope, b.shareValue);
    const id = newToken().slice(0, 16);
    await db.prepare("INSERT INTO dashboards (id, name, owner_id, share_scope, share_value, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, name, c.me.id, share.scope, share.value, layout, c.now, c.now).run();
    if (b.gadgets) await saveGadgets(id, b.gadgets);
    await c.audit("dashboard_created", null, { dashboard: name, shared: shareLabel(share.scope, share.value ?? undefined) });
    return json((await dashboardsFor(c, id))[0], 201);
  }
  m = path.match(/^\/api\/dashboards\/([a-z0-9-]{4,40})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    const [d] = await dashboardsFor(c, m[1]);
    if (!d) throw new HttpError(404, "Dashboard not found");
    if (!owns(c, d.ownerId)) throw new HttpError(403, "Only whoever made this dashboard can change it");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM dashboards WHERE id = ?").bind(d.id).run();
      await c.audit("dashboard_deleted", null, { dashboard: d.name });
      return json({ ok: true });
    }
    const b = await body<{ name?: unknown; layout?: unknown; shareScope?: unknown; shareValue?: unknown; gadgets?: unknown }>(req);
    const name = String(b.name ?? d.name).trim().slice(0, 80);
    if (!name) throw new HttpError(400, "A dashboard needs a name");
    const layout = ["one", "two", "three"].includes(String(b.layout ?? d.layout)) ? String(b.layout ?? d.layout) : "two";
    const share = await checkShare(c, b.shareScope ?? d.shareScope, b.shareValue ?? d.shareValue);
    await db.prepare("UPDATE dashboards SET name = ?, layout = ?, share_scope = ?, share_value = ?, updated_at = ? WHERE id = ?").bind(name, layout, share.scope, share.value, c.now, d.id).run();
    if (b.gadgets !== undefined) await saveGadgets(d.id, b.gadgets);
    const [after] = await dashboardsFor(c, d.id);
    await c.audit("dashboard_updated", null, {
      dashboard: name,
      from: { name: d.name, layout: d.layout, shared: shareLabel(d.shareScope, d.shareValue), gadgets: d.gadgets.map((g) => GADGETS[g.kind].label) },
      to: { name, layout, shared: shareLabel(share.scope, share.value ?? undefined), gadgets: after.gadgets.map((g) => GADGETS[g.kind].label) },
    });
    return json(after);
  }
  m = path.match(/^\/api\/dashboards\/([a-z0-9-]{4,40})\/gadgets\/([a-z0-9-]{4,40})$/);
  if (m && method === "GET") {
    const [d] = await dashboardsFor(c, m[1]);
    const g = d?.gadgets.find((x) => x.id === m![2]);
    if (!d || !g) throw new HttpError(404, "Gadget not found");
    // Whoever can see the dashboard sees its gadgets' results, each under their own visibility.
    const pql = g.filterId ? ((await db.prepare("SELECT pql FROM saved_filters WHERE id = ?").bind(g.filterId).first<{ pql: string }>())?.pql ?? null) : null;
    try {
      return json(await gadgetData(c, { ...g, pql }));
    } catch (e) {
      if (e instanceof PqlError) return json({ empty: `The filter no longer works: ${e.message}` });
      throw e;
    }
  }

  // ----- a question in plain English, as PQL -----
  if (path === "/api/ask/pql" && method === "POST") {
    if (!env.AI) throw new HttpError(503, "Ask Pulse isn't switched on for this server");
    const question = String((await body<{ question?: unknown }>(req)).question ?? "").trim().slice(0, 400);
    if (!question) throw new HttpError(400, "Type a question");
    const values = await fieldValues(c);
    const system = [
      "You turn a question about work items into one Pulse Query Language (PQL) query. Reply with the query only, on one line: no explanation, no code fences.",
      "PQL is like Jira's JQL. Fields: " + FIELDS.map((f) => `${f.name} (${f.description})`).join("; ") + ".",
      "Operators: = != > < >= <= IN (a, b) NOT IN ~ (contains) IS EMPTY IS NOT EMPTY AND OR NOT, brackets, ORDER BY field ASC|DESC.",
      "Functions: currentUser() (the person asking, for 'my' or 'me'), openSprints(), closedSprints(), now(), startOfWeek(), endOfWeek(). Relative dates: -7d, -2w, 1m. Dates: 2026-11-01.",
      "Quote values with spaces in double quotes. Use statusCategory != Done for 'open' or 'not done'.",
      `Known projects: ${values.project.join(", ")}. Statuses: ${values.status.join(", ")}. People (usernames): ${values.assignee.slice(0, 60).join(", ")}. Sprints: ${values.sprint.join(", ") || "none"}.`,
      "Examples: 'my open bugs' -> type = Bug AND assignee = currentUser() AND statusCategory != Done",
      "'high priority items overdue' -> priority IN (High, Highest) AND due < now() AND statusCategory != Done ORDER BY due ASC",
      "'what changed this week in INFRA' -> project = INFRA AND updated >= startOfWeek() ORDER BY updated DESC",
    ].join("\n");
    let pql = "";
    let error = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = [
        { role: "system", content: system },
        { role: "user", content: question },
        ...(attempt ? [{ role: "assistant", content: pql }, { role: "user", content: `That query fails: ${error}. Reply with a corrected query only.` }] : []),
      ];
      const out = (await env.AI.run(ASK_MODEL, { messages, max_tokens: 160, temperature: 0 })) as { response?: string };
      pql = String(out?.response ?? "")
        .replace(/```[a-z]*|```/g, "")
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !/^(pql|query)\s*:?$/i.test(l))
        ?.replace(/^(pql|query)\s*:\s*/i, "")
        ?.slice(0, 1000) ?? "";
      try {
        await filterSql(db, pql, viewerOf(c), now);
        error = "";
        break;
      } catch (e) {
        error = e instanceof Error ? e.message : "it doesn't parse";
      }
    }
    return json({ pql, ...(error ? { error } : {}) });
  }

  throw new HttpError(404, "Not found");
}

/** Harare's hour (0–23) and weekday (1 Monday … 7 Sunday) for `now`. */
export function harare(now: number) {
  const d = new Date(now + 2 * 3_600_000);
  return { hour: d.getUTCHours(), weekday: ((d.getUTCDay() + 6) % 7) + 1, date: d.toISOString().slice(0, 10) };
}

/** Emails each filter subscription due this hour, run as its subscriber. Called by the hourly cron. */
export async function runSubscriptions(env: Env, now = Date.now()): Promise<number> {
  const db = env.DB;
  const h = harare(now);
  const due = await db
    .prepare(
      `SELECT fs.id, fs.user_id, fs.frequency, f.id AS filter_id, f.name, f.pql FROM filter_subscriptions fs JOIN saved_filters f ON f.id = fs.filter_id
       WHERE fs.hour = ? AND (fs.frequency = 'daily' OR fs.weekday = ?) AND (fs.last_sent_at IS NULL OR fs.last_sent_at < ?)`,
    )
    .bind(h.hour, h.weekday, new Date(now - 50 * 60_000).toISOString())
    .all<{ id: string; user_id: string; frequency: string; filter_id: string; name: string; pql: string }>();
  let sent = 0;
  for (const s of due.results) {
    const viewer = await viewerFor(db, s.user_id);
    if (!viewer) continue;
    let items: ItemRow[] = [];
    let total = 0;
    let problem = "";
    try {
      const r = await runQuery(db, s.pql, viewer, now, 50);
      items = r.rows;
      total = r.total;
    } catch (e) {
      problem = e instanceof Error ? e.message : "the filter no longer works";
    }
    const alert: Alert = {
      userId: s.user_id,
      kind: "subscription",
      title: `${s.name}: ${problem ? "the filter needs fixing" : `${total} work item${total === 1 ? "" : "s"}`}`.slice(0, 200),
      body: problem ? `Your subscription couldn't run: ${problem}.` : total > items.length ? `Showing the first ${items.length} of ${total}.` : `Your ${s.frequency} results.`,
      link: `view:search`,
      dedupe: `subscription:${s.id}:${h.date}:${h.hour}`,
      ...(problem
        ? {}
        : {
            digest: {
              title: s.name,
              period: `${h.date}T${String(h.hour).padStart(2, "0")}`,
              writtenAt: new Date(now).toISOString(),
              summary: `${total} work item${total === 1 ? "" : "s"} match "${s.name}" (${s.pql || "everything"}).`,
              aiWritten: false,
              sections: [
                {
                  title: total ? s.name : "No work items match right now",
                  items: items.map((r) => ({ text: `${keyOf(r)} ${r.summary} · ${r.status_name}${r.due_date ? ` · due ${r.due_date}` : ""}`, link: `#/projects/${r.system_id}/items/${keyOf(r)}` })),
                },
              ],
            },
          }),
    };
    await raise(env, [alert]).catch(() => undefined);
    await db.prepare("UPDATE filter_subscriptions SET last_sent_at = ? WHERE id = ?").bind(new Date(now).toISOString(), s.id).run();
    sent++;
  }
  return sent;
}

/** Ask Pulse: the saved filters and dashboards this person can use. */
export async function askSearchLines(c: ItemContext): Promise<string[]> {
  const vis = await shareVisibility(c);
  const [filters, dashboards] = await Promise.all([
    c.db.prepare(`SELECT x.name, x.pql, x.share_scope, x.share_value FROM saved_filters x WHERE ${vis.sql} ORDER BY x.name LIMIT 30`).bind(...vis.args).all<{ name: string; pql: string; share_scope: ShareScope; share_value: string | null }>(),
    c.db.prepare(`SELECT x.name FROM dashboards x WHERE ${vis.sql} ORDER BY x.name LIMIT 20`).bind(...vis.args).all<{ name: string }>(),
  ]);
  const lines: string[] = [];
  if (filters.results.length) {
    lines.push("", "SAVED FILTERS you can use (name | PQL query | shared with)");
    for (const f of filters.results) lines.push(`${f.name.replace(/\|/g, "/")} | ${f.pql.replace(/\|/g, "/") || "(everything)"} | ${shareLabel(f.share_scope, f.share_value ?? undefined)}`);
  }
  if (dashboards.results.length) lines.push("", `DASHBOARDS you can open: ${dashboards.results.map((d) => d.name).join(", ")}`);
  return lines;
}
