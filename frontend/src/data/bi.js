/** @import { Schedule, System } from './systems' */
/** @import { Feature, FeatureKind } from './features' */
/** @import { Blocker } from './project' */
// The BI dashboard (Reports → Overview): cross-filtering over projects and feature requests. Clicking a bar,
// slice or tile adds a filter; every chart then shows only what matches every filter except its own, so its
// own choices stay visible (and highlighted) while the rest of the page narrows. Pure functions, tested.
import { getSchedule } from "./systems";
import { isOpen } from "./features";
export const stageOf =
  /**
   * @param {System} s
   * @returns {Stage}
   */ (s) => (s.status === "IDEA" || s.status === "UPCOMING" ? "NOT_STARTED" : s.status);
export const NO_LEAD = "__none";
/** @type {BiFilters} */ export const EMPTY_FILTERS = { workspace: [], stage: [], schedule: [], lead: [], project: [], client: [], kind: [] };
/**
 * Adds the value to that filter, or takes it off if it's already there.
 * @template {Dim} D
 * @param {BiFilters} f
 * @param {D} dim
 * @param {BiFilters[D][number]} value
 * @returns {BiFilters}
 */
export function toggle(f, dim, value) {
  const list = /** @type {string[]} */ (f[dim]);
  const next = list.includes(/** @type {string} */ (value)) ? list.filter((v) => v !== value) : [...list, /** @type {string} */ (value)];
  return { ...f, [dim]: next };
}
export const activeCount =
  /** @param {BiFilters} f
   * @returns {any}
   */ (f) => Object.values(f).reduce((n, v) => n + v.length, 0);
/** A project's workspace; one that isn't on the list counts in the first, as everywhere else in Pulse. */
export const workspaceOf =
  /** @param {System} s
   * @param {string[]} workspaces
   * @returns {string}
   */ (s, workspaces) => (s.workspace && workspaces.includes(s.workspace) ? s.workspace : (workspaces[0] ?? ""));
export const clientOf =
  /** @param {Feature} f
   * @returns {string}
   */ (f) => f.client.trim() || "No client named";
/**
 * Projects and requests matching every filter except `except`. Project filters narrow the requests to those
 * projects; request filters (client, type) narrow the projects to those with a matching request.
 * @param {BiData} d
 * @param {BiFilters} f
 * @param {Dim} [except]
 * @returns {{ systems: System[]; features: Feature[]; blockers: Blocker[]; }}
 */
export function applyFilters(d, f, except) {
  const on = /** @param {Dim} dim */ (dim) => dim !== except && f[dim].length > 0;
  const has = /** @template {string} T @param {Dim} dim @param {T} v */ (dim, v) => /** @type {string[]} */ (f[dim]).includes(v);
  let systems = d.systems.filter(
    (s) => (!on("workspace") || has("workspace", workspaceOf(s, d.workspaces))) && (!on("stage") || has("stage", stageOf(s))) && (!on("schedule") || has("schedule", getSchedule(s, d.now))) && (!on("lead") || has("lead", s.lead ?? NO_LEAD)) && (!on("project") || has("project", s.id)),
  );
  const ids = new Set(systems.map((s) => s.id));
  const features = d.features.filter((x) => ids.has(x.systemId) && (!on("client") || has("client", clientOf(x))) && (!on("kind") || has("kind", x.kind)));
  if (on("client") || on("kind")) {
    const withRequests = new Set(features.map((x) => x.systemId));
    systems = systems.filter((s) => withRequests.has(s.id));
  }
  const kept = new Set(systems.map((s) => s.id));
  return { systems, features, blockers: d.blockers.filter((b) => kept.has(b.systemId)) };
}
/**
 * @param {BiData} d
 * @param {BiFilters} f
 * @returns {Kpis}
 */
