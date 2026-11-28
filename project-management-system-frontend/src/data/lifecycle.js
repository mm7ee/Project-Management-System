// Project lifecycles (docs/lifecycle-plan.md): the rules, shared by the Worker (which enforces them) and the screens
// (which show exactly what is missing). Pure functions, no I/O; unit tested in tests/lifecycle.test.js.
//   cleanTemplate(raw)              the only shape a template definition may have
//   evaluateGate(stage, facts)      each exit criterion, met or not, with what's missing
//   transitionProblem(…)            whether a move (advance, send back, skip) is allowed, and why not
//   stageSla(…), lifecycleProgress(…), riskRating(…), testSummary(…), mapExistingProject(…)
import { addWorkingMinutes, workingMinutes } from "./workCalendar";

/** @typedef {import("./workCalendar").WorkCalendar} WorkCalendar */
/** @typedef {"work" | "draft" | "approval" | "assessment" | "testing" | "deployment" | "closure"} StageType */
/** @typedef {"admin" | "manager" | "team_lead" | "assistant" | "developer" | "viewer" | "lead" | "stageOwner"} Actor */
/**
 * @typedef {Object} Criterion  one exit criterion
 * @property {CriterionKind} kind
 * @property {string} label
 * @property {string} [key]            checklist / deliverable key
 * @property {Actor[]} [by]            checklist: who may tick it (default anyone who may advance)
 * @property {string[]} [severities]   risks_mitigated
 * @property {string[]} [blocking]     security_clear
 * @property {string[]} [required]     environments
 * @property {string} [suite]          test_pass_rate
 * @property {number} [min]            test_pass_rate (0–1)
 * @property {string[]} [priorities]   no_open_bugs
 * @property {string} [from]           linked
 * @property {string} [to]             linked
 * @property {boolean} [allowDeferredWithApproval] work_items_done
 */
/**
 * @typedef {"checklist" | "deliverable" | "linked" | "signoffs" | "pcn_complete" | "risk_register" | "risks_mitigated" | "work_items_done" | "environments" | "security_clear" | "test_pass_rate" | "no_open_bugs" | "change_approved" | "deployment_recorded"} CriterionKind
 */
/**
 * @typedef {Object} Signatory
 * @property {"user" | "role"} kind
 * @property {string} [userId]       kind user
 * @property {string} [name]         kind user: their name as shown
 * @property {string} [role]         kind role: any active member with the role
 * @property {string} label          what they sign as ("Business owner", "Technical")
 * @property {{ userId: string; name: string }} [alternate]  signs when the signatory can't (they submitted it)
 */
/**
 * @typedef {Object} Stage
 * @property {string} code
 * @property {string} name
 * @property {string} phase
 * @property {StageType} type
 * @property {Actor[]} responsible
 * @property {string | null} [ownerId]
 * @property {number | null} targetDays   business days
 * @property {number} weight              share of lifecycle progress
 * @property {Criterion[]} exit
 * @property {{ key: string; name: string; source: "document" | "pcn" | "risk_register"; versioned?: boolean }[]} deliverables
 * @property {{ source?: "pcn_signatories"; signatories?: Signatory[]; onDecline: string; lockDeliverables?: string[] } | null} signoff
 * @property {{ suite: string; passThreshold?: number; failedCreatesBug?: boolean; onFailSendBackTo?: string } | null} testing
 * @property {{ createChangeRequest: boolean } | null} deployment
 * @property {{ sendBackTo: string[]; canSkip: boolean }} transitions
 * @property {{ onEnter: string[]; onExit: string[]; onOverdue: string[] }} automation
 * @property {boolean} checklistAsWorkItems
 */
/**
 * @typedef {Object} TemplateSettings
 * @property {boolean} selfSignoff      may whoever submitted a deliverable sign it?
 * @property {Actor[]} advanceBy
 * @property {Actor[]} sendBackBy
 * @property {Actor[]} skipApprovedBy
 * @property {number} signoffReminderDays
 * @property {Actor[]} overdueEscalateTo
 * @property {{ lifecycleWeight: number }} progress   the rest is work items
 * @property {{ status: string }} onClose
 */
