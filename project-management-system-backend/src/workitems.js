/** @import { Alert, ChannelPost } from './notify' */
/** @import { Viewer } from './access' */
/** @import { Permission, Role } from '../../project-management-system-frontend/src/data/roles' */
/** @import { FeatureKind, FeatureStatus, Priority } from '../../project-management-system-frontend/src/data/features' */
/** @import { Attachment, LinkType, Resolution, StatusChange, WorkComment, WorkItem, WorkItemLink, WorkItemSummary, WorkItemType, WorkLog, WorkPriority, ItemMove, StatusCategory, WorkSource, WorkStatus } from '../../project-management-system-frontend/src/data/workitems' */
/** @import { MoveInput, Transition, Workflow } from '../../project-management-system-frontend/src/data/workflows' */
// Work items: the API under /api/items, and the shared code that feature requests (/api/features)
// run on too. Every rule is checked here: who may see, create, edit, delete, comment and log time,
// the Epic → Story/Task/Bug → Sub-task hierarchy, statuses and their categories, and numbering.
//
// Visibility: developers without "manage_features" see only the items assigned to them or that
// they reported, everywhere (lists, item pages, links, Ask AI, notifications), as with feature
// requests. A view-only link reads items and comments but never attachments, and changes nothing.
import { newToken } from "./auth";
import { indexLater } from "./docIndex";
import { HttpError, body, json } from "./http";
import { canSeeItem, itemAccess, levelsFor } from "./access";
import { notifyItem } from "./schemes";
import { customValuesFor, fieldsForSystem, planCustomValues } from "./customfields";
import { onRequestComment, onRequestMove, requestMoveProblem, requestDetail } from "./servicedesk";
import { devLinksFor } from "./integrations";
import { MAX_DOCUMENT_BYTES, formatBytes } from "../../project-management-system-frontend/src/data/project";
import { ITEM_KEY_PATTERN, KIND_LABELS, LINK_META, LINK_TYPES, MAX_COMMENT, MAX_DESCRIPTION, MAX_LABELS, MAX_SUMMARY, PAGE_SIZE, RESOLUTION_META, TYPE_META, WORK_PRIORITIES, WORK_TYPES, childTypesOf, cleanLabel, formatMinutes, mentionsIn, parentProblem } from "../../project-management-system-frontend/src/data/workitems";
import { checkTransition, needsInput, transitionsFrom } from "../../project-management-system-frontend/src/data/workflows";
import { initialStatus, loadWorkflow, workflowIdFor } from "./workflowData";
import { assignable } from "../../project-management-system-frontend/src/data/roles";
import { pendingApproval, requestApproval, viewOf as approvalView } from "./approvals";
import { slaFor } from "./sla";
/**
 * Everything a list or page needs about an item, in one query. Cancelled ("won't do") children don't count.
 */
export const SELECT = `SELECT w.*, st.name AS status_name, st.category AS status_category, it.name AS item_type_name,
  s.key AS project_key, (s.data::json ->> 'name') AS project_name, p.number AS parent_number,
  (SELECT string_agg(l.label, ',' ORDER BY l.label) FROM work_item_labels l WHERE l.item_id = w.id) AS labels,
  (SELECT COUNT(*) FROM work_items c WHERE c.parent_id = w.id AND COALESCE(c.resolution, '') <> 'WONT_DO') AS child_total,
  (SELECT COUNT(*) FROM work_items c JOIN work_statuses cs ON cs.id = c.status
     WHERE c.parent_id = w.id AND cs.category = 'DONE' AND COALESCE(c.resolution, '') <> 'WONT_DO') AS child_done
  FROM work_items w
  JOIN work_statuses st ON st.id = w.status
  JOIN systems s ON s.id = w.system_id
  LEFT JOIN work_items p ON p.id = w.parent_id
  LEFT JOIN item_types it ON it.workspace_id = w.workspace_id AND it.id = w.item_type`;
export const keyOf =
  /** @param {{ project_key: string; number: number }} r
   * @returns {string}
   */ (r) => `${r.project_key}-${r.number}`;
/**
 * @param {ItemRow} r
 * @returns {WorkItemSummary}
 */
export function toSummary(r) {
  return {
    id: r.id,
    key: keyOf(r),
    systemId: r.system_id,
    number: r.number,
    type: r.type,
    itemType: r.item_type ?? r.type,
    itemTypeName: r.item_type_name ?? TYPE_META[r.type]?.label ?? r.type,
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
    ...(r.security_level ? { securityLevel: r.security_level } : {}),
  };
}
/**
 * The item type a request names (the workspace's own, such as CAMPAIGN), or else the built-in type of the kind it
 * names (TASK), with the kind it is. A type that's switched off isn't offered for new items.
 * @param {ItemContext} c
 * @param {unknown} itemType
 * @param {unknown} kind
 * @param {boolean} [existing=false]  changing an existing item: a switched-off type is still refused
 * @returns {Promise<{ id: string; base: WorkItemType }>}
 */
export async function resolveItemType(c, itemType, kind, existing = false) {
  if (itemType !== undefined && itemType !== null && itemType !== "") {
    const t = /** @type {{ id: string; base: WorkItemType; name: string; active: number } | null} */ (
      await c.db.prepare("SELECT id, base, name, active FROM item_types WHERE id = ?").bind(String(itemType).toUpperCase().slice(0, 20)).first()
    );
    if (!t) throw new HttpError(400, "Unknown item type");
    if (!t.active) throw new HttpError(400, `${t.name} isn't offered for ${existing ? "items" : "new items"} in this workspace`);
    return { id: t.id, base: t.base };
  }
  const base = pick(kind ?? "TASK", WORK_TYPES, "type");
  return { id: base, base };
}
// ---------- reading ----------
/**
 * The SQL condition (and its values) that limits rows to what this person may see.
 * @param {ItemContext} c
 * @param {string} [alias="w"]
 * @returns {{ sql: string; args: unknown[] }}
 */
export function visibility(c, alias = "w") {
  return itemAccess(c.viewer, alias);
}
export const canSee =
  /** @param {ItemContext} c
   * @param {{ assignee: string | null; reporter: string; security_level?: string | null }} r
   * @returns {Promise<boolean>}
   */ (c, r) => canSeeItem(c.db, c.viewer, r);
/**
 * An item by its key (INFRA-12), or 404 when it doesn't exist or this person can't see it.
 * @param {ItemContext} c
 * @param {string} key
 * @returns {Promise<ItemRow>}
 */
export async function itemByKey(c, key) {
  const m = key.match(ITEM_KEY_PATTERN);
  if (!m) throw new HttpError(404, "Work item not found");
  const row = await /** @type {Promise<ItemRow | null>} */ (/** @type {unknown} */ (c.db.prepare(`${SELECT} WHERE s.key = ? AND w.number = ?`).bind(m[1], Number(m[2])).first()));
  if (!row || !(await canSee(c, row))) throw new HttpError(404, "Work item not found");
  return row;
}
/**
 * @param {ItemContext} c
 * @param {string} id
 * @returns {Promise<ItemRow | null>}
 */
export async function itemById(c, id) {
  return /** @type {Promise<ItemRow | null>} */ (/** @type {unknown} */ (c.db.prepare(`${SELECT} WHERE w.id = ?`).bind(id).first()));
}
const PRIORITY_ORDER = `CASE w.priority WHEN 'HIGHEST' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`;
/** @type {Record<string, string>} */ const SORTS = {
  key: "s.key, w.number",
  updated: "w.updated_at",
  created: "w.created_at",
  priority: PRIORITY_ORDER,
  due: "w.due_date",
  status: "CASE st.category WHEN 'TODO' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, st.position",
  summary: "lower(w.summary)",
  type: "CASE w.type WHEN 'EPIC' THEN 0 WHEN 'STORY' THEN 1 WHEN 'TASK' THEN 2 WHEN 'BUG' THEN 3 ELSE 4 END",
};
const list =
  /** @param {string | null} v
   * @returns {string[]}
   */ (v) =>
    v
      ? v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
const likeText =
  /** @param {string} q
   * @returns {string}
   */ (q) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
/**
 * GET /api/items: filtered, sorted, one page at a time. Never part of GET /api/data.
 * @param {ItemContext} c
 * @param {URLSearchParams} q
 * @returns {Promise<{ items: WorkItemSummary[]; total: number; offset: number; }>}
 */
