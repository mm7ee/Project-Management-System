/** @import { WorkItemSummary, WorkPriority } from './workitems' */
export {}; // the type imports above belong to the file, not to the first declaration
/** @type {Record<RequestKind, string>} */ export const REQUEST_KINDS = {
  incident: "Incident",
  service_request: "Service request",
  change: "Change",
  question: "Question",
};
/** @type {Record<RequestFieldKind, string>} */ export const REQUEST_FIELD_KINDS = {
  text: "Short text",
  textarea: "Long text",
  select: "A choice",
  date: "Date",
};
/** @type {{ key: QueueKey; label: string }[]} */ export const QUEUES = [
  { key: "unassigned", label: "Unassigned" },
  { key: "mine", label: "My open requests" },
  { key: "at_risk", label: "SLA at risk" },
  { key: "breached", label: "Breached" },
  { key: "all_open", label: "All open" },
];
export const AT_RISK_SHARE = 0.75;
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 17;
export const BUSINESS_DAY_MINUTES = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 60;
const HARARE_OFFSET = 2 * 3600000;
const DAY = 86400000;
const MINUTE = 60000;
/** Harare's calendar date (YYYY-MM-DD) for a moment. */
export const harareDay =
  /** @param {number} ms
   * @returns {string}
   */ (ms) => new Date(ms + HARARE_OFFSET).toISOString().slice(0, 10);
/**
 * The business hours of one Harare date, as UTC milliseconds, or null on weekends and holidays.
 * @param {string} day
 * @param {Set<string>} holidays
 * @returns {[number, number] | null}
 */
