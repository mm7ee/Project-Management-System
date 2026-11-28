// Project documents (src/data/documentKits.js): the organisation's templates as kits; what's kept, what a new draft
// starts with, what must be filled before submitting, and the changelog built from release notes.
import { describe, expect, it } from "vitest";
import { CHANGE_REQUEST_FIELDS, KITS, changelog, cleanDoc, docId, docMissing, kitFor, newDoc } from "../src/data/documentKits.js";

const ctx = {
  project: "Edgars Selfcare",
  today: "2026-11-28",
  me: { name: "Thamani K.", title: "Business Analyst" },
  pcn: { background: "Customers queue to check balances.", concept: "A self-service portal.", objectives: "Cut queries by 40%." },
  doneItems: [
    { key: "ES-4", summary: "Balance enquiry", type: "STORY", component: "Accounts" },
    { key: "ES-9", summary: "PIN reset sends two SMSs", type: "BUG", component: "Notifications" },
  ],
  previous: null,
};

describe("document kits", () => {
  it("are the organisation's templates: BRS, BSS and release notes, tied to their deliverables", () => {
    expect(Object.keys(KITS)).toEqual(["brs", "bss", "release_notes"]);
    expect(kitFor("brs")?.short).toBe("BRS");
    expect(kitFor("bss")?.name).toBe("Business Solution Specification");
    expect(kitFor("discovery_notes")).toBeNull();
    // The Change Request form carries every field of the template, and the four the Deployment gate checks.
    const keys = CHANGE_REQUEST_FIELDS.flatMap((g) => g.fields.map((f) => f.key));
    expect(keys).toEqual(expect.arrayContaining(["requestedBy", "rfsNo", "changeType", "emergency", "priority", "risk", "impact", "approverTeamLeader", "approverOpsManager", "approverCcxo", "successful", "incidentNo", "plan", "rollbackPlan", "scheduledAt", "approver"]));
  });

  it("a new BRS starts from what PMS knows: the project, today, the author and the Concept Note", () => {
    const d = /** @type {any} */ (newDoc(KITS.brs, ctx));
    expect(d.control).toMatchObject({ title: "Edgars Selfcare", modifiedOn: "2026-11-28", confidentiality: "STRICTLY CONFIDENTIAL" });
    expect(d.introduction).toBe("Customers queue to check balances.");
    expect(d.summary).toBe("A self-service portal.");
    expect(d.objectives).toBe("Cut queries by 40%.");
    expect(d.contributors[0]).toMatchObject({ name: "Thamani K.", designation: "Business Analyst", role: "Author" });
    expect(d.functional).toHaveLength(1);
  });

  it("a new BSS carries the template's standard requirements, ready to edit", () => {
    const d = /** @type {any} */ (newDoc(KITS.bss, ctx));
    expect(d.functional[0].title).toBe("Authentication & User Management");
    expect(d.functional[0].items).toHaveLength(6);
    expect(d.performance.map((/** @type {any} */ r) => r.id)).toEqual(["NFRN-001", "NFRN-002", "NFRN-003", "NFRN-004"]);
    expect(d.audit.map((/** @type {any} */ r) => r.id)).toEqual(["SECN-012", "SECN-013", "SECN-014"]);
    expect(d.headers).toHaveLength(5);
    expect(d.scope).toContain("Edgars Selfcare");
  });

  it("release notes are prefilled with the work done since the last release", () => {
    const d = /** @type {any} */ (newDoc(KITS.release_notes, ctx));
    expect(d.fixes).toEqual([{ ticket: "ES-9", description: "PIN reset sends two SMSs", area: "Notifications" }]);
    expect(d.features).toEqual([{ name: "Balance enquiry", description: "" }]);
    expect(d.actions).toEqual(["None"]);
  });

  it("a new version of a document starts from the last one", () => {
    const v1 = /** @type {any} */ (newDoc(KITS.brs, ctx));
    v1.introduction = "Signed text";
    expect(/** @type {any} */ (newDoc(KITS.brs, { ...ctx, previous: v1 })).introduction).toBe("Signed text");
  });

  it("keeps only the kit's sections, as strings, within limits", () => {
    const d = /** @type {any} */ (cleanDoc(KITS.brs, { control: { title: 42, evil: "<script>" }, introduction: { not: "text" }, hacked: "x", integration: [{ useCase: "SSO", extra: 1 }] }));
    expect(d.control).toEqual({ title: "42", fileReference: "", modifiedOn: "", confidentiality: "" });
    expect(d.introduction).toBe("");
    expect(d.hacked).toBeUndefined();
    expect(d.integration).toEqual([{ useCase: "SSO", functionality: "", priority: "" }]);
    expect((/** @type {any} */ (cleanDoc(KITS.brs, { integration: Array.from({ length: 999 }, () => ({})) }))).integration).toHaveLength(300);
  });

  it("names what's still needed before a document can be submitted", () => {
    const d = /** @type {any} */ (newDoc(KITS.brs, { ...ctx, pcn: null }));
    expect(docMissing(KITS.brs, d)).toEqual(["1. Introduction", "2. Functional requirements: general requirements: at least one requirement"]);
    d.introduction = "Why";
    d.functional = [{ title: "Registration", items: [{ description: "Users register with a phone number", priority: "M" }] }];
    expect(docMissing(KITS.brs, d)).toEqual([]);
    expect(docMissing(KITS.release_notes, /** @type {any} */ (newDoc(KITS.release_notes, ctx)))).toEqual(["Release: Version (e.g. 1.2.0)", "Overview"]);
  });

  it("numbers requirements as the templates do", () => {
    expect(docId("FRN-", 0, 2)).toBe("FRN-01");
    expect(docId("FRN-", 2, 3)).toBe("FRN-003");
    expect(docId("FRN-01-", 1, 2)).toBe("FRN-01-02");
    expect(docId("IRN-", 9, 3)).toBe("IRN-010");
  });

  it("the changelog lists published releases newest first, in the template's headings", () => {
    const rel = (/** @type {number} */ v, /** @type {string} */ ver) => ({
      version: v,
      submittedAt: `2026-11-${10 + v}T10:00:00.000Z`,
      data: { release: { version: ver, releaseDate: "" }, overview: `Release ${ver}. More.`, features: [{ name: "Statements", description: "Monthly PDF" }], improvements: ["Faster"], fixes: [{ ticket: "ES-9", description: "Double SMS", area: "" }], deprecated: [], security: [] },
    });
    const log = changelog([rel(1, "1.0.0"), rel(2, "1.1.0"), { version: 3, submittedAt: null, data: {} }]);
    expect(log.map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(log[0]).toMatchObject({ date: "2026-11-12", summary: "Release 1.1.0.", added: ["Statements: Monthly PDF"], changed: ["Faster"], fixed: ["Double SMS (ES-9)"], security: [] });
  });
});
