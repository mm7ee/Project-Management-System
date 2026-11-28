// The one-line insights under the project page's charts, and the PQL behind their parts.
import { describe, expect, it } from "vitest";
import { burnupInsight, categoryPql, cfdInsight, flowInsight, personPql, stageInsight, weekPql, workloadInsight } from "../src/data/chartInsights";

const weeks = (/** @type {number[]} */ scope, /** @type {number[]} */ done) => scope.map((s, i) => ({ week: `2026-09-${String(7 + i * 7).padStart(2, "0")}`.replace("2026-09-35", "2026-10-05"), scope: s, done: done[i] }));

describe("chart insights", () => {
  it("burn-up: how scope moved, and the forecast against the due date", () => {
    const w = weeks([52, 55, 61], [8, 20, 38]);
    expect(burnupInsight(w, { items: { status: "ok", p50: { date: "2027-01-30" } }, target: "2027-01-23" })).toBe("Scope grew 17% since 7 Sept (52 → 61 items). At this pace the work is 50% likely done by 30 Jan, 7 days after the due date.");
    expect(burnupInsight(weeks([10, 10], [2, 4]), { items: { status: "insufficient" } })).toBe("Scope has held at 10 items since 7 Sept. 4 done; not enough history yet to forecast.");
    expect(burnupInsight(weeks([0, 0], [0, 0]), {})).toBe("No work items yet: the chart fills in as work is added.");
  });
  it("created vs resolved: which way the open list is going", () => {
    expect(flowInsight([{ created: 3, resolved: 2 }, { created: 1, resolved: 3 }, { created: 0, resolved: 2 }])).toBe("7 resolved and 4 created in the last 3 weeks: the open list is shrinking.");
    expect(flowInsight([{ created: 4, resolved: 1 }, { created: 2, resolved: 3 }, { created: 5, resolved: 0 }])).toBe("11 created and 4 resolved in the last 3 weeks: the open list is growing.");
    expect(flowInsight([{ created: 0, resolved: 0 }])).toBe("Nothing created or resolved in these weeks.");
  });
  it("cumulative flow: a steady or a growing work in progress", () => {
    expect(cfdInsight([{ todo: 30, inProgress: 6, done: 8 }, { todo: 20, inProgress: 9, done: 20 }, { todo: 13, inProgress: 7, done: 38 }])).toBe("In progress has held between 6 and 9 items: no bottleneck.");
    expect(cfdInsight([{ todo: 30, inProgress: 2, done: 8 }, { todo: 20, inProgress: 9, done: 20 }])).toBe("Work in progress grew from 2 to 9 items: finish work before starting more.");
    expect(cfdInsight([{ todo: 3, inProgress: 1, done: 1 }, { todo: 1, inProgress: 19, done: 2 }, { todo: 1, inProgress: 2, done: 20 }])).toBe("In progress has ranged from 1 to 19 items; it is 2 now.");
    expect(cfdInsight([{ todo: 3, inProgress: 12, done: 1 }, { todo: 1, inProgress: 4, done: 20 }])).toBe("Work in progress fell from 12 to 4 items: work is getting finished.");
  });
  it("time in stage: the stages over their target, the longest overrun", () => {
    expect(stageInsight([{ name: "PCN Draft", days: 4, targetDays: 5, current: false }, { name: "PCN Sign Off", days: 6, targetDays: 5, current: false }, { name: "BRS Sign Off", days: 7, targetDays: 5, current: true }])).toBe("2 of 3 stages ran over; BRS Sign Off is the longest overrun so far (2 business days).");
    expect(stageInsight([{ name: "PCN Draft", days: 4, targetDays: 5, current: false }])).toBe("Every stage so far is within its target (1 stage).");
  });
  it("workload: who is over capacity, or who has room", () => {
    const p = (/** @type {string} */ name, /** @type {number} */ logged, /** @type {number} */ planned) => ({ name, loggedHours: logged, plannedHours: planned, lead: false });
    expect(workloadInsight({ capacityHours: 30, people: [p("Tafadzwa", 10, 24), p("Rudo", 2, 20)] })).toBe("Tafadzwa is 4 h over the 30 h weekly capacity.");
    expect(workloadInsight({ capacityHours: 30, people: [p("Tafadzwa", 10, 14), p("Mutsa", 2, 10)] })).toBe("Everyone is within the 30 h weekly capacity; Mutsa has the most room (18 h free).");
  });
  it("the PQL behind a part of a chart", () => {
    expect(weekPql("WCC", "resolved", "2026-11-16")).toBe("project = WCC AND resolved >= 2026-11-16 AND resolved < 2026-11-23 ORDER BY resolved ASC");
    expect(categoryPql("WCC", "inProgress")).toBe('project = WCC AND statusCategory = "In Progress" ORDER BY updated DESC');
    expect(personPql("WCC", "qa-admin")).toBe('project = WCC AND assignee = "qa-admin" AND statusCategory != Done ORDER BY due ASC');
  });
});