/**
 * @typedef {Object} TemplateDefinition
 * @property {TemplateSettings} settings
 * @property {{ code: string; name: string }[]} phases
 * @property {Stage[]} stages
 */

export const STAGE_TYPES = /** @type {const} */ (["work", "draft", "approval", "assessment", "testing", "deployment", "closure"]);
export const STAGE_TYPE_LABEL = { work: "Work", draft: "Draft", approval: "Sign-off", assessment: "Assessment", testing: "Testing", deployment: "Deployment", closure: "Closure" };
export const CRITERION_KINDS = /** @type {const} */ (["checklist", "deliverable", "linked", "signoffs", "pcn_complete", "risk_register", "risks_mitigated", "work_items_done", "environments", "security_clear", "test_pass_rate", "no_open_bugs", "change_approved", "deployment_recorded"]);
const ACTORS = ["admin", "manager", "team_lead", "assistant", "developer", "viewer", "lead", "stageOwner"];
export const ACTOR_LABEL = { admin: "Administrator", manager: "Manager", team_lead: "Team Leader", assistant: "Projects Assistant", developer: "Developer", viewer: "Standard user", lead: "Project lead", stageOwner: "Stage owner" };
export const SEVERITIES = /** @type {const} */ (["Critical", "High", "Medium", "Low", "Info"]);
export const RISK_LEVELS = /** @type {const} */ (["Low", "Medium", "High", "Critical"]);
export const AUTOMATION_HOOKS = ["notify:responsible", "request:signoffs", "remind:responsible", "remind:signatories", "escalate:manager", "create:change_request", "create:checklist_items", "set:status", "lock:deliverables", "stop:slas"];
/** The project status each stage type implies, so the old Status column stays meaningful. */
export const STATUS_FOR_STAGE = { draft: "IDEA", assessment: "UPCOMING", approval: "UPCOMING", work: "WIP", testing: "TESTING", deployment: "TO_DEPLOY", closure: "TO_DEPLOY" };

// ---------- the template ----------
const str = (/** @type {unknown} */ v, /** @type {number} */ max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** @param {unknown} v @returns {Actor[]} */
const actors = (v) => (Array.isArray(v) ? [...new Set(v.filter((a) => ACTORS.includes(a)))] : []);
/** @param {unknown} v @returns {string[]} */
const strings = (v, max = 40) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean) : []);

/**
 * The only shape a template's definition may have. Throws an Error (its message for the person) for anything
 * that doesn't make a usable lifecycle: no stages, duplicate codes, a send-back to a later stage, a sign-off with no
 * signatories, an unknown criterion…
 * @param {unknown} raw
 * @returns {TemplateDefinition}
 */
