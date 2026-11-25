// Feature requests: work a client asks for on a project, new or already delivered.
// Shared by the UI and the Worker. Each request is a work item (source "client_request"); the
// `features` database view shows them in the shape below.
/** @type {Record<FeatureKind, string>} */ export const KIND_META = {
  NEW_MODULE: "New module",
  CHANGE: "Change",
  ENHANCEMENT: "Enhancement",
  BUG_FIX: "Bug fix",
};
/** @type {Record<FeatureStatus, { label: string; tone: string }>} */ export const FEATURE_STATUS_META = {
  NOT_STARTED: { label: "Not started", tone: "slate" },
  IN_PROGRESS: { label: "In progress", tone: "cyan" },
  ON_HOLD: { label: "On hold", tone: "amber" },
  TESTING: { label: "Testing", tone: "violet" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "light" },
};
/** Highest first; the order lists are sorted by. */
/** @type {Record<Priority, { label: string; rank: number }>} */ export const PRIORITY_META = {
  CRITICAL: { label: "Critical", rank: 0 },
  HIGH: { label: "High", rank: 1 },
  MEDIUM: { label: "Medium", rank: 2 },
  LOW: { label: "Low", rank: 3 },
};
export const FEATURE_KINDS = /** @type {FeatureKind[]} */ (Object.keys(KIND_META));
export const FEATURE_STATUSES = /** @type {FeatureStatus[]} */ (Object.keys(FEATURE_STATUS_META));
export const PRIORITIES = /** @type {Priority[]} */ (Object.keys(PRIORITY_META));
/** Still to be delivered: not completed and not cancelled. */
export const isOpen =
  /** @param {Feature} f
   * @returns {boolean}
   */ (f) => f.status !== "COMPLETED" && f.status !== "CANCELLED";
/**
 * Open and past its expected delivery date (the due day itself still counts as on time).
 * @param {Feature} f
 * @param {number} now
 * @returns {boolean}
 */
export function isLate(f, now) {
  if (!isOpen(f) || !f.dueAt) return false;
  return new Date(f.dueAt).setHours(23, 59, 59, 999) < now;
}
/**
 * Priority first, then the earliest due date, then the oldest request.
 * @param {Feature} a
 * @param {Feature} b
 * @returns {number}
 */
export function byUrgency(a, b) {
  return PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.createdAt.localeCompare(b.createdAt);
}
/** @typedef {"NEW_MODULE" | "CHANGE" | "ENHANCEMENT" | "BUG_FIX"} FeatureKind */
/** @typedef {"NOT_STARTED" | "IN_PROGRESS" | "ON_HOLD" | "TESTING" | "COMPLETED" | "CANCELLED"} FeatureStatus */
/** @typedef {"CRITICAL" | "HIGH" | "MEDIUM" | "LOW"} Priority */
/**
 * @typedef {Object} Feature
 * @property {string} id
 * @property {string} systemId
 * @property {string} title
 * @property {string} description
 * @property {FeatureKind} kind
 * @property {string} client
 * @property {FeatureStatus} status
 * @property {Priority} priority
 * @property {string} [assignee]
 * @property {string} [notes]
 * @property {string} [dueAt]
 * @property {string} createdBy
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [completedAt]
 * @property {string} [key]
 */
