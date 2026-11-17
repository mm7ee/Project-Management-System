// Settings → Administration → Workflows: the shared status list, the workflows (their statuses,
// moves and rules) and which workflow each workspace and project uses. Changes that would leave work
// items in a status their workflow no longer has must say where those items go ("moves"); without
// that, the request is refused with the statuses that need an answer.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { recomputeProgress, type ItemContext } from "./workitems";
import { EFFECTIVE_WORKFLOW, loadWorkflows, statusCatalogue } from "./workflowData";
import { ROLES } from "../src/data/roles";
import { FIELD_RULE_LABEL, RULES, type Rule, type RuleKind, type Workflow } from "../src/data/workflows";
import type { StatusCategory } from "../src/data/workitems";

const CATEGORIES: StatusCategory[] = ["TODO", "IN_PROGRESS", "DONE"];

/** Items per (workflow, status), by each project's workflow. */
async function usage(db: D1Database): Promise<{ workflow_id: string; status: string; system_id: string; n: number }[]> {
  return (
    await db
      .prepare(`SELECT ${EFFECTIVE_WORKFLOW} AS workflow_id, w.status, w.system_id, COUNT(*) AS n FROM work_items w JOIN systems s ON s.id = w.system_id GROUP BY 1, 2, 3`)
      .all<{ workflow_id: string; status: string; system_id: string; n: number }>()
  ).results.map((r) => ({ ...r, n: Number(r.n) }));
}

/** Moves every item in `systemIds` from one status to another, with history, the right resolution and one log entry. */
async function moveItems(c: ItemContext, systemIds: string[], from: string, to: string, why: string) {
  if (!systemIds.length) return 0;
  const db = c.db;
  const marks = systemIds.map(() => "?").join(", ");
  const toCat = (await db.prepare("SELECT category FROM work_statuses WHERE id = ?").bind(to).first<{ category: StatusCategory }>())!.category;
  const ids = (await db.prepare(`SELECT id FROM work_items WHERE status = ? AND system_id IN (${marks})`).bind(from, ...systemIds).all<{ id: string }>()).results.map((r) => r.id);
  if (!ids.length) return 0;
  const im = ids.map(() => "?").join(", ");
  await db.batch([
    db.prepare(`INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) SELECT id, status, ?, ?, ? FROM work_items WHERE id IN (${im})`).bind(to, c.me.id, c.now, ...ids),
    toCat === "DONE"
      ? db.prepare(`UPDATE work_items SET status = ?, resolution = COALESCE(resolution, 'DONE'), resolved_at = COALESCE(resolved_at, ?), on_hold = 0, updated_at = ? WHERE id IN (${im})`).bind(to, c.now, c.now, ...ids)
      : db.prepare(`UPDATE work_items SET status = ?, resolution = NULL, resolved_at = NULL, updated_at = ? WHERE id IN (${im})`).bind(to, c.now, ...ids),
  ]);
  await c.audit("work_items_moved", null, { from, to, count: ids.length, reason: why });
  for (const sid of new Set(systemIds)) await recomputeProgress(c, sid);
  return ids.length;
}

/** What an existing status needs before it leaves a workflow: the items in it, by project. */
function needMoves(rows: { status: string; system_id: string; n: number }[], leaving: Set<string>, moves: Record<string, string>) {
  const missing = new Map<string, number>();
  for (const r of rows) if (leaving.has(r.status) && !moves[r.status]) missing.set(r.status, (missing.get(r.status) ?? 0) + r.n);
  return missing;
}

async function refuseMissing(db: D1Database, missing: Map<string, number>) {
  if (!missing.size) return;
  const names = new Map((await statusCatalogue(db)).map((s) => [s.id, s.name]));
  const list = [...missing].map(([id, count]) => ({ id, name: names.get(id) ?? id, count }));
  throw new HttpError(
    409,
    `Some work items are in ${list.map((x) => `${x.name} (${x.count})`).join(", ")}. Choose where they should move.`,
    "needs_moves",
    { statuses: list },
  );
}

