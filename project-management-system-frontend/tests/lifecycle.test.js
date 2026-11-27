// Project lifecycle rules (src/data/lifecycle.js) with the standard and Omnicontact templates
// (src/data/lifecycleTemplates.js): templates, gates, moves, sign-offs, SLAs in business hours, progress and the
// mapping of existing projects.
import { describe, expect, it } from "vitest";
import {
  cleanTemplate,
  evaluateGate,
  gateMet,
  lifecycleProgress,
  mapExistingProject,
  nextStage,
  resolveSigners,
  riskRating,
  stageOf,
  stageSla,
  testSummary,
  transitionProblem,
} from "../src/data/lifecycle.js";
import { STANDARD_LIFECYCLE, omnicontactLifecycle } from "../src/data/lifecycleTemplates.js";

const def = cleanTemplate(omnicontactLifecycle());
const stage = (/** @type {string} */ c) => /** @type {import("../src/data/lifecycle.js").Stage} */ (stageOf(def, c));
/** @returns {import("../src/data/lifecycle.js").GateFacts} */
const facts = (over = {}) => ({
  checklist: new Set(),
  deliverables: [],
  signoffs: null,
  pcn: { exists: true, missing: [] },
  risks: [],
  risksReviewed: false,
  findings: [],
  items: { total: 0, open: 0, deferred: 0 },
  deferralApproved: false,
  environments: [],
  tests: {},
  openBugs: {},
  change: { exists: false, approved: false },
  deployment: null,
  today: "2026-11-27",
  ...over,
});
const lead = { id: "tino", role: "developer", isLead: true, isOwner: false };
const dev = { id: "paul", role: "developer", isLead: false, isOwner: false };

describe("templates", () => {
  it("Omnicontact's: 16 stages in six phases, weights summing to 100", () => {
    expect(def.stages.map((s) => s.code)).toEqual(["PCN_DRAFT", "RISK", "PCN_SIGNOFF", "DISCOVERY", "BRS_DRAFT", "BRS_SIGNOFF", "BSS_DRAFT", "BSS_SIGNOFF", "DEV", "SERVERS", "SECURITY", "QAT", "UAT", "DEPLOY", "POST_DEPLOY", "CLOSE"]);
    expect(def.phases.map((p) => p.name)).toEqual(["Initiation", "Requirements and Design", "Build", "Assurance", "Release", "Closure"]);
    expect(def.stages.reduce((a, s) => a + s.weight, 0)).toBe(100);
    expect(cleanTemplate(STANDARD_LIFECYCLE).stages).toHaveLength(16);
  });

  it("refuses a lifecycle that can't work", () => {
    const base = omnicontactLifecycle();
    const bad = (/** @type {(d: any) => void} */ f) => {
      const d = structuredClone(base);
      f(d);
      return () => cleanTemplate(d);
    };
    expect(bad((d) => (d.stages = []))).toThrow(/1 to 40 stages/);
    expect(bad((d) => (d.stages[1].code = "PCN_DRAFT"))).toThrow(/same code/);
    expect(bad((d) => (d.stages[1].transitions.sendBackTo = ["DEV"]))).toThrow(/earlier stage/);
    expect(bad((d) => (d.stages[5].signoff.signatories = []))).toThrow(/at least one signatory/);
    expect(bad((d) => (d.stages[0].exit = [{ kind: "teleport" }]))).toThrow(/unknown exit criterion/);
    expect(bad((d) => (d.stages[0].phase = "F"))).toThrow(/earlier phase/);
    expect(bad((d) => (d.stages[0].targetDays = 0))).toThrow(/1 to 365/);
  });
});

