/** @import { ItemContext, ItemRow } from './workitems' */
/** @import { Viewer } from './access' */
/** @import { Sprint, SprintSnapshot, TimelineBar, TimelineLink, TimelineProject } from '../../project-management-system-frontend/src/data/sprints' */
/** @import { StatusCategory } from '../../project-management-system-frontend/src/data/workitems' */
// Scrum: the ranked backlog and sprints (plan, start, complete with a snapshot), the timeline
// (projects, epics and their items on a calendar), and the agile reports built from status_history,
// sprint_items and the snapshots. Visibility follows the work item rules: developers without
// manage_features see and count only the items assigned to them or that they reported.
import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { keyOf, toSummary } from "./workitems";
import { PUBLIC_VIEWER, itemAccess } from "./access";
import { statusCatalogue } from "./workflowData";
import { MAX_WEEKS, MIN_WEEKS, averageVelocity, daysLeft, sprintEnd } from "../../project-management-system-frontend/src/data/sprints";
const BACKLOG_LIMIT = 500;
const SELECT = `SELECT w.*, st.name AS status_name, st.category AS status_category,
  s.key AS project_key, (s.data::json ->> 'name') AS project_name, p.number AS parent_number,
  (SELECT string_agg(l.label, ',' ORDER BY l.label) FROM work_item_labels l WHERE l.item_id = w.id) AS labels,
  (SELECT COUNT(*) FROM work_items c WHERE c.parent_id = w.id AND COALESCE(c.resolution, '') <> 'WONT_DO') AS child_total,
  (SELECT COUNT(*) FROM work_items c JOIN work_statuses cs ON cs.id = c.status
     WHERE c.parent_id = w.id AND cs.category = 'DONE' AND COALESCE(c.resolution, '') <> 'WONT_DO') AS child_done
  FROM work_items w
  JOIN work_statuses st ON st.id = w.status
  JOIN systems s ON s.id = w.system_id
  LEFT JOIN work_items p ON p.id = w.parent_id`;
const toSprint =
  /**
   * @param {SprintRow} r
   * @param {SnapRow | null} [snap]
   * @returns {Sprint}
   */ (r, snap) => ({
    id: r.id,
    systemId: r.system_id,
    name: r.name,
    goal: r.goal,
    startDate: r.start_date,
    endDate: r.end_date,
    lengthWeeks: Number(r.length_weeks),
    state: r.state,
    ...(r.started_at ? { startedAt: r.started_at } : {}),
    ...(r.completed_at ? { completedAt: r.completed_at } : {}),
    ...(snap
      ? {
          snapshot: {
            committedPoints: Number(snap.committed_points),
            completedPoints: Number(snap.completed_points),
            addedPoints: Number(snap.added_points),
            removedPoints: Number(snap.removed_points),
            notCompletedPoints: Number(snap.not_completed_points),
            committedItems: Number(snap.committed_items),
            completedItems: Number(snap.completed_items),
            addedItems: Number(snap.added_items),
            removedItems: Number(snap.removed_items),
            notCompletedItems: Number(snap.not_completed_items),
          },
        }
      : {}),
  });
const vis =
  /** @param {ItemContext} c
   * @param {string} [alias="w"]
   * @returns {{ sql: string; args: unknown[]; }}
   */ (c, alias = "w") => {
    const a = itemAccess(c.viewer, alias);
    return { sql: ` AND ${a.sql}`, args: a.args };
  };
const pts =
  /** @param {{ story_points: number | null }} r
   * @returns {number}
   */ (r) => (r.story_points == null ? 0 : Number(r.story_points));
/**
 * @param {ItemContext} c
 * @param {string} id
 * @returns {Promise<SprintRow>}
 */