export function cleanTemplate(raw) {
  const o = /** @type {Record<string, any>} */ (typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!o || typeof o !== "object") throw new Error("The template isn't valid");
  const phases = (Array.isArray(o.phases) ? o.phases : []).map((/** @type {any} */ p) => ({ code: str(p?.code, 10).toUpperCase(), name: str(p?.name, 60) })).filter((p) => p.code && p.name);
  if (!phases.length) throw new Error("A lifecycle needs at least one phase");
  if (new Set(phases.map((p) => p.code)).size !== phases.length) throw new Error("Two phases have the same code");
  const raws = Array.isArray(o.stages) ? o.stages : [];
  if (!raws.length || raws.length > 40) throw new Error("A lifecycle has 1 to 40 stages");
  const codes = raws.map((/** @type {any} */ s) => str(s?.code, 30).toUpperCase());
  /** @type {Stage[]} */ const stages = raws.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const code = codes[i];
    if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(code)) throw new Error(`Stage ${i + 1} needs a code of capital letters, digits and _`);
    const name = str(s.name, 60);
    if (!name) throw new Error(`Stage ${code} needs a name`);
    const phase = str(s.phase, 10).toUpperCase();
    if (!phases.some((p) => p.code === phase)) throw new Error(`${name}: choose one of the phases`);
    const type = STAGE_TYPES.includes(s.type) ? s.type : null;
    if (!type) throw new Error(`${name}: unknown stage type`);
    const earlier = new Set(codes.slice(0, i));
    const sendBackTo = strings(s.transitions?.sendBackTo, 30).map((c) => c.toUpperCase());
    for (const c of sendBackTo) if (!earlier.has(c)) throw new Error(`${name} can only send back to an earlier stage (not ${c})`);
    /** @type {Criterion[]} */ const exit = (Array.isArray(s.exit) ? s.exit : []).map((/** @type {any} */ c) => cleanCriterion(c, name));
    let signoff = null;
    if (s.signoff) {
      const onDecline = str(s.signoff.onDecline ?? code, 30).toUpperCase();
      if (onDecline !== code && !earlier.has(onDecline)) throw new Error(`${name}: a decline sends the project back to an earlier stage`);
      const signatories = (Array.isArray(s.signoff.signatories) ? s.signoff.signatories : []).map(cleanSignatory).filter(Boolean);
      const source = s.signoff.source === "pcn_signatories" ? /** @type {const} */ ("pcn_signatories") : undefined;
      if (!source && !signatories.length) throw new Error(`${name}: a sign-off needs at least one signatory`);
      signoff = { ...(source ? { source } : {}), signatories, onDecline, lockDeliverables: strings(s.signoff.lockDeliverables, 40) };
      if (!exit.some((c) => c.kind === "signoffs")) exit.push({ kind: "signoffs", label: "All signatories approve" });
    }
    if (exit.some((c) => c.kind === "signoffs") && !signoff) throw new Error(`${name}: "sign-offs" needs signatories`);
    const target = s.targetDays == null || s.targetDays === "" ? null : Math.round(Number(s.targetDays));
    if (target !== null && !(target >= 1 && target <= 365)) throw new Error(`${name}: the target is 1 to 365 business days`);
    const weight = Number(s.weight ?? 0);
    if (!(weight >= 0 && weight <= 100)) throw new Error(`${name}: the weight is 0 to 100`);
    return {
      code,
      name,
      phase,
      type,
      responsible: actors(s.responsible),
      ownerId: s.ownerId ? str(s.ownerId, 80) : null,
      targetDays: target,
      weight,
      exit,
      deliverables: (Array.isArray(s.deliverables) ? s.deliverables : []).map((/** @type {any} */ d) => ({
        key: str(d?.key, 40).toLowerCase(),
        name: str(d?.name, 80),
        source: ["document", "pcn", "risk_register"].includes(d?.source) ? d.source : "document",
        ...(d?.versioned ? { versioned: true } : {}),
      })).filter((/** @type {{ key: string; name: string }} */ d) => /^[a-z][a-z0-9_]{0,39}$/.test(d.key) && d.name),
      signoff,
      testing: s.testing ? { suite: str(s.testing.suite, 12).toUpperCase() || "QAT", ...(s.testing.passThreshold != null ? { passThreshold: clamp01(s.testing.passThreshold) } : {}), failedCreatesBug: s.testing.failedCreatesBug !== false, ...(s.testing.onFailSendBackTo ? { onFailSendBackTo: str(s.testing.onFailSendBackTo, 30).toUpperCase() } : {}) } : null,
      deployment: s.deployment ? { createChangeRequest: s.deployment.createChangeRequest !== false } : null,
      transitions: { sendBackTo, canSkip: s.transitions?.canSkip === true },
      automation: {
        onEnter: strings(s.automation?.onEnter, 60),
        onExit: strings(s.automation?.onExit, 60),
        onOverdue: strings(s.automation?.onOverdue, 60),
      },
      checklistAsWorkItems: s.checklistAsWorkItems === true,
    };
  });
  if (new Set(codes).size !== codes.length) throw new Error("Two stages have the same code");
  // Phases in order: a stage's phase is never earlier than the stage before's.
  const phaseAt = (/** @type {string} */ c) => phases.findIndex((p) => p.code === c);
  for (let i = 1; i < stages.length; i++) if (phaseAt(stages[i].phase) < phaseAt(stages[i - 1].phase)) throw new Error(`${stages[i].name} is in an earlier phase than the stage before it`);
  const st = o.settings ?? {};
  return {
    settings: {
      selfSignoff: st.selfSignoff === true,
      advanceBy: actors(st.advanceBy ?? ["lead", "manager", "admin", "stageOwner"]),
      sendBackBy: actors(st.sendBackBy ?? ["lead", "manager", "admin"]),
      skipApprovedBy: actors(st.skipApprovedBy ?? ["manager", "admin"]),
      signoffReminderDays: Math.min(30, Math.max(1, Math.round(Number(st.signoffReminderDays ?? 2)))),
      overdueEscalateTo: actors(st.overdueEscalateTo ?? ["manager"]),
      progress: { lifecycleWeight: clamp01(st.progress?.lifecycleWeight ?? 0.6) },
      onClose: { status: ["LIVE", "COMPLETED"].includes(st.onClose?.status) ? st.onClose.status : "LIVE" },
    },
    phases,
    stages,
  };
}
const clamp01 = (/** @type {unknown} */ v) => Math.min(1, Math.max(0, Number(v) || 0));
/** @param {any} c @param {string} stage @returns {Criterion} */
function cleanCriterion(c, stage) {
  const kind = CRITERION_KINDS.includes(c?.kind) ? /** @type {CriterionKind} */ (c.kind) : null;
  if (!kind) throw new Error(`${stage}: unknown exit criterion`);
  const label = str(c.label, 160) || kind.replace(/_/g, " ");
  /** @type {Criterion} */ const out = { kind, label };
  if (kind === "checklist" || kind === "deliverable") {
    out.key = str(c.key, 40).toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(out.key)) throw new Error(`${stage}: "${label}" needs a key`);
    if (kind === "checklist" && c.by) out.by = actors(c.by);
  }
  if (kind === "linked") [out.from, out.to] = [str(c.from, 40).toLowerCase(), str(c.to, 40).toLowerCase()];
  if (kind === "risks_mitigated") out.severities = strings(c.severities).filter((s) => RISK_LEVELS.includes(/** @type {any} */ (s)));
  if (kind === "security_clear") out.blocking = strings(c.blocking).filter((s) => SEVERITIES.includes(/** @type {any} */ (s)));
  if (kind === "environments") out.required = strings(c.required, 40);
  if (kind === "test_pass_rate") [out.suite, out.min] = [str(c.suite, 12).toUpperCase() || "QAT", clamp01(c.min ?? 0.95)];
  if (kind === "no_open_bugs") out.priorities = strings(c.priorities);
  if (kind === "work_items_done") out.allowDeferredWithApproval = c.allowDeferredWithApproval !== false;
  return out;
}
/** @param {any} s @returns {Signatory | null} */
function cleanSignatory(s) {
  const label = str(s?.label, 60);
  if (s?.kind === "user" && s.userId) {
    return { kind: "user", userId: str(s.userId, 80), name: str(s.name, 80) || str(s.userId, 80), label: label || str(s.name, 60), ...(s.alternate?.userId ? { alternate: { userId: str(s.alternate.userId, 80), name: str(s.alternate.name, 80) || str(s.alternate.userId, 80) } } : {}) };
  }
  if (s?.kind === "role" && ACTORS.includes(s.role)) return { kind: "role", role: s.role, label: label || ACTOR_LABEL[/** @type {keyof typeof ACTOR_LABEL} */ (s.role)] };
  return null;
}

