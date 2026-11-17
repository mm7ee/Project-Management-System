// Work items: the API under /api/items, and the shared code that feature requests (/api/features)
// run on too. Every rule is checked here: who may see, create, edit, delete, comment and log time,
// the Epic → Story/Task/Bug → Sub-task hierarchy, statuses and their categories, and numbering.
//
// Visibility: developers without "manage_features" see only the items assigned to them or that
// they reported, everywhere (lists, item pages, links, Ask Pulse, notifications), as with feature
// requests. A view-only link reads items and comments but never attachments, and changes nothing.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import type { Alert } from "./notify";
import type { Permission, Role } from "../src/data/roles";
import { MAX_DOCUMENT_BYTES, formatBytes } from "../src/data/project";
import type { FeatureKind, FeatureStatus, Priority } from "../src/data/features";
import {
  ITEM_KEY_PATTERN,
  KIND_LABELS,
  LINK_META,
  LINK_TYPES,
  MAX_COMMENT,
  MAX_DESCRIPTION,
  MAX_LABELS,
  MAX_SUMMARY,
  PAGE_SIZE,
  RESOLUTION_META,
  TYPE_META,
  WORK_PRIORITIES,
  WORK_TYPES,
  childTypesOf,
  cleanLabel,
  formatMinutes,
  mentionsIn,
  parentProblem,
  type Attachment,
  type LinkType,
  type Resolution,
  type StatusChange,
  type WorkComment,
  type WorkItem,
  type WorkItemLink,
  type WorkItemSummary,
  type WorkItemType,
  type WorkLog,
  type WorkPriority,
  type ItemMove,
  type StatusCategory,
  type WorkSource,
  type WorkStatus,
} from "../src/data/workitems";
import { checkTransition, needsInput, transitionsFrom, type MoveInput, type Transition, type Workflow } from "../src/data/workflows";
import { initialStatus, loadWorkflow, workflowIdFor } from "./workflowData";

export interface ItemContext {
  db: D1Database;
  req: Request;
  me: { id: string; name: string; username: string; role: Role };
  guest: boolean;
  can: (p: Permission) => boolean;
  /** Developers without manage_features: only items assigned to them or that they reported. */
  ownOnly: boolean;
  now: string;
  audit: (action: string, target: string | null, detail: Record<string, unknown>) => Promise<void>;
  /** Raises alerts for others (never the person acting), without holding up the request. */
  alert: (alerts: Alert[]) => void;
}

export interface ItemRow {
  id: string;
  system_id: string;
  number: number;
  type: WorkItemType;
  parent_id: string | null;
  summary: string;
  description: string;
  status: WorkStatus;
  status_name: string;
  status_category: StatusCategory;
  resolution: Resolution | null;
  on_hold: number;
  priority: WorkPriority;
  assignee: string | null;
  reporter: string;
  component: string | null;
  story_points: number | null;
  original_estimate: number | null;
  remaining_estimate: number | null;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  source: WorkSource;
  client: string | null;
  notes: string | null;
  sprint_id: string | null;
  backlog_rank: number | null;
  // joined
  project_key: string;
  project_name: string;
  parent_number: number | null;
  labels: string | null;
  child_total: number;
  child_done: number;
}

/** Everything a list or page needs about an item, in one query. Cancelled ("won't do") children don't count. */
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

export const keyOf = (r: { project_key: string; number: number }) => `${r.project_key}-${r.number}`;
const itemLink = (r: { system_id: string; project_key: string; number: number }) => `#/projects/${r.system_id}/items/${keyOf(r)}`;

export function toSummary(r: ItemRow): WorkItemSummary {
  return {
    id: r.id,
    key: keyOf(r),
    systemId: r.system_id,
    number: r.number,
    type: r.type,
    summary: r.summary,
    status: r.status,
    statusName: r.status_name,
    statusCategory: r.status_category,
    ...(r.resolution ? { resolution: r.resolution } : {}),
    onHold: !!r.on_hold,
    priority: r.priority,
    ...(r.assignee ? { assignee: r.assignee } : {}),
    reporter: r.reporter,
    labels: r.labels ? r.labels.split(",") : [],
    ...(r.component ? { component: r.component } : {}),
    ...(r.story_points != null ? { storyPoints: Number(r.story_points) } : {}),
    ...(r.due_date ? { dueDate: r.due_date } : {}),
    ...(r.parent_id ? { parentId: r.parent_id, parentKey: `${r.project_key}-${r.parent_number}` } : {}),
    source: r.source,
    ...(r.sprint_id ? { sprintId: r.sprint_id } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
    ...(r.type === "EPIC" || r.child_total ? { children: { total: Number(r.child_total), done: Number(r.child_done) } } : {}),
  };
}

// ---------- reading ----------

/** The SQL condition (and its values) that limits rows to what this person may see. */
function visibility(c: ItemContext): { sql: string; args: unknown[] } {
  return c.ownOnly ? { sql: "(w.assignee = ? OR w.reporter = ?)", args: [c.me.id, c.me.id] } : { sql: "TRUE", args: [] };
}

export const canSee = (c: ItemContext, r: { assignee: string | null; reporter: string }) =>
  !c.ownOnly || r.assignee === c.me.id || r.reporter === c.me.id;

/** An item by its key (INFRA-12), or 404 when it doesn't exist or this person can't see it. */
export async function itemByKey(c: ItemContext, key: string): Promise<ItemRow> {
  const m = key.match(ITEM_KEY_PATTERN);
  if (!m) throw new HttpError(404, "Work item not found");
  const row = await c.db.prepare(`${SELECT} WHERE s.key = ? AND w.number = ?`).bind(m[1], Number(m[2])).first<ItemRow>();
  if (!row || !canSee(c, row)) throw new HttpError(404, "Work item not found");
  return row;
}

export async function itemById(c: ItemContext, id: string): Promise<ItemRow | null> {
  return c.db.prepare(`${SELECT} WHERE w.id = ?`).bind(id).first<ItemRow>();
}

const PRIORITY_ORDER = `CASE w.priority WHEN 'HIGHEST' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`;
const SORTS: Record<string, string> = {
  key: "s.key, w.number",
  updated: "w.updated_at",
  created: "w.created_at",
  priority: PRIORITY_ORDER,
  due: "w.due_date",
  status: "CASE st.category WHEN 'TODO' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, st.position",
  summary: "lower(w.summary)",
  type: "CASE w.type WHEN 'EPIC' THEN 0 WHEN 'STORY' THEN 1 WHEN 'TASK' THEN 2 WHEN 'BUG' THEN 3 ELSE 4 END",
};

const list = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
const likeText = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** GET /api/items: filtered, sorted, one page at a time. Never part of GET /api/data. */
async function listItems(c: ItemContext, q: URLSearchParams) {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    args.push(...values);
  };
  const vis = visibility(c);
  add(vis.sql, ...vis.args);
  const system = q.get("system");
  if (system) add("w.system_id = ?", system);
  const types = list(q.get("type")).filter((t) => (WORK_TYPES as string[]).includes(t));
  if (types.length) add(`w.type IN (${types.map(() => "?").join(", ")})`, ...types);
  const statuses = list(q.get("status")).filter((t) => /^[A-Z][A-Z0-9_]{0,39}$/.test(t));
  if (statuses.length) add(`w.status IN (${statuses.map(() => "?").join(", ")})`, ...statuses);
  const priorities = list(q.get("priority")).filter((t) => (WORK_PRIORITIES as string[]).includes(t));
  if (priorities.length) add(`w.priority IN (${priorities.map(() => "?").join(", ")})`, ...priorities);
  const assignee = q.get("assignee");
  if (assignee === "none") add("w.assignee IS NULL");
  else if (assignee) add("w.assignee = ?", assignee === "me" ? c.me.id : assignee);
  const reporter = q.get("reporter");
  if (reporter) add("w.reporter = ?", reporter === "me" ? c.me.id : reporter);
  const label = q.get("label");
  if (label) add("EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label = ?)", cleanLabel(label));
  const component = q.get("component");
  if (component) add("lower(w.component) = lower(?)", component);
  const source = q.get("source");
  if (source === "client_request" || source === "internal") add("w.source = ?", source);
  const parent = q.get("parent");
  if (parent === "none") add("w.parent_id IS NULL");
  else if (parent) {
    const p = parent.match(ITEM_KEY_PATTERN);
    if (p) add("w.parent_id = (SELECT pw.id FROM work_items pw JOIN systems ps ON ps.id = pw.system_id WHERE ps.key = ? AND pw.number = ?)", p[1], Number(p[2]));
    else add("w.parent_id = ?", parent);
  }
  const state = q.get("state");
  if (state === "open") add("st.category <> 'DONE'");
  if (state === "done") add("st.category = 'DONE'");
  const due = q.get("due");
  const today = c.now.slice(0, 10);
  if (due === "overdue") add("w.due_date < ? AND st.category <> 'DONE'", today);
  if (due === "week") add("w.due_date >= ? AND w.due_date <= ?", today, new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10));
  const text = (q.get("q") ?? "").trim().slice(0, 100);
  if (text) {
    const like = likeText(text);
    add("(w.summary ILIKE ? OR w.description ILIKE ? OR (s.key || '-' || w.number) ILIKE ?)", like, like, like);
  }

  const sortKey = SORTS[q.get("sort") ?? ""] ? (q.get("sort") as string) : "key";
  const dir = q.get("dir") === "asc" ? "ASC" : q.get("dir") === "desc" ? "DESC" : sortKey === "updated" || sortKey === "created" ? "DESC" : "ASC";
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || PAGE_SIZE));
  const offset = Math.max(0, Number(q.get("offset")) || 0);
  const rows = await c.db
    .prepare(
      `${SELECT.replace("SELECT w.*,", "SELECT COUNT(*) OVER () AS total_count, w.*,")} WHERE ${where.join(" AND ")}
       ORDER BY ${SORTS[sortKey]} ${dir} NULLS LAST, s.key, w.number LIMIT ? OFFSET ?`,
    )
    .bind(...args, limit, offset)
    .all<ItemRow & { total_count: number }>();
  const total = rows.results[0]?.total_count ?? (offset ? Number((await countOnly(c, where, args)) ?? 0) : 0);
  return { items: rows.results.map(toSummary), total: Number(total), offset };
}

