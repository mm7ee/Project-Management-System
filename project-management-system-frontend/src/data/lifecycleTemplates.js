// The standard 16-stage project lifecycle (docs/lifecycle-plan.md, part 2). STANDARD_LIFECYCLE signs off by role,
// for any organisation to start from; omnicontactLifecycle() names Omnicontact's signatories (proposed, for its
// approval: they are ordinary template data, changed in Settings → Project Lifecycle). Migration 0026 is generated
// from omnicontactLifecycle() by scripts/lifecycle-migration.mjs.

/** @typedef {import("./lifecycle").Signatory} Signatory */

/**
 * @param {Record<string, Signatory[]>} signers  BRS_SIGNOFF, BSS_SIGNOFF, UAT, CLOSE
 */
function lifecycle(signers) {
  return {
    settings: {
      selfSignoff: false,
      advanceBy: ["lead", "manager", "admin", "stageOwner"],
      sendBackBy: ["lead", "manager", "admin"],
      skipApprovedBy: ["manager", "admin"],
      signoffReminderDays: 2,
      overdueEscalateTo: ["manager"],
      progress: { lifecycleWeight: 0.6 },
      onClose: { status: "LIVE" },
    },
    phases: [
      { code: "A", name: "Initiation" },
      { code: "B", name: "Requirements and Design" },
      { code: "C", name: "Build" },
      { code: "D", name: "Assurance" },
      { code: "E", name: "Release" },
      { code: "F", name: "Closure" },
    ],
    stages: [
      {
        code: "PCN_DRAFT", name: "PCN Draft", phase: "A", type: "draft", responsible: ["lead"], targetDays: 5, weight: 2,
        exit: [{ kind: "pcn_complete", label: "Project Concept Note complete" }],
        deliverables: [{ key: "pcn", name: "Project Concept Note", source: "pcn" }],
        transitions: { sendBackTo: [], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["remind:responsible", "escalate:manager"] },
      },
      {
        code: "RISK", name: "Risk Assessment", phase: "A", type: "assessment", responsible: ["lead", "manager"], targetDays: 3, weight: 2,
        exit: [
          { kind: "risk_register", label: "Risk register has at least one entry" },
          { kind: "checklist", key: "reviewed", label: "Assessment reviewed", by: ["manager", "admin"] },
          { kind: "risks_mitigated", severities: ["High", "Critical"], label: "Every High/Critical risk has an owner and a mitigation" },
        ],
        deliverables: [{ key: "risk_register", name: "Risk register", source: "risk_register" }],
        transitions: { sendBackTo: ["PCN_DRAFT"], canSkip: true },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "PCN_SIGNOFF", name: "PCN Sign Off", phase: "A", type: "approval", responsible: ["lead"], targetDays: 5, weight: 2,
        signoff: { source: "pcn_signatories", signatories: [], onDecline: "PCN_DRAFT", lockDeliverables: ["pcn"] },
        exit: [{ kind: "signoffs", label: "All Concept Note signatories approve" }],
        transitions: { sendBackTo: ["PCN_DRAFT"], canSkip: false },
        automation: { onEnter: ["request:signoffs"], onOverdue: ["remind:signatories", "escalate:manager"] },
      },
      {
        code: "DISCOVERY", name: "Technical Discovery", phase: "B", type: "work", responsible: ["team_lead", "developer"], targetDays: 10, weight: 5,
        exit: [
          { kind: "deliverable", key: "discovery_notes", label: "Discovery notes attached" },
          { kind: "checklist", key: "current_state", label: "Current-state analysis" },
          { kind: "checklist", key: "integrations", label: "Integrations identified" },
          { kind: "checklist", key: "constraints", label: "Constraints recorded" },
          { kind: "checklist", key: "feasibility", label: "Feasibility confirmed" },
        ],
        deliverables: [{ key: "discovery_notes", name: "Discovery notes", source: "document" }],
        transitions: { sendBackTo: ["PCN_DRAFT"], canSkip: true },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
        checklistAsWorkItems: true,
      },
      {
        code: "BRS_DRAFT", name: "BRS Draft", phase: "B", type: "draft", responsible: ["lead", "assistant"], targetDays: 10, weight: 5,
        exit: [{ kind: "deliverable", key: "brs", label: "Business Requirements Specification attached" }],
        deliverables: [{ key: "brs", name: "Business Requirements Specification (BRS)", source: "document", versioned: true }],
        transitions: { sendBackTo: ["DISCOVERY"], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "BRS_SIGNOFF", name: "BRS Sign Off", phase: "B", type: "approval", responsible: ["lead"], targetDays: 5, weight: 3,
        signoff: { signatories: signers.BRS_SIGNOFF, onDecline: "BRS_DRAFT", lockDeliverables: ["brs"] },
        exit: [{ kind: "signoffs", label: "Business signatories approve the BRS version submitted" }],
        transitions: { sendBackTo: ["BRS_DRAFT"], canSkip: false },
        automation: { onEnter: ["request:signoffs"], onOverdue: ["remind:signatories", "escalate:manager"] },
      },
      {
        code: "BSS_DRAFT", name: "BSS Draft", phase: "B", type: "draft", responsible: ["team_lead"], targetDays: 10, weight: 5,
        exit: [
          { kind: "deliverable", key: "bss", label: "Business Solution Specification attached" },
          { kind: "linked", from: "bss", to: "brs", label: "BSS linked to the signed BRS" },
        ],
        deliverables: [{ key: "bss", name: "Business Solution Specification (BSS)", source: "document", versioned: true }],
        transitions: { sendBackTo: ["BRS_DRAFT", "DISCOVERY"], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "BSS_SIGNOFF", name: "BSS Sign Off", phase: "B", type: "approval", responsible: ["lead"], targetDays: 5, weight: 3,
        signoff: { signatories: signers.BSS_SIGNOFF, onDecline: "BSS_DRAFT", lockDeliverables: ["bss"] },
        exit: [{ kind: "signoffs", label: "Technical and business signatories approve the BSS version submitted" }],
        transitions: { sendBackTo: ["BSS_DRAFT"], canSkip: false },
        automation: { onEnter: ["request:signoffs"], onOverdue: ["remind:signatories", "escalate:manager"] },
      },
      {
        code: "DEV", name: "Dev Work", phase: "C", type: "work", responsible: ["team_lead", "developer"], targetDays: 40, weight: 30,
        exit: [{ kind: "work_items_done", allowDeferredWithApproval: true, label: "All in-scope work items Done (or deferred with approval)" }],
        transitions: { sendBackTo: ["BSS_DRAFT"], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "SERVERS", name: "Server Allocation and Provisioning", phase: "C", type: "work", responsible: ["team_lead"], targetDays: 5, weight: 4,
        exit: [{ kind: "environments", required: ["Dev", "QA", "UAT", "Prod"], label: "Dev, QA, UAT and Prod provisioned and verified" }],
        transitions: { sendBackTo: ["DEV"], canSkip: true },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "SECURITY", name: "Security Assessment", phase: "D", type: "assessment", responsible: ["team_lead"], targetDays: 5, weight: 4,
        exit: [{ kind: "security_clear", blocking: ["Critical", "High"], label: "No open Critical/High findings (or risk-accepted by a Manager)" }],
        transitions: { sendBackTo: ["DEV"], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "QAT", name: "QATs", phase: "D", type: "testing", responsible: ["assistant", "team_lead"], targetDays: 10, weight: 8,
        testing: { suite: "QAT", passThreshold: 0.95, failedCreatesBug: true },
        exit: [
          { kind: "test_pass_rate", suite: "QAT", min: 0.95, label: "QAT pass rate at least 95%" },
          { kind: "no_open_bugs", priorities: ["Critical", "High"], label: "No open Critical/High bugs" },
          { kind: "security_clear", blocking: ["Critical", "High"], label: "Security findings still resolved or accepted" },
        ],
        transitions: { sendBackTo: ["DEV"], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "UAT", name: "UATs", phase: "D", type: "testing", responsible: ["lead"], targetDays: 10, weight: 8,
        testing: { suite: "UAT", failedCreatesBug: true, onFailSendBackTo: "DEV" },
        signoff: { signatories: signers.UAT, onDecline: "DEV" },
        exit: [{ kind: "signoffs", label: "UAT sign-off from the business owner" }],
        transitions: { sendBackTo: ["DEV"], canSkip: false },
        automation: { onEnter: ["notify:responsible", "request:signoffs"], onOverdue: ["remind:signatories", "escalate:manager"] },
      },
      {
        code: "DEPLOY", name: "Deployment", phase: "E", type: "deployment", responsible: ["team_lead"], targetDays: 3, weight: 4,
        deployment: { createChangeRequest: true },
        exit: [
          { kind: "change_approved", label: "Change request approved" },
          { kind: "deployment_recorded", label: "Deployment plan, rollback plan, date/time and approver recorded" },
        ],
        transitions: { sendBackTo: ["UAT", "DEV"], canSkip: false },
        automation: { onEnter: ["create:change_request", "notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "POST_DEPLOY", name: "Post Deployment Testing", phase: "E", type: "testing", responsible: ["team_lead", "assistant"], targetDays: 2, weight: 3,
        testing: { suite: "SMOKE", passThreshold: 1, failedCreatesBug: false, onFailSendBackTo: "DEPLOY" },
        exit: [{ kind: "test_pass_rate", suite: "SMOKE", min: 1, label: "All production smoke checks pass" }],
        transitions: { sendBackTo: ["DEPLOY"], canSkip: false },
        automation: { onEnter: ["notify:responsible"], onOverdue: ["escalate:manager"] },
      },
      {
        code: "CLOSE", name: "Close Project", phase: "F", type: "closure", responsible: ["lead", "manager"], targetDays: 5, weight: 12,
        signoff: { signatories: signers.CLOSE, onDecline: "CLOSE" },
        exit: [
          { kind: "deliverable", key: "closure_report", label: "Closure report attached" },
          { kind: "checklist", key: "lessons", label: "Lessons learned recorded" },
          { kind: "checklist", key: "handover", label: "Handed over to support / maintenance" },
          { kind: "signoffs", label: "Final sign-off" },
        ],
        deliverables: [{ key: "closure_report", name: "Closure report", source: "document" }],
        transitions: { sendBackTo: ["POST_DEPLOY"], canSkip: false },
        automation: { onExit: ["set:status", "lock:deliverables", "stop:slas"], onOverdue: ["escalate:manager"] },
      },
    ],
  };
}

/** Sign-offs by role: for any organisation. */
export const STANDARD_LIFECYCLE = lifecycle({
  BRS_SIGNOFF: [{ kind: "role", role: "manager", label: "Business (Manager)" }, { kind: "role", role: "admin", label: "Systems" }],
  BSS_SIGNOFF: [{ kind: "role", role: "team_lead", label: "Technical" }, { kind: "role", role: "manager", label: "Business" }],
  UAT: [{ kind: "role", role: "manager", label: "Business owner" }],
  CLOSE: [{ kind: "role", role: "manager", label: "Final sign-off" }],
});
export const STANDARD_NAME = "Standard project lifecycle";

/** Omnicontact's, with its named signatories (proposed 2026-11-27; awaiting its approval). */
export function omnicontactLifecycle() {
  const waraidzo = { kind: /** @type {const} */ ("user"), userId: "waraidzo", name: "Waraidzo" };
  const mutsa = { kind: /** @type {const} */ ("user"), userId: "mutsa", name: "Mutsa" };
  const alt = (/** @type {string} */ id, /** @type {string} */ name) => ({ alternate: { userId: id, name } });
  return lifecycle({
    BRS_SIGNOFF: [{ ...waraidzo, label: "Business (Manager)", ...alt("mutsa", "Mutsa") }, { ...mutsa, label: "Systems", ...alt("admin", "Admin") }],
    BSS_SIGNOFF: [{ ...mutsa, label: "Technical", ...alt("admin", "Admin") }, { ...waraidzo, label: "Business", ...alt("mutsa", "Mutsa") }],
    UAT: [{ ...waraidzo, label: "Business owner", ...alt("mutsa", "Mutsa") }],
    CLOSE: [{ ...waraidzo, label: "Final sign-off", ...alt("mutsa", "Mutsa") }],
  });
}
export const OMNICONTACT_NAME = "Omnicontact Project Lifecycle";
