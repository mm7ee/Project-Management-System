// Service Desk lite, shared by the Worker and the UI: request types and their forms, SLA targets in
// business hours, and the SLA clock. Requests are work items with source "service_desk".
//
// Business hours: Monday to Friday, 08:00 to 17:00 Harare time (UTC+2 all year), except public holidays.
// The clock stops while a request waits for the customer. It warns at 75% of a target.

import type { WorkItemSummary, WorkPriority } from "./workitems";

export type RequestKind = "incident" | "service_request" | "change" | "question";

export const REQUEST_KINDS: Record<RequestKind, string> = {
  incident: "Incident",
  service_request: "Service request",
  change: "Change",
  question: "Question",
};

export type RequestFieldKind = "text" | "textarea" | "select" | "date";

export const REQUEST_FIELD_KINDS: Record<RequestFieldKind, string> = {
  text: "Short text",
  textarea: "Long text",
  select: "A choice",
  date: "Date",
};

export interface RequestField {
  id: string;
  label: string;
  kind: RequestFieldKind;
  help: string;
  required: boolean;
  options: { id: string; label: string }[];
}

export interface SlaTarget {
  priority: WorkPriority;
  firstResponseMinutes: number; // business minutes
  resolutionMinutes: number;
}

export interface RequestType {
  id: string;
  name: string;
  kind: RequestKind;
  description: string;
  itemType: "TASK" | "BUG";
  enabled: boolean;
  fields: RequestField[];
  targets: SlaTarget[];
}

export interface Holiday {
  day: string; // YYYY-MM-DD
  name: string;
}

export interface PortalLink {
  id: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  requests: number;
  url?: string; // only when it's made
}

export type SlaState = "running" | "paused" | "met" | "breached";

export interface SlaClock {
  targetMinutes: number;
  elapsedMinutes: number;
  state: SlaState;
  /** 75% or more of the target used, and not yet met. */
  atRisk: boolean;
  /** While running: when it will breach if nothing pauses it. */
  dueAt?: string;
}

export interface RequestInfo {
  typeId: string;
  typeName: string;
  kind: RequestKind;
  customerName: string;
  customerEmail?: string; // staff only; never on view-only links or the portal
  viaPortal: boolean;
  answers: { label: string; value: string }[];
  waiting: boolean; // waiting for the customer: the clock is stopped
  firstResponse: SlaClock;
  resolution: SlaClock;
}

/** A request in a queue. */
export interface QueueItem extends WorkItemSummary {
  requestType: string;
  kind: RequestKind;
  customerName: string;
  sla: { firstResponse: SlaClock; resolution: SlaClock };
}

export type QueueKey = "unassigned" | "mine" | "at_risk" | "breached" | "all_open";

export const QUEUES: { key: QueueKey; label: string }[] = [
  { key: "unassigned", label: "Unassigned" },
  { key: "mine", label: "My open requests" },
  { key: "at_risk", label: "SLA at risk" },
  { key: "breached", label: "Breached" },
  { key: "all_open", label: "All open" },
];

/** What the customer sees of their request on the portal: no internal notes, no assignee details. */
export interface PortalRequest {
  key: string;
  summary: string;
  description: string;
  typeName: string;
  statusName: string;
  done: boolean;
  waiting: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  answers: { label: string; value: string }[];
  replies: { body: string; fromCustomer: boolean; author: string; at: string }[];
}

export const AT_RISK_SHARE = 0.75;
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 17;
export const BUSINESS_DAY_MINUTES = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 60;
const HARARE_OFFSET = 2 * 3_600_000;
const DAY = 86_400_000;
const MINUTE = 60_000;

/** Harare's calendar date (YYYY-MM-DD) for a moment. */
export const harareDay = (ms: number) => new Date(ms + HARARE_OFFSET).toISOString().slice(0, 10);

/** The business hours of one Harare date, as UTC milliseconds, or null on weekends and holidays. */
function businessWindow(day: string, holidays: Set<string>): [number, number] | null {
  const midnightUtc = Date.parse(`${day}T00:00:00.000Z`) - HARARE_OFFSET;
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  if (weekday === 0 || weekday === 6 || holidays.has(day)) return null;
  return [midnightUtc + BUSINESS_START_HOUR * 3_600_000, midnightUtc + BUSINESS_END_HOUR * 3_600_000];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Business minutes between two moments, less the paused spans. */
export function businessMinutes(from: number, to: number, holidays: Set<string>, pauses: [number, number][] = []): number {
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

/** The moment `minutes` business minutes after `from` (with no further pauses). */
export function addBusinessMinutes(from: number, minutes: number, holidays: Set<string>): number {
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
 */
export function slaClock(opts: { start: number; stoppedAt?: number | null; now: number; targetMinutes: number; holidays: Set<string>; pauses: [number, number | null][] }): SlaClock {
  const end = opts.stoppedAt ?? opts.now;
  const pauses = opts.pauses.map(([a, b]): [number, number] => [a, b ?? opts.now]);
  const elapsed = businessMinutes(opts.start, end, opts.holidays, pauses);
  const paused = !opts.stoppedAt && opts.pauses.some(([, b]) => b === null);
  const state: SlaState = opts.stoppedAt ? (elapsed <= opts.targetMinutes ? "met" : "breached") : elapsed > opts.targetMinutes ? "breached" : paused ? "paused" : "running";
  const atRisk = (state === "running" || state === "paused") && elapsed >= opts.targetMinutes * AT_RISK_SHARE;
  return {
    targetMinutes: opts.targetMinutes,
    elapsedMinutes: elapsed,
    state,
    atRisk,
    ...(state === "running" ? { dueAt: new Date(addBusinessMinutes(opts.now, opts.targetMinutes - elapsed, opts.holidays)).toISOString() } : {}),
  };
}

/** "2 h 30 min", "1 day 3 h" (business days of 9 hours). */
export function formatBusinessMinutes(m: number): string {
  const n = Math.max(0, Math.round(m));
  const days = Math.floor(n / BUSINESS_DAY_MINUTES);
  const h = Math.floor((n % BUSINESS_DAY_MINUTES) / 60);
  const min = n % 60;
  const parts = [days ? `${days} day${days === 1 ? "" : "s"}` : "", h ? `${h} h` : "", min && !days ? `${min} min` : ""].filter(Boolean);
  return parts.join(" ") || "0 min";
}

export const SLA_STATE_LABEL: Record<SlaState, string> = { running: "On track", paused: "Paused", met: "Met", breached: "Breached" };