/** @param {TemplateDefinition} def @param {string} code */
export const stageOf = (def, code) => def.stages.find((s) => s.code === code) ?? null;
/** @param {TemplateDefinition} def @param {string} code */
export const stageIndex = (def, code) => def.stages.findIndex((s) => s.code === code);
/** The stage after this one, or null at the last. @param {TemplateDefinition} def @param {string} code */
export function nextStage(def, code) {
  const i = stageIndex(def, code);
  return i >= 0 && i < def.stages.length - 1 ? def.stages[i + 1] : null;
}

// ---------- gates ----------
/**
 * What the server read about a project, for its current stage's gate.
 * @typedef {Object} GateFacts
 * @property {Set<string>} checklist                 the stage's ticked keys
 * @property {{ key: string; version: number; locked: boolean; linkedTo?: string | null }[]} deliverables  latest of each
 * @property {{ required: number; approved: number; declined: number; pending: string[] } | null} signoffs  this round
 * @property {{ exists: boolean; missing: string[] }} pcn
 * @property {{ rating: string; ownerId: string | null; mitigation: string; status: string }[]} risks
 * @property {boolean} risksReviewed
 * @property {{ severity: string; status: string; acceptedUntil: string | null }[]} findings
 * @property {{ total: number; open: number; deferred: number }} items      in-scope work items of the project
 * @property {boolean} deferralApproved
 * @property {{ name: string; verified: boolean }[]} environments
 * @property {Record<string, { total: number; pass: number; fail: number; blocked: number; waived: number; notRun: number }>} tests
 * @property {Record<string, number>} openBugs       open bugs by priority
 * @property {{ exists: boolean; approved: boolean } } change
 * @property {Record<string, unknown> | null} deployment
 * @property {string} today                          YYYY-MM-DD (for risk acceptances' expiry)
 */
