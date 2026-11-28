// Ask AI's proposals (src/data/actions.js): extracted tables as the work items or risks they'd become, priorities as
// documents write them, a later request using what an earlier one returned, and arguments that are lists of objects.
import { describe, expect, it } from "vitest";
import { MAX_BULK, fillPlaceholders, priorityOf, tableToProposal } from "../src/data/actions.js";
import { validateArgs } from "../src/data/assistant.js";

describe("an extracted table as a proposal", () => {
  it("requirements become stories, with their ids and priorities", () => {
    const p = tableToProposal("requirements", [{ id: "FRN-01", description: "Email payslips", priority: "Must", owner: "" }], "payroll");
    expect(p).toEqual({ tool: "create_work_items", label: "Create 1 work item", args: { projectId: "payroll", items: [{ type: "STORY", summary: "FRN-01 Email payslips", description: "Email payslips", priority: "HIGH", labels: ["requirement"] }] } });
  });
  it("action items become tasks with their owner and due date; defects become bugs", () => {
    expect(tableToProposal("actions", [{ action: "Send the plan", owner: "Mia", due: "2026-12-05" }], "p")?.args.items).toEqual([{ type: "TASK", summary: "Send the plan", description: "Send the plan", assignee: "Mia", dueDate: "2026-12-05", labels: ["action"] }]);
    const bug = /** @type {any} */ (tableToProposal("defects", [{ title: "Times wrong", severity: "Major", steps: "Open a chat", actual: "UTC shown" }], "p")?.args).items[0];
    expect(bug).toMatchObject({ type: "BUG", summary: "Times wrong", priority: "HIGH", description: "Steps: Open a chat\n\nActual: UTC shown" });
  });
  it("risks go to the register; long text is cut; at most 50", () => {
    const r = tableToProposal("risks", [{ risk: "x".repeat(600), likelihood: 4 }], "p");
    expect(r?.tool).toBe("create_risks");
    expect(/** @type {any} */ (r?.args).risks[0]).toMatchObject({ likelihood: 4, impact: 3 });
    expect(/** @type {any} */ (r?.args).risks[0].risk.length).toBe(500);
    const many = tableToProposal("milestones", Array.from({ length: 80 }, (_, i) => ({ milestone: `M${i}` })), "p");
    expect(/** @type {any} */ (many?.args).items).toHaveLength(MAX_BULK);
    expect(tableToProposal("requirements", [], "p")).toBeNull();
  });
  it("priorities as documents write them", () => {
    expect([priorityOf("Must have"), priorityOf("s"), priorityOf("Could"), priorityOf("Won't have"), priorityOf("Critical"), priorityOf("whenever"), priorityOf("")]).toEqual(["HIGH", "MEDIUM", "LOW", "LOWEST", "HIGHEST", undefined, undefined]);
  });
});

describe("requests that depend on earlier ones", () => {
  it("fill in what an earlier request returned, and fail plainly when it didn't", () => {
    expect(fillPlaceholders({ path: "/api/filters/{{0.id}}/subscriptions", body: { hour: 8 } }, [{ id: "f1" }])).toEqual({ path: "/api/filters/f1/subscriptions", body: { hour: 8 } });
    expect(() => fillPlaceholders({ path: "/api/filters/{{0.id}}" }, [{}])).toThrow("Step 1 didn't return its id");
  });
});

describe("arguments that are lists of objects", () => {
  /** @type {import("../src/data/assistant.js").ToolSchema} */
  const schema = {
    type: "object",
    properties: {
      items: { type: "array", maxItems: 2, items: { type: "object", properties: { summary: { type: "string", maxLength: 20 }, priority: { type: "string", enum: ["HIGH", "LOW"] } }, required: ["summary"] } },
      changes: { type: "object", properties: { dueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } },
    },
    required: ["items"],
  };
  it("checks each one, drops unknown keys, and says which one is wrong", () => {
    expect(validateArgs(schema, { items: [{ summary: "A", extra: 1 }], changes: { dueDate: "2026-12-01" } })).toEqual({ ok: true, value: { items: [{ summary: "A" }], changes: { dueDate: "2026-12-01" } } });
    expect(validateArgs(schema, { items: [{ summary: "A" }, { priority: "HIGH" }] })).toMatchObject({ ok: false, error: '"items" item 2: "summary" is required.' });
    expect(validateArgs(schema, { items: [{ summary: "A" }, { summary: "B" }, { summary: "C" }] }).ok).toBe(false);
    expect(validateArgs(schema, { items: ["not an object"] }).ok).toBe(false);
    expect(validateArgs(schema, { items: [{ summary: "A" }], changes: { dueDate: "tomorrow" } }).ok).toBe(false);
  });
});
