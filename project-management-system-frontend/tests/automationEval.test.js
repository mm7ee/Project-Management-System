// The automation evaluator (src/data/automation.js): condition groups, smart values and their escaping, schedules
// in a time zone, and working days.
import { describe, expect, it } from "vitest";
import { addWorkingDays, cleanConditions, evaluateConditions, renderTemplate, scheduleOccasion } from "../src/data/automation.js";

/** @type {import("../src/data/automation.js").EvalItem} */
const item = {
  type: "BUG",
  kind: "BUG",
  priority: "HIGH",
  status: "IN_PROGRESS",
  statusName: "In Progress",
  statusCategory: "IN_PROGRESS",
  assignee: "ann",
  assigneeRole: "developer",
  reporter: "rob",
  labels: ["customer", "urgent"],
  summary: "Checkout fails on Safari",
  description: "",
  component: null,
  dueDate: "2026-12-03",
  storyPoints: 5,
  custom: { sev: "Critical", budget: 250, signed: false, channels: ["Email", "Website"] },
};
const ctx = { now: Date.parse("2026-12-01T10:00:00Z"), today: "2026-12-01" };
const check = (/** @type {unknown} */ g) => evaluateConditions(cleanConditions(g), item, ctx);

describe("conditions", () => {
  it("AND needs every condition, OR any one; every condition is reported", () => {
    const both = check({ op: "and", items: [{ field: "type", op: "is", value: "BUG" }, { field: "priority", op: "is", value: "HIGHEST" }] });
    expect(both.result).toBe(false);
    expect(both.details.map((d) => d.result)).toEqual([true, false]);
    expect(check({ op: "or", items: [{ field: "type", op: "is", value: "BUG" }, { field: "priority", op: "is", value: "HIGHEST" }] }).result).toBe(true);
  });
  it("nested groups: (type is Bug AND (label contains urgent OR assignee is empty))", () => {
    const g = { op: "and", items: [{ field: "type", op: "is", value: "bug" }, { op: "or", items: [{ field: "label", op: "contains", value: "URG" }, { field: "assignee", op: "isEmpty" }] }] };
    expect(check(g).result).toBe(true);
    expect(evaluateConditions(cleanConditions(g), { ...item, labels: [] }, ctx).result).toBe(false);
  });
  it("empty, contains, status by id or name, category, assignee's role", () => {
    expect(check({ op: "and", items: [{ field: "component", op: "isEmpty" }, { field: "description", op: "isEmpty" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "summary", op: "contains", value: "safari" }, { field: "summary", op: "notContains", value: "chrome" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "status", op: "is", value: "In Progress" }, { field: "status", op: "is", value: "in_progress" }, { field: "statusCategory", op: "isNot", value: "DONE" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "assigneeRole", op: "is", value: "developer" }] }).result).toBe(true);
  });
  it("dates: due within 2 days, before and after; numbers", () => {
    expect(check({ op: "and", items: [{ field: "dueDate", op: "within", value: 2 }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "dueDate", op: "within", value: 1 }] }).result).toBe(false);
    expect(check({ op: "and", items: [{ field: "dueDate", op: "before", value: "2026-12-04" }, { field: "dueDate", op: "after", value: "2026-12-02" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "storyPoints", op: "gt", value: 3 }, { field: "storyPoints", op: "lt", value: 8 }] }).result).toBe(true);
  });
  it("custom fields: a choice by its label, money, a checkbox, a multi-select", () => {
    expect(check({ op: "and", items: [{ field: "custom", fieldId: "sev", op: "is", value: "critical" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "custom", fieldId: "budget", op: "gt", value: 100 }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "custom", fieldId: "signed", op: "is", value: "no" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "custom", fieldId: "channels", op: "is", value: "email" }] }).result).toBe(true);
    expect(check({ op: "and", items: [{ field: "custom", fieldId: "missing", op: "isEmpty" }] }).result).toBe(true);
  });
  it("no conditions: always true", () => {
    expect(evaluateConditions(null, item, ctx)).toEqual({ result: true, details: [] });
  });
  it("refuses what it can't evaluate", () => {
    expect(() => cleanConditions({ op: "xor", items: [] })).toThrow(/AND or OR/);
    expect(() => cleanConditions({ op: "and", items: [{ field: "colour", op: "is", value: "red" }] })).toThrow(/Unknown condition field/);
    expect(() => cleanConditions({ op: "and", items: [{ field: "type", op: "within", value: 2 }] })).toThrow(/doesn't apply/);
    expect(() => cleanConditions({ op: "and", items: [{ field: "type", op: "is" }] })).toThrow(/give a value/);
    expect(() => cleanConditions({ op: "and", items: [{ op: "or", items: [{ op: "and", items: [{ op: "or", items: [] }] }] }] })).toThrow(/levels deep/);
    expect(() => cleanConditions({ op: "and", items: Array.from({ length: 26 }, () => ({ field: "type", op: "is", value: "BUG" })) })).toThrow(/Up to 25/);
  });
});

