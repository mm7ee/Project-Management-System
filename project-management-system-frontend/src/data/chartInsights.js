// The project page's charts: the one line under each title that says what the chart shows, and the PQL behind each
// part of a chart, so every figure can be traced to its work items. From the overview's series (worker/overview.js).
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY = 86_400_000;
/** The day after a YYYY-MM-DD date, plus n days. @param {string} d @param {number} n */
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** "14 Nov" @param {string} d */
export const dayMonth = (d) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * @param {{ week: string; scope: number; done: number }[]} weeks
 * @param {any} forecast kpis.forecast
 */
export function burnupInsight(weeks, forecast) {
  if (!weeks.length || !weeks[weeks.length - 1].scope) return "No work items yet: the chart fills in as work is added.";
  const first = weeks.find((w) => w.scope) ?? weeks[0];
  const last = weeks[weeks.length - 1];
  const change = first.scope ? Math.round(((last.scope - first.scope) / first.scope) * 100) : 0;
  const scope = change > 0 ? `Scope grew ${change}% since ${dayMonth(first.week)} (${first.scope} → ${last.scope} items).` : change < 0 ? `Scope shrank ${-change}% since ${dayMonth(first.week)} (${first.scope} → ${last.scope} items).` : `Scope has held at ${last.scope} items since ${dayMonth(first.week)}.`;
  const f = forecast?.items;
  if (f?.status === "done") return `${scope} Every item is done.`;
  if (f?.status !== "ok") return `${scope} ${last.done} done; not enough history yet to forecast.`;
  const late =forecast.target && f.p50.date > forecast.target ? `, ${plural(Math.round((Date.parse(f.p50.date) - Date.parse(forecast.target)) / DAY), "day")} after the due date` : forecast.target ? ", before the due date" : "";
  return `${scope} At this pace the work is 50% likely done by ${dayMonth(f.p50.date)}${late}.`;
}

/** @param {{ created: number; resolved: number }[]} weeks the last few weeks */
export function flowInsight(weeks) {
  const created = weeks.reduce((a, w) => a + w.created, 0);
  const resolved = weeks.reduce((a, w) => a + w.resolved, 0);
  if (!created && !resolved) return "Nothing created or resolved in these weeks.";
  const span = `in the last ${weeks.length} weeks`;
  if (resolved > created) return `${resolved} resolved and ${created} created ${span}: the open list is shrinking.`;
  if (created > resolved) return `${created} created and ${resolved} resolved ${span}: the open list is growing.`;
  return `${created} created and ${resolved} resolved ${span}: the open list is holding steady.`;
}

/** @param {{ todo: number; inProgress: number; done: number }[]} cumulative */
export function cfdInsight(cumulative) {
  const w = cumulative.filter((x) => x.todo + x.inProgress + x.done);
  if (!w.length) return "No status history yet.";
  const wip = w.map((x) => x.inProgress);
  const first = wip[0];
  const last = wip[wip.length - 1];
  const lo = Math.min(...wip);
  const hi = Math.max(...wip);
  if (last >= first + 3 && last >= first * 1.5) return `Work in progress grew from ${first} to ${last} items: finish work before starting more.`;
  if (first >= last + 3 && last <= first / 1.5) return `Work in progress fell from ${first} to ${last} items: work is getting finished.`;
  if (hi - lo <= Math.max(3, hi * 0.5)) return lo === hi ? `In progress has held at ${lo} ${lo === 1 ? "item" : "items"}: no bottleneck.` : `In progress has held between ${lo} and ${hi} items: no bottleneck.`;
  return `In progress has ranged from ${lo} to ${hi} items; it is ${last} now.`;
}

/** @param {{ name: string; days: number; targetDays: number | null; current: boolean }[]} stages */
export function stageInsight(stages) {
  const timed = stages.filter((s) => s.targetDays);
  if (!timed.length) return "No stage with a target has been reached yet.";
  const over = timed.filter((s) => s.days > /** @type {number} */ (s.targetDays));
  if (!over.length) return `Every stage so far is within its target (${plural(timed.length, "stage")}).`;
  const worst = over.reduce((a, s) => (s.days - /** @type {number} */ (s.targetDays) > a.days - /** @type {number} */ (a.targetDays) ? s : a));
  const by = Math.round((worst.days - /** @type {number} */ (worst.targetDays)) * 10) / 10;
  return `${over.length} of ${plural(timed.length, "stage")} ran over; ${worst.name} is the longest overrun${worst.current ? " so far" : ""} (${plural(by, "business day")}).`;
}

/** @param {{ capacityHours: number; people: { name: string; loggedHours: number; plannedHours: number; lead: boolean }[] }} w */
export function workloadInsight(w) {
  if (!w.people.length) return "Nobody is on this project yet.";
  const load = (/** @type {{ loggedHours: number; plannedHours: number }} */ p) => p.loggedHours + p.plannedHours;
  const over = w.people.filter((p) => load(p) > w.capacityHours).sort((a, b) => load(b) - load(a));
  if (over.length) {
    const top = over[0];
    const more = over.length > 1 ? `, and ${plural(over.length - 1, "other")} over too` : "";
    return `${top.name} is ${Math.round((load(top) - w.capacityHours) * 10) / 10} h over the ${w.capacityHours} h weekly capacity${more}.`;
  }
  const free = [...w.people].sort((a, b) => load(a) - load(b))[0];
  return `Everyone is within the ${w.capacityHours} h weekly capacity; ${free.name} has the most room (${Math.round((w.capacityHours - load(free)) * 10) / 10} h free).`;
}

/** PQL for a key: bare when it can be, else quoted. @param {string} key */
const q = (key) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`);
/** The work items created, or resolved, in a week (Monday to Sunday). */
export const weekPql = (/** @type {string} */ key, /** @type {"created" | "resolved"} */ field, /** @type {string} */ week) => `project = ${q(key)} AND ${field} >= ${week} AND ${field} < ${addDays(week, 7)} ORDER BY ${field} ASC`;
/** The work items now in a status category. */
export const categoryPql = (/** @type {string} */ key, /** @type {"todo" | "inProgress" | "done"} */ cat) => `project = ${q(key)} AND statusCategory = ${cat === "todo" ? '"To Do"' : cat === "inProgress" ? '"In Progress"' : "Done"} ORDER BY updated DESC`;
/** Someone's open work items on this project. */
export const personPql = (/** @type {string} */ key, /** @type {string} */ username) => `project = ${q(key)} AND assignee = ${q(username)} AND statusCategory != Done ORDER BY due ASC`;