async function countOnly(c: ItemContext, where: string[], args: unknown[]) {
  const r = await c.db
    .prepare(`SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id WHERE ${where.join(" AND ")}`)
    .bind(...args)
    .first<{ n: number }>();
  return r?.n;
}

/** Who may do what to one item. */
function rights(c: ItemContext, r: ItemRow) {
  const fullEditor = !c.guest && (c.can("edit_work_items") || (r.source === "client_request" && c.can("manage_features")));
  const reporterMay = r.reporter === c.me.id && (c.can("create_work_items") || (r.source === "client_request" && c.can("log_features")));
  return {
    edit: !c.guest && (fullEditor || r.assignee === c.me.id || reporterMay),
    delete: !c.guest && (c.can("delete_work_items") || (r.source === "client_request" && c.can("manage_features"))),
    comment: !c.guest,
    logTime: !c.guest && c.can("log_time"),
    assignOthers: fullEditor,
  };
}

/** The full item page: the item, its family, links, people, files, time and status history. */
async function detail(c: ItemContext, r: ItemRow): Promise<WorkItem> {
  const vis = visibility(c);
  const [children, parent, links, watchers, attachments, logs, history, comments] = await Promise.all([
    c.db.prepare(`${SELECT} WHERE w.parent_id = ? AND ${vis.sql} ORDER BY w.number`).bind(r.id, ...vis.args).all<ItemRow>(),
    r.parent_id ? c.db.prepare(`${SELECT} WHERE w.id = ?`).bind(r.parent_id).first<ItemRow>() : Promise.resolve(null),
    c.db
      .prepare(
        `SELECT k.id AS link_id, k.link_type, CASE WHEN k.from_id = ? THEN 'outward' ELSE 'inward' END AS direction, x.*
         FROM work_item_links k
         JOIN (${SELECT}) x ON x.id = CASE WHEN k.from_id = ? THEN k.to_id ELSE k.from_id END
         WHERE k.from_id = ? OR k.to_id = ? ORDER BY k.created_at`,
      )
      .bind(r.id, r.id, r.id, r.id)
      .all<ItemRow & { link_id: string; link_type: LinkType; direction: "outward" | "inward" }>(),
    c.db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ? ORDER BY created_at").bind(r.id).all<{ user_id: string }>(),
    c.guest
      ? Promise.resolve({ results: [] as Record<string, string | number>[] })
      : c.db
          .prepare("SELECT id, name, mime, size, uploaded_by, uploaded_at FROM documents WHERE work_item_id = ? ORDER BY uploaded_at")
          .bind(r.id)
          .all<Record<string, string | number>>(),
    c.db.prepare("SELECT * FROM work_logs WHERE item_id = ? ORDER BY work_date DESC, created_at DESC").bind(r.id).all<Record<string, string | number>>(),
    c.db
      .prepare(
        `SELECT h.*, f.name AS from_name, t.name AS to_name FROM status_history h
         LEFT JOIN work_statuses f ON f.id = h.from_status LEFT JOIN work_statuses t ON t.id = h.to_status
         WHERE h.item_id = ? ORDER BY h.id`,
      )
      .bind(r.id)
      .all<Record<string, string | null>>(),
    c.db.prepare("SELECT COUNT(*) AS n FROM work_item_comments WHERE item_id = ?").bind(r.id).first<{ n: number }>(),
  ]);
  const workLogs: WorkLog[] = logs.results.map((l) => ({
    id: String(l.id),
    userId: String(l.user_id),
    minutes: Number(l.minutes),
    note: String(l.note ?? ""),
    workDate: String(l.work_date),
    createdAt: String(l.created_at),
  }));
  return {
    ...toSummary(r),
    description: r.description,
    ...(r.start_date ? { startDate: r.start_date } : {}),
    ...(r.original_estimate != null ? { originalEstimate: Number(r.original_estimate) } : {}),
    ...(r.remaining_estimate != null ? { remainingEstimate: Number(r.remaining_estimate) } : {}),
    loggedMinutes: workLogs.reduce((n, l) => n + l.minutes, 0),
    ...(r.client ? { client: r.client } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    ...(parent && canSee(c, parent) ? { parent: toSummary(parent) } : {}),
    childItems: children.results.map(toSummary),
    links: links.results
      .filter((l) => canSee(c, l))
      .map((l): WorkItemLink => ({ id: l.link_id, type: l.link_type, direction: l.direction, item: toSummary(l) })),
    watchers: watchers.results.map((w) => w.user_id),
    watching: watchers.results.some((w) => w.user_id === c.me.id),
    attachments: attachments.results.map(
      (a): Attachment => ({
        id: String(a.id),
        name: String(a.name),
        mime: String(a.mime ?? "application/octet-stream"),
        size: Number(a.size ?? 0),
        uploadedBy: String(a.uploaded_by),
        uploadedAt: String(a.uploaded_at),
      }),
    ),
    workLogs,
    history: history.results.map(
      (h): StatusChange => ({
        ...(h.from_status ? { from: h.from_status, fromName: h.from_name ?? h.from_status } : {}),
        to: h.to_status!,
        toName: h.to_name ?? h.to_status!,
        ...(h.changed_by ? { by: h.changed_by } : {}),
        at: h.changed_at!,
      }),
    ),
    commentCount: Number(comments?.n ?? 0),
    can: rights(c, r),
    ...(await movesFor(c, r)),
  };
}

// ---------- workflow transitions ----------

/** The item as the workflow rules read it. */
async function forCheck(c: ItemContext, r: ItemRow) {
  const open = await c.db
    .prepare("SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.parent_id = ? AND w.type = 'SUBTASK' AND st.category <> 'DONE'")
    .bind(r.id)
    .first<{ n: number }>();
  return {
    status: r.status,
    assignee: r.assignee,
    reporter: r.reporter,
    description: r.description,
    dueDate: r.due_date,
    startDate: r.start_date,
    storyPoints: r.story_points,
    originalEstimate: r.original_estimate,
    component: r.component,
    labels: r.labels ? r.labels.split(",") : [],
    openSubtasks: Number(open?.n ?? 0),
  };
}

/** The moves out of the item's status, each with whether this person may make it and what it needs. */
async function movesFor(c: ItemContext, r: ItemRow): Promise<{ workflowId: string; moves: ItemMove[] }> {
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, r.system_id));
  const names = await statusNames(c);
  const item = await forCheck(c, r);
  const editable = rights(c, r).edit;
  return {
    workflowId: wf.id,
    moves: transitionsFrom(wf, r.status).map((t) => {
      const check = checkTransition(t, item, c.me);
      const to = names.get(t.to);
      return {
        transitionId: t.id,
        name: t.name,
        to: t.to,
        toName: to?.name ?? t.to,
        toCategory: to?.category ?? "TODO",
        allowed: editable && check.allowed,
        ...(!editable ? { reason: "You can't change this work item" } : check.reason ? { reason: check.reason } : {}),
        needs: check.needs,
      };
    }),
  };
}

async function statusNames(c: ItemContext) {
  const rows = await c.db.prepare("SELECT id, name, category FROM work_statuses").all<{ id: string; name: string; category: StatusCategory }>();
  return new Map(rows.results.map((x) => [x.id, x]));
}

export interface MoveRequest {
  transitionId?: unknown;
  to?: unknown;
  comment?: unknown;
  fields?: MoveInput["fields"];
  resolution?: Resolution; // a Done move made for a cancelled feature request
}

