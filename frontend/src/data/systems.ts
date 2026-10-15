// The System shape and the status/schedule rules, shared by the UI and the Worker.
// The systems themselves live in the D1 database (seeded by migrations/0002_seed.sql).

export type Status = "LIVE" | "COMPLETED" | "WIP" | "TESTING" | "TO_DEPLOY" | "UPCOMING" | "IDEA";
export type Health = "Stable" | "Maintenance";
export type Schedule = "ON_TRACK" | "AT_RISK" | "OVERDUE" | "DONE" | "UNSCHEDULED";

export interface System {
  id: string;
  name: string;
  short: string; // 2–3 letter monogram for the icon tile
  description: string;
  url: string;
  status: Status;
  health?: Health; // only meaningful for LIVE / COMPLETED systems
  maintenanceNote?: string; // what is being updated, while health is "Maintenance"
  maintenanceSince?: string; // ISO time it went into maintenance
  owner: string; // owning team
  lead?: string; // project lead: a Person id from people.ts
  engagement: number; // visits in the last 30 days
  progress: number; // 0–100
  startedAt: string; // ISO date
  finishedAt?: string; // set when built
  dueAt?: string; // target date while in progress
  updatedAt?: string; // last progress update; falls back to finishedAt / startedAt
  updatedBy?: string; // initials of whoever posted it; falls back to the owner's
  template?: string; // name of the template it was created from, if any
}

export const STATUS_META: Record<Status, { label: string; tone: string }> = {
  LIVE: { label: "Live", tone: "green" },
  COMPLETED: { label: "Completed", tone: "navy" },
  WIP: { label: "In progress", tone: "cyan" },
  TESTING: { label: "Testing", tone: "violet" },
  TO_DEPLOY: { label: "To deploy", tone: "amber" },
  UPCOMING: { label: "Upcoming", tone: "slate" },
  IDEA: { label: "Idea", tone: "light" },
};

export const SCHEDULE_META: Record<Schedule, { label: string; tone: string }> = {
  ON_TRACK: { label: "On track", tone: "green" },
  AT_RISK: { label: "At risk", tone: "amber" },
  OVERDUE: { label: "Overdue", tone: "red" },
  DONE: { label: "Done", tone: "navy" },
  UNSCHEDULED: { label: "No date", tone: "slate" },
};

const DAY = 86_400_000;
/** A project due within this many days that isn't finished counts as at risk. */
const AT_RISK_DAYS = 7;

/** Calendar days from `now` until `iso`: 0 on the day itself, negative once it has passed. */
export function daysUntil(iso: string, now: number): number {
  const midnight = (t: number | string) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((midnight(iso) - midnight(now)) / DAY);
}

export function getSchedule(s: System, now: number): Schedule {
  if (s.finishedAt) return "DONE";
  if (!s.dueAt) return s.status === "UPCOMING" && daysUntil(s.startedAt, now) > 0 ? "ON_TRACK" : "UNSCHEDULED";
  const left = daysUntil(s.dueAt, now);
  if (left < 0) return "OVERDUE";
  return left <= AT_RISK_DAYS ? "AT_RISK" : "ON_TRACK";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const HEALTH_META: Record<Health, string> = {
  Stable: "A reliable, fully functional system requiring little to no ongoing maintenance.",
  Maintenance: "Completed/Live system undergoing minor updates, improvements, or version upgrades.",
};
