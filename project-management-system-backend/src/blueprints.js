/** @import { Blueprint, BlueprintWorkflow } from '../../project-management-system-frontend/src/data/workspaceTemplates' */
// Workspace blueprints (src/data/workspaceTemplates.js): reading a workspace's set-up, and building a new workspace from one.
// Both work through a handle scoped to the workspace concerned, so row-level security keeps each to its own
// workspace (and its organisation's statuses and templates).
import { newToken } from "./auth";
import { HttpError } from "./http";
import { loadWorkflows, statusCatalogue } from "./workflowData";

/**
 * A workspace's set-up, without its work: the workflow it uses and its item types' workflows, the statuses those use,
 * its item types, custom fields, automation rules and workload limits.
 * @param {D1Database} db  scoped to the workspace
 * @param {string} workspaceId
 * @returns {Promise<Blueprint>}
 */
export async function exportBlueprint(db, workspaceId) {
  const ws = /** @type {{ workflow_id: string } | null} */ (await db.prepare("SELECT workflow_id FROM workspace_workflows WHERE workspace_id = ?").bind(workspaceId).first());
  const def = /** @type {{ id: string } | null} */ (await db.prepare("SELECT id FROM workflows WHERE is_default = 1").first());
  const types = /** @type {{ id: string; name: string; base: string; description: string; active: number; workflow_id: string | null }[]} */ (
    (await db.prepare("SELECT id, name, base, description, active, workflow_id FROM item_types ORDER BY position, name").all()).results
  );
  const main = ws?.workflow_id ?? def?.id;
  if (!main) throw new HttpError(409, "This workspace has no workflow to copy");
  const ids = [...new Set([main, ...types.map((t) => t.workflow_id).filter(/** @returns {x is string} */ (x) => !!x)])];
  const workflows = await loadWorkflows(db, ids);
  const catalogue = new Map((await statusCatalogue(db)).map((s) => [s.id, s]));
  const used = new Set(workflows.flatMap((w) => w.statuses.map((s) => s.id)));
  const fields = /** @type {Record<string, unknown>[]} */ ((await db.prepare("SELECT * FROM custom_fields ORDER BY position, name").all()).results);
  const options = /** @type {{ field_id: string; label: string }[]} */ ((await db.prepare("SELECT field_id, label FROM custom_field_options ORDER BY position").all()).results);
  const rules = /** @type {Record<string, unknown>[]} */ ((await db.prepare("SELECT * FROM automation_rules WHERE scope = 'workspace' ORDER BY name").all()).results);
  const actions = /** @type {Record<string, unknown>[]} */ ((await db.prepare("SELECT * FROM automation_actions ORDER BY position").all()).results);
  const limits = /** @type {{ value: string } | null} */ (await db.prepare("SELECT value FROM workspace_settings WHERE key = 'workload_limits'").first());
  return {
    statuses: [...used].map((id) => {
      const s = catalogue.get(id);
      return { key: id, name: s?.name ?? id, category: s?.category ?? "TODO" };
    }),
    workflows: workflows.map((w) => ({
      key: w.id,
      name: w.name,
      description: w.description,
      statuses: w.statuses.map((s) => ({ status: s.id, initial: s.initial })),
      transitions: w.transitions.map((t) => ({ name: t.name, from: t.from, to: t.to, rules: t.rules.map((r) => ({ kind: r.kind, rule: r.rule, value: r.value ?? null })) })),
    })),
    workspaceWorkflow: main,
    itemTypes: types.map((t) => ({ id: t.id, name: t.name, base: /** @type {any} */ (t.base), description: t.description, active: !!t.active, workflow: t.workflow_id })),
    fields: fields.map((f) => ({
      name: String(f.name),
      kind: /** @type {any} */ (f.kind),
      description: String(f.description ?? ""),
      required: !!f.required,
      onBoard: !!f.on_board,
      defaultValue: /** @type {string | null} */ (f.default_value ?? null),
      currency: /** @type {string | null} */ (f.currency ?? null),
      itemTypes: f.item_types ? JSON.parse(String(f.item_types)) : null,
      options: options.filter((o) => o.field_id === f.id).map((o) => o.label),
    })),
    rules: rules.map((r) => ({ ...r, actions: actions.filter((a) => a.rule_id === r.id) })),
    limits: limits?.value ?? null,
  };
}

/** A status id from its name, as the status editor makes them. @param {string} name */
const statusIdFrom = (name) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "S$1")
    .slice(0, 36) || "STATUS";

