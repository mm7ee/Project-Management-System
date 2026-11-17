// Boards (Kanban): one per project, and one per workspace across its projects. Columns show one or
// more statuses and may have a work-in-progress limit. Moving a card is a workflow move, made through
// /api/items/:key/transitions; this file only reads boards and saves their layout.
//
// The cards follow the work item visibility rules (developers without manage_features see only their
// own), leave out epics (they show as swimlanes and on cards instead), and leave out items finished
// more than 14 days ago.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { toSummary, type ItemContext, type ItemRow } from "./workitems";
import { EFFECTIVE_WORKFLOW, loadWorkflows, statusCatalogue } from "./workflowData";
import { SWIMLANES, type Swimlanes } from "../src/data/workflows";
import type { StatusCategory } from "../src/data/workitems";

const DONE_DAYS = 14;
const MAX_CARDS = 400;

interface ColumnRow {
  id: string;
  name: string;
  position: number;
  wip_limit: number | null;
}

const SELECT = `SELECT w.*, st.name AS status_name, st.category AS status_category,
  s.key AS project_key, (s.data::json ->> 'name') AS project_name, p.number AS parent_number, p.type AS parent_type, p.parent_id AS grandparent_id,
  (SELECT string_agg(l.label, ',' ORDER BY l.label) FROM work_item_labels l WHERE l.item_id = w.id) AS labels,
  (SELECT COUNT(*) FROM work_items c WHERE c.parent_id = w.id AND COALESCE(c.resolution, '') <> 'WONT_DO') AS child_total,
  (SELECT COUNT(*) FROM work_items c JOIN work_statuses cs ON cs.id = c.status
     WHERE c.parent_id = w.id AND cs.category = 'DONE' AND COALESCE(c.resolution, '') <> 'WONT_DO') AS child_done,
  EXISTS (SELECT 1 FROM work_item_links k JOIN work_items bw ON bw.id = k.from_id JOIN work_statuses bs ON bs.id = bw.status
     WHERE k.to_id = w.id AND k.link_type = 'BLOCKS' AND bs.category <> 'DONE') AS blocked_by_link
  FROM work_items w
  JOIN work_statuses st ON st.id = w.status
  JOIN systems s ON s.id = w.system_id
  LEFT JOIN work_items p ON p.id = w.parent_id`;

type CardRow = ItemRow & { parent_type: string | null; grandparent_id: string | null; blocked_by_link: boolean };

/** The board for a project or a workspace, made with sensible columns the first time it's opened. */
async function ensureBoard(c: ItemContext, scope: { systemId?: string; workspace?: string }) {
  const db = c.db;
  const where = scope.systemId ? "system_id = ?" : "workspace = ?";
  const key = scope.systemId ?? scope.workspace!;
  const found = await db.prepare(`SELECT * FROM boards WHERE ${where}`).bind(key).first<{ id: string; name: string; swimlanes: Swimlanes; system_id: string | null; workspace: string | null }>();
  if (found) return found;
  const id = newToken().slice(0, 16);
  const stmts: D1PreparedStatement[] = [];
  let name: string;
  // A project's board: a column per status of its workflow. A workspace's: To Do, In Progress, Done.
  let columns: { name: string; statuses: string[] }[];
  if (scope.systemId) {
    const sys = await db.prepare(`SELECT (s.data::json ->> 'name') AS name, ${EFFECTIVE_WORKFLOW} AS wf FROM systems s WHERE s.id = ?`).bind(scope.systemId).first<{ name: string; wf: string }>();
    if (!sys) throw new HttpError(404, "System not found");
    const [wf] = await loadWorkflows(db, [sys.wf]);
    const names = new Map((await statusCatalogue(db)).map((s) => [s.id, s.name]));
    name = `${sys.name} board`;
    columns = wf.statuses.map((s) => ({ name: names.get(s.id) ?? s.id, statuses: [s.id] }));
  } else {
    const cats: [StatusCategory, string][] = [
      ["TODO", "To Do"],
      ["IN_PROGRESS", "In Progress"],
      ["DONE", "Done"],
    ];
    const all = await statusCatalogue(db);
    name = `${scope.workspace} board`;
    columns = cats.map(([cat, label]) => ({ name: label, statuses: all.filter((s) => s.category === cat).map((s) => s.id) }));
  }
  stmts.push(
    db
      .prepare("INSERT INTO boards (id, system_id, workspace, name, swimlanes, created_at, updated_at) VALUES (?, ?, ?, ?, 'none', ?, ?) ON CONFLICT DO NOTHING")
      .bind(id, scope.systemId ?? null, scope.workspace ?? null, name, c.now, c.now),
  );
  columns.forEach((col, i) => {
    const cid = newToken().slice(0, 16);
    stmts.push(db.prepare("INSERT INTO board_columns (id, board_id, name, position, wip_limit) SELECT ?, ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM boards WHERE id = ?)").bind(cid, id, col.name, i + 1, id));
    for (const st of col.statuses) {
      stmts.push(
        db.prepare("INSERT INTO board_column_statuses (board_id, column_id, status_id) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM board_columns WHERE id = ?) ON CONFLICT DO NOTHING").bind(id, cid, st, cid),
      );
    }
  });
  await db.batch(stmts);
  // Two people opening a new board at once: whichever was made first is the board.
  return (await db.prepare(`SELECT * FROM boards WHERE ${where}`).bind(key).first<{ id: string; name: string; swimlanes: Swimlanes; system_id: string | null; workspace: string | null }>())!;
}

