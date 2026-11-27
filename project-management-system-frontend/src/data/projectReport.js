/** @import { Schedule, System } from './systems' */
/** @import { Stage } from './bi' */
/** @import { Limits } from './project' */
/** @import { Feature } from './features' */
/** @import { Role, User } from './roles' */
/** @import { Rag } from './projectHealth' */
// The Projects report: filters, rows, figures and resourcing, worked out once. The Worker calls
// `buildProjectReport` with figures it counted in SQL (work items through worker/access.ts), and both the
// screen and the exports show its result, so they always agree.
import { SCHEDULE_META, getSchedule } from "./systems";
import { stageOf } from "./bi";
import { lastUpdateOf, isActive, workloadOf } from "./project";
import { RAG_META, expectedProgress, needsAttention, ragOf, requestOverdue } from "./projectHealth";
const DAY = 86400000;
/** @type {Record<Stage, string>} */ export const STAGE_LABEL = {
  NOT_STARTED: "Not started",
  WIP: "In progress",
  TESTING: "Testing",
  TO_DEPLOY: "To deploy",
  LIVE: "Live",
  COMPLETED: "Completed",
};
export const STAGE_KEYS = /** @type {Stage[]} */ (Object.keys(STAGE_LABEL));
export const SCHEDULE_KEYS = /** @type {Schedule[]} */ (Object.keys(SCHEDULE_META));
/** @type {Rag[]} */ export const RAG_KEYS = ["RED", "AMBER", "GREEN", "NONE"];
const ymd =
  /** @param {number} ms
   * @returns {string}
   */ (ms) => new Date(ms).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The last 90 days, everything else open. */
export const defaultFilters =
  /**
   * @param {number} now
   * @returns {ProjectReportFilters}
   */ (now) => ({ from: ymd(now - 89 * DAY), to: ymd(now), stage: "", schedule: "", lead: "", workspace: "", rag: "" });
/**
 * Filters from a query string, keeping only values that make sense.
 * @param {URLSearchParams} q
 * @param {number} now
 * @returns {ProjectReportFilters}
 */
