/** @import { System } from '../src/data/systems' */
/** @import { Feature } from '../src/data/features' */
/** @import { BiData } from '../src/data/bi' */
// The BI dashboard's cross-filtering (src/data/bi.ts). Run with: npm test
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, applyFilters, kpis, lastMonths, squarify, toggle } from "../src/data/bi";
const NOW = new Date(2026, 10, 25).getTime();
const sys =
  /**
   * @param {string} id
   * @param {Partial<System>} o
   * @returns {System}
   */ (id, o) => ({
    id,
    name: id,
    short: "X",
    description: "",
    url: "",
    status: "WIP",
    owner: "",
    engagement: 0,
    progress: 50,
    startedAt: "2026-01-01",
    ...o,
  });
const feat =
  /**
   * @param {string} id
   * @param {string} systemId
   * @param {Partial<Feature>} o
   * @returns {Feature}
   */ (id, systemId, o) => ({
    id,
    systemId,
    title: id,
    description: "",
    kind: "CHANGE",
    client: "Acme",
    status: "NOT_STARTED",
    priority: "MEDIUM",
    createdBy: "u",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    ...o,
  });
/** @type {BiData} */ const d = {
  systems: [sys("hr1", { workspace: "HR", lead: "ann" }), sys("fin1", { workspace: "Finance", status: "LIVE", finishedAt: "2026-06-01" }), sys("odd", { workspace: "Gone" })],
  features: [feat("a", "hr1", { client: "Acme" }), feat("b", "fin1", { client: "Zuva", kind: "BUG_FIX" }), feat("c", "hr1", { client: "Zuva", status: "COMPLETED", dueAt: "2026-10-10", completedAt: "2026-10-05T00:00:00Z" })],
  blockers: [{ id: "x", systemId: "hr1", text: "", raisedBy: "u", raisedAt: "2026-10-01" }],
  workspaces: ["HR", "Finance"],
  now: NOW,
};
describe("applyFilters", () => {
  it("narrows requests by project filters", () => {
    const r = applyFilters(d, toggle(EMPTY_FILTERS, "workspace", "Finance"));
    expect(r.systems.map((s) => s.id)).toEqual(["fin1"]);
    expect(r.features.map((f) => f.id)).toEqual(["b"]);
  });
  it("counts an unknown workspace in the first one", () => {
    expect(applyFilters(d, toggle(EMPTY_FILTERS, "workspace", "HR")).systems.map((s) => s.id)).toEqual(["hr1", "odd"]);
  });
  it("narrows projects to those with a matching request", () => {
    const r = applyFilters(d, toggle(EMPTY_FILTERS, "client", "Zuva"));
    expect(r.systems.map((s) => s.id)).toEqual(["hr1", "fin1"]);
    expect(r.features.map((f) => f.id)).toEqual(["b", "c"]);
  });
  it("leaves out its own dimension when asked", () => {
    const f = toggle(toggle(EMPTY_FILTERS, "client", "Zuva"), "kind", "BUG_FIX");
    expect(applyFilters(d, f).features.map((x) => x.id)).toEqual(["b"]);
    expect(applyFilters(d, f, "client").features.map((x) => x.id)).toEqual(["b"]);
    expect(applyFilters(d, f, "kind").features.map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("toggles a value off again", () => {
    expect(toggle(toggle(EMPTY_FILTERS, "stage", "WIP"), "stage", "WIP").stage).toEqual([]);
  });
});
describe("kpis", () => {
  it("sums up what's in view", () => {
    expect(kpis(d, EMPTY_FILTERS)).toMatchObject({ projects: 3, avgProgress: 50, openRequests: 2, onTimeRate: 1, openBlockers: 1 });
  });
});
describe("lastMonths", () => {
  it("ends with this month", () => {
    const m = lastMonths(NOW, 3);
    expect(m).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});
describe("squarify", () => {
  it("fills the box exactly, with areas in proportion", () => {
    const t = squarify(
      [
        { key: "a", value: 6 },
        { key: "b", value: 3 },
        { key: "c", value: 1 },
      ],
      0,
      0,
      100,
      50,
    );
    const area = /** @param {string} k */ (k) => {
      const x = /** @type {Tile} */ (t.find((y) => y.key === k));
      return x.w * x.h;
    };
    expect(t.reduce((n, x) => n + x.w * x.h, 0)).toBeCloseTo(5000);
    expect(area("a") / area("c")).toBeCloseTo(6);
    for (const x of t) {
      expect(x.x + x.w).toBeLessThanOrEqual(100.0001);
      expect(x.y + x.h).toBeLessThanOrEqual(50.0001);
    }
  });
});
