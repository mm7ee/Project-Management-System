// The project page's shared rules: health with the lifecycle stage, the forecasts, and what needs attention.
/** @import { System } from '../src/data/systems' */
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/data/project";
import { ragOf } from "../src/data/projectHealth";
import { FORECAST_RULES, lifecycleForecast, seededRandom, throughputForecast, varianceDays } from "../src/data/forecast";
import { ATTENTION_ORDER, OVERDUE_LISTED, attentionFor, rankAttention } from "../src/data/attention";
import { omnicontactLifecycle } from "../src/data/lifecycleTemplates";
import { cleanTemplate } from "../src/data/lifecycle";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-25T10:00:00Z"); // a Wednesday
const ago = (/** @type {number} */ d) => new Date(NOW - d * DAY).toISOString();
/** @returns {System} */
const sys = (/** @type {Partial<System>} */ over = {}) => ({ id: "p1", name: "Payroll", short: "PR", description: "", url: "", status: "UPCOMING", owner: "Systems", engagement: 0, progress: 30, startedAt: ago(40), updatedAt: ago(1), ...over });
const none = { openBlockers: 0, oldestBlockerAt: null, openItems: 0, overdueItems: 0 };
const cal = { timeZone: "Africa/Harare", workDays: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", holidays: new Set() };

describe("health with the lifecycle stage", () => {
  it("a stage over its target is At risk, and says by how much; twice its target is Off track", () => {
    expect(ragOf(sys(), { ...none, stage: { name: "BRS Sign Off", usedDays: 5, targetDays: 5 } }, NOW, DEFAULT_LIMITS).rag).toBe("GREEN");
    const late = ragOf(sys(), { ...none, stage: { name: "BRS Sign Off", usedDays: 7, targetDays: 5 } }, NOW, DEFAULT_LIMITS);
    expect(late).toEqual({ rag: "AMBER", reasons: ["BRS Sign Off is 2 business days over its 5-day target"] });
    const one = ragOf(sys(), { ...none, stage: { name: "PCN Draft", usedDays: 6, targetDays: 5 } }, NOW, DEFAULT_LIMITS);
    expect(one.reasons).toEqual(["PCN Draft is 1 business day over its 5-day target"]);
    expect(ragOf(sys(), { ...none, stage: { name: "BRS Sign Off", usedDays: 10, targetDays: 5 } }, NOW, DEFAULT_LIMITS).rag).toBe("RED");
  });
  it("without a stage the rule is unchanged, and a project not under way isn't rated", () => {
    expect(ragOf(sys(), none, NOW, DEFAULT_LIMITS).rag).toBe("GREEN");
    expect(ragOf(sys({ status: "IDEA" }), { ...none, stage: { name: "PCN Draft", usedDays: 20, targetDays: 5 } }, NOW, DEFAULT_LIMITS).rag).toBe("NONE");
  });
});

describe("the Monte Carlo forecast", () => {
  it("says so, rather than guessing, with too little history", () => {
    const short = throughputForecast({ weekly: [3, 4, 2], remaining: 20, now: NOW });
    expect(short.status).toBe("insufficient");
    expect(short.explanation).toBe(`Not enough history to forecast: 3 weeks of work so far; ${FORECAST_RULES.minWeeks} are needed.`);
    const few = throughputForecast({ weekly: [1, 0, 2, 1, 0, 1], remaining: 20, now: NOW });
    expect(few.status).toBe("insufficient");
    expect(few.explanation).toContain("5 items resolved in the last 6 weeks");
    expect(few.p50).toBeUndefined();
  });
  it("nothing left is done", () => {
    expect(throughputForecast({ weekly: [3, 3, 3, 3], remaining: 0, now: NOW }).status).toBe("done");
  });
  it("a steady pace gives that pace's date, at 50% and 85% alike", () => {
    const f = throughputForecast({ weekly: [5, 5, 5, 5, 5, 5, 5, 5], remaining: 20, now: NOW, runs: 2000 });
    expect(f.status).toBe("ok");
    expect(f.p50).toEqual({ weeks: 4, date: "2026-12-23" });
    expect(f.p85).toEqual({ weeks: 4, date: "2026-12-23" });
    expect(f.explanation).toContain("from the last 8 weeks of throughput (5–5 items resolved a week)");
  });
  it("an uneven pace: 85% is never before 50%, and the same data gives the same answer", () => {
    const input = { weekly: [0, 6, 1, 4, 0, 3, 2, 5, 1, 3, 0, 4, 9, 9], remaining: 30, now: NOW, seed: 42 };
    const a = throughputForecast(input);
    const b = throughputForecast(input);
    expect(a).toEqual(b);
    expect(a.history.weeks).toBe(FORECAST_RULES.maxWeeks); // only the last 12 weeks
    expect(/** @type {any} */ (a.p85).weeks).toBeGreaterThanOrEqual(/** @type {any} */ (a.p50).weeks);
    // About 2.7 a week (the last 12 weeks): around 11 weeks for 30 items.
    expect(/** @type {any} */ (a.p50).weeks).toBeGreaterThanOrEqual(9);
    expect(/** @type {any} */ (a.p50).weeks).toBeLessThanOrEqual(14);
  });
  it("the random numbers are seeded", () => {
    const r1 = seededRandom(7);
    const r2 = seededRandom(7);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
  it("from the lifecycle: what's left of this stage plus the targets after it, in business days", () => {
    const def = cleanTemplate(omnicontactLifecycle());
    const last = def.stages[def.stages.length - 1];
    // 2 days into the 5-day Close Project stage on Wednesday 25 Nov 10:00: 3 business days → Monday 30 Nov.
    const f = lifecycleForecast(def, last.code, 2, NOW, cal);
    expect(f).toEqual({ businessDays: 3, date: "2026-11-30" });
    // Over the target: nothing left of this stage.
    expect(lifecycleForecast(def, last.code, 9, NOW, cal)?.businessDays).toBe(0);
    expect(varianceDays("2027-01-30", "2027-01-23")).toBe(7);
    expect(varianceDays(null, "2027-01-23")).toBeNull();
  });
});

describe("what needs attention", () => {
  const base = { systemId: "p1", blockers: [], signoffs: [], stage: null, overdueItems: [], overduePql: "project = PR AND due < now()", requests: [], stalledDays: null, lastUpdate: ago(1) };
  it("ranks by kind (blockers first), then the oldest first", () => {
    const list = attentionFor(
      {
        ...base,
        requests: [{ id: "r1", requestedByName: "Admin", message: "When?", createdAt: ago(4) }],
        overdueItems: [
          { key: "PR-2", summary: "Later", dueDate: "2026-11-20", assigneeName: "Tom" },
          { key: "PR-1", summary: "Oldest", dueDate: "2026-11-10", assigneeName: null },
        ],
        blockers: [
          { id: "b2", text: "New", raisedAt: ago(1), raisedByName: "Mia" },
          { id: "b1", text: "Old", raisedAt: ago(9), raisedByName: "Ada" },
        ],
        signoffs: [{ id: "s1", signerName: "Waraidzo", label: "Business", stageName: "BRS Sign Off", document: "BRS v2", requestedAt: ago(5) }],
        stage: { code: "BRS_SIGNOFF", name: "BRS Sign Off", enteredAt: ago(9), usedDays: 7, targetDays: 5, state: "overdue", missing: ["Waraidzo approves"] },
        stalledDays: 20,
      },
      NOW,
    );
    expect(list.map((e) => e.id)).toEqual(["blocker:b1", "blocker:b2", "signoff:s1", "stage:BRS_SIGNOFF", "item:PR-1", "item:PR-2", "request:r1", "stale"]);
    expect(list[2]).toMatchObject({ title: "BRS v2 is waiting on Waraidzo", detail: "Business · requested 3 business days ago", action: { kind: "remind" } });
    expect(list[3]).toMatchObject({ title: "BRS Sign Off is 2 business days over its target", detail: "Still needed: Waraidzo approves" });
    expect(list[4]).toMatchObject({ title: "PR-1 Oldest", detail: "Due 2026-11-10 (15 days late) · Unassigned", action: { kind: "open_item", href: "#/projects/p1/items/PR-1" } });
    expect(list[0].action).toEqual({ kind: "resolve_blocker", label: "Resolve", ref: "b1" });
  });
  it("lists the first overdue items and sums up the rest, with the list behind them", () => {
    const items = Array.from({ length: OVERDUE_LISTED + 3 }, (_, i) => ({ key: `PR-${i + 1}`, summary: `Item ${i + 1}`, dueDate: `2026-11-${String(10 + i).padStart(2, "0")}`, assigneeName: "Tom" }));
    const list = attentionFor({ ...base, overdueItems: items }, NOW);
    expect(list).toHaveLength(OVERDUE_LISTED + 1);
    expect(list[OVERDUE_LISTED]).toMatchObject({ title: "3 more overdue work items", action: { kind: "open_list", label: "Show 3", pql: base.overduePql } });
  });
  it("a stage near its target appears only while its gate isn't met; a running stage doesn't", () => {
    const st = { code: "DEV", name: "Dev Work", enteredAt: ago(30), usedDays: 34, targetDays: 40 };
    expect(attentionFor({ ...base, stage: { ...st, state: "warning", missing: ["Finish 3 work items"] } }, NOW).map((e) => e.kind)).toEqual(["gate"]);
    expect(attentionFor({ ...base, stage: { ...st, state: "warning", missing: [] } }, NOW)).toEqual([]);
    expect(attentionFor({ ...base, stage: { ...st, state: "running", missing: ["x"] } }, NOW)).toEqual([]);
  });
  it("the kind order is fixed", () => {
    expect(ATTENTION_ORDER[0]).toBe("blocker");
    const entries = rankAttention([
      { kind: "stale", id: "a", since: "2026-01-01", title: "a", detail: "", action: { kind: "post_update", label: "" } },
      { kind: "blocker", id: "b", since: "2026-11-01", title: "b", detail: "", action: { kind: "resolve_blocker", label: "" } },
    ]);
    expect(entries.map((e) => e.id)).toEqual(["b", "a"]);
  });
});