export function parseFilters(q, now) {
  const d = defaultFilters(now);
  const pick = /** @template T @param {string | null} v @param {readonly T[]} allowed @returns {T | ""} */ (v, allowed) => (v && /** @type {readonly string[]} */ (allowed).includes(v) ? /** @type {T} */ (v) : "");
  let from = DATE.test(q.get("from") ?? "") ? /** @type {string} */ (q.get("from")) : d.from;
  let to = DATE.test(q.get("to") ?? "") ? /** @type {string} */ (q.get("to")) : d.to;
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
/**
 * Only what differs from the defaults goes in the URL, so links stay short.
 * @param {ProjectReportFilters} f
 * @param {number} now
 * @returns {string}
 */
export function filtersToQuery(f, now) {
  const d = defaultFilters(now);
  const q = new URLSearchParams();
  for (const k of /** @type {(keyof ProjectReportFilters)[]} */ (Object.keys(f))) if (f[k] && f[k] !== d[k]) q.set(k, f[k]);
  // Dates are always written once either is set, so a shared link shows the same period tomorrow.
  if (q.has("from") || q.has("to")) {
    q.set("from", f.from);
    q.set("to", f.to);
  }
  return q.toString();
}
/**
 * The filters in words, for the PDF cover, the Excel summary and emails.
 * @param {ProjectReportFilters} f
 * @param {(id: string) => string} nameOf
 * @returns {string[]}
 */
export function describeFilters(f, nameOf) {
  return [
    `Period: ${f.from} to ${f.to}`,
    ...(f.stage ? [`Stage: ${STAGE_LABEL[f.stage]}`] : []),
    ...(f.schedule ? [`Schedule: ${SCHEDULE_META[f.schedule].label}`] : []),
    ...(f.lead ? [`Lead: ${nameOf(f.lead)}`] : []),
    ...(f.workspace ? [`Workspace: ${f.workspace}`] : []),
    ...(f.rag ? [`Health: ${RAG_META[f.rag].label}`] : []),
  ];
}
/**
 * In the period: a delivered project whose life overlaps it; any project still open that started by its end;
 * and every project not started yet, which is the pipeline whatever the period.
 */
const inPeriod =
  /** @param {System} s
   * @param {ProjectReportFilters} f
   * @param {number} now
   * @returns {boolean}
   */ (s, f, now) => {
    const start = s.startedAt.slice(0, 10);
    if (s.finishedAt) return start <= f.to && s.finishedAt.slice(0, 10) >= f.from;
    return start <= f.to || Date.parse(s.startedAt) > now;
  };
const zero =
  /**
   * @template {string} K
   * @param {readonly K[]} keys
   * @returns {Record<K, number>}
   */ (keys) => /** @type {Record<K, number>} */ (Object.fromEntries(keys.map((k) => [k, 0])));
/**
 * @param {ReportInput} input
 * @returns {ProjectReport}
 */
export function buildProjectReport(input) {
  const { systems, users, assignments, items, blockers, requests, openFeatures, limits, now, filters: f } = input;
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const devsOf = /** @type {Map<string, Array<string>>} */ (/** @type {unknown} */ (new Map()));
  for (const a of assignments) devsOf.set(a.systemId, [...(devsOf.get(a.systemId) ?? []), a.userId]);
  /** @type {ProjectRow[]} */ const rows = [];
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
      developerNames: devIds
        .map((id) => nameOf.get(id) ?? "")
        .filter(Boolean)
        .sort(),
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
  const sum = /** @param {keyof ProjectRow} k */ (k) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const attention = systems.filter(
    (s) =>
      ids.has(s.id) &&
      needsAttention(
        s,
        blockers.some((b) => b.systemId === s.id),
        now,
        limits,
      ),
  ).length;
  // Resourcing: developers on any project in the report; the limit counts all their projects (as everywhere else).
  /** @type {DeveloperRow[]} */ const developers = users
    .filter((u) => u.role === "developer")
    .map((u) => {
      const mine = assignments.filter((a) => a.userId === u.id).map((a) => a.systemId);
      const load = workloadOf(
        { .../** @type {User} */ (/** @type {unknown} */ (u)), projectIds: mine },
        systems,
        Array.from({ length: openFeatures[u.id] ?? 0 }, () => /** @type {Feature} */ ({ assignee: u.id, status: "IN_PROGRESS" })),
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
/**
 * Average progress at the end of each week: each project's last logged progress by then (or, before its
 * first logged change, the value it changed from; with no log at all, its progress now), over the projects
 * started by then and not delivered before that week.
 * @param {Pick<ProjectRow, "id" | "progress" | "startedAt" | "finishedAt">[]} rows
 * @param {ProgressEvent[]} events
 * @param {string[]} weeks
 * @returns {(number | null)[]}
 */
export function progressByWeek(rows, events, weeks) {
  const byProject = /** @type {Map<string, Array<ProgressEvent>>} */ (/** @type {unknown} */ (new Map()));
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
/**
 * The Monday of the week holding `iso` (UTC).
 * @param {string} iso
 * @returns {string}
 */
export function weekOf(iso) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
/**
 * Every Monday from the week of `from` to the week of `to`.
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function weeksBetween(from, to) {
  /** @type {string[]} */ const out = [];
  const d = new Date(`${weekOf(from)}T00:00:00Z`);
  const end = weekOf(to);
  while (d.toISOString().slice(0, 10) <= end && out.length < 106) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
/**
 * @typedef {Object} ProjectReportFilters
 * @property {string} from
 * @property {string} to
 * @property {Stage | ""} stage
 * @property {Schedule | ""} schedule
 * @property {string} lead
 * @property {string} workspace
 * @property {Rag | ""} rag
 */
/**
 * @typedef {Object} ItemCounts
 * @property {number} open
 * @property {number} overdue
 * @property {number} done
 */
/**
 * @typedef {Object} ReportInput
 * @property {System[]} systems
 * @property {{ id: string; name: string; role: Role }[]} users
 * @property {{ userId: string; systemId: string }[]} assignments
 * @property {Record<string, ItemCounts>} items Work items per project, counted in SQL with the viewer's access rule.
 * @property {{ systemId: string; raisedAt: string }[]} blockers Open blockers only.
 * @property {{ systemId: string; createdAt: string }[]} requests Open update requests.
 * @property {Record<string, number>} openFeatures Open feature requests per developer (for the workload limit).
 * @property {Limits} limits
 * @property {number} now
 * @property {ProjectReportFilters} filters
 */
/**
 * @typedef {Object} ProjectRow
 * @property {string} id
 * @property {string} name
 * @property {string} workspace
 * @property {Stage} stage
 * @property {string} stageLabel
 * @property {Schedule} schedule
 * @property {string} scheduleLabel
 * @property {Rag} rag
 * @property {string} ragLabel
 * @property {string[]} reasons
 * @property {number} progress
 * @property {number | null} expected
 * @property {string} leadId
 * @property {string} lead
 * @property {number} developers
 * @property {string[]} developerNames
 * @property {number} openItems
 * @property {number} overdueItems
 * @property {number} doneItems
 * @property {number} openBlockers
 * @property {number} openRequests
 * @property {number} overdueRequests
 * @property {string} startedAt
 * @property {string} dueAt
 * @property {string} finishedAt
 * @property {string} lastUpdate
 * @property {number | null} daysSinceUpdate
 */
/**
 * @typedef {Object} DeveloperRow
 * @property {string} id
 * @property {string} name
 * @property {string[]} projectsInReport
 * @property {number} projects
 * @property {number} openFeatures
 * @property {boolean} overloaded
 * @property {string[]} reasons
 */
/**
 * @typedef {Object} ProjectReport
 * @property {string} generatedAt
 * @property {ProjectReportFilters} filters
 * @property {Object} totals
 * @property {number} totals.projects
 * @property {number} totals.portfolio
 * @property {Record<Stage, number>} totals.byStage
 * @property {Record<Schedule, number>} totals.bySchedule
 * @property {Record<Rag, number>} totals.byRag
 * @property {number} totals.averageProgress
 * @property {number} totals.openBlockers
 * @property {number} totals.openRequests
 * @property {number} totals.overdueRequests
 * @property {number} totals.needsAttention
 * @property {number} totals.openItems
 * @property {number} totals.overdueItems
 * @property {number} totals.overloadedDevelopers
 * @property {ProjectRow[]} rows
 * @property {DeveloperRow[]} developers
 */
/**
 * @typedef {Object} TrendWeek
 * @property {string} week
 * @property {number} created
 * @property {number} resolved
 * @property {number} hours
 * @property {number} scope Burn-up: items created so far (in the report's projects) and how many of them are done.
 * @property {number} done
 * @property {number | null} avgProgress Average progress (%) at the end of the week of the report's projects under way then; null if none.
 */
/**
 * A logged progress change (the activity log's system_progress entries).
 * @typedef {Object} ProgressEvent
 * @property {string} systemId
 * @property {string} at
 * @property {number} from
 * @property {number} to
 */
/**
 * @typedef {Object} ProjectTrends
 * @property {TrendWeek[]} weeks
 * @property {{ id: string; name: string; resolved: number; hours: number }[]} throughput Items resolved in the period, per project, most first.
 */
