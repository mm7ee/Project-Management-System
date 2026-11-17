// Reading workflows and statuses from the database. Used by work items (every status change is a
// transition), boards and the workflow editor.

import type { Rule, RuleKind, StatusDef, Workflow } from "../src/data/workflows";
import type { StatusCategory } from "../src/data/workitems";

export async function statusCatalogue(db: D1Database): Promise<StatusDef[]> {
  const rows = await db.prepare("SELECT id, name, category FROM work_statuses ORDER BY position, name").all<StatusDef>();
  return rows.results;
}

export async function categoryOf(db: D1Database, status: string): Promise<StatusCategory | null> {
  return (await db.prepare("SELECT category FROM work_statuses WHERE id = ?").bind(status).first<{ category: StatusCategory }>())?.category ?? null;
}

/** Every workflow with its statuses, transitions and rules, in three queries. */
export async function loadWorkflows(db: D1Database, only?: string[]): Promise<Workflow[]> {
  const filter = only?.length ? ` WHERE id IN (${only.map(() => "?").join(", ")})` : "";
  const [wfs, sts, trs, rules] = await Promise.all([
    db.prepare(`SELECT id, name, description, is_default FROM workflows${filter} ORDER BY is_default DESC, name`).bind(...(only ?? [])).all<{ id: string; name: string; description: string; is_default: number }>(),
    db.prepare("SELECT workflow_id, status_id, is_initial FROM workflow_statuses ORDER BY position").all<{ workflow_id: string; status_id: string; is_initial: number }>(),
    db.prepare("SELECT id, workflow_id, name, from_status, to_status FROM workflow_transitions ORDER BY position").all<{ id: string; workflow_id: string; name: string; from_status: string | null; to_status: string }>(),
    db.prepare("SELECT transition_id, kind, rule, value FROM workflow_rules ORDER BY id").all<{ transition_id: string; kind: RuleKind; rule: string; value: string | null }>(),
  ]);
  const rulesOf = new Map<string, Rule[]>();
  for (const r of rules.results) rulesOf.set(r.transition_id, [...(rulesOf.get(r.transition_id) ?? []), { kind: r.kind, rule: r.rule, value: r.value }]);
  return wfs.results.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    isDefault: !!w.is_default,
    statuses: sts.results.filter((s) => s.workflow_id === w.id).map((s) => ({ id: s.status_id, initial: !!s.is_initial })),
    transitions: trs.results
      .filter((t) => t.workflow_id === w.id)
      .map((t) => ({ id: t.id, name: t.name, from: t.from_status, to: t.to_status, rules: rulesOf.get(t.id) ?? [] })),
  }));
}

export async function loadWorkflow(db: D1Database, id: string): Promise<Workflow> {
  const [wf] = await loadWorkflows(db, [id]);
  if (!wf) throw new Error(`Workflow ${id} not found`);
  return wf;
}

/** The SQL for a project's workflow: its own, else its workspace's, else the default. `s` is the systems row. */
export const EFFECTIVE_WORKFLOW = `COALESCE(s.workflow_id,
  (SELECT ww.workflow_id FROM workspace_workflows ww WHERE ww.workspace = (s.data::json ->> 'workspace')),
  (SELECT d.id FROM workflows d WHERE d.is_default = 1))`;

export async function workflowIdFor(db: D1Database, systemId: string): Promise<string> {
  const row = await db.prepare(`SELECT ${EFFECTIVE_WORKFLOW} AS id FROM systems s WHERE s.id = ?`).bind(systemId).first<{ id: string }>();
  if (!row) throw new Error(`Project ${systemId} not found`);
  return row.id;
}

export const initialStatus = (wf: Workflow) => (wf.statuses.find((s) => s.initial) ?? wf.statuses[0]).id;
