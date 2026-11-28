// Project lifecycles (migration 0025, docs/lifecycle-plan.md). The rules are src/data/lifecycle.js (shared with the
// screens); this file reads what the gates need, enforces who may do what, and records every change.
//   Templates (Settings → Project Lifecycle; Organisation Administrators change them):
//     GET  /api/lifecycle/templates                     every template the organisation has (drafts for its admins)
//     POST /api/lifecycle/templates                     a new template (draft): { name, definition?, from?: "standard" }
//     PUT  /api/lifecycle/templates/:id                 change a draft: { name?, definition? }
//     POST /api/lifecycle/templates/:id/publish         publish the draft; { default?: true }
//     POST /api/lifecycle/templates/:id/draft           start a new draft from a published version
//     POST /api/lifecycle/templates/:id/default         make it the default for new projects
//   A project (anyone who can see it reads; the rules decide the rest):
//     GET  /api/systems/:id/lifecycle                   where it is, the gate, sign-offs, history, registers
//     POST /api/systems/:id/lifecycle/start             give it a lifecycle: { templateId? }
//     POST /api/systems/:id/lifecycle/advance           { comment? } (refused, with what's missing, until the gate is met)
//     POST /api/systems/:id/lifecycle/send-back         { to, reason }
//     POST /api/systems/:id/lifecycle/skip              { reason }: a request for a Manager/Admin
//     POST /api/systems/:id/lifecycle/defer             { reason }: defer open work items (Dev Work), for approval
//     POST /api/systems/:id/lifecycle/requests/:rid     { decision: approve|reject, note? }
//     POST /api/systems/:id/lifecycle/signoffs          request sign-off: { documentId? } (the version to sign)
//     POST /api/systems/:id/lifecycle/signoffs/:sid     the signatory decides: { decision: approve|decline, comment }
//     POST /api/systems/:id/lifecycle/remind            remind pending signatories
//     PUT  /api/systems/:id/lifecycle/checklist/:key    { done, note? }
//     POST /api/systems/:id/lifecycle/deliverables      mark a project document as a deliverable: { documentId, key, linkedTo? }
//     POST|PATCH|DELETE …/risks[/:rid], …/findings[/:fid], …/tests[/:cid], …/tests/:cid/runs, …/environments[/:eid]
//     PUT  /api/systems/:id/lifecycle/records/:kind     deployment plan, closure report… ({ … })
//     GET  /api/lifecycle/pipeline                      every project with a lifecycle, by stage
//     GET  /api/lifecycle/signoffs/mine                 sign-offs waiting for me
//     GET  /api/lifecycle/report                        the lifecycle section of Reports → Projects
// Another organisation's or workspace's project, template or sign-off is a 404, like everything else.
/** @import { System } from '../../project-management-system-frontend/src/data/systems' */
/** @import { Alert } from './notify' */
import { HttpError, body, json } from "./http";
import { newToken } from "./auth";
import { loadCalendar } from "./sla";
import { raise } from "./notify";
import { workingMinutes } from "../../project-management-system-frontend/src/data/workCalendar";
import { createItem } from "./workitems";
import { raiseChangeRequest } from "./servicedesk";
import {
  ACTOR_LABEL,
  STATUS_FOR_STAGE,
  cleanTemplate,
  evaluateGate,
  gateMet,
  isActor,
  lifecycleProgress,
  nextStage,
  resolveSigners,
  riskRating,
  stageIndex,
  stageOf,
  stageSla,
  testSummary,
  transitionProblem,
} from "../../project-management-system-frontend/src/data/lifecycle";
import { STANDARD_LIFECYCLE, STANDARD_NAME } from "../../project-management-system-frontend/src/data/lifecycleTemplates";
import { pcnMissing } from "../../project-management-system-frontend/src/data/pcn";

/** @typedef {import("../../project-management-system-frontend/src/data/lifecycle").TemplateDefinition} TemplateDefinition */
/** @typedef {import("../../project-management-system-frontend/src/data/lifecycle").Stage} Stage */
/** @typedef {import("../../project-management-system-frontend/src/data/lifecycle").GateFacts} GateFacts */
/** @typedef {import("./workitems").ItemContext} ItemContext */
/**
 * @typedef {Object} TemplateRow
 * @property {string} id
 * @property {string | null} workspace_id
 * @property {string} family_id
 * @property {number} version
 * @property {"draft" | "published" | "archived"} status
 * @property {number} is_default
 * @property {string} name
 * @property {string} definition
 * @property {string} created_at
 * @property {string | null} published_at
 */
/**
 * @typedef {Object} LifeRow
 * @property {string} system_id
 * @property {string} template_id
 * @property {string} stage_code
 * @property {string} stage_entered_at
 * @property {"active" | "closed"} state
 * @property {string | null} sla_warned_at
 * @property {string | null} sla_breached_at
 * @property {number} migrated
 */

const id16 = () => newToken().slice(0, 16);
const DAY = 86_400_000;

// ---------- templates ----------
/** The organisation's handle (no workspace): the only one that may change templates. @param {ItemContext} c */
function orgHandle(c) {
  const env = /** @type {Env} */ (c.env);
  return env.ROOT.withScope({ orgId: /** @type {Scope} */ (c.scope).orgId, workspaceId: "" });
}
/** @param {TemplateRow} r */
function templateView(r) {
  return { id: r.id, familyId: r.family_id, version: Number(r.version), status: r.status, isDefault: !!Number(r.is_default), name: r.name, workspaceId: r.workspace_id, definition: cleanTemplate(r.definition), createdAt: r.created_at, publishedAt: r.published_at };
}
/** @param {D1Database} db @param {string} id */
async function templateRow(db, id) {
  const r = /** @type {TemplateRow | null} */ (await db.prepare("SELECT * FROM lifecycle_templates WHERE id = ?").bind(id).first());
  if (!r) throw new HttpError(404, "Not found");
  return r;
}
/**
 * The template a new project in this workspace gets: the workspace's own default, else the organisation's.
 * @param {D1Database} db
 * @param {string} workspaceId
 */