async function listItems(c, q) {
  /** @type {string[]} */ const where = [];
  /** @type {unknown[]} */ const args = [];
  const add = /** @param {string} sql @param {...unknown} values */ (sql, ...values) => {
    where.push(sql);
    args.push(...values);
  };
  const vis = visibility(c);
  add(vis.sql, ...vis.args);
  const system = q.get("system");
  if (system) add("w.system_id = ?", system);
  const types = list(q.get("type")).filter((t) => /** @type {string[]} */ (WORK_TYPES).includes(t));
  if (types.length) add(`w.type IN (${types.map(() => "?").join(", ")})`, ...types);
  const statuses = list(q.get("status")).filter((t) => /^[A-Z][A-Z0-9_]{0,39}$/.test(t));
  if (statuses.length) add(`w.status IN (${statuses.map(() => "?").join(", ")})`, ...statuses);
  const priorities = list(q.get("priority")).filter((t) => /** @type {string[]} */ (WORK_PRIORITIES).includes(t));
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
  if (source === "client_request" || source === "internal" || source === "service_desk") add("w.source = ?", source);
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
  const sortKey = SORTS[q.get("sort") ?? ""] ? /** @type {string} */ (q.get("sort")) : "key";
  const dir = q.get("dir") === "asc" ? "ASC" : q.get("dir") === "desc" ? "DESC" : sortKey === "updated" || sortKey === "created" ? "DESC" : "ASC";
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || PAGE_SIZE));
  const offset = Math.max(0, Number(q.get("offset")) || 0);
  const rows = await /** @type {Promise<D1Result<ItemRow & { total_count: number; }>>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(
          `${SELECT.replace("SELECT w.*,", "SELECT COUNT(*) OVER () AS total_count, w.*,")} WHERE ${where.join(" AND ")}
       ORDER BY ${SORTS[sortKey]} ${dir} NULLS LAST, s.key, w.number LIMIT ? OFFSET ?`,
        )
        .bind(...args, limit, offset)
        .all()
    )
  );
  const total = rows.results[0]?.total_count ?? (offset ? Number((await countOnly(c, where, args)) ?? 0) : 0);
  return { items: rows.results.map(toSummary), total: Number(total), offset };
}
/**
 * @param {ItemContext} c
 * @param {string[]} where
 * @param {unknown[]} args
 * @returns {Promise<number | undefined>}
 */