/**
 * @typedef {Object} GateResult
 * @property {string} label
 * @property {boolean} ok
 * @property {string} [missing]  what's needed, in words, when not ok
 */

/**
 * Each exit criterion of a stage, met or not.
 * @param {Stage} stage
 * @param {GateFacts} f
 * @returns {GateResult[]}
 */
export function evaluateGate(stage, f) {
  return stage.exit.map((c) => {
    const r = check(c, f);
    return r === true ? { label: c.label, ok: true } : { label: c.label, ok: false, missing: r };
  });
}
/** @param {Criterion} c @param {GateFacts} f @returns {true | string} */
function check(c, f) {
  const doc = (/** @type {string | undefined} */ k) => f.deliverables.find((d) => d.key === k);
  switch (c.kind) {
    case "checklist":
      return f.checklist.has(/** @type {string} */ (c.key)) || `Tick "${c.label}"`;
    case "deliverable":
      return doc(c.key) ? true : `Attach the ${c.label.replace(/ attached$/i, "")}`;
    case "linked": {
      const d = doc(c.from);
      if (!d) return `Attach the ${String(c.from).toUpperCase()} first`;
      return d.linkedTo === c.to || `Link the ${String(c.from).toUpperCase()} to the signed ${String(c.to).toUpperCase()}`;
    }
    case "signoffs": {
      const s = f.signoffs;
      if (!s || !s.required) return "Request the sign-offs";
      if (s.declined) return "A signatory declined: revise and request sign-off again";
      if (s.approved >= s.required) return true;
      return s.pending.length ? `Waiting for ${s.pending.join(", ")} to sign` : "Request the sign-offs";
    }
    case "pcn_complete":
      if (!f.pcn.exists) return "Write the Project Concept Note";
      return f.pcn.missing.length ? `Complete the Concept Note: ${f.pcn.missing.join(", ")}` : true;
    case "risk_register":
      return f.risks.length ? true : "Add at least one risk to the register";
    case "risks_mitigated": {
      const levels = c.severities?.length ? c.severities : ["High", "Critical"];
      const bad = f.risks.filter((r) => r.status === "open" && levels.includes(r.rating) && (!r.ownerId || !r.mitigation.trim()));
      return bad.length ? `${bad.length} ${levels.join("/")} risk${bad.length === 1 ? "" : "s"} need${bad.length === 1 ? "s" : ""} an owner and a mitigation` : true;
    }
    case "work_items_done": {
      const open = f.items.open - (c.allowDeferredWithApproval && f.deferralApproved ? f.items.deferred : 0);
      return open > 0 ? `${open} work item${open === 1 ? " is" : "s are"} not Done${c.allowDeferredWithApproval ? " (or deferred with approval)" : ""}` : true;
    }
    case "environments": {
      const need = c.required ?? [];
      const missing = need.filter((n) => !f.environments.some((e) => e.name.toLowerCase() === n.toLowerCase() && e.verified));
      return missing.length ? `Provision and verify: ${missing.join(", ")}` : true;
    }
    case "security_clear": {
      const blocking = c.blocking?.length ? c.blocking : ["Critical", "High"];
      const open = f.findings.filter((x) => blocking.includes(x.severity) && (x.status === "open" || (x.status === "accepted" && (!x.acceptedUntil || x.acceptedUntil < f.today))));
      return open.length ? `${open.length} open ${blocking.join("/")} security finding${open.length === 1 ? "" : "s"} (fix, or have a Manager accept the risk)` : true;
    }
    case "test_pass_rate": {
      const suite = c.suite ?? "QAT";
      const t = f.tests[suite];
      if (!t || !t.total) return `Add ${suite} test cases and run them`;
      if (t.notRun) return `${t.notRun} ${suite} test${t.notRun === 1 ? " hasn't" : "s haven't"} been run`;
      const counted = t.total - (t.waived ?? 0);
      const rate = counted ? t.pass / counted : 1;
      return rate + 1e-9 >= (c.min ?? 0.95) ? true : `${suite} pass rate is ${Math.floor(rate * 100 + 1e-9)}%: at least ${Math.round((c.min ?? 0.95) * 100)}% is needed`;
    }
    case "no_open_bugs": {
      const ps = c.priorities?.length ? c.priorities : ["Critical", "High"];
      const n = ps.reduce((a, p) => a + (f.openBugs[p] ?? 0), 0);
      return n ? `${n} open ${ps.join("/")} bug${n === 1 ? "" : "s"}` : true;
    }
    case "change_approved":
      if (!f.change.exists) return "Raise the change request";
      return f.change.approved || "The change request isn't approved yet";
    case "deployment_recorded": {
      const d = f.deployment ?? {};
      const missing = [["plan", "deployment plan"], ["rollbackPlan", "rollback plan"], ["scheduledAt", "date and time"], ["approver", "approver"]].filter(([k]) => !String(d[k] ?? "").trim()).map(([, l]) => l);
      return missing.length ? `Record the ${missing.join(", ")}` : true;
    }
  }
  return "Unknown criterion";
}
/** @param {GateResult[]} results */
export const gateMet = (results) => results.every((r) => r.ok);