export function kpis(d, f) {
  const { systems, features, blockers } = applyFilters(d, f);
  const inFlight = systems.filter((s) => !s.finishedAt);
  const timed = features.filter((x) => x.status === "COMPLETED" && x.dueAt);
  const onTime = timed.filter((x) => Date.parse(x.completedAt ?? x.updatedAt) <= new Date(/** @type {NonNullable<typeof x.dueAt>} */ (x.dueAt)).setHours(23, 59, 59, 999));
  return {
    projects: systems.length,
    avgProgress: inFlight.length ? Math.round(inFlight.reduce((n, s) => n + s.progress, 0) / inFlight.length) : null,
    openRequests: features.filter(isOpen).length,
    onTimeRate: timed.length ? onTime.length / timed.length : null,
    openBlockers: blockers.filter((b) => !b.resolvedAt).length,
    overdue: systems.filter((s) => getSchedule(s, d.now) === "OVERDUE").length,
  };
}
/**
 * Counts per key, in the order given; keys with nothing are kept so a chart's categories stay put.
 * @template T
 * @param {T[]} items
 * @param {(x: T) => string} key
 * @param {string[]} order
 * @returns {{ key: string; n: number }[]}
 */
export function countBy(items, key, order) {
  const m = new Map(order.map((k) => [k, 0]));
  for (const x of items) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ key: k, n }));
}
/**
 * The last `n` calendar months as YYYY-MM, oldest first.
 * @param {number} now
 * @param {number} n
 * @returns {string[]}
 */
export function lastMonths(now, n) {
  const d = new Date(now);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
  });
}
/**
 * Squarified treemap: rectangles with areas in proportion to `value`, kept as close to square as it can.
 * @param {{ key: string; value: number }[]} items
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Tile[]}
 */
export function squarify(items, x, y, w, h) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((n, i) => n + i.value, 0);
  if (!list.length || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  /** @type {Tile[]} */ const out = [];
  let rest = list.map((i) => ({ ...i, area: i.value * scale }));
  let box = { x, y, w, h };
  const worst = /** @param {{ area: number }[]} row @param {number} side */ (row, side) => {
    const s = row.reduce((n, r) => n + r.area, 0);
    const max = Math.max(...row.map((r) => r.area));
    const min = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (rest.length) {
    const side = Math.min(box.w, box.h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    rest = rest.slice(i);
    const sum = row.reduce((n, r) => n + r.area, 0);
    if (box.w >= box.h) {
      const cw = sum / box.h;
      let cy = box.y;
      for (const r of row) {
        const ch = r.area / cw;
        out.push({ key: r.key, value: r.value, x: box.x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      box = { x: box.x + cw, y: box.y, w: box.w - cw, h: box.h };
    } else {
      const rh = sum / box.w;
      let cx = box.x;
      for (const r of row) {
        const cw = r.area / rh;
        out.push({ key: r.key, value: r.value, x: cx, y: box.y, w: cw, h: rh });
        cx += cw;
      }
      box = { x: box.x, y: box.y + rh, w: box.w, h: box.h - rh };
    }
  }
  return out;
}
/** @typedef {"NOT_STARTED" | "WIP" | "TESTING" | "TO_DEPLOY" | "LIVE" | "COMPLETED"} Stage */
/** @typedef {keyof BiFilters} Dim */
/**
 * @typedef {Object} BiFilters
 * @property {string[]} workspace
 * @property {Stage[]} stage
 * @property {Schedule[]} schedule
 * @property {string[]} lead
 * @property {string[]} project
 * @property {string[]} client
 * @property {FeatureKind[]} kind
 */
/**
 * @typedef {Object} BiData
 * @property {System[]} systems
 * @property {Feature[]} features
 * @property {Blocker[]} blockers
 * @property {string[]} workspaces
 * @property {number} now
 */
/**
 * @typedef {Object} Kpis
 * @property {number} projects
 * @property {number | null} avgProgress
 * @property {number} openRequests
 * @property {number | null} onTimeRate
 * @property {number} openBlockers
 * @property {number} overdue
 */
/**
 * @typedef {Object} Tile
 * @property {string} key
 * @property {number} value
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */
