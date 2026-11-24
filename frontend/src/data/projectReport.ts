// The Projects report: filters, rows, figures and resourcing, worked out once. The Worker calls
// `buildProjectReport` with figures it counted in SQL (work items through worker/access.ts), and both the
// screen and the exports show its result, so they always agree.

import { SCHEDULE_META, getSchedule, type Schedule, type System } from "./systems";
import { type Stage, stageOf } from "./bi";
import { lastUpdateOf, isActive, workloadOf, type Limits } from "./project";
import type { Feature } from "./features";
import type { Role, User } from "./roles";
import { RAG_META, expectedProgress, needsAttention, ragOf, requestOverdue, type Rag } from "./projectHealth";

const DAY = 86_400_000;

export const STAGE_LABEL: Record<Stage, string> = {
  NOT_STARTED: "Not started",
  WIP: "In progress",
  TESTING: "Testing",
  TO_DEPLOY: "To deploy",
  LIVE: "Live",
  COMPLETED: "Completed",
};
export const STAGE_KEYS = Object.keys(STAGE_LABEL) as Stage[];
export const SCHEDULE_KEYS = Object.keys(SCHEDULE_META) as Schedule[];
export const RAG_KEYS: Rag[] = ["RED", "AMBER", "GREEN", "NONE"];

// ---------- filters (also the URL: #/reports/projects?from=…) ----------

export interface ProjectReportFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  stage: Stage | "";
  schedule: Schedule | "";
  lead: string;
  workspace: string;
  rag: Rag | "";
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The last 90 days, everything else open. */
export const defaultFilters = (now: number): ProjectReportFilters => ({ from: ymd(now - 89 * DAY), to: ymd(now), stage: "", schedule: "", lead: "", workspace: "", rag: "" });

/** Filters from a query string, keeping only values that make sense. */
export function parseFilters(q: URLSearchParams, now: number): ProjectReportFilters {
  const d = defaultFilters(now);
  const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | "" => (v && (allowed as readonly string[]).includes(v) ? (v as T) : "");
  let from = DATE.test(q.get("from") ?? "") ? q.get("from")! : d.from;
  let to = DATE.test(q.get("to") ?? "") ? q.get("to")! : d.to;
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    stage: pick(q.get("stage"), STAGE_KEYS),
    schedule: pick(q.get("schedule"), SCHEDULE_KEYS),
    lead: (q.get("lead") ?? "").slice(0, 80),
    workspace: (q.get("workspace") ?? "").slice(0, 80),
    rag: pick(q.get("rag"), RAG_KEYS),
  };
}

/** Only what differs from the defaults goes in the URL, so links stay short. */
export function filtersToQuery(f: ProjectReportFilters, now: number): string {
  const d = defaultFilters(now);
  const q = new URLSearchParams();
  for (const k of Object.keys(f) as (keyof ProjectReportFilters)[]) if (f[k] && f[k] !== d[k]) q.set(k, f[k]);
  // Dates are always written once either is set, so a shared link shows the same period tomorrow.
  if (q.has("from") || q.has("to")) {
    q.set("from", f.from);
    q.set("to", f.to);
  }
  return q.toString();
}

/** The filters in words, for the PDF cover, the Excel summary and emails. */
export function describeFilters(f: ProjectReportFilters, nameOf: (id: string) => string): string[] {
  return [
    `Period: ${f.from} to ${f.to}`,
    ...(f.stage ? [`Stage: ${STAGE_LABEL[f.stage]}`] : []),
    ...(f.schedule ? [`Schedule: ${SCHEDULE_META[f.schedule].label}`] : []),
    ...(f.lead ? [`Lead: ${nameOf(f.lead)}`] : []),
    ...(f.workspace ? [`Workspace: ${f.workspace}`] : []),
    ...(f.rag ? [`Health: ${RAG_META[f.rag].label}`] : []),
  ];
}

// ---------- what the Worker counts, and what comes back ----------

export interface ItemCounts {
  open: number;
  overdue: number;
  done: number;
}

export interface ReportInput {
  systems: System[];
  users: { id: string; name: string; role: Role }[];
  assignments: { userId: string; systemId: string }[];
  /** Work items per project, counted in SQL with the viewer's access rule. */
  items: Record<string, ItemCounts>;
  /** Open blockers only. */
  blockers: { systemId: string; raisedAt: string }[];
  /** Open update requests. */
  requests: { systemId: string; createdAt: string }[];
  /** Open feature requests per developer (for the workload limit). */
  openFeatures: Record<string, number>;
  limits: Limits;
  now: number;
  filters: ProjectReportFilters;
}