export async function defaultTemplate(db, workspaceId) {
  return /** @type {TemplateRow | null} */ (
    await db
      .prepare("SELECT * FROM lifecycle_templates WHERE status = 'published' AND is_default = 1 AND (workspace_id = ? OR workspace_id IS NULL) ORDER BY workspace_id IS NULL, published_at DESC LIMIT 1")
      .bind(workspaceId)
      .first()
  );
}
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 */
async function templatesApi(c, path, method) {
  if (path === "/api/lifecycle/templates" && method === "GET") {
    const rows = /** @type {TemplateRow[]} */ ((await c.db.prepare("SELECT * FROM lifecycle_templates WHERE status <> 'archived' OR ? ORDER BY name, version DESC").bind(!!c.orgAdmin).all()).results);
    const visible = rows.filter((r) => r.status === "published" || c.orgAdmin);
    const counts = /** @type {{ template_id: string; n: number }[]} */ ((await c.db.prepare("SELECT template_id, COUNT(*) AS n FROM project_lifecycle GROUP BY template_id").all()).results);
    return json({ templates: visible.map((r) => ({ ...templateView(r), projects: Number(counts.find((x) => x.template_id === r.id)?.n ?? 0) })) });
  }
  if (!path.startsWith("/api/lifecycle/templates")) return null;
  if (!c.orgAdmin) throw new HttpError(403, "Only your organisation's administrators can change lifecycles", "org_admin_only");
  const odb = orgHandle(c);
  if (path === "/api/lifecycle/templates" && method === "POST") {
    const b = /** @type {{ name?: unknown; definition?: unknown; from?: unknown; workspaceId?: unknown }} */ (await body(c.req));
    const name = String(b.name ?? STANDARD_NAME).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "Give the lifecycle a name");
    const definition = valid(b.definition ?? STANDARD_LIFECYCLE);
    const workspaceId = b.workspaceId ? String(b.workspaceId) : null;
    const id = id16();
    await odb
      .prepare("INSERT INTO lifecycle_templates (id, workspace_id, family_id, version, status, name, definition, created_at, created_by) VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?)")
      .bind(id, workspaceId, id, name, JSON.stringify(definition), c.now, c.me.id)
      .run();
    await c.audit("lifecycle_template_created", null, { template: name });
    return json({ template: templateView(await templateRow(odb, id)) }, 201);
  }
  const m = path.match(/^\/api\/lifecycle\/templates\/([a-f0-9]{16})(\/publish|\/draft|\/default)?$/);
  if (!m) return null;
  const r = await templateRow(odb, m[1]);
  if (!m[2] && method === "PUT") {
    if (r.status !== "draft") throw new HttpError(409, "Only a draft can be changed: start a new draft from this version");
    const b = /** @type {{ name?: unknown; definition?: unknown }} */ (await body(c.req));
    const name = b.name === undefined ? r.name : String(b.name).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "Give the lifecycle a name");
    const definition = b.definition === undefined ? cleanTemplate(r.definition) : valid(b.definition);
    await odb.prepare("UPDATE lifecycle_templates SET name = ?, definition = ? WHERE id = ?").bind(name, JSON.stringify(definition), r.id).run();
    return json({ template: templateView(await templateRow(odb, r.id)) });
  }
  if (m[2] === "/draft" && method === "POST") {
    if (r.status === "draft") return json({ template: templateView(r) });
    const open = /** @type {TemplateRow | null} */ (await odb.prepare("SELECT * FROM lifecycle_templates WHERE family_id = ? AND status = 'draft'").bind(r.family_id).first());
    if (open) return json({ template: templateView(open) });
    const v = /** @type {{ v: number }} */ (await odb.prepare("SELECT MAX(version) AS v FROM lifecycle_templates WHERE family_id = ?").bind(r.family_id).first());
    const id = id16();
    await odb
      .prepare("INSERT INTO lifecycle_templates (id, workspace_id, family_id, version, status, name, definition, created_at, created_by) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)")
      .bind(id, r.workspace_id, r.family_id, Number(v.v) + 1, r.name, r.definition, c.now, c.me.id)
      .run();
    return json({ template: templateView(await templateRow(odb, id)) }, 201);
  }
  if (m[2] === "/publish" && method === "POST") {
    if (r.status !== "draft") throw new HttpError(409, "That version is already published");
    const b = /** @type {{ default?: unknown }} */ (await body(c.req).catch(() => ({})));
    const def = cleanTemplate(r.definition);
    const was = /** @type {TemplateRow | null} */ (await odb.prepare("SELECT * FROM lifecycle_templates WHERE family_id = ? AND status = 'published'").bind(r.family_id).first());
    const makeDefault = b.default === true || !!was?.is_default;
    await odb.batch([
      ...(was ? [odb.prepare("UPDATE lifecycle_templates SET status = 'archived', is_default = 0 WHERE id = ?").bind(was.id)] : []),
      ...(makeDefault ? [odb.prepare("UPDATE lifecycle_templates SET is_default = 0 WHERE status = 'published' AND workspace_id IS NOT DISTINCT FROM ?").bind(r.workspace_id)] : []),
      odb.prepare("UPDATE lifecycle_templates SET status = 'published', is_default = ?, published_at = ?, published_by = ? WHERE id = ?").bind(makeDefault ? 1 : 0, c.now, c.me.id, r.id),
      ...stageRows(odb, r.id, def),
    ]);
    await c.audit("lifecycle_template_published", null, { template: r.name, version: Number(r.version), default: makeDefault });
    return json({ template: templateView(await templateRow(odb, r.id)) });
  }
  if (m[2] === "/default" && method === "POST") {
    if (r.status !== "published") throw new HttpError(409, "Publish it first");
    await odb.batch([
      odb.prepare("UPDATE lifecycle_templates SET is_default = 0 WHERE status = 'published' AND workspace_id IS NOT DISTINCT FROM ?").bind(r.workspace_id),
      odb.prepare("UPDATE lifecycle_templates SET is_default = 1 WHERE id = ?").bind(r.id),
    ]);
    await c.audit("lifecycle_template_default", null, { template: r.name, version: Number(r.version) });
    return json({ template: templateView(await templateRow(odb, r.id)) });
  }
  throw new HttpError(405, "Method not allowed");
}
/** @param {unknown} v */
function valid(v) {
  try {
    return cleanTemplate(v);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "The lifecycle isn't valid");
  }
}
/** The stages of a published version, as rows (reports join on them). @param {D1Database} db @param {string} templateId @param {TemplateDefinition} def */
export function stageRows(db, templateId, def) {
  return def.stages.map((s, i) => {
    const phase = def.phases.find((p) => p.code === s.phase);
    return db
      .prepare("INSERT INTO lifecycle_stages (template_id, code, name, phase_code, phase_name, position, type, target_days, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(templateId, s.code, s.name, s.phase, phase?.name ?? s.phase, i + 1, s.type, s.targetDays, s.weight);
  });
}

// ---------- a project's lifecycle ----------
/**
 * @param {ItemContext} c
 * @param {string} systemId
 */
async function project(c, systemId) {
  const row = /** @type {{ data: string; workspace_id: string; progress_from_items: number } | null} */ (await c.db.prepare("SELECT data, workspace_id, progress_from_items FROM systems WHERE id = ?").bind(systemId).first());
  if (!row) throw new HttpError(404, "Not found");
  return /** @type {System & { workspace_id: string; fromItems: boolean }} */ ({ ...JSON.parse(row.data), workspace_id: row.workspace_id, fromItems: !!row.progress_from_items });
}
/** @param {D1Database} db @param {string} systemId */
async function lifeOf(db, systemId) {
  return /** @type {LifeRow | null} */ (await db.prepare("SELECT * FROM project_lifecycle WHERE system_id = ?").bind(systemId).first());
}
/** @param {ItemContext} c @param {LifeRow} life */
async function defOf(c, life) {
  const t = /** @type {TemplateRow | null} */ (await c.db.prepare("SELECT * FROM lifecycle_templates WHERE id = ?").bind(life.template_id).first());
  if (!t) throw new HttpError(404, "Not found");
  return { template: t, def: cleanTemplate(t.definition) };
}
/**
 * The person acting, for the rules (their role here, whether they lead the project or own the stage).
 * @param {ItemContext} c @param {System} sys @param {Stage | null} stage
 */
const mover = (c, sys, stage) => ({ id: c.me.id, role: c.me.role, isLead: sys.lead === c.me.id, isOwner: !!stage?.ownerId && stage.ownerId === c.me.id });
/** Active members of the workspace, by role. @param {D1Database} db */
async function membersByRole(db) {
  const rows = /** @type {{ id: string; name: string; role: string }[]} */ (
    (await db.prepare("SELECT a.id, a.name, m.role FROM workspace_members m JOIN accounts a ON a.id = m.user_id WHERE a.deactivated_at IS NULL ORDER BY a.name").all()).results
  );
  /** @type {Record<string, { id: string; name: string }[]>} */ const by = {};
  for (const r of rows) (by[r.role] ??= []).push({ id: r.id, name: r.name });
  return { by, all: rows };
}
/** The people a stage's actors (roles, the lead, its owner) stand for. @param {ItemContext} c @param {System} sys @param {Stage} stage @param {import("../../project-management-system-frontend/src/data/lifecycle").Actor[]} actors */
async function peopleFor(c, sys, stage, actors) {
  const { by } = await membersByRole(c.db);
  const ids = new Set();
  for (const a of actors) {
    if (a === "lead" && sys.lead) ids.add(sys.lead);
    else if (a === "stageOwner" && stage.ownerId) ids.add(stage.ownerId);
    else for (const p of by[a] ?? []) ids.add(p.id);
  }
  return /** @type {string[]} */ ([...ids]);
}

/**
 * Everything the gate of the project's current stage needs.
 * @param {ItemContext} c
 * @param {System} sys
 * @param {LifeRow} life
 * @param {Stage} stage
 * @returns {Promise<GateFacts>}
 */
async function gatherFacts(c, sys, life, stage) {
  const db = c.db;
  const id = sys.id;
  const [checklist, docs, records, risks, findings, items, envs, cases, runs, requests] = await Promise.all([
    db.prepare("SELECT key FROM stage_checklist_items WHERE system_id = ? AND stage_code = ?").bind(id, stage.code).all(),
    db.prepare("SELECT id, deliverable_key, version, locked_at FROM documents WHERE system_id = ? AND deliverable_key IS NOT NULL ORDER BY version").bind(id).all(),
    db.prepare("SELECT kind, data FROM stage_records WHERE system_id = ?").bind(id).all(),
    db.prepare("SELECT likelihood, impact, owner_id, mitigation, status FROM risk_register WHERE system_id = ?").bind(id).all(),
    db.prepare("SELECT severity, status, accepted_until FROM security_findings WHERE system_id = ?").bind(id).all(),
    db.prepare("SELECT w.type, w.priority, w.source, s.category FROM work_items w JOIN work_statuses s ON s.id = w.status WHERE w.system_id = ?").bind(id).all(),
    db.prepare("SELECT name, verified_at FROM project_environments WHERE system_id = ?").bind(id).all(),
    db.prepare("SELECT id, suite FROM test_cases WHERE system_id = ?").bind(id).all(),
    db.prepare("SELECT case_id, result, run_at FROM test_runs WHERE system_id = ?").bind(id).all(),
    db.prepare("SELECT kind, status, requested_at FROM stage_requests WHERE system_id = ? AND stage_code = ? AND status = 'approved' AND requested_at >= ?").bind(id, stage.code, life.stage_entered_at).all(),
  ]);
  const rec = Object.fromEntries(/** @type {{ kind: string; data: string }[]} */ (records.results).map((r) => [r.kind, JSON.parse(r.data)]));
  const links = /** @type {Record<string, string>} */ (rec.links ?? {});
  /** @type {Map<string, { key: string; version: number; locked: boolean; linkedTo: string | null }>} */ const latest = new Map();
  for (const d of /** @type {{ deliverable_key: string; version: number; locked_at: string | null }[]} */ (docs.results)) {
    latest.set(d.deliverable_key, { key: d.deliverable_key, version: Number(d.version ?? 1), locked: !!d.locked_at, linkedTo: links[d.deliverable_key] ?? null });
  }
  const inScope = /** @type {{ type: string; priority: string; source: string; category: string }[]} */ (items.results).filter((w) => w.source === "internal");
  const open = inScope.filter((w) => w.category !== "DONE").length;
  const deferralApproved = /** @type {{ kind: string }[]} */ (requests.results).some((r) => r.kind === "defer_items");
  /** @type {Record<string, number>} */ const openBugs = {};
  const level = { HIGHEST: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", LOWEST: "Low" };
  for (const w of /** @type {{ type: string; priority: keyof typeof level; category: string }[]} */ (items.results)) {
    if (w.type === "BUG" && w.category !== "DONE") openBugs[level[w.priority]] = (openBugs[level[w.priority]] ?? 0) + 1;
  }
  let change = { exists: false, approved: false };
  if (rec.change?.itemId) {
    const ch = /** @type {{ category: string } | null} */ (await db.prepare("SELECT s.category FROM work_items w JOIN work_statuses s ON s.id = w.status WHERE w.id = ?").bind(rec.change.itemId).first());
    change = { exists: !!ch, approved: ch?.category === "DONE" };
  }
  return {
    checklist: new Set(/** @type {{ key: string }[]} */ (checklist.results).map((r) => r.key)),
    deliverables: [...latest.values()],
    signoffs: await signoffState(c, sys, stage),
    pcn: { exists: !!sys.pcn, missing: sys.pcn ? pcnMissing(sys.pcn) : [] },
    risks: /** @type {{ likelihood: number; impact: number; owner_id: string | null; mitigation: string; status: string }[]} */ (risks.results).map((r) => ({ rating: riskRating(Number(r.likelihood), Number(r.impact)), ownerId: r.owner_id, mitigation: r.mitigation, status: r.status })),
    risksReviewed: false,
    findings: /** @type {{ severity: string; status: string; accepted_until: string | null }[]} */ (findings.results).map((f) => ({ severity: f.severity, status: f.status, acceptedUntil: f.accepted_until })),
    items: { total: inScope.length, open, deferred: deferralApproved ? open : 0 },
    deferralApproved,
    environments: /** @type {{ name: string; verified_at: string | null }[]} */ (envs.results).map((e) => ({ name: e.name, verified: !!e.verified_at })),
    tests: testSummary(
      /** @type {{ id: string; suite: string }[]} */ (cases.results),
      /** @type {{ case_id: string; result: "pass" | "fail" | "blocked" | "waived"; run_at: string }[]} */ (runs.results).map((r) => ({ caseId: r.case_id, result: r.result, at: r.run_at })),
    ),
    openBugs,
    change,
    deployment: rec.deployment ?? null,
    today: c.now.slice(0, 10),
  };
}
/**
 * The current round of a stage's sign-offs: from the Concept Note for PCN Sign Off, else stage_signoffs.
 * @param {ItemContext} c @param {System} sys @param {Stage} stage
 */
async function signoffState(c, sys, stage) {
  if (!stage.signoff) return null;
  if (stage.signoff.source === "pcn_signatories") {
    const s = sys.pcn?.signatories ?? [];
    return { required: s.length, approved: s.filter((x) => x.status === "APPROVED").length, declined: s.filter((x) => x.status === "DECLINED").length, pending: s.filter((x) => x.status === "PENDING").map((x) => x.name) };
  }
  const rows = await currentRound(c.db, sys.id, stage.code);
  if (!rows.length) return { required: 0, approved: 0, declined: 0, pending: [] };
  return { required: rows.length, approved: rows.filter((r) => r.status === "approved").length, declined: rows.filter((r) => r.status === "declined").length, pending: rows.filter((r) => r.status === "pending").map((r) => r.signer_name) };
}
/**
 * @typedef {Object} SignoffRow
 * @property {string} id
 * @property {string} system_id
 * @property {string} stage_code
 * @property {number} round
 * @property {string} signer_id
 * @property {string} signer_name
 * @property {string} label
 * @property {"pending" | "approved" | "declined" | "cancelled"} status
 * @property {string} comment
 * @property {string | null} submitted_by
 * @property {string | null} document_id
 * @property {number | null} document_version
 * @property {string} requested_at
 * @property {string | null} reminded_at
 * @property {string | null} decided_at
 */
/** @param {D1Database} db @param {string} systemId @param {string} stage @returns {Promise<SignoffRow[]>} */
async function currentRound(db, systemId, stage) {
  return /** @type {SignoffRow[]} */ (
    (
      await db
        .prepare("SELECT * FROM stage_signoffs WHERE system_id = ? AND stage_code = ? AND status <> 'cancelled' AND round = (SELECT MAX(round) FROM stage_signoffs WHERE system_id = ? AND stage_code = ?) ORDER BY requested_at, signer_name")
        .bind(systemId, stage, systemId, stage)
        .all()
    ).results
  );
}

/**
 * Moves a project to another stage (or closes it): the lifecycle row, the history, the project's status and
 * progress, the activity log, the people responsible, the stage's on-enter automation, and automation rules.
 * @param {ItemContext} c
 * @param {System} sys
 * @param {LifeRow} life
 * @param {TemplateDefinition} def
 * @param {{ to: string; kind: "advance" | "send_back" | "skip" | "decline" | "close"; reason?: string; evidence?: Record<string, unknown> }} m
 */
async function move(c, sys, life, def, m) {
  const from = stageOf(def, life.stage_code);
  const to = stageOf(def, m.to);
  if (!to) throw new HttpError(400, "Unknown stage");
  const closing = m.kind === "close";
  const db = c.db;
  const stmts = [
    db.prepare("UPDATE project_lifecycle SET stage_code = ?, stage_entered_at = ?, state = ?, sla_warned_at = NULL, sla_breached_at = NULL WHERE system_id = ?").bind(to.code, c.now, closing ? "closed" : "active", sys.id),
    db
      .prepare("INSERT INTO project_stage_history (system_id, from_code, to_code, kind, reason, evidence, by_id, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(sys.id, life.stage_code, to.code, m.kind, m.reason?.slice(0, 1000) ?? null, JSON.stringify(m.evidence ?? {}), c.me.id, c.me.name, c.now),
    // Pending sign-offs of the stage being left are over.
    db.prepare("UPDATE stage_signoffs SET status = 'cancelled' WHERE system_id = ? AND stage_code = ? AND status = 'pending'").bind(sys.id, life.stage_code),
  ];
  // The project's own status follows the lifecycle; closing sets the template's (Live), with the delivery date.
  const status = closing ? def.settings.onClose.status : STATUS_FOR_STAGE[to.type];
  const progress = /** @type {any} */ (sys).fromItems ? sys.progress : lifecycleProgress(def, to.code, closing, null);
  /** @type {System} */ const next = { ...sys, status: /** @type {System["status"]} */ (status), progress, ...(closing && !sys.finishedAt ? { finishedAt: c.now.slice(0, 10) } : {}), updatedAt: c.now };
  const { workspace_id: _w, fromItems: _f, ...stored } = /** @type {any} */ (next);
  stmts.push(db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(stored), sys.id));
  if (closing) stmts.push(db.prepare("UPDATE documents SET locked_at = ?, locked_by = ? WHERE system_id = ? AND deliverable_key IS NOT NULL AND locked_at IS NULL").bind(c.now, c.me.id, sys.id));
  await db.batch(stmts);
  await c.audit("stage_changed", sys.id, { name: sys.name, from: from?.name ?? life.stage_code, to: to.name, kind: m.kind, ...(m.reason ? { reason: m.reason } : {}) });
  if (closing) {
    await notifyStage(c, sys, to, `${sys.name} is closed`, `${c.me.name} closed the project. It is now ${status === "LIVE" ? "Live" : "Completed"}.`);
    return;
  }
  const verb = m.kind === "send_back" || m.kind === "decline" ? "was sent back to" : m.kind === "skip" ? "skipped ahead to" : "moved to";
  await notifyStage(c, sys, to, `${sys.name} ${verb} ${to.name}`, `${m.reason ? `${m.reason}. ` : ""}${to.targetDays ? `Target: ${to.targetDays} business days.` : ""}`.trim());
  await onEnter(c, { ...sys, ...next }, def, to);
  c.emit?.(/** @type {any} */ ({ type: "stage_changed", systemId: sys.id, from: life.stage_code, to: to.code }));
}
/** Tells the people responsible for a stage. @param {ItemContext} c @param {System} sys @param {Stage} stage @param {string} title @param {string} text */
async function notifyStage(c, sys, stage, title, text) {
  const ids = await peopleFor(c, sys, stage, stage.responsible.length ? stage.responsible : ["lead"]);
  if (!ids.length) return;
  c.alert(ids.map((userId) => ({ userId, kind: /** @type {const} */ ("stage"), title: title.slice(0, 200), body: text.slice(0, 500), link: `#/projects/${sys.id}/lifecycle` })));
}
/** A stage's on-enter automation. @param {ItemContext} c @param {System} sys @param {TemplateDefinition} def @param {Stage} stage */
async function onEnter(c, sys, def, stage) {
  const hooks = new Set(stage.automation.onEnter);
  if (stage.signoff && (hooks.has("request:signoffs") || stage.type === "approval") && stage.signoff.source !== "pcn_signatories") {
    await requestSignoffs(c, sys, def, stage, null).catch((e) => console.error("Couldn't request sign-offs", e));
  }
  if (stage.signoff?.source === "pcn_signatories" && sys.pcn) {
    const ids = sys.pcn.signatories.filter((s) => s.userId && s.status === "PENDING").map((s) => /** @type {string} */ (s.userId));
    if (ids.length) c.alert(ids.map((userId) => ({ userId, kind: /** @type {const} */ ("signoff"), title: `Your sign-off is needed: ${sys.name} Concept Note`, body: "PCN Sign Off. Open the Concept Note to approve or decline.", link: `#/projects/${sys.id}/lifecycle` })));
  }
  if (stage.checklistAsWorkItems || hooks.has("create:checklist_items")) {
    for (const cr of stage.exit.filter((x) => x.kind === "checklist")) {
      const row = await createItem(c, { systemId: sys.id, type: "TASK", summary: `${stage.name}: ${cr.label}`.slice(0, 250), description: `Checklist item for the ${stage.name} stage.`, priority: "MEDIUM" }, "internal").catch(() => null);
      if (row) await c.db.prepare("UPDATE work_items SET lifecycle_stage = ? WHERE id = ?").bind(stage.code, row.id).run();
    }
  }
  if (stage.deployment?.createChangeRequest || hooks.has("create:change_request")) {
    const have = /** @type {{ data: string } | null} */ (await c.db.prepare("SELECT data FROM stage_records WHERE system_id = ? AND kind = 'change'").bind(sys.id).first());
    if (!have) {
      try {
        const row = await raiseChangeRequest(c, { summary: `Deploy ${sys.name}`, description: `Change request for the deployment of ${sys.name} (project lifecycle, ${stage.name}).` });
        await saveRecord(c, sys.id, "change", { itemId: row.id, key: row.key });
      } catch (e) {
        await saveRecord(c, sys.id, "change", { error: e instanceof Error ? e.message : "Couldn't raise the change request" });
      }
    }
  }
}
/** @param {ItemContext} c @param {string} systemId @param {string} kind @param {Record<string, unknown>} data */
async function saveRecord(c, systemId, kind, data) {
  await c.db
    .prepare("INSERT INTO stage_records (system_id, kind, data, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (system_id, kind) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(systemId, kind, JSON.stringify(data), c.me.id, c.now)
    .run();
}
/**
 * Asks a stage's signatories to sign (a new round). The deliverable to sign is the given document or the latest
 * version of the stage's lockable deliverable; whoever asks is the submitter (segregation of duties).
 * @param {ItemContext} c @param {System} sys @param {TemplateDefinition} def @param {Stage} stage @param {string | null} documentId
 */
async function requestSignoffs(c, sys, def, stage, documentId) {
  if (!stage.signoff) throw new HttpError(409, `${stage.name} has no sign-offs`);
  if (stage.signoff.source === "pcn_signatories") throw new HttpError(409, "The Concept Note's signatories sign on the Concept Note");
  const lockKey = stage.signoff.lockDeliverables?.[0];
  /** @type {{ id: string; version: number; uploaded_by: string } | null} */ let doc = null;
  if (documentId) doc = /** @type {any} */ (await c.db.prepare("SELECT id, version, uploaded_by FROM documents WHERE id = ? AND system_id = ?").bind(documentId, sys.id).first());
  else if (lockKey) doc = /** @type {any} */ (await c.db.prepare("SELECT id, version, uploaded_by FROM documents WHERE system_id = ? AND deliverable_key = ? ORDER BY version DESC LIMIT 1").bind(sys.id, lockKey).first());
  if (lockKey && !doc) throw new HttpError(409, `Attach the ${lockKey.toUpperCase()} before asking for sign-off`);
  // The submitter: whoever uploaded the version to be signed (else whoever asks).
  const submittedBy = doc?.uploaded_by ?? c.me.id;
  const { by, all } = await membersByRole(c.db);
  const signers = resolveSigners(stage, def.settings, { submittedBy, pcnSigners: [], byRole: by, active: new Set(all.map((p) => p.id)) });
  if (!signers.length) throw new HttpError(409, `Nobody can sign ${stage.name}: check its signatories in Settings → Project Lifecycle`);
  const r = /** @type {{ n: number | null }} */ (await c.db.prepare("SELECT MAX(round) AS n FROM stage_signoffs WHERE system_id = ? AND stage_code = ?").bind(sys.id, stage.code).first());
  const round = Number(r?.n ?? 0) + 1;
  await c.db.batch([
    c.db.prepare("UPDATE stage_signoffs SET status = 'cancelled' WHERE system_id = ? AND stage_code = ? AND status = 'pending'").bind(sys.id, stage.code),
    ...signers.map((s) =>
      c.db
        .prepare("INSERT INTO stage_signoffs (id, system_id, stage_code, round, signer_id, signer_name, label, submitted_by, document_id, document_version, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id16(), sys.id, stage.code, round, s.signerId, s.signerName, s.label, submittedBy, doc?.id ?? null, doc?.version ?? null, c.now),
    ),
  ]);
  await c.audit("signoff_requested", sys.id, { name: sys.name, stage: stage.name, round, signers: signers.map((s) => s.signerName) });
  c.alert(signers.map((s) => ({ userId: s.signerId, kind: /** @type {const} */ ("signoff"), title: `Your sign-off is needed: ${sys.name} · ${stage.name}`.slice(0, 200), body: `${s.label}. Requested by ${c.me.name}${doc ? ` (version ${doc.version})` : ""}.`, link: `#/projects/${sys.id}/lifecycle` })));
}

/**
 * After a sign-off decision (stage_signoffs or the Concept Note's): a decline sends the project back; all approved
 * locks the signed version and moves it on.
 * @param {ItemContext} c @param {string} systemId
 */
export async function afterSignoff(c, systemId) {
  const life = await lifeOf(c.db, systemId);
  if (!life || life.state !== "active") return;
  const sys = await project(c, systemId);
  const { def } = await defOf(c, life);
  const stage = stageOf(def, life.stage_code);
  if (!stage?.signoff) return;
  const s = await signoffState(c, sys, stage);
  if (!s || !s.required) return;
  if (s.declined) {
    const comment = stage.signoff.source === "pcn_signatories" ? sys.pcn?.signatories.find((x) => x.status === "DECLINED")?.remarks : (await currentRound(c.db, sys.id, stage.code)).find((r) => r.status === "declined")?.comment;
    if (stage.signoff.onDecline !== stage.code) await move(c, sys, life, def, { to: stage.signoff.onDecline, kind: "decline", reason: comment ? `Declined: ${comment}` : "Declined at sign-off" });
    return;
  }
  if (s.approved < s.required) return;
  // Everything the gate asks for (a sign-off stage may have more than its signatures).
  const facts = await gatherFacts(c, sys, life, stage);
  const gate = evaluateGate(stage, facts);
  if (!gateMet(gate)) return;
  await lockSigned(c, sys, stage);
  const nxt = nextStage(def, stage.code);
  if (stage.type === "closure" || !nxt) await move(c, sys, life, def, { to: stage.code, kind: "close", evidence: { gate } });
  else await move(c, sys, life, def, { to: nxt.code, kind: "advance", reason: "All signatories approved", evidence: { gate, signoffs: s } });
}
/** Locks the signed versions of a stage's deliverables. @param {ItemContext} c @param {System} sys @param {Stage} stage */
async function lockSigned(c, sys, stage) {
  for (const key of stage.signoff?.lockDeliverables ?? []) {
    const signed = (await currentRound(c.db, sys.id, stage.code)).find((r) => r.document_id)?.document_id;
    if (signed) await c.db.prepare("UPDATE documents SET locked_at = ?, locked_by = ? WHERE id = ? AND locked_at IS NULL").bind(c.now, c.me.id, signed).run();
    else await c.db.prepare("UPDATE documents SET locked_at = ?, locked_by = ? WHERE id = (SELECT id FROM documents WHERE system_id = ? AND deliverable_key = ? ORDER BY version DESC LIMIT 1) AND locked_at IS NULL").bind(c.now, c.me.id, sys.id, key).run();
  }
}

/**
 * Starts a project on a lifecycle (a new project gets the default; an existing one, by a manager).
 * @param {ItemContext} c @param {string} systemId @param {string | null} templateId @param {string} [atCode] @param {string} [reason]
 */
export async function startLifecycle(c, systemId, templateId, atCode, reason) {
  const sys = await project(c, systemId);
  if (await lifeOf(c.db, systemId)) throw new HttpError(409, "This project already has a lifecycle");
  const t = templateId ? /** @type {TemplateRow | null} */ (await c.db.prepare("SELECT * FROM lifecycle_templates WHERE id = ? AND status = 'published'").bind(templateId).first()) : await defaultTemplate(c.db, sys.workspace_id);
  if (!t) {
    if (templateId) throw new HttpError(404, "Not found");
    return null;
  }
  const def = cleanTemplate(t.definition);
  const first = atCode ? stageOf(def, atCode) : def.stages[0];
  if (!first) throw new HttpError(400, "Unknown stage");
  await c.db.batch([
    c.db.prepare("INSERT INTO project_lifecycle (system_id, template_id, stage_code, stage_entered_at) VALUES (?, ?, ?, ?)").bind(sys.id, t.id, first.code, c.now),
    c.db.prepare("INSERT INTO project_stage_history (system_id, from_code, to_code, kind, reason, by_id, by_name, at) VALUES (?, NULL, ?, 'start', ?, ?, ?, ?)").bind(sys.id, first.code, reason ?? `Started on ${t.name} v${t.version}`, c.me.id, c.me.name, c.now),
  ]);
  await c.audit("lifecycle_started", sys.id, { name: sys.name, template: t.name, version: Number(t.version), stage: first.name });
  await onEnter(c, sys, def, first);
  return first.code;
}

// ---------- the view ----------
/** @param {ItemContext} c @param {string} systemId */
async function lifecycleView(c, systemId) {
  const sys = await project(c, systemId);
  const life = await lifeOf(c.db, systemId);
  if (!life) {
    const t = await defaultTemplate(c.db, sys.workspace_id);
    return { lifecycle: null, defaultTemplate: t ? { id: t.id, name: t.name, version: Number(t.version) } : null, canStart: c.can("manage_systems") };
  }
  const { template, def } = await defOf(c, life);
  const stage = /** @type {Stage} */ (stageOf(def, life.stage_code));
  const [facts, cal, history, risks, findings, cases, runs, envs, docs, records, requests, checklist, signoffs] = await Promise.all([
    gatherFacts(c, sys, life, stage),
    loadCalendar(c.db),
    c.db.prepare("SELECT id, from_code, to_code, kind, reason, by_name, at FROM project_stage_history WHERE system_id = ? ORDER BY id DESC LIMIT 200").bind(sys.id).all(),
    c.db.prepare("SELECT r.*, a.name AS owner_name FROM risk_register r LEFT JOIN accounts a ON a.id = r.owner_id WHERE r.system_id = ? ORDER BY r.created_at").bind(sys.id).all(),
    c.db.prepare("SELECT f.*, a.name AS accepted_name FROM security_findings f LEFT JOIN accounts a ON a.id = f.accepted_by WHERE f.system_id = ? ORDER BY f.created_at").bind(sys.id).all(),
    c.db.prepare("SELECT t.*, a.name AS assignee_name FROM test_cases t LEFT JOIN accounts a ON a.id = t.assignee_id WHERE t.system_id = ? ORDER BY t.suite, t.position, t.created_at").bind(sys.id).all(),
    c.db.prepare("SELECT r.*, a.name AS run_name, s.key || '-' || w.number AS bug_key FROM test_runs r LEFT JOIN accounts a ON a.id = r.run_by LEFT JOIN work_items w ON w.id = r.bug_item_id LEFT JOIN systems s ON s.id = w.system_id WHERE r.system_id = ? ORDER BY r.run_at").bind(sys.id).all(),
    c.db.prepare("SELECT e.*, a.name AS verified_name FROM project_environments e LEFT JOIN accounts a ON a.id = e.verified_by WHERE e.system_id = ? ORDER BY e.name").bind(sys.id).all(),
    c.db.prepare("SELECT d.id, d.name, d.kind, d.url, d.mime, d.size, d.stage_code, d.deliverable_key, d.version, d.locked_at, d.uploaded_at, a.name AS uploaded_name FROM documents d LEFT JOIN accounts a ON a.id = d.uploaded_by WHERE d.system_id = ? AND d.work_item_id IS NULL ORDER BY d.uploaded_at").bind(sys.id).all(),
    c.db.prepare("SELECT kind, data, updated_at FROM stage_records WHERE system_id = ?").bind(sys.id).all(),
    c.db.prepare("SELECT q.*, a.name AS requested_name FROM stage_requests q LEFT JOIN accounts a ON a.id = q.requested_by WHERE q.system_id = ? ORDER BY q.requested_at DESC LIMIT 50").bind(sys.id).all(),
    c.db.prepare("SELECT c.stage_code, c.key, c.note, c.done_at, a.name AS done_name FROM stage_checklist_items c LEFT JOIN accounts a ON a.id = c.done_by WHERE c.system_id = ?").bind(sys.id).all(),
    c.db.prepare("SELECT * FROM stage_signoffs WHERE system_id = ? AND status <> 'cancelled' ORDER BY stage_code, round, requested_at").bind(sys.id).all(),
  ]);
  const gate = evaluateGate(stage, facts);
  const who = mover(c, sys, stage);
  const nxt = nextStage(def, stage.code);
  /** @type {Record<string, string>} */ const visited = {};
  for (const h of /** @type {{ to_code: string; kind: string }[]} */ (history.results).slice().reverse()) visited[h.to_code] = h.kind;
  const sentBackFrom = new Set(/** @type {{ from_code: string; kind: string }[]} */ (history.results).filter((h) => h.kind === "send_back" || h.kind === "decline").map((h) => h.from_code));
  const runsBy = /** @type {Record<string, any[]>} */ ({});
  for (const r of /** @type {any[]} */ (runs.results)) (runsBy[r.case_id] ??= []).push(r);
  const closed = life.state === "closed";
  return {
    lifecycle: {
      template: { id: template.id, name: template.name, version: Number(template.version), definition: def },
      stage: stage.code,
      enteredAt: life.stage_entered_at,
      state: life.state,
      migrated: !!life.migrated,
      sla: closed ? null : stageSla(life.stage_entered_at, stage.targetDays, Date.parse(c.now), cal),
      gate,
      ready: gateMet(gate),
      next: nxt ? { code: nxt.code, name: nxt.name } : null,
      progress: lifecycleProgress(def, stage.code, closed, facts.items.total ? (facts.items.total - facts.items.open) / facts.items.total : null),
      sentBackFrom: [...sentBackFrom],
      visited,
      can: {
        advance: !closed && !transitionProblem(def, stage.code, "advance", null, who),
        sendBack: !closed && isActor(def.settings.sendBackBy, who) && stage.transitions.sendBackTo.length > 0,
        skip: !closed && stage.transitions.canSkip && isActor(def.settings.advanceBy, who),
        decideRequests: isActor(def.settings.skipApprovedBy, who),
        requestSignoff: !closed && !!stage.signoff && stage.signoff.source !== "pcn_signatories" && isActor(def.settings.advanceBy, who),
        edit: c.can("edit_any") || c.can("manage_systems") || sys.lead === c.me.id,
        acceptRisk: ["manager", "admin"].includes(c.me.role),
      },
      history: history.results,
      checklist: checklist.results,
      signoffs: signoffs.results,
      requests: requests.results,
      documents: docs.results,
      records: Object.fromEntries(/** @type {{ kind: string; data: string; updated_at: string }[]} */ (records.results).map((r) => [r.kind, { ...JSON.parse(r.data), updatedAt: r.updated_at }])),
      risks: /** @type {any[]} */ (risks.results).map((r) => ({ ...r, rating: riskRating(Number(r.likelihood), Number(r.impact)) })),
      findings: findings.results,
      tests: /** @type {any[]} */ (cases.results).map((t) => ({ ...t, runs: runsBy[t.id] ?? [] })),
      testSummary: facts.tests,
      environments: envs.results,
      pcn: sys.pcn ? { signatories: sys.pcn.signatories, missing: facts.pcn.missing } : null,
    },
  };
}

/**
 * What a project's page needs from its lifecycle (src/overview.js): where it is, the clock, the gate, who may move
 * it, its history and the sign-offs waiting. Null when the project has no lifecycle.
 * @param {ItemContext} c @param {string} systemId
 */
export async function lifecycleSnapshot(c, systemId) {
  const life = await lifeOf(c.db, systemId);
  if (!life) return null;
  const sys = await project(c, systemId);
  const { def } = await defOf(c, life);
  const stage = /** @type {Stage} */ (stageOf(def, life.stage_code));
  const closed = life.state === "closed";
  const [facts, cal, history, pending] = await Promise.all([
    gatherFacts(c, sys, life, stage),
    loadCalendar(c.db),
    c.db.prepare("SELECT from_code, to_code, kind, reason, by_name, at FROM project_stage_history WHERE system_id = ? ORDER BY id").bind(systemId).all(),
    closed ? Promise.resolve([]) : currentRound(c.db, systemId, stage.code),
  ]);
  const gate = evaluateGate(stage, facts);
  const who = mover(c, sys, stage);
  return {
    def,
    life,
    stage,
    closed,
    cal,
    sla: closed ? null : stageSla(life.stage_entered_at, stage.targetDays, Date.parse(c.now), cal),
    gate,
    ready: gateMet(gate),
    canAdvance: !closed && !c.guest && !transitionProblem(def, stage.code, "advance", null, who),
    history: /** @type {{ from_code: string | null; to_code: string; kind: string; reason: string | null; by_name: string; at: string }[]} */ (history.results),
    pendingSignoffs: pending.filter((s) => s.status === "pending"),
    pcnPending: stage.signoff?.source === "pcn_signatories" ? (sys.pcn?.signatories ?? []).filter((s) => s.status === "PENDING") : [],
    tests: facts.tests,
    items: facts.items,
  };
}
/**
 * Every active project's current stage with a target, for the health rule (Reports → Projects and the project page
 * use the same figures).
 * @param {ItemContext} c
 * @returns {Promise<Record<string, import("../../project-management-system-frontend/src/data/projectHealth").StageFact>>}
 */
export async function stageFacts(c) {
  const [rows, cal] = await Promise.all([
    c.db.prepare("SELECT l.system_id, l.template_id, l.stage_code, l.stage_entered_at, t.definition FROM project_lifecycle l JOIN lifecycle_templates t ON t.id = l.template_id WHERE l.state = 'active'").all(),
    loadCalendar(c.db),
  ]);
  /** @type {Map<string, TemplateDefinition>} */ const defs = new Map();
  /** @type {Record<string, import("../../project-management-system-frontend/src/data/projectHealth").StageFact>} */ const out = {};
  for (const r of /** @type {{ system_id: string; template_id: string; stage_code: string; stage_entered_at: string; definition: string }[]} */ (rows.results)) {
    if (!defs.has(r.template_id)) defs.set(r.template_id, cleanTemplate(r.definition));
    const st = stageOf(/** @type {TemplateDefinition} */ (defs.get(r.template_id)), r.stage_code);
    const sla = st?.targetDays ? stageSla(r.stage_entered_at, st.targetDays, Date.parse(c.now), cal) : null;
    if (st && sla) out[r.system_id] = { name: st.name, usedDays: sla.usedDays, targetDays: /** @type {number} */ (st.targetDays) };
  }
  return out;
}

// ---------- the routes ----------
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function lifecycleApi(c, path, method) {
  if (path.startsWith("/api/lifecycle/templates")) return templatesApi(c, path, method);
  if (path === "/api/lifecycle/pipeline" && method === "GET") return json(await pipeline(c));
  if (path === "/api/lifecycle/report" && method === "GET") return json(await lifecycleReport(c));
  if (path === "/api/lifecycle/signoffs/mine" && method === "GET") {
    const rows = (await c.db.prepare("SELECT s.id, s.system_id, s.stage_code, s.label, s.requested_at, s.document_version FROM stage_signoffs s WHERE s.signer_id = ? AND s.status = 'pending' ORDER BY s.requested_at").bind(c.me.id).all()).results;
    return json({ signoffs: rows });
  }
  const m = path.match(/^\/api\/systems\/([a-z0-9-]+)\/lifecycle(\/.*)?$/);
  if (!m) return null;
  const systemId = m[1];
  const sub = m[2] ?? "";
  if (sub === "" && method === "GET") return json(await lifecycleView(c, systemId));
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const b = /** @type {Record<string, any>} */ (method === "DELETE" ? {} : await body(c.req).catch(() => ({})));
  if (sub === "/start" && method === "POST") {
    if (!c.can("manage_systems")) throw new HttpError(403, "You don't have permission to do that");
    const started = await startLifecycle(c, systemId, b.templateId ? String(b.templateId) : null, b.stage ? String(b.stage) : undefined, b.reason ? String(b.reason).slice(0, 500) : undefined);
    if (!started) throw new HttpError(409, "There's no default lifecycle yet: an administrator sets one up in Settings → Project Lifecycle");
    return json(await lifecycleView(c, systemId), 201);
  }
  const sys = await project(c, systemId);
  const life = await lifeOf(c.db, systemId);
  if (!life) throw new HttpError(409, "This project has no lifecycle");
  const { def } = await defOf(c, life);
  const stage = /** @type {Stage} */ (stageOf(def, life.stage_code));
  const who = mover(c, sys, stage);
  const closed = life.state === "closed";
  // The same people who may add the project's documents (index.js mayContribute): on it, leading it, or managing.
  const mayEdit = c.can("edit_any") || c.can("manage_systems") || sys.lead === c.me.id || (await isAssigned(c, sys.id));
  const needEdit = () => {
    if (!mayEdit) throw new HttpError(403, "Only people on this project can change that");
  };
  const view = async () => json(await lifecycleView(c, systemId));

  if (sub === "/advance" && method === "POST") {
    if (closed) throw new HttpError(409, "This project is closed");
    const problem = transitionProblem(def, stage.code, "advance", null, who);
    if (problem && !(stage.type === "closure")) throw new HttpError(403, problem);
    const gate = evaluateGate(stage, await gatherFacts(c, sys, life, stage));
    if (!gateMet(gate)) throw new HttpError(409, "The exit criteria aren't met yet", "gate_not_met", { missing: gate.filter((g) => !g.ok).map((g) => g.missing) });
    if (stage.type === "closure" || !nextStage(def, stage.code)) {
      if (!isActor(def.settings.advanceBy, who)) throw new HttpError(403, "Only the project lead, a Manager or an Administrator can close the project");
      await lockSigned(c, sys, stage);
      await move(c, sys, life, def, { to: stage.code, kind: "close", reason: b.comment ? String(b.comment).slice(0, 500) : undefined, evidence: { gate } });
    } else {
      await move(c, sys, life, def, { to: /** @type {Stage} */ (nextStage(def, stage.code)).code, kind: "advance", reason: b.comment ? String(b.comment).slice(0, 500) : undefined, evidence: { gate } });
    }
    return view();
  }
  if (sub === "/send-back" && method === "POST") {
    if (closed) throw new HttpError(409, "This project is closed");
    const to = String(b.to ?? "").toUpperCase();
    const problem = transitionProblem(def, stage.code, "send_back", to, who, String(b.reason ?? ""));
    if (problem) throw new HttpError(problem.startsWith("Only") ? 403 : 400, problem);
    await move(c, sys, life, def, { to, kind: "send_back", reason: String(b.reason).trim().slice(0, 1000) });
    return view();
  }
  if ((sub === "/skip" || sub === "/defer") && method === "POST") {
    if (closed) throw new HttpError(409, "This project is closed");
    if (!isActor(def.settings.advanceBy, who)) throw new HttpError(403, "Only the project lead, a Manager or an Administrator can ask for that");
    const kind = sub === "/skip" ? "skip" : "defer_items";
    const reason = String(b.reason ?? "").trim();
    if (kind === "skip") {
      const problem = transitionProblem(def, stage.code, "skip", null, who, reason);
      if (problem) throw new HttpError(400, problem);
    } else if (!stage.exit.some((x) => x.kind === "work_items_done" && x.allowDeferredWithApproval)) throw new HttpError(400, `${stage.name} doesn't allow deferring work items`);
    if (reason.length < 3) throw new HttpError(400, "Give a justification");
    const open = await c.db.prepare("SELECT 1 FROM stage_requests WHERE system_id = ? AND kind = ? AND status = 'pending'").bind(sys.id, kind).first();
    if (open) throw new HttpError(409, "There's already a request waiting for a decision");
    await c.db
      .prepare("INSERT INTO stage_requests (id, system_id, stage_code, kind, target_code, reason, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id16(), sys.id, stage.code, kind, kind === "skip" ? nextStage(def, stage.code)?.code ?? null : null, reason.slice(0, 1000), c.me.id, c.now)
      .run();
    await c.audit(kind === "skip" ? "stage_skip_requested" : "stage_deferral_requested", sys.id, { name: sys.name, stage: stage.name, reason });
    const { by } = await membersByRole(c.db);
    const deciders = def.settings.skipApprovedBy.flatMap((a) => by[a] ?? []).filter((p) => p.id !== c.me.id);
    c.alert(deciders.map((p) => ({ userId: p.id, kind: /** @type {const} */ ("signoff"), title: `${kind === "skip" ? "Skip" : "Deferral"} to approve: ${sys.name} · ${stage.name}`.slice(0, 200), body: `${c.me.name}: ${reason}`.slice(0, 500), link: `#/projects/${sys.id}/lifecycle` })));
    return view();
  }
  const rq = sub.match(/^\/requests\/([a-f0-9]{16})$/);
  if (rq && method === "POST") {
    const r = /** @type {{ id: string; kind: string; stage_code: string; target_code: string | null; requested_by: string; status: string; reason: string } | null} */ (await c.db.prepare("SELECT * FROM stage_requests WHERE id = ? AND system_id = ?").bind(rq[1], sys.id).first());
    if (!r) throw new HttpError(404, "Not found");
    if (r.status !== "pending") throw new HttpError(409, "That request has already been decided");
    if (!isActor(def.settings.skipApprovedBy, who)) throw new HttpError(403, "Only a Manager or an Administrator can decide this");
    if (r.requested_by === c.me.id) throw new HttpError(403, "Someone else has to approve your own request");
    const approve = b.decision === "approve";
    if (!approve && String(b.note ?? "").trim().length < 3) throw new HttpError(400, "Say why it's rejected");
    await c.db.prepare("UPDATE stage_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?").bind(approve ? "approved" : "rejected", c.me.id, c.now, String(b.note ?? "").slice(0, 1000) || null, r.id).run();
    await c.audit(approve ? "stage_request_approved" : "stage_request_rejected", sys.id, { name: sys.name, stage: stage.name, kind: r.kind });
    c.alert([{ userId: r.requested_by, kind: "stage", title: `${r.kind === "skip" ? "Skip" : "Deferral"} ${approve ? "approved" : "rejected"}: ${sys.name}`, body: String(b.note ?? ""), link: `#/projects/${sys.id}/lifecycle` }]);
    if (approve && r.kind === "skip" && r.stage_code === stage.code && life.state === "active") {
      const to = nextStage(def, stage.code);
      if (to) await move(c, sys, life, def, { to: to.code, kind: "skip", reason: `Skipped: ${r.reason} (approved by ${c.me.name})` });
    }
    return view();
  }
  if (sub === "/signoffs" && method === "POST") {
    if (closed) throw new HttpError(409, "This project is closed");
    if (!isActor(def.settings.advanceBy, who)) throw new HttpError(403, "Only the project lead, a Manager or an Administrator can ask for sign-off");
    await requestSignoffs(c, sys, def, stage, b.documentId ? String(b.documentId) : null);
    return view();
  }
  if (sub === "/remind" && method === "POST") {
    if (!isActor(def.settings.advanceBy, who)) throw new HttpError(403, "You don't have permission to do that");
    const pending = (await currentRound(c.db, sys.id, stage.code)).filter((r) => r.status === "pending");
    await c.db.prepare("UPDATE stage_signoffs SET reminded_at = ? WHERE system_id = ? AND stage_code = ? AND status = 'pending'").bind(c.now, sys.id, stage.code).run();
    c.alert(pending.map((r) => ({ userId: r.signer_id, kind: "signoff", title: `Reminder: your sign-off is needed on ${sys.name} · ${stage.name}`.slice(0, 200), body: `${c.me.name} sent a reminder.`, link: `#/projects/${sys.id}/lifecycle` })));
    return view();
  }
  const so = sub.match(/^\/signoffs\/([a-f0-9]{16})$/);
  if (so && method === "POST") {
    const r = /** @type {SignoffRow | null} */ (await c.db.prepare("SELECT * FROM stage_signoffs WHERE id = ? AND system_id = ?").bind(so[1], sys.id).first());
    // To anyone but the signatory, a sign-off is a 404.
    if (!r || r.signer_id !== c.me.id) throw new HttpError(404, "Not found");
    if (r.status !== "pending") throw new HttpError(409, "This sign-off is no longer open");
    const decision = b.decision === "approve" ? "approved" : b.decision === "decline" ? "declined" : null;
    if (!decision) throw new HttpError(400, "Choose approve or decline");
    const comment = String(b.comment ?? "").trim().slice(0, 1000);
    if (decision === "declined" && comment.length < 3) throw new HttpError(400, "Say why you're declining");
    if (!def.settings.selfSignoff && r.submitted_by === c.me.id) throw new HttpError(403, "You submitted this, so someone else has to sign it");
    await c.db.prepare("UPDATE stage_signoffs SET status = ?, comment = ?, decided_at = ? WHERE id = ?").bind(decision, comment, c.now, r.id).run();
    await c.audit(decision === "approved" ? "signoff_approved" : "signoff_declined", sys.id, { name: sys.name, stage: stageOf(def, r.stage_code)?.name ?? r.stage_code, version: r.document_version, ...(comment ? { comment } : {}) });
    if (sys.lead) c.alert([{ userId: sys.lead, kind: "signoff", title: `${c.me.name} ${decision} ${stageOf(def, r.stage_code)?.name ?? r.stage_code}: ${sys.name}`.slice(0, 200), body: comment, link: `#/projects/${sys.id}/lifecycle` }]);
    if (r.stage_code === stage.code) await afterSignoff(c, sys.id);
    return view();
  }
  const ck = sub.match(/^\/checklist\/([a-z][a-z0-9_]{0,39})$/);
  if (ck && method === "PUT") {
    if (closed) throw new HttpError(409, "This project is closed");
    const cr = stage.exit.find((x) => x.kind === "checklist" && x.key === ck[1]);
    if (!cr) throw new HttpError(404, "Not found");
    if (cr.by?.length ? !isActor(cr.by, who) : !mayEdit) throw new HttpError(403, `Only ${(cr.by ?? []).map((a) => ACTOR_LABEL[a]).join(" or ") || "people on this project"} can tick this`);
    if (b.done) {
      await c.db
        .prepare("INSERT INTO stage_checklist_items (system_id, stage_code, key, done_by, done_at, note) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (system_id, stage_code, key) DO UPDATE SET done_by = excluded.done_by, done_at = excluded.done_at, note = excluded.note")
        .bind(sys.id, stage.code, cr.key, c.me.id, c.now, String(b.note ?? "").slice(0, 500))
        .run();
    } else await c.db.prepare("DELETE FROM stage_checklist_items WHERE system_id = ? AND stage_code = ? AND key = ?").bind(sys.id, stage.code, cr.key).run();
    await c.audit("stage_checklist", sys.id, { name: sys.name, stage: stage.name, item: cr.label, done: !!b.done });
    return view();
  }
  if (sub === "/deliverables" && method === "POST") {
    needEdit();
    const key = String(b.key ?? "").toLowerCase();
    const known = def.stages.flatMap((s) => s.deliverables).find((d) => d.key === key && d.source === "document");
    if (!known) throw new HttpError(400, "Choose one of the lifecycle's deliverables");
    const doc = /** @type {{ id: string; deliverable_key: string | null; locked_at: string | null; name: string } | null} */ (await c.db.prepare("SELECT id, deliverable_key, locked_at, name FROM documents WHERE id = ? AND system_id = ? AND work_item_id IS NULL").bind(String(b.documentId ?? ""), sys.id).first());
    if (!doc) throw new HttpError(404, "Not found");
    if (doc.locked_at) throw new HttpError(409, "That document is signed off and locked");
    if (doc.deliverable_key) throw new HttpError(409, "That document is already a deliverable: upload a new file for a new version");
    const v = /** @type {{ v: number | null }} */ (await c.db.prepare("SELECT MAX(version) AS v FROM documents WHERE system_id = ? AND deliverable_key = ?").bind(sys.id, key).first());
    const version = Number(v?.v ?? 0) + 1;
    await c.db.prepare("UPDATE documents SET deliverable_key = ?, version = ?, stage_code = ? WHERE id = ?").bind(key, version, stage.code, doc.id).run();
    if (b.linkedTo) {
      const to = String(b.linkedTo).toLowerCase();
      const signed = await c.db.prepare("SELECT 1 FROM documents WHERE system_id = ? AND deliverable_key = ? AND locked_at IS NOT NULL").bind(sys.id, to).first();
      if (!signed) throw new HttpError(409, `Link it to a signed ${to.toUpperCase()}: there isn't one yet`);
      const links = /** @type {{ data: string } | null} */ (await c.db.prepare("SELECT data FROM stage_records WHERE system_id = ? AND kind = 'links'").bind(sys.id).first());
      await saveRecord(c, sys.id, "links", { ...(links ? JSON.parse(links.data) : {}), [key]: to });
    }
    await c.audit("deliverable_added", sys.id, { name: sys.name, deliverable: known.name, version, document: doc.name });
    return view();
  }
  // ----- registers -----
  const reg = sub.match(/^\/(risks|findings|tests|environments)(?:\/([a-f0-9]{16}))?(\/runs|\/accept|\/verify)?$/);
  if (reg) {
    needEdit();
    await registers(c, sys, stage, reg[1], reg[2] ?? null, reg[3] ?? "", method, b);
    return view();
  }
  const rec = sub.match(/^\/records\/(deployment|closure|discovery)$/);
  if (rec && method === "PUT") {
    needEdit();
    /** @type {Record<string, string>} */ const data = {};
    for (const [k, v] of Object.entries(b)) if (/^[a-zA-Z]{1,30}$/.test(k) && (typeof v === "string" || typeof v === "number")) data[k] = String(v).slice(0, 4000);
    await saveRecord(c, sys.id, rec[1], data);
    await c.audit("stage_record_saved", sys.id, { name: sys.name, record: rec[1] });
    return view();
  }
  throw new HttpError(404, "Not found");
}
/** @param {ItemContext} c @param {string} systemId */
async function isAssigned(c, systemId) {
  return !!(await c.db.prepare("SELECT 1 FROM assignments WHERE user_id = ? AND system_id = ?").bind(c.me.id, systemId).first());
}
/**
 * Risks, security findings, test cases and runs, environments.
 * @param {ItemContext} c @param {System} sys @param {Stage} stage @param {string} kind @param {string | null} id @param {string} action @param {string} method @param {Record<string, any>} b
 */
async function registers(c, sys, stage, kind, id, action, method, b) {
  const db = c.db;
  const s = (/** @type {unknown} */ v, /** @type {number} */ max) => String(v ?? "").trim().slice(0, max);
  const n15 = (/** @type {unknown} */ v, /** @type {string} */ label) => {
    const x = Math.round(Number(v));
    if (!(x >= 1 && x <= 5)) throw new HttpError(400, `${label} is 1 to 5`);
    return x;
  };
  const own = async (/** @type {string} */ table) => {
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND system_id = ?`).bind(id, sys.id).first();
    if (!row) throw new HttpError(404, "Not found");
    return /** @type {Record<string, any>} */ (row);
  };
  if (kind === "risks") {
    if (method === "POST" && !id) {
      const risk = s(b.risk, 500);
      if (!risk) throw new HttpError(400, "Describe the risk");
      await db
        .prepare("INSERT INTO risk_register (id, system_id, risk, likelihood, impact, owner_id, mitigation, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id16(), sys.id, risk, n15(b.likelihood, "Likelihood"), n15(b.impact, "Impact"), b.ownerId ? s(b.ownerId, 80) : null, s(b.mitigation, 1000), c.me.id, c.now, c.now)
        .run();
      await c.audit("risk_added", sys.id, { name: sys.name, risk, rating: riskRating(n15(b.likelihood, "Likelihood"), n15(b.impact, "Impact")) });
      return;
    }
    const r = await own("risk_register");
    if (method === "DELETE") return void (await db.prepare("DELETE FROM risk_register WHERE id = ?").bind(r.id).run());
    if (method === "PATCH") {
      await db
        .prepare("UPDATE risk_register SET risk = ?, likelihood = ?, impact = ?, owner_id = ?, mitigation = ?, status = ?, updated_at = ? WHERE id = ?")
        .bind(b.risk !== undefined ? s(b.risk, 500) || r.risk : r.risk, b.likelihood !== undefined ? n15(b.likelihood, "Likelihood") : r.likelihood, b.impact !== undefined ? n15(b.impact, "Impact") : r.impact, b.ownerId !== undefined ? (b.ownerId ? s(b.ownerId, 80) : null) : r.owner_id, b.mitigation !== undefined ? s(b.mitigation, 1000) : r.mitigation, b.status === "closed" || b.status === "open" ? b.status : r.status, c.now, r.id)
        .run();
      return;
    }
  }
  if (kind === "findings") {
    if (method === "POST" && !id && !action) {
      const title = s(b.title, 300);
      if (!title) throw new HttpError(400, "Give the finding a title");
      const severity = ["Critical", "High", "Medium", "Low", "Info"].includes(b.severity) ? b.severity : null;
      if (!severity) throw new HttpError(400, "Choose a severity");
      await db.prepare("INSERT INTO security_findings (id, system_id, title, severity, detail, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id16(), sys.id, title, severity, s(b.detail, 2000), c.me.id, c.now, c.now).run();
      await c.audit("security_finding_added", sys.id, { name: sys.name, title, severity });
      return;
    }
    const f = await own("security_findings");
    if (action === "/accept" && method === "POST") {
      // A formal risk acceptance: a Manager (or Administrator), with a reason and an expiry date.
      if (!["manager", "admin"].includes(c.me.role)) throw new HttpError(403, "Only a Manager can accept a security risk");
      const reason = s(b.reason, 1000);
      const until = s(b.until, 10);
      if (reason.length < 3) throw new HttpError(400, "Give the reason for accepting the risk");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= c.now.slice(0, 10)) throw new HttpError(400, "Choose an expiry date in the future");
      await db.prepare("UPDATE security_findings SET status = 'accepted', accepted_by = ?, accepted_reason = ?, accepted_until = ?, updated_at = ? WHERE id = ?").bind(c.me.id, reason, until, c.now, f.id).run();
      await c.audit("security_risk_accepted", sys.id, { name: sys.name, title: f.title, severity: f.severity, until, reason });
      return;
    }
    if (method === "PATCH") {
      const status = b.status === "fixed" || b.status === "open" ? b.status : f.status === "accepted" ? "accepted" : f.status;
      await db
        .prepare("UPDATE security_findings SET title = ?, severity = ?, detail = ?, status = ?, accepted_by = CASE WHEN ? = 'accepted' THEN accepted_by END, accepted_reason = CASE WHEN ? = 'accepted' THEN accepted_reason END, accepted_until = CASE WHEN ? = 'accepted' THEN accepted_until END, updated_at = ? WHERE id = ?")
        .bind(b.title !== undefined ? s(b.title, 300) || f.title : f.title, ["Critical", "High", "Medium", "Low", "Info"].includes(b.severity) ? b.severity : f.severity, b.detail !== undefined ? s(b.detail, 2000) : f.detail, status, status, status, status, c.now, f.id)
        .run();
      await c.audit("security_finding_updated", sys.id, { name: sys.name, title: f.title, status });
      return;
    }
    if (method === "DELETE") return void (await db.prepare("DELETE FROM security_findings WHERE id = ?").bind(f.id).run());
  }
  if (kind === "tests") {
    if (method === "POST" && !id) {
      const title = s(b.title, 300);
      const suite = s(b.suite, 12).toUpperCase() || stage.testing?.suite || "QAT";
      if (!title) throw new HttpError(400, "Give the test case a title");
      if (!/^[A-Z]{2,12}$/.test(suite)) throw new HttpError(400, "Unknown test suite");
      await db
        .prepare("INSERT INTO test_cases (id, system_id, suite, title, steps, expected, scenario, assignee_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id16(), sys.id, suite, title, s(b.steps, 4000), s(b.expected, 2000), s(b.scenario, 200), b.assigneeId ? s(b.assigneeId, 80) : null, c.me.id, c.now)
        .run();
      return;
    }
    const t = await own("test_cases");
    // The UAT script's columns: scenario, test case, the tester assigned, the expected result.
    if (!action && method === "PATCH") {
      await db
        .prepare("UPDATE test_cases SET title = ?, scenario = ?, expected = ?, steps = ?, assignee_id = ? WHERE id = ?")
        .bind(b.title !== undefined ? s(b.title, 300) || t.title : t.title, b.scenario !== undefined ? s(b.scenario, 200) : t.scenario, b.expected !== undefined ? s(b.expected, 2000) : t.expected, b.steps !== undefined ? s(b.steps, 4000) : t.steps, b.assigneeId !== undefined ? (b.assigneeId ? s(b.assigneeId, 80) : null) : t.assignee_id, t.id)
        .run();
      return;
    }
    if (action === "/runs" && method === "POST") {
      const result = ["pass", "fail", "blocked", "waived"].includes(b.result) ? b.result : null;
      if (!result) throw new HttpError(400, "Choose pass, fail, blocked or waived");
      const notes = s(b.notes, 2000);
      let bug = null;
      // A failed test raises a bug (the stage's testing setting), linked to the run.
      const testing = stage.testing?.suite === t.suite ? stage.testing : null;
      if (result === "fail" && (testing?.failedCreatesBug ?? true)) {
        const row = await createItem(c, { systemId: sys.id, type: "BUG", summary: `${t.suite} failed: ${t.title}`.slice(0, 250), description: `${notes ? `${notes}\n\n` : ""}Steps:\n${t.steps}\n\nExpected:\n${t.expected}`.slice(0, 10000), priority: b.priority && ["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"].includes(b.priority) ? b.priority : "HIGH" }, "internal");
        bug = row.id;
        await db.prepare("UPDATE work_items SET lifecycle_stage = ? WHERE id = ?").bind(stage.code, row.id).run();
      }
      await db.prepare("INSERT INTO test_runs (id, case_id, system_id, result, notes, bug_item_id, run_by, run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id16(), t.id, sys.id, result, notes, bug, c.me.id, c.now).run();
      await c.audit("test_run", sys.id, { name: sys.name, suite: t.suite, test: t.title, result, ...(bug ? { bug: true } : {}) });
      return;
    }
    if (method === "DELETE") return void (await db.prepare("DELETE FROM test_cases WHERE id = ?").bind(t.id).run());
  }
  if (kind === "environments") {
    if (method === "POST" && !id) {
      const name = s(b.name, 40);
      if (!name) throw new HttpError(400, "Name the environment (Dev, QA, UAT, Prod…)");
      await db
        .prepare("INSERT INTO project_environments (id, system_id, name, server, resources, access, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (system_id, name) DO UPDATE SET server = excluded.server, resources = excluded.resources, access = excluded.access, verified_by = NULL, verified_at = NULL, updated_at = excluded.updated_at")
        .bind(id16(), sys.id, name, s(b.server, 300), s(b.resources, 1000), s(b.access, 1000), c.now)
        .run();
      return;
    }
    const e = await own("project_environments");
    if (action === "/verify" && method === "POST") {
      await db.prepare("UPDATE project_environments SET verified_by = ?, verified_at = ? WHERE id = ?").bind(b.verified === false ? null : c.me.id, b.verified === false ? null : c.now, e.id).run();
      await c.audit("environment_verified", sys.id, { name: sys.name, environment: e.name, verified: b.verified !== false });
      return;
    }
    if (method === "DELETE") return void (await db.prepare("DELETE FROM project_environments WHERE id = ?").bind(e.id).run());
  }
  throw new HttpError(405, "Method not allowed");
}

// ---------- pipeline and report ----------
/** Every project with a lifecycle in this workspace, where it is. @param {ItemContext} c */
async function pipeline(c) {
  const [rows, cal] = await Promise.all([
    c.db
      .prepare(
        `SELECT l.system_id, l.template_id, l.stage_code, l.stage_entered_at, l.state, s.data, t.name AS template_name, t.version, t.definition
         FROM project_lifecycle l JOIN systems s ON s.id = l.system_id JOIN lifecycle_templates t ON t.id = l.template_id`,
      )
      .all(),
    loadCalendar(c.db),
  ]);
  /** @type {Map<string, TemplateDefinition>} */ const defs = new Map();
  const back = /** @type {{ system_id: string }[]} */ ((await c.db.prepare("SELECT DISTINCT system_id FROM project_stage_history WHERE kind IN ('send_back', 'decline')").all()).results);
  const sentBack = new Set(back.map((r) => r.system_id));
  const projects = /** @type {any[]} */ (rows.results).map((r) => {
    if (!defs.has(r.template_id)) defs.set(r.template_id, cleanTemplate(r.definition));
    const def = /** @type {TemplateDefinition} */ (defs.get(r.template_id));
    const sys = JSON.parse(r.data);
    const st = stageOf(def, r.stage_code);
    return {
      id: r.system_id,
      name: sys.name,
      lead: sys.lead ?? null,
      workspace: sys.workspace ?? null,
      templateId: r.template_id,
      stage: r.stage_code,
      phase: st?.phase ?? null,
      state: r.state,
      enteredAt: r.stage_entered_at,
      progress: sys.progress,
      sentBack: sentBack.has(r.system_id),
      sla: r.state === "closed" ? null : stageSla(r.stage_entered_at, st?.targetDays ?? null, Date.parse(c.now), cal),
    };
  });
  return { templates: [...defs.entries()].map(([id, def]) => ({ id, definition: def })), projects };
}
/**
 * The lifecycle section of Reports → Projects: projects per stage and phase, time in each stage, bottlenecks,
 * sign-off turnaround, send-backs, QAT/UAT pass rates, security findings, on-time vs overdue stages.
 * @param {ItemContext} c
 */
export async function lifecycleReport(c) {
  const { projects, templates } = await pipeline(c);
  const def = templates[0]?.definition ?? null;
  const [history, signoffs, runs, findings] = await Promise.all([
    c.db.prepare("SELECT system_id, from_code, to_code, kind, at FROM project_stage_history ORDER BY system_id, id").all(),
    c.db.prepare("SELECT stage_code, requested_at, decided_at, status FROM stage_signoffs WHERE status IN ('approved', 'declined')").all(),
    c.db.prepare("SELECT c.suite, r.case_id, r.result, r.run_at FROM test_runs r JOIN test_cases c ON c.id = r.case_id").all(),
    c.db.prepare("SELECT severity, status FROM security_findings").all(),
  ]);
  const cal = await loadCalendar(c.db);
  const dayMinutes = 9 * 60;
  /** @type {Record<string, { visits: number; days: number; onTime: number; late: number; sendBacks: number }>} */ const per = {};
  const bucket = (/** @type {string} */ k) => (per[k] ??= { visits: 0, days: 0, onTime: 0, late: 0, sendBacks: 0 });
  /** @type {Map<string, { code: string; at: string }>} */ const open = new Map();
  for (const h of /** @type {{ system_id: string; from_code: string | null; to_code: string; kind: string; at: string }[]} */ (history.results)) {
    const was = open.get(h.system_id);
    if (was && h.kind !== "migrate" && h.kind !== "start") {
      const b = bucket(was.code);
      const days = workingMinutes(Date.parse(was.at), Date.parse(h.at), cal) / dayMinutes;
      b.visits++;
      b.days += days;
      const target = def ? stageOf(def, was.code)?.targetDays : null;
      if (target) days <= target ? b.onTime++ : b.late++;
    }
    if (h.kind === "send_back" || h.kind === "decline") bucket(h.from_code ?? h.to_code).sendBacks++;
    open.set(h.system_id, { code: h.to_code, at: h.at });
  }
  for (const p of projects) if (p.sla?.state === "overdue") bucket(p.stage).late++;
  const stages = (def?.stages ?? []).map((s) => {
    const b = per[s.code] ?? { visits: 0, days: 0, onTime: 0, late: 0, sendBacks: 0 };
    const here = projects.filter((p) => p.stage === s.code && p.state === "active");
    return { code: s.code, name: s.name, phase: s.phase, targetDays: s.targetDays, projects: here.length, overdue: here.filter((p) => p.sla?.state === "overdue").length, avgDays: b.visits ? Math.round((b.days / b.visits) * 10) / 10 : null, onTime: b.onTime, late: b.late, sendBacks: b.sendBacks };
  });
  const bottlenecks = stages
    .filter((s) => s.projects || s.avgDays)
    .map((s) => ({ ...s, score: s.overdue * 3 + s.projects + (s.targetDays && s.avgDays ? Math.max(0, s.avgDays / s.targetDays - 1) * 5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((s) => s.score > 0)
    .map((s) => s.name);
  const turn = /** @type {{ stage_code: string; requested_at: string; decided_at: string }[]} */ (signoffs.results).map((r) => ({ stage: r.stage_code, days: (Date.parse(r.decided_at) - Date.parse(r.requested_at)) / DAY }));
  /** @type {Record<string, { total: number; pass: number }>} */ const rates = {};
  /** @type {Map<string, { suite: string; result: string; at: string }>} */ const latest = new Map();
  for (const r of /** @type {{ suite: string; case_id: string; result: string; run_at: string }[]} */ (runs.results)) {
    const was = latest.get(r.case_id);
    if (!was || r.run_at >= was.at) latest.set(r.case_id, { suite: r.suite, result: r.result, at: r.run_at });
  }
  for (const r of latest.values()) {
    const x = (rates[r.suite] ??= { total: 0, pass: 0 });
    x.total++;
    if (r.result === "pass") x.pass++;
  }
  /** @type {Record<string, { open: number; total: number }>} */ const sev = {};
  for (const f of /** @type {{ severity: string; status: string }[]} */ (findings.results)) {
    const x = (sev[f.severity] ??= { open: 0, total: 0 });
    x.total++;
    if (f.status === "open") x.open++;
  }
  const phases = (def?.phases ?? []).map((p) => ({ code: p.code, name: p.name, projects: projects.filter((x) => x.phase === p.code && x.state === "active").length }));
  return {
    hasLifecycle: !!def,
    totals: { active: projects.filter((p) => p.state === "active").length, closed: projects.filter((p) => p.state === "closed").length, overdue: projects.filter((p) => p.sla?.state === "overdue").length },
    phases,
    stages,
    bottlenecks,
    signoffTurnaroundDays: turn.length ? Math.round((turn.reduce((a, t) => a + t.days, 0) / turn.length) * 10) / 10 : null,
    passRates: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, { ...v, rate: v.total ? Math.round((v.pass / v.total) * 1000) / 10 : null }])),
    findings: sev,
  };
}

// ---------- the clock: overdue stages and pending sign-offs ----------
/**
 * Every 5 minutes (index.js scheduled): a stage at 80% of its target warns the people responsible, once; an
 * overdue stage is escalated to the Manager(s), once; a sign-off pending longer than the template's reminder days is
 * reminded (then again after as many days).
 * @param {Env} env  a workspace's
 */
export async function runLifecycleClock(env) {
  const db = env.DB;
  const rows = /** @type {(LifeRow & { data: string; definition: string })[]} */ (
    (await db.prepare("SELECT l.*, s.data, t.definition FROM project_lifecycle l JOIN systems s ON s.id = l.system_id JOIN lifecycle_templates t ON t.id = l.template_id WHERE l.state = 'active'").all()).results
  );
  if (!rows.length) return;
  const cal = await loadCalendar(db);
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const members = /** @type {{ id: string; role: string }[]} */ ((await db.prepare("SELECT a.id, m.role FROM workspace_members m JOIN accounts a ON a.id = m.user_id WHERE a.deactivated_at IS NULL").all()).results);
  /** @type {Alert[]} */ const alerts = [];
  for (const r of rows) {
    const def = cleanTemplate(r.definition);
    const sys = JSON.parse(r.data);
    const stage = stageOf(def, r.stage_code);
    if (!stage) continue;
    const sla = stageSla(r.stage_entered_at, stage.targetDays, now, cal);
    const link = `#/projects/${r.system_id}/lifecycle`;
    const people = (/** @type {string[]} */ actors) => [...new Set(actors.flatMap((a) => (a === "lead" ? (sys.lead ? [sys.lead] : []) : a === "stageOwner" ? (stage.ownerId ? [stage.ownerId] : []) : members.filter((m) => m.role === a).map((m) => m.id))))];
    if (sla?.state === "overdue" && !r.sla_breached_at) {
      await db.prepare("UPDATE project_lifecycle SET sla_breached_at = ? WHERE system_id = ?").bind(iso, r.system_id).run();
      for (const userId of people([...def.settings.overdueEscalateTo, ...stage.responsible])) alerts.push({ userId, kind: "stage", title: `Overdue: ${sys.name} in ${stage.name}`.slice(0, 200), body: `${sla.usedDays} business days in this stage; the target is ${stage.targetDays}.`, link, dedupe: `stage-overdue:${r.system_id}:${r.stage_code}:${r.stage_entered_at}` });
    } else if (sla && sla.state !== "running" && !r.sla_warned_at) {
      await db.prepare("UPDATE project_lifecycle SET sla_warned_at = ? WHERE system_id = ?").bind(iso, r.system_id).run();
      for (const userId of people(stage.responsible.length ? stage.responsible : ["lead"])) alerts.push({ userId, kind: "stage", title: `Due soon: ${sys.name} · ${stage.name}`.slice(0, 200), body: `Due ${new Date(sla.dueAt).toLocaleString("en-GB", { timeZone: cal.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`, link, dedupe: `stage-warn:${r.system_id}:${r.stage_code}:${r.stage_entered_at}` });
    }
    // Pending sign-offs: a reminder after signoffReminderDays business days, and again after as many.
    const pending = /** @type {SignoffRow[]} */ ((await db.prepare("SELECT * FROM stage_signoffs WHERE system_id = ? AND stage_code = ? AND status = 'pending'").bind(r.system_id, r.stage_code).all()).results);
    const dayMinutes = Math.max(60, Number(cal.end.slice(0, 2)) * 60 + Number(cal.end.slice(3)) - (Number(cal.start.slice(0, 2)) * 60 + Number(cal.start.slice(3))));
    for (const s of pending) {
      const since = Date.parse(s.reminded_at ?? s.requested_at);
      if (workingMinutes(since, now, cal) >= def.settings.signoffReminderDays * dayMinutes) {
        await db.prepare("UPDATE stage_signoffs SET reminded_at = ? WHERE id = ?").bind(iso, s.id).run();
        alerts.push({ userId: s.signer_id, kind: "signoff", title: `Reminder: your sign-off is needed on ${sys.name} · ${stage.name}`.slice(0, 200), body: `Waiting since ${s.requested_at.slice(0, 10)}.`, link, dedupe: `signoff-remind:${s.id}:${iso.slice(0, 10)}` });
      }
    }
  }
  if (alerts.length) await raise(env, alerts);
}

/**
 * Lines for Ask PMS: each active project's stage, days in it and whether it's overdue, so it can answer "which
 * projects are stuck in BRS Sign Off for more than 10 days?".
 * @param {ItemContext} c
 */
export async function askLifecycleLines(c) {
  const { projects, templates } = await pipeline(c).catch(() => ({ projects: [], templates: [] }));
  if (!projects.length) return [];
  const def = templates[0]?.definition;
  const name = (/** @type {string} */ code) => (def ? stageOf(def, code)?.name : null) ?? code;
  const lines = ["Project lifecycle (stage, business days in the stage, target):"];
  for (const p of projects) {
    if (p.state === "closed") lines.push(`- ${p.name}: closed`);
    else lines.push(`- ${p.name}: ${name(p.stage)}, ${p.sla ? `${p.sla.usedDays} business days (target ${def ? stageOf(def, p.stage)?.targetDays ?? "none" : "?"})${p.sla.state === "overdue" ? ", OVERDUE" : ""}` : `since ${p.enteredAt.slice(0, 10)}`}${p.sentBack ? ", has been sent back before" : ""}`);
  }
  return lines;
}
export { stageIndex };