async function countOnly(c, where, args) {
  const r = await /** @type {Promise<{ n: number; } | null>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(`SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id WHERE ${where.join(" AND ")}`)
        .bind(...args)
        .first()
    )
  );
  return r?.n;
}
/**
 * Who may do what to one item.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {{ edit: boolean; delete: boolean; comment: boolean; logTime: boolean; assignOthers: boolean; replyToCustomer: boolean; }}
 */
function rights(c, r) {
  const fullEditor = !c.guest && (c.can("edit_work_items") || (r.source === "client_request" && c.can("manage_features")));
  const reporterMay = r.reporter === c.me.id && (c.can("create_work_items") || (r.source === "client_request" && c.can("log_features")));
  return {
    edit: !c.guest && (fullEditor || r.assignee === c.me.id || reporterMay),
    delete: !c.guest && (c.can("delete_work_items") || (r.source === "client_request" && c.can("manage_features"))),
    comment: !c.guest,
    logTime: !c.guest && c.can("log_time"),
    assignOthers: fullEditor,
    replyToCustomer: !c.guest && r.source === "service_desk" && c.can("work_service_desk"),
  };
}
/**
 * The full item page: the item, its family, links, people, files, time and status history.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {Promise<WorkItem>}
 */
async function detail(c, r) {
  const vis = visibility(c);
  const [levels, myLevels, fieldDefs] = await Promise.all([/** @type {Promise<D1Result<{ id: string; name: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id, name FROM security_levels ORDER BY position, name").all())), levelsFor(c.db, c.viewer), fieldsForSystem(c.db, r.system_id)]);
  const levelName = r.security_level ? levels.results.find((l) => l.id === r.security_level)?.name : undefined;
  const [children, parent, links, watchers, attachments, logs, history, comments] = await Promise.all([
    /** @type {Promise<D1Result<ItemRow>>} */ (
      /** @type {unknown} */ (
        c.db
          .prepare(`${SELECT} WHERE w.parent_id = ? AND ${vis.sql} ORDER BY w.number`)
          .bind(r.id, ...vis.args)
          .all()
      )
    ),
    r.parent_id ? /** @type {Promise<ItemRow | null>} */ (/** @type {unknown} */ (c.db.prepare(`${SELECT} WHERE w.id = ?`).bind(r.parent_id).first())) : Promise.resolve(null),
    /** @type {Promise<D1Result<ItemRow & { link_id: string; link_type: LinkType; direction: "outward" | "inward"; }>>} */ (
      /** @type {unknown} */ (
        c.db
          .prepare(
            `SELECT k.id AS link_id, k.link_type, CASE WHEN k.from_id = ? THEN 'outward' ELSE 'inward' END AS direction, x.*
         FROM work_item_links k
         JOIN (${SELECT}) x ON x.id = CASE WHEN k.from_id = ? THEN k.to_id ELSE k.from_id END
         WHERE k.from_id = ? OR k.to_id = ? ORDER BY k.created_at`,
          )
          .bind(r.id, r.id, r.id, r.id)
          .all()
      )
    ),
    /** @type {Promise<D1Result<{ user_id: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ? ORDER BY created_at").bind(r.id).all())),
    c.guest
      ? Promise.resolve({ results: /** @type {Record<string, string | number>[]} */ ([]) })
      : /** @type {Promise<D1Result<Record<string, string | number>>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id, name, mime, size, uploaded_by, uploaded_at FROM documents WHERE work_item_id = ? ORDER BY uploaded_at").bind(r.id).all())),
    /** @type {Promise<D1Result<Record<string, string | number>>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT * FROM work_logs WHERE item_id = ? ORDER BY work_date DESC, created_at DESC").bind(r.id).all())),
    /** @type {Promise<D1Result<Record<string, string | null>>>} */ (
      /** @type {unknown} */ (
        c.db
          .prepare(
            `SELECT h.*, f.name AS from_name, t.name AS to_name FROM status_history h
         LEFT JOIN work_statuses f ON f.id = h.from_status LEFT JOIN work_statuses t ON t.id = h.to_status
         WHERE h.item_id = ? ORDER BY h.id`,
          )
          .bind(r.id)
          .all()
      )
    ),
    /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT COUNT(*) AS n FROM work_item_comments WHERE item_id = ?").bind(r.id).first())),
  ]);
  /** @type {WorkLog[]} */ const workLogs = logs.results.map((l) => ({
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
    ...(parent && (await canSee(c, parent)) ? { parent: toSummary(parent) } : {}),
    childItems: children.results.map(toSummary),
    links: (await Promise.all(links.results.map(async (l) => ((await canSee(c, l)) ? l : null)))).filter((l) => l !== null).map(/** @returns {WorkItemLink} */ (l) => ({ id: l.link_id, type: l.link_type, direction: l.direction, item: toSummary(l) })),
    watchers: watchers.results.map((w) => w.user_id),
    watching: watchers.results.some((w) => w.user_id === c.me.id),
    attachments: attachments.results.map(
      /** @returns {Attachment} */ (a) => ({
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
      /** @returns {StatusChange} */ (h) => ({
        ...(h.from_status ? { from: h.from_status, fromName: h.from_name ?? h.from_status } : {}),
        to: /** @type {NonNullable<typeof h.to_status>} */ (h.to_status),
        toName: h.to_name ?? /** @type {NonNullable<typeof h.to_status>} */ (h.to_status),
        ...(h.changed_by ? { by: h.changed_by } : {}),
        at: /** @type {NonNullable<typeof h.changed_at>} */ (h.changed_at),
      }),
    ),
    commentCount: Number(comments?.n ?? 0),
    can: rights(c, r),
    ...(await movesFor(c, r)),
    ...(levelName ? { securityLevelName: levelName } : {}),
    securityLevels: c.guest ? [] : levels.results.filter((l) => myLevels.includes(l.id)),
    // Only the fields for this item's type.
    fieldDefs: fieldDefs.filter((f) => !f.itemTypes || f.itemTypes.includes(r.item_type)),
    fieldValues: (await customValuesFor(c.db, [r.id])).get(r.id) ?? [],
    devLinks: c.guest ? [] : await devLinksFor(c.db, r.id),
    // A move waiting for approval, and the item's SLA (worker/approvals.js, worker/sla.js).
    ...(await (async () => {
      const p = await pendingApproval(c.db, r.id);
      return p ? { approval: await approvalView(c.db, p) } : {};
    })()),
    ...(await slaFor(c.db, r).then((sla) => (sla ? { sla } : {}), () => ({}))),
    ...(r.source === "service_desk" ? { request: await requestDetail(c, r) } : {}),
  };
}
// ---------- workflow transitions ----------
/**
 * The item as the workflow rules read it.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {Promise<{ status: string; assignee: string | null; reporter: string; description: string; dueDate: string | null; startDate: string | null; storyPoints: number | null; originalEstimate: number | null; component: string | null; labels: string[]; openSubtasks: number; }>}
 */
async function forCheck(c, r) {
  const open = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.parent_id = ? AND w.type = 'SUBTASK' AND st.category <> 'DONE'").bind(r.id).first()));
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
/**
 * The moves out of the item's status, each with whether this person may make it and what it needs.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {Promise<{ workflowId: string; moves: ItemMove[] }>}
 */
async function movesFor(c, r) {
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, r.system_id, r.item_type));
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
/**
 * @param {ItemContext} c
 * @returns {Promise<Map<string, { id: string; name: string; category: StatusCategory; }>>}
 */
async function statusNames(c) {
  const rows = await /** @type {Promise<D1Result<{ id: string; name: string; category: StatusCategory; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id, name, category FROM work_statuses").all()));
  return new Map(rows.results.map((x) => [x.id, x]));
}
/**
 * Someone who has `role`: the project's lead first, then its developers, then anyone, by name.
 * @param {ItemContext} c
 * @param {string} role
 * @param {string} systemId
 * @returns {Promise<string | null>}
 */
export async function personWithRole(c, role, systemId) {
  const row = await /** @type {Promise<{ id: string; } | null>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(
          `SELECT u.id FROM users u WHERE u.role = ?
       ORDER BY (u.id = (SELECT s.data::json ->> 'lead' FROM systems s WHERE s.id = ?))::int DESC,
         EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id AND a.system_id = ?)::int DESC, u.name LIMIT 1`,
        )
        .bind(role, systemId, systemId)
        .first()
    )
  );
  return row?.id ?? null;
}
/**
 * Makes one move in the item's workflow: checks the conditions and validators, applies any fields
 * given with it, adds the comment, runs the post-functions, logs it and tells people. Returns the change.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {MoveRequest} m
 * @param {{ log?: boolean; quiet?: boolean; approved?: boolean }} [opts={}]  approved: an approval was granted for this move (worker/approvals.js), so it's made as asked
 * @returns {Promise<ChangeResult>}
 */
export async function transitionItem(c, r, m, opts = {}) {
  // quiet: a step on the way somewhere else (a feature request's status walk). Only the last step tells
  // people and updates the project's progress; every step still records its history.
  const log = opts.log ?? true;
  const may = rights(c, r);
  // An approved move was checked when it was asked for; the approver needn't be someone who could make it.
  if (!opts.approved && !may.edit) throw new HttpError(403, "Only the assignee, the reporter or someone who can edit any work item can move this");
  // While an approval is pending, the item waits.
  if (!opts.approved && (await pendingApproval(c.db, r.id))) throw new HttpError(409, "This item is waiting for an approval. Cancel it to move it another way.", "approval_pending");
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, r.system_id, r.item_type));
  const options = transitionsFrom(wf, r.status);
  /** @type {Transition | undefined} */ const t = m.transitionId ? options.find((x) => x.id === m.transitionId) : options.find((x) => x.to === m.to);
  const names = await statusNames(c);
  if (!t) {
    const to = names.get(String(m.to ?? ""))?.name ?? "that status";
    throw new HttpError(400, `The ${wf.name} workflow doesn't allow a move from ${r.status_name} to ${to}`, "transition_not_allowed");
  }
  const comment = typeof m.comment === "string" ? m.comment.trim().slice(0, MAX_COMMENT) : "";
  const fields = m.fields && typeof m.fields === "object" ? m.fields : {};
  const check = checkTransition(t, await forCheck(c, r), c.me, { comment, fields });
  if (!check.allowed && !opts.approved) throw new HttpError(403, check.reason ?? "You can't make that move", "transition_condition");
  if (needsInput(check)) {
    const wants = [...(check.needs.comment ? ["a comment"] : []), ...(check.needs.assignee ? ["an assignee"] : []), ...check.needs.fields.map((f) => f)];
    throw new HttpError(400, `"${t.name}" needs ${wants.join(", ")} first`, "transition_needs", { needs: check.needs, transition: t.id });
  }
  if (fields.assignee !== undefined && !may.assignOthers && !opts.approved) {
    const to = /** @type {string | null} */ (fields.assignee || null);
    if (to && to !== c.me.id) throw new HttpError(403, "You can assign a work item to yourself only");
  }
  // A move that needs approval waits for it instead (worker/approvals.js).
  if (!opts.approved && t.rules.some((x) => x.kind === "validator" && x.rule === "approval")) {
    const approval = await requestApproval(c, r, t, { comment, fields: /** @type {Record<string, unknown>} */ (fields) });
    return { before: r, after: r, changed: [], diff: {}, pendingApproval: approval };
  }
  /** @type {ItemPatch} */ const patch = { ...fields, status: t.to };
  for (const rule of t.rules.filter((x) => x.kind === "post_function")) {
    if (rule.rule === "assign_user" && rule.value) {
      const u = await /** @type {Promise<{ role: Role; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT role FROM users WHERE id = ?").bind(rule.value).first()));
      if (u && assignable(u.role)) patch.assignee = rule.value;
    }
    if (rule.rule === "assign_role" && rule.value) patch.assignee = (await personWithRole(c, rule.value, r.system_id)) ?? patch.assignee;
    if (rule.rule === "assign_reporter") patch.assignee = r.reporter;
    if (rule.rule === "clear_assignee") patch.assignee = null;
    if (rule.rule === "clear_field" && rule.value) {
      const empty = { description: "", dueDate: null, startDate: null, storyPoints: null, originalEstimate: null, component: null, labels: [] };
      if (rule.value in empty) /** @type {Record<string, unknown>} */ (patch)[rule.value] = /** @type {Record<string, unknown>} */ (empty)[rule.value];
    }
    if (rule.rule === "set_resolution" && (rule.value === "DONE" || rule.value === "WONT_DO")) patch.resolution = rule.value;
  }
  if (m.resolution) patch.resolution = m.resolution;
  // A client request goes to developers only: a post-function can't hand it to anyone else.
  if (r.source === "client_request" && patch.assignee && patch.assignee !== fields.assignee) {
    const u = await /** @type {Promise<{ role: Role; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT role FROM users WHERE id = ?").bind(patch.assignee).first()));
    if (u?.role !== "developer") delete patch.assignee;
  }
  // A Change request is resolved only through Change Approval (worker/servicedesk.ts).
  if (r.source === "service_desk") {
    const problem = await requestMoveProblem(c, r, r.status, t.to, names.get(t.to)?.category ?? "TODO");
    if (problem) throw new HttpError(400, problem, "change_approval");
  }
  const res = await applyChange(c, r, patch, true);
  if (r.source === "service_desk" && res.changed.includes("status")) await onRequestMove(c, r, res.after);
  if (comment) await addComment(c, res.after, comment, { transition: t.name });
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
  const extra = /** @type {Set<string>} */ (/** @type {unknown} */ (new Set()));
  for (const v of notify) {
    if (v === "assignee" && res.after.assignee) extra.add(res.after.assignee);
    if (v === "reporter") extra.add(res.after.reporter);
    if (v.startsWith("role:")) {
      const ids = await /** @type {Promise<D1Result<{ id: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id FROM users WHERE role = ?").bind(v.slice(5)).all()));
      ids.results.forEach((u) => extra.add(u.id));
    }
  }
  // The move's own "notify" people are told whatever the scheme says, if they may see the item.
  await afterChange(c, res, true, [...extra], `${t.name}: now ${res.after.status_name}`);
  if (res.changed.includes("status")) {
    c.emit?.({ type: "item_transitioned", itemId: r.id, from: r.status, to: res.after.status });
    if (res.after.type === "SUBTASK" && res.after.parent_id && res.after.status_category === "DONE") {
      const open = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.parent_id = ? AND w.type = 'SUBTASK' AND st.category <> 'DONE'").bind(res.after.parent_id).first()));
      if (!Number(open?.n)) c.emit?.({ type: "subtasks_done", itemId: res.after.parent_id });
    }
  }
  return res;
}
const TESTING_NAME = /review|test|approval/i;
/**
 * A feature request's status, as a status in the project's workflow: where the request should end up.
 * Returns null when it is already there.
 * @param {ItemContext} c
 * @param {Workflow} wf
 * @param {ItemRow} r
 * @param {FeatureStatus} status
 * @returns {Promise<string | null>}
 */
async function featureTarget(c, wf, r, status) {
  const names = await statusNames(c);
  const inWf = wf.statuses.map((s) => /** @type {{ id: string; name: string; category: StatusCategory; }} */ (names.get(s.id))).filter(Boolean);
  const cat = /** @param {StatusCategory} k */ (k) => inWf.filter((s) => s.category === k);
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
      return current?.category === "DONE" ? null : (cat("DONE")[0]?.id ?? null);
    case "ON_HOLD":
      return current?.category === "DONE" ? ((cat("IN_PROGRESS")[0] ?? cat("TODO")[0])?.id ?? null) : null;
  }
}
/**
 * Moves a feature request to the status its old status names, through the moves its project's
 * workflow allows this person to make (the shortest way there). Refuses when there is no such way.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {FeatureStatus} status
 * @returns {Promise<ItemRow>}
 */
export async function moveFeatureTo(c, r, status) {
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, r.system_id, r.item_type));
  const target = await featureTarget(c, wf, r, status);
  let row = r;
  if (target) {
    // Breadth-first over the moves this person may make without giving anything more.
    const item = await forCheck(c, r);
    const prev = /** @type {Map<string, { from: string; t: Transition; } | null>} */ (/** @type {unknown} */ (new Map([[r.status, null]])));
    const queue = [r.status];
    while (queue.length && !prev.has(target)) {
      const at = /** @type {string} */ (queue.shift());
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
      throw new HttpError(400, `The ${wf.name} workflow doesn't let you move this request from ${r.status_name} to ${name} directly. Open work item ${keyOf(r)} to move it step by step.`, "transition_not_allowed");
    }
    /** @type {Transition[]} */ const steps = [];
    for (let at = target; prev.get(at); at = /** @type {{ from: string; t: Transition; }} */ (prev.get(at)).from) steps.unshift(/** @type {{ from: string; t: Transition; }} */ (prev.get(at)).t);
    for (const [i, t] of steps.entries()) {
      const last = i === steps.length - 1;
      row = (await transitionItem(c, row, { transitionId: t.id, ...(last && status === "CANCELLED" ? { resolution: /** @type {const} */ ("WONT_DO") } : {}) }, { log: false, quiet: !last })).after;
    }
  } else if ((status === "CANCELLED" || status === "COMPLETED") && row.status_category === "DONE") {
    row = (await applyChange(c, row, { resolution: status === "CANCELLED" ? "WONT_DO" : "DONE" }, true)).after;
  }
  const hold = status === "ON_HOLD";
  if (!!row.on_hold !== hold && row.status_category !== "DONE") row = (await applyChange(c, row, { onHold: hold })).after;
  return row;
}
// ---------- validation ----------
/**
 * A security level this person may give an item: one they belong to (administrators: any). "" or null: none.
 * @param {ItemContext} c
 * @param {unknown} v
 * @returns {Promise<string | null>}
 */
async function checkLevel(c, v) {
  if (v === undefined || v === null || v === "") return null;
  const id = String(v);
  if (!(await levelsFor(c.db, c.viewer)).includes(id)) throw new HttpError(400, "Choose a security level you belong to");
  return id;
}
/**
 * @param {unknown} v
 * @param {string} field
 * @param {number} max
 * @param {boolean} [required=false]
 * @returns {string | null}
 */
function str(v, field, max, required = false) {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${field} can be up to ${max.toLocaleString("en-GB")} characters`);
  return t;
}
/**
 * @template {string} T
 * @param {unknown} v
 * @param {readonly T[]} allowed
 * @param {string} field
 * @returns {T}
 */
function pick(v, allowed, field) {
  if (!allowed.includes(/** @type {T} */ (v))) throw new HttpError(400, `Unknown ${field}`);
  return /** @type {T} */ (v);
}
/**
 * @param {unknown} v
 * @param {string} field
 * @returns {string | null}
 */
function date(v, field) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} must be a date`);
  return v;
}
/**
 * Minutes (a whole number, 0 to 10 years of 8-hour days), or null to clear.
 * @param {unknown} v
 * @param {string} field
 * @returns {number | null}
 */
function minutes(v, field) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10 * 260 * 480) throw new HttpError(400, `${field} must be a length of time`);
  return Math.round(n);
}
/**
 * @param {unknown} v
 * @returns {number | null}
 */
function points(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999) throw new HttpError(400, "Story points must be a number from 0 to 999");
  return Math.round(n * 10) / 10;
}
/**
 * @param {unknown} v
 * @returns {string[]}
 */