export interface ProjectRow {
  id: string;
  name: string;
  workspace: string;
  stage: Stage;
  stageLabel: string;
  schedule: Schedule;
  scheduleLabel: string;
  rag: Rag;
  ragLabel: string;
  reasons: string[];
  progress: number;
  expected: number | null;
  leadId: string;
  lead: string;
  developers: number;
  developerNames: string[];
  openItems: number;
  overdueItems: number;
  doneItems: number;
  openBlockers: number;
  openRequests: number;
  overdueRequests: number;
  startedAt: string;
  dueAt: string;
  finishedAt: string;
  lastUpdate: string;
  daysSinceUpdate: number | null;
}

export interface DeveloperRow {
  id: string;
  name: string;
  projectsInReport: string[];
  projects: number; // all their projects, as the workload limit counts them
  openFeatures: number;
  overloaded: boolean;
  reasons: string[];
}

export interface ProjectReport {
  generatedAt: string;
  filters: ProjectReportFilters;
  totals: {
    projects: number;
    portfolio: number;
    byStage: Record<Stage, number>;
    bySchedule: Record<Schedule, number>;
    byRag: Record<Rag, number>;
    averageProgress: number; // projects being built
    openBlockers: number;
    openRequests: number;
    overdueRequests: number;
    needsAttention: number;
    openItems: number;
    overdueItems: number;
    overloadedDevelopers: number;
  };
  rows: ProjectRow[];
  developers: DeveloperRow[];
}

/**
 * In the period: a delivered project whose life overlaps it; any project still open that started by its end;
 * and every project not started yet, which is the pipeline whatever the period.
 */
const inPeriod = (s: System, f: ProjectReportFilters, now: number) => {
  const start = s.startedAt.slice(0, 10);
  if (s.finishedAt) return start <= f.to && s.finishedAt.slice(0, 10) >= f.from;
  return start <= f.to || Date.parse(s.startedAt) > now;
};

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function buildProjectReport(input: ReportInput): ProjectReport {
  const { systems, users, assignments, items, blockers, requests, openFeatures, limits, now, filters: f } = input;
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const devsOf = new Map<string, string[]>();
  for (const a of assignments) devsOf.set(a.systemId, [...(devsOf.get(a.systemId) ?? []), a.userId]);

  const rows: ProjectRow[] = [];
  for (const s of systems) {
    if (!inPeriod(s, f, now)) continue;
    if (f.workspace && s.workspace !== f.workspace) continue;
    if (f.lead && s.lead !== f.lead) continue;
    const stage = stageOf(s);
    if (f.stage && stage !== f.stage) continue;
    const schedule = getSchedule(s, now);
    if (f.schedule && schedule !== f.schedule) continue;
    const open = blockers.filter((b) => b.systemId === s.id);
    const oldest = open.map((b) => b.raisedAt).sort()[0] ?? null;
    const counts = items[s.id] ?? { open: 0, overdue: 0, done: 0 };
    const { rag, reasons } = ragOf(s, { openBlockers: open.length, oldestBlockerAt: oldest, openItems: counts.open, overdueItems: counts.overdue }, now, limits);
    if (f.rag && rag !== f.rag) continue;
    const reqs = requests.filter((r) => r.systemId === s.id);
    const devIds = (devsOf.get(s.id) ?? []).filter((id) => users.find((u) => u.id === id)?.role === "developer");
    const last = lastUpdateOf(s);
    const since = Date.parse(last) <= now ? Math.floor((now - Date.parse(last)) / DAY) : null;
    rows.push({
      id: s.id,
      name: s.name,
      workspace: s.workspace ?? "",
      stage,
      stageLabel: STAGE_LABEL[stage],
      schedule,
      scheduleLabel: SCHEDULE_META[schedule].label,
      rag,
      ragLabel: RAG_META[rag].label,
      reasons,
      progress: s.progress,
      expected: isActive(s, now) ? expectedProgress(s, now) : null,
      leadId: s.lead ?? "",
      lead: s.lead ? (nameOf.get(s.lead) ?? "") : "",
      developers: devIds.length,
      developerNames: devIds.map((id) => nameOf.get(id) ?? "").filter(Boolean).sort(),
      openItems: counts.open,
      overdueItems: counts.overdue,
      doneItems: counts.done,
      openBlockers: open.length,
      openRequests: reqs.length,
      overdueRequests: reqs.filter((r) => requestOverdue(r.createdAt, now)).length,
      startedAt: s.startedAt.slice(0, 10),
      dueAt: s.dueAt?.slice(0, 10) ?? "",
      finishedAt: s.finishedAt?.slice(0, 10) ?? "",
      lastUpdate: last.slice(0, 10),
      daysSinceUpdate: since,
    });
  }
  // Worst health first, then the most overdue work, then by name.
  rows.sort((a, b) => RAG_META[b.rag].rank - RAG_META[a.rag].rank || b.overdueItems - a.overdueItems || a.name.localeCompare(b.name));

  const ids = new Set(rows.map((r) => r.id));
  const active = rows.filter((r) => r.rag !== "NONE");
  const byStage = zero(STAGE_KEYS);
  const bySchedule = zero(SCHEDULE_KEYS);
  const byRag = zero(RAG_KEYS);
  for (const r of rows) {
    byStage[r.stage]++;
    bySchedule[r.schedule]++;
    byRag[r.rag]++;
  }
  const sum = (k: keyof ProjectRow) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const attention = systems.filter((s) => ids.has(s.id) && needsAttention(s, blockers.some((b) => b.systemId === s.id), now, limits)).length;

  // Resourcing: developers on any project in the report; the limit counts all their projects (as everywhere else).
  const developers: DeveloperRow[] = users
    .filter((u) => u.role === "developer")
    .map((u) => {
      const mine = assignments.filter((a) => a.userId === u.id).map((a) => a.systemId);
      const load = workloadOf(
        { ...(u as unknown as User), projectIds: mine },
        systems,
        Array.from({ length: openFeatures[u.id] ?? 0 }, () => ({ assignee: u.id, status: "IN_PROGRESS" }) as Feature),
        limits,
        now,
      );
      return {
        id: u.id,
        name: u.name,
        projectsInReport: rows.filter((r) => mine.includes(r.id)).map((r) => r.name),
        projects: load.projects,
        openFeatures: load.openFeatures,
        overloaded: load.overloaded,
        reasons: load.reasons,
      };
    })
    .filter((d) => d.projectsInReport.length)
    .sort((a, b) => Number(b.overloaded) - Number(a.overloaded) || b.projects - a.projects || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date(now).toISOString(),
    filters: f,
    totals: {
      projects: rows.length,
      portfolio: systems.length,
      byStage,
      bySchedule,
      byRag,
      averageProgress: active.length ? Math.round(active.reduce((n, r) => n + r.progress, 0) / active.length) : 0,
      openBlockers: sum("openBlockers"),
      openRequests: sum("openRequests"),
      overdueRequests: sum("overdueRequests"),
      needsAttention: attention,
      openItems: sum("openItems"),
      overdueItems: sum("overdueItems"),
      overloadedDevelopers: developers.filter((d) => d.overloaded).length,
    },
    rows,
    developers,
  };
}