/** Someone who has `role`: the project's lead first, then its developers, then anyone, by name. */
async function personWithRole(c: ItemContext, role: string, systemId: string): Promise<string | null> {
  const row = await c.db
    .prepare(
      `SELECT u.id FROM users u WHERE u.role = ?
       ORDER BY (u.id = (SELECT s.data::json ->> 'lead' FROM systems s WHERE s.id = ?))::int DESC,
         EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id AND a.system_id = ?)::int DESC, u.name LIMIT 1`,
    )
    .bind(role, systemId, systemId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Makes one move in the item's workflow: checks the conditions and validators, applies any fields
 * given with it, adds the comment, runs the post-functions, logs it and tells people. Returns the change.
 */
export async function transitionItem(c: ItemContext, r: ItemRow, m: MoveRequest, opts: { log?: boolean; quiet?: boolean } = {}): Promise<ChangeResult> {
  // quiet: a step on the way somewhere else (a feature request's status walk). Only the last step tells
  // people and updates the project's progress; every step still records its history.
  const log = opts.log ?? true;
  const may = rights(c, r);
  if (!may.edit) throw new HttpError(403, "Only the assignee, the reporter or someone who can edit any work item can move this");
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, r.system_id));
  const options = transitionsFrom(wf, r.status);
  const t: Transition | undefined = m.transitionId ? options.find((x) => x.id === m.transitionId) : options.find((x) => x.to === m.to);
  const names = await statusNames(c);
  if (!t) {
    const to = names.get(String(m.to ?? ""))?.name ?? "that status";
    throw new HttpError(400, `The ${wf.name} workflow doesn't allow a move from ${r.status_name} to ${to}`, "transition_not_allowed");
  }
  const comment = typeof m.comment === "string" ? m.comment.trim().slice(0, MAX_COMMENT) : "";
  const fields = m.fields && typeof m.fields === "object" ? m.fields : {};
  const check = checkTransition(t, await forCheck(c, r), c.me, { comment, fields });
  if (!check.allowed) throw new HttpError(403, check.reason ?? "You can't make that move", "transition_condition");
  if (needsInput(check)) {
    const wants = [...(check.needs.comment ? ["a comment"] : []), ...(check.needs.assignee ? ["an assignee"] : []), ...check.needs.fields.map((f) => f)];
    throw new HttpError(400, `"${t.name}" needs ${wants.join(", ")} first`, "transition_needs", { needs: check.needs, transition: t.id });
  }
  if (fields.assignee !== undefined && !may.assignOthers) {
    const to = (fields.assignee || null) as string | null;
    if (to && to !== c.me.id) throw new HttpError(403, "You can assign a work item to yourself only");
  }

  const patch: ItemPatch = { ...fields, status: t.to };
  for (const rule of t.rules.filter((x) => x.kind === "post_function")) {
    if (rule.rule === "assign_user" && rule.value) {
      const u = await c.db.prepare("SELECT role FROM users WHERE id = ?").bind(rule.value).first<{ role: Role }>();
      if (u && u.role !== "viewer") patch.assignee = rule.value;
    }
    if (rule.rule === "assign_role" && rule.value) patch.assignee = (await personWithRole(c, rule.value, r.system_id)) ?? patch.assignee;
    if (rule.rule === "assign_reporter") patch.assignee = r.reporter;
    if (rule.rule === "clear_assignee") patch.assignee = null;
    if (rule.rule === "set_resolution" && (rule.value === "DONE" || rule.value === "WONT_DO")) patch.resolution = rule.value;
  }
  if (m.resolution) patch.resolution = m.resolution;
  // A client request goes to developers only: a post-function can't hand it to anyone else.
  if (r.source === "client_request" && patch.assignee && patch.assignee !== fields.assignee) {
    const u = await c.db.prepare("SELECT role FROM users WHERE id = ?").bind(patch.assignee).first<{ role: Role }>();
    if (u?.role !== "developer") delete patch.assignee;
  }
  const res = await applyChange(c, r, patch, true);

  if (comment) {
    const id = newToken().slice(0, 16);
    await c.db.prepare("INSERT INTO work_item_comments (id, item_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, r.id, c.me.id, comment, c.now).run();
    await c.audit("comment_added", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, comment: comment.slice(0, 300), transition: t.name });
    await notifyMentions(c, res.after, comment, `Moving it to ${res.after.status_name}`);
  }
  if (log) {
    await c.audit("work_item_updated", res.after.system_id, {
      name: res.after.project_name,
      key: keyOf(res.after),
      summary: res.after.summary,
      transition: t.name,
      fields: res.changed,
      ...res.diff,
      ...(res.diff.status ? { statusNames: { from: r.status_name, to: res.after.status_name } } : {}),
    });
  }
  if (opts.quiet) return res;
  // "Notify" post-functions, beyond the watchers (who hear anyway).
  const notify = t.rules.filter((x) => x.kind === "post_function" && x.rule === "notify").map((x) => x.value ?? "watchers");
  const extra = new Set<string>();
  for (const v of notify) {
    if (v === "assignee" && res.after.assignee) extra.add(res.after.assignee);
    if (v === "reporter") extra.add(res.after.reporter);
    if (v.startsWith("role:")) {
      const ids = await c.db.prepare("SELECT id FROM users WHERE role = ?").bind(v.slice(5)).all<{ id: string }>();
      ids.results.forEach((u) => extra.add(u.id));
    }
  }
  const watchers = new Set((await c.db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ?").bind(r.id).all<{ user_id: string }>()).results.map((w) => w.user_id));
  const seeAll = await developersSeeAll(c);
  const roles = new Map(
    (await c.db.prepare("SELECT id, role FROM users").all<{ id: string; role: Role }>()).results.map((u) => [u.id, u.role]),
  );
  c.alert(
    [...extra]
      .filter((id) => !watchers.has(id))
      .filter((id) => roles.get(id) !== "developer" || seeAll || id === res.after.assignee || id === res.after.reporter)
      .map((id) => ({
        userId: id,
        kind: "watching" as const,
        title: `${keyOf(res.after)} ${res.after.summary}`.slice(0, 200),
        body: `${t.name}: now ${res.after.status_name}. By ${c.me.name}.`,
        link: itemLink(res.after),
      })),
  );
  await afterChange(c, res);
  return res;
}

const TESTING_NAME = /review|test|approval/i;

/**
 * A feature request's status, as a status in the project's workflow: where the request should end up.
 * Returns null when it is already there.
 */
async function featureTarget(c: ItemContext, wf: Workflow, r: ItemRow, status: FeatureStatus): Promise<string | null> {
  const names = await statusNames(c);
  const inWf = wf.statuses.map((s) => names.get(s.id)!).filter(Boolean);
  const cat = (k: StatusCategory) => inWf.filter((s) => s.category === k);
  const current = names.get(r.status);
  switch (status) {
    case "NOT_STARTED":
      return current?.category === "TODO" ? null : initialStatus(wf);
    case "IN_PROGRESS": {
      if (current?.category === "IN_PROGRESS" && !TESTING_NAME.test(current.name)) return null;
      return (cat("IN_PROGRESS").find((s) => !TESTING_NAME.test(s.name)) ?? cat("IN_PROGRESS")[0])?.id ?? null;
    }
    case "TESTING": {
      if (current?.category === "IN_PROGRESS" && TESTING_NAME.test(current.name)) return null;
      const list = cat("IN_PROGRESS");
      return (list.find((s) => TESTING_NAME.test(s.name)) ?? list[list.length - 1])?.id ?? null;
    }
    case "COMPLETED":
    case "CANCELLED":
      return current?.category === "DONE" ? null : cat("DONE")[0]?.id ?? null;
    case "ON_HOLD":
      return current?.category === "DONE" ? ((cat("IN_PROGRESS")[0] ?? cat("TODO")[0])?.id ?? null) : null;
  }
}

/**
 * Moves a feature request to the status its old status names, through the moves its project's
 * workflow allows this person to make (the shortest way there). Refuses when there is no such way.
 */
export async function moveFeatureTo(c: ItemContext, r: ItemRow, status: FeatureStatus): Promise<ItemRow> {
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, r.system_id));
  const target = await featureTarget(c, wf, r, status);
  let row = r;
  if (target) {
    // Breadth-first over the moves this person may make without giving anything more.
    const item = await forCheck(c, r);
    const prev = new Map<string, { from: string; t: Transition } | null>([[r.status, null]]);
    const queue = [r.status];
    while (queue.length && !prev.has(target)) {
      const at = queue.shift()!;
      for (const t of transitionsFrom(wf, at)) {
        if (prev.has(t.to)) continue;
        const check = checkTransition(t, { ...item, status: at }, c.me);
        if (!check.allowed || needsInput(check)) continue;
        prev.set(t.to, { from: at, t });
        queue.push(t.to);
      }
    }
    if (!prev.has(target)) {
      const name = (await statusNames(c)).get(target)?.name ?? target;
      throw new HttpError(
        400,
        `The ${wf.name} workflow doesn't let you move this request from ${r.status_name} to ${name} directly. Open work item ${keyOf(r)} to move it step by step.`,
        "transition_not_allowed",
      );
    }
    const steps: Transition[] = [];
    for (let at = target; prev.get(at); at = prev.get(at)!.from) steps.unshift(prev.get(at)!.t);
    for (const [i, t] of steps.entries()) {
      const last = i === steps.length - 1;
      row = (await transitionItem(c, row, { transitionId: t.id, ...(last && status === "CANCELLED" ? { resolution: "WONT_DO" as const } : {}) }, { log: false, quiet: !last })).after;
    }
  } else if ((status === "CANCELLED" || status === "COMPLETED") && row.status_category === "DONE") {
    row = (await applyChange(c, row, { resolution: status === "CANCELLED" ? "WONT_DO" : "DONE" }, true)).after;
  }
  const hold = status === "ON_HOLD";
  if (!!row.on_hold !== hold && row.status_category !== "DONE") row = (await applyChange(c, row, { onHold: hold })).after;
  return row;
}

