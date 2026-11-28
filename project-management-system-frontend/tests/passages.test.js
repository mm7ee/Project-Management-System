// Documents as passages for Ask AI (src/data/passages.js): a PMS-written document as text, and any text split at
// headings and paragraphs into passages of about 800 tokens, each with its section and page.
import { describe, expect, it } from "vitest";
import { KITS, newDoc } from "../src/data/documentKits.js";
import { MAX_PASSAGES, OVERLAP_CHARS, PASSAGE_CHARS, kitText, splitPassages } from "../src/data/passages.js";

describe("a document written in PMS, as text", () => {
  const brs = newDoc(KITS.brs, { project: "Payroll", today: "2026-11-28", me: { name: "Ada" }, pcn: { background: "Payslips are printed by hand." }, doneItems: [], previous: null });
  /** @type {any} */ (brs).functional = [{ title: "Payslips", items: [{ description: "Email payslips as PDF", priority: "M" }, { description: "", priority: "S" }] }];
  /** @type {any} */ (brs).integration = [{ useCase: "CRM", functionality: "Send the employee list nightly", priority: "S" }];
  const text = kitText(KITS.brs, brs, "BRS v2 (written in PMS)");
  it("keeps the sections, the fields and the requirement ids", () => {
    expect(text).toContain("# BRS v2 (written in PMS)");
    expect(text).toContain("## Document control\nDocument title: Payroll");
    expect(text).toContain("## 1. Introduction\nPayslips are printed by hand.");
    expect(text).toContain("### Payslips\n- FRN-01 Email payslips as PDF; Priority: M");
    expect(text).toContain("- IRN-001 Use case: CRM; Desired functionality: Send the employee list nightly; Priority: S");
  });
  it("leaves out empty requirements and the automatic sections", () => {
    expect(text).not.toContain("FRN-02");
    expect(text).not.toContain("## Approvals");
    expect(text).not.toContain("## Document history");
  });
  it("splits into passages by section", () => {
    const ps = splitPassages(text);
    expect(ps.find((p) => p.text.includes("FRN-01"))?.section).toBe("2. Functional requirements: general requirements › Payslips");
    expect(ps.find((p) => p.text.includes("printed by hand"))?.section).toBe("BRS v2 (written in PMS) › 1. Introduction");
  });
});

describe("splitting text into passages", () => {
  const para = (/** @type {number} */ n) => `Sentence ${n} about the payroll export and its schedule. `.repeat(12).trim();
  it("packs paragraphs up to the size and carries a little into the next", () => {
    const md = ["# Spec", "## Scope", ...Array.from({ length: 12 }, (_, i) => para(i))].join("\n\n");
    const ps = splitPassages(md);
    expect(ps.length).toBeGreaterThan(1);
    for (const p of ps) {
      expect(p.text.length).toBeLessThanOrEqual(PASSAGE_CHARS + OVERLAP_CHARS + 10);
      expect(p.section).toBe("Spec › Scope");
    }
    expect(ps[1].text.startsWith("…")).toBe(true);
  });
  it("cuts a paragraph longer than a passage at sentence ends", () => {
    const ps = splitPassages(`## Long\n\n${"The export runs at night. ".repeat(400)}`);
    expect(ps.length).toBeGreaterThan(2);
    expect(ps.every((p) => p.text.replace(/^…/, "").trim().endsWith("."))).toBe(true);
  });
  it("pages from form feeds, page comments or Page headings", () => {
    const ps = splitPassages("Intro text\fSecond page text\n\n<!-- page 7 -->\n\nSeventh page\n\n## Page 9\n\nNinth");
    expect(ps.map((p) => [p.page, p.text])).toEqual([
      [null, "Intro text"],
      [2, "Second page text"],
      [7, "Seventh page"],
      [9, "Ninth"],
    ]);
  });
  it("Windows line endings, empty text, and the cap", () => {
    expect(splitPassages("## A\r\n\r\nOne\r\n\r\nTwo")).toEqual([{ section: "A", page: null, text: "One\n\nTwo" }]);
    expect(splitPassages("   \n\n  ")).toEqual([]);
    expect(splitPassages(Array.from({ length: 300 }, (_, i) => `## S${i}\n\nText ${i}`).join("\n\n"))).toHaveLength(MAX_PASSAGES);
  });
});
