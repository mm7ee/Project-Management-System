// Mock data for the frontend. This file is the single place the backend will
// replace later: keep the System shape stable and swap the array for an API call.

export type Status = "LIVE" | "COMPLETED" | "WIP" | "TO_DEPLOY" | "UPCOMING" | "IDEA";
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
  owner: string;
  engagement: number; // visits in the last 30 days
  progress: number; // 0–100
  startedAt: string; // ISO date
  finishedAt?: string; // set when built
  dueAt?: string; // target date while in progress
  updatedAt?: string; // last progress update; falls back to finishedAt / startedAt
  updatedBy?: string; // initials of whoever posted it; falls back to the owner's
}

export const STATUS_META: Record<Status, { label: string; tone: string }> = {
  LIVE: { label: "Live", tone: "green" },
  COMPLETED: { label: "Completed", tone: "navy" },
  WIP: { label: "In progress", tone: "cyan" },
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

const HOST = "http://192.168.198.160";

export const SYSTEMS: System[] = [
  {
    id: "omni-rush",
    name: "Omni-Rush",
    short: "OR",
    description: "Assesses agents' performance in real time, ranking top performers hourly.",
    url: `${HOST}:8099`,
    status: "LIVE",
    health: "Maintenance",
    owner: "Systems Team",
    engagement: 785,
    progress: 100,
    startedAt: "2026-06-02",
    finishedAt: "2026-07-14",
  },
  {
    id: "ems",
    name: "Employee Management System",
    short: "EMS",
    description: "ERP for employee records, contracts, leave and HR-related management.",
    url: `${HOST}:8098`,
    status: "LIVE",
    health: "Stable",
    owner: "Systems Team",
    engagement: 1240,
    progress: 100,
    startedAt: "2026-01-12",
    finishedAt: "2026-04-03",
  },
  {
    id: "lms",
    name: "Learning Management System",
    short: "LMS",
    description: "Manages employee learning and academic curricula.",
    url: `${HOST}:8097`,
    status: "WIP",
    owner: "Systems Team",
    engagement: 320,
    progress: 65,
    startedAt: "2026-08-04",
    dueAt: "2026-10-30T17:00:00",
  },
  {
    id: "ims",
    name: "Inventory Management System",
    short: "IMS",
    description: "Manages acquisition and tracking of company laptops and other assets.",
    url: `${HOST}:8096`,
    status: "COMPLETED",
    health: "Stable",
    owner: "Systems Team",
    engagement: 410,
    progress: 100,
    startedAt: "2026-03-09",
    finishedAt: "2026-05-22",
  },
  {
    id: "she",
    name: "S.H.E Management Platform",
    short: "SHE",
    description: "Safety, Health & Environment platform for employee medical records at scale.",
    url: `${HOST}:8095`,
    status: "WIP",
    owner: "Systems Team",
    engagement: 190,
    progress: 40,
    startedAt: "2026-09-01",
    dueAt: "2026-11-20T17:00:00",
  },
  {
    id: "myceo",
    name: "MyCEO",
    short: "MC",
    description: "Connects with CEOs of large organisations in Zimbabwe.",
    url: `${HOST}:8094`,
    status: "COMPLETED",
    health: "Stable",
    owner: "Systems Team",
    engagement: 210,
    progress: 100,
    startedAt: "2026-04-14",
    finishedAt: "2026-06-01",
  },
  {
    id: "booking",
    name: "Booking System",
    short: "BK",
    description: "Avoids clashing meetings and manages meeting room bookings.",
    url: `${HOST}:8093`,
    status: "LIVE",
    health: "Maintenance",
    owner: "Systems Team",
    engagement: 880,
    progress: 100,
    startedAt: "2026-02-16",
    finishedAt: "2026-03-20",
  },
  {
    id: "secondments",
    name: "Secondments System",
    short: "SS",
    description: "Manages and tracks secondments, tenures and durations.",
    url: `${HOST}:8092`,
    status: "UPCOMING",
    owner: "Systems Team",
    engagement: 0,
    progress: 5,
    startedAt: "2026-10-01",
    dueAt: "2026-12-15T17:00:00",
  },
  {
    id: "payslip",
    name: "Payslip",
    short: "PS",
    description: "Allows payslip access without needing a work domain account.",
    url: `${HOST}:8091`,
    status: "WIP",
    owner: "Systems Team",
    engagement: 150,
    progress: 10,
    startedAt: "2026-09-22",
    dueAt: "2026-10-24T17:00:00",
  },
  {
    id: "policies",
    name: "Policies",
    short: "PL",
    description: "Ensures policies are accessible and digitally signed.",
    url: `${HOST}:8090`,
    status: "LIVE",
    health: "Stable",
    owner: "Systems Team",
    engagement: 560,
    progress: 100,
    startedAt: "2026-05-04",
    finishedAt: "2026-06-12",
  },
  {
    id: "prometric",
    name: "Prometric Contracts Signing",
    short: "PC",
    description: "Fast-tracks contract signing for part-time campaign employees.",
    url: `${HOST}:8089`,
    status: "UPCOMING",
    owner: "Systems Team",
    engagement: 0,
    progress: 0,
    startedAt: "2026-10-20",
    dueAt: "2027-01-15T17:00:00",
  },
  {
    id: "omni-health",
    name: "Omni-Health",
    short: "OH",
    description: "Logs individual health issues.",
    url: `${HOST}:8088`,
    status: "IDEA",
    owner: "Unassigned",
    engagement: 0,
    progress: 0,
    startedAt: "2026-10-05",
  },
];