// ---------- validation ----------

function str(v: unknown, field: string, max: number, required = false): string | null {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${field} can be up to ${max.toLocaleString("en-GB")} characters`);
  return t;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new HttpError(400, `Unknown ${field}`);
  return v as T;
}

function date(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} must be a date`);
  return v;
}

/** Minutes (a whole number, 0 to 10 years of 8-hour days), or null to clear. */
function minutes(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10 * 260 * 480) throw new HttpError(400, `${field} must be a length of time`);
  return Math.round(n);
}

function points(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999) throw new HttpError(400, "Story points must be a number from 0 to 999");
  return Math.round(n * 10) / 10;
}

function labels(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, "Labels must be a list");
  const out = [...new Set(v.map((x) => cleanLabel(String(x))).filter(Boolean))];
  if (out.length > MAX_LABELS) throw new HttpError(400, `Up to ${MAX_LABELS} labels`);
  return out;
}

/** An assignee: a person who can do work (not a Standard user). Client requests go to developers only, as before. */
async function checkAssignee(c: ItemContext, v: unknown, source: WorkSource): Promise<string | null> {
  const id = str(v, "Assignee", 64);
  if (!id) return null;
  const u = await c.db.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{ role: Role }>();
  if (!u) throw new HttpError(400, "Unknown assignee");
  if (source === "client_request" && u.role !== "developer") throw new HttpError(400, "Only users with the developer role can be assigned");
  if (u.role === "viewer") throw new HttpError(400, "Standard users can't be assigned work");
  return id;
}

/** A parent for `type` in project `systemId`: it must exist there, be visible, and fit the hierarchy. */
async function checkParent(c: ItemContext, v: unknown, type: WorkItemType, systemId: string, selfId?: string): Promise<ItemRow | null> {
  const ref = str(v, "Parent", 40);
  let parent: ItemRow | null = null;
  if (ref) {
    parent = ITEM_KEY_PATTERN.test(ref) ? await itemByKey(c, ref).catch(() => null) : await itemById(c, ref);
    if (!parent || !canSee(c, parent)) throw new HttpError(400, "That parent work item doesn't exist");
    if (parent.system_id !== systemId) throw new HttpError(400, "The parent must be in the same project");
    if (selfId && parent.id === selfId) throw new HttpError(400, "A work item can't be its own parent");
  }
  const problem = parentProblem(type, parent?.type ?? null);
  if (problem) throw new HttpError(400, problem);
  return parent;
}

// ---------- notifications ----------

/** Whether developers see every work item: only when their role has been given "manage_features". */
async function developersSeeAll(c: ItemContext): Promise<boolean> {
  const row = await c.db.prepare("SELECT value FROM settings WHERE key = 'role_permissions'").first<{ value: string }>();
  const matrix = row ? (JSON.parse(row.value) as Record<string, string[]>) : null;
  return !!matrix?.developer?.includes("manage_features");
}

/** Tells the item's watchers (who can still see it) what changed. Your own changes don't notify you. */
async function notifyWatchers(c: ItemContext, r: ItemRow, what: string, skip: string[] = []) {
  const rows = await c.db
    .prepare(
      `SELECT ww.user_id, u.role FROM work_item_watchers ww JOIN users u ON u.id = ww.user_id WHERE ww.item_id = ?`,
    )
    .bind(r.id)
    .all<{ user_id: string; role: Role }>();
  const seesAll = await developersSeeAll(c);
  const alerts: Alert[] = rows.results
    .filter((w) => !skip.includes(w.user_id))
    // A developer who can't see the item any more (no longer assigned or the reporter) hears nothing.
    .filter((w) => w.role !== "developer" || seesAll || w.user_id === r.assignee || w.user_id === r.reporter)
    .map((w) => ({
      userId: w.user_id,
      kind: "watching" as const,
      title: `${keyOf(r)} ${r.summary}`.slice(0, 200),
      body: `${what} by ${c.me.name}.`,
      link: itemLink(r),
    }));
  c.alert(alerts);
}

/** People @mentioned in `text` who can see the item: a bell alert each. Returns who was told. */
async function notifyMentions(c: ItemContext, r: ItemRow, text: string, where: string): Promise<string[]> {
  const names = mentionsIn(text);
  if (!names.length) return [];
  const people = await c.db
    .prepare(`SELECT id, role FROM users WHERE lower(username) IN (${names.map(() => "?").join(", ")})`)
    .bind(...names)
    .all<{ id: string; role: Role }>();
  const seesAll = await developersSeeAll(c);
  const told = people.results.filter((p) => p.role !== "developer" || seesAll || p.id === r.assignee || p.id === r.reporter);
  c.alert(
    told.map((p) => ({
      userId: p.id,
      kind: "mentioned" as const,
      title: `${c.me.name} mentioned you on ${keyOf(r)}`,
      body: `${where}: ${r.summary}`.slice(0, 300),
      link: itemLink(r),
    })),
  );
  return told.map((p) => p.id);
}

// ---------- project progress from work items ----------

/**
 * For a project that takes its progress from its work items: the share of its stories, tasks and
 * bugs that are done (epics and sub-tasks are rolled up inside those; cancelled ones don't count).
 */