describe("smart values", () => {
  const values = { "item.key": "DEV-1", "item.title": '<img src=x onerror=alert(1)> "quoted"\nline', "workspace.name": "Development" };
  it("fills {{placeholders}} and the older {key} style; leaves unknown ones", () => {
    expect(renderTemplate("{{item.key}} in {{ workspace.name }}: {summary} {{item.nope}}", values)).toBe(`DEV-1 in Development: ${values["item.title"]} {{item.nope}}`);
  });
  it("escapes for HTML emails, so an item's title can't add markup", () => {
    expect(renderTemplate("<p>{{item.title}}</p>", values, "html")).toBe("<p>&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot;\nline</p>");
  });
  it("escapes for JSON payloads, so a title can't break out of its string", () => {
    const out = renderTemplate('{"title": "{{item.title}}", "key": "{{item.key}}"}', values, "json");
    expect(JSON.parse(out)).toEqual({ title: values["item.title"], key: "DEV-1" });
  });
});

describe("schedules and working days", () => {
  // 2026-11-30 is a Monday. Harare is UTC+2.
  const at = (/** @type {string} */ iso) => Date.parse(iso);
  it("fires once its local time has come, on the right day", () => {
    const weekly = { every: /** @type {const} */ ("week"), weekday: 1, time: "08:00" };
    expect(scheduleOccasion(weekly, at("2026-11-30T05:55:00Z"), "Africa/Harare")).toBeNull(); // 07:55 Harare
    expect(scheduleOccasion(weekly, at("2026-11-30T06:00:00Z"), "Africa/Harare")).toBe("2026-11-30");
    expect(scheduleOccasion(weekly, at("2026-12-01T06:00:00Z"), "Africa/Harare")).toBeNull(); // Tuesday
    // The organisation's time zone: 08:00 in London is 10:00 in Harare.
    expect(scheduleOccasion(weekly, at("2026-11-30T07:30:00Z"), "Europe/London")).toBeNull();
    expect(scheduleOccasion(weekly, at("2026-11-30T08:00:00Z"), "Europe/London")).toBe("2026-11-30");
  });
  it("working days, monthly, daily", () => {
    expect(scheduleOccasion({ every: "weekday", time: "09:00" }, at("2026-12-05T08:00:00Z"), "Africa/Harare")).toBeNull(); // Saturday
    expect(scheduleOccasion({ every: "month", day: 1, time: "06:00" }, at("2026-12-01T05:00:00Z"), "Africa/Harare")).toBe("2026-12-01");
    expect(scheduleOccasion({ every: "day", time: "23:30" }, at("2026-11-30T21:31:00Z"), "Africa/Harare")).toBe("2026-11-30");
  });
  it("adds working days, skipping the weekend (and any non-working day)", () => {
    expect(addWorkingDays("2026-12-03", 2, [1, 2, 3, 4, 5])).toBe("2026-12-07"); // Thursday + 2 → Monday
    expect(addWorkingDays("2026-12-04", 1, [1, 2, 3, 4, 5])).toBe("2026-12-07"); // Friday + 1 → Monday
    expect(addWorkingDays("2026-12-04", 1, [1, 2, 3, 4, 5, 6])).toBe("2026-12-05"); // Saturdays worked
  });
});
