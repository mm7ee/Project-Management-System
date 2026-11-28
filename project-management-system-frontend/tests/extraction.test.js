// Structured extraction (src/data/extraction.js) and task skills (src/data/skills.js): the model's JSON read whatever
// its wrapping, every row checked against its schema and against the document, a PMS-written BRS or BSS giving its
// requirements exactly, safe CSV, and skill prompts filled in with what's open.
import { describe, expect, it } from "vitest";
import { KITS, newDoc } from "../src/data/documentKits.js";
import { EXTRACTIONS, EXTRACTION_KINDS, groundRows, kitRequirements, parseExtraction, toCsv } from "../src/data/extraction.js";
import { BUILT_IN_SKILLS, SKILL_CONTEXTS, contextsAt, fillPrompt } from "../src/data/skills.js";

describe("reading an extraction", () => {
  it("a rows object, a bare array, inside a code block or with text around it", () => {
    expect(parseExtraction("milestones", '{"rows":[{"milestone":"Pilot","date":"2026-12-01"}]}').rows).toEqual([{ milestone: "Pilot", date: "2026-12-01" }]);
    expect(parseExtraction("milestones", 'Here you go:\n```json\n[{"milestone":"Go live"}]\n```').rows).toEqual([{ milestone: "Go live" }]);
    expect(parseExtraction("milestones", "Sorry, I can't.")).toMatchObject({ rows: [], unreadable: true });
  });
  it("every row passes the schema: wrong types, bad dates and out-of-range ratings are counted, not shown", () => {
    const r = parseExtraction(
      "risks",
      JSON.stringify({ rows: [{ risk: "Vendor late", likelihood: 4, impact: 5, extra: "dropped" }, { risk: "Bad rating", likelihood: 9 }, { likelihood: 2 }, "not a row", { risk: "Empty owner", owner: "" }] }),
    );
    expect(r.rows).toEqual([{ risk: "Vendor late", likelihood: 4, impact: 5 }, { risk: "Empty owner" }]);
    expect(r.rejected).toBe(3);
    expect(parseExtraction("actions", '[{"action":"Send it","due":"next week"}]').rejected).toBe(1);
  });
  it("keeps only rows found in the document, once each", () => {
    const doc = "Mia will send the revised plan to the client by Friday. Tom will fix the export bug.";
    const g = groundRows("actions", [{ action: "Mia will send the revised plan to the client" }, { action: "Tom will fix the export bug" }, { action: "tom will FIX the export bug." }, { action: "Book the launch party venue" }], doc);
    expect(g.rows.map((r) => r.action)).toEqual(["Mia will send the revised plan to the client", "Tom will fix the export bug"]);
    expect(g.ungrounded).toBe(1);
  });
  it("every kind has columns, a schema with its main field required, and instructions", () => {
    for (const k of EXTRACTION_KINDS) {
      const e = EXTRACTIONS[k];
      expect(e.columns.map((c) => c.key)).toContain(e.ground);
      expect(e.schema.required).toContain(e.ground);
      expect(e.instructions.length).toBeGreaterThan(40);
    }
  });
});

describe("requirements from a document written in PMS", () => {
  const ctx = { project: "Payroll", today: "2026-11-28", me: { name: "Ada" }, pcn: null, doneItems: [], previous: null };
  it("a BRS: its requirement modules and numbered tables, with the printed ids", () => {
    const brs = /** @type {any} */ (newDoc(KITS.brs, ctx));
    brs.functional = [{ title: "Payslips", items: [{ description: "Email payslips to staff as PDF", priority: "M" }, { description: "", priority: "S" }, { description: "Keep 7 years of payslips", priority: "S" }] }];
    brs.integration = [{ useCase: "CRM", functionality: "Send the employee list nightly", priority: "S" }];
    expect(kitRequirements(KITS.brs, brs)).toEqual([
      { id: "FRN-01", description: "Payslips: Email payslips to staff as PDF", priority: "M", owner: "" },
      { id: "FRN-03", description: "Payslips: Keep 7 years of payslips", priority: "S", owner: "" },
      { id: "IRN-001", description: "Non-functional requirements: integration requirements: CRM: Send the employee list nightly", priority: "S", owner: "" },
    ]);
  });
  it("a BSS: its functional modules and its own Req No column", () => {
    const bss = /** @type {any} */ (newDoc(KITS.bss, ctx));
    const reqs = kitRequirements(KITS.bss, bss);
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.every((r) => r.description.length > 0)).toBe(true);
    expect(reqs.some((r) => r.id.startsWith("FRN-"))).toBe(true);
  });
});

describe("tables as CSV", () => {
  it("quotes what needs it and defuses formulas", () => {
    const cols = [
      { key: "a", label: "Name" },
      { key: "b", label: "Note" },
    ];
    expect(toCsv(cols, [{ a: 'Say "hi"', b: "one, two" }, { a: "=HYPERLINK(1)", b: "line\nbreak" }, { a: 5 }])).toBe('Name,Note\r\n"Say ""hi""","one, two"\r\n\'=HYPERLINK(1),"line\nbreak"\r\n5,');
  });
});

describe("skills", () => {
  it("each built-in one has a unique id, a known context and a prompt", () => {
    expect(new Set(BUILT_IN_SKILLS.map((s) => s.id)).size).toBe(BUILT_IN_SKILLS.length);
    for (const s of BUILT_IN_SKILLS) {
      expect(SKILL_CONTEXTS).toContain(s.context);
      expect(s.prompt.length).toBeGreaterThan(20);
    }
    // One extraction skill a kind.
    expect(BUILT_IN_SKILLS.filter((s) => s.id.startsWith("extract_")).map((s) => s.id.slice(8))).toEqual(EXTRACTION_KINDS);
  });
  it("prompts name what's open, and read well without it", () => {
    expect(fillPrompt("Summarise {project}.", { project: "Payroll" })).toBe('Summarise "Payroll".');
    expect(fillPrompt("Summarise {document}.", { project: "Payroll" })).toBe('Summarise the most relevant document of "Payroll".');
    expect(fillPrompt("Test {item}.", {})).toBe("Test this work item.");
  });
  it("where the person is decides which show", () => {
    expect(contextsAt({ project: true, item: false, request: false })).toEqual(["project"]);
    expect(contextsAt({ project: true, section: "docs", item: false, request: false })).toEqual(["document", "project"]);
    expect(contextsAt({ project: true, item: true, request: true })).toEqual(["request", "item"]);
    expect(contextsAt({ project: false, item: false, request: false, page: "service-desk" })).toEqual(["service_desk", "portfolio"]);
    expect(contextsAt({ project: false, item: false, request: false })).toEqual(["portfolio"]);
  });
});