async function getSprint(c, id) {
  const row = await /** @type {Promise<SprintRow | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT * FROM sprints WHERE id = ?").bind(id).first()));
  if (!row) throw new HttpError(404, "Sprint not found");
  return row;
}
/**
 * @param {ItemContext} c
 * @param {string} id
 * @returns {Promise<{ id: string; key: string; agile_mode: string; name: string; }>}
 */
async function projectOf(c, id) {
  const row = await /** @type {Promise<{ id: string; key: string; agile_mode: string; name: string; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id, key, agile_mode, (data::json ->> 'name') AS name FROM systems WHERE id = ?").bind(id).first()));
  if (!row) throw new HttpError(404, "Project not found");
  return row;
}
const mayPlan =
  /** @param {ItemContext} c
   * @returns {boolean}
   */ (c) => !c.guest && c.can("manage_sprints");
const needPlan =
  /** @param {ItemContext} c
   * @returns {void}
   */ (c) => {
    if (!mayPlan(c)) throw new HttpError(403, "You don't have permission to plan sprints");
  };
/**
 * Puts items into a sprint (or back in the backlog), keeping sprint_items' record of who joined and left when.
 * @param {ItemContext} c
 * @param {ItemRow[]} rows
 * @param {SprintRow | null} target
 * @returns {Promise<void>}
 */
async function moveIntoSprint(c, rows, target) {
  const db = c.db;
  /** @type {D1PreparedStatement[]} */ const stmts = [];
  for (const r of rows) {
    const from = r.sprint_id ?? null;
    if (from === (target?.id ?? null)) continue;
    if (from) {
      const old = await /** @type {Promise<{ state: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT state FROM sprints WHERE id = ?").bind(from).first()));
      // Leaving a running sprint is scope change, kept for the reports; leaving a planned one leaves no trace.
      stmts.push(old?.state === "ACTIVE" ? db.prepare("UPDATE sprint_items SET removed_at = ?, outcome = 'removed' WHERE sprint_id = ? AND item_id = ? AND removed_at IS NULL").bind(c.now, from, r.id) : db.prepare("DELETE FROM sprint_items WHERE sprint_id = ? AND item_id = ?").bind(from, r.id));
    }
    if (target) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO sprint_items (sprint_id, item_id, added_at, added_after_start, points) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (sprint_id, item_id) DO UPDATE SET added_at = excluded.added_at, added_after_start = excluded.added_after_start,
               points = excluded.points, removed_at = NULL, outcome = NULL`,
          )
          .bind(target.id, r.id, c.now, target.state === "ACTIVE" ? 1 : 0, r.story_points),
      );
    }
    stmts.push(db.prepare("UPDATE work_items SET sprint_id = ?, updated_at = ? WHERE id = ?").bind(target?.id ?? null, c.now, r.id));
  }
  if (stmts.length) await db.batch(stmts);
}
/**
 * The project's items by key, refusing any it doesn't have or this person can't see.
 * @param {ItemContext} c
 * @param {string} systemId
 * @param {unknown} keys
 * @returns {Promise<ItemRow[]>}
 */
async function itemsByKeys(c, systemId, keys) {
  if (!Array.isArray(keys) || !keys.length) throw new HttpError(400, "Say which work items");
  if (keys.length > 200) throw new HttpError(400, "Up to 200 at a time");
  const wanted = keys.map((k) => String(k).toUpperCase());
  const v = vis(c);
  const rows = await /** @type {Promise<D1Result<ItemRow>>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(`${SELECT} WHERE w.system_id = ? AND (s.key || '-' || w.number) IN (${wanted.map(() => "?").join(", ")})${v.sql}`)
        .bind(systemId, ...wanted, ...v.args)
        .all()
    )
  );
  if (rows.results.length !== wanted.length) throw new HttpError(404, "Some of those work items aren't in this project");
  const byKey = new Map(rows.results.map((r) => [keyOf(r), r]));
  return wanted.map((k) => /** @type {ItemRow} */ (byKey.get(k)));
}
/**
 * @param {unknown} v
 * @param {string} field
 * @returns {string}
 */
function checkDate(v, field) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} must be a date`);
  return v;
}
/**
 * @param {unknown} v
 * @returns {number}
 */
function checkWeeks(v) {
  const n = Number(v ?? 2);
  if (!Number.isInteger(n) || n < MIN_WEEKS || n > MAX_WEEKS) throw new HttpError(400, `A sprint lasts ${MIN_WEEKS} to ${MAX_WEEKS} weeks`);
  return n;
}
/**
 * Each day from `start` to `end` (YYYY-MM-DD), inclusive.
 * @param {string} start
 * @param {string} end
 * @returns {string[]}
 */
function daysFrom(start, end) {
  /** @type {string[]} */ const out = [];
  for (let t = Date.parse(start); t <= Date.parse(end) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/**
 * Each item's status at the end of each day, replayed from its status history.
 * @param {ItemContext} c
 * @param {string[]} itemIds
 * @returns {Promise<Map<string, { at: string; to: string; }[]>>}
 */
async function statusReplay(c, itemIds) {
  if (!itemIds.length) return /** @type {Map<string, Array<{ at: string; to: string; }>>} */ (/** @type {unknown} */ (new Map()));
  /** @type {{ item_id: string; to_status: string; changed_at: string }[]} */ const rows = [];
  for (let i = 0; i < itemIds.length; i += 500) {
    const ids = itemIds.slice(i, i + 500);
    const part = await /** @type {Promise<D1Result<{ item_id: string; to_status: string; changed_at: string; }>>} */ (
      /** @type {unknown} */ (
        c.db
          .prepare(`SELECT item_id, to_status, changed_at FROM status_history WHERE item_id IN (${ids.map(() => "?").join(", ")}) ORDER BY changed_at, id`)
          .bind(...ids)
          .all()
      )
    );
    rows.push(...part.results);
  }
  const byItem = /** @type {Map<string, Array<{ at: string; to: string; }>>} */ (/** @type {unknown} */ (new Map()));
  for (const r of rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), { at: r.changed_at, to: r.to_status }]);
  return byItem;
}
const statusAt =
  /** @param {{ at: string; to: string }[] | undefined} history
   * @param {string} endOfDay
   * @returns {string | null}
   */ (history, endOfDay) => {
    /** @type {string | null} */ let s = null;
    for (const h of history ?? []) if (h.at <= endOfDay) s = h.to;
    return s;
  };
const endOf =
  /** @param {string} day
   * @returns {string}
   */ (day) => `${day}T23:59:59.999Z`;
/**
 * The scope of reports: one project, or a workspace's projects.
 * @param {URLSearchParams} q
 * @returns {{ sql: string; args: unknown[]; }}
 */
function reportScope(q) {
  const system = q.get("system");
  const workspace = q.get("workspace");
  if (system) return { sql: "w.system_id = ?", args: /** @type {unknown[]} */ ([system]) };
  if (workspace) return { sql: "(s.data::json ->> 'workspace') = ?", args: /** @type {unknown[]} */ ([workspace]) };
  throw new HttpError(400, "Say which project or workspace");
}
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function sprintsApi(c, path, method) {
  if (!path.startsWith("/api/backlog") && !path.startsWith("/api/sprints") && !path.startsWith("/api/timeline") && !path.startsWith("/api/reports/agile")) return null;
  const { db, req } = c;
  const q = new URL(req.url).searchParams;
  // ----- the backlog and its sprints -----
  if (path === "/api/backlog" && method === "GET") {
    const p = await projectOf(c, String(q.get("system") ?? ""));
    const v = vis(c);
    const [sprints, items, closed] = await Promise.all([
      /** @type {Promise<D1Result<SprintRow>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM sprints WHERE system_id = ? AND state <> 'CLOSED' ORDER BY state = 'ACTIVE' DESC, start_date, created_at").bind(p.id).all())),
      /** @type {Promise<D1Result<ItemRow>>} */ (
        /** @type {unknown} */ (
          db
            .prepare(
              `${SELECT} WHERE w.system_id = ? AND w.type <> 'EPIC' AND (w.sprint_id IS NOT NULL OR st.category <> 'DONE')${v.sql}
           ORDER BY w.backlog_rank NULLS LAST, w.number LIMIT ?`,
            )
            .bind(p.id, ...v.args, BACKLOG_LIMIT * 2)
            .all()
        )
      ),
      /** @type {Promise<D1Result<{ name: string; committed_points: number; completed_points: number; }>>} */ (
        /** @type {unknown} */ (db.prepare("SELECT sp.name, ss.committed_points, ss.completed_points FROM sprints sp JOIN sprint_snapshots ss ON ss.sprint_id = sp.id WHERE sp.system_id = ? ORDER BY sp.completed_at DESC LIMIT 6").bind(p.id).all())
      ),
    ]);
    const open = new Set(sprints.results.map((s) => s.id));
    const inBacklog = items.results.filter((r) => !r.sprint_id || !open.has(r.sprint_id)).filter((r) => r.status_category !== "DONE");
    const backlogCount = await /** @type {Promise<{ n: number; } | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.system_id = ? AND w.type <> 'EPIC' AND st.category <> 'DONE'
         AND (w.sprint_id IS NULL OR w.sprint_id NOT IN (SELECT id FROM sprints WHERE state <> 'CLOSED'))${v.sql}`,
          )
          .bind(p.id, ...v.args)
          .first()
      )
    );
    const recent = closed.results.map((r) => ({ name: r.name, committed: Number(r.committed_points), completed: Number(r.completed_points) }));
    return json({
      mode: p.agile_mode,
      sprints: sprints.results.map((s) => {
        const mine = items.results.filter((r) => r.sprint_id === s.id);
        return {
          ...toSprint(s),
          items: mine.map(toSummary),
          points: mine.reduce((n, r) => n + pts(r), 0),
          donePoints: mine.filter((r) => r.status_category === "DONE").reduce((n, r) => n + pts(r), 0),
        };
      }),
      backlog: inBacklog.slice(0, BACKLOG_LIMIT).map(toSummary),
      backlogTotal: Number(backlogCount?.n ?? 0),
      velocity: { average: averageVelocity(recent.map((r) => ({ completedPoints: r.completed }))), recent },
      canPlan: mayPlan(c),
    });
  }
  // Ranks items and moves them in or out of a sprint: { system, keys, target: "backlog" | sprintId, before? }
  if (path === "/api/backlog/rank" && method === "POST") {
    if (c.guest || !(c.can("manage_sprints") || c.can("edit_work_items"))) throw new HttpError(403, "You don't have permission to rank the backlog");
    const b = await /** @type {Promise<{ system?: unknown; keys?: unknown; target?: unknown; before?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const p = await projectOf(c, String(b.system ?? ""));
    const rows = await itemsByKeys(c, p.id, b.keys);
    const targetId = b.target === undefined || b.target === "backlog" ? null : String(b.target);
    /** @type {SprintRow | null} */ let target = null;
    if (targetId) {
      target = await getSprint(c, targetId);
      if (target.system_id !== p.id) throw new HttpError(400, "That sprint is in another project");
      if (target.state === "CLOSED") throw new HttpError(400, "That sprint has finished");
    }
    const changesSprint = rows.some((r) => (r.sprint_id ?? null) !== targetId && (targetId !== null || r.sprint_id !== null));
    if (changesSprint) needPlan(c);
    if (rows.some((r) => r.type === "EPIC")) throw new HttpError(400, "Epics stay out of sprints; plan their stories, tasks and bugs");
    // New ranks: just above `before`, or after everything, spaced evenly.
    /** @type {number} */ let lo;
    /** @type {number} */ let hi;
    if (b.before) {
      const before = (await itemsByKeys(c, p.id, [b.before]))[0];
      const prev = await /** @type {Promise<{ r: number | null; } | null>} */ (
        /** @type {unknown} */ (
          db
            .prepare("SELECT MAX(backlog_rank) AS r FROM work_items WHERE system_id = ? AND backlog_rank < ? AND id NOT IN (" + rows.map(() => "?").join(", ") + ")")
            .bind(p.id, before.backlog_rank ?? 0, ...rows.map((r) => r.id))
            .first()
        )
      );
      hi = Number(before.backlog_rank ?? 0);
      lo = prev?.r != null ? Number(prev.r) : hi - 1024;
    } else {
      const max = await /** @type {Promise<{ r: number | null; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT MAX(backlog_rank) AS r FROM work_items WHERE system_id = ?").bind(p.id).first()));
      lo = Number(max?.r ?? 0);
      hi = lo + 1024 * (rows.length + 1);
    }
    const step = (hi - lo) / (rows.length + 1);
    await db.batch(rows.map((r, i) => db.prepare("UPDATE work_items SET backlog_rank = ? WHERE id = ?").bind(lo + step * (i + 1), r.id)));
    await moveIntoSprint(c, rows, target);
    await c.audit(changesSprint ? "sprint_scope_changed" : "backlog_ranked", p.id, {
      name: p.name,
      keys: rows.map(keyOf),
      ...(changesSprint ? { from: [...new Set(rows.map((r) => r.sprint_id ?? "backlog"))], to: target?.name ?? "backlog" } : {}),
      ...(b.before ? { before: String(b.before) } : {}),
    });
    return json({ ok: true });
  }
  if (path === "/api/sprints" && method === "POST") {
    needPlan(c);
    const b = await /** @type {Promise<{ systemId?: unknown; name?: unknown; goal?: unknown; startDate?: unknown; lengthWeeks?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const p = await projectOf(c, String(b.systemId ?? ""));
    if (p.agile_mode !== "scrum") throw new HttpError(400, "Turn on sprints for this project first");
    const weeks = checkWeeks(b.lengthWeeks);
    const latest = await /** @type {Promise<{ d: string | null; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT MAX(end_date) AS d FROM sprints WHERE system_id = ?").bind(p.id).first()));
    const start = b.startDate ? checkDate(b.startDate, "Start date") : latest?.d ? new Date(Date.parse(latest.d) + 86_400_000).toISOString().slice(0, 10) : c.now.slice(0, 10);
    const count = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM sprints WHERE system_id = ?").bind(p.id).first()));
    const name =
      String(b.name ?? "")
        .trim()
        .slice(0, 80) || `${p.key} Sprint ${Number(count?.n ?? 0) + 1}`;
    const goal = String(b.goal ?? "")
      .trim()
      .slice(0, 500);
    const id = newToken().slice(0, 16);
    await db.prepare("INSERT INTO sprints (id, system_id, name, goal, start_date, end_date, length_weeks, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'FUTURE', ?, ?)").bind(id, p.id, name, goal, start, sprintEnd(start, weeks), weeks, c.me.id, c.now).run();
    await c.audit("sprint_created", p.id, { name: p.name, sprint: name, goal, start, weeks });
    return json(toSprint(await getSprint(c, id)), 201);
  }
  let m = path.match(/^\/api\/sprints\/([a-z0-9-]{4,40})$/);
  if (m && method === "PATCH") {
    needPlan(c);
    const s = await getSprint(c, m[1]);
    if (s.state === "CLOSED") throw new HttpError(400, "That sprint has finished");
    const b = await /** @type {Promise<{ name?: unknown; goal?: unknown; startDate?: unknown; lengthWeeks?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) : s.name;
    if (!name) throw new HttpError(400, "A sprint needs a name");
    const goal = b.goal !== undefined ? String(b.goal).trim().slice(0, 500) : s.goal;
    const start = b.startDate !== undefined ? checkDate(b.startDate, "Start date") : s.start_date;
    const weeks = b.lengthWeeks !== undefined ? checkWeeks(b.lengthWeeks) : Number(s.length_weeks);
    const end = sprintEnd(start, weeks);
    await db.prepare("UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ?, length_weeks = ? WHERE id = ?").bind(name, goal, start, end, weeks, s.id).run();
    const p = await projectOf(c, s.system_id);
    await c.audit("sprint_updated", p.id, {
      name: p.name,
      sprint: name,
      from: { name: s.name, goal: s.goal, start: s.start_date, end: s.end_date },
      to: { name, goal, start, end },
    });
    return json(toSprint(await getSprint(c, s.id)));
  }
  if (m && method === "DELETE") {
    needPlan(c);
    const s = await getSprint(c, m[1]);
    if (s.state !== "FUTURE") throw new HttpError(400, "Only a sprint that hasn't started can be deleted");
    const n = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE sprint_id = ?").bind(s.id).first()));
    await db.batch([db.prepare("UPDATE work_items SET sprint_id = NULL WHERE sprint_id = ?").bind(s.id), db.prepare("DELETE FROM sprints WHERE id = ?").bind(s.id)]);
    const p = await projectOf(c, s.system_id);
    await c.audit("sprint_deleted", p.id, { name: p.name, sprint: s.name, itemsToBacklog: Number(n?.n ?? 0) });
    return json({ ok: true });
  }
  m = path.match(/^\/api\/sprints\/([a-z0-9-]{4,40})\/start$/);
  if (m && method === "POST") {
    needPlan(c);
    const s = await getSprint(c, m[1]);
    if (s.state !== "FUTURE") throw new HttpError(400, "That sprint has already started");
    const p = await projectOf(c, s.system_id);
    if (p.agile_mode !== "scrum") throw new HttpError(400, "Turn on sprints for this project first");
    if (await db.prepare("SELECT 1 FROM sprints WHERE system_id = ? AND state = 'ACTIVE'").bind(p.id).first()) {
      throw new HttpError(409, "Another sprint is running. Complete it before starting this one.");
    }
    const b = await /** @type {Promise<{ startDate?: unknown; lengthWeeks?: unknown; }>} */ (/** @type {unknown} */ (body(req))).catch(() => /** @type {{ startDate?: unknown; lengthWeeks?: unknown }} */ ({}));
    const start = b.startDate ? checkDate(b.startDate, "Start date") : c.now.slice(0, 10);
    const weeks = b.lengthWeeks !== undefined ? checkWeeks(b.lengthWeeks) : Number(s.length_weeks);
    // The commitment: everything in it now, at its story points now.
    await db.batch([
      db.prepare("UPDATE sprints SET state = 'ACTIVE', started_at = ?, start_date = ?, end_date = ?, length_weeks = ? WHERE id = ?").bind(c.now, start, sprintEnd(start, weeks), weeks, s.id),
      db
        .prepare(
          `INSERT INTO sprint_items (sprint_id, item_id, added_at, added_after_start, points)
           SELECT ?, w.id, ?, 0, w.story_points FROM work_items w WHERE w.sprint_id = ?
           ON CONFLICT (sprint_id, item_id) DO UPDATE SET added_at = excluded.added_at, added_after_start = 0, points = excluded.points, removed_at = NULL, outcome = NULL`,
        )
        .bind(s.id, c.now, s.id),
    ]);
    const people = await /** @type {Promise<D1Result<{ assignee: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT DISTINCT assignee FROM work_items WHERE sprint_id = ? AND assignee IS NOT NULL").bind(s.id).all()));
    c.alert(
      people.results.map((x) => ({
        userId: x.assignee,
        kind: /** @type {const} */ ("sprint"),
        title: `${s.name} has started on ${p.name}`,
        body: `${s.goal ? `Goal: ${s.goal}. ` : ""}It ends on ${sprintEnd(start, weeks)}.`,
        link: `#/projects/${p.id}/board`,
      })),
    );
    await c.audit("sprint_started", p.id, { name: p.name, sprint: s.name, start, end: sprintEnd(start, weeks), goal: s.goal });
    c.emit?.({ type: "sprint_started", sprintId: s.id, systemId: p.id });
    return json(toSprint(await getSprint(c, s.id)));
  }
  m = path.match(/^\/api\/sprints\/([a-z0-9-]{4,40})\/complete$/);
  if (m && method === "POST") {
    needPlan(c);
    const s = await getSprint(c, m[1]);
    if (s.state !== "ACTIVE") throw new HttpError(400, "Only the running sprint can be completed");
    const p = await projectOf(c, s.system_id);
    const b = await /** @type {Promise<{ moveTo?: unknown; }>} */ (/** @type {unknown} */ (body(req))).catch(() => /** @type {{ moveTo?: unknown }} */ ({}));
    const [members, current] = await Promise.all([
      /** @type {Promise<D1Result<{ item_id: string; added_after_start: number; points: number | null; removed_at: string | null; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT item_id, added_after_start, points, removed_at FROM sprint_items WHERE sprint_id = ?").bind(s.id).all())),
      /** @type {Promise<D1Result<{ id: string; story_points: number | null; category: StatusCategory; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT w.id, w.story_points, st.category FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.sprint_id = ?").bind(s.id).all())),
    ]);
    const sum = /** @param {{ points: number | null }[]} list */ (list) => list.reduce((n, x) => n + (x.points == null ? 0 : Number(x.points)), 0);
    const done = current.results.filter((x) => x.category === "DONE");
    const notDone = current.results.filter((x) => x.category !== "DONE");
    /** @type {SprintSnapshot} */ const snap = {
      committedPoints: sum(members.results.filter((x) => !x.added_after_start)),
      completedPoints: done.reduce((n, x) => n + (x.story_points == null ? 0 : Number(x.story_points)), 0),
      addedPoints: sum(members.results.filter((x) => x.added_after_start)),
      removedPoints: sum(members.results.filter((x) => x.removed_at)),
      notCompletedPoints: notDone.reduce((n, x) => n + (x.story_points == null ? 0 : Number(x.story_points)), 0),
      committedItems: members.results.filter((x) => !x.added_after_start).length,
      completedItems: done.length,
      addedItems: members.results.filter((x) => x.added_after_start).length,
      removedItems: members.results.filter((x) => x.removed_at).length,
      notCompletedItems: notDone.length,
    };
    // Unfinished work goes to the backlog, a chosen future sprint, or the next one (made if there isn't one).
    /** @type {SprintRow | null} */ let target = null;
    if (b.moveTo && b.moveTo !== "backlog") {
      if (b.moveTo === "next") {
        target = await /** @type {Promise<SprintRow | null>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM sprints WHERE system_id = ? AND state = 'FUTURE' ORDER BY start_date, created_at LIMIT 1").bind(p.id).first()));
        if (!target) {
          const id = newToken().slice(0, 16);
          const start = new Date(Math.max(Date.parse(s.end_date), Date.parse(c.now.slice(0, 10))) + 86_400_000).toISOString().slice(0, 10);
          const count = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM sprints WHERE system_id = ?").bind(p.id).first()));
          await db
            .prepare("INSERT INTO sprints (id, system_id, name, goal, start_date, end_date, length_weeks, state, created_by, created_at) VALUES (?, ?, ?, '', ?, ?, ?, 'FUTURE', ?, ?)")
            .bind(id, p.id, `${p.key} Sprint ${Number(count?.n ?? 0) + 1}`, start, sprintEnd(start, Number(s.length_weeks)), s.length_weeks, c.me.id, c.now)
            .run();
          target = await getSprint(c, id);
        }
      } else {
        target = await getSprint(c, String(b.moveTo));
        if (target.system_id !== p.id || target.state !== "FUTURE") throw new HttpError(400, "Unfinished work can move to the backlog or a sprint that hasn't started");
      }
    }
    /** @type {D1PreparedStatement[]} */ const stmts = [
      db.prepare("UPDATE sprints SET state = 'CLOSED', completed_at = ? WHERE id = ?").bind(c.now, s.id),
      db
        .prepare(
          `INSERT INTO sprint_snapshots (sprint_id, committed_points, completed_points, added_points, removed_points, not_completed_points,
             committed_items, completed_items, added_items, removed_items, not_completed_items, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(s.id, snap.committedPoints, snap.completedPoints, snap.addedPoints, snap.removedPoints, snap.notCompletedPoints, snap.committedItems, snap.completedItems, snap.addedItems, snap.removedItems, snap.notCompletedItems, c.now),
      ...done.map((x) => db.prepare("UPDATE sprint_items SET outcome = 'completed' WHERE sprint_id = ? AND item_id = ?").bind(s.id, x.id)),
      ...notDone.map((x) => db.prepare("UPDATE sprint_items SET outcome = 'not_completed' WHERE sprint_id = ? AND item_id = ?").bind(s.id, x.id)),
    ];
    if (target) {
      for (const x of notDone) {
        stmts.push(
          db
            .prepare(
              `INSERT INTO sprint_items (sprint_id, item_id, added_at, added_after_start, points) VALUES (?, ?, ?, 0, ?)
               ON CONFLICT (sprint_id, item_id) DO UPDATE SET removed_at = NULL, outcome = NULL`,
            )
            .bind(target.id, x.id, c.now, x.story_points),
        );
      }
    }
    stmts.push(db.prepare("UPDATE work_items SET sprint_id = ? WHERE sprint_id = ? AND id IN (SELECT w.id FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.sprint_id = ? AND st.category <> 'DONE')").bind(target?.id ?? null, s.id, s.id));
    await db.batch(stmts);
    await c.audit("sprint_completed", p.id, { name: p.name, sprint: s.name, ...snap, unfinishedTo: target?.name ?? "backlog" });
    c.emit?.({ type: "sprint_completed", sprintId: s.id, systemId: p.id });
    return json({ sprint: toSprint(await getSprint(c, s.id), await /** @type {Promise<SnapRow | null>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM sprint_snapshots WHERE sprint_id = ?").bind(s.id).first()))), movedTo: target ? toSprint(target) : null });
  }
  // ----- the timeline -----
  if (path === "/api/timeline" && method === "GET") {
    const system = q.get("system");
    const workspace = q.get("workspace");
    const v = vis(c);
    const projects = await /** @type {Promise<D1Result<{ id: string; key: string; name: string; started: string | null; due: string | null; finished: string | null; status: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT s.id, s.key, (s.data::json ->> 'name') AS name, (s.data::json ->> 'startedAt') AS started, (s.data::json ->> 'dueAt') AS due,
           (s.data::json ->> 'finishedAt') AS finished, (s.data::json ->> 'status') AS status
         FROM systems s WHERE ${system ? "s.id = ?" : "(s.data::json ->> 'workspace') = ? AND (s.data::json ->> 'status') <> 'IDEA'"} ORDER BY s.sort, s.rowid`,
          )
          .bind(system ?? workspace ?? "")
          .all()
      )
    );
    if (system && !projects.results.length) throw new HttpError(404, "Project not found");
    if (!system && !workspace) throw new HttpError(400, "Say which project or workspace");
    const ids = projects.results.map((p) => p.id);
    const items = ids.length
      ? await /** @type {Promise<D1Result<ItemRow>>} */ (
          /** @type {unknown} */ (
            db
              .prepare(
                `${SELECT} WHERE w.system_id IN (${ids.map(() => "?").join(", ")}) AND w.type <> 'SUBTASK'${system ? "" : " AND w.type = 'EPIC'"}${v.sql}
             ORDER BY w.start_date NULLS LAST, w.number`,
              )
              .bind(...ids, ...v.args)
              .all()
          )
        )
      : { results: /** @type {ItemRow[]} */ ([]) };
    const editable = /** @param {ItemRow} r */ (r) => !c.guest && (c.can("edit_work_items") || r.assignee === c.me.id || (r.reporter === c.me.id && c.can("create_work_items")) || (r.source === "client_request" && c.can("manage_features")));
    const bar = /** @param {ItemRow} r @returns {TimelineBar} */ (r) => ({
      key: keyOf(r),
      id: r.id,
      systemId: r.system_id,
      summary: r.summary,
      type: r.type,
      statusName: r.status_name,
      statusCategory: r.status_category,
      ...(r.assignee ? { assignee: r.assignee } : {}),
      start: r.start_date,
      end: r.due_date,
      canEdit: editable(r),
    });
    /** @type {TimelineProject[]} */ const out = projects.results.map((p) => {
      const mine = items.results.filter((r) => r.system_id === p.id);
      const epics = mine
        .filter((r) => r.type === "EPIC")
        .map((e) => {
          const children = mine.filter((r) => r.parent_id === e.id).map(bar);
          const b = bar(e);
          // An epic without dates spans its children's.
          if (!b.start || !b.end) {
            const starts = children
              .map((x) => x.start)
              .filter(/** @returns {x is string} */ (x) => !!x)
              .sort();
            const ends = children
              .map((x) => x.end)
              .filter(/** @returns {x is string} */ (x) => !!x)
              .sort();
            if (!b.start && starts.length) Object.assign(b, { start: starts[0], derived: true });
            if (!b.end && ends.length) Object.assign(b, { end: ends[ends.length - 1], derived: true });
          }
          return { ...b, children };
        });
      const loose = mine.filter((r) => r.type !== "EPIC" && !mine.some((e) => e.id === r.parent_id && e.type === "EPIC") && (r.start_date || r.due_date)).map(bar);
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        start: p.started ? p.started.slice(0, 10) : null,
        end: (p.finished ?? p.due)?.slice(0, 10) ?? null,
        canEdit: !c.guest && c.can("manage_systems"),
        epics,
        loose,
      };
    });
    // "Blocks" links between the items shown, with a warning when the blocker ends after the blocked one starts.
    const shown = items.results;
    const byId = new Map(shown.map((r) => [r.id, r]));
    const linkRows = shown.length
      ? await /** @type {Promise<D1Result<{ id: string; from_id: string; to_id: string; }>>} */ (
          /** @type {unknown} */ (
            db
              .prepare(`SELECT id, from_id, to_id FROM work_item_links WHERE link_type = 'BLOCKS' AND from_id IN (${shown.map(() => "?").join(", ")})`)
              .bind(...shown.map((r) => r.id))
              .all()
          )
        )
      : { results: [] };
    /** @type {TimelineLink[]} */ const links = linkRows.results
      .filter((l) => byId.has(l.to_id))
      .map((l) => {
        const a = /** @type {ItemRow} */ (byId.get(l.from_id));
        const b = /** @type {ItemRow} */ (byId.get(l.to_id));
        const warn = a.due_date && b.start_date && a.due_date > b.start_date;
        return {
          id: l.id,
          from: keyOf(a),
          to: keyOf(b),
          ...(warn ? { warning: `${keyOf(a)} ends on ${a.due_date}, after ${keyOf(b)} starts on ${b.start_date}` } : {}),
        };
      });
    return json({ projects: out, links });
  }
  // ----- agile reports -----
  if (path === "/api/reports/agile/sprints" && method === "GET") {
    const p = await projectOf(c, String(q.get("system") ?? ""));
    const rows = await /** @type {Promise<D1Result<SprintRow & SnapRow>>} */ (/** @type {unknown} */ (db.prepare("SELECT sp.*, ss.* FROM sprints sp LEFT JOIN sprint_snapshots ss ON ss.sprint_id = sp.id WHERE sp.system_id = ? ORDER BY sp.start_date DESC, sp.created_at DESC").bind(p.id).all()));
    return json({ mode: p.agile_mode, sprints: rows.results.map((r) => toSprint(r, r.committed_points != null ? r : null)) });
  }
  if (path === "/api/reports/agile/burndown" && method === "GET") {
    const s = await getSprint(c, String(q.get("sprint") ?? ""));
    if (s.state === "FUTURE") throw new HttpError(400, "That sprint hasn't started");
    const v = vis(c);
    const members = await /** @type {Promise<D1Result<{ item_id: string; added_at: string; added_after_start: number; removed_at: string | null; story_points: number | null; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT si.item_id, si.added_at, si.added_after_start, si.removed_at, w.story_points FROM sprint_items si JOIN work_items w ON w.id = si.item_id
         WHERE si.sprint_id = ?${v.sql}`,
          )
          .bind(s.id, ...v.args)
          .all()
      )
    );
    const statuses = new Map((await statusCatalogue(db)).map((x) => [x.id, x.category]));
    const history = await statusReplay(
      c,
      members.results.map((x) => x.item_id),
    );
    // Story points; a sprint with none at all is counted in items instead.
    const usePoints = members.results.some((x) => x.story_points != null && Number(x.story_points) > 0);
    const value = /** @param {{ story_points: number | null }} x */ (x) => (usePoints ? (x.story_points == null ? 0 : Number(x.story_points)) : 1);
    const last = s.state === "CLOSED" ? (s.completed_at ?? s.end_date).slice(0, 10) : [c.now.slice(0, 10), s.end_date].sort()[0];
    const days = daysFrom(s.start_date, s.end_date);
    const committed = members.results.filter((x) => !x.added_after_start).reduce((n, x) => n + value(x), 0);
    const series = days.map((d) => {
      if (d > last) return null;
      const e = endOf(d);
      const inScope = members.results.filter((x) => (x.added_after_start ? x.added_at <= e : true) && !(x.removed_at && x.removed_at <= e));
      const done = inScope.filter((x) => statuses.get(statusAt(history.get(x.item_id), e) ?? "") === "DONE");
      const scope = inScope.reduce((n, x) => n + value(x), 0);
      const completed = done.reduce((n, x) => n + value(x), 0);
      return { scope, completed, remaining: scope - completed };
    });
    return json({
      sprint: toSprint(s),
      unit: usePoints ? "points" : "items",
      days,
      scope: series.map((x) => x?.scope ?? null),
      completed: series.map((x) => x?.completed ?? null),
      remaining: series.map((x) => x?.remaining ?? null),
      ideal: days.map((_, i) => Math.round((committed - (committed * i) / Math.max(1, days.length - 1)) * 10) / 10),
    });
  }
  if (path === "/api/reports/agile/sprint" && method === "GET") {
    const s = await getSprint(c, String(q.get("sprint") ?? ""));
    const v = vis(c);
    const rows = await /** @type {Promise<D1Result<ItemRow & { added_after_start: number; removed_at: string | null; outcome: string | null; points_then: number | null; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT x.*, si.added_after_start, si.removed_at, si.outcome, si.points AS points_then FROM sprint_items si JOIN (${SELECT}) x ON x.id = si.item_id
         WHERE si.sprint_id = ?${v.sql.replace(/w\./g, "x.")} ORDER BY x.number`,
          )
          .bind(s.id, ...v.args)
          .all()
      )
    );
    const row = /** @param {(typeof rows.results)[number]} r */ (r) => ({ ...toSummary(r), pointsThen: r.points_then == null ? null : Number(r.points_then) });
    const live = rows.results.filter((r) => !r.removed_at);
    return json({
      sprint: toSprint(s, await /** @type {Promise<SnapRow | null>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM sprint_snapshots WHERE sprint_id = ?").bind(s.id).first()))),
      completed: live.filter((r) => (r.outcome ? r.outcome === "completed" : r.status_category === "DONE")).map(row),
      notCompleted: live.filter((r) => (r.outcome ? r.outcome === "not_completed" : r.status_category !== "DONE")).map(row),
      added: rows.results.filter((r) => r.added_after_start).map(row),
      removed: rows.results.filter((r) => r.removed_at).map(row),
    });
  }
  if (path === "/api/reports/agile/flow" && method === "GET") {
    const scope = reportScope(q);
    const span = Math.min(365, Math.max(14, Number(q.get("days")) || 90));
    const v = vis(c);
    const items = await /** @type {Promise<D1Result<{ id: string; created_at: string; resolved_at: string | null; status: string; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT w.id, w.created_at, w.resolved_at, w.status FROM work_items w JOIN systems s ON s.id = w.system_id
         WHERE ${scope.sql} AND w.type <> 'EPIC'${v.sql}`,
          )
          .bind(...scope.args, ...v.args)
          .all()
      )
    );
    const today = c.now.slice(0, 10);
    const first = new Date(Date.parse(today) - (span - 1) * 86_400_000).toISOString().slice(0, 10);
    const days = daysFrom(first, today);
    const history = await statusReplay(
      c,
      items.results.map((x) => x.id),
    );
    const catalogue = await statusCatalogue(db);
    /** @type {Record<string, number[]>} */ const counts = Object.fromEntries(catalogue.map((st) => [st.id, days.map(() => 0)]));
    days.forEach((d, i) => {
      const e = endOf(d);
      for (const it of items.results) {
        if (it.created_at > e) continue;
        const st = statusAt(history.get(it.id), e) ?? it.status;
        if (counts[st]) counts[st][i]++;
      }
    });
    const created = days.map((d) => items.results.filter((x) => x.created_at.slice(0, 10) === d).length);
    const resolved = days.map((d) => items.results.filter((x) => x.resolved_at?.slice(0, 10) === d).length);
    return json({
      days,
      statuses: catalogue.filter((st) => counts[st.id].some((n) => n > 0)),
      counts,
      created,
      resolved,
    });
  }
  if (path === "/api/reports/agile/cycle" && method === "GET") {
    const scope = reportScope(q);
    const span = Math.min(365, Math.max(14, Number(q.get("days")) || 90));
    const since = new Date(Date.parse(c.now) - span * 86_400_000).toISOString();
    const v = vis(c);
    const rows = await /** @type {Promise<D1Result<{ id: string; number: number; project_key: string; summary: string; type: string; created_at: string; resolved_at: string; story_points: number | null; started_at: string | null; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT w.id, w.number, s.key AS project_key, w.summary, w.type, w.created_at, w.resolved_at, w.story_points,
           (SELECT MIN(h.changed_at) FROM status_history h JOIN work_statuses hs ON hs.id = h.to_status WHERE h.item_id = w.id AND hs.category = 'IN_PROGRESS') AS started_at
         FROM work_items w JOIN systems s ON s.id = w.system_id JOIN work_statuses st ON st.id = w.status
         WHERE ${scope.sql} AND w.type <> 'EPIC' AND st.category = 'DONE' AND COALESCE(w.resolution, 'DONE') <> 'WONT_DO' AND w.resolved_at >= ?${v.sql}
         ORDER BY w.resolved_at`,
          )
          .bind(...scope.args, since, ...v.args)
          .all()
      )
    );
    const d = /** @param {string} a @param {string} b */ (a, b) => Math.max(0, Math.round(((Date.parse(b) - Date.parse(a)) / 86_400_000) * 10) / 10);
    return json({
      items: rows.results.map((r) => ({
        key: `${r.project_key}-${r.number}`,
        summary: r.summary,
        type: r.type,
        created: r.created_at,
        started: r.started_at,
        resolved: r.resolved_at,
        leadDays: d(r.created_at, r.resolved_at),
        cycleDays: r.started_at ? d(r.started_at, r.resolved_at) : null,
      })),
    });
  }
  throw new HttpError(404, "Not found");
}
/**
 * Each running sprint's health, as this person may see it: for Ask AI and the Monday Briefing.
 * @param {D1Database} db
 * @param {number} now
 * @param {Viewer} [viewer=PUBLIC_VIEWER]
 * @returns {Promise<{ sprintId: string; systemId: string; project: string; name: string; goal: string; endDate: string; daysLeft: number; committed: number; scope: number; done: number; behind: boolean; }[]>}
 */
export async function sprintHealth(db, now, viewer = PUBLIC_VIEWER) {
  // Counted from the items this viewer may see. With no viewer (the Monday Briefing, which goes to many
  // people), items with a security level are left out.
  const a = itemAccess(viewer);
  const rows = await /** @type {Promise<D1Result<{ id: string; name: string; goal: string; start_date: string; end_date: string; system_id: string; project: string; committed: number; scope: number; done: number; items: number; }>>} */ (
    /** @type {unknown} */ (
      db
        .prepare(
          `SELECT sp.id, sp.name, sp.goal, sp.start_date, sp.end_date, sp.system_id, (s.data::json ->> 'name') AS project,
         (SELECT COALESCE(SUM(si.points), 0) FROM sprint_items si JOIN work_items w ON w.id = si.item_id
            WHERE si.sprint_id = sp.id AND si.added_after_start = 0 AND ${a.sql}) AS committed,
         (SELECT COALESCE(SUM(w.story_points), 0) FROM work_items w WHERE w.sprint_id = sp.id AND ${a.sql}) AS scope,
         (SELECT COALESCE(SUM(w.story_points), 0) FROM work_items w JOIN work_statuses st ON st.id = w.status
            WHERE w.sprint_id = sp.id AND st.category = 'DONE' AND ${a.sql}) AS done,
         (SELECT COUNT(*) FROM work_items w WHERE w.sprint_id = sp.id AND ${a.sql}) AS items
       FROM sprints sp JOIN systems s ON s.id = sp.system_id WHERE sp.state = 'ACTIVE' ORDER BY sp.end_date`,
        )
        .bind(...a.args, ...a.args, ...a.args, ...a.args)
        .all()
    )
  );
  return rows.results
    .filter((r) => !viewer.ownOnly || Number(r.items) > 0)
    .map((r) => {
      const total = Math.max(1, Date.parse(r.end_date) - Date.parse(r.start_date) + 86_400_000);
      const elapsed = Math.min(1, Math.max(0, (now - Date.parse(r.start_date)) / total));
      const scope = Number(r.scope);
      const done = Number(r.done);
      const behind = scope > 0 && done / scope < elapsed - 0.2;
      return {
        sprintId: r.id,
        systemId: r.system_id,
        project: r.project,
        name: r.name,
        goal: r.goal,
        endDate: r.end_date,
        daysLeft: daysLeft(r.end_date, now),
        committed: Number(r.committed),
        scope,
        done,
        behind,
      };
    });
}
/** @typedef {Record<string, number | string>} SnapRow */
/**
 * @typedef {Object} SprintRow
 * @property {string} id
 * @property {string} system_id
 * @property {string} name
 * @property {string} goal
 * @property {string} start_date
 * @property {string} end_date
 * @property {number} length_weeks
 * @property {Sprint["state"]} state
 * @property {string | null} started_at
 * @property {string | null} completed_at
 */