// ---------- moves ----------
/**
 * @typedef {Object} Mover
 * @property {string} id
 * @property {string} role        their role in the project's workspace
 * @property {boolean} isLead     they lead the project
 * @property {boolean} isOwner    they are the stage's named owner
 */
/** @param {Actor[]} list @param {Mover} who */
export function isActor(list, who) {
  return list.some((a) => (a === "lead" ? who.isLead : a === "stageOwner" ? who.isOwner : a === who.role));
}
/**
 * Why a move can't be made, or null. Gates are checked separately (evaluateGate).
 * @param {TemplateDefinition} def
 * @param {string} from
 * @param {"advance" | "send_back" | "skip"} kind
 * @param {string | null} to
 * @param {Mover} who
 * @param {string} [reason]
 * @returns {string | null}
 */
export function transitionProblem(def, from, kind, to, who, reason = "") {
  const stage = stageOf(def, from);
  if (!stage) return "The project's stage isn't in its lifecycle";
  if (kind === "advance") {
    if (!isActor(def.settings.advanceBy, who)) return "Only the project lead, a Manager or an Administrator can advance the stage";
    if (stage.type === "approval" && stage.signoff) return null; // sign-offs advance it; advancing by hand still needs the gate
    return nextStage(def, from) ? null : "This is the last stage: close the project";
  }
  if (kind === "send_back") {
    if (!isActor(def.settings.sendBackBy, who)) return "Only the project lead, a Manager or an Administrator can send a project back";
    if (!to || !stage.transitions.sendBackTo.includes(to)) return `${stage.name} can't send a project back to that stage`;
    if (reason.trim().length < 3) return "Say why it's going back";
    return null;
  }
  // A skip: requested by anyone who may advance; approved by skipApprovedBy (never the person who asked).
  if (!stage.transitions.canSkip) return `${stage.name} can't be skipped`;
  if (reason.trim().length < 3) return "Give a justification for skipping";
  return null;
}

