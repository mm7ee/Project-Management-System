// The BI dashboard (Reports → Overview): cross-filtering over projects and feature requests. Clicking a bar,
// slice or tile adds a filter; every chart then shows only what matches every filter except its own, so its
// own choices stay visible (and highlighted) while the rest of the page narrows. Pure functions, tested.

import { getSchedule, type Schedule, type System } from "./systems";
import { isOpen, type Feature, type FeatureKind } from "./features";
import type { Blocker } from "./project";

export type Stage = "NOT_STARTED" | "WIP" | "TESTING" | "TO_DEPLOY" | "LIVE" | "COMPLETED";
export const stageOf = (s: System): Stage => (s.status === "IDEA" || s.status === "UPCOMING" ? "NOT_STARTED" : s.status);

export interface BiFilters {
  workspace: string[];
  stage: Stage[];
  schedule: Schedule[];
  lead: string[]; // user ids; NO_LEAD for none
  project: string[];
  client: string[];
  kind: FeatureKind[];
}
export type Dim = keyof BiFilters;
export const NO_LEAD = "__none";
export const EMPTY_FILTERS: BiFilters = { workspace: [], stage: [], schedule: [], lead: [], project: [], client: [], kind: [] };

/** Adds the value to that filter, or takes it off if it's already there. */
export function toggle<D extends Dim>(f: BiFilters, dim: D, value: BiFilters[D][number]): BiFilters {
  const list = f[dim] as string[];
  const next = list.includes(value as string) ? list.filter((v) => v !== value) : [...list, value as string];
  return { ...f, [dim]: next };
}

export const activeCount = (f: BiFilters) => Object.values(f).reduce((n, v) => n + v.length, 0);

export interface BiData {
  systems: System[];
  features: Feature[];
  blockers: Blocker[];
  workspaces: string[];
  now: number;
}

/** A project's workspace; one that isn't on the list counts in the first, as everywhere else in Pulse. */
export const workspaceOf = (s: System, workspaces: string[]) => (s.workspace && workspaces.includes(s.workspace) ? s.workspace : workspaces[0] ?? "");
export const clientOf = (f: Feature) => f.client.trim() || "No client named";

/**
 * Projects and requests matching every filter except `except`. Project filters narrow the requests to those
 * projects; request filters (client, type) narrow the projects to those with a matching request.
 */
export function applyFilters(d: BiData, f: BiFilters, except?: Dim) {
  const on = (dim: Dim) => dim !== except && f[dim].length > 0;
  const has = <T extends string>(dim: Dim, v: T) => (f[dim] as string[]).includes(v);
  let systems = d.systems.filter(
    (s) =>
      (!on("workspace") || has("workspace", workspaceOf(s, d.workspaces))) &&
      (!on("stage") || has("stage", stageOf(s))) &&
      (!on("schedule") || has("schedule", getSchedule(s, d.now))) &&
      (!on("lead") || has("lead", s.lead ?? NO_LEAD)) &&
      (!on("project") || has("project", s.id)),
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

export interface Kpis {
  projects: number;
  avgProgress: number | null;
  openRequests: number;
  onTimeRate: number | null;
  openBlockers: number;
  overdue: number;
}

export function kpis(d: BiData, f: BiFilters): Kpis {
  const { systems, features, blockers } = applyFilters(d, f);
  const inFlight = systems.filter((s) => !s.finishedAt);
  const timed = features.filter((x) => x.status === "COMPLETED" && x.dueAt);
  const onTime = timed.filter((x) => Date.parse(x.completedAt ?? x.updatedAt) <= new Date(x.dueAt!).setHours(23, 59, 59, 999));
  return {
    projects: systems.length,
    avgProgress: inFlight.length ? Math.round(inFlight.reduce((n, s) => n + s.progress, 0) / inFlight.length) : null,
    openRequests: features.filter(isOpen).length,
    onTimeRate: timed.length ? onTime.length / timed.length : null,
    openBlockers: blockers.filter((b) => !b.resolvedAt).length,
    overdue: systems.filter((s) => getSchedule(s, d.now) === "OVERDUE").length,
  };
}

/** Counts per key, in the order given; keys with nothing are kept so a chart's categories stay put. */
export function countBy<T>(items: T[], key: (x: T) => string, order: string[]): { key: string; n: number }[] {
  const m = new Map(order.map((k) => [k, 0]));
  for (const x of items) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ key: k, n }));
}

/** The last `n` calendar months as YYYY-MM, oldest first. */
export function lastMonths(now: number, n: number): string[] {
  const d = new Date(now);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
  });
}

export interface Tile {
  key: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap: rectangles with areas in proportion to `value`, kept as close to square as it can. */
export function squarify(items: { key: string; value: number }[], x: number, y: number, w: number, h: number): Tile[] {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((n, i) => n + i.value, 0);
  if (!list.length || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  const out: Tile[] = [];
  let rest = list.map((i) => ({ ...i, area: i.value * scale }));
  let box = { x, y, w, h };
  const worst = (row: { area: number }[], side: number) => {
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