export async function recomputeProgress(c: ItemContext, systemId: string) {
  const sys = await c.db.prepare("SELECT data, progress_from_items FROM systems WHERE id = ?").bind(systemId).first<{ data: string; progress_from_items: number }>();
  if (!sys || !sys.progress_from_items) return;
  const n = (await c.db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE st.category = 'DONE') AS done
       FROM work_items w JOIN work_statuses st ON st.id = w.status
       WHERE w.system_id = ? AND w.type IN ('STORY', 'TASK', 'BUG') AND COALESCE(w.resolution, '') <> 'WONT_DO'`,
    )
    .bind(systemId)
    .first<{ total: number; done: number }>())!;
  const progress = Number(n.total) ? Math.round((Number(n.done) / Number(n.total)) * 100) : 0;
  const data = JSON.parse(sys.data) as { name: string; progress: number; status: string; health?: string };
  if (data.progress === progress) return;
  const from = { progress: data.progress, status: data.status, health: data.health ?? null };
  const next = { ...data, progress, updatedAt: c.now };
  await c.db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(next), systemId).run();
  await c.audit("system_progress", systemId, { name: data.name, from, to: { ...from, progress }, fromWorkItems: true });
}

// ---------- changing an item ----------

/** What may change on an item. `systemId` moves it to another project (with a new number there). */
export interface ItemPatch {
  summary?: unknown;
  description?: unknown;
  type?: unknown;
  status?: unknown;
  resolution?: unknown;
  onHold?: unknown;
  priority?: unknown;
  assignee?: unknown;
  parent?: unknown; // key or id; "" clears
  labels?: unknown;
  component?: unknown;
  storyPoints?: unknown;
  originalEstimate?: unknown;
  remainingEstimate?: unknown;
  startDate?: unknown;
  dueDate?: unknown;
  client?: unknown;
  notes?: unknown;
  systemId?: unknown;
}

const FIELD_LABEL: Record<string, string> = {
  summary: "Summary",
  description: "Description",
  type: "Type",
  status: "Status",
  resolution: "Resolution",
  onHold: "On hold",
  priority: "Priority",
  assignee: "Assignee",
  parent: "Parent",
  labels: "Labels",
  component: "Component",
  storyPoints: "Story points",
  originalEstimate: "Original estimate",
  remainingEstimate: "Remaining estimate",
  startDate: "Start date",
  dueDate: "Due date",
  client: "Requested by",
  notes: "Notes",
  systemId: "Project",
};

export interface ChangeResult {
  before: ItemRow;
  after: ItemRow;
  changed: string[];
  /** Before and after values of each changed field, for the activity log. */
  diff: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Validates and saves a change to one item: hierarchy, statuses and resolution, labels, numbering
 * on a move, status history and watchers, in one transaction. Permission checks are the caller's.
 */
export async function applyChange(c: ItemContext, r: ItemRow, b: ItemPatch, viaTransition = false): Promise<ChangeResult> {
  if (b.status !== undefined && b.status !== r.status && !viaTransition) {
    throw new HttpError(400, "Statuses change through the workflow's moves", "use_transition");
  }
  const next = { ...r };
  let nextLabels = r.labels ? r.labels.split(",") : [];
  if (b.summary !== undefined) next.summary = str(b.summary, "Summary", MAX_SUMMARY, true)!;
  if (b.description !== undefined) next.description = str(b.description, "Description", MAX_DESCRIPTION) ?? "";
  if (b.type !== undefined) next.type = pick(b.type, WORK_TYPES, "type");
  if (b.priority !== undefined) next.priority = pick(b.priority, WORK_PRIORITIES, "priority");
  if (b.assignee !== undefined) next.assignee = await checkAssignee(c, b.assignee, r.source);
  if (b.labels !== undefined) nextLabels = labels(b.labels);
  if (b.component !== undefined) next.component = str(b.component, "Component", 60);
  if (b.storyPoints !== undefined) next.story_points = points(b.storyPoints);
  if (b.originalEstimate !== undefined) next.original_estimate = minutes(b.originalEstimate, "Original estimate");
  if (b.remainingEstimate !== undefined) next.remaining_estimate = minutes(b.remainingEstimate, "Remaining estimate");
  if (b.startDate !== undefined) next.start_date = date(b.startDate, "Start date");
  if (b.dueDate !== undefined) next.due_date = date(b.dueDate, "Due date");
  if (b.client !== undefined) next.client = str(b.client, "Requested by", 200);
  if (b.notes !== undefined) next.notes = str(b.notes, "Notes", 2000);
  if (b.onHold !== undefined) next.on_hold = b.onHold ? 1 : 0;
  if (next.start_date && next.due_date && next.start_date > next.due_date) throw new HttpError(400, "The start date must be on or before the due date");

  // Moving to another project: a new number there; it leaves its parent behind.
  let moving = false;
  if (b.systemId !== undefined && b.systemId !== r.system_id) {
    const target = await c.db.prepare("SELECT id FROM systems WHERE id = ?").bind(String(b.systemId)).first<{ id: string }>();
    if (!target) throw new HttpError(404, "System not found");
    if (Number(r.child_total) || (await c.db.prepare("SELECT 1 FROM work_items WHERE parent_id = ?").bind(r.id).first())) {
      throw new HttpError(400, "Move or remove its child work items first");
    }
    next.system_id = target.id;
    next.parent_id = null;
    moving = true;
    // Its status, in the new project's workflow: the same one if it has it, else the first of the same kind.
    const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, target.id));
    if (!wf.statuses.some((x) => x.id === r.status)) {
      const names = await statusNames(c);
      next.status = wf.statuses.find((x) => names.get(x.id)?.category === r.status_category)?.id ?? initialStatus(wf);
    }
  }

  // The hierarchy: a new parent, or the same parent under a new type, must fit.
  if (b.parent !== undefined && !moving) {
    const parent = await checkParent(c, b.parent, next.type, next.system_id, r.id);
    next.parent_id = parent?.id ?? null;
    if (parent && parent.parent_id === r.id) throw new HttpError(400, "A work item can't sit under its own child");
  } else if (b.type !== undefined && next.type !== r.type) {
    const parentType = r.parent_id ? (await c.db.prepare("SELECT type FROM work_items WHERE id = ?").bind(r.parent_id).first<{ type: WorkItemType }>())?.type ?? null : null;
    const problem = parentProblem(next.type, moving ? null : parentType);
    if (problem) throw new HttpError(400, `${problem}. Change the parent first`);
  }
  if (next.type !== r.type) {
    const kids = await c.db.prepare("SELECT DISTINCT type FROM work_items WHERE parent_id = ?").bind(r.id).all<{ type: WorkItemType }>();
    const allowed = childTypesOf(next.type);
    if (kids.results.some((k) => !allowed.includes(k.type))) {
      throw new HttpError(400, `It has child work items that can't sit under a ${TYPE_META[next.type].label.toLowerCase()}`);
    }
  }

  // Status, resolution and the dates that go with them.
  if (b.status !== undefined) next.status = String(b.status);
  const names = await statusNames(c);
  if (!names.has(next.status)) throw new HttpError(400, "Unknown status");
  const doneNow = names.get(next.status)!.category === "DONE";
  const doneBefore = r.status_category === "DONE";
  if (b.resolution !== undefined && b.resolution !== null && b.resolution !== "") next.resolution = pick(b.resolution, Object.keys(RESOLUTION_META) as Resolution[], "resolution");
  if (doneNow) {
    if (!next.resolution) next.resolution = "DONE";
    if (!doneBefore || !next.resolved_at) next.resolved_at = c.now;
    next.on_hold = 0;
  } else {
    next.resolution = null;
    next.resolved_at = null;
  }

  const field = (k: keyof ItemRow) => next[k] !== r[k];
  const changes: [string, unknown, unknown][] = [];
  const track = (name: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes.push([name, from ?? null, to ?? null]);
  };
  track("summary", r.summary, next.summary);
  track("description", r.description.slice(0, 300), next.description.slice(0, 300));
  if (field("description") && !changes.some((x) => x[0] === "description")) changes.push(["description", "(longer text)", "(changed)"]);
  track("type", r.type, next.type);
  track("status", r.status, next.status);
  track("resolution", r.resolution, next.resolution);
  track("onHold", !!r.on_hold, !!next.on_hold);
  track("priority", r.priority, next.priority);
  track("assignee", r.assignee, next.assignee);
  track("parent", r.parent_id, next.parent_id);
  const sortedBefore = (r.labels ? r.labels.split(",") : []).sort();
  track("labels", sortedBefore, [...nextLabels].sort());
  track("component", r.component, next.component);
  track("storyPoints", r.story_points == null ? null : Number(r.story_points), next.story_points == null ? null : Number(next.story_points));
  track("originalEstimate", r.original_estimate, next.original_estimate);
  track("remainingEstimate", r.remaining_estimate, next.remaining_estimate);
  track("startDate", r.start_date, next.start_date);
  track("dueDate", r.due_date, next.due_date);
  track("client", r.client, next.client);
  track("notes", r.notes, next.notes);
  track("systemId", r.system_id, next.system_id);
  if (!changes.length) return { before: r, after: r, changed: [], diff: {} };
  next.updated_at = c.now;

  const db = c.db;
  const stmts: D1PreparedStatement[] = [];
  if (moving) {
    stmts.push(
      db
        .prepare(
          `WITH n AS (UPDATE systems SET item_seq = item_seq + 1 WHERE id = ? RETURNING item_seq)
           UPDATE work_items SET system_id = ?, number = (SELECT item_seq FROM n), parent_id = NULL, sprint_id = NULL,
             backlog_rank = (SELECT COALESCE(MAX(x.backlog_rank), 0) + 1024 FROM work_items x WHERE x.system_id = ?) WHERE id = ?`,
        )
        .bind(next.system_id, next.system_id, next.system_id, r.id),
      // It leaves any sprint it was in: scope change for a running one.
      db.prepare("UPDATE sprint_items SET removed_at = ?, outcome = 'removed' WHERE item_id = ? AND removed_at IS NULL AND outcome IS NULL").bind(c.now, r.id),
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE work_items SET type = ?, parent_id = ?, summary = ?, description = ?, status = ?, resolution = ?, on_hold = ?,
           priority = ?, assignee = ?, component = ?, story_points = ?, original_estimate = ?, remaining_estimate = ?,
           start_date = ?, due_date = ?, client = ?, notes = ?, updated_at = ?, resolved_at = ? WHERE id = ?`,
      )
      .bind(
        next.type,
        next.parent_id,
        next.summary,
        next.description,
        next.status,
        next.resolution,
        next.on_hold,
        next.priority,
        next.assignee,
        next.component,
        next.story_points,
        next.original_estimate,
        next.remaining_estimate,
        next.start_date,
        next.due_date,
        next.client,
        next.notes,
        next.updated_at,
        next.resolved_at,
        r.id,
      ),
  );
  if (changes.some((x) => x[0] === "labels")) {
    stmts.push(db.prepare("DELETE FROM work_item_labels WHERE item_id = ?").bind(r.id));
    for (const l of nextLabels) stmts.push(db.prepare("INSERT INTO work_item_labels (item_id, label) VALUES (?, ?)").bind(r.id, l));
  }
  if (next.status !== r.status) {
    stmts.push(
      db.prepare("INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)").bind(r.id, r.status, next.status, c.me.id, c.now),
    );
  }
  // A new assignee watches the item.
  if (next.assignee && next.assignee !== r.assignee) {
    stmts.push(db.prepare("INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(r.id, next.assignee, c.now));
  }
  await db.batch(stmts);

  const after = (await itemById(c, r.id))!;
  const diff = Object.fromEntries(changes.map(([k, from, to]) => [k, { from, to }]));
  if (moving) diff.key = { from: keyOf(r), to: keyOf(after) };
  return { before: r, after, changed: changes.map((x) => x[0]), diff };
}

/**
 * After a change: alerts for a new assignee (unless the caller sends its own) and the watchers,
 * and the project's progress.
 */
export async function afterChange(c: ItemContext, res: ChangeResult, alertAssignee = true) {
  const { before, after, changed } = res;
  if (!changed.length) return;
  if (alertAssignee && changed.includes("assignee") && after.assignee) {
    c.alert([
      {
        userId: after.assignee,
        kind: "assigned",
        title: `${keyOf(after)} assigned to you: ${after.summary}`.slice(0, 200),
        body: `${after.project_name}, ${after.priority.toLowerCase()} priority. From ${c.me.name}.`,
        link: itemLink(after),
      },
    ]);
  }
  const words = changed.map((k) =>
    k === "status"
      ? `status changed to ${after.status_name}`
      : k === "assignee"
        ? after.assignee
          ? "reassigned"
          : "unassigned"
        : `${FIELD_LABEL[k]?.toLowerCase() ?? k} changed`,
  );
  await notifyWatchers(c, after, `${words.join(", ").replace(/^./, (x) => x.toUpperCase())}`, after.assignee && changed.includes("assignee") ? [after.assignee] : []);
  await recomputeProgress(c, after.system_id);
  if (before.system_id !== after.system_id) await recomputeProgress(c, before.system_id);
}

// ---------- creating ----------

export interface NewItem {
  systemId: unknown;
  type?: unknown;
  summary?: unknown;
  description?: unknown;
  status?: unknown;
  resolution?: unknown;
  onHold?: unknown;
  priority?: unknown;
  assignee?: unknown;
  parent?: unknown;
  labels?: unknown;
  component?: unknown;
  storyPoints?: unknown;
  originalEstimate?: unknown;
  startDate?: unknown;
  dueDate?: unknown;
  client?: unknown;
  notes?: unknown;
}

/** Creates an item with the next number in its project, safely when two arrive at once. */
export async function createItem(c: ItemContext, b: NewItem, source: WorkSource, id = newToken().slice(0, 16)): Promise<ItemRow> {
  // A view-only link has no account to report from.
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const sys = await c.db.prepare("SELECT id FROM systems WHERE id = ?").bind(String(b.systemId ?? "")).first<{ id: string }>();
  if (!sys) throw new HttpError(404, "System not found");
  const type = pick(b.type ?? "TASK", WORK_TYPES, "type");
  const parent = await checkParent(c, b.parent, type, sys.id);
  // Every new item starts in its workflow's first status; a feature request then moves on from there.
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, sys.id));
  const status = initialStatus(wf);
  const done = (await statusNames(c)).get(status)?.category === "DONE";
  const resolution = done ? (b.resolution === "WONT_DO" ? "WONT_DO" : "DONE") : null;
  const assignee = await checkAssignee(c, b.assignee, source);
  const start = date(b.startDate, "Start date");
  const due = date(b.dueDate, "Due date");
  if (start && due && start > due) throw new HttpError(400, "The start date must be on or before the due date");
  const estimate = minutes(b.originalEstimate, "Original estimate");
  const tags = labels(b.labels);
  const db = c.db;
  const stmts = [
    db
      .prepare(
        `WITH n AS (UPDATE systems SET item_seq = item_seq + 1 WHERE id = ? RETURNING item_seq)
         INSERT INTO work_items (id, system_id, number, type, parent_id, summary, description, status, resolution, on_hold, priority,
           assignee, reporter, component, story_points, original_estimate, remaining_estimate, start_date, due_date,
           created_at, updated_at, resolved_at, source, client, notes, backlog_rank)
         SELECT ?, ?, n.item_seq, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(x.backlog_rank), 0) + 1024 FROM work_items x WHERE x.system_id = ?) FROM n RETURNING number`,
      )
      .bind(
        sys.id,
        id,
        sys.id,
        type,
        parent?.id ?? null,
        str(b.summary, "Summary", MAX_SUMMARY, true),
        str(b.description, "Description", MAX_DESCRIPTION) ?? "",
        status,
        resolution,
        b.onHold && !done ? 1 : 0,
        pick(b.priority ?? "MEDIUM", WORK_PRIORITIES, "priority"),
        assignee,
        c.me.id,
        str(b.component, "Component", 60),
        points(b.storyPoints),
        estimate,
        estimate,
        start,
        due,
        c.now,
        c.now,
        done ? c.now : null,
        source,
        str(b.client, "Requested by", 200),
        str(b.notes, "Notes", 2000),
        sys.id,
      ),
    ...tags.map((l) => db.prepare("INSERT INTO work_item_labels (item_id, label) VALUES (?, ?)").bind(id, l)),
    db.prepare("INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) VALUES (?, NULL, ?, ?, ?)").bind(id, status, c.me.id, c.now),
    // The reporter and the assignee watch it.
    ...[...new Set([c.me.id, ...(assignee ? [assignee] : [])])].map((u) =>
      db.prepare("INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(id, u, c.now),
    ),
  ];
  await db.batch(stmts);
  const row = (await itemById(c, id))!;
  if (assignee) {
    c.alert([
      {
        userId: assignee,
        kind: "assigned",
        title: `${keyOf(row)} assigned to you: ${row.summary}`.slice(0, 200),
        body: `${row.project_name}, ${row.priority.toLowerCase()} priority. From ${c.me.name}.`,
        link: itemLink(row),
      },
    ]);
  }
  await recomputeProgress(c, row.system_id);
  return row;
}

/** Deletes an item, its sub-tasks and their attachments. Children of an epic stay, without a parent. */
export async function deleteItem(c: ItemContext, r: ItemRow) {
  const ids = [r.id, ...(await c.db.prepare("SELECT id FROM work_items WHERE parent_id = ? AND type = 'SUBTASK'").bind(r.id).all<{ id: string }>()).results.map((x) => x.id)];
  const marks = ids.map(() => "?").join(", ");
  await c.db.batch([
    c.db.prepare(`DELETE FROM document_chunks WHERE doc_id IN (SELECT id FROM documents WHERE work_item_id IN (${marks}))`).bind(...ids),
    c.db.prepare(`DELETE FROM documents WHERE work_item_id IN (${marks})`).bind(...ids),
    c.db.prepare(`DELETE FROM work_items WHERE id IN (${marks})`).bind(...ids),
  ]);
  await recomputeProgress(c, r.system_id);
  return ids.length - 1;
}

// ---------- feature requests, through the work item code ----------

const FEATURE_PRIORITY: Record<Priority, WorkPriority> = { CRITICAL: "HIGHEST", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

/** The work item fields for a feature request's fields (only those given). */
export function featureToItem(
  f: { title?: unknown; description?: unknown; kind?: FeatureKind; client?: unknown; priority?: Priority; assignee?: unknown; notes?: unknown; dueAt?: unknown; systemId?: unknown },
  current?: { type: WorkItemType; labels: string[] },
): ItemPatch & NewItem {
  const out: ItemPatch & NewItem = { systemId: f.systemId };
  if (f.systemId === undefined) delete (out as { systemId?: unknown }).systemId;
  if (f.title !== undefined) out.summary = f.title;
  if (f.description !== undefined) out.description = f.description ?? "";
  if (f.client !== undefined) out.client = f.client;
  if (f.notes !== undefined) out.notes = f.notes;
  if (f.assignee !== undefined) out.assignee = f.assignee;
  if (f.dueAt !== undefined) out.dueDate = f.dueAt;
  if (f.priority !== undefined) out.priority = FEATURE_PRIORITY[f.priority];
  if (f.kind !== undefined) {
    const kindLabels = Object.values(KIND_LABELS) as string[];
    out.labels = [...(current?.labels ?? []).filter((l) => !kindLabels.includes(l)), KIND_LABELS[f.kind]];
    // A bug fix is a Bug; anything else is a Story (an existing item keeps its type unless it was a Bug).
    out.type = f.kind === "BUG_FIX" ? "BUG" : current && current.type !== "BUG" ? current.type : "STORY";
  }
  return out;
}

// ---------- the routes ----------

const KEY = "([A-Z]{2,10}-\\d{1,7})";

/** Handles /api/items…; returns null for any other path. */
export async function itemsApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/items")) return null;
  const { db, req } = c;

  if (path === "/api/items" && method === "GET") return json(await listItems(c, new URL(req.url).searchParams));

  if (path === "/api/items" && method === "POST") {
    if (c.guest || !c.can("create_work_items")) throw new HttpError(403, "You don't have permission to create work items");
    const b = await body<NewItem>(req);
    if (!c.can("edit_work_items") && b.assignee && b.assignee !== c.me.id) {
      throw new HttpError(403, "You can assign a work item to yourself only. Someone who can edit any work item assigns others.");
    }
    const row = await createItem(c, b, "internal");
    await c.audit("work_item_created", row.system_id, {
      name: row.project_name,
      key: keyOf(row),
      summary: row.summary,
      type: row.type,
      priority: row.priority,
      status: row.status,
      ...(row.assignee ? { assignee: row.assignee } : {}),
      ...(row.parent_id ? { parent: `${row.project_key}-${row.parent_number}` } : {}),
    });
    return json(await detail(c, row), 201);
  }

  let m = path.match(new RegExp(`^/api/items/${KEY}$`));
  if (m && method === "GET") return json(await detail(c, await itemByKey(c, m[1])));

  if (m && method === "PATCH") {
    const r = await itemByKey(c, m[1]);
    const may = rights(c, r);
    if (!may.edit) throw new HttpError(403, "Only the assignee, the reporter or someone who can edit any work item can change this");
    const b = await body<ItemPatch>(req);
    if (b.systemId !== undefined && b.systemId !== r.system_id && !may.assignOthers) throw new HttpError(403, "You don't have permission to move work items");
    if (b.assignee !== undefined && !may.assignOthers) {
      const to = (b.assignee || null) as string | null;
      if (to && to !== c.me.id) throw new HttpError(403, "You can assign a work item to yourself only");
      if (to !== r.assignee && r.assignee && r.assignee !== c.me.id) throw new HttpError(403, "Someone else is assigned; ask whoever assigns work to change it");
    }
    // A new status is a move in the workflow, with its rules; the other fields follow.
    let row = r;
    const { status, comment, ...rest } = b as ItemPatch & { comment?: unknown };
    if (status !== undefined && status !== r.status) row = (await transitionItem(c, r, { to: status, comment })).after;
    const res = await applyChange(c, row, rest);
    if (res.changed.length) {
      await c.audit("work_item_updated", res.after.system_id, { name: res.after.project_name, key: keyOf(res.after), summary: res.after.summary, fields: res.changed, ...res.diff });
      await afterChange(c, res);
    }
    return json(await detail(c, res.after));
  }

  if (m && method === "DELETE") {
    const r = await itemByKey(c, m[1]);
    if (!rights(c, r).delete) throw new HttpError(403, "You don't have permission to delete work items");
    const subtasks = await deleteItem(c, r);
    await c.audit("work_item_deleted", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, type: r.type, ...(subtasks ? { subtasks } : {}) });
    return json({ ok: true });
  }

  m = path.match(new RegExp(`^/api/items/${KEY}/transitions$`));
  if (m && method === "GET") return json((await movesFor(c, await itemByKey(c, m[1]))).moves);
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    const b = await body<MoveRequest>(req);
    delete b.resolution;
    const res = await transitionItem(c, r, b);
    return json(await detail(c, res.after));
  }

  m = path.match(new RegExp(`^/api/items/${KEY}/clone$`));
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    if (c.guest || !(c.can("create_work_items") || (r.source === "client_request" && c.can("manage_features")))) {
      throw new HttpError(403, "You don't have permission to create work items");
    }
    const may = rights(c, r);
    const copy = await createItem(
      c,
      {
        systemId: r.system_id,
        type: r.type,
        summary: `CLONE - ${r.summary}`.slice(0, MAX_SUMMARY),
        description: r.description,
        priority: r.priority,
        assignee: may.assignOthers ? r.assignee : r.assignee === c.me.id ? c.me.id : null,
        parent: r.parent_id,
        labels: r.labels ? r.labels.split(",") : [],
        component: r.component,
        storyPoints: r.story_points,
        originalEstimate: r.original_estimate,
        startDate: r.start_date,
        dueDate: r.due_date,
        client: r.client,
      },
      r.source,
    );
    await db.prepare("INSERT INTO work_item_links (id, from_id, to_id, link_type, created_by, created_at) VALUES (?, ?, ?, 'CLONES', ?, ?)").bind(newToken().slice(0, 16), copy.id, r.id, c.me.id, c.now).run();
    await c.audit("work_item_created", copy.system_id, { name: copy.project_name, key: keyOf(copy), summary: copy.summary, type: copy.type, clonedFrom: keyOf(r) });
    return json(await detail(c, copy), 201);
  }

  // ----- comments -----
  m = path.match(new RegExp(`^/api/items/${KEY}/comments$`));
  if (m && method === "GET") {
    const r = await itemByKey(c, m[1]);
    const q = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || PAGE_SIZE));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const [rows, total] = await Promise.all([
      db.prepare("SELECT * FROM work_item_comments WHERE item_id = ? ORDER BY created_at, id LIMIT ? OFFSET ?").bind(r.id, limit, offset).all<Record<string, string | null>>(),
      db.prepare("SELECT COUNT(*) AS n FROM work_item_comments WHERE item_id = ?").bind(r.id).first<{ n: number }>(),
    ]);
    return json({
      comments: rows.results.map(
        (x): WorkComment => ({ id: x.id!, authorId: x.author_id!, body: x.body!, createdAt: x.created_at!, ...(x.updated_at ? { updatedAt: x.updated_at } : {}) }),
      ),
      total: Number(total?.n ?? 0),
      offset,
    });
  }
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    if (!rights(c, r).comment) throw new HttpError(403, "This link is view-only");
    const text = str((await body<{ body?: unknown }>(req)).body, "Comment", MAX_COMMENT, true)!;
    const id = newToken().slice(0, 16);
    await db.batch([
      db.prepare("INSERT INTO work_item_comments (id, item_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, r.id, c.me.id, text, c.now),
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").bind(c.now, r.id),
    ]);
    await c.audit("comment_added", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, comment: text.slice(0, 300) });
    const mentioned = await notifyMentions(c, r, text, "In a comment");
    await notifyWatchers(c, r, "New comment", mentioned);
    return json({ id, authorId: c.me.id, body: text, createdAt: c.now } satisfies WorkComment, 201);
  }
  m = path.match(new RegExp(`^/api/items/${KEY}/comments/([a-z0-9-]{4,40})$`));
  if (m && (method === "PATCH" || method === "DELETE")) {
    const r = await itemByKey(c, m[1]);
    const row = await db.prepare("SELECT * FROM work_item_comments WHERE id = ? AND item_id = ?").bind(m[2], r.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Comment not found");
    if (row.author_id !== c.me.id || c.guest) throw new HttpError(403, "You can only change your own comments");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM work_item_comments WHERE id = ?").bind(row.id).run();
      await c.audit("comment_deleted", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, comment: row.body.slice(0, 300) });
      return json({ ok: true });
    }
    const text = str((await body<{ body?: unknown }>(req)).body, "Comment", MAX_COMMENT, true)!;
    if (text === row.body) return json({ id: row.id, authorId: row.author_id, body: row.body, createdAt: row.created_at, ...(row.updated_at ? { updatedAt: row.updated_at } : {}) });
    await db.prepare("UPDATE work_item_comments SET body = ?, updated_at = ? WHERE id = ?").bind(text, c.now, row.id).run();
    await c.audit("comment_edited", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, from: row.body.slice(0, 300), to: text.slice(0, 300) });
    // Only people newly mentioned in the edit hear about it.
    const before = new Set(mentionsIn(row.body));
    const fresh = mentionsIn(text).filter((u) => !before.has(u));
    if (fresh.length) await notifyMentions(c, r, fresh.map((u) => `@${u}`).join(" "), "In an edited comment");
    return json({ id: row.id, authorId: row.author_id, body: text, createdAt: row.created_at, updatedAt: c.now } satisfies WorkComment);
  }

  // ----- watching -----
  m = path.match(new RegExp(`^/api/items/${KEY}/watch$`));
  if (m && (method === "POST" || method === "DELETE")) {
    const r = await itemByKey(c, m[1]);
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const res =
      method === "POST"
        ? await db.prepare("INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(r.id, c.me.id, c.now).run()
        : await db.prepare("DELETE FROM work_item_watchers WHERE item_id = ? AND user_id = ?").bind(r.id, c.me.id).run();
    if (res.meta.changes) {
      await c.audit(method === "POST" ? "work_item_watched" : "work_item_unwatched", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary });
    }
    return json({ watching: method === "POST" });
  }

  // ----- links -----
  m = path.match(new RegExp(`^/api/items/${KEY}/links$`));
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    if (!rights(c, r).edit) throw new HttpError(403, "Only people who can edit this work item can link it");
    const b = await body<{ type?: unknown; direction?: unknown; target?: unknown }>(req);
    const type = pick(b.type, LINK_TYPES, "link type");
    const target = await itemByKey(c, String(b.target ?? "").trim().toUpperCase()).catch(() => {
      throw new HttpError(400, "That work item doesn't exist");
    });
    if (target.id === r.id) throw new HttpError(400, "A work item can't link to itself");
    const [from, to] = b.direction === "inward" ? [target, r] : [r, target];
    const id = newToken().slice(0, 16);
    const res = await db
      .prepare("INSERT INTO work_item_links (id, from_id, to_id, link_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(id, from.id, to.id, type, c.me.id, c.now)
      .run();
    if (!res.meta.changes) throw new HttpError(409, "Those work items are already linked that way");
    const phrase = `${keyOf(from)} ${LINK_META[type].outward} ${keyOf(to)}`;
    await c.audit("link_added", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, link: phrase });
    await notifyWatchers(c, r, `Linked: ${phrase}`);
    return json({ id }, 201);
  }
  m = path.match(new RegExp(`^/api/items/${KEY}/links/([a-z0-9-]{4,40})$`));
  if (m && method === "DELETE") {
    const r = await itemByKey(c, m[1]);
    if (!rights(c, r).edit) throw new HttpError(403, "Only people who can edit this work item can unlink it");
    const link = await db
      .prepare("SELECT * FROM work_item_links WHERE id = ? AND (from_id = ? OR to_id = ?)")
      .bind(m[2], r.id, r.id)
      .first<{ id: string; from_id: string; to_id: string; link_type: LinkType }>();
    if (!link) throw new HttpError(404, "Link not found");
    const [from, to] = await Promise.all([itemById(c, link.from_id), itemById(c, link.to_id)]);
    await db.prepare("DELETE FROM work_item_links WHERE id = ?").bind(link.id).run();
    const phrase = `${from ? keyOf(from) : "?"} ${LINK_META[link.link_type].outward} ${to ? keyOf(to) : "?"}`;
    await c.audit("link_removed", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, link: phrase });
    await notifyWatchers(c, r, `Unlinked: ${phrase}`);
    return json({ ok: true });
  }

  // ----- attachments: documents that belong to the item -----
  m = path.match(new RegExp(`^/api/items/${KEY}/attachments$`));
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "Couldn't read the upload");
    });
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "Choose a file to upload");
    if (file.size === 0) throw new HttpError(400, "That file is empty");
    if (file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, `Files can be up to ${formatBytes(MAX_DOCUMENT_BYTES)}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = newToken().slice(0, 16);
    const name = (file.name || "attachment").slice(0, 200);
    const CHUNK = 1024 * 1024;
    const stmts = [
      db
        .prepare("INSERT INTO documents (id, system_id, name, kind, mime, size, uploaded_by, uploaded_at, work_item_id) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)")
        .bind(id, r.system_id, name, file.type || "application/octet-stream", bytes.length, c.me.id, c.now, r.id),
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").bind(c.now, r.id),
    ];
    for (let i = 0, seq = 0; i < bytes.length; i += CHUNK, seq++) {
      stmts.push(db.prepare("INSERT INTO document_chunks (doc_id, seq, data) VALUES (?, ?, ?)").bind(id, seq, bytes.slice(i, i + CHUNK)));
    }
    await db.batch(stmts);
    await c.audit("attachment_added", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, document: name, size: bytes.length });
    await notifyWatchers(c, r, `Attached ${name}`);
    return json({ id }, 201);
  }
  m = path.match(new RegExp(`^/api/items/${KEY}/attachments/([a-z0-9-]{4,40})$`));
  if (m && method === "DELETE") {
    const r = await itemByKey(c, m[1]);
    const doc = await db.prepare("SELECT id, name, uploaded_by FROM documents WHERE id = ? AND work_item_id = ?").bind(m[2], r.id).first<{ id: string; name: string; uploaded_by: string }>();
    if (!doc) throw new HttpError(404, "Attachment not found");
    if (c.guest || (doc.uploaded_by !== c.me.id && !rights(c, r).assignOthers)) throw new HttpError(403, "Only whoever attached it or someone who can edit any work item can remove it");
    await db.batch([db.prepare("DELETE FROM document_chunks WHERE doc_id = ?").bind(doc.id), db.prepare("DELETE FROM documents WHERE id = ?").bind(doc.id)]);
    await c.audit("attachment_removed", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, document: doc.name });
    return json({ ok: true });
  }

  // ----- time tracking -----
  m = path.match(new RegExp(`^/api/items/${KEY}/worklogs$`));
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    if (!rights(c, r).logTime) throw new HttpError(403, "You don't have permission to log time");
    const b = await body<{ minutes?: unknown; note?: unknown; date?: unknown; remaining?: unknown }>(req);
    const spent = minutes(b.minutes, "Time spent");
    if (!spent) throw new HttpError(400, "Enter the time spent, such as 1h 30m");
    if (spent > 24 * 60) throw new HttpError(400, "Log at most 24 hours at a time");
    const day = date(b.date, "Date") ?? c.now.slice(0, 10);
    if (day > new Date(Date.parse(c.now) + 86_400_000).toISOString().slice(0, 10)) throw new HttpError(400, "You can't log time in the future");
    const note = str(b.note, "Note", 1000) ?? "";
    // Remaining work goes down by what was logged, unless a new figure is given.
    const remaining =
      b.remaining !== undefined && b.remaining !== null && b.remaining !== ""
        ? minutes(b.remaining, "Remaining estimate")
        : r.remaining_estimate != null
          ? Math.max(0, Number(r.remaining_estimate) - spent)
          : null;
    const id = newToken().slice(0, 16);
    await db.batch([
      db.prepare("INSERT INTO work_logs (id, item_id, user_id, minutes, note, work_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, r.id, c.me.id, spent, note, day, c.now),
      db.prepare("UPDATE work_items SET remaining_estimate = ?, updated_at = ? WHERE id = ?").bind(remaining, c.now, r.id),
    ]);
    await c.audit("time_logged", r.system_id, {
      name: r.project_name,
      key: keyOf(r),
      summary: r.summary,
      minutes: spent,
      date: day,
      ...(note ? { note: note.slice(0, 200) } : {}),
      remaining: { from: r.remaining_estimate, to: remaining },
    });
    return json({ id }, 201);
  }
  m = path.match(new RegExp(`^/api/items/${KEY}/worklogs/([a-z0-9-]{4,40})$`));
  if (m && method === "DELETE") {
    const r = await itemByKey(c, m[1]);
    const log = await db.prepare("SELECT * FROM work_logs WHERE id = ? AND item_id = ?").bind(m[2], r.id).first<{ id: string; user_id: string; minutes: number; work_date: string }>();
    if (!log) throw new HttpError(404, "Work log not found");
    if (c.guest || (log.user_id !== c.me.id && !c.can("edit_work_items"))) throw new HttpError(403, "You can only remove time you logged");
    const remaining = r.remaining_estimate != null ? Number(r.remaining_estimate) + Number(log.minutes) : null;
    await db.batch([
      db.prepare("DELETE FROM work_logs WHERE id = ?").bind(log.id),
      db.prepare("UPDATE work_items SET remaining_estimate = ?, updated_at = ? WHERE id = ?").bind(remaining, c.now, r.id),
    ]);
    await c.audit("time_log_deleted", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, minutes: Number(log.minutes), date: log.work_date, time: formatMinutes(Number(log.minutes)) });
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found");
}