function businessWindow(day, holidays) {
  const midnightUtc = Date.parse(`${day}T00:00:00.000Z`) - HARARE_OFFSET;
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  if (weekday === 0 || weekday === 6 || holidays.has(day)) return null;
  return [midnightUtc + BUSINESS_START_HOUR * 3600000, midnightUtc + BUSINESS_END_HOUR * 3600000];
}
const overlap =
  /** @param {number} a0
   * @param {number} a1
   * @param {number} b0
   * @param {number} b1
   * @returns {number}
   */ (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
/**
 * Business minutes between two moments, less the paused spans.
 * @param {number} from
 * @param {number} to
 * @param {Set<string>} holidays
 * @param {[number, number][]} [pauses=[]]
 * @returns {number}
 */
export function businessMinutes(from, to, holidays, pauses = []) {
  if (to <= from) return 0;
  let total = 0;
  for (let d = Date.parse(`${harareDay(from)}T00:00:00.000Z`); d <= Date.parse(`${harareDay(to)}T00:00:00.000Z`); d += DAY) {
    const w = businessWindow(new Date(d).toISOString().slice(0, 10), holidays);
    if (!w) continue;
    const s = Math.max(w[0], from);
    const e = Math.min(w[1], to);
    if (e <= s) continue;
    let span = e - s;
    for (const [p0, p1] of pauses) span -= overlap(s, e, p0, p1);
    total += Math.max(0, span);
  }
  return Math.floor(total / MINUTE);
}
/**
 * The moment `minutes` business minutes after `from` (with no further pauses).
 * @param {number} from
 * @param {number} minutes
 * @param {Set<string>} holidays
 * @returns {number}
 */
export function addBusinessMinutes(from, minutes, holidays) {
  let left = minutes * MINUTE;
  let at = from;
  for (let guard = 0; guard < 3660; guard++) {
    const day = harareDay(at);
    const w = businessWindow(day, holidays);
    if (w && at < w[1]) {
      const start = Math.max(at, w[0]);
      if (start + left <= w[1]) return start + left;
      left -= w[1] - start;
    }
    at = Date.parse(`${day}T00:00:00.000Z`) - HARARE_OFFSET + DAY;
  }
  return at;
}
/**
 * One SLA clock. `stoppedAt` is when the target was met (first reply, or resolved); `pauses` are the
 * spans spent waiting for the customer (an open one runs to now).
 * @param {{ start: number; stoppedAt?: number | null; now: number; targetMinutes: number; holidays: Set<string>; pauses: [number, number | null][] }} opts
 * @returns {SlaClock}
 */
export function slaClock(opts) {
  const end = opts.stoppedAt ?? opts.now;
  const pauses = opts.pauses.map(/** @returns {[number, number]} */ ([a, b]) => [a, b ?? opts.now]);
  const elapsed = businessMinutes(opts.start, end, opts.holidays, pauses);
  const paused = !opts.stoppedAt && opts.pauses.some(([, b]) => b === null);
  /** @type {SlaState} */ const state = opts.stoppedAt ? (elapsed <= opts.targetMinutes ? "met" : "breached") : elapsed > opts.targetMinutes ? "breached" : paused ? "paused" : "running";
  const atRisk = (state === "running" || state === "paused") && elapsed >= opts.targetMinutes * AT_RISK_SHARE;
  return {
    targetMinutes: opts.targetMinutes,
    elapsedMinutes: elapsed,
    state,
    atRisk,
    ...(state === "running" ? { dueAt: new Date(addBusinessMinutes(opts.now, opts.targetMinutes - elapsed, opts.holidays)).toISOString() } : {}),
  };
}
/**
 * "2 h 30 min", "1 day 3 h" (business days of 9 hours).
 * @param {number} m
 * @returns {string}
 */
export function formatBusinessMinutes(m) {
  const n = Math.max(0, Math.round(m));
  const days = Math.floor(n / BUSINESS_DAY_MINUTES);
  const h = Math.floor((n % BUSINESS_DAY_MINUTES) / 60);
  const min = n % 60;
  const parts = [days ? `${days} day${days === 1 ? "" : "s"}` : "", h ? `${h} h` : "", min && !days ? `${min} min` : ""].filter(Boolean);
  return parts.join(" ") || "0 min";
}
/** @type {Record<SlaState, string>} */ export const SLA_STATE_LABEL = { running: "On track", paused: "Paused", met: "Met", breached: "Breached" };
/** @typedef {"incident" | "service_request" | "change" | "question"} RequestKind */
/** @typedef {"text" | "textarea" | "select" | "date"} RequestFieldKind */
/** @typedef {"running" | "paused" | "met" | "breached"} SlaState */
/** @typedef {WorkItemSummary & QueueItemOwn} QueueItem */
/** @typedef {"unassigned" | "mine" | "at_risk" | "breached" | "all_open"} QueueKey */
/**
 * @typedef {Object} RequestField
 * @property {string} id
 * @property {string} label
 * @property {RequestFieldKind} kind
 * @property {string} help
 * @property {boolean} required
 * @property {{ id: string; label: string }[]} options
 */
/**
 * @typedef {Object} SlaTarget
 * @property {WorkPriority} priority
 * @property {number} firstResponseMinutes
 * @property {number} resolutionMinutes
 */
/**
 * @typedef {Object} RequestType
 * @property {string} id
 * @property {string} name
 * @property {RequestKind} kind
 * @property {string} description
 * @property {"TASK" | "BUG"} itemType
 * @property {boolean} enabled
 * @property {RequestField[]} fields
 * @property {SlaTarget[]} targets
 */
/**
 * @typedef {Object} Holiday
 * @property {string} day
 * @property {string} name
 */
/**
 * @typedef {Object} PortalLink
 * @property {string} id
 * @property {string} label
 * @property {string} createdBy
 * @property {string} createdAt
 * @property {string} expiresAt
 * @property {string} [revokedAt]
 * @property {string} [lastUsedAt]
 * @property {number} requests
 * @property {string} [url]
 */
/**
 * @typedef {Object} SlaClock
 * @property {number} targetMinutes
 * @property {number} elapsedMinutes
 * @property {SlaState} state
 * @property {boolean} atRisk 75% or more of the target used, and not yet met.
 * @property {string} [dueAt] While running: when it will breach if nothing pauses it.
 */
/**
 * @typedef {Object} RequestInfo
 * @property {string} typeId
 * @property {string} typeName
 * @property {RequestKind} kind
 * @property {string} customerName
 * @property {string} [customerEmail]
 * @property {boolean} viaPortal
 * @property {{ label: string; value: string }[]} answers
 * @property {boolean} waiting
 * @property {SlaClock} firstResponse
 * @property {SlaClock} resolution
 */
/**
 * A request in a queue.
 * @typedef {Object} QueueItemOwn
 * @property {string} requestType
 * @property {RequestKind} kind
 * @property {string} customerName
 * @property {Object} sla
 * @property {SlaClock} sla.firstResponse
 * @property {SlaClock} sla.resolution
 */
/**
 * What the customer sees of their request on the portal: no internal notes, no assignee details.
 * @typedef {Object} PortalRequest
 * @property {string} key
 * @property {string} summary
 * @property {string} description
 * @property {string} typeName
 * @property {string} statusName
 * @property {boolean} done
 * @property {boolean} waiting
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [resolvedAt]
 * @property {{ label: string; value: string }[]} answers
 * @property {{ body: string; fromCustomer: boolean; author: string; at: string }[]} replies
 */
