/** @import { Pcn } from './pcn' */
export {}; // the type imports above belong to the file, not to the first declaration
/** @type {Record<Status, { label: string; tone: string }>} */ export const STATUS_META = {
  LIVE: { label: "Live", tone: "green" },
  COMPLETED: { label: "Completed", tone: "navy" },
  WIP: { label: "In progress", tone: "cyan" },
  TESTING: { label: "Testing", tone: "violet" },
  TO_DEPLOY: { label: "To deploy", tone: "amber" },
  UPCOMING: { label: "Upcoming", tone: "slate" },
  IDEA: { label: "Idea", tone: "light" },
};
/** @type {Record<Schedule, { label: string; tone: string }>} */ export const SCHEDULE_META = {
  ON_TRACK: { label: "On track", tone: "green" },
  AT_RISK: { label: "At risk", tone: "amber" },
  OVERDUE: { label: "Overdue", tone: "red" },
  DONE: { label: "Done", tone: "navy" },
  UNSCHEDULED: { label: "No date", tone: "slate" },
};
const DAY = 86400000;
/**
 * A project due within this many days that isn't finished counts as at risk.
 * @type {7}
 */
const AT_RISK_DAYS = 7;
/**
 * Calendar days from `now` until `iso`: 0 on the day itself, negative once it has passed.
 * @param {string} iso
 * @param {number} now
 * @returns {number}
 */
export function daysUntil(iso, now) {
  const midnight = /** @param {number | string} t */ (t) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((midnight(iso) - midnight(now)) / DAY);
}
/**
 * @param {System} s
 * @param {number} now
 * @returns {Schedule}
 */
export function getSchedule(s, now) {
  if (s.finishedAt) return "DONE";
  if (!s.dueAt) return s.status === "UPCOMING" && daysUntil(s.startedAt, now) > 0 ? "ON_TRACK" : "UNSCHEDULED";
  const left = daysUntil(s.dueAt, now);
  if (left < 0) return "OVERDUE";
  return left <= AT_RISK_DAYS ? "AT_RISK" : "ON_TRACK";
}
/**
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
/** @type {Record<Health, string>} */ export const HEALTH_META = {
  Stable: "Delivered, reliable and fully working: little to no ongoing maintenance.",
  Maintenance: "Completed or live, with minor updates, improvements or version upgrades under way.",
};
/** @typedef {"LIVE" | "COMPLETED" | "WIP" | "TESTING" | "TO_DEPLOY" | "UPCOMING" | "IDEA"} Status */
/** @typedef {"Stable" | "Maintenance"} Health */
/** @typedef {"ON_TRACK" | "AT_RISK" | "OVERDUE" | "DONE" | "UNSCHEDULED"} Schedule */
/**
 * @typedef {Object} System
 * @property {string} id
 * @property {string} [key]
 * @property {boolean} [progressFromItems]
 * @property {boolean} [hasWorkItems]
 * @property {"kanban" | "scrum"} [agileMode]
 * @property {string} name
 * @property {string} short
 * @property {string} description
 * @property {string} url
 * @property {Status} status
 * @property {Health} [health]
 * @property {string} [maintenanceNote]
 * @property {string} [maintenanceSince]
 * @property {string} owner
 * @property {string} [workspace]
 * @property {string} [lead]
 * @property {number} engagement
 * @property {number} progress
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {string} [dueAt]
 * @property {string} [updatedAt]
 * @property {string} [updatedBy]
 * @property {string} [template]
 * @property {Pcn} [pcn]
 * @property {string} [pcnBy]
 */