// ---------- sign-offs ----------
/**
 * The people who sign a stage this round. `pcnSigners` are the Concept Note's own (for source "pcn_signatories").
 * `byRole` lists active members by role. Whoever submitted can't sign when selfSignoff is off: their alternate does.
 * @param {Stage} stage
 * @param {TemplateSettings} settings
 * @param {{ submittedBy: string | null; pcnSigners: { userId?: string; name: string }[]; byRole: Record<string, { id: string; name: string }[]>; active?: Set<string> }} o  active: the people who can sign
 *   (active members); a named signatory who isn't one is replaced by their alternate
 * @returns {{ signerId: string; signerName: string; label: string }[]}
 */
export function resolveSigners(stage, settings, o) {
  if (!stage.signoff) return [];
  /** @type {{ signerId: string; signerName: string; label: string }[]} */ const out = [];
  const add = (/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ label) => {
    if (!out.some((s) => s.signerId === id)) out.push({ signerId: id, signerName: name, label });
  };
  const barred = (/** @type {string} */ id) => (!settings.selfSignoff && id === o.submittedBy) || (!!o.active && !o.active.has(id));
  if (stage.signoff.source === "pcn_signatories") for (const s of o.pcnSigners) if (s.userId) add(s.userId, s.name, "Concept Note signatory");
  for (const s of stage.signoff.signatories ?? []) {
    if (s.kind === "user" && s.userId) {
      if (!barred(s.userId)) add(s.userId, s.name ?? s.userId, s.label);
      else if (s.alternate && !barred(s.alternate.userId)) add(s.alternate.userId, s.alternate.name, `${s.label} (for ${s.name})`);
    } else if (s.kind === "role" && s.role) {
      const who = (o.byRole[s.role] ?? []).find((p) => !barred(p.id) && !out.some((x) => x.signerId === p.id));
      if (who) add(who.id, who.name, s.label);
    }
  }
  return out;
}

// ---------- registers ----------
/** A risk's rating from likelihood × impact (1–5 each). @param {number} likelihood @param {number} impact */
export function riskRating(likelihood, impact) {
  const score = likelihood * impact;
  return score >= 20 ? "Critical" : score >= 12 ? "High" : score >= 6 ? "Medium" : "Low";
}
/**
 * A suite's results from its cases' latest runs.
 * @param {{ id: string; suite: string }[]} cases
 * @param {{ caseId: string; result: "pass" | "fail" | "blocked" | "waived"; at: string }[]} runs
 */
export function testSummary(cases, runs) {
  /** @type {Map<string, { result: string; at: string }>} */ const latest = new Map();
  // (A waived test is set aside: it counts neither for nor against the pass rate.)
  for (const r of runs) {
    const was = latest.get(r.caseId);
    if (!was || r.at >= was.at) latest.set(r.caseId, r);
  }
  /** @type {Record<string, { total: number; pass: number; fail: number; blocked: number; waived: number; notRun: number }>} */ const out = {};
  for (const c of cases) {
    const s = (out[c.suite] ??= { total: 0, pass: 0, fail: 0, blocked: 0, waived: 0, notRun: 0 });
    s.total++;
    const r = latest.get(c.id)?.result;
    if (r === "pass") s.pass++;
    else if (r === "fail") s.fail++;
    else if (r === "blocked") s.blocked++;
    else if (r === "waived") s.waived++;
    else s.notRun++;
  }
  return out;
}

// ---------- time and progress ----------
/**
 * A stage's SLA: when it's due (its target in business days on the organisation's calendar), and whether it's
 * running, at risk (80% used), or overdue. Null without a target.
 * @param {string} enteredAt
 * @param {number | null} targetDays
 * @param {number} now
 * @param {WorkCalendar} cal
 * @returns {{ dueAt: string; usedDays: number; state: "running" | "warning" | "overdue" } | null}
 */
