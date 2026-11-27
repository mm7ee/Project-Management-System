/** @import { Rule, RuleKind, StatusDef, Workflow } from '../../project-management-system-frontend/src/data/workflows' */
/** @import { StatusCategory } from '../../project-management-system-frontend/src/data/workitems' */
export {}; // the type imports above belong to the file, not to the first function
/**
 * @param {D1Database} db
 * @returns {Promise<StatusDef[]>}
 */
export async function statusCatalogue(db) {
  const rows = await /** @type {Promise<D1Result<StatusDef>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, category FROM work_statuses ORDER BY position, name").all()));
  return rows.results;
}
/**
 * @param {D1Database} db
 * @param {string} status
 * @returns {Promise<StatusCategory | null>}
 */
export async function categoryOf(db, status) {
  return (await /** @type {Promise<{ category: StatusCategory; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT category FROM work_statuses WHERE id = ?").bind(status).first())))?.category ?? null;
}
/**
 * Every workflow with its statuses, transitions and rules, in three queries.
 * @param {D1Database} db
 * @param {string[]} [only]
 * @returns {Promise<Workflow[]>}
 */
export async function loadWorkflows(db, only) {
  const filter = only?.length ? ` WHERE id IN (${only.map(() => "?").join(", ")})` : "";
  const [wfs, sts, trs, rules] = await Promise.all([
    /** @type {Promise<D1Result<{ id: string; name: string; description: string; is_default: number; workspace_id: string | null; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT id, name, description, is_default, workspace_id FROM workflows${filter} ORDER BY workspace_id IS NULL, is_default DESC, name`)
          .bind(...(only ?? []))
          .all()
      )
    ),
    /** @type {Promise<D1Result<{ workflow_id: string; status_id: string; is_initial: number; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT workflow_id, status_id, is_initial FROM workflow_statuses ORDER BY position").all())),
    /** @type {Promise<D1Result<{ id: string; workflow_id: string; name: string; from_status: string | null; to_status: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, workflow_id, name, from_status, to_status FROM workflow_transitions ORDER BY position").all())),
    /** @type {Promise<D1Result<{ transition_id: string; kind: RuleKind; rule: string; value: string | null; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT transition_id, kind, rule, value FROM workflow_rules ORDER BY id").all())),
  ]);
  const rulesOf = /** @type {Map<string, Array<Rule>>} */ (/** @type {unknown} */ (new Map()));
  for (const r of rules.results) rulesOf.set(r.transition_id, [...(rulesOf.get(r.transition_id) ?? []), { kind: r.kind, rule: r.rule, value: r.value }]);
  return wfs.results.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    isDefault: !!w.is_default,
    workspaceId: w.workspace_id,
    statuses: sts.results.filter((s) => s.workflow_id === w.id).map((s) => ({ id: s.status_id, initial: !!s.is_initial })),
    transitions: trs.results.filter((t) => t.workflow_id === w.id).map((t) => ({ id: t.id, name: t.name, from: t.from_status, to: t.to_status, rules: rulesOf.get(t.id) ?? [] })),
  }));
}
/**
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<Workflow>}
 */
export async function loadWorkflow(db, id) {
  const [wf] = await loadWorkflows(db, [id]);
  if (!wf) throw new Error(`Workflow ${id} not found`);
  return wf;
}
/**
 * The SQL for a project's workflow: its own, else its workspace's, else the default. `s` is the systems row.
 */
export const EFFECTIVE_WORKFLOW = `COALESCE(s.workflow_id,
  (SELECT ww.workflow_id FROM workspace_workflows ww WHERE ww.workspace = (s.data::json ->> 'workspace')),
  (SELECT d.id FROM workflows d WHERE d.is_default = 1))`;
/**
 * The workflow an item follows: its item type's, if the type has one; else its project's, its workspace's or the
 * default.
 * @param {D1Database} db
 * @param {string} systemId
 * @param {string | null} [itemType]
 * @returns {Promise<string>}
 */
export async function workflowIdFor(db, systemId, itemType) {
  if (itemType) {
    const t = /** @type {{ workflow_id: string | null } | null} */ (await db.prepare("SELECT workflow_id FROM item_types WHERE id = ?").bind(itemType).first());
    if (t?.workflow_id) return t.workflow_id;
  }
  const row = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (db.prepare(`SELECT ${EFFECTIVE_WORKFLOW} AS id FROM systems s WHERE s.id = ?`).bind(systemId).first()));
  if (!row) throw new Error(`Project ${systemId} not found`);
  return row.id;
}
export const initialStatus =
  /** @param {Workflow} wf
   * @returns {string}
   */ (wf) => (wf.statuses.find((s) => s.initial) ?? wf.statuses[0]).id;
