/** @import { StatusDef } from '../../project-management-system-frontend/src/data/workflows' */
/** @import { ItemContext } from './workitems' */
/** @import { Rule, RuleKind, Workflow, WorkflowDraft } from '../../project-management-system-frontend/src/data/workflows' */
/** @import { StatusCategory, WorkItemType } from '../../project-management-system-frontend/src/data/workitems' */
// Settings → This workspace → Workflows: the status list, the workspace's workflows (their statuses, moves and
// rules), which workflow the workspace, each project and each item type uses, and the workspace's item types.
//
// Workflows belong to a workspace (migration 0018); the organisation's own are its templates, which only its
// administrators change and which a workspace copies to make its own. A workflow is edited as a draft and then
// published; each publish is kept as a version, which can be restored (by publishing it again).
//
// Changes that would leave work items in a status their workflow no longer has must say where those items go
// ("moves"); without that, the request is refused with the statuses that need an answer.
import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { recomputeProgress } from "./workitems";
import { EFFECTIVE_WORKFLOW, loadWorkflows, statusCatalogue } from "./workflowData";
import { ROLES } from "../../project-management-system-frontend/src/data/roles";
import { FIELD_RULE_LABEL, RULES } from "../../project-management-system-frontend/src/data/workflows";
import { cleanApprovalValue } from "./approvals";
/** @type {StatusCategory[]} */ const CATEGORIES = ["TODO", "IN_PROGRESS", "DONE"];
const BASES = /** @type {WorkItemType[]} */ (["EPIC", "STORY", "TASK", "BUG", "SUBTASK"]);
/** The workflow an item follows: its type's, else its project's, its workspace's or the default. `w`, `s`, `it`. */
const ITEM_WORKFLOW = `COALESCE(it.workflow_id, ${EFFECTIVE_WORKFLOW})`;
const ITEM_FROM = `FROM work_items w JOIN systems s ON s.id = w.system_id LEFT JOIN item_types it ON it.workspace_id = w.workspace_id AND it.id = w.item_type`;

/**
 * Items per (workflow they follow, status, project, item type).
 * @param {D1Database} db
 * @returns {Promise<{ workflow_id: string; status: string; system_id: string; item_type: string; n: number }[]>}
 */
async function usage(db) {
  const rows = /** @type {D1Result<{ workflow_id: string; status: string; system_id: string; item_type: string; n: number }>} */ (
    await db.prepare(`SELECT ${ITEM_WORKFLOW} AS workflow_id, w.status, w.system_id, w.item_type, COUNT(*) AS n ${ITEM_FROM} GROUP BY 1, 2, 3, 4`).all()
  );
  return rows.results.map((r) => ({ ...r, n: Number(r.n) }));
}
/**
 * Moves the items matching `where` (over w, s and it) from one status to another, with history, the right resolution
 * and one log entry.
 * @param {ItemContext} c
 * @param {string} where
 * @param {unknown[]} args
 * @param {string} from
 * @param {string} to
 * @param {string} why
 * @returns {Promise<number>}
 */
async function moveItems(c, where, args, from, to, why) {
  const db = c.db;
  const toCat = /** @type {{ category: StatusCategory; }} */ (await db.prepare("SELECT category FROM work_statuses WHERE id = ?").bind(to).first()).category;
  const rows = /** @type {{ id: string; system_id: string }[]} */ (
    (
      await db
        .prepare(`SELECT w.id, w.system_id ${ITEM_FROM} WHERE w.status = ? AND (${where})`)
        .bind(from, ...args)
        .all()
    ).results
  );
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const im = ids.map(() => "?").join(", ");
  await db.batch([
    db.prepare(`INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) SELECT id, status, ?, ?, ? FROM work_items WHERE id IN (${im})`).bind(to, c.me.id, c.now, ...ids),
    toCat === "DONE"
      ? db.prepare(`UPDATE work_items SET status = ?, resolution = COALESCE(resolution, 'DONE'), resolved_at = COALESCE(resolved_at, ?), on_hold = 0, updated_at = ? WHERE id IN (${im})`).bind(to, c.now, c.now, ...ids)
      : db.prepare(`UPDATE work_items SET status = ?, resolution = NULL, resolved_at = NULL, updated_at = ? WHERE id IN (${im})`).bind(to, c.now, ...ids),
  ]);
  await c.audit("work_items_moved", null, { from, to, count: ids.length, reason: why });
  for (const sid of new Set(rows.map((r) => r.system_id))) await recomputeProgress(c, sid);
  return ids.length;
}
/**
 * @param {D1Database} db
 * @param {Map<string, number>} missing
 * @returns {Promise<void>}
 */
async function refuseMissing(db, missing) {
  if (!missing.size) return;
  const names = new Map((await statusCatalogue(db)).map((s) => [s.id, s.name]));
  const list = [...missing].map(([id, count]) => ({ id, name: names.get(id) ?? id, count }));
  throw new HttpError(409, `Some work items are in ${list.map((x) => `${x.name} (${x.count})`).join(", ")}. Choose where they should move.`, "needs_moves", { statuses: list });
}
/**
 * @param {unknown} raw
 * @returns {Rule[]}
 */
