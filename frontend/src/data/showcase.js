/** @import { Schedule, System } from './systems' */
/** @import { User } from './roles' */
/** @import { Feature, Priority } from './features' */
/** @import { Limits } from './project' */
// The public showcase at /executive: totals only. Built on the server so that names of systems,
// people, blockers and descriptions never reach a visitor who isn't signed in.
import { SCHEDULE_META, getSchedule } from "./systems";
import { isLate, isOpen } from "./features";
import { isActive, stalledDays, workloadOf } from "./project";
import { needsAttention } from "./projectHealth";
const stageOf =
  /**
   * @param {System} s
   * @returns {Stage}
   */ (s) => (s.status === "IDEA" || s.status === "UPCOMING" ? "NOT_STARTED" : s.status);
/**
 * @param {System[]} systems
 * @param {User[]} users
 * @param {Feature[]} features
 * @param {Set<string>} openBlockerSystems
 * @param {Limits} limits
 * @param {number} now
 * @returns {Showcase}
 */
export function buildShowcase(systems, users, features, openBlockerSystems, limits, now) {
  const year = new Date(now).getFullYear();
  const active = systems.filter((s) => isActive(s, now));
  const stages = /** @type {Record<Stage, number>} */ ({ NOT_STARTED: 0, WIP: 0, TESTING: 0, TO_DEPLOY: 0, LIVE: 0, COMPLETED: 0 });
  const schedule = /** @type {Record<Schedule, number>} */ (Object.fromEntries(Object.keys(SCHEDULE_META).map((k) => [k, 0])));
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
/** @typedef {"NOT_STARTED" | "WIP" | "TESTING" | "TO_DEPLOY" | "LIVE" | "COMPLETED"} Stage */
/**
 * @typedef {Object} Showcase
 * @property {string} generatedAt
 * @property {number} systems
 * @property {number} liveOrDelivered
 * @property {number} inProgress
 * @property {number} deliveredThisYear
 * @property {number} averageProgress
 * @property {number} maintenance
 * @property {Record<Stage, number>} stages
 * @property {Record<Schedule, number>} schedule
 * @property {number} blocked
 * @property {number} stalled
 * @property {number} needsAttention
 * @property {number} developers
 * @property {number} overloadedDevelopers
 * @property {Object} requests
 * @property {number} requests.open
 * @property {number} requests.completed
 * @property {number} requests.late
 * @property {Record<Priority, number>} requests.byPriority
 * @property {number} stallDays
 */