function cleanRules(raw: unknown, statusIds: Set<string>): Rule[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "Rules must be a list");
  return raw.map((x) => {
    const r = x as Record<string, unknown>;
    const kind = r.kind as RuleKind;
    const def = RULES[kind]?.find((d) => d.rule === r.rule);
    if (!def) throw new HttpError(400, `Unknown rule "${String(r.rule)}"`);
    const value = r.value === undefined || r.value === null || r.value === "" ? null : String(r.value).slice(0, 64);
    if (def.value && !value) throw new HttpError(400, `"${def.label}" needs a value`);
    if (def.value === "role" && !ROLES.includes(value as never)) throw new HttpError(400, "Unknown role");
    if (def.value === "field" && !(value! in FIELD_RULE_LABEL)) throw new HttpError(400, "Unknown field");
    if (def.value === "resolution" && value !== "DONE" && value !== "WONT_DO") throw new HttpError(400, "Unknown resolution");
    if (def.value === "notify" && !["watchers", "assignee", "reporter"].includes(value!) && !(value!.startsWith("role:") && ROLES.includes(value!.slice(5) as never))) {
      throw new HttpError(400, "Notify watchers, the assignee, the reporter or a role");
    }
    void statusIds;
    return { kind, rule: def.rule, value: def.value ? value : null };
  });
}

