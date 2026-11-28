// The project page's summary: the facts the AI may use, the plain summary, and the check that throws away AI text
// quoting a number the facts don't have.
import { describe, expect, it } from "vitest";
import { checkSummary, factsHash, plainSummary, summaryFacts } from "../src/data/projectSummary";

const overview = (/** @type {any} */ over = {}) => ({
  project: { name: "WhatsApp Customer Channel", status: "UPCOMING" },
  health: { rag: "AMBER", label: "At risk", reasons: ["BRS Sign Off is 2 business days over its 5-day target"] },
  lifecycle: {
    closed: false,
    stage: { name: "BRS Sign Off", n: 6, total: 16 },
    sla: { usedDays: 7, state: "overdue" },
    targetDays: 5,
    missing: ["Waiting for Waraidzo to sign"],
    stages: Array.from({ length: 16 }, (_, i) => ({ name: i === 6 ? "BSS Draft" : `Stage ${i + 1}` })),
  },
  kpis: {
    openItems: { value: 23 },
    overdueItems: { value: 4 },
    blockers: { value: 1, oldestDays: 5 },
    risks: { highCritical: 0 },
    security: { criticalHigh: 0 },
    forecast: { finish: "2027-01-30", basis: "items", target: "2027-01-23", varianceDays: 7, items: { status: "ok" } },
  },
  attention: {
    entries: [
      { kind: "blocker", title: "Waiting for the API credentials", detail: "Raised by Mutsa 5 days ago" },
      { kind: "signoff", title: "BRS v2 is waiting on Waraidzo", detail: "Business · requested 3 business days ago" },
    ],
  },
  upcoming: [{ title: "WCC-44 Sandbox webhook test", date: "2026-12-01" }],
  ...over,
});

describe("the summary's facts", () => {
  it("lists what the page shows, numbers and dates as written", () => {
    const f = summaryFacts(overview());
    expect(f).toContain("Stage: BRS Sign Off (stage 6 of 16)");
    expect(f).toContain("Time in this stage: 7 of 5 business days, 2 over its target");
    expect(f).toContain("Waiting for sign-off: BRS v2 is waiting on Waraidzo");
    expect(f).toContain("Forecast finish: 30 Jan 2027 (from the pace of the work)");
    expect(f).toContain("Forecast against the due date: 7 days late");
    expect(f).toContain("Next stage: BSS Draft");
    expect(factsHash(f)).toBe(factsHash(summaryFacts(overview())));
    expect(factsHash(f)).not.toBe(factsHash(summaryFacts(overview({ kpis: { ...overview().kpis, overdueItems: { value: 5 } } }))));
  });
});

describe("the plain summary", () => {
  it("three sentences: where it is, what's holding it up, when it finishes", () => {
    expect(plainSummary(overview())).toBe(
      "WhatsApp Customer Channel is at risk: it is at BRS Sign Off (stage 6 of 16), 2 business days past its target. It has 1 open blocker, the oldest 5 days old; BRS v2 is waiting on Waraidzo; 4 of 23 open work items overdue. It is forecast to finish on 30 Jan 2027, 7 days after its due date.",
    );
  });
  it("nothing in the way, and no forecast yet", () => {
    const o = overview({
      health: { rag: "GREEN", label: "On track", reasons: [] },
      lifecycle: { ...overview().lifecycle, sla: { usedDays: 2, state: "running" } },
      kpis: { ...overview().kpis, blockers: { value: 0, oldestDays: null }, overdueItems: { value: 0 }, forecast: { finish: null, target: null, varianceDays: null, items: { status: "insufficient" } } },
      attention: { entries: [] },
    });
    expect(plainSummary(o)).toBe("WhatsApp Customer Channel is on track: it is at BRS Sign Off (stage 6 of 16). 23 work items are open and nothing is holding it up. Next comes BSS Draft.");
  });
});

describe("checking the AI's text", () => {
  const facts = summaryFacts(overview());
  it("keeps plain sentences whose numbers all come from the facts", () => {
    const ok = "WhatsApp Customer Channel is at BRS Sign Off, 2 business days over its target. BRS v2 is waiting on Waraidzo, and 4 work items are overdue. It should finish on 30 Jan 2027, 7 days late.";
    expect(checkSummary(ok, facts)).toBe(ok);
    expect(checkSummary(`**${ok}**`, facts)).toBe(ok);
  });
  it("throws away a number the facts don't have", () => {
    expect(checkSummary("WhatsApp Customer Channel is at BRS Sign Off. It has 12 overdue work items and an open blocker. It should finish in January.", facts)).toBeNull();
  });
  it("throws away numbers in words, lists, too many sentences, and too little", () => {
    expect(checkSummary("WhatsApp Customer Channel is at BRS Sign Off. It has four overdue work items and an open blocker. It should finish in January.", facts)).toBeNull();
    expect(checkSummary("- At BRS Sign Off\n- Blocked\n- Late, but the team is working through the open items now", facts)).toBeNull();
    expect(checkSummary("It is at BRS Sign Off. It is late. It is blocked. It is waiting. It will finish later than planned.", facts)).toBeNull();
    expect(checkSummary("Late.", facts)).toBeNull();
    expect(checkSummary(null, facts)).toBeNull();
  });
});