/**
 * Checks a blueprint's shape before anything is written: every workflow has statuses with one start, its moves join
 * its own statuses, and types, fields and the workspace's workflow refer to things the blueprint has.
 * @param {Blueprint} bp
 */
export function checkBlueprint(bp) {
  const statusKeys = new Set(bp.statuses.map((s) => s.key));
  const wfKeys = new Set(bp.workflows.map((w) => w.key));
  if (!wfKeys.has(bp.workspaceWorkflow)) throw new HttpError(400, "The template's workspace workflow is missing");
  for (const w of bp.workflows) {
    const own = new Set(w.statuses.map((s) => s.status));
    if (!own.size || [...own].some((s) => !statusKeys.has(s))) throw new HttpError(400, `${w.name} uses a status the template doesn't have`);
    if (w.statuses.filter((s) => s.initial).length !== 1) throw new HttpError(400, `${w.name} needs exactly one starting status`);
    const pairs = new Set();
    for (const t of w.transitions) {
      if ((t.from && !own.has(t.from)) || !own.has(t.to)) throw new HttpError(400, `A move in ${w.name} uses a status it doesn't have`);
      const pair = `${t.from ?? "*"}>${t.to}`;
      if (pairs.has(pair)) throw new HttpError(400, `${w.name} has two moves between the same statuses`);
      pairs.add(pair);
    }
  }
  const typeIds = new Set(bp.itemTypes.map((t) => t.id));
  for (const b of ["EPIC", "STORY", "TASK", "BUG", "SUBTASK"]) if (!typeIds.has(b)) throw new HttpError(400, `The template must keep the built-in ${b.toLowerCase()} type`);
  for (const t of bp.itemTypes) if (t.workflow && !wfKeys.has(t.workflow)) throw new HttpError(400, `${t.name} uses a workflow the template doesn't have`);
  for (const f of bp.fields) for (const t of f.itemTypes ?? []) if (!typeIds.has(t)) throw new HttpError(400, `${f.name} is for an item type the template doesn't have`);
}

/**
 * Builds a new, empty workspace's set-up from a blueprint, in one transaction: missing statuses are added to the
 * organisation's (matched by name), the workflows become the workspace's own, and the item types, fields,
 * automation rules (switched off) and workload limits are the workspace's. Whatever the workspace was given when it
 * was made (the default workflow's copy) is replaced. Refused for a workspace that already has projects.
 * @param {D1Database} db  scoped to the new workspace
 * @param {string} workspaceId
 * @param {string} workspaceName
 * @param {Blueprint} bp
 * @param {{ rules?: boolean }} [o]  rules: copy the automation rules (only within one organisation)
 * @returns {Promise<{ statusesAdded: number; workflows: number; itemTypes: number; fields: number; rules: number }>}
 */