async function columnsOf(db: D1Database, boardId: string) {
  const [cols, maps] = await Promise.all([
    db.prepare("SELECT id, name, position, wip_limit FROM board_columns WHERE board_id = ? ORDER BY position").bind(boardId).all<ColumnRow>(),
    db.prepare("SELECT column_id, status_id FROM board_column_statuses WHERE board_id = ?").bind(boardId).all<{ column_id: string; status_id: string }>(),
  ]);
  return cols.results.map((col) => ({
    id: col.id,
    name: col.name,
    wipLimit: col.wip_limit,
    statuses: maps.results.filter((m) => m.column_id === col.id).map((m) => m.status_id),
  }));
}

/** Items per status in a board's scope, as this person may see them (epics left out). */
async function statusCounts(c: ItemContext, scopeSql: string, scopeArgs: unknown[]) {
  const vis = c.ownOnly ? { sql: " AND (w.assignee = ? OR w.reporter = ?)", args: [c.me.id, c.me.id] } : { sql: "", args: [] };
  const rows = await c.db
    .prepare(`SELECT w.status, COUNT(*) AS n FROM work_items w JOIN systems s ON s.id = w.system_id WHERE ${scopeSql} AND w.type <> 'EPIC'${vis.sql} GROUP BY w.status`)
    .bind(...scopeArgs, ...vis.args)
    .all<{ status: string; n: number }>();
  return new Map(rows.results.map((r) => [r.status, Number(r.n)]));
}

const scopeOf = (b: { system_id: string | null; workspace: string | null }) =>
  b.system_id ? { sql: "w.system_id = ?", args: [b.system_id] as unknown[] } : { sql: "(s.data::json ->> 'workspace') = ?", args: [b.workspace] as unknown[] };