function cleanRules(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "Rules must be a list");
  return raw.map((x) => {
    const r = /** @type {Record<string, unknown>} */ (x);
    const kind = /** @type {RuleKind} */ (r.kind);
    const def = RULES[kind]?.find((d) => d.rule === r.rule);
    if (!def) throw new HttpError(400, `Unknown rule "${String(r.rule)}"`);
    // An approval rule's value is JSON (worker/approvals.js); others are a short word.
    const raw = r.value === undefined || r.value === null || r.value === "" ? null : String(r.value);
    const value = raw && def.value === "approval" ? cleanApprovalValue(raw.slice(0, 2000)) : raw ? raw.slice(0, 64) : null;
    if (def.value && !value) throw new HttpError(400, `"${def.label}" needs a value`);
    if (def.value === "role" && !ROLES.includes(/** @type {never} */ (value))) throw new HttpError(400, "Unknown role");
    if (def.value === "field" && !(/** @type {NonNullable<typeof value>} */ (value) in FIELD_RULE_LABEL)) throw new HttpError(400, "Unknown field");
    if (def.value === "resolution" && value !== "DONE" && value !== "WONT_DO") throw new HttpError(400, "Unknown resolution");
    if (
      def.value === "notify" &&
      !["watchers", "assignee", "reporter"].includes(/** @type {NonNullable<typeof value>} */ (value)) &&
      !(/** @type {NonNullable<typeof value>} */ (value).startsWith("role:") && ROLES.includes(/** @type {never} */ (/** @type {NonNullable<typeof value>} */ (value).slice(5))))
    ) {
      throw new HttpError(400, "Notify watchers, the assignee, the reporter or a role");
    }
    return { kind, rule: def.rule, value: def.value ? value : null };
  });
}
/**
 * A workflow as sent (a draft, or a version to publish), checked: a name, statuses from the list with one start,
 * and moves between its own statuses, each pair once.
 * @param {D1Database} db
 * @param {Workflow} current
 * @param {Partial<Record<keyof WorkflowDraft, unknown>>} b
 * @returns {Promise<WorkflowDraft>}
 */
async function checkDraft(db, current, b) {
  const name = String(b.name ?? current.name)
    .trim()
    .slice(0, 60);
  if (!name) throw new HttpError(400, "A workflow needs a name");
  const description = String(b.description ?? current.description)
    .trim()
    .slice(0, 300);
  const catalogue = new Map((await statusCatalogue(db)).map((s) => [s.id, s]));
  const statuses = /** @type {{ id: string; initial?: boolean }[]} */ (Array.isArray(b.statuses) ? b.statuses : current.statuses);
  if (!statuses.length) throw new HttpError(400, "A workflow needs at least one status");
  const ids = statuses.map((s) => String(s.id));
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "A status can appear once in a workflow");
  for (const id of ids) if (!catalogue.has(id)) throw new HttpError(400, `Unknown status ${id}`);
  if (statuses.filter((s) => s.initial).length !== 1) throw new HttpError(400, "Choose exactly one status where work items start");
  const inWf = new Set(ids);
  const raw = /** @type {{ name?: unknown; from?: string | null; to?: string; rules?: unknown }[]} */ (Array.isArray(b.transitions) ? b.transitions : current.transitions);
  const transitions = raw.map((t, i) => {
    const from = t.from ? String(t.from) : null;
    const to = String(t.to ?? "");
    if (from && !inWf.has(from)) throw new HttpError(400, `Move ${i + 1} starts from a status this workflow doesn't use`);
    if (!inWf.has(to)) throw new HttpError(400, `Move ${i + 1} goes to a status this workflow doesn't use`);
    if (from === to) throw new HttpError(400, `Move ${i + 1} goes nowhere`);
    const tname =
      String(t.name ?? "")
        .trim()
        .slice(0, 60) || `To ${/** @type {StatusDef} */ (catalogue.get(to)).name}`;
    return { name: tname, from, to, rules: cleanRules(t.rules) };
  });
  const pairs = transitions.map((t) => `${t.from ?? "*"}>${t.to}`);
  if (new Set(pairs).size !== pairs.length) throw new HttpError(400, "Two moves go between the same statuses");
  return { name, description, statuses: statuses.map((s) => ({ id: String(s.id), initial: !!s.initial })), transitions };
}
/** A workflow as a draft or version: what's kept. @param {Workflow | WorkflowDraft} w @returns {WorkflowDraft} */
const snapshot = (w) => ({
  name: w.name,
  description: w.description,
  statuses: w.statuses.map((s) => ({ id: s.id, initial: !!s.initial })),
  transitions: w.transitions.map((t) => ({ name: t.name, from: t.from, to: t.to, rules: t.rules.map((r) => ({ kind: r.kind, rule: r.rule, value: r.value ?? null })) })),
});

