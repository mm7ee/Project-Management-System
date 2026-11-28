// What the project page remembers per person (saved views, filters, last tab), cleaned before it's saved; and the
// timeline's critical path.
import { describe, expect, it } from "vitest";
import { DEFAULT_WORK_FILTERS, PAGE_PREF_LIMITS, cleanPagePrefs, cleanWorkFilters, isDefaultFilters, remember } from "../src/data/pagePrefs";
import { cleanPrefs, START_KEYS } from "../src/data/roles";
import { criticalPath } from "../src/data/criticalPath";

describe("the project page's remembered preferences", () => {
  it("keeps only known filters with sensible values", () => {
    expect(cleanWorkFilters({ state: "done", type: "BUG", status: "s-1", priority: "HIGH", assignee: "me", label: " ui ", q: "login", sort: "due", dir: "asc", evil: "<script>" })).toEqual({
      state: "done", type: "BUG", status: "s-1", priority: "HIGH", assignee: "me", label: "ui", q: "login", sort: "due", dir: "asc",
    });
    expect(cleanWorkFilters({ state: "nope", type: "drop table", sort: "x", dir: "sideways", q: 42 })).toEqual(DEFAULT_WORK_FILTERS);
    expect(isDefaultFilters(cleanWorkFilters(null))).toBe(true);
  });
  it("saved views, filters and last tabs: valid entries only, capped", () => {
    const views = Array.from({ length: PAGE_PREF_LIMITS.views + 5 }, (_, i) => ({ id: `view${String(i).padStart(4, "0")}`, systemId: "p1", name: `View ${i}`, filters: { state: "all" } }));
    const out = cleanPagePrefs({
      workViews: [{ id: "bad id!", systemId: "p1", name: "x" }, { id: "abcdef12", systemId: "P1 NOPE", name: "x" }, { id: "abcdef13", systemId: "p1", name: "" }, ...views],
      workFilters: { p1: { state: "done" }, "not ok": { state: "done" } },
      lastTabs: { p1: "risks", p2: "nowhere" },
    });
    expect(out.workViews).toHaveLength(PAGE_PREF_LIMITS.views);
    expect(out.workViews[0]).toEqual({ id: "view0000", systemId: "p1", name: "View 0", filters: { ...DEFAULT_WORK_FILTERS, state: "all" } });
    expect(out.workFilters).toEqual({ p1: { ...DEFAULT_WORK_FILTERS, state: "done" } });
    expect(out.lastTabs).toEqual({ p1: "risks" });
  });
  it("travel inside the person's preferences, which still clean everything else", () => {
    const p = cleanPrefs({ theme: "futuristic", lastTabs: { p1: "team" }, workViews: "not a list", junk: 1 }, START_KEYS);
    expect(p.theme).toBe("futuristic");
    expect(p.lastTabs).toEqual({ p1: "team" });
    expect(p.workViews).toEqual([]);
    expect(/** @type {any} */ (p).junk).toBeUndefined();
  });
  it("remember() keeps the newest entries", () => {
    expect(remember({ a: 1, b: 2, c: 3 }, "a", 9, 3)).toEqual({ b: 2, c: 3, a: 9 });
    expect(Object.keys(remember({ a: 1, b: 2, c: 3 }, "d", 4, 3))).toEqual(["b", "c", "d"]);
  });
});

describe("the critical path", () => {
  const bar = (/** @type {string} */ key, /** @type {string} */ start, /** @type {string} */ end) => ({ key, start, end });
  it("ends at the linked item finishing last, back through the blocker that finishes latest", () => {
    const bars = [bar("A-1", "2026-11-01", "2026-11-10"), bar("A-2", "2026-11-01", "2026-11-05"), bar("A-3", "2026-11-11", "2026-11-20"), bar("A-4", "2026-11-21", "2026-12-05"), bar("A-5", "2026-11-01", "2026-12-20")];
    const links = [{ from: "A-1", to: "A-3" }, { from: "A-2", to: "A-3" }, { from: "A-3", to: "A-4" }];
    expect(criticalPath(bars, links)).toEqual({ keys: ["A-1", "A-3", "A-4"], finish: "2026-12-05" });
  });
  it("none without dependencies, or when the linked items have no dates", () => {
    expect(criticalPath([bar("A-1", "2026-11-01", "2026-11-10")], [])).toBeNull();
    expect(criticalPath([{ key: "A-1", start: null, end: null }, bar("A-2", "2026-11-01", "2026-11-05")], [{ from: "A-1", to: "A-2" }])).toBeNull();
  });
  it("the chain ending at the blocked item that finishes last, even when a blocker itself ends later", () => {
    // As on the dev data: WCC-18 (ends 25 Oct) blocks WCC-12 (ends 23 Oct); WCC-23 blocks WCC-21 (ends 19 Oct).
    const bars = [bar("W-23", "2026-08-19", "2026-10-12"), bar("W-21", "2026-08-17", "2026-10-19"), bar("W-18", "2026-08-14", "2026-10-25"), bar("W-12", "2026-08-11", "2026-10-23")];
    expect(criticalPath(bars, [{ from: "W-23", to: "W-21" }, { from: "W-18", to: "W-12" }])).toEqual({ keys: ["W-18", "W-12"], finish: "2026-10-23" });
  });
  it("a loop in the dependencies doesn't run forever", () => {
    const bars = [bar("A-1", "2026-11-01", "2026-11-10"), bar("A-2", "2026-11-11", "2026-11-20")];
    expect(criticalPath(bars, [{ from: "A-1", to: "A-2" }, { from: "A-2", to: "A-1" }])).toEqual({ keys: ["A-1", "A-2"], finish: "2026-11-20" });
  });
});