// ---------- trends ----------

export interface TrendWeek {
  week: string; // the Monday, YYYY-MM-DD
  created: number;
  resolved: number;
  hours: number;
  /** Burn-up: items created so far (in the report's projects) and how many of them are done. */
  scope: number;
  done: number;
  /** Average progress (%) at the end of the week of the report's projects under way then; null if none. */
  avgProgress: number | null;
}

/** A logged progress change (the activity log's system_progress entries). */
export interface ProgressEvent {
  systemId: string;
  at: string;
  from: number;
  to: number;
}

/**
 * Average progress at the end of each week: each project's last logged progress by then (or, before its
 * first logged change, the value it changed from; with no log at all, its progress now), over the projects
 * started by then and not delivered before that week.
 */
export function progressByWeek(rows: Pick<ProjectRow, "id" | "progress" | "startedAt" | "finishedAt">[], events: ProgressEvent[], weeks: string[]): (number | null)[] {
  const byProject = new Map<string, ProgressEvent[]>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) byProject.set(e.systemId, [...(byProject.get(e.systemId) ?? []), e]);
  return weeks.map((week) => {
    const endIso = new Date(Date.parse(`${week}T00:00:00Z`) + 7 * DAY - 1).toISOString();
    const values = rows
      .filter((r) => r.startedAt <= endIso.slice(0, 10) && (!r.finishedAt || r.finishedAt >= week))
      .map((r) => {
        const log = byProject.get(r.id) ?? [];
        const last = [...log].reverse().find((e) => e.at <= endIso);
        if (last) return last.to;
        return log.length ? log[0].from : r.progress;
      });
    return values.length ? Math.round(values.reduce((n, v) => n + v, 0) / values.length) : null;
  });
}

export interface ProjectTrends {
  weeks: TrendWeek[];
  /** Items resolved in the period, per project, most first. */
  throughput: { id: string; name: string; resolved: number; hours: number }[];
}

/** The Monday of the week holding `iso` (UTC). */
export function weekOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Every Monday from the week of `from` to the week of `to`. */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${weekOf(from)}T00:00:00Z`);
  const end = weekOf(to);
  while (d.toISOString().slice(0, 10) <= end && out.length < 106) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