describe("gates", () => {
  it("no advancing without the exit criteria: each missing thing is named", () => {
    const r = evaluateGate(stage("DISCOVERY"), facts({ checklist: new Set(["current_state", "integrations"]) }));
    expect(gateMet(r)).toBe(false);
    expect(r.filter((x) => !x.ok).map((x) => x.missing)).toEqual(["Attach the Discovery notes", 'Tick "Constraints recorded"', 'Tick "Feasibility confirmed"']);
    const ok = evaluateGate(stage("DISCOVERY"), facts({ checklist: new Set(["current_state", "integrations", "constraints", "feasibility"]), deliverables: [{ key: "discovery_notes", version: 1, locked: false }] }));
    expect(gateMet(ok)).toBe(true);
  });

  it("the Concept Note must be complete", () => {
    expect(evaluateGate(stage("PCN_DRAFT"), facts({ pcn: { exists: true, missing: ["Objectives"] } }))[0].missing).toBe("Complete the Concept Note: Objectives");
    expect(gateMet(evaluateGate(stage("PCN_DRAFT"), facts()))).toBe(true);
  });

  it("High/Critical risks need an owner and a mitigation", () => {
    const risks = [
      { rating: "Critical", ownerId: "tino", mitigation: "", status: "open" },
      { rating: "Low", ownerId: null, mitigation: "", status: "open" },
    ];
    const r = evaluateGate(stage("RISK"), facts({ risks, checklist: new Set(["reviewed"]) }));
    expect(r.find((x) => !x.ok)?.missing).toBe("1 High/Critical risk needs an owner and a mitigation");
    risks[0].mitigation = "Second supplier";
    expect(gateMet(evaluateGate(stage("RISK"), facts({ risks, checklist: new Set(["reviewed"]) })))).toBe(true);
    expect(riskRating(5, 4)).toBe("Critical");
    expect(riskRating(3, 4)).toBe("High");
    expect(riskRating(2, 3)).toBe("Medium");
    expect(riskRating(1, 5)).toBe("Low");
  });

  it("QAT: the pass rate threshold (95%), every case run, no open Critical/High bugs", () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, suite: "QAT" }));
    const runs = cases.map((c, i) => ({ caseId: c.id, result: /** @type {"pass" | "fail"} */ (i < 18 ? "pass" : "fail"), at: "2026-11-20" }));
    let tests = testSummary(cases, runs);
    expect(tests.QAT).toEqual({ total: 20, pass: 18, fail: 2, blocked: 0, notRun: 0 });
    expect(evaluateGate(stage("QAT"), facts({ tests }))[0].missing).toBe("QAT pass rate is 90%: at least 95% is needed");
    // A later run of a failed case counts, not the first.
    tests = testSummary(cases, [...runs, { caseId: "c18", result: "pass", at: "2026-11-21" }]);
    expect(evaluateGate(stage("QAT"), facts({ tests }))[0].ok).toBe(true); // 19/20 = 95%
    expect(evaluateGate(stage("QAT"), facts({ tests, openBugs: { High: 1 } }))[1].missing).toBe("1 open Critical/High bug");
    expect(evaluateGate(stage("QAT"), facts({ tests: testSummary([...cases, { id: "new", suite: "QAT" }], runs) }))[0].missing).toBe("1 QAT test hasn't been run");
  });

  it("unresolved security findings block QAT; a Manager's risk acceptance holds until it expires", () => {
    const tests = { QAT: { total: 1, pass: 1, fail: 0, blocked: 0, notRun: 0 } };
    const open = [{ severity: "High", status: "open", acceptedUntil: null }];
    expect(gateMet(evaluateGate(stage("QAT"), facts({ tests, findings: open })))).toBe(false);
    expect(gateMet(evaluateGate(stage("SECURITY"), facts({ findings: open })))).toBe(false);
    const accepted = [{ severity: "High", status: "accepted", acceptedUntil: "2026-12-31" }];
    expect(gateMet(evaluateGate(stage("QAT"), facts({ tests, findings: accepted })))).toBe(true);
    expect(gateMet(evaluateGate(stage("QAT"), facts({ tests, findings: accepted, today: "2027-01-01" })))).toBe(false);
    expect(gateMet(evaluateGate(stage("SECURITY"), facts({ findings: [{ severity: "Medium", status: "open", acceptedUntil: null }] })))).toBe(true);
  });

  it("environments, work items (with approved deferrals), change and deployment record", () => {
    const envs = ["Dev", "QA", "UAT"].map((name) => ({ name, verified: true }));
    expect(evaluateGate(stage("SERVERS"), facts({ environments: envs }))[0].missing).toBe("Provision and verify: Prod");
    expect(evaluateGate(stage("DEV"), facts({ items: { total: 10, open: 2, deferred: 2 } }))[0].ok).toBe(false);
    expect(evaluateGate(stage("DEV"), facts({ items: { total: 10, open: 2, deferred: 2 }, deferralApproved: true }))[0].ok).toBe(true);
    const d = evaluateGate(stage("DEPLOY"), facts({ change: { exists: true, approved: false }, deployment: { plan: "x", rollbackPlan: "", scheduledAt: "2026-12-01T18:00", approver: "Waraidzo" } }));
    expect(d.map((x) => x.missing)).toEqual(["The change request isn't approved yet", "Record the rollback plan"]);
  });

  it("a sign-off gate waits for every signatory; a decline stops it", () => {
    expect(evaluateGate(stage("BRS_SIGNOFF"), facts({ signoffs: { required: 2, approved: 1, declined: 0, pending: ["Waraidzo"] } }))[0].missing).toBe("Waiting for Waraidzo to sign");
    expect(evaluateGate(stage("BRS_SIGNOFF"), facts({ signoffs: { required: 2, approved: 1, declined: 1, pending: [] } }))[0].missing).toMatch(/declined/);
    expect(gateMet(evaluateGate(stage("BRS_SIGNOFF"), facts({ signoffs: { required: 2, approved: 2, declined: 0, pending: [] } })))).toBe(true);
  });
});

