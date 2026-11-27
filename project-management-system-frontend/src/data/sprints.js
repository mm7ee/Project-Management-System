/** @import { WorkItemSummary } from './workitems' */
export const MIN_WEEKS = 1;
export const MAX_WEEKS = 4;
/**
 * The last day of a sprint that starts on `start` (YYYY-MM-DD) and lasts `weeks`.
 * @param {string} start
 * @param {number} weeks
 * @returns {string}
 */
export function sprintEnd(start, weeks) {
  return new Date(Date.parse(`${start}T00:00:00Z`) + (weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
}
/**
 * Calendar days left in a sprint, today counted; 0 once it has ended.
 * @param {string} endDate
 * @param {number} now
 * @returns {number}
 */
export function daysLeft(endDate, now) {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return Math.max(0, Math.round((Date.parse(endDate) - today) / 86400000) + 1);
}
/**
 * Average completed points over the last few closed sprints, or null with none.
 * @param {{ completedPoints: number }[]} snapshots
 * @param {number} [last=3]
 * @returns {number | null}
 */
export function averageVelocity(snapshots, last = 3) {
  const recent = snapshots.slice(0, last);
  return recent.length ? Math.round((recent.reduce((n, s) => n + s.completedPoints, 0) / recent.length) * 10) / 10 : null;
}
/** Days between two dates (ISO strings), to one decimal place. */
export const daysBetween =
  /** @param {string} from
   * @param {string} to
   * @returns {number}
   */ (from, to) => Math.round(((Date.parse(to) - Date.parse(from)) / 86400000) * 10) / 10;
/**
 * Median and the 85th percentile, the usual way to quote cycle and lead times.
 * @param {number[]} values
 * @returns {{ median: number; p85: number } | null}
 */
export function percentiles(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const at = /** @param {number} q */ (q) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  return { median: at(0.5), p85: at(0.85) };
}
/**
 * A trailing average over `window` points, for the control chart.
 * @param {number[]} values
 * @param {number} [window=5]
 * @returns {number[]}
 */
export function rollingAverage(values, window = 5) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round((slice.reduce((n, x) => n + x, 0) / slice.length) * 10) / 10;
  });
}
/**
 * Points more than two standard deviations above the mean: the control chart's outliers.
 * @param {number[]} values
 * @returns {number | null}
 */
export function outlierLimit(values) {
  if (values.length < 3) return null;
  const mean = values.reduce((n, x) => n + x, 0) / values.length;
  const sd = Math.sqrt(values.reduce((n, x) => n + (x - mean) ** 2, 0) / values.length);
  return Math.round((mean + 2 * sd) * 10) / 10;
}
/** @typedef {"kanban" | "scrum"} AgileMode */
/** @typedef {"FUTURE" | "ACTIVE" | "CLOSED"} SprintState */
/** @typedef {Sprint & SprintWithItemsOwn} SprintWithItems */
/**
 * @typedef {Object} SprintSnapshot
 * @property {number} committedPoints
 * @property {number} completedPoints
 * @property {number} addedPoints
 * @property {number} removedPoints
 * @property {number} notCompletedPoints
 * @property {number} committedItems
 * @property {number} completedItems
 * @property {number} addedItems
 * @property {number} removedItems
 * @property {number} notCompletedItems
 */
/**
 * @typedef {Object} Sprint
 * @property {string} id
 * @property {string} systemId
 * @property {string} name
 * @property {string} goal
 * @property {string} startDate
 * @property {string} endDate
 * @property {number} lengthWeeks
 * @property {SprintState} state
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {SprintSnapshot} [snapshot]
 */
/**
 * @typedef {Object} SprintWithItemsOwn
 * @property {WorkItemSummary[]} items
 * @property {number} points
 * @property {number} donePoints
 */
/**
 * @typedef {Object} BacklogData
 * @property {AgileMode} mode
 * @property {SprintWithItems[]} sprints
 * @property {WorkItemSummary[]} backlog
 * @property {number} backlogTotal
 * @property {Object} velocity
 * @property {number | null} velocity.average
 * @property {{ name: string; committed: number; completed: number }[]} velocity.recent
 * @property {boolean} canPlan
 */
/**
 * @typedef {Object} TimelineBar
 * @property {string} key
 * @property {string} id
 * @property {string} systemId
 * @property {string} summary
 * @property {WorkItemSummary["type"]} type
 * @property {string} statusName
 * @property {WorkItemSummary["statusCategory"]} statusCategory
 * @property {string} [assignee]
 * @property {string | null} start
 * @property {string | null} end
 * @property {boolean} [derived]
 * @property {boolean} canEdit
 * @property {TimelineBar[]} [children]
 */
/**
 * @typedef {Object} TimelineProject
 * @property {string} id
 * @property {string} key
 * @property {string} name
 * @property {string | null} start
 * @property {string | null} end
 * @property {boolean} canEdit
 * @property {TimelineBar[]} epics
 * @property {TimelineBar[]} loose
 */
/**
 * @typedef {Object} TimelineLink
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {string} [warning]
 */
