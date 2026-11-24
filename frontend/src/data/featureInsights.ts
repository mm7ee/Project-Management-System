// Feature request insights for managers (Feature requests → Insights). Pure functions over the
// requests the page already has, so nothing new is fetched and everything can be tested.

import { FEATURE_KINDS, KIND_META, PRIORITIES, isLate, isOpen, type Feature, type FeatureKind, type Priority } from "./features";

const DAY = 86_400_000;

/** When a request left the backlog: delivered, or (for a cancelled one) when it was last changed. */
export function closedAt(f: Feature): number | null {
  if (f.status === "COMPLETED") return Date.parse(f.completedAt ?? f.updatedAt);
  if (f.status === "CANCELLED") return Date.parse(f.updatedAt);
  return null;
}

/** Midnight on the Monday of the week holding `t`, local time. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export interface FlowWeek {
  start: number; // Monday, midnight
  arrived: number;
  delivered: number;
  cancelled: number;
  open: number; // still open at the end of the week (or now, for this week)
}

/** Requests in and out per week, oldest first, ending with the current week. */
export function weeklyFlow(features: Feature[], now: number, weeks: number): FlowWeek[] {
  const first = weekStart(now) - (weeks - 1) * 7 * DAY;
  return Array.from({ length: weeks }, (_, i) => {
    const start = first + i * 7 * DAY;
    // Weeks are 7 days apart; a clock change shifts a boundary by an hour at most, which is fine here.
    const end = Math.min(start + 7 * DAY, now);
    const inWeek = (t: number | null) => t !== null && t >= start && t < start + 7 * DAY;
    return {
      start,
      arrived: features.filter((f) => inWeek(Date.parse(f.createdAt))).length,
      delivered: features.filter((f) => f.status === "COMPLETED" && inWeek(closedAt(f))).length,
      cancelled: features.filter((f) => f.status === "CANCELLED" && inWeek(closedAt(f))).length,
      open: features.filter((f) => Date.parse(f.createdAt) < end && ((closedAt(f) ?? Infinity) >= end)).length,
    };
  });
}

const median = (xs: number[]) => quantile(xs, 0.5);
/** Linear-interpolated quantile of `xs` (unsorted is fine); null for no values. */
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}

/** Days from request to delivery, for delivered requests. */
export const leadDays = (f: Feature): number | null =>
  f.status === "COMPLETED" ? Math.max(0, (closedAt(f)! - Date.parse(f.createdAt)) / DAY) : null;

/** Delivered on or before its expected date (the due day itself counts). Null when it had no date. */
export function onTime(f: Feature): boolean | null {
  if (f.status !== "COMPLETED" || !f.dueAt) return null;
  return closedAt(f)! <= new Date(f.dueAt).setHours(23, 59, 59, 999);
}

export interface LeadByKind {
  kind: FeatureKind;
  label: string;
  n: number;
  median: number | null;
  p80: number | null;
  open: number;
}

/** Typical and slow (80th percentile) delivery time per type of request. */
export function leadByKind(features: Feature[]): LeadByKind[] {
  return FEATURE_KINDS.map((kind) => {
    const of = features.filter((f) => f.kind === kind);
    const days = of.map(leadDays).filter((d): d is number => d !== null);
    return { kind, label: KIND_META[kind], n: days.length, median: median(days), p80: quantile(days, 0.8), open: of.filter(isOpen).length };
  });
}

export interface AgedRequest {
  feature: Feature;
  ageDays: number;
  late: boolean;
}

