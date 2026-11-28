/** @import { TemplateDefinition } from './lifecycle' */
/** @import { WorkCalendar } from './workCalendar' */
// When will the project finish? Two honest answers, shared by the Worker and the screens (DECISIONS.md, "Project
// page"):
//   - From work items: a Monte Carlo simulation over the last 8–12 weeks of throughput (items resolved a week),
//     giving the dates it is 50% and 85% likely to be done by. With too little history it says so; it never guesses.
//   - From the lifecycle: what is left of the current stage's target plus the targets of the stages after it, in
//     business days on the organisation's calendar.
import { addWorkingMinutes } from "./workCalendar";
import { stageIndex } from "./lifecycle";

export const FORECAST_RULES = /** @type {const} */ ({
  /** Weeks of throughput the simulation draws from, at most. */
  maxWeeks: 12,
  /** Fewer complete weeks of history than this: no forecast. */
  minWeeks: 4,
  /** Fewer items resolved over those weeks than this: no forecast. */
  minResolved: 10,
  runs: 10000,
  /** A run that hasn't finished after this many weeks stops there (about ten years). */
  horizonWeeks: 520,
});
const DAY = 86_400_000;

/**
 * A small seeded random number generator (mulberry32), so the same data always gives the same forecast.
 * @param {number} seed
 * @returns {() => number} numbers in [0, 1)
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** @param {string} text */
export const seedOf = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
/**
 * The Monte Carlo forecast from weekly throughput.
 * @param {{ weekly: number[]; remaining: number; now: number; seed?: number; runs?: number }} input
 *   weekly: items resolved in each complete week, oldest first (only weeks since work on the project began);
 *   remaining: open work items.
 * @returns {ItemsForecast}
 */
export function throughputForecast({ weekly, remaining, now, seed = 1, runs = FORECAST_RULES.runs }) {
  const R = FORECAST_RULES;
  const weeks = weekly.slice(-R.maxWeeks).map((n) => Math.max(0, Math.floor(Number(n) || 0)));
  const resolved = weeks.reduce((a, n) => a + n, 0);
  const history = { weeks: weeks.length, resolved, min: weeks.length ? Math.min(...weeks) : 0, max: weeks.length ? Math.max(...weeks) : 0 };
  if (remaining <= 0) return { status: "done", remaining: 0, history, explanation: "Every work item is done." };
  if (weeks.length < R.minWeeks) {
    return { status: "insufficient", remaining, history, explanation: `Not enough history to forecast: ${weeks.length} ${weeks.length === 1 ? "week" : "weeks"} of work so far; ${R.minWeeks} are needed.` };
  }
  if (resolved < R.minResolved) {
    return { status: "insufficient", remaining, history, explanation: `Not enough history to forecast: ${resolved} ${resolved === 1 ? "item" : "items"} resolved in the last ${weeks.length} weeks; at least ${R.minResolved} are needed.` };
  }
  const rand = seededRandom(seed);
  const finish = new Array(runs);
  for (let r = 0; r < runs; r++) {
    let left = remaining;
    let w = 0;
    while (left > 0 && w < R.horizonWeeks) {
      left -= weeks[Math.floor(rand() * weeks.length)];
      w++;
    }
    finish[r] = w;
  }
  finish.sort((a, b) => a - b);
  const p50 = finish[Math.floor(runs * 0.5)];
  const p85 = finish[Math.min(runs - 1, Math.floor(runs * 0.85))];
  const at = (/** @type {number} */ w) => new Date(now + w * 7 * DAY).toISOString().slice(0, 10);
  return {
    status: "ok",
    remaining,
    history,
    p50: { weeks: p50, date: at(p50) },
    p85: { weeks: p85, date: at(p85) },
    explanation: `Simulated ${runs.toLocaleString("en-GB")} times: each run draws weeks at random from the last ${weeks.length} weeks of throughput (${history.min}–${history.max} items resolved a week) until the ${remaining} open ${remaining === 1 ? "item is" : "items are"} done. Half the runs finished by the 50% date, 85 in 100 by the 85% date.`,
  };
}
/**
 * The finish date if every remaining stage takes exactly its target.
 * @param {TemplateDefinition} def
 * @param {string} code the current stage
 * @param {number} usedDays business days already spent in it
 * @param {number} now
 * @param {WorkCalendar} cal
 * @returns {{ businessDays: number; date: string } | null} null when no stage has a target
 */
export function lifecycleForecast(def, code, usedDays, now, cal) {
  const i = stageIndex(def, code);
  if (i < 0) return null;
  const rest = def.stages.slice(i);
  if (!rest.some((s) => s.targetDays)) return null;
  const left = Math.max(0, (rest[0].targetDays ?? 0) - usedDays) + rest.slice(1).reduce((a, s) => a + (s.targetDays ?? 0), 0);
  const [sh, sm] = cal.start.split(":").map(Number);
  const [eh, em] = cal.end.split(":").map(Number);
  const dayMinutes = Math.max(60, eh * 60 + em - (sh * 60 + sm));
  return { businessDays: Math.round(left * 10) / 10, date: new Date(addWorkingMinutes(now, left * dayMinutes, cal)).toISOString().slice(0, 10) };
}
/**
 * Calendar days from the target to the forecast (positive: late). Null without either date.
 * @param {string | null | undefined} forecast YYYY-MM-DD
 * @param {string | null | undefined} target YYYY-MM-DD
 */
export function varianceDays(forecast, target) {
  if (!forecast || !target) return null;
  return Math.round((Date.parse(forecast.slice(0, 10)) - Date.parse(target.slice(0, 10))) / DAY);
}
/**
 * @typedef {Object} ItemsForecast
 * @property {"ok" | "insufficient" | "done"} status
 * @property {number} remaining
 * @property {{ weeks: number; resolved: number; min: number; max: number }} history
 * @property {{ weeks: number; date: string }} [p50]
 * @property {{ weeks: number; date: string }} [p85]
 * @property {string} explanation How it was worked out, or why there is no forecast.
 */
