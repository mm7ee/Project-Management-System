// The public showcase at /executive: totals only. Built on the server so that names of systems,
// people, blockers and descriptions never reach a visitor who isn't signed in.

import { SCHEDULE_META, getSchedule, type Schedule, type System } from "./systems";
import type { User } from "./roles";
import { isLate, isOpen, type Feature, type Priority } from "./features";
import { isActive, stalledDays, workloadOf, type Limits } from "./project";
import { needsAttention } from "./projectHealth";

export type Stage = "NOT_STARTED" | "WIP" | "TESTING" | "TO_DEPLOY" | "LIVE" | "COMPLETED";

export interface Showcase {
  generatedAt: string;
  systems: number;
  liveOrDelivered: number;
  inProgress: number;
  deliveredThisYear: number;
  averageProgress: number; // of systems in progress
  maintenance: number;
  stages: Record<Stage, number>;
  schedule: Record<Schedule, number>;
  blocked: number;
  stalled: number;
  needsAttention: number; // overdue, due soon, blocked or stalled (each system counted once; projectHealth.ts)
  developers: number;
  overloadedDevelopers: number;
  requests: { open: number; completed: number; late: number; byPriority: Record<Priority, number> };
  stallDays: number;
}

const stageOf = (s: System): Stage => (s.status === "IDEA" || s.status === "UPCOMING" ? "NOT_STARTED" : s.status);

export function buildShowcase(
  systems: System[],
  users: User[],
  features: Feature[],
  openBlockerSystems: Set<string>,
  limits: Limits,
  now: number,
): Showcase {
  const year = new Date(now).getFullYear();
  const active = systems.filter((s) => isActive(s, now));
  const stages = { NOT_STARTED: 0, WIP: 0, TESTING: 0, TO_DEPLOY: 0, LIVE: 0, COMPLETED: 0 } as Record<Stage, number>;
  const schedule = Object.fromEntries(Object.keys(SCHEDULE_META).map((k) => [k, 0])) as Record<Schedule, number>;
  systems.forEach((s) => {
    stages[stageOf(s)]++;
    schedule[getSchedule(s, now)]++;
  });
  const stalled = systems.filter((s) => stalledDays(s, now, limits) !== null);
  // The shared rule (src/data/projectHealth.ts), so the dashboard, this page and Reports agree.
  const attention = systems.filter((s) => needsAttention(s, openBlockerSystems.has(s.id), now, limits));
  const developers = users.filter((u) => u.role === "developer");
  const open = features.filter(isOpen);
  return {
    generatedAt: new Date(now).toISOString(),
    systems: systems.length,
    liveOrDelivered: systems.filter((s) => s.status === "LIVE" || s.status === "COMPLETED").length,
    inProgress: active.length,
    deliveredThisYear: systems.filter((s) => s.finishedAt && new Date(s.finishedAt).getFullYear() === year).length,
    averageProgress: active.length ? Math.round(active.reduce((n, s) => n + s.progress, 0) / active.length) : 0,
    maintenance: systems.filter((s) => s.health === "Maintenance").length,
    stages,
    schedule,
    blocked: systems.filter((s) => openBlockerSystems.has(s.id)).length,
    stalled: stalled.length,
    needsAttention: attention.length,
    developers: developers.length,
    overloadedDevelopers: developers.filter((d) => workloadOf(d, systems, features, limits, now).overloaded).length,
    requests: {
      open: open.length,
      completed: features.filter((f) => f.status === "COMPLETED").length,
      late: open.filter((f) => isLate(f, now)).length,
      byPriority: {
        CRITICAL: open.filter((f) => f.priority === "CRITICAL").length,
        HIGH: open.filter((f) => f.priority === "HIGH").length,
        MEDIUM: open.filter((f) => f.priority === "MEDIUM").length,
        LOW: open.filter((f) => f.priority === "LOW").length,
      },
    },
    stallDays: limits.stallDays,
  };
}