describe("moves", () => {
  it("advance: the lead, Managers and Administrators; not a developer", () => {
    expect(transitionProblem(def, "DEV", "advance", null, lead)).toBeNull();
    expect(transitionProblem(def, "DEV", "advance", null, { ...dev, role: "manager" })).toBeNull();
    expect(transitionProblem(def, "DEV", "advance", null, dev)).toMatch(/Only the project lead/);
    expect(nextStage(def, "DEV")?.code).toBe("SERVERS");
  });

  it("a send-back goes only to a named earlier stage, with a reason", () => {
    expect(transitionProblem(def, "UAT", "send_back", "DEV", lead, "Login fails on Safari")).toBeNull();
    expect(transitionProblem(def, "UAT", "send_back", "DEV", lead, "")).toBe("Say why it's going back");
    expect(transitionProblem(def, "UAT", "send_back", "BRS_DRAFT", lead, "Rethink")).toMatch(/can't send a project back/);
    // A decline at a sign-off returns to the stage the template names.
    expect(stage("BRS_SIGNOFF").signoff?.onDecline).toBe("BRS_DRAFT");
    expect(stage("PCN_SIGNOFF").signoff?.onDecline).toBe("PCN_DRAFT");
    expect(stage("UAT").signoff?.onDecline).toBe("DEV");
  });

  it("a skip only where allowed, with a justification (approved separately by a Manager/Admin)", () => {
    expect(transitionProblem(def, "SERVERS", "skip", null, lead, "Hosted by the client")).toBeNull();
    expect(transitionProblem(def, "SERVERS", "skip", null, lead, "")).toMatch(/justification/);
    expect(transitionProblem(def, "SECURITY", "skip", null, lead, "No time")).toMatch(/can't be skipped/);
    expect(def.settings.skipApprovedBy).toEqual(["manager", "admin"]);
  });
});

describe("sign-offs", () => {
  const byRole = { manager: [{ id: "waraidzo", name: "Waraidzo" }], admin: [{ id: "mutsa", name: "Mutsa" }, { id: "admin", name: "Admin" }] };
  it("named signatories, and segregation of duties: whoever submitted can't sign, their alternate does", () => {
    const signers = (/** @type {string | null} */ by) => resolveSigners(stage("BRS_SIGNOFF"), def.settings, { submittedBy: by, pcnSigners: [], byRole }).map((s) => s.signerId);
    expect(signers("tino")).toEqual(["waraidzo", "mutsa"]);
    expect(signers("mutsa")).toEqual(["waraidzo", "admin"]);
    // With self sign-off allowed, the submitter signs as named.
    expect(resolveSigners(stage("BRS_SIGNOFF"), { ...def.settings, selfSignoff: true }, { submittedBy: "mutsa", pcnSigners: [], byRole }).map((s) => s.signerId)).toEqual(["waraidzo", "mutsa"]);
  });
  it("a named signatory who isn't an active member is replaced by their alternate", () => {
    const active = new Set(["mutsa", "admin"]);
    expect(resolveSigners(stage("BRS_SIGNOFF"), def.settings, { submittedBy: "tino", pcnSigners: [], byRole, active }).map((s) => s.signerId)).toEqual(["mutsa"]);
    expect(resolveSigners(stage("UAT"), def.settings, { submittedBy: "tino", pcnSigners: [], byRole, active }).map((s) => [s.signerId, s.label])).toEqual([["mutsa", "Business owner (for Waraidzo)"]]);
  });
  it("PCN Sign Off uses the Concept Note's own signatories; role signatories pick an active member", () => {
    expect(resolveSigners(stage("PCN_SIGNOFF"), def.settings, { submittedBy: "tino", pcnSigners: [{ userId: "waraidzo", name: "Waraidzo" }], byRole }).map((s) => s.signerId)).toEqual(["waraidzo"]);
    const std = cleanTemplate(STANDARD_LIFECYCLE);
    const s = resolveSigners(/** @type {any} */ (stageOf(std, "BRS_SIGNOFF")), std.settings, { submittedBy: "mutsa", pcnSigners: [], byRole });
    expect(s.map((x) => x.signerId)).toEqual(["waraidzo", "admin"]);
  });
});

describe("time and progress", () => {
  // Harare, Mon–Fri 08:00–17:00 (UTC+2), Friday 28 Nov 2026 a working day; 1 Dec a holiday for the test.
  const cal = { timeZone: "Africa/Harare", workDays: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", holidays: new Set(["2026-12-01"]) };
  it("SLA timing counts business hours, skipping weekends and holidays", () => {
    // Entered Thursday 26 Nov 09:00 Harare, target 3 business days: Thu, Fri, Mon (Tue 1 Dec is a holiday) → due Wed 09:00.
    const entered = "2026-11-26T07:00:00.000Z";
    const sla = /** @type {NonNullable<ReturnType<typeof stageSla>>} */ (stageSla(entered, 3, Date.parse("2026-11-27T15:00:00.000Z"), cal));
    expect(sla.dueAt).toBe("2026-12-02T07:00:00.000Z");
    expect(sla.state).toBe("running");
    expect(sla.usedDays).toBe(1.9); // Thu 8 h + Fri 9 h = 17 h of 9-hour days
    // The weekend doesn't count: Saturday evening is still under 2 days used.
    expect(stageSla(entered, 3, Date.parse("2026-11-28T18:00:00.000Z"), cal)?.usedDays).toBe(1.9);
    expect(stageSla(entered, 3, Date.parse("2026-12-02T08:00:00.000Z"), cal)?.state).toBe("overdue");
    expect(stageSla(entered, null, Date.now(), cal)).toBeNull();
  });
  it("progress blends the lifecycle position with work items", () => {
    expect(lifecycleProgress(def, "PCN_DRAFT", false, null)).toBe(1);
    expect(lifecycleProgress(def, "DEV", false, null)).toBe(42); // 27 before + 15 (half of 30)
    expect(lifecycleProgress(def, "DEV", false, 0.5)).toBe(45); // 42 × 0.6 + 50 × 0.4
    expect(lifecycleProgress(def, "CLOSE", true, null)).toBe(100);
  });
});

describe("mapping existing projects", () => {
  const sig = (/** @type {string[]} */ ...s) => ({ signatories: s.map((status) => ({ status })) });
  it.each([
    [{ status: "IDEA", progress: 0 }, "PCN_DRAFT", false],
    [{ status: "IDEA", progress: 0, pcn: sig() }, "PCN_DRAFT", false],
    [{ status: "IDEA", progress: 0, pcn: sig("PENDING") }, "PCN_SIGNOFF", false],
    [{ status: "IDEA", progress: 0, pcn: sig("DECLINED") }, "PCN_DRAFT", false],
    [{ status: "UPCOMING", progress: 0, pcn: sig("APPROVED") }, "DISCOVERY", false],
    [{ status: "UPCOMING", progress: 5 }, "PCN_DRAFT", false],
    [{ status: "WIP", progress: 40 }, "DEV", false],
    [{ status: "TESTING", progress: 88 }, "QAT", false],
    [{ status: "TO_DEPLOY", progress: 97 }, "DEPLOY", false],
    [{ status: "LIVE", progress: 100, finishedAt: "2026-01-01" }, "CLOSE", true],
    [{ status: "COMPLETED", progress: 100, finishedAt: "2026-01-01" }, "CLOSE", true],
  ])("%o → %s", (p, stage, closed) => {
    const m = mapExistingProject(p);
    expect([m.stage, m.closed]).toEqual([stage, closed]);
  });
  it("a finished project still marked Testing is closed, with its status corrected to Live", () => {
    expect(mapExistingProject({ status: "TESTING", progress: 100, finishedAt: "2026-10-01" })).toMatchObject({ stage: "CLOSE", closed: true, fix: { status: "LIVE" } });
  });
  it("an unknown status is flagged, never guessed", () => {
    expect(mapExistingProject({ status: "ON_HOLD", progress: 0 }).stage).toBeNull();
  });
});