export async function applyBlueprint(db, workspaceId, workspaceName, bp, o = {}) {
  checkBlueprint(bp);
  if (await db.prepare("SELECT 1 FROM systems LIMIT 1").first()) throw new HttpError(409, "A template can only set up a workspace with no projects yet");
  const now = new Date().toISOString();
  /** @type {D1PreparedStatement[]} */ const writes = [];
  // Statuses: the organisation's by name, or new ones.
  const catalogue = await statusCatalogue(db);
  const byName = new Map(catalogue.map((s) => [s.name.toLowerCase(), s.id]));
  const taken = new Set(catalogue.map((s) => s.id));
  let pos = catalogue.length;
  /** @type {Map<string, string>} */ const statusOf = new Map();
  let statusesAdded = 0;
  for (const s of bp.statuses) {
    const existing = byName.get(s.name.trim().toLowerCase());
    if (existing) {
      statusOf.set(s.key, existing);
      continue;
    }
    const base = statusIdFrom(s.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    taken.add(id);
    byName.set(s.name.trim().toLowerCase(), id);
    statusOf.set(s.key, id);
    writes.push(db.prepare("INSERT INTO work_statuses (id, name, category, position, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, s.name.trim().slice(0, 40), s.category, ++pos, now));
    statusesAdded += 1;
  }
  // The workflows it was made with go; the blueprint's take their place.
  writes.push(db.prepare("UPDATE item_types SET workflow_id = NULL WHERE workspace_id = ?").bind(workspaceId));
  writes.push(db.prepare("DELETE FROM workspace_workflows WHERE workspace_id = ?").bind(workspaceId));
  writes.push(db.prepare("DELETE FROM workflows WHERE workspace_id = ?").bind(workspaceId));
  /** @type {Map<string, string>} */ const workflowOf = new Map();
  for (const w of /** @type {BlueprintWorkflow[]} */ (bp.workflows)) {
    const id = newToken().slice(0, 16);
    workflowOf.set(w.key, id);
    writes.push(
      db.prepare("INSERT INTO workflows (id, workspace_id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(id, workspaceId, w.name.slice(0, 60), w.description.slice(0, 300), now, now),
    );
    w.statuses.forEach((s, i) => writes.push(db.prepare("INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES (?, ?, ?, ?)").bind(id, statusOf.get(s.status), i + 1, s.initial ? 1 : 0)));
    w.transitions.forEach((t, i) => {
      const tid = newToken().slice(0, 16);
      writes.push(db.prepare("INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES (?, ?, ?, ?, ?, ?)").bind(tid, id, t.name.slice(0, 60), t.from ? statusOf.get(t.from) : null, statusOf.get(t.to), i + 1));
      for (const r of t.rules) writes.push(db.prepare("INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES (?, ?, ?, ?)").bind(tid, r.kind, r.rule, r.value ?? null));
    });
  }
  writes.push(db.prepare("INSERT INTO workspace_workflows (workspace_id, workspace, workflow_id) VALUES (?, ?, ?)").bind(workspaceId, workspaceName, workflowOf.get(bp.workspaceWorkflow)));
  // Item types: the built-in five are renamed or switched off; the rest are added.
  bp.itemTypes.forEach((t, i) => {
    const workflow = t.workflow ? (workflowOf.get(t.workflow) ?? null) : null;
    writes.push(
      db
        .prepare(
          `INSERT INTO item_types (workspace_id, id, name, base, description, position, active, workflow_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, id) DO UPDATE SET name = excluded.name, description = excluded.description, position = excluded.position, active = excluded.active, workflow_id = excluded.workflow_id`,
        )
        .bind(workspaceId, t.id, t.name.slice(0, 40), t.base, (t.description ?? "").slice(0, 300), i, t.active === false ? 0 : 1, workflow, now),
    );
  });
  // Custom fields, as the workspace's.
  writes.push(db.prepare("DELETE FROM custom_fields WHERE workspace_id = ?").bind(workspaceId));
  bp.fields.forEach((f, i) => {
    const id = newToken().slice(0, 16);
    writes.push(
      db
        .prepare(
          `INSERT INTO custom_fields (id, workspace, name, kind, description, required, on_create, on_edit, on_view, on_board, position, default_value, item_types, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, workspaceName, f.name.slice(0, 60), f.kind, (f.description ?? "").slice(0, 300), f.required ? 1 : 0, f.onBoard ? 1 : 0, i, f.defaultValue ?? null, f.itemTypes ? JSON.stringify(f.itemTypes) : null, f.currency ?? null, now, now),
    );
    (f.options ?? []).forEach((label, j) => writes.push(db.prepare("INSERT INTO custom_field_options (id, field_id, label, position) VALUES (?, ?, ?, ?)").bind(newToken().slice(0, 16), id, label.slice(0, 60), j)));
  });
  // Automation rules: only between workspaces of one organisation (they name its statuses and people), and off.
  let rules = 0;
  if (o.rules) {
    for (const r of bp.rules ?? []) {
      const id = newToken().slice(0, 12);
      rules += 1;
      writes.push(
        db
          .prepare(
            `INSERT INTO automation_rules (id, name, description, enabled, scope, scope_value, trigger, trigger_value, schedule_weekday, schedule_hour, condition_pql, max_per_minute, created_by, created_at, updated_at)
             VALUES (?, ?, ?, 0, 'workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, r.name, r.description, workspaceName, r.trigger, r.trigger_value, r.schedule_weekday, r.schedule_hour, r.condition_pql, r.max_per_minute, r.created_by, now, now),
      );
      for (const a of /** @type {Record<string, unknown>[]} */ (r.actions ?? [])) {
        writes.push(db.prepare("INSERT INTO automation_actions (id, rule_id, position, kind, field, value, value2) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newToken().slice(0, 12), id, a.position, a.kind, a.field, a.value, a.value2));
      }
    }
  }
  if (bp.limits) {
    writes.push(db.prepare("INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, 'workload_limits', ?) ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value").bind(workspaceId, bp.limits));
  }
  await db.batch(writes);
  return { statusesAdded, workflows: bp.workflows.length, itemTypes: bp.itemTypes.length, fields: bp.fields.length, rules };
}