export async function boardsApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/boards")) return null;
  const { db, req } = c;

  if (path === "/api/boards" && method === "GET") {
    const q = new URL(req.url).searchParams;
    const systemId = q.get("system");
    const workspace = q.get("workspace");
    if (!systemId && !workspace) throw new HttpError(400, "Say which project or workspace");
    if (systemId && !(await db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(systemId).first())) throw new HttpError(404, "System not found");
    if (c.guest && !(await db.prepare("SELECT 1 FROM boards WHERE system_id = ? OR workspace = ?").bind(systemId, workspace).first())) {
      // A view-only link changes nothing, not even by opening a board for the first time.
      return json({ board: null, cards: [], columns: [] });
    }
    const board = await ensureBoard(c, systemId ? { systemId } : { workspace: workspace!.slice(0, 60) });
    const scope = scopeOf(board);
    const where = [scope.sql, "w.type <> 'EPIC'", "(st.category <> 'DONE' OR w.updated_at >= ?)"];
    const args: unknown[] = [...scope.args, new Date(Date.parse(c.now) - DONE_DAYS * 86_400_000).toISOString()];
    if (c.ownOnly) {
      where.push("(w.assignee = ? OR w.reporter = ?)");
      args.push(c.me.id, c.me.id);
    }
    if (q.get("mine") === "1") {
      where.push("w.assignee = ?");
      args.push(c.me.id);
    }
    if (q.get("type")) {
      where.push("w.type = ?");
      args.push(q.get("type"));
    }
    if (q.get("due") === "week") {
      const today = c.now.slice(0, 10);
      where.push("w.due_date >= ? AND w.due_date <= ?");
      args.push(today, new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10));
    }
    if (q.get("label")) {
      where.push("EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label = ?)");
      args.push(String(q.get("label")).toLowerCase().slice(0, 40));
    }
    if (q.get("blocked") === "1") {
      where.push(
        "(w.on_hold = 1 OR EXISTS (SELECT 1 FROM work_item_links k JOIN work_items bw ON bw.id = k.from_id JOIN work_statuses bs ON bs.id = bw.status WHERE k.to_id = w.id AND k.link_type = 'BLOCKS' AND bs.category <> 'DONE'))",
      );
    }
    const [rows, columns, counts, statuses, projectWfs] = await Promise.all([
      db
        .prepare(
          `${SELECT} WHERE ${where.join(" AND ")}
           ORDER BY CASE w.priority WHEN 'HIGHEST' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END, w.due_date NULLS LAST, w.updated_at DESC
           LIMIT ?`,
        )
        .bind(...args, MAX_CARDS + 1)
        .all<CardRow>(),
      columnsOf(db, board.id),
      statusCounts(c, scope.sql, scope.args),
      statusCatalogue(db),
      db
        .prepare(`SELECT s.id, ${EFFECTIVE_WORKFLOW} AS wf FROM systems s WHERE ${board.system_id ? "s.id = ?" : "(s.data::json ->> 'workspace') = ?"}`)
        .bind(board.system_id ?? board.workspace)
        .all<{ id: string; wf: string }>(),
    ]);
    const cards = rows.results.slice(0, MAX_CARDS);
    // The epic each card belongs to: its parent, or its parent's parent for a sub-task.
    const epicIds = [...new Set(cards.map((r) => (r.parent_type === "EPIC" ? r.parent_id : r.grandparent_id)).filter((x): x is string => !!x))];
    const epics = epicIds.length
      ? (
          await db
            .prepare(`SELECT w.id, w.type, w.number, w.summary, s.key FROM work_items w JOIN systems s ON s.id = w.system_id WHERE w.id IN (${epicIds.map(() => "?").join(", ")})`)
            .bind(...epicIds)
            .all<{ id: string; type: string; number: number; summary: string; key: string }>()
        ).results.filter((e) => e.type === "EPIC")
      : [];
    const epicOf = new Map(epics.map((e) => [e.id, e]));
    const workflows = await loadWorkflows(db, [...new Set(projectWfs.results.map((p) => p.wf))]);
    const used = new Set(workflows.flatMap((w) => w.statuses.map((s) => s.id)));
    const mapped = new Set(columns.flatMap((col) => col.statuses));
    return json({
      board: { id: board.id, name: board.name, systemId: board.system_id, workspace: board.workspace, swimlanes: board.swimlanes, columns },
      statuses,
      workflows,
      projectWorkflow: Object.fromEntries(projectWfs.results.map((p) => [p.id, p.wf])),
      counts: Object.fromEntries(columns.map((col) => [col.id, col.statuses.reduce((n, st) => n + (counts.get(st) ?? 0), 0)])),
      unmapped: [...used].filter((st) => !mapped.has(st)),
      cards: cards.map((r) => {
        const epic = epicOf.get((r.parent_type === "EPIC" ? r.parent_id : r.grandparent_id) ?? "");
        return {
          ...toSummary(r),
          blocked: !!r.blocked_by_link || !!r.on_hold,
          ...(epic ? { epic: { key: `${epic.key}-${epic.number}`, summary: epic.summary } } : {}),
        };
      }),
      truncated: rows.results.length > MAX_CARDS,
      canConfigure: !c.guest && c.can("manage_systems"),
    });
  }

  // Every board with a work-in-progress limit, and how full each limited column is: for Settings.
  if (path === "/api/boards/wip" && method === "GET") {
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const boards = await db
      .prepare(
        `SELECT b.id, b.name, b.system_id, b.workspace FROM boards b
         WHERE EXISTS (SELECT 1 FROM board_columns bc WHERE bc.board_id = b.id AND bc.wip_limit IS NOT NULL) ORDER BY b.name`,
      )
      .all<{ id: string; name: string; system_id: string | null; workspace: string | null }>();
    const out = [];
    for (const b of boards.results) {
      const scope = scopeOf(b);
      const [cols, counts] = await Promise.all([columnsOf(db, b.id), statusCounts(c, scope.sql, scope.args)]);
      out.push({
        id: b.id,
        name: b.name,
        systemId: b.system_id,
        workspace: b.workspace,
        columns: cols
          .filter((col) => col.wipLimit)
          .map((col) => {
            const count = col.statuses.reduce((n, st) => n + (counts.get(st) ?? 0), 0);
            return { name: col.name, wipLimit: col.wipLimit, count, over: count > col.wipLimit! };
          }),
      });
    }
    return json({ boards: out });
  }

  const m = path.match(/^\/api\/boards\/([a-z0-9-]{4,40})$/);
  if (m && method === "PUT") {
    if (c.guest || !c.can("manage_systems")) throw new HttpError(403, "You don't have permission to change boards");
    const board = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(m[1]).first<{ id: string; name: string; swimlanes: Swimlanes }>();
    if (!board) throw new HttpError(404, "Board not found");
    const b = await body<{ name?: unknown; swimlanes?: unknown; columns?: { id?: string; name?: unknown; wipLimit?: unknown; statuses?: unknown }[] }>(req);
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) : board.name;
    if (!name) throw new HttpError(400, "A board needs a name");
    const swimlanes = b.swimlanes !== undefined ? (b.swimlanes as Swimlanes) : board.swimlanes;
    if (!SWIMLANES.includes(swimlanes)) throw new HttpError(400, "Unknown swimlanes");
    const before = await columnsOf(db, board.id);
    const known = new Set((await statusCatalogue(db)).map((s) => s.id));
    const cols = Array.isArray(b.columns) ? b.columns : null;
    const stmts: D1PreparedStatement[] = [db.prepare("UPDATE boards SET name = ?, swimlanes = ?, updated_at = ? WHERE id = ?").bind(name, swimlanes, c.now, board.id)];
    let after = before;
    if (cols) {
      if (!cols.length) throw new HttpError(400, "A board needs at least one column");
      if (cols.length > 12) throw new HttpError(400, "Up to 12 columns");
      const seen = new Set<string>();
      after = cols.map((col, i) => {
        const cname = String(col.name ?? "").trim().slice(0, 40);
        if (!cname) throw new HttpError(400, `Column ${i + 1} needs a name`);
        const limit = col.wipLimit === undefined || col.wipLimit === null || col.wipLimit === "" ? null : Number(col.wipLimit);
        if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 999)) throw new HttpError(400, `${cname}: a WIP limit is a whole number from 1 to 999`);
        const statuses = Array.isArray(col.statuses) ? col.statuses.map(String) : [];
        for (const st of statuses) {
          if (!known.has(st)) throw new HttpError(400, `Unknown status ${st}`);
          if (seen.has(st)) throw new HttpError(400, "A status can be in one column only");
          seen.add(st);
        }
        const keep = col.id && before.some((x) => x.id === col.id) ? col.id : newToken().slice(0, 16);
        return { id: keep, name: cname, wipLimit: limit, statuses };
      });
      stmts.push(db.prepare("DELETE FROM board_column_statuses WHERE board_id = ?").bind(board.id));
      const gone = before.filter((x) => !after.some((a) => a.id === x.id)).map((x) => x.id);
      if (gone.length) stmts.push(db.prepare(`DELETE FROM board_columns WHERE id IN (${gone.map(() => "?").join(", ")})`).bind(...gone));
      after.forEach((col, i) => {
        stmts.push(
          db
            .prepare("INSERT INTO board_columns (id, board_id, name, position, wip_limit) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, position = excluded.position, wip_limit = excluded.wip_limit")
            .bind(col.id, board.id, col.name, i + 1, col.wipLimit),
        );
        for (const st of col.statuses) stmts.push(db.prepare("INSERT INTO board_column_statuses (board_id, column_id, status_id) VALUES (?, ?, ?)").bind(board.id, col.id, st));
      });
    }
    await db.batch(stmts);
    const shape = (list: typeof before) => list.map((col) => `${col.name}${col.wipLimit ? ` (max ${col.wipLimit})` : ""}: ${col.statuses.join(", ") || "no statuses"}`);
    await c.audit("board_updated", (await db.prepare("SELECT system_id FROM boards WHERE id = ?").bind(board.id).first<{ system_id: string | null }>())?.system_id ?? null, {
      board: name,
      ...(name !== board.name ? { renamed: { from: board.name, to: name } } : {}),
      ...(swimlanes !== board.swimlanes ? { swimlanes: { from: board.swimlanes, to: swimlanes } } : {}),
      ...(cols ? { columns: { from: shape(before), to: shape(after) } } : {}),
    });
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found");
}

