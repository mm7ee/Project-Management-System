// Sprints, the backlog, the timeline and the agile reports: shapes shared by the Worker and the UI.

import type { WorkItemSummary } from "./workitems";

export type AgileMode = "kanban" | "scrum";
export type SprintState = "FUTURE" | "ACTIVE" | "CLOSED";

export interface SprintSnapshot {
  committedPoints: number;
  completedPoints: number;
  addedPoints: number;
  removedPoints: number;
  notCompletedPoints: number;
  committedItems: number;
  completedItems: number;
  addedItems: number;
  removedItems: number;
  notCompletedItems: number;
}

export interface Sprint {
  id: string;
  systemId: string;
  name: string;
  goal: string;
  startDate: string; // first day
  endDate: string; // last day
  lengthWeeks: number;
  state: SprintState;
  startedAt?: string;
  completedAt?: string;
  snapshot?: SprintSnapshot;
}

export interface SprintWithItems extends Sprint {
  items: WorkItemSummary[];
  points: number; // story points in it
  donePoints: number;
}

export interface BacklogData {
  mode: AgileMode;
  sprints: SprintWithItems[]; // the active one, then future ones by start date
  backlog: WorkItemSummary[]; // not in a sprint, not done, not epics; ranked
  backlogTotal: number;
  velocity: { average: number | null; recent: { name: string; committed: number; completed: number }[] };
  canPlan: boolean;
}

export const MIN_WEEKS = 1;
export const MAX_WEEKS = 4;

/** The last day of a sprint that starts on `start` (YYYY-MM-DD) and lasts `weeks`. */
export function sprintEnd(start: string, weeks: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + (weeks * 7 - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days left in a sprint, today counted; 0 once it has ended. */
export function daysLeft(endDate: string, now: number): number {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return Math.max(0, Math.round((Date.parse(endDate) - today) / 86_400_000) + 1);
}

/** Average completed points over the last few closed sprints, or null with none. */
export function averageVelocity(snapshots: { completedPoints: number }[], last = 3): number | null {
  const recent = snapshots.slice(0, last);
  return recent.length ? Math.round((recent.reduce((n, s) => n + s.completedPoints, 0) / recent.length) * 10) / 10 : null;
}

/** Days between two dates (ISO strings), to one decimal place. */
export const daysBetween = (from: string, to: string) => Math.round(((Date.parse(to) - Date.parse(from)) / 86_400_000) * 10) / 10;

/** Median and the 85th percentile, the usual way to quote cycle and lead times. */
export function percentiles(values: number[]): { median: number; p85: number } | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  return { median: at(0.5), p85: at(0.85) };
}

/** A trailing average over `window` points, for the control chart. */
export function rollingAverage(values: number[], window = 5): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round((slice.reduce((n, x) => n + x, 0) / slice.length) * 10) / 10;
  });
}

/** Points more than two standard deviations above the mean: the control chart's outliers. */
export function outlierLimit(values: number[]): number | null {
  if (values.length < 3) return null;
  const mean = values.reduce((n, x) => n + x, 0) / values.length;
  const sd = Math.sqrt(values.reduce((n, x) => n + (x - mean) ** 2, 0) / values.length);
  return Math.round((mean + 2 * sd) * 10) / 10;
}

export interface TimelineBar {
  key: string;
  id: string;
  systemId: string;
  summary: string;
  type: WorkItemSummary["type"];
  statusName: string;
  statusCategory: WorkItemSummary["statusCategory"];
  assignee?: string;
  start: string | null; // YYYY-MM-DD
  end: string | null; // YYYY-MM-DD
  derived?: boolean; // an epic's dates worked out from its children
  canEdit: boolean;
  children?: TimelineBar[];
}

export interface TimelineProject {
  id: string;
  key: string;
  name: string;
  start: string | null;
  end: string | null;
  canEdit: boolean;
  epics: TimelineBar[];
  loose: TimelineBar[]; // items with dates that aren't in an epic
}

export interface TimelineLink {
  id: string;
  from: string; // blocking item key
  to: string; // blocked item key
  warning?: string; // the blocker ends after the blocked item starts
}
