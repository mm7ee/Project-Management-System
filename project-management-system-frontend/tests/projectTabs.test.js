// The project page's tabs: the Testing tab's pass-rate trend and the Activity tab's filters.
import { describe, expect, it } from "vitest";
import { activityGroup, passTrend } from "../src/components/ProjectTabs";

describe("the pass-rate trend", () => {
  it("each day, every case's latest result so far; waived cases set aside", () => {
    const tests = [
      { runs: [{ result: "fail", run_at: "2026-11-02T09:00:00Z" }, { result: "pass", run_at: "2026-11-04T09:00:00Z" }] },
      { runs: [{ result: "pass", run_at: "2026-11-02T10:00:00Z" }] },
      { runs: [{ result: "waived", run_at: "2026-11-03T10:00:00Z" }] },
      { runs: [] },
    ];
    expect(passTrend(tests)).toEqual([
      { day: "2026-11-02", rate: 50, counted: 2 },
      { day: "2026-11-03", rate: 50, counted: 2 },
      { day: "2026-11-04", rate: 100, counted: 2 },
    ]);
    expect(passTrend([{ runs: [] }])).toEqual([]);
  });
});

describe("activity filters", () => {
  it("puts each kind of change under one filter", () => {
    expect(activityGroup("stage_changed")).toBe("stages");
    expect(activityGroup("signoff_requested")).toBe("stages");
    expect(activityGroup("pcn_signed")).toBe("stages");
    expect(activityGroup("work_item_updated")).toBe("work");
    expect(activityGroup("time_logged")).toBe("work");
    expect(activityGroup("document_added")).toBe("docs");
    expect(activityGroup("blocker_raised")).toBe("updates");
    expect(activityGroup("system_progress")).toBe("updates");
    expect(activityGroup("system_developers")).toBe("people");
  });
});