/** Ask Pulse: boards with work-in-progress limits, and the columns over them. Not for people who see only their own items. */
export async function askBoardLines(c: ItemContext): Promise<string[]> {
  if (c.ownOnly) return [];
  const boards = await c.db
    .prepare("SELECT b.id, b.name, b.system_id, b.workspace FROM boards b WHERE EXISTS (SELECT 1 FROM board_columns bc WHERE bc.board_id = b.id AND bc.wip_limit IS NOT NULL) ORDER BY b.name")
    .all<{ id: string; name: string; system_id: string | null; workspace: string | null }>();
  if (!boards.results.length) return [];
  const lines = ["", "BOARD WORK-IN-PROGRESS LIMITS (board | column | items now | limit | over the limit?)"];
  for (const b of boards.results.slice(0, 30)) {
    const scope = scopeOf(b);
    const [cols, counts] = await Promise.all([columnsOf(c.db, b.id), statusCounts(c, scope.sql, scope.args)]);
    for (const col of cols.filter((x) => x.wipLimit)) {
      const n = col.statuses.reduce((t, st) => t + (counts.get(st) ?? 0), 0);
      lines.push(`${b.name.replace(/\|/g, "/")} | ${col.name} | ${n} | ${col.wipLimit} | ${n > col.wipLimit! ? "yes" : "no"}`);
    }
  }
  return lines;
}