// ---------- Ask Pulse ----------

/**
 * Work items for Ask Pulse, within what the person may see: open items first by priority, then
 * recently finished ones. Kept short so answers start quickly.
 */
export async function askItemLines(c: ItemContext, nameOf: Map<string, string>, limit = 120): Promise<string[]> {
  const vis = visibility(c);
  const rows = await c.db
    .prepare(
      `${SELECT} WHERE ${vis.sql}
       ORDER BY CASE WHEN st.category = 'DONE' THEN 1 ELSE 0 END,
         ${PRIORITY_ORDER}, w.due_date NULLS LAST, w.updated_at DESC LIMIT ?`,
    )
    .bind(...vis.args, limit)
    .all<ItemRow>();
  const counts = await c.db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE st.category <> 'DONE') AS open FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE ${vis.sql}`,
    )
    .bind(...vis.args)
    .first<{ total: number; open: number }>();
  const lines = [
    "",
    `WORK ITEMS (${Number(counts?.open ?? 0)} open of ${Number(counts?.total ?? 0)}${c.ownOnly ? ", only those assigned to or reported by the person asking" : ""}; showing up to ${limit}, open first)`,
    "(key | type | summary | project | status | priority | assignee | due | parent | children done)",
  ];
  const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, n);
  for (const r of rows.results) {
    const s = toSummary(r);
    lines.push(
      [
        s.key,
        TYPE_META[s.type].label,
        clip(s.summary, 100),
        clip(r.project_name, 60),
        `${s.statusName}${s.resolution === "WONT_DO" ? " (won't do)" : ""}${s.onHold ? " (on hold)" : ""}`,
        s.priority.toLowerCase(),
        s.assignee ? (nameOf.get(s.assignee) ?? "unknown") : "unassigned",
        s.dueDate ?? "-",
        s.parentKey ?? "-",
        s.children ? `${s.children.done}/${s.children.total}` : "-",
      ].join(" | "),
    );
  }
  if (!rows.results.length) lines.push("none");
  return lines;
}
