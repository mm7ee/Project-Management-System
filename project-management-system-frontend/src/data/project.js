/** @import { System } from './systems' */
/** @import { User } from './roles' */
/** @import { Feature } from './features' */
import { isOpen } from "./features";
/** @type {Limits} */ export const DEFAULT_LIMITS = { projects: 3, features: 5, stallDays: 14, capacityHours: 30 };
/**
 * Workspaces group projects by the part of the business they serve. Administrators edit the list.
 * @type {string[]}
 */
export const DEFAULT_WORKSPACES = ["Projects", "HR"];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DAY = 86400000;
/**
 * Being built right now: started, not delivered, not a mere idea.
 * @param {System} s
 * @param {number} now
 * @returns {boolean}
 */
export function isActive(s, now) {
  if (s.finishedAt || s.status === "LIVE" || s.status === "COMPLETED" || s.status === "IDEA") return false;
  return new Date(s.startedAt).getTime() <= now;
}
/** When the project last moved: its last progress update, else when it was delivered or started. */
export const lastUpdateOf =
  /** @param {Pick<System, "updatedAt" | "finishedAt" | "startedAt">} s
   * @returns {string}
   */ (s) => s.updatedAt ?? s.finishedAt ?? s.startedAt;
/**
 * Days since the last progress update on an active project, once that reaches the limit; else null.
 * @param {System} s
 * @param {number} now
 * @param {Limits} limits
 * @returns {number | null}
 */
export function stalledDays(s, now, limits) {
  if (!isActive(s, now)) return null;
  const last = new Date(s.updatedAt ?? s.startedAt).getTime();
  const days = Math.floor((now - last) / DAY);
  return days >= limits.stallDays ? days : null;
}
/**
 * @param {User} user
 * @param {System[]} systems
 * @param {Feature[]} features
 * @param {Limits} limits
 * @param {number} [_now]
 * @returns {Workload}
 */
export function workloadOf(user, systems, features, limits, _now) {
  const projects = systems.filter((s) => user.projectIds?.includes(s.id)).length;
  const openFeatures = features.filter((f) => f.assignee === user.id && isOpen(f)).length;
  const reasons = [...(projects > limits.projects ? [`${projects} projects (limit ${limits.projects})`] : []), ...(openFeatures > limits.features ? [`${openFeatures} open feature requests (limit ${limits.features})`] : [])];
  return { projects, full: projects >= limits.projects, openFeatures, overloaded: reasons.length > 0, reasons };
}
/**
 * @param {number} n
 * @returns {string}
 */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/**
 * Developers who could take on (more of) a project, best first: not overloaded, fewest active
 * projects, then fewest open requests. People already on `excludeSystem` are left out.
 * @param {User[]} users
 * @param {System[]} systems
 * @param {Feature[]} features
 * @param {Limits} limits
 * @param {number} now
 * @param {string} [excludeSystem]
 * @param {number} [max=3]
 * @returns {Suggestion[]}
 */
export function suggestDevelopers(users, systems, features, limits, now, excludeSystem, max = 3) {
  return users
    .filter((u) => u.role === "developer" && !(excludeSystem && u.projectIds?.includes(excludeSystem)))
    .map((user) => ({ user, load: workloadOf(user, systems, features, limits, now) }))
    .filter((x) => !x.load.overloaded && !x.load.full)
    .sort((a, b) => a.load.projects - b.load.projects || a.load.openFeatures - b.load.openFeatures || a.user.name.localeCompare(b.user.name))
    .slice(0, max)
    .map((x) => ({
      ...x,
      why: !x.load.projects && !x.load.openFeatures ? "No projects" : [`${x.load.projects} project${x.load.projects === 1 ? "" : "s"}`, ...(x.load.openFeatures ? [`${x.load.openFeatures} open request${x.load.openFeatures === 1 ? "" : "s"}`] : [])].join(", "),
    }));
}
/**
 * @typedef {Object} ProjectDocument
 * @property {string} id
 * @property {string} systemId
 * @property {string} name
 * @property {"file" | "link"} kind
 * @property {string} [url]
 * @property {string} [mime]
 * @property {number} [size]
 * @property {string} uploadedBy
 * @property {string} uploadedAt
 */
/**
 * @typedef {Object} Blocker
 * @property {string} id
 * @property {string} systemId
 * @property {string} text
 * @property {string} raisedBy
 * @property {string} raisedAt
 * @property {string} [resolvedBy]
 * @property {string} [resolvedAt]
 * @property {string} [resolution]
 */
/**
 * When a developer counts as overloaded, and when a project counts as stalled. Set by an admin.
 * @typedef {Object} Limits
 * @property {number} projects
 * @property {number} features
 * @property {number} stallDays
 * @property {number} [capacityHours] Hours a person can work in a week (the project page's workload chart). 30 by default.
 */
/**
 * @typedef {Object} Workload
 * @property {number} projects
 * @property {boolean} full
 * @property {number} openFeatures
 * @property {boolean} overloaded
 * @property {string[]} reasons
 */
/**
 * @typedef {Object} Suggestion
 * @property {User} user
 * @property {Workload} load
 * @property {string} why
 */
