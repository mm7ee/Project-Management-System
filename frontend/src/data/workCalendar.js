// An organisation's working time (Settings → Organisation → Profile): its time zone, working days and hours, and
// public holidays. SLA clocks for work items count only working minutes. Shared by the Worker and the screens; unit
// tested in tests/workCalendar.test.js. (The service desk keeps its own Harare 08:00–17:00 clock.)

/**
 * @typedef {Object} WorkCalendar
 * @property {string} timeZone   such as Africa/Harare
 * @property {number[]} workDays  ISO weekdays, 1 Monday … 7 Sunday
 * @property {string} start      "08:00"
 * @property {string} end        "17:00"
 * @property {Set<string>} holidays  YYYY-MM-DD, local dates
 *
 * @typedef {Object} SlaTarget
 * @property {"response" | "resolution"} target
 * @property {number} targetMinutes
 * @property {number} elapsedMinutes
 * @property {"running" | "warning" | "breached" | "met" | "missed"} state  met: done in time; missed: done late
 * @property {string} [dueAt]    when it will be breached, if it's still running
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Minutes the time zone is ahead of UTC at a moment. @param {number} at @param {string} timeZone */
function offsetMinutes(at, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - Math.floor(at / 1000) * 1000) / MINUTE);
}
/** The UTC moment of a local date and time. @param {string} day @param {string} time @param {string} timeZone */
export function localMoment(day, time, timeZone) {
  const guess = Date.parse(`${day}T${time}:00.000Z`);
  // Twice, so a change of offset (daylight saving) between the guess and the answer is caught.
  let at = guess - offsetMinutes(guess, timeZone) * MINUTE;
  at = guess - offsetMinutes(at, timeZone) * MINUTE;
  return at;
}
/** The local date of a moment. @param {number} at @param {string} timeZone */
export function localDay(at, timeZone) {
  return new Date(at + offsetMinutes(at, timeZone) * MINUTE).toISOString().slice(0, 10);
}
/** The working window of a local date, as UTC moments, or null on a day off. @param {string} day @param {WorkCalendar} cal @returns {[number, number] | null} */
function window(day, cal) {
  const iso = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  if (!cal.workDays.includes(iso) || cal.holidays.has(day)) return null;
  const from = localMoment(day, cal.start, cal.timeZone);
  const to = localMoment(day, cal.end, cal.timeZone);
  return to > from ? [from, to] : null;
}
/** The next local date. @param {string} day */
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/**
 * Working minutes between two moments.
 * @param {number} from
 * @param {number} to
 * @param {WorkCalendar} cal
 */
export function workingMinutes(from, to, cal) {
  if (to <= from) return 0;
  let total = 0;
  const last = localDay(to, cal.timeZone);
  for (let day = localDay(from, cal.timeZone), guard = 0; day <= last && guard < 3700; day = nextDay(day), guard++) {
    const w = window(day, cal);
    if (!w) continue;
    total += Math.max(0, Math.min(w[1], to) - Math.max(w[0], from));
  }
  return Math.floor(total / MINUTE);
}
/**
 * The moment `minutes` working minutes after `from`.
 * @param {number} from
 * @param {number} minutes
 * @param {WorkCalendar} cal
 */
export function addWorkingMinutes(from, minutes, cal) {
  let left = minutes * MINUTE;
  for (let day = localDay(from, cal.timeZone), guard = 0; guard < 3700; day = nextDay(day), guard++) {
    const w = window(day, cal);
    if (!w || from >= w[1]) continue;
    const start = Math.max(from, w[0]);
    if (start + left <= w[1]) return start + left;
    left -= w[1] - start;
  }
  return from;
}
/**
 * One SLA target's state.
 * @param {{ target: "response" | "resolution"; start: number; stoppedAt: number | null; now: number; targetMinutes: number; warnPercent: number; cal: WorkCalendar }} o
 * @returns {SlaTarget}
 */
export function slaTarget(o) {
  const end = o.stoppedAt ?? o.now;
  const elapsed = workingMinutes(o.start, end, o.cal);
  /** @type {SlaTarget["state"]} */ let state;
  if (o.stoppedAt) state = elapsed <= o.targetMinutes ? "met" : "missed";
  else if (elapsed > o.targetMinutes) state = "breached";
  else if (elapsed >= (o.targetMinutes * o.warnPercent) / 100) state = "warning";
  else state = "running";
  return {
    target: o.target,
    targetMinutes: o.targetMinutes,
    elapsedMinutes: elapsed,
    state,
    ...(state === "running" || state === "warning" ? { dueAt: new Date(addWorkingMinutes(o.now, o.targetMinutes - elapsed, o.cal)).toISOString() } : {}),
  };
}
/** "2 h 30 min", "3 days 1 h" in working time (a working day is the calendar's day length). @param {number} m @param {WorkCalendar} [cal] */
export function formatWorking(m, cal) {
  const [sh, sm] = (cal?.start ?? "08:00").split(":").map(Number);
  const [eh, em] = (cal?.end ?? "17:00").split(":").map(Number);
  const dayLength = Math.max(60, eh * 60 + em - (sh * 60 + sm));
  const n = Math.max(0, Math.round(m));
  const days = Math.floor(n / dayLength);
  const h = Math.floor((n % dayLength) / 60);
  const min = n % 60;
  return [days ? `${days} day${days === 1 ? "" : "s"}` : "", h ? `${h} h` : "", min && !days ? `${min} min` : ""].filter(Boolean).join(" ") || "0 min";
}
/** @type {Record<SlaTarget["state"], string>} */ export const SLA_TARGET_LABEL = { running: "On track", warning: "At risk", breached: "Breached", met: "Met", missed: "Missed" };
