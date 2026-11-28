/** @import { System } from './systems' */
/** @import { Limits } from './project' */
// Project health (RAG): one rule, shared by the browser and the Worker, so the screen, the exports and the
// dashboard figures always agree. Thresholds live here and nowhere else (DECISIONS.md, "Projects report").
//
// Named "rag" in code because System.health already means Stable / Maintenance for live systems.
import { getSchedule } from "./systems";
import { isActive, stalledDays } from "./project";
export const RAG_RULES = /** @type {const} */ ({
  /** An open blocker older than this many days makes a project Red (any open blocker makes it Amber). */
  blockerDaysRed: 7,
  /** Progress this many points behind the expected pace: Red; `behindAmber` points: Amber. */
  behindRed: 25,
  behindAmber: 10,
  /** Share of open work items past their due date: Red above `overdueShareRed`, Amber above `overdueShareAmber`. */
  overdueShareRed: 0.2,
  overdueShareAmber: 0.1,
  /** Due within this many days and below `dueSoonProgress`%: Amber. */
  dueSoonDays: 7,
  dueSoonProgress: 80,
  /** No progress update for `staleFactorRed` × the stall limit: Red (the stall limit itself: Amber). */
  staleFactorRed: 2,
  /** An update request left unanswered for more than this many working days (Mon–Fri) is overdue. */
  requestOverdueWorkingDays: 3,
  /** A lifecycle stage over its target: Amber; at this many times its target: Red. */
  stageOverFactorRed: 2,
});
/** @type {Record<Rag, { label: string; tone: string; rank: number }>} */ export const RAG_META = {
  RED: { label: "Off track", tone: "red", rank: 3 },
  AMBER: { label: "At risk", tone: "amber", rank: 2 },
  GREEN: { label: "On track", tone: "green", rank: 1 },
  NONE: { label: "Not rated", tone: "slate", rank: 0 },
};
const DAY = 86400000;
/**
 * The progress expected by now if work moved evenly from start to due date; null without a due date.
 * @param {Pick<System, "startedAt" | "dueAt">} s
 * @param {number} now
 * @returns {number | null}
 */
export function expectedProgress(s, now) {
  if (!s.dueAt) return null;
  const start = Date.parse(s.startedAt);
  const due = Date.parse(s.dueAt);
  if (!(due > start)) return null;
  return Math.round(Math.min(1, Math.max(0, (now - start) / (due - start))) * 100);
}
/**
 * The project's RAG and the reasons for it, worst first. Only projects being built are rated: ideas,
 * upcoming, live and completed projects are "Not rated".
 * @param {System} s
 * @param {HealthFacts} facts
 * @param {number} now
 * @param {Limits} limits
 * @returns {{ rag: Rag; reasons: string[] }}
 */
export function ragOf(s, facts, now, limits) {
  if (!isActive(s, now)) return { rag: "NONE", reasons: [s.finishedAt || s.status === "LIVE" || s.status === "COMPLETED" ? "Delivered" : "Not started yet"] };
  /** @type {string[]} */ const red = [];
  /** @type {string[]} */ const amber = [];
  const R = RAG_RULES;
  if (getSchedule(s, now) === "OVERDUE") {
    const late = Math.floor((now - Date.parse(/** @type {NonNullable<typeof s.dueAt>} */ (s.dueAt))) / DAY);
    red.push(`Past its due date (${late} ${late === 1 ? "day" : "days"})`);
  } else if (s.dueAt) {
    const left = Math.ceil((Date.parse(s.dueAt) - now) / DAY);
    if (left <= R.dueSoonDays && s.progress < R.dueSoonProgress) amber.push(`Due in ${left} ${left === 1 ? "day" : "days"} at ${s.progress}%`);
  }
  if (facts.openBlockers) {
    const age = facts.oldestBlockerAt ? Math.floor((now - Date.parse(facts.oldestBlockerAt)) / DAY) : 0;
    if (age > R.blockerDaysRed) red.push(`Blocked for ${age} days`);
    else amber.push(`${facts.openBlockers} open ${facts.openBlockers === 1 ? "blocker" : "blockers"}`);
  }
  const st = facts.stage;
  if (st && st.targetDays > 0 && st.usedDays > st.targetDays) {
    const over = Math.round((st.usedDays - st.targetDays) * 10) / 10;
    (st.usedDays >= st.targetDays * R.stageOverFactorRed ? red : amber).push(`${st.name} is ${over} business ${over === 1 ? "day" : "days"} over its ${st.targetDays}-day target`);
  }
  const stalled = stalledDays(s, now, limits);
  if (stalled !== null) (stalled >= limits.stallDays * R.staleFactorRed ? red : amber).push(`No progress update for ${stalled} days`);
  const expected = expectedProgress(s, now);
  if (expected !== null) {
    const behind = expected - s.progress;
    if (behind > R.behindRed) red.push(`${behind} points behind pace (${s.progress}% against ${expected}% expected)`);
    else if (behind > R.behindAmber) amber.push(`${behind} points behind pace (${s.progress}% against ${expected}% expected)`);
  }
  if (facts.openItems > 0) {
    const share = facts.overdueItems / facts.openItems;
    const words = `${facts.overdueItems} of ${facts.openItems} open work items overdue`;
    if (share > R.overdueShareRed) red.push(words);
    else if (share > R.overdueShareAmber) amber.push(words);
  }
  if (red.length) return { rag: "RED", reasons: [...red, ...amber] };
  if (amber.length) return { rag: "AMBER", reasons: amber };
  return { rag: "GREEN", reasons: ["On pace, unblocked and recently updated"] };
}
/**
 * Working days (Mon–Fri) from `fromIso` to `now`, not counting the first day.
 * @param {string} fromIso
 * @param {number} now
 * @returns {number}
 */
export function workingDaysSince(fromIso, now) {
  const d = new Date(fromIso);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  let n = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
/** An update request still open after the allowed working days. */
export const requestOverdue =
  /** @param {string} createdAt
   * @param {number} now
   * @returns {boolean}
   */ (createdAt, now) => workingDaysSince(createdAt, now) > RAG_RULES.requestOverdueWorkingDays;
/**
 * "Needs attention", the same on the dashboard, the executive page and the Projects report: overdue, due
 * soon (at risk by date), blocked, or stalled. Each project counted once.
 * @param {System} s
 * @param {boolean} hasOpenBlocker
 * @param {number} now
 * @param {Limits} limits
 * @returns {boolean}
 */
export function needsAttention(s, hasOpenBlocker, now, limits) {
  const schedule = getSchedule(s, now);
  return schedule === "OVERDUE" || schedule === "AT_RISK" || hasOpenBlocker || stalledDays(s, now, limits) !== null;
}
/** @typedef {"RED" | "AMBER" | "GREEN" | "NONE"} Rag */
/**
 * What the rule needs to know about one project besides the project itself.
 * @typedef {Object} HealthFacts
 * @property {number} openBlockers
 * @property {string | null} [oldestBlockerAt] When the oldest open blocker was raised.
 * @property {number} openItems
 * @property {number} overdueItems
 * @property {StageFact | null} [stage] The project's current lifecycle stage, when it has one and it has a target.
 */
/**
 * @typedef {Object} StageFact
 * @property {string} name
 * @property {number} usedDays Business days spent in the stage so far.
 * @property {number} targetDays
 */