/**
 * Handles /api/statuses, /api/workflows…, /api/workflow-assignments and /api/item-types; null for other paths.
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function workflowsApi(c, path, method) {
  if (!path.startsWith("/api/statuses") && !path.startsWith("/api/workflow") && !path.startsWith("/api/item-types")) return null;
  const { db, req } = c;
  const need = () => {
    if (c.guest || !c.can("manage_workflows")) throw new HttpError(403, "You don't have permission to change workflows");
  };
  const scope = /** @type {Scope} */ (c.scope);
  /** The organisation's handle: for its templates and for statuses shared between workspaces. */
  const orgHandle = () => /** @type {Env} */ (c.env).ROOT.withScope({ orgId: scope.orgId, workspaceId: "" });
  /**
   * May this person change this workflow? This workspace's: with "manage_workflows". A template: only an
   * Organisation Administrator, through the organisation's handle (the workspace's can't write templates).
   * @param {Workflow} wf
   * @returns {D1Database}
   */
  const writerFor = (wf) => {
    need();
    if (wf.workspaceId) return db;
    if (!c.orgAdmin) {
      throw new HttpError(403, "This is one of your organisation's templates: only its administrators change it. Make a copy for this workspace instead.", "template_read_only");
    }
    return orgHandle();
  };
  /** The workflow by id, if this workspace can see it (its own, or a template). @param {string} id */
  const workflowById = async (id) => {
    const [wf] = await loadWorkflows(db, [id]);
    if (!wf) throw new HttpError(404, "Workflow not found");
    return wf;
  };
  const workspaceName = async () => /** @type {{ name: string }} */ (await db.prepare("SELECT name FROM workspaces WHERE id = ?").bind(scope.workspaceId).first()).name;

  if (path === "/api/statuses" && method === "GET") return json(await statusCatalogue(db));
  if (path === "/api/workflows" && method === "GET") {
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const [workflows, statuses, ws, projects, used, types, drafts, versions] = await Promise.all([
      loadWorkflows(db),
      statusCatalogue(db),
      /** @type {Promise<{ workflow_id: string } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT workflow_id FROM workspace_workflows WHERE workspace_id = ?").bind(scope.workspaceId).first())),
      /** @type {Promise<D1Result<{ id: string; key: string; name: string; workspace: string | null; workflow_id: string | null; effective: string; }>>} */ (
        /** @type {unknown} */ (db.prepare(`SELECT s.id, s.key, (s.data::json ->> 'name') AS name, (s.data::json ->> 'workspace') AS workspace, s.workflow_id, ${EFFECTIVE_WORKFLOW} AS effective FROM systems s ORDER BY s.sort, s.rowid`).all())
      ),
      usage(db),
      itemTypes(db),
      /** @type {Promise<D1Result<{ workflow_id: string; updated_at: string }>>} */ (/** @type {unknown} */ (db.prepare("SELECT workflow_id, updated_at FROM workflow_drafts").all())),
      /** @type {Promise<D1Result<{ workflow_id: string; v: number }>>} */ (/** @type {unknown} */ (db.prepare("SELECT workflow_id, MAX(version) AS v FROM workflow_versions GROUP BY workflow_id").all())),
    ]);
    /** @type {Record<string, Record<string, number>>} */ const counts = {};
    for (const u of used) (counts[u.workflow_id] ??= {})[u.status] = (counts[u.workflow_id][u.status] ?? 0) + u.n;
    const draftOf = new Map(drafts.results.map((d) => [d.workflow_id, d.updated_at]));
    const versionOf = new Map(versions.results.map((v) => [v.workflow_id, Number(v.v)]));
    const name = await workspaceName();
    const def = workflows.find((w) => w.isDefault);
    return json({
      workflows: workflows.map((w) => ({ ...w, template: !w.workspaceId, ...(draftOf.has(w.id) ? { draftSavedAt: draftOf.get(w.id) } : {}), version: versionOf.get(w.id) ?? 0 })),
      statuses,
      workspace: ws?.workflow_id ?? def?.id ?? null,
      // As before: the open workspace's choice, by its name.
      workspaces: ws ? { [name]: ws.workflow_id } : {},
      projects: projects.results.map((p) => ({ id: p.id, key: p.key, name: p.name, workspace: p.workspace, workflowId: p.workflow_id, effective: p.effective })),
      itemTypes: types,
      usage: counts,
      canEditTemplates: !!c.orgAdmin,
    });
  }
  // ----- item types -----
  if (path === "/api/item-types" && method === "GET") return json(await itemTypes(db));
  if (path === "/api/item-types" && method === "POST") {
    need();
    const b = /** @type {{ name?: unknown; base?: unknown; description?: unknown }} */ (await body(req));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 40);
    if (!name) throw new HttpError(400, "Name the item type");
    const base = /** @type {WorkItemType} */ (String(b.base ?? ""));
    if (!BASES.includes(base)) throw new HttpError(400, "Choose what kind of item it is: epic, story, task, bug or sub-task");
    if (await db.prepare("SELECT 1 FROM item_types WHERE lower(name) = lower(?)").bind(name).first()) throw new HttpError(409, `There's already an item type called ${name}`);
    const stem =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/^(\d)/, "T$1")
        .slice(0, 16) || "TYPE";
    let id = BASES.includes(/** @type {WorkItemType} */ (stem)) ? `${stem}_2` : stem.length < 2 ? `${stem}_T` : stem;
    for (let n = 2; await db.prepare("SELECT 1 FROM item_types WHERE id = ?").bind(id).first(); n++) id = `${stem.slice(0, 16)}_${n}`;
    const pos = Number((/** @type {{ p: number }} */ (await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM item_types").first())).p);
    await db
      .prepare("INSERT INTO item_types (id, name, base, description, position, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, name, base, String(b.description ?? "").trim().slice(0, 300), pos, c.now)
      .run();
    await c.audit("item_type_created", null, { itemType: name, kind: base });
    return json((await itemTypes(db)).find((t) => t.id === id), 201);
  }
  const typeMatch = path.match(/^\/api\/item-types\/([A-Z][A-Z0-9_]{1,19})$/);
  if (typeMatch && (method === "PATCH" || method === "DELETE")) {
    need();
    const before = (await itemTypes(db)).find((t) => t.id === typeMatch[1]);
    if (!before) throw new HttpError(404, "Item type not found");
    if (method === "DELETE") {
      if (BASES.includes(/** @type {WorkItemType} */ (before.id))) throw new HttpError(400, "The built-in types stay; switch it off instead so it isn't offered for new items");
      const n = Number((/** @type {{ n: number }} */ (await db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE item_type = ?").bind(before.id).first())).n);
      if (n) throw new HttpError(409, `${n} work item${n === 1 ? " is" : "s are"} ${before.name.toLowerCase()}${n === 1 ? "" : "s"}. Switch the type off instead, or change their type first.`);
      await db.batch([
        db.prepare("UPDATE custom_fields SET item_types = (SELECT CASE WHEN jsonb_array_length(x) = 0 THEN NULL ELSE x::text END FROM (SELECT (item_types::jsonb - ?) AS x) q) WHERE item_types IS NOT NULL").bind(before.id),
        db.prepare("DELETE FROM item_types WHERE id = ?").bind(before.id),
      ]);
      await c.audit("item_type_deleted", null, { itemType: before.name });
      return json({ ok: true });
    }
    const b = /** @type {{ name?: unknown; description?: unknown; active?: unknown; position?: unknown; workflowId?: unknown }} */ (await body(req));
    if (b.workflowId !== undefined) throw new HttpError(400, "Choose a type's workflow under Which workflow each uses, so its items' statuses can be moved if needed");
    const name =
      b.name === undefined
        ? before.name
        : String(b.name)
            .trim()
            .slice(0, 40);
    if (!name) throw new HttpError(400, "Name the item type");
    if (name.toLowerCase() !== before.name.toLowerCase() && (await db.prepare("SELECT 1 FROM item_types WHERE lower(name) = lower(?)").bind(name).first())) throw new HttpError(409, `There's already an item type called ${name}`);
    const active = b.active === undefined ? before.active : !!b.active;
    if (!active) {
      const left = (await itemTypes(db)).filter((t) => t.id !== before.id && t.active && t.base !== "SUBTASK");
      if (!left.length && before.base !== "SUBTASK") throw new HttpError(409, "Keep at least one type on for new work items");
    }
    await db
      .prepare("UPDATE item_types SET name = ?, description = ?, active = ?, position = ? WHERE id = ?")
      .bind(name, b.description === undefined ? before.description : String(b.description).trim().slice(0, 300), active ? 1 : 0, b.position === undefined ? before.position : Number(b.position) || 0, before.id)
      .run();
    await c.audit("item_type_updated", null, { itemType: name, ...(name !== before.name ? { renamed: { from: before.name, to: name } } : {}), ...(active !== before.active ? { active } : {}) });
    return json((await itemTypes(db)).find((t) => t.id === before.id));
  }
  // ----- statuses -----
  // The status list is the organisation's: its categories keep reports alike across workspaces. Any workspace may
  // add one; renaming, recategorising or deleting a status that another workspace's workflow (or a template) uses
  // is for the organisation's administrators.
  /** Workflows outside this workspace that use a status. @param {string} id */
  const usedElsewhere = async (id) =>
    /** @type {{ name: string }[]} */ (
      (
        await orgHandle()
          .prepare("SELECT DISTINCT w.name FROM workflow_statuses ws JOIN workflows w ON w.organization_id = ws.organization_id AND w.id = ws.workflow_id WHERE ws.status_id = ? AND (w.workspace_id IS NULL OR w.workspace_id <> ?)")
          .bind(id, scope.workspaceId)
          .all()
      ).results
    );
  if (path === "/api/statuses" && method === "POST") {
    need();
    const b = await /** @type {Promise<{ name?: unknown; category?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 40);
    if (!name) throw new HttpError(400, "A status needs a name");
    if (!CATEGORIES.includes(/** @type {StatusCategory} */ (b.category))) throw new HttpError(400, "Choose To Do, In Progress or Done");
    if (await db.prepare("SELECT 1 FROM work_statuses WHERE lower(name) = lower(?)").bind(name).first()) throw new HttpError(409, `There's already a status called ${name}`);
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/^(\d)/, "S$1")
        .slice(0, 36) || "STATUS";
    let id = base;
    for (let n = 2; await db.prepare("SELECT 1 FROM work_statuses WHERE id = ?").bind(id).first(); n++) id = `${base}_${n}`;
    const pos = /** @type {{ p: number; }} */ (await /** @type {Promise<{ p: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM work_statuses").first()))).p;
    await db.prepare("INSERT INTO work_statuses (id, name, category, position, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, name, b.category, pos, c.now).run();
    await c.audit("status_created", null, { status: name, category: b.category });
    return json({ id, name, category: b.category }, 201);
  }
  let m = path.match(/^\/api\/statuses\/([A-Z][A-Z0-9_]{0,39})$/);
  if (m && method === "PATCH") {
    need();
    const row = await /** @type {Promise<{ id: string; name: string; category: StatusCategory; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, category FROM work_statuses WHERE id = ?").bind(m[1]).first()));
    if (!row) throw new HttpError(404, "Status not found");
    const b = await /** @type {Promise<{ name?: unknown; category?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 40) : row.name;
    if (!name) throw new HttpError(400, "A status needs a name");
    const category = b.category !== undefined ? /** @type {StatusCategory} */ (b.category) : row.category;
    if (!CATEGORIES.includes(category)) throw new HttpError(400, "Choose To Do, In Progress or Done");
    const elsewhere = await usedElsewhere(row.id);
    if (elsewhere.length && !c.orgAdmin && (name !== row.name || category !== row.category)) {
      throw new HttpError(403, `Other workflows use ${row.name} (${elsewhere.map((w) => w.name).join(", ")}): only your organisation's administrators can change it`, "status_shared");
    }
    if (name.toLowerCase() !== row.name.toLowerCase() && (await db.prepare("SELECT 1 FROM work_statuses WHERE lower(name) = lower(?)").bind(name).first())) {
      throw new HttpError(409, `There's already a status called ${name}`);
    }
    const stmts = [db.prepare("UPDATE work_statuses SET name = ?, category = ? WHERE id = ?").bind(name, category, row.id)];
    await db.batch(stmts);
    // Items in it gain or lose their resolution with the category: in every workspace of the organisation.
    if (category !== row.category) {
      const root = /** @type {Env} */ (c.env).ROOT;
      if (category === "DONE") {
        await root.prepare("UPDATE work_items SET resolution = COALESCE(resolution, 'DONE'), resolved_at = COALESCE(resolved_at, ?), on_hold = 0 WHERE organization_id = ? AND status = ?").bind(c.now, scope.orgId, row.id).run();
      } else if (row.category === "DONE") {
        await root.prepare("UPDATE work_items SET resolution = NULL, resolved_at = NULL WHERE organization_id = ? AND status = ?").bind(scope.orgId, row.id).run();
      }
    }
    await c.audit("status_updated", null, { status: name, from: { name: row.name, category: row.category }, to: { name, category } });
    return json({ id: row.id, name, category });
  }
  if (m && method === "DELETE") {
    need();
    const row = await /** @type {Promise<{ id: string; name: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name FROM work_statuses WHERE id = ?").bind(m[1]).first()));
    if (!row) throw new HttpError(404, "Status not found");
    const elsewhere = await usedElsewhere(row.id);
    if (elsewhere.length) throw new HttpError(409, `Other workflows use ${row.name} (${elsewhere.map((w) => w.name).join(", ")}). Take it out of them first.`, "status_shared");
    const b = await /** @type {Promise<{ moveTo?: unknown; }>} */ (/** @type {unknown} */ (body(req))).catch(() => ({ moveTo: undefined }));
    const starts = await /** @type {Promise<D1Result<{ name: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT w.name FROM workflow_statuses ws JOIN workflows w ON w.id = ws.workflow_id WHERE ws.status_id = ? AND ws.is_initial = 1").bind(row.id).all()));
    if (starts.results.length) throw new HttpError(400, `It's where work items start in ${starts.results.map((x) => x.name).join(", ")}. Choose another starting status there first.`);
    const inUse = (await usage(db)).filter((u) => u.status === row.id);
    if (inUse.length) {
      const moveTo = String(b.moveTo ?? "");
      if (!moveTo) await refuseMissing(db, new Map([[row.id, inUse.reduce((n, u) => n + u.n, 0)]]));
      if (moveTo === row.id) throw new HttpError(400, "Choose a different status");
      // The target must be in the workflow of every item that moves.
      const wfs = await loadWorkflows(db, [...new Set(inUse.map((u) => u.workflow_id))]);
      const lacking = wfs.filter((w) => !w.statuses.some((s) => s.id === moveTo));
      if (lacking.length) throw new HttpError(400, `${lacking.map((w) => w.name).join(", ")} doesn't use that status; choose one every affected workflow has`);
      await moveItems(c, "TRUE", [], row.id, moveTo, `status ${row.name} deleted`);
    }
    await db.batch([db.prepare("DELETE FROM workflow_transitions WHERE from_status = ? OR to_status = ?").bind(row.id, row.id), db.prepare("DELETE FROM workflow_statuses WHERE status_id = ?").bind(row.id), db.prepare("DELETE FROM work_statuses WHERE id = ?").bind(row.id)]);
    await c.audit("status_deleted", null, { status: row.name, ...(b.moveTo ? { movedTo: b.moveTo } : {}) });
    return json({ ok: true });
  }
  // ----- workflows -----
  if (path === "/api/workflows" && method === "POST") {
    need();
    const b = await /** @type {Promise<{ name?: unknown; copyFrom?: unknown; template?: unknown }>} */ (/** @type {unknown} */ (body(req)));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) throw new HttpError(400, "A workflow needs a name");
    // A copy for this workspace; or, for an Organisation Administrator, a new organisation template.
    const asTemplate = !!b.template;
    if (asTemplate && !c.orgAdmin) throw new HttpError(403, "Only your organisation's administrators make workflow templates", "template_read_only");
    const w = asTemplate ? orgHandle() : db;
    const sameName = asTemplate ? "workspace_id IS NULL" : "workspace_id = ?";
    if (await w.prepare(`SELECT 1 FROM workflows WHERE lower(name) = lower(?) AND ${sameName}`).bind(name, ...(asTemplate ? [] : [scope.workspaceId])).first()) {
      throw new HttpError(409, `There's already a workflow called ${name}`);
    }
    const fromId = String(b.copyFrom ?? "") || (await db.prepare("SELECT workflow_id FROM workspace_workflows WHERE workspace_id = ?").bind(scope.workspaceId).first())?.workflow_id;
    const [from] = fromId ? await loadWorkflows(db, [String(fromId)]) : (await loadWorkflows(db)).filter((x) => x.isDefault);
    if (!from) throw new HttpError(404, "Workflow to copy not found");
    const id = newToken().slice(0, 16);
    const stmts = [
      w.prepare("INSERT INTO workflows (id, workspace_id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(id, asTemplate ? null : scope.workspaceId, name, `A copy of ${from.name}.`, c.now, c.now),
      ...from.statuses.map((s, i) => w.prepare("INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES (?, ?, ?, ?)").bind(id, s.id, i + 1, s.initial ? 1 : 0)),
    ];
    from.transitions.forEach((t, i) => {
      const tid = newToken().slice(0, 16);
      stmts.push(w.prepare("INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES (?, ?, ?, ?, ?, ?)").bind(tid, id, t.name, t.from, t.to, i + 1));
      for (const r of t.rules) stmts.push(w.prepare("INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES (?, ?, ?, ?)").bind(tid, r.kind, r.rule, r.value ?? null));
    });
    await w.batch(stmts);
    await c.audit("workflow_created", null, { workflow: name, copiedFrom: from.name, ...(asTemplate ? { template: true } : {}) });
    return json((await loadWorkflows(db, [id]))[0], 201);
  }
  m = path.match(/^\/api\/workflows\/([a-z0-9-]{1,40})(\/draft|\/publish|\/versions(?:\/(\d{1,6})(\/restore)?)?)?$/);
  if (m && !m[2] && method === "PUT") {
    // Publishing straight away (the older way, kept for scripts): the same as saving a draft and publishing it.
    const current = await workflowById(m[1]);
    const writer = writerFor(current);
    const b = /** @type {Partial<Record<keyof WorkflowDraft, unknown>> & { moves?: Record<string, string>; note?: unknown }} */ (await body(req));
    const draft = await checkDraft(db, current, b);
    return json(await publish(c, writer, current, draft, b.moves ?? {}, String(b.note ?? "")));
  }
  if (m && m[2] === "/draft") {
    const current = await workflowById(m[1]);
    if (method === "GET") {
      need();
      const row = /** @type {{ data: string; base_version: number; updated_by: string | null; updated_at: string } | null} */ (await db.prepare("SELECT data, base_version, updated_by, updated_at FROM workflow_drafts WHERE workflow_id = ?").bind(current.id).first());
      const by = row?.updated_by ? /** @type {{ name: string } | null} */ (await db.prepare("SELECT name FROM users WHERE id = ?").bind(row.updated_by).first()) : null;
      return json({ draft: row ? JSON.parse(row.data) : null, published: snapshot(current), ...(row ? { baseVersion: row.base_version, savedBy: by?.name ?? "someone", savedAt: row.updated_at } : {}) });
    }
    const writer = writerFor(current);
    if (method === "PUT") {
      const draft = await checkDraft(db, current, /** @type {Partial<Record<keyof WorkflowDraft, unknown>>} */ (await body(req)));
      const v = await latestVersion(db, current.id);
      await writer
        .prepare(
          `INSERT INTO workflow_drafts (workflow_id, data, base_version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (organization_id, workflow_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .bind(current.id, JSON.stringify(draft), v, c.me.id, c.now)
        .run();
      return json({ draft, savedAt: c.now });
    }
    if (method === "DELETE") {
      await writer.prepare("DELETE FROM workflow_drafts WHERE workflow_id = ?").bind(current.id).run();
      return json({ ok: true });
    }
  }
  if (m && m[2] === "/publish" && method === "POST") {
    const current = await workflowById(m[1]);
    const writer = writerFor(current);
    const b = /** @type {{ moves?: Record<string, string>; note?: unknown }} */ (await body(req));
    const row = /** @type {{ data: string } | null} */ (await db.prepare("SELECT data FROM workflow_drafts WHERE workflow_id = ?").bind(current.id).first());
    if (!row) throw new HttpError(409, "There's no draft to publish", "no_draft");
    // Checked again: the status list may have changed since the draft was saved.
    const draft = await checkDraft(db, current, JSON.parse(row.data));
    return json(await publish(c, writer, current, draft, b.moves ?? {}, String(b.note ?? "")));
  }
  if (m && m[2]?.startsWith("/versions")) {
    const current = await workflowById(m[1]);
    need();
    if (!m[3] && method === "GET") {
      const rows = /** @type {{ version: number; note: string; published_name: string; published_at: string; data: string }[]} */ (
        (await db.prepare("SELECT version, note, published_name, published_at, data FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 100").bind(current.id).all()).results
      );
      return json({
        versions: rows.map((r) => {
          const d = /** @type {WorkflowDraft} */ (JSON.parse(r.data));
          return { version: Number(r.version), note: r.note, publishedBy: r.published_name, publishedAt: r.published_at, statuses: d.statuses.length, moves: d.transitions.length };
        }),
      });
    }
    const row = m[3] ? /** @type {{ data: string } | null} */ (await db.prepare("SELECT data FROM workflow_versions WHERE workflow_id = ? AND version = ?").bind(current.id, Number(m[3])).first()) : null;
    if (m[3] && !row) throw new HttpError(404, "Version not found");
    if (m[3] && !m[4] && method === "GET") return json({ version: Number(m[3]), workflow: JSON.parse(/** @type {{ data: string }} */ (row).data) });
    if (m[3] && m[4] && method === "POST") {
      // Restoring publishes the old version again, as a new version (so nothing is lost), with the same status moves.
      const writer = writerFor(current);
      const b = /** @type {{ moves?: Record<string, string> }} */ (await body(req));
      const draft = await checkDraft(db, current, JSON.parse(/** @type {{ data: string }} */ (row).data));
      return json(await publish(c, writer, current, draft, b.moves ?? {}, `Restored version ${m[3]}`));
    }
  }
  if (m && !m[2] && method === "DELETE") {
    const wf = await workflowById(m[1]);
    const writer = writerFor(wf);
    if (wf.isDefault) throw new HttpError(400, "The default workflow can't be deleted");
    const users = /** @type {{ n: number } | null} */ (
      await /** @type {Env} */ (c.env).ROOT.prepare(
        `SELECT (SELECT COUNT(*) FROM workspace_workflows WHERE organization_id = ? AND workflow_id = ?) + (SELECT COUNT(*) FROM systems WHERE organization_id = ? AND workflow_id = ?)
              + (SELECT COUNT(*) FROM item_types WHERE organization_id = ? AND workflow_id = ?) AS n`,
      )
        .bind(scope.orgId, wf.id, scope.orgId, wf.id, scope.orgId, wf.id)
        .first()
    );
    if (Number(users?.n)) throw new HttpError(400, `${wf.name} is in use. Give its workspaces, projects and item types another workflow first.`);
    await writer.prepare("DELETE FROM workflows WHERE id = ?").bind(wf.id).run();
    await c.audit("workflow_deleted", null, { workflow: wf.name });
    return json({ ok: true });
  }
  // ----- which workflow the workspace, each project and each item type uses -----
  if (path === "/api/workflow-assignments" && method === "PUT") {
    need();
    const b = /** @type {{ workspace?: string | null; workspaces?: Record<string, string | null>; projects?: Record<string, string | null>; itemTypes?: Record<string, string | null>; moves?: Record<string, string> }} */ (await body(req));
    const name = await workspaceName();
    // The workspace's own choice (older clients send it by name, as { workspaces: { <name>: id } }).
    const wsChoice = b.workspace !== undefined ? b.workspace : b.workspaces && name in b.workspaces ? b.workspaces[name] : undefined;
    const workflows = await loadWorkflows(db);
    const byId = new Map(workflows.map((w) => [w.id, w]));
    for (const v of [wsChoice, ...Object.values(b.projects ?? {}), ...Object.values(b.itemTypes ?? {})]) {
      if (v && !byId.has(v)) throw new HttpError(400, "Unknown workflow");
    }
    const defaultId = /** @type {Workflow} */ (workflows.find((w) => w.isDefault)).id;
    const wsNow = /** @type {{ workflow_id: string } | null} */ (await db.prepare("SELECT workflow_id FROM workspace_workflows WHERE workspace_id = ?").bind(scope.workspaceId).first())?.workflow_id ?? defaultId;
    const wsNext = wsChoice === undefined ? wsNow : (wsChoice ?? defaultId);
    const projects = /** @type {{ id: string; name: string; workflow_id: string | null }[]} */ ((await db.prepare("SELECT s.id, (s.data::json ->> 'name') AS name, s.workflow_id FROM systems s").all()).results);
    const own = new Map(projects.map((p) => [p.id, p.workflow_id]));
    for (const [p, v] of Object.entries(b.projects ?? {})) {
      if (!own.has(p)) throw new HttpError(404, "Project not found");
      own.set(p, v || null);
    }
    const types = await itemTypes(db);
    const typeWf = new Map(types.map((t) => [t.id, t.workflowId]));
    for (const [t, v] of Object.entries(b.itemTypes ?? {})) {
      if (!typeWf.has(t)) throw new HttpError(404, "Item type not found");
      typeWf.set(t, v || null);
    }
    // Every group of items (project, type) whose workflow changes, and what that does to their statuses.
    const used = await usage(db);
    const moves = b.moves ?? {};
    const after = /** @param {{ system_id: string; item_type: string }} u */ (u) => typeWf.get(u.item_type) ?? own.get(u.system_id) ?? wsNext;
    const changing = used.filter((u) => after(u) !== u.workflow_id);
    const missing = /** @type {Map<string, number>} */ (new Map());
    for (const u of changing) {
      const keeps = new Set(/** @type {Workflow} */ (byId.get(after(u))).statuses.map((s) => s.id));
      if (keeps.has(u.status)) continue;
      if (!moves[u.status]) missing.set(u.status, (missing.get(u.status) ?? 0) + u.n);
      else if (!keeps.has(moves[u.status])) throw new HttpError(400, `${/** @type {Workflow} */ (byId.get(after(u))).name} doesn't have the status chosen for the ${u.status} items`);
    }
    await refuseMissing(db, missing);
    for (const u of changing) {
      const target = /** @type {Workflow} */ (byId.get(after(u)));
      if (!target.statuses.some((s) => s.id === u.status)) await moveItems(c, "w.system_id = ? AND w.item_type = ?", [u.system_id, u.item_type], u.status, moves[u.status], `now follows ${target.name}`);
    }
    /** @type {D1PreparedStatement[]} */ const stmts = [];
    if (wsChoice !== undefined) {
      stmts.push(
        wsChoice
          ? db.prepare("INSERT INTO workspace_workflows (workspace_id, workspace, workflow_id) VALUES (?, ?, ?) ON CONFLICT (workspace_id) DO UPDATE SET workflow_id = excluded.workflow_id").bind(scope.workspaceId, name, wsChoice)
          : db.prepare("DELETE FROM workspace_workflows WHERE workspace_id = ?").bind(scope.workspaceId),
      );
    }
    for (const [p, v] of Object.entries(b.projects ?? {})) stmts.push(db.prepare("UPDATE systems SET workflow_id = ? WHERE id = ?").bind(v || null, p));
    for (const [t, v] of Object.entries(b.itemTypes ?? {})) stmts.push(db.prepare("UPDATE item_types SET workflow_id = ? WHERE id = ?").bind(v || null, t));
    if (stmts.length) await db.batch(stmts);
    const nameOf = /** @param {string | null | undefined} id */ (id) => (id ? (byId.get(id)?.name ?? id) : "the workspace's");
    await c.audit("workflow_assigned", null, {
      ...(wsChoice !== undefined ? { workspace: { from: nameOf(wsNow), to: nameOf(wsNext) } } : {}),
      projects: Object.fromEntries(Object.entries(b.projects ?? {}).map(([p, v]) => [projects.find((x) => x.id === p)?.name ?? p, { from: nameOf(projects.find((x) => x.id === p)?.workflow_id), to: nameOf(v) }])),
      itemTypes: Object.fromEntries(Object.entries(b.itemTypes ?? {}).map(([t, v]) => [types.find((x) => x.id === t)?.name ?? t, { from: nameOf(types.find((x) => x.id === t)?.workflowId), to: nameOf(v) }])),
      itemsAffected: changing.reduce((n, u) => n + u.n, 0),
    });
    return json({ ok: true, changed: new Set(changing.map((u) => u.system_id)).size });
  }
  throw new HttpError(404, "Not found");
}

/**
 * The workspace's item types, in order.
 * @param {D1Database} db
 * @returns {Promise<{ id: string; name: string; base: WorkItemType; description: string; active: boolean; position: number; workflowId: string | null; builtIn: boolean; items: number }[]>}
 */
export async function itemTypes(db) {
  const rows = /** @type {{ id: string; name: string; base: WorkItemType; description: string; active: number; position: number; workflow_id: string | null; items: number }[]} */ (
    (await db.prepare("SELECT t.*, (SELECT COUNT(*) FROM work_items w WHERE w.item_type = t.id) AS items FROM item_types t ORDER BY t.position, lower(t.name)").all()).results
  );
  return rows.map((t) => ({ id: t.id, name: t.name, base: t.base, description: t.description, active: !!t.active, position: Number(t.position), workflowId: t.workflow_id, builtIn: BASES.includes(/** @type {WorkItemType} */ (t.id)), items: Number(t.items) }));
}
/** @param {D1Database} db @param {string} id */
async function latestVersion(db, id) {
  return Number((/** @type {{ v: number | null } | null} */ (await db.prepare("SELECT MAX(version) AS v FROM workflow_versions WHERE workflow_id = ?").bind(id).first()))?.v ?? 0);
}

/**
 * Publishes a workflow: its items in statuses it no longer has move where `moves` says (refused, listing them,
 * when it doesn't say); the workflow becomes `draft`; the draft goes; and the result is kept as a new version (the
 * first publish also keeps how it was before, as version 1).
 * @param {ItemContext} c
 * @param {D1Database} writer  the workspace's handle, or the organisation's for a template
 * @param {Workflow} current
 * @param {WorkflowDraft} draft
 * @param {Record<string, string>} moves
 * @param {string} note
 */
async function publish(c, writer, current, draft, moves, note) {
  const db = c.db;
  const scope = /** @type {Scope} */ (c.scope);
  if (draft.name.toLowerCase() !== current.name.toLowerCase()) {
    const clash = current.workspaceId
      ? await db.prepare("SELECT 1 FROM workflows WHERE lower(name) = lower(?) AND workspace_id = ? AND id <> ?").bind(draft.name, current.workspaceId, current.id).first()
      : await writer.prepare("SELECT 1 FROM workflows WHERE lower(name) = lower(?) AND workspace_id IS NULL AND id <> ?").bind(draft.name, current.id).first();
    if (clash) throw new HttpError(409, `There's already a workflow called ${draft.name}`);
  }
  const keeps = new Set(draft.statuses.map((s) => s.id));
  const leaving = new Set(current.statuses.map((s) => s.id).filter((id) => !keeps.has(id)));
  if (current.workspaceId) {
    // Items in statuses leaving the workflow must go somewhere it keeps.
    const used = (await usage(db)).filter((u) => u.workflow_id === current.id);
    const missing = /** @type {Map<string, number>} */ (new Map());
    for (const u of used) if (leaving.has(u.status) && !moves[u.status]) missing.set(u.status, (missing.get(u.status) ?? 0) + u.n);
    await refuseMissing(db, missing);
    for (const [from, to] of Object.entries(moves)) if (leaving.has(from) && !keeps.has(to)) throw new HttpError(400, "Items can only move to a status this workflow keeps");
    for (const from of leaving) {
      if (used.some((u) => u.status === from)) await moveItems(c, `${ITEM_WORKFLOW} = ?`, [current.id], from, moves[from], `${from} left the ${draft.name} workflow`);
    }
  } else if (leaving.size) {
    // A template a workspace still uses directly: its items are that workspace's to move, so a status can't leave.
    const inUse = /** @type {{ n: number } | null} */ (
      await /** @type {Env} */ (c.env).ROOT.prepare(
        `SELECT COUNT(*) AS n FROM work_items w JOIN systems s ON s.id = w.system_id LEFT JOIN item_types it ON it.workspace_id = w.workspace_id AND it.id = w.item_type
         WHERE w.organization_id = ? AND ${ITEM_WORKFLOW} = ? AND w.status IN (${[...leaving].map(() => "?").join(", ")})`,
      )
        .bind(scope.orgId, current.id, ...leaving)
        .first()
    );
    if (Number(inUse?.n)) throw new HttpError(409, "Work items in some workspaces are in the statuses you're taking out. Those workspaces should use their own copy first.", "template_in_use");
  }
  const v = await latestVersion(db, current.id);
  const me = c.me;
  /** @type {D1PreparedStatement[]} */ const stmts = [
    writer.prepare("UPDATE workflows SET name = ?, description = ?, updated_at = ? WHERE id = ?").bind(draft.name, draft.description, c.now, current.id),
    writer.prepare("DELETE FROM workflow_transitions WHERE workflow_id = ?").bind(current.id),
    writer.prepare("DELETE FROM workflow_statuses WHERE workflow_id = ?").bind(current.id),
    ...draft.statuses.map((s, i) => writer.prepare("INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES (?, ?, ?, ?)").bind(current.id, s.id, i + 1, s.initial ? 1 : 0)),
  ];
  draft.transitions.forEach((t, i) => {
    const tid = newToken().slice(0, 16);
    stmts.push(writer.prepare("INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES (?, ?, ?, ?, ?, ?)").bind(tid, current.id, t.name, t.from, t.to, i + 1));
    for (const r of t.rules) stmts.push(writer.prepare("INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES (?, ?, ?, ?)").bind(tid, r.kind, r.rule, r.value ?? null));
  });
  const keep = /** @param {number} n @param {WorkflowDraft} d @param {string} why @param {string} at */ (n, d, why, at) =>
    writer.prepare("INSERT INTO workflow_versions (workflow_id, version, data, note, published_by, published_name, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(current.id, n, JSON.stringify(d), why.slice(0, 200), me.id, me.name, at);
  if (v === 0) stmts.push(keep(1, snapshot(current), "As it was before versions were kept", c.now));
  const version = v === 0 ? 2 : v + 1;
  stmts.push(keep(version, draft, note || `Version ${version}`, c.now));
  stmts.push(writer.prepare("DELETE FROM workflow_drafts WHERE workflow_id = ?").bind(current.id));
  await writer.batch(stmts);
  const catalogue = new Map((await statusCatalogue(db)).map((s) => [s.id, s]));
  const summary = /** @param {Pick<WorkflowDraft, "statuses" | "transitions">} w */ (w) => ({
    statuses: w.statuses.map((s) => catalogue.get(s.id)?.name ?? s.id),
    moves: w.transitions.map((t) => `${t.from ? (catalogue.get(t.from)?.name ?? t.from) : "Any"} → ${catalogue.get(t.to)?.name ?? t.to}${t.rules.length ? ` (${t.rules.length} rule${t.rules.length === 1 ? "" : "s"})` : ""}`),
  });
  await c.audit("workflow_updated", null, {
    workflow: draft.name,
    version,
    ...(draft.name !== current.name ? { renamed: { from: current.name, to: draft.name } } : {}),
    from: summary(current),
    to: summary(draft),
  });
  return { ...(await loadWorkflows(db, [current.id]))[0], version };
}
