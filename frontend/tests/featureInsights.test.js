/** @import { Feature } from '../src/data/features' */
// Feature request insights (src/data/featureInsights.ts). Run with: npm test
import { describe, expect, it } from "vitest";
import { clientDemand, insightSentences, leadByKind, onTime, periodTotals, quantile, weekStart, weeklyFlow } from "../src/data/featureInsights";
const NOW = new Date(2026, 10, 25, 12).getTime(); // Wednesday 25 Nov 2026, noon
const ago =
  /** @param {number} d
   * @returns {string}
   */ (d) => new Date(NOW - d * 86400000).toISOString();
let n = 0;
const f =
  /**
   * @param {Partial<Feature>} o
   * @returns {Feature}
   */ (o) => ({
    id: `f${++n}`,
    systemId: "s1",
    title: `Request ${n}`,
    description: "",
    kind: "CHANGE",
    client: "Acme",
    status: "NOT_STARTED",
    priority: "MEDIUM",
    createdBy: "u1",
    createdAt: ago(10),
    updatedAt: ago(1),
    ...o,
  });
describe("weekStart", () => {
  it("is the Monday at midnight", () => {
    const d = new Date(weekStart(NOW));
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(0);
  });
});
describe("weeklyFlow", () => {
  it("counts arrivals, deliveries and the open backlog per week", () => {
    const fs = [
      f({ createdAt: ago(1) }), // this week, open
      f({ createdAt: ago(9), status: "COMPLETED", completedAt: ago(2) }), // last week in, out this week
      f({ createdAt: ago(9), status: "CANCELLED", updatedAt: ago(1) }),
    ];
    const [last, cur] = weeklyFlow(fs, NOW, 2);
    expect(last).toMatchObject({ arrived: 2, delivered: 0, open: 2 });
    expect(cur).toMatchObject({ arrived: 1, delivered: 1, cancelled: 1, open: 1 });
  });
});
describe("quantile", () => {
  it("interpolates", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.8)).toBe(10);
    expect(quantile([], 0.5)).toBeNull();
  });
});
describe("onTime and lead times", () => {
  it("counts the due day itself as on time", () => {
    const due = new Date(NOW - 2 * 86400000).toISOString().slice(0, 10);
    expect(onTime(f({ status: "COMPLETED", dueAt: due, completedAt: ago(2) }))).toBe(true);
    expect(onTime(f({ status: "COMPLETED", dueAt: due, completedAt: ago(0) }))).toBe(false);
    expect(onTime(f({ status: "COMPLETED", completedAt: ago(0) }))).toBeNull();
  });
  it("gives the median and slow end per type", () => {
    const fs = [4, 6, 8, 20].map((d) => f({ kind: "BUG_FIX", status: "COMPLETED", createdAt: ago(d + 1), completedAt: ago(1) }));
    const bug = /** @type {LeadByKind} */ (leadByKind(fs).find((r) => r.kind === "BUG_FIX"));
    expect(bug.n).toBe(4);
    expect(bug.median).toBeCloseTo(7);
    expect(bug.p80).toBeGreaterThan(8);
  });
});
describe("clientDemand", () => {
  it("ranks clients and folds the long tail into one row", () => {
    const fs = ["A", "A", "A", "B", "B", "C", "D"].map((client) => f({ client }));
    const rows = clientDemand(fs, NOW, 3);
    expect(rows.map((r) => r.client)).toEqual(["A", "B", "Other clients (2)"]);
    expect(rows[2].total).toBe(2);
  });
});
describe("insightSentences", () => {
  it("says the backlog grew when more came in than went out", () => {
    const fs = [f({ createdAt: ago(3) }), f({ createdAt: ago(4) }), f({ createdAt: ago(40), status: "COMPLETED", completedAt: ago(2) })];
    expect(periodTotals(fs, NOW - 28 * 86400000, NOW + 1)).toMatchObject({ arrived: 2, delivered: 1, openAtStart: 1, openAtEnd: 2 });
    expect(insightSentences(fs, NOW, 28)[0]).toBe("In the last 28 days, 2 requests came in, 1 was delivered: the open backlog grew from 1 to 2.");
  });
  it("points at an old urgent request", () => {
    const s = insightSentences([f({ title: "Payroll export", priority: "HIGH", createdAt: ago(45) })], NOW, 28);
    expect(s.some((x) => x.includes('"Payroll export"') && x.includes("45 days"))).toBe(true);
  });
});