/** Every open request with its age, for the ageing chart. */
export function ageing(features: Feature[], now: number): AgedRequest[] {
  return features
    .filter(isOpen)
    .map((f) => ({ feature: f, ageDays: Math.max(0, (now - Date.parse(f.createdAt)) / DAY), late: isLate(f, now) }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

export interface ClientDemand {
  client: string;
  total: number;
  open: number;
  delivered: number;
  late: number; // open and past due
  onTimeRate: number | null; // of their delivered requests that had a date
  kinds: Record<FeatureKind, number>;
}

/** Who asks for the most, busiest first. Beyond `top`, clients fold into one "Other clients" row. */
export function clientDemand(features: Feature[], now: number, top = 8): ClientDemand[] {
  const by = new Map<string, Feature[]>();
  for (const f of features) {
    const name = f.client.trim() || "No client named";
    by.set(name, [...(by.get(name) ?? []), f]);
  }
  const row = (client: string, fs: Feature[]): ClientDemand => {
    const timed = fs.map(onTime).filter((x): x is boolean => x !== null);
    return {
      client,
      total: fs.length,
      open: fs.filter(isOpen).length,
      delivered: fs.filter((f) => f.status === "COMPLETED").length,
      late: fs.filter((f) => isLate(f, now)).length,
      onTimeRate: timed.length ? timed.filter(Boolean).length / timed.length : null,
      kinds: Object.fromEntries(FEATURE_KINDS.map((k) => [k, fs.filter((f) => f.kind === k).length])) as Record<FeatureKind, number>,
    };
  };
  const rows = [...by.entries()].map(([c, fs]) => row(c, fs)).sort((a, b) => b.total - a.total || b.open - a.open || a.client.localeCompare(b.client));
  if (rows.length <= top) return rows;
  const rest = [...by.entries()].filter(([c]) => !rows.slice(0, top - 1).some((r) => r.client === c)).flatMap(([, fs]) => fs);
  return [...rows.slice(0, top - 1), row(`Other clients (${rows.length - top + 1})`, rest)];
}

export interface Period {
  arrived: number;
  delivered: number;
  cancelled: number;
  openAtStart: number;
  openAtEnd: number;
  medianLead: number | null;
  onTimeRate: number | null;
}

/** Totals for requests that arrived, or were delivered, in [from, to). */
export function periodTotals(features: Feature[], from: number, to: number): Period {
  const within = (t: number | null) => t !== null && t >= from && t < to;
  const done = features.filter((f) => f.status === "COMPLETED" && within(closedAt(f)));
  const timed = done.map(onTime).filter((x): x is boolean => x !== null);
  const openAt = (t: number) => features.filter((f) => Date.parse(f.createdAt) < t && (closedAt(f) ?? Infinity) >= t).length;
  return {
    arrived: features.filter((f) => within(Date.parse(f.createdAt))).length,
    delivered: done.length,
    cancelled: features.filter((f) => f.status === "CANCELLED" && within(closedAt(f))).length,
    openAtStart: openAt(from),
    openAtEnd: openAt(to),
    medianLead: median(done.map(leadDays).filter((d): d is number => d !== null)),
    onTimeRate: timed.length ? timed.filter(Boolean).length / timed.length : null,
  };
}

/** How the open backlog splits by priority, highest first. */
export const openByPriority = (features: Feature[]): Record<Priority, number> =>
  Object.fromEntries(PRIORITIES.map((p) => [p, features.filter((f) => isOpen(f) && f.priority === p).length])) as Record<Priority, number>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const days = (d: number) => (d < 1 ? "under a day" : plural(Math.round(d), "day"));

/**
 * The reading in plain sentences: is the backlog growing, how fast is delivery, what to look at first.
 * `periodDays` is the window compared (the latest one against the one before).
 */
export function insightSentences(features: Feature[], now: number, periodDays: number): string[] {
  const cur = periodTotals(features, now - periodDays * DAY, now + 1);
  const prev = periodTotals(features, now - 2 * periodDays * DAY, now - periodDays * DAY);
  const net = cur.openAtEnd - cur.openAtStart;
  const out: string[] = [];
  const span = periodDays === 7 ? "this past week" : `the last ${periodDays} days`;
  if (!cur.arrived && !cur.delivered && !cur.cancelled) out.push(`Nothing came in or was delivered in ${span}.`);
  else
    out.push(
      `In ${span}, ${plural(cur.arrived, "request")} came in, ${plural(cur.delivered, "was", "were")} delivered` +
        (cur.cancelled ? ` and ${cur.cancelled} cancelled` : "") +
        `: the open backlog ` +
        (net > 0 ? `grew from ${cur.openAtStart} to ${cur.openAtEnd}.` : net < 0 ? `shrank from ${cur.openAtStart} to ${cur.openAtEnd}.` : `held at ${cur.openAtEnd}.`),
    );
  if (cur.medianLead !== null) {
    const was = prev.medianLead;
    const trend = was === null ? "" : cur.medianLead < was * 0.9 ? `, faster than ${days(was)} before` : cur.medianLead > was * 1.1 ? `, slower than ${days(was)} before` : ", about the same as before";
    out.push(`A typical request took ${days(cur.medianLead)} to deliver${trend}.`);
  }
  const aged = ageing(features, now);
  const late = aged.filter((a) => a.late);
  if (late.length) out.push(`${plural(late.length, "open request is", "open requests are")} past the delivery date promised to the client.`);
  const urgentOld = aged.find((a) => (a.feature.priority === "CRITICAL" || a.feature.priority === "HIGH") && a.ageDays >= 30);
  if (urgentOld)
    out.push(`Look first at "${urgentOld.feature.title}" for ${urgentOld.feature.client || "a client"}: ${a(urgentOld.feature.priority)} priority request open for ${days(urgentOld.ageDays)}.`);
  const busiest = clientDemand(features.filter(isOpen), now, 99)[0];
  const openCount = aged.length;
  if (busiest && openCount >= 4 && busiest.open / openCount >= 0.4)
    out.push(`${busiest.client} accounts for ${Math.round((busiest.open / openCount) * 100)}% of the open backlog.`);
  return out;
}
const a = (p: Priority) => (p === "CRITICAL" ? "a critical" : "a high");