function labels(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, "Labels must be a list");
  const out = [...new Set(v.map((x) => cleanLabel(String(x))).filter(Boolean))];
  if (out.length > MAX_LABELS) throw new HttpError(400, `Up to ${MAX_LABELS} labels`);
  return out;
}
/**
 * An assignee: a person who can do work (not a Standard user). Client requests go to developers only, as before.
 * @param {ItemContext} c
 * @param {unknown} v
 * @param {WorkSource} source
 * @returns {Promise<string | null>}
 */
async function checkAssignee(c, v, source) {
  const id = str(v, "Assignee", 64);
  if (!id) return null;
  const u = await /** @type {Promise<{ role: Role; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT role FROM users WHERE id = ?").bind(id).first()));
  if (!u) throw new HttpError(400, "Unknown assignee");
  if (source === "client_request" && u.role !== "developer") throw new HttpError(400, "Only users with the developer role can be assigned");
  if (!assignable(u.role)) throw new HttpError(400, "Standard users and Viewers can't be assigned work");
  return id;
}
/**
 * A parent for `type` in project `systemId`: it must exist there, be visible, and fit the hierarchy.
 * @param {ItemContext} c
 * @param {unknown} v
 * @param {WorkItemType} type
 * @param {string} systemId
 * @param {string} [selfId]
 * @returns {Promise<ItemRow | null>}
 */
async function checkParent(c, v, type, systemId, selfId) {
  const ref = str(v, "Parent", 40);
  /** @type {ItemRow | null} */ let parent = null;
  if (ref) {
    parent = ITEM_KEY_PATTERN.test(ref) ? await itemByKey(c, ref).catch(() => null) : await itemById(c, ref);
    if (!parent || !(await canSee(c, parent))) throw new HttpError(400, "That parent work item doesn't exist");
    if (parent.system_id !== systemId) throw new HttpError(400, "The parent must be in the same project");
    if (selfId && parent.id === selfId) throw new HttpError(400, "A work item can't be its own parent");
  }
  const problem = parentProblem(type, parent?.type ?? null);
  if (problem) throw new HttpError(400, problem);
  return parent;
}
// ---------- notifications ----------
// Who hears about what is set by the notification schemes (worker/schemes.ts), which also check that
// each person may see the item and hasn't opted out. Your own changes don't notify you.
/** The ids of the people @mentioned in `text`.
 * @param {ItemContext} c
 * @param {string} text
 * @returns {Promise<string[]>}
 */
async function mentionIds(c, text) {
  const names = mentionsIn(text);
  if (!names.length) return [];
  const people = await /** @type {Promise<D1Result<{ id: string; }>>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(`SELECT id FROM users WHERE lower(username) IN (${names.map(() => "?").join(", ")})`)
        .bind(...names)
        .all()
    )
  );
  return people.results.map((p) => p.id);
}
/**
 * A change other than a field edit or a move (a link, an attachment): the "changed" event.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {string} what
 * @param {string[]} [skip=[]]
 * @returns {Promise<void>}
 */
async function notifyWatchers(c, r, what, skip = []) {
  await notifyItem(c, "item_updated", r, { title: `${keyOf(r)} ${r.summary}`, body: `${what} by ${c.me.name}.`, skip });
}
// ---------- project progress from work items ----------
/**
 * For a project that takes its progress from its work items: the share of its stories, tasks and
 * bugs that are done (epics and sub-tasks are rolled up inside those; cancelled ones don't count).
 * @param {ItemContext} c
 * @param {string} systemId
 * @returns {Promise<void>}
 */
export async function recomputeProgress(c, systemId) {
  const sys = await /** @type {Promise<{ data: string; progress_from_items: number; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT data, progress_from_items FROM systems WHERE id = ?").bind(systemId).first()));
  if (!sys || !sys.progress_from_items) return;
  const n = /** @type {{ total: number; done: number; }} */ (
    await /** @type {Promise<{ total: number; done: number; } | null>} */ (
      /** @type {unknown} */ (
        c.db
          .prepare(
            `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE st.category = 'DONE') AS done
       FROM work_items w JOIN work_statuses st ON st.id = w.status
       WHERE w.system_id = ? AND w.type IN ('STORY', 'TASK', 'BUG') AND COALESCE(w.resolution, '') <> 'WONT_DO'`,
          )
          .bind(systemId)
          .first()
      )
    )
  );
  const progress = Number(n.total) ? Math.round((Number(n.done) / Number(n.total)) * 100) : 0;
  const data = /** @type {{ name: string; progress: number; status: string; health?: string }} */ (JSON.parse(sys.data));
  if (data.progress === progress) return;
  const from = { progress: data.progress, status: data.status, health: data.health ?? null };
  const next = { ...data, progress, updatedAt: c.now };
  await c.db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(next), systemId).run();
  await c.audit("system_progress", systemId, { name: data.name, from, to: { ...from, progress }, fromWorkItems: true });
}
/** @type {Record<string, string>} */ const FIELD_LABEL = {
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
  securityLevel: "Security level",
};
/**
 * Validates and saves a change to one item: hierarchy, statuses and resolution, labels, numbering
 * on a move, status history and watchers, in one transaction. Permission checks are the caller's.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {ItemPatch} b
 * @param {boolean} [viaTransition=false]
 * @returns {Promise<ChangeResult>}
 */
export async function applyChange(c, r, b, viaTransition = false) {
  if (b.status !== undefined && b.status !== r.status && !viaTransition) {
    throw new HttpError(400, "Statuses change through the workflow's moves", "use_transition");
  }
  const next = { ...r };
  let nextLabels = r.labels ? r.labels.split(",") : [];
  if (b.summary !== undefined) next.summary = /** @type {string} */ (str(b.summary, "Summary", MAX_SUMMARY, true));
  if (b.description !== undefined) next.description = str(b.description, "Description", MAX_DESCRIPTION) ?? "";
  if (b.itemType !== undefined) {
    const t = await resolveItemType(c, b.itemType, undefined, true);
    next.item_type = t.id;
    next.type = t.base;
  } else if (b.type !== undefined) {
    next.type = pick(b.type, WORK_TYPES, "type");
    // A new kind without a type named: that kind's built-in type.
    if (next.type !== r.type) next.item_type = next.type;
  }
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
  if (b.securityLevel !== undefined) {
    const mine = await levelsFor(c.db, c.viewer);
    // Only people at an item's level (and administrators) may lift it or move it to another.
    if (r.security_level && !mine.includes(r.security_level) && (b.securityLevel || null) !== r.security_level) {
      throw new HttpError(403, "Only people at this item's security level can change it");
    }
    next.security_level = await checkLevel(c, b.securityLevel);
  }
  if (next.start_date && next.due_date && next.start_date > next.due_date) throw new HttpError(400, "The start date must be on or before the due date");
  // Moving to another project: a new number there; it leaves its parent behind.
  let moving = false;
  if (b.systemId !== undefined && b.systemId !== r.system_id) {
    const target = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id FROM systems WHERE id = ?").bind(String(b.systemId)).first()));
    if (!target) throw new HttpError(404, "Project not found");
    if (Number(r.child_total) || (await c.db.prepare("SELECT 1 FROM work_items WHERE parent_id = ?").bind(r.id).first())) {
      throw new HttpError(400, "Move or remove its child work items first");
    }
    next.system_id = target.id;
    next.parent_id = null;
    moving = true;
    // Its status, in the new project's workflow: the same one if it has it, else the first of the same kind.
    const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, target.id, next.item_type));
    if (!wf.statuses.some((x) => x.id === r.status)) {
      const names = await statusNames(c);
      next.status = wf.statuses.find((x) => names.get(x.id)?.category === r.status_category)?.id ?? initialStatus(wf);
    }
  }
  // A new item type with a workflow of its own: the item keeps its status if that workflow has it, else takes the
  // first of the same kind there (as when moving to another project).
  if (!moving && next.item_type !== r.item_type) {
    const [from, to] = await Promise.all([workflowIdFor(c.db, r.system_id, r.item_type), workflowIdFor(c.db, r.system_id, next.item_type)]);
    if (from !== to) {
      const wf = await loadWorkflow(c.db, to);
      if (!wf.statuses.some((x) => x.id === r.status)) {
        const names = await statusNames(c);
        next.status = wf.statuses.find((x) => names.get(x.id)?.category === r.status_category)?.id ?? initialStatus(wf);
      }
    }
  }
  // The hierarchy: a new parent, or the same parent under a new type, must fit.
  if (b.parent !== undefined && !moving) {
    const parent = await checkParent(c, b.parent, next.type, next.system_id, r.id);
    next.parent_id = parent?.id ?? null;
    if (parent && parent.parent_id === r.id) throw new HttpError(400, "A work item can't sit under its own child");
  } else if (b.type !== undefined && next.type !== r.type) {
    const parentType = r.parent_id ? ((await /** @type {Promise<{ type: WorkItemType; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT type FROM work_items WHERE id = ?").bind(r.parent_id).first())))?.type ?? null) : null;
    const problem = parentProblem(next.type, moving ? null : parentType);
    if (problem) throw new HttpError(400, `${problem}. Change the parent first`);
  }
  if (next.type !== r.type) {
    const kids = await /** @type {Promise<D1Result<{ type: WorkItemType; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT DISTINCT type FROM work_items WHERE parent_id = ?").bind(r.id).all()));
    const allowed = childTypesOf(next.type);
    if (kids.results.some((k) => !allowed.includes(k.type))) {
      throw new HttpError(400, `It has child work items that can't sit under a ${TYPE_META[next.type].label.toLowerCase()}`);
    }
  }
  // Status, resolution and the dates that go with them.
  if (b.status !== undefined) next.status = String(b.status);
  const names = await statusNames(c);
  if (!names.has(next.status)) throw new HttpError(400, "Unknown status");
  const doneNow = /** @type {{ id: string; name: string; category: StatusCategory; }} */ (names.get(next.status)).category === "DONE";
  const doneBefore = r.status_category === "DONE";
  if (b.resolution !== undefined && b.resolution !== null && b.resolution !== "") next.resolution = pick(b.resolution, /** @type {Resolution[]} */ (Object.keys(RESOLUTION_META)), "resolution");
  if (doneNow) {
    if (!next.resolution) next.resolution = "DONE";
    if (!doneBefore || !next.resolved_at) next.resolved_at = c.now;
    next.on_hold = 0;
  } else {
    next.resolution = null;
    next.resolved_at = null;
  }
  const field = /** @param {keyof ItemRow} k */ (k) => next[k] !== r[k];
  /** @type {[string, unknown, unknown][]} */ const changes = [];
  const track = /** @param {string} name @param {unknown} from @param {unknown} to */ (name, from, to) => {
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes.push([name, from ?? null, to ?? null]);
  };
  track("summary", r.summary, next.summary);
  track("description", r.description.slice(0, 300), next.description.slice(0, 300));
  if (field("description") && !changes.some((x) => x[0] === "description")) changes.push(["description", "(longer text)", "(changed)"]);
  track("type", r.type, next.type);
  if (next.item_type !== r.item_type) track("itemType", r.item_type, next.item_type);
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
  track("securityLevel", r.security_level, next.security_level);
  // Custom fields: each changed one is logged as "field:<name>".
  const custom = b.customFields !== undefined ? await planCustomValues(c, r.id, next.system_id, b.customFields, "edit", next.item_type) : null;
  if (custom) changes.push(...custom.changes);
  if (!changes.length) return { before: r, after: r, changed: [], diff: {} };
  next.updated_at = c.now;
  const db = c.db;
  /** @type {D1PreparedStatement[]} */ const stmts = [];
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
        `UPDATE work_items SET type = ?, item_type = ?, parent_id = ?, summary = ?, description = ?, status = ?, resolution = ?, on_hold = ?,
           priority = ?, assignee = ?, component = ?, story_points = ?, original_estimate = ?, remaining_estimate = ?,
           start_date = ?, due_date = ?, client = ?, notes = ?, updated_at = ?, resolved_at = ?, security_level = ? WHERE id = ?`,
      )
      .bind(
        next.type,
        next.item_type,
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
        next.security_level,
        r.id,
      ),
  );
  if (custom) stmts.push(...custom.stmts);
  if (changes.some((x) => x[0] === "labels")) {
    stmts.push(db.prepare("DELETE FROM work_item_labels WHERE item_id = ?").bind(r.id));
    for (const l of nextLabels) stmts.push(db.prepare("INSERT INTO work_item_labels (item_id, label) VALUES (?, ?)").bind(r.id, l));
  }
  if (next.status !== r.status) {
    stmts.push(db.prepare("INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)").bind(r.id, r.status, next.status, c.me.id, c.now));
  }
  // A new assignee watches the item.
  if (next.assignee && next.assignee !== r.assignee) {
    stmts.push(db.prepare("INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(r.id, next.assignee, c.now));
  }
  await db.batch(stmts);
  const after = /** @type {ItemRow} */ (await itemById(c, r.id));
  const diff = Object.fromEntries(changes.map(([k, from, to]) => [k, { from, to }]));
  if (moving) diff.key = { from: keyOf(r), to: keyOf(after) };
  return { before: r, after, changed: changes.map((x) => x[0]), diff };
}
/**
 * After a change: alerts for a new assignee (unless the caller sends its own) and the watchers,
 * and the project's progress.
 * @param {ItemContext} c
 * @param {ChangeResult} res
 * @param {boolean} [alertAssignee=true]
 * @param {string[]} [extra=[]]
 * @param {string} [moveNote]
 * @returns {Promise<void>}
 */
export async function afterChange(c, res, alertAssignee = true, extra = [], moveNote) {
  const { before, after, changed } = res;
  if (!changed.length) return;
  c.emit?.({ type: "field_changed", itemId: after.id, fields: changed });
  /** @type {string[]} */ let told = [];
  if (alertAssignee && changed.includes("assignee") && after.assignee) {
    told = await notifyItem(c, "item_assigned", after, {
      title: `${keyOf(after)} assigned to you: ${after.summary}`,
      body: `${after.project_name}, ${after.priority.toLowerCase()} priority. From ${c.me.name}.`,
    });
  }
  const words = changed.map((k) => (k === "status" ? `status changed to ${after.status_name}` : k === "assignee" ? (after.assignee ? "reassigned" : "unassigned") : k.startsWith("field:") ? `${k.slice(6)} changed` : `${FIELD_LABEL[k]?.toLowerCase() ?? k} changed`));
  const what = moveNote ?? words.join(", ").replace(/^./, (x) => x.toUpperCase());
  await notifyItem(c, changed.includes("status") ? "item_transitioned" : "item_updated", after, {
    title: `${keyOf(after)} ${after.summary}`,
    body: `${what}. By ${c.me.name}.`,
    skip: [...told, ...(after.assignee && changed.includes("assignee") && alertAssignee ? [after.assignee] : [])],
    extra,
  });
  await recomputeProgress(c, after.system_id);
  if (before.system_id !== after.system_id) await recomputeProgress(c, before.system_id);
}
/**
 * Creates an item with the next number in its project, safely when two arrive at once.
 * @param {ItemContext} c
 * @param {NewItem} b
 * @param {WorkSource} source
 * @param {string} [id=newToken().slice(0, 16)]
 * @returns {Promise<ItemRow>}
 */
export async function createItem(c, b, source, id = newToken().slice(0, 16)) {
  // A view-only link has no account to report from.
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const sys = await /** @type {Promise<{ id: string; } | null>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare("SELECT id FROM systems WHERE id = ?")
        .bind(String(b.systemId ?? ""))
        .first()
    )
  );
  if (!sys) throw new HttpError(404, "Project not found");
  // The item type (the workspace's own, such as Campaign) or, from older clients, a kind (Task).
  const itemType = await resolveItemType(c, b.itemType, b.type);
  const type = itemType.base;
  const parent = await checkParent(c, b.parent, type, sys.id);
  // Every new item starts in its workflow's first status (its type's workflow, if it has one); a feature request
  // then moves on from there.
  const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, sys.id, itemType.id));
  const status = initialStatus(wf);
  const done = (await statusNames(c)).get(status)?.category === "DONE";
  const resolution = done ? (b.resolution === "WONT_DO" ? "WONT_DO" : "DONE") : null;
  const assignee = await checkAssignee(c, b.assignee, source);
  const start = date(b.startDate, "Start date");
  const due = date(b.dueDate, "Due date");
  if (start && due && start > due) throw new HttpError(400, "The start date must be on or before the due date");
  const estimate = minutes(b.originalEstimate, "Original estimate");
  const tags = labels(b.labels);
  const level = await checkLevel(c, b.securityLevel);
  // Custom fields (and their required ones) are checked when the create form or the API sends them.
  // Defaults fill the fields left out, so the plan is made even when none are sent.
  const custom = await planCustomValues(c, id, sys.id, b.customFields, "create", itemType.id);
  const db = c.db;
  const stmts = [
    db
      .prepare(
        `WITH n AS (UPDATE systems SET item_seq = item_seq + 1 WHERE id = ? RETURNING item_seq)
         INSERT INTO work_items (id, system_id, number, type, item_type, parent_id, summary, description, status, resolution, on_hold, priority,
           assignee, reporter, component, story_points, original_estimate, remaining_estimate, start_date, due_date,
           created_at, updated_at, resolved_at, source, client, notes, security_level, backlog_rank)
         SELECT ?, ?, n.item_seq, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(x.backlog_rank), 0) + 1024 FROM work_items x WHERE x.system_id = ?) FROM n RETURNING number`,
      )
      .bind(
        sys.id,
        id,
        sys.id,
        type,
        itemType.id,
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
        level,
        sys.id,
      ),
    ...tags.map((l) => db.prepare("INSERT INTO work_item_labels (item_id, label) VALUES (?, ?)").bind(id, l)),
    db.prepare("INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) VALUES (?, NULL, ?, ?, ?)").bind(id, status, c.me.id, c.now),
    ...(custom?.stmts ?? []),
    // The reporter and the assignee watch it.
    ...[...new Set([c.me.id, ...(assignee ? [assignee] : [])])].map((u) => db.prepare("INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(id, u, c.now)),
  ];
  await db.batch(stmts);
  const row = /** @type {ItemRow} */ (await itemById(c, id));
  const created = await notifyItem(c, "item_created", row, {
    title: assignee ? `${keyOf(row)} assigned to you: ${row.summary}` : `New ${row.type.toLowerCase().replace("subtask", "sub-task")} ${keyOf(row)}: ${row.summary}`,
    body: `${row.project_name}, ${row.priority.toLowerCase()} priority. From ${c.me.name}.`,
    mentioned: await mentionIds(c, row.description),
  });
  if (assignee) {
    await notifyItem(c, "item_assigned", row, {
      title: `${keyOf(row)} assigned to you: ${row.summary}`,
      body: `${row.project_name}, ${row.priority.toLowerCase()} priority. From ${c.me.name}.`,
      skip: created,
    });
  }
  await recomputeProgress(c, row.system_id);
  c.emit?.({ type: "item_created", itemId: row.id });
  return row;
}
/**
 * Deletes an item, its sub-tasks and their attachments. Children of an epic stay, without a parent.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {Promise<number>}
 */
export async function deleteItem(c, r) {
  const ids = [r.id, ...(await /** @type {Promise<D1Result<{ id: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id FROM work_items WHERE parent_id = ? AND type = 'SUBTASK'").bind(r.id).all()))).results.map((x) => x.id)];
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
/** @type {Record<Priority, WorkPriority>} */ const FEATURE_PRIORITY = { CRITICAL: "HIGHEST", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };
/**
 * The work item fields for a feature request's fields (only those given).
 * @param {{ title?: unknown; description?: unknown; kind?: FeatureKind; client?: unknown; priority?: Priority; assignee?: unknown; notes?: unknown; dueAt?: unknown; systemId?: unknown }} f
 * @param {{ type: WorkItemType; labels: string[] }} [current]
 * @returns {ItemPatch & NewItem}
 */
export function featureToItem(f, current) {
  /** @type {ItemPatch & NewItem} */ const out = { systemId: f.systemId };
  if (f.systemId === undefined) delete /** @type {{ systemId?: unknown }} */ (out).systemId;
  if (f.title !== undefined) out.summary = f.title;
  if (f.description !== undefined) out.description = f.description ?? "";
  if (f.client !== undefined) out.client = f.client;
  if (f.notes !== undefined) out.notes = f.notes;
  if (f.assignee !== undefined) out.assignee = f.assignee;
  if (f.dueAt !== undefined) out.dueDate = f.dueAt;
  if (f.priority !== undefined) out.priority = FEATURE_PRIORITY[f.priority];
  if (f.kind !== undefined) {
    const kindLabels = /** @type {string[]} */ (Object.values(KIND_LABELS));
    out.labels = [...(current?.labels ?? []).filter((l) => !kindLabels.includes(l)), KIND_LABELS[f.kind]];
    // A bug fix is a Bug; anything else is a Story (an existing item keeps its type unless it was a Bug).
    out.type = f.kind === "BUG_FIX" ? "BUG" : current && current.type !== "BUG" ? current.type : "STORY";
  }
  return out;
}
// ---------- the routes ----------
const KEY = "([A-Z]{2,10}-\\d{1,7})";
/**
 * Handles /api/items…; returns null for any other path.
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function itemsApi(c, path, method) {
  if (!path.startsWith("/api/items")) return null;
  const { db, req } = c;
  if (path === "/api/items" && method === "GET") return json(await listItems(c, new URL(req.url).searchParams));
  if (path === "/api/items" && method === "POST") {
    if (c.guest || !c.can("create_work_items")) throw new HttpError(403, "You don't have permission to create work items");
    const b = await /** @type {Promise<NewItem>} */ (/** @type {unknown} */ (body(req)));
    if (!c.can("edit_work_items") && b.assignee && b.assignee !== c.me.id) {
      throw new HttpError(403, "You can assign a work item to yourself only. Someone who can edit any work item assigns others.");
    }
    // The form and the API always run the custom field checks, so required fields are kept.
    const row = await createItem(c, { ...b, customFields: b.customFields ?? {} }, "internal");
    const fields = b.customFields && Object.keys(/** @type {object} */ (b.customFields)).length ? ((await customValuesFor(db, [row.id])).get(row.id) ?? []) : [];
    await c.audit("work_item_created", row.system_id, {
      ...(row.security_level ? { securityLevel: row.security_level } : {}),
      ...(fields.length ? { customFields: Object.fromEntries(fields.map((f) => [f.name, f.display])) } : {}),
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
    const b = await /** @type {Promise<ItemPatch>} */ (/** @type {unknown} */ (body(req)));
    if (b.systemId !== undefined && b.systemId !== r.system_id && !may.assignOthers) throw new HttpError(403, "You don't have permission to move work items");
    if (b.assignee !== undefined && !may.assignOthers) {
      const to = /** @type {string | null} */ (b.assignee || null);
      if (to && to !== c.me.id) throw new HttpError(403, "You can assign a work item to yourself only");
      if (to !== r.assignee && r.assignee && r.assignee !== c.me.id) throw new HttpError(403, "Someone else is assigned; ask whoever assigns work to change it");
    }
    // A new status is a move in the workflow, with its rules; the other fields follow.
    let row = r;
    const { status, comment, ...rest } = /** @type {ItemPatch & { comment?: unknown }} */ (b);
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
    const b = await /** @type {Promise<MoveRequest>} */ (/** @type {unknown} */ (body(req)));
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
      /** @type {Promise<D1Result<Record<string, string | null>>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM work_item_comments WHERE item_id = ? ORDER BY created_at, id LIMIT ? OFFSET ?").bind(r.id, limit, offset).all())),
      /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM work_item_comments WHERE item_id = ?").bind(r.id).first())),
    ]);
    return json({
      comments: rows.results.map(
        /** @returns {WorkComment} */ (x) => ({
          id: /** @type {NonNullable<typeof x.id>} */ (x.id),
          authorId: /** @type {NonNullable<typeof x.author_id>} */ (x.author_id),
          body: /** @type {NonNullable<typeof x.body>} */ (x.body),
          createdAt: /** @type {NonNullable<typeof x.created_at>} */ (x.created_at),
          ...(x.updated_at ? { updatedAt: x.updated_at } : {}),
          ...(Number(x.public) ? { public: true } : {}),
          ...(x.customer_name ? { customerName: x.customer_name } : {}),
        }),
      ),
      total: Number(total?.n ?? 0),
      offset,
    });
  }
  if (m && method === "POST") {
    const r = await itemByKey(c, m[1]);
    if (!rights(c, r).comment) throw new HttpError(403, "This link is view-only");
    const b = await /** @type {Promise<{ body?: unknown; public?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const text = /** @type {string} */ (str(b.body, "Comment", MAX_COMMENT, true));
    // A reply the customer sees: service desk requests only, by people who work the service desk.
    const toCustomer = !!b.public && r.source === "service_desk";
    if (toCustomer && !c.can("work_service_desk")) throw new HttpError(403, "You don't have permission to reply to customers");
    const id = await addComment(c, r, text, {}, { public: toCustomer });
    return json({ id, authorId: c.me.id, body: text, createdAt: c.now, ...(toCustomer ? { public: true } : {}) }, 201);
  }
  m = path.match(new RegExp(`^/api/items/${KEY}/comments/([a-z0-9-]{4,40})$`));
  if (m && (method === "PATCH" || method === "DELETE")) {
    const r = await itemByKey(c, m[1]);
    const row = await /** @type {Promise<Record<string, string> | null>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM work_item_comments WHERE id = ? AND item_id = ?").bind(m[2], r.id).first()));
    if (!row) throw new HttpError(404, "Comment not found");
    if (row.author_id !== c.me.id || c.guest) throw new HttpError(403, "You can only change your own comments");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM work_item_comments WHERE id = ?").bind(row.id).run();
      await c.audit("comment_deleted", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, comment: row.body.slice(0, 300) });
      return json({ ok: true });
    }
    const text = /** @type {string} */ (str((await /** @type {Promise<{ body?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).body, "Comment", MAX_COMMENT, true));
    if (text === row.body) return json({ id: row.id, authorId: row.author_id, body: row.body, createdAt: row.created_at, ...(row.updated_at ? { updatedAt: row.updated_at } : {}) });
    await db.prepare("UPDATE work_item_comments SET body = ?, updated_at = ? WHERE id = ?").bind(text, c.now, row.id).run();
    await c.audit("comment_edited", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, from: row.body.slice(0, 300), to: text.slice(0, 300) });
    // Only people newly mentioned in the edit hear about it.
    const before = new Set(mentionsIn(row.body));
    const fresh = mentionsIn(text).filter((u) => !before.has(u));
    if (fresh.length) {
      await notifyItem(c, "item_commented", r, {
        title: `${keyOf(r)} ${r.summary}`,
        body: `In an edited comment: ${text.replace(/\s+/g, " ").slice(0, 200)}`,
        mentioned: await mentionIds(c, fresh.map((u) => `@${u}`).join(" ")),
        onlyMentioned: true,
      });
    }
    return json({ id: row.id, authorId: row.author_id, body: text, createdAt: row.created_at, updatedAt: c.now });
  }
  // ----- watching -----
  m = path.match(new RegExp(`^/api/items/${KEY}/watch$`));
  if (m && (method === "POST" || method === "DELETE")) {
    const r = await itemByKey(c, m[1]);
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const res =
      method === "POST" ? await db.prepare("INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(r.id, c.me.id, c.now).run() : await db.prepare("DELETE FROM work_item_watchers WHERE item_id = ? AND user_id = ?").bind(r.id, c.me.id).run();
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
    const b = await /** @type {Promise<{ type?: unknown; direction?: unknown; target?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const type = pick(b.type, LINK_TYPES, "link type");
    const target = await itemByKey(
      c,
      String(b.target ?? "")
        .trim()
        .toUpperCase(),
    ).catch(() => {
      throw new HttpError(400, "That work item doesn't exist");
    });
    if (target.id === r.id) throw new HttpError(400, "A work item can't link to itself");
    const [from, to] = b.direction === "inward" ? [target, r] : [r, target];
    const id = newToken().slice(0, 16);
    const res = await db.prepare("INSERT INTO work_item_links (id, from_id, to_id, link_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(id, from.id, to.id, type, c.me.id, c.now).run();
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
    const link = await /** @type {Promise<{ id: string; from_id: string; to_id: string; link_type: LinkType; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM work_item_links WHERE id = ? AND (from_id = ? OR to_id = ?)").bind(m[2], r.id, r.id).first()));
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
      db.prepare("INSERT INTO documents (id, system_id, name, kind, mime, size, uploaded_by, uploaded_at, work_item_id) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)").bind(id, r.system_id, name, file.type || "application/octet-stream", bytes.length, c.me.id, c.now, r.id),
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").bind(c.now, r.id),
    ];
    for (let i = 0, seq = 0; i < bytes.length; i += CHUNK, seq++) {
      stmts.push(db.prepare("INSERT INTO document_chunks (doc_id, seq, data) VALUES (?, ?, ?)").bind(id, seq, bytes.slice(i, i + CHUNK)));
    }
    await db.batch(stmts);
    await c.audit("attachment_added", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, document: name, size: bytes.length });
    await notifyWatchers(c, r, `Attached ${name}`);
    indexLater(c, id);
    return json({ id }, 201);
  }
  m = path.match(new RegExp(`^/api/items/${KEY}/attachments/([a-z0-9-]{4,40})$`));
  if (m && method === "DELETE") {
    const r = await itemByKey(c, m[1]);
    const doc = await /** @type {Promise<{ id: string; name: string; uploaded_by: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, uploaded_by FROM documents WHERE id = ? AND work_item_id = ?").bind(m[2], r.id).first()));
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
    const b = await /** @type {Promise<{ minutes?: unknown; note?: unknown; date?: unknown; remaining?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const spent = minutes(b.minutes, "Time spent");
    if (!spent) throw new HttpError(400, "Enter the time spent, such as 1h 30m");
    if (spent > 24 * 60) throw new HttpError(400, "Log at most 24 hours at a time");
    const day = date(b.date, "Date") ?? c.now.slice(0, 10);
    if (day > new Date(Date.parse(c.now) + 86_400_000).toISOString().slice(0, 10)) throw new HttpError(400, "You can't log time in the future");
    const note = str(b.note, "Note", 1000) ?? "";
    // Remaining work goes down by what was logged, unless a new figure is given.
    const remaining = b.remaining !== undefined && b.remaining !== null && b.remaining !== "" ? minutes(b.remaining, "Remaining estimate") : r.remaining_estimate != null ? Math.max(0, Number(r.remaining_estimate) - spent) : null;
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
    const log = await /** @type {Promise<{ id: string; user_id: string; minutes: number; work_date: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM work_logs WHERE id = ? AND item_id = ?").bind(m[2], r.id).first()));
    if (!log) throw new HttpError(404, "Work log not found");
    if (c.guest || (log.user_id !== c.me.id && !c.can("edit_work_items"))) throw new HttpError(403, "You can only remove time you logged");
    const remaining = r.remaining_estimate != null ? Number(r.remaining_estimate) + Number(log.minutes) : null;
    await db.batch([db.prepare("DELETE FROM work_logs WHERE id = ?").bind(log.id), db.prepare("UPDATE work_items SET remaining_estimate = ?, updated_at = ? WHERE id = ?").bind(remaining, c.now, r.id)]);
    await c.audit("time_log_deleted", r.system_id, { name: r.project_name, key: keyOf(r), summary: r.summary, minutes: Number(log.minutes), date: log.work_date, time: formatMinutes(Number(log.minutes)) });
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found");
}
/**
 * Adds a comment: logged, mentions told, watchers told, automation told. Returns its id.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {string} text
 * @param {Record<string, unknown>} [extra={}]
 * @param {{ public?: boolean; customerName?: string }} [opts={}]
 * @returns {Promise<string>}
 */
export async function addComment(c, r, text, extra = {}, opts = {}) {
  const id = newToken().slice(0, 16);
  // A service desk reply the customer sees is "public"; so is anything the customer writes.
  const isPublic = r.source === "service_desk" && (!!opts.public || !!opts.customerName);
  await c.db.batch([
    c.db.prepare("INSERT INTO work_item_comments (id, item_id, author_id, body, created_at, public, customer_name) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, r.id, c.me.id, text, c.now, isPublic ? 1 : 0, opts.customerName ?? null),
    c.db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").bind(c.now, r.id),
  ]);
  await c.audit("comment_added", r.system_id, {
    name: r.project_name,
    key: keyOf(r),
    summary: r.summary,
    comment: text.slice(0, 300),
    ...(isPublic ? { toCustomer: !opts.customerName, fromCustomer: opts.customerName ?? undefined } : {}),
    ...extra,
  });
  await notifyItem(c, "item_commented", r, {
    title: `${keyOf(r)} ${r.summary}`,
    body: `${opts.customerName ? `${opts.customerName} (customer)` : c.me.name} commented: ${text.replace(/\s+/g, " ").slice(0, 200)}`,
    mentioned: await mentionIds(c, text),
  });
  if (r.source === "service_desk") await onRequestComment(c, r, { public: isPublic, fromCustomer: !!opts.customerName, text });
  c.emit?.({ type: "comment_added", itemId: r.id });
  return id;
}
// ---------- Ask AI ----------
/**
 * Work items for Ask AI, within what the person may see: open items first by priority, then
 * recently finished ones. Kept short so answers start quickly.
 * @param {ItemContext} c
 * @param {Map<string, string>} nameOf
 * @param {number} [limit=120]
 * @returns {Promise<string[]>}
 */
export async function askItemLines(c, nameOf, limit = 120) {
  const vis = visibility(c);
  const rows = await /** @type {Promise<D1Result<ItemRow>>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(
          `${SELECT} WHERE ${vis.sql}
       ORDER BY CASE WHEN st.category = 'DONE' THEN 1 ELSE 0 END,
         ${PRIORITY_ORDER}, w.due_date NULLS LAST, w.updated_at DESC LIMIT ?`,
        )
        .bind(...vis.args, limit)
        .all()
    )
  );
  const counts = await /** @type {Promise<{ total: number; open: number; } | null>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE st.category <> 'DONE') AS open FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE ${vis.sql}`)
        .bind(...vis.args)
        .first()
    )
  );
  const lines = [
    "",
    `WORK ITEMS (${Number(counts?.open ?? 0)} open of ${Number(counts?.total ?? 0)}${c.ownOnly ? ", only those assigned to or reported by the person asking" : ""}; showing up to ${limit}, open first)`,
    "(key | type | summary | project | status | priority | assignee | due | parent | children done)",
  ];
  const clip = /** @param {unknown} v @param {number} n */ (v, n) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "/")
      .trim()
      .slice(0, n);
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
  // Custom field values, and security levels, of the same items.
  const custom = await customValuesFor(
    c.db,
    rows.results.map((r) => r.id),
  );
  const extra = rows.results
    .map((r) => {
      const vals = (custom.get(r.id) ?? []).filter((v) => v.display).map((v) => `${clip(v.name, 40)}: ${clip(v.display, 80)}`);
      if (r.security_level) vals.push(`security level: ${r.security_level}`);
      return vals.length ? `${keyOf(r)} | ${vals.join("; ")}` : "";
    })
    .filter(Boolean);
  if (extra.length) lines.push("", "CUSTOM FIELDS AND SECURITY LEVELS OF THOSE ITEMS (key | values)", ...extra);
  return lines;
}
/**
 * Something automation rules can react to.
 * @typedef {| { type: "item_created" | "comment_added" | "subtasks_done"; itemId: string; by?: string }
 *   | { type: "item_transitioned"; itemId: string; from: string; to: string; by?: string }
 *   | { type: "field_changed"; itemId: string; fields: string[]; by?: string }
 *   | { type: "sprint_started" | "sprint_completed"; sprintId: string; systemId: string; by?: string }
 *   | { type: "sla_warning" | "sla_breached"; itemId: string; target: "response" | "resolution"; by?: string }
 *   | { type: "approval_granted" | "approval_rejected"; itemId: string; by?: string }
 *   | { type: "stage_changed"; systemId: string; from: string; to: string; by?: string }} ItemEvent  by: who set it off (a user id, or "automation")
 */
/**
 * @typedef {Object} ItemContext
 * @property {D1Database} db
 * @property {Request} req
 * @property {Object} me
 * @property {string} me.id
 * @property {string} me.name
 * @property {string} me.username
 * @property {Role} me.role
 * @property {boolean} guest
 * @property {(p: Permission) => boolean} can
 * @property {boolean} ownOnly Developers without manage_features: only items assigned to them or that they reported.
 * @property {Viewer} viewer Who is asking, for the visibility rule in worker/access.ts (own items and security levels).
 * @property {string} now
 * @property {Scope} [scope] the organisation and workspace the request is in
 * @property {boolean} [orgAdmin] an Organisation Administrator, signed in (organisation-wide changes)
 * @property {(action: string, target: string | null, detail: Record<string, unknown>) => Promise<void>} audit
 * @property {(alerts: Alert[], channel?: ChannelPost) => void} alert Raises alerts for others (never the person acting), without holding up the request.
 * @property {(e: ItemEvent) => void} [emit] Tells automation what happened (worker/automation.ts). Absent where nothing should react.
 * @property {Env} [env] The Worker's environment, for email and secrets (service desk customer emails, webhooks).
 * @property {(method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>} [subrequest] A request to the API as
 *   this same person (their session, every check): how a confirmed Ask AI proposal runs.
 * @property {(p: Promise<unknown>) => void} [defer] Work to finish after the response (ctx.waitUntil); runs inline where there's no request.
 */
/**
 * @typedef {Object} ItemRow
 * @property {string} id
 * @property {string} system_id
 * @property {number} number
 * @property {WorkItemType} type
 * @property {string} item_type
 * @property {string | null} [item_type_name]
 * @property {string | null} parent_id
 * @property {string} summary
 * @property {string} description
 * @property {WorkStatus} status
 * @property {string} status_name
 * @property {StatusCategory} status_category
 * @property {Resolution | null} resolution
 * @property {number} on_hold
 * @property {WorkPriority} priority
 * @property {string | null} assignee
 * @property {string} reporter
 * @property {string | null} component
 * @property {number | null} story_points
 * @property {number | null} original_estimate
 * @property {number | null} remaining_estimate
 * @property {string | null} start_date
 * @property {string | null} due_date
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string | null} resolved_at
 * @property {WorkSource} source
 * @property {string | null} client
 * @property {string | null} notes
 * @property {string | null} sprint_id
 * @property {number | null} backlog_rank
 * @property {string | null} security_level
 * @property {string} project_key
 * @property {string} project_name
 * @property {number | null} parent_number
 * @property {string | null} labels
 * @property {number} child_total
 * @property {number} child_done
 */
/**
 * @typedef {Object} MoveRequest
 * @property {unknown} [transitionId]
 * @property {unknown} [to]
 * @property {unknown} [comment]
 * @property {MoveInput["fields"]} [fields]
 * @property {Resolution} [resolution]
 */
/**
 * What may change on an item. `systemId` moves it to another project (with a new number there).
 * @typedef {Object} ItemPatch
 * @property {unknown} [itemType]
 * @property {unknown} [summary]
 * @property {unknown} [description]
 * @property {unknown} [type]
 * @property {unknown} [status]
 * @property {unknown} [resolution]
 * @property {unknown} [onHold]
 * @property {unknown} [priority]
 * @property {unknown} [assignee]
 * @property {unknown} [parent]
 * @property {unknown} [labels]
 * @property {unknown} [component]
 * @property {unknown} [storyPoints]
 * @property {unknown} [originalEstimate]
 * @property {unknown} [remainingEstimate]
 * @property {unknown} [startDate]
 * @property {unknown} [dueDate]
 * @property {unknown} [client]
 * @property {unknown} [notes]
 * @property {unknown} [systemId]
 * @property {unknown} [securityLevel]
 * @property {unknown} [customFields]
 */
/**
 * @typedef {Object} ChangeResult
 * @property {ItemRow} before
 * @property {ItemRow} after
 * @property {string[]} changed
 * @property {Record<string, { from: unknown; to: unknown }>} diff Before and after values of each changed field, for the activity log.
 * @property {import('../../project-management-system-frontend/src/data/workflows').ApprovalView} [pendingApproval] the move waits for this approval instead
 */
/**
 * @typedef {Object} NewItem
 * @property {unknown} systemId
 * @property {unknown} [type]
 * @property {unknown} [itemType]
 * @property {unknown} [summary]
 * @property {unknown} [description]
 * @property {unknown} [status]
 * @property {unknown} [resolution]
 * @property {unknown} [onHold]
 * @property {unknown} [priority]
 * @property {unknown} [assignee]
 * @property {unknown} [parent]
 * @property {unknown} [labels]
 * @property {unknown} [component]
 * @property {unknown} [storyPoints]
 * @property {unknown} [originalEstimate]
 * @property {unknown} [startDate]
 * @property {unknown} [dueDate]
 * @property {unknown} [client]
 * @property {unknown} [notes]
 * @property {unknown} [securityLevel]
 * @property {unknown} [customFields]
 */