/** Handles /api/statuses, /api/workflows and /api/workflow-assignments; null for other paths. */
export async function workflowsApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/statuses") && !path.startsWith("/api/workflow")) return null;
  const { db, req } = c;
  const need = () => {
    if (c.guest || !c.can("manage_workflows")) throw new HttpError(403, "You don't have permission to change workflows");
  };

  if (path === "/api/statuses" && method === "GET") return json(await statusCatalogue(db));

  if (path === "/api/workflows" && method === "GET") {
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const [workflows, statuses, ws, projects, used] = await Promise.all([
      loadWorkflows(db),
      statusCatalogue(db),
      db.prepare("SELECT workspace, workflow_id FROM workspace_workflows ORDER BY workspace").all<{ workspace: string; workflow_id: string }>(),
      db
        .prepare(`SELECT s.id, s.key, (s.data::json ->> 'name') AS name, (s.data::json ->> 'workspace') AS workspace, s.workflow_id, ${EFFECTIVE_WORKFLOW} AS effective FROM systems s ORDER BY s.sort, s.rowid`)
        .all<{ id: string; key: string; name: string; workspace: string | null; workflow_id: string | null; effective: string }>(),
      usage(db),
    ]);
    const counts: Record<string, Record<string, number>> = {};
    for (const u of used) (counts[u.workflow_id] ??= {})[u.status] = (counts[u.workflow_id][u.status] ?? 0) + u.n;
    return json({
      workflows,
      statuses,
      workspaces: Object.fromEntries(ws.results.map((w) => [w.workspace, w.workflow_id])),
      projects: projects.results.map((p) => ({ id: p.id, key: p.key, name: p.name, workspace: p.workspace, workflowId: p.workflow_id, effective: p.effective })),
      usage: counts,
    });
  }

  // ----- statuses -----
  if (path === "/api/statuses" && method === "POST") {
    need();
    const b = await body<{ name?: unknown; category?: unknown }>(req);
    const name = String(b.name ?? "").trim().slice(0, 40);
    if (!name) throw new HttpError(400, "A status needs a name");
    if (!CATEGORIES.includes(b.category as StatusCategory)) throw new HttpError(400, "Choose To Do, In Progress or Done");
    if (await db.prepare("SELECT 1 FROM work_statuses WHERE lower(name) = lower(?)").bind(name).first()) throw new HttpError(409, `There's already a status called ${name}`);
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "S$1").slice(0, 36) || "STATUS";
    let id = base;
    for (let n = 2; await db.prepare("SELECT 1 FROM work_statuses WHERE id = ?").bind(id).first(); n++) id = `${base}_${n}`;
    const pos = (await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM work_statuses").first<{ p: number }>())!.p;
    await db.prepare("INSERT INTO work_statuses (id, name, category, position, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, name, b.category, pos, c.now).run();
    await c.audit("status_created", null, { status: name, category: b.category });
    return json({ id, name, category: b.category }, 201);
  }

  let m = path.match(/^\/api\/statuses\/([A-Z][A-Z0-9_]{0,39})$/);
  if (m && method === "PATCH") {
    need();
    const row = await db.prepare("SELECT id, name, category FROM work_statuses WHERE id = ?").bind(m[1]).first<{ id: string; name: string; category: StatusCategory }>();
    if (!row) throw new HttpError(404, "Status not found");
    const b = await body<{ name?: unknown; category?: unknown }>(req);
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 40) : row.name;
    if (!name) throw new HttpError(400, "A status needs a name");
    const category = b.category !== undefined ? (b.category as StatusCategory) : row.category;
    if (!CATEGORIES.includes(category)) throw new HttpError(400, "Choose To Do, In Progress or Done");
    if (name.toLowerCase() !== row.name.toLowerCase() && (await db.prepare("SELECT 1 FROM work_statuses WHERE lower(name) = lower(?)").bind(name).first())) {
      throw new HttpError(409, `There's already a status called ${name}`);
    }
    const stmts = [db.prepare("UPDATE work_statuses SET name = ?, category = ? WHERE id = ?").bind(name, category, row.id)];
    // Items in it gain or lose their resolution with the category.
    if (category !== row.category && category === "DONE") {
      stmts.push(db.prepare("UPDATE work_items SET resolution = COALESCE(resolution, 'DONE'), resolved_at = COALESCE(resolved_at, ?), on_hold = 0 WHERE status = ?").bind(c.now, row.id));
    }
    if (category !== row.category && row.category === "DONE") {
      stmts.push(db.prepare("UPDATE work_items SET resolution = NULL, resolved_at = NULL WHERE status = ?").bind(row.id));
    }
    await db.batch(stmts);
    await c.audit("status_updated", null, { status: name, from: { name: row.name, category: row.category }, to: { name, category } });
    return json({ id: row.id, name, category });
  }

  if (m && method === "DELETE") {
    need();
    const row = await db.prepare("SELECT id, name FROM work_statuses WHERE id = ?").bind(m[1]).first<{ id: string; name: string }>();
    if (!row) throw new HttpError(404, "Status not found");
    const b = await body<{ moveTo?: unknown }>(req).catch(() => ({ moveTo: undefined }));
    const starts = await db.prepare("SELECT w.name FROM workflow_statuses ws JOIN workflows w ON w.id = ws.workflow_id WHERE ws.status_id = ? AND ws.is_initial = 1").bind(row.id).all<{ name: string }>();
    if (starts.results.length) throw new HttpError(400, `It's where work items start in ${starts.results.map((x) => x.name).join(", ")}. Choose another starting status there first.`);
    const inUse = (await usage(db)).filter((u) => u.status === row.id);
    if (inUse.length) {
      const moveTo = String(b.moveTo ?? "");
      if (!moveTo) await refuseMissing(db, new Map([[row.id, inUse.reduce((n, u) => n + u.n, 0)]]));
      if (moveTo === row.id) throw new HttpError(400, "Choose a different status");
      // The target must be in the workflow of every project whose items move.
      const wfs = await loadWorkflows(db, [...new Set(inUse.map((u) => u.workflow_id))]);
      const lacking = wfs.filter((w) => !w.statuses.some((s) => s.id === moveTo));
      if (lacking.length) throw new HttpError(400, `${lacking.map((w) => w.name).join(", ")} doesn't use that status; choose one every affected workflow has`);
      await moveItems(c, [...new Set(inUse.map((u) => u.system_id))], row.id, moveTo, `status ${row.name} deleted`);
    }
    await db.batch([
      db.prepare("DELETE FROM workflow_transitions WHERE from_status = ? OR to_status = ?").bind(row.id, row.id),
      db.prepare("DELETE FROM workflow_statuses WHERE status_id = ?").bind(row.id),
      db.prepare("DELETE FROM work_statuses WHERE id = ?").bind(row.id),
    ]);
    await c.audit("status_deleted", null, { status: row.name, ...(b.moveTo ? { movedTo: b.moveTo } : {}) });
    return json({ ok: true });
  }

  // ----- workflows -----
  if (path === "/api/workflows" && method === "POST") {
    need();
    const b = await body<{ name?: unknown; copyFrom?: unknown }>(req);
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!name) throw new HttpError(400, "A workflow needs a name");
    if (await db.prepare("SELECT 1 FROM workflows WHERE lower(name) = lower(?)").bind(name).first()) throw new HttpError(409, `There's already a workflow called ${name}`);
    const [from] = await loadWorkflows(db, [String(b.copyFrom ?? "default")]);
    if (!from) throw new HttpError(404, "Workflow to copy not found");
    const id = newToken().slice(0, 16);
    const stmts = [
      db.prepare("INSERT INTO workflows (id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)").bind(id, name, `A copy of ${from.name}.`, c.now, c.now),
      ...from.statuses.map((s, i) => db.prepare("INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES (?, ?, ?, ?)").bind(id, s.id, i + 1, s.initial ? 1 : 0)),
    ];
    from.transitions.forEach((t, i) => {
      const tid = newToken().slice(0, 16);
      stmts.push(db.prepare("INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES (?, ?, ?, ?, ?, ?)").bind(tid, id, t.name, t.from, t.to, i + 1));
      for (const r of t.rules) stmts.push(db.prepare("INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES (?, ?, ?, ?)").bind(tid, r.kind, r.rule, r.value ?? null));
    });
    await db.batch(stmts);
    await c.audit("workflow_created", null, { workflow: name, copiedFrom: from.name });
    return json((await loadWorkflows(db, [id]))[0], 201);
  }

  m = path.match(/^\/api\/workflows\/([a-z0-9-]{1,40})$/);
  if (m && method === "PUT") {
    need();
    const [current] = await loadWorkflows(db, [m[1]]);
    if (!current) throw new HttpError(404, "Workflow not found");
    const b = await body<{
      name?: unknown;
      description?: unknown;
      statuses?: { id: string; initial?: boolean }[];
      transitions?: { id?: string; name?: unknown; from?: string | null; to?: string; rules?: unknown }[];
      moves?: Record<string, string>;
    }>(req);
    const name = String(b.name ?? current.name).trim().slice(0, 60);
    if (!name) throw new HttpError(400, "A workflow needs a name");
    if (name.toLowerCase() !== current.name.toLowerCase() && (await db.prepare("SELECT 1 FROM workflows WHERE lower(name) = lower(?)").bind(name).first())) {
      throw new HttpError(409, `There's already a workflow called ${name}`);
    }
    const description = String(b.description ?? current.description).trim().slice(0, 300);
    const catalogue = new Map((await statusCatalogue(db)).map((s) => [s.id, s]));
    const statuses = Array.isArray(b.statuses) ? b.statuses : current.statuses;
    if (!statuses.length) throw new HttpError(400, "A workflow needs at least one status");
    const ids = statuses.map((s) => String(s.id));
    if (new Set(ids).size !== ids.length) throw new HttpError(400, "A status can appear once in a workflow");
    for (const id of ids) if (!catalogue.has(id)) throw new HttpError(400, `Unknown status ${id}`);
    if (statuses.filter((s) => s.initial).length !== 1) throw new HttpError(400, "Choose exactly one status where work items start");
    const inWf = new Set(ids);
    const rawTransitions = Array.isArray(b.transitions) ? b.transitions : current.transitions;
    const transitions = rawTransitions.map((t, i) => {
      const from = t.from ? String(t.from) : null;
      const to = String(t.to ?? "");
      if (from && !inWf.has(from)) throw new HttpError(400, `Move ${i + 1} starts from a status this workflow doesn't use`);
      if (!inWf.has(to)) throw new HttpError(400, `Move ${i + 1} goes to a status this workflow doesn't use`);
      if (from === to) throw new HttpError(400, `Move ${i + 1} goes nowhere`);
      const tname = String(t.name ?? "").trim().slice(0, 60) || `To ${catalogue.get(to)!.name}`;
      return { name: tname, from, to, rules: cleanRules(t.rules, inWf) };
    });
    const pairs = transitions.map((t) => `${t.from ?? "*"}>${t.to}`);
    if (new Set(pairs).size !== pairs.length) throw new HttpError(400, "Two moves go between the same statuses");

    // Statuses leaving the workflow: their items, in projects that use it, must go somewhere it keeps.
    const leaving = new Set(current.statuses.map((s) => s.id).filter((id) => !inWf.has(id)));
    const used = (await usage(db)).filter((u) => u.workflow_id === current.id);
    const moves = b.moves ?? {};
    await refuseMissing(db, needMoves(used, leaving, moves));
    for (const [from, to] of Object.entries(moves)) if (leaving.has(from) && !inWf.has(to)) throw new HttpError(400, "Items can only move to a status this workflow keeps");

    for (const from of leaving) {
      const systems = used.filter((u) => u.status === from).map((u) => u.system_id);
      if (systems.length) await moveItems(c, systems, from, moves[from], `${from} left the ${name} workflow`);
    }
    const stmts = [
      db.prepare("UPDATE workflows SET name = ?, description = ?, updated_at = ? WHERE id = ?").bind(name, description, c.now, current.id),
      db.prepare("DELETE FROM workflow_transitions WHERE workflow_id = ?").bind(current.id),
      db.prepare("DELETE FROM workflow_statuses WHERE workflow_id = ?").bind(current.id),
      ...statuses.map((s, i) => db.prepare("INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES (?, ?, ?, ?)").bind(current.id, s.id, i + 1, s.initial ? 1 : 0)),
    ];
    transitions.forEach((t, i) => {
      const tid = newToken().slice(0, 16);
      stmts.push(db.prepare("INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES (?, ?, ?, ?, ?, ?)").bind(tid, current.id, t.name, t.from, t.to, i + 1));
      for (const r of t.rules) stmts.push(db.prepare("INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES (?, ?, ?, ?)").bind(tid, r.kind, r.rule, r.value ?? null));
    });
    await db.batch(stmts);
    const summary = (w: Pick<Workflow, "statuses" | "transitions">) => ({
      statuses: w.statuses.map((s) => catalogue.get(s.id)?.name ?? s.id),
      moves: w.transitions.map((t) => `${t.from ? (catalogue.get(t.from)?.name ?? t.from) : "Any"} → ${catalogue.get(t.to)?.name ?? t.to}${t.rules.length ? ` (${t.rules.length} rule${t.rules.length === 1 ? "" : "s"})` : ""}`),
    });
    await c.audit("workflow_updated", null, {
      workflow: name,
      ...(name !== current.name ? { renamed: { from: current.name, to: name } } : {}),
      from: summary(current),
      to: summary({ statuses: statuses.map((s) => ({ id: s.id, initial: !!s.initial })), transitions: transitions.map((t, i) => ({ id: String(i), ...t })) }),
    });
    return json((await loadWorkflows(db, [current.id]))[0]);
  }

  if (m && method === "DELETE") {
    need();
    const [wf] = await loadWorkflows(db, [m[1]]);
    if (!wf) throw new HttpError(404, "Workflow not found");
    if (wf.isDefault) throw new HttpError(400, "The default workflow can't be deleted");
    const users = await db
      .prepare("SELECT (SELECT COUNT(*) FROM workspace_workflows WHERE workflow_id = ?) + (SELECT COUNT(*) FROM systems WHERE workflow_id = ?) AS n")
      .bind(wf.id, wf.id)
      .first<{ n: number }>();
    if (Number(users?.n)) throw new HttpError(400, `${wf.name} is in use. Give its workspaces and projects another workflow first.`);
    await db.prepare("DELETE FROM workflows WHERE id = ?").bind(wf.id).run();
    await c.audit("workflow_deleted", null, { workflow: wf.name });
    return json({ ok: true });
  }

  // ----- which workflow each workspace and project uses -----
  if (path === "/api/workflow-assignments" && method === "PUT") {
    need();
    const b = await body<{ workspaces?: Record<string, string | null>; projects?: Record<string, string | null>; moves?: Record<string, string> }>(req);
    const workflows = await loadWorkflows(db);
    const known = new Set(workflows.map((w) => w.id));
    for (const v of [...Object.values(b.workspaces ?? {}), ...Object.values(b.projects ?? {})]) if (v && !known.has(v)) throw new HttpError(400, "Unknown workflow");
    const before = (
      await db
        .prepare(`SELECT s.id, (s.data::json ->> 'name') AS name, (s.data::json ->> 'workspace') AS workspace, s.workflow_id, ${EFFECTIVE_WORKFLOW} AS effective FROM systems s`)
        .all<{ id: string; name: string; workspace: string | null; workflow_id: string | null; effective: string }>()
    ).results;
    const wsNow = new Map((await db.prepare("SELECT workspace, workflow_id FROM workspace_workflows").all<{ workspace: string; workflow_id: string }>()).results.map((r) => [r.workspace, r.workflow_id]));
    const wsNext = new Map(wsNow);
    for (const [w, v] of Object.entries(b.workspaces ?? {})) {
      if (v) wsNext.set(w.slice(0, 60), v);
      else wsNext.delete(w);
    }
    const defaultId = workflows.find((w) => w.isDefault)!.id;
    const own = new Map(before.map((p) => [p.id, p.workflow_id]));
    for (const [p, v] of Object.entries(b.projects ?? {})) {
      if (!own.has(p)) throw new HttpError(404, "Project not found");
      own.set(p, v || null);
    }
    // Each project's workflow before and after, and what that does to its items' statuses.
    const changes = before
      .map((p) => ({ ...p, next: own.get(p.id) ?? (p.workspace ? wsNext.get(p.workspace) : undefined) ?? defaultId }))
      .filter((p) => p.next !== p.effective);
    const used = await usage(db);
    const byId = new Map(workflows.map((w) => [w.id, w]));
    const moves = b.moves ?? {};
    const missing = new Map<string, number>();
    for (const p of changes) {
      const keeps = new Set(byId.get(p.next)!.statuses.map((s) => s.id));
      for (const u of used.filter((x) => x.system_id === p.id && !keeps.has(x.status))) {
        if (!moves[u.status]) missing.set(u.status, (missing.get(u.status) ?? 0) + u.n);
        else if (!keeps.has(moves[u.status])) {
          throw new HttpError(400, `${p.name} will use ${byId.get(p.next)!.name}, which doesn't have the status chosen for its ${u.status} items`);
        }
      }
    }
    await refuseMissing(db, missing);
    for (const p of changes) {
      const keeps = new Set(byId.get(p.next)!.statuses.map((s) => s.id));
      for (const u of used.filter((x) => x.system_id === p.id && !keeps.has(x.status))) await moveItems(c, [p.id], u.status, moves[u.status], `${p.name} now uses ${byId.get(p.next)!.name}`);
    }
    const stmts: D1PreparedStatement[] = [];
    for (const [w, v] of Object.entries(b.workspaces ?? {})) {
      stmts.push(
        v
          ? db.prepare("INSERT INTO workspace_workflows (workspace, workflow_id) VALUES (?, ?) ON CONFLICT (workspace) DO UPDATE SET workflow_id = excluded.workflow_id").bind(w.slice(0, 60), v)
          : db.prepare("DELETE FROM workspace_workflows WHERE workspace = ?").bind(w),
      );
    }
    for (const [p, v] of Object.entries(b.projects ?? {})) stmts.push(db.prepare("UPDATE systems SET workflow_id = ? WHERE id = ?").bind(v || null, p));
    if (stmts.length) await db.batch(stmts);
    const nameOf = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? id) : "the workspace's");
    await c.audit("workflow_assigned", null, {
      workspaces: Object.fromEntries(Object.entries(b.workspaces ?? {}).map(([w, v]) => [w, { from: nameOf(wsNow.get(w) ?? defaultId), to: nameOf(v ?? defaultId) }])),
      projects: Object.fromEntries(
        Object.entries(b.projects ?? {}).map(([p, v]) => [before.find((x) => x.id === p)?.name ?? p, { from: nameOf(before.find((x) => x.id === p)?.workflow_id), to: nameOf(v) }]),
      ),
      changed: changes.map((p) => `${p.name}: ${nameOf(p.effective)} → ${nameOf(p.next)}`),
    });
    return json({ ok: true, changed: changes.length });
  }

  throw new HttpError(404, "Not found");
}