export function stageSla(enteredAt, targetDays, now, cal) {
  if (!targetDays) return null;
  const dayMinutes = Math.max(60, minutesOf(cal.end) - minutesOf(cal.start));
  const start = Date.parse(enteredAt);
  const used = workingMinutes(start, now, cal);
  const target = targetDays * dayMinutes;
  const state = used > target ? "overdue" : used >= target * 0.8 ? "warning" : "running";
  return { dueAt: new Date(addWorkingMinutes(start, target, cal)).toISOString(), usedDays: Math.round((used / dayMinutes) * 10) / 10, state };
}
const minutesOf = (/** @type {string} */ hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/**
 * Progress from the lifecycle (the weights of the stages before the current one, half of the current) blended with
 * work-item completion. Closed is 100.
 * @param {TemplateDefinition} def
 * @param {string} code
 * @param {boolean} closed
 * @param {number | null} itemsDone  0–1, or null when the project has no work items
 */
export function lifecycleProgress(def, code, closed, itemsDone) {
  if (closed) return 100;
  const total = def.stages.reduce((a, s) => a + s.weight, 0) || def.stages.length;
  const i = Math.max(0, stageIndex(def, code));
  const w = (/** @type {Stage} */ s) => (total === def.stages.length && !s.weight ? 1 : s.weight);
  const before = def.stages.slice(0, i).reduce((a, s) => a + w(s), 0) + w(def.stages[i]) / 2;
  const life = (before / total) * 100;
  if (itemsDone == null) return Math.round(life);
  const lw = def.settings.progress.lifecycleWeight;
  return Math.round(life * lw + itemsDone * 100 * (1 - lw));
}

// ---------- the stage mapping for existing projects (migration 0026; tests/lifecycle.test.js) ----------
/**
 * Where an existing project starts, from its status and its Concept Note. Null when the rules can't say (flagged
 * for a person); `fix` changes the project's status where it plainly contradicts its dates (a finished project still
 * marked Testing).
 * @param {{ status: string; progress: number; finishedAt?: string; pcn?: { signatories: { status: string }[] } }} p
 * @returns {{ stage: string | null; closed: boolean; why: string; fix?: { status: string } }}
 */
export function mapExistingProject(p) {
  const sig = p.pcn?.signatories ?? [];
  const approved = sig.filter((s) => s.status === "APPROVED").length;
  switch (p.status) {
    case "IDEA":
      if (!p.pcn || !sig.length) return { stage: "PCN_DRAFT", closed: false, why: p.pcn ? "Concept Note started, no signatories yet" : "Idea, no Concept Note yet" };
      if (sig.some((s) => s.status === "DECLINED")) return { stage: "PCN_DRAFT", closed: false, why: "Concept Note declined" };
      if (approved < sig.length) return { stage: "PCN_SIGNOFF", closed: false, why: `Concept Note waiting for signatures (${approved}/${sig.length})` };
      return { stage: "DISCOVERY", closed: false, why: "Concept Note fully signed" };
    case "UPCOMING":
      if (p.pcn && sig.length && approved === sig.length) return { stage: "DISCOVERY", closed: false, why: "Concept Note signed, not started" };
      return { stage: "PCN_DRAFT", closed: false, why: "Upcoming without a Concept Note: it starts with one" };
    case "WIP":
      return { stage: "DEV", closed: false, why: "In progress" };
    case "TESTING":
      if (p.finishedAt && p.progress >= 100) return { stage: "CLOSE", closed: true, why: "Marked Testing but delivered at 100%: closed, status corrected to Live", fix: { status: "LIVE" } };
      return { stage: "QAT", closed: false, why: "Testing" };
    case "TO_DEPLOY":
      return { stage: "DEPLOY", closed: false, why: "Ready to deploy" };
    case "LIVE":
    case "COMPLETED":
      return { stage: "CLOSE", closed: true, why: p.status === "LIVE" ? "Live" : "Completed" };
  }
  return { stage: null, closed: false, why: `Unknown status ${p.status}` };
}
