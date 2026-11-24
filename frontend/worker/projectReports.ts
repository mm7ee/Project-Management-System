// Reports → Projects: the portfolio report, its trends and its Excel export.
//
// - Only people signed in with "Generate reports" (reports): never a view-only link.
// - Work items are always counted through worker/access.ts (itemAccess), so security levels and the
//   developers' own-items rule apply to every figure, on screen and in the export alike.
// - Counting happens in SQL (a few grouped queries, no query per project); the shared
//   buildProjectReport (src/data/projectReport.ts) turns the counts into rows, RAG health and totals.

import { HttpError, json } from "./http";
import { itemAccess, type Viewer } from "./access";
import type { ItemContext } from "./workitems";
import { DEFAULT_LIMITS, type Limits } from "../src/data/project";
import type { Role } from "../src/data/roles";
import type { System } from "../src/data/systems";
import { RAG_RULES } from "../src/data/projectHealth";
import {
  STAGE_KEYS,
  STAGE_LABEL,
  buildProjectReport,
  describeFilters,
  parseFilters,
  progressByWeek,
  weekOf,
  weeksBetween,
  type ItemCounts,
  type ProjectReport,
  type ProjectReportFilters,
  type ProjectTrends,
  type ProgressEvent,
} from "../src/data/projectReport";
import { xlsx, type Cell } from "./xlsx";

/** Open, overdue and done work items per project, as `viewer` may see them. Exported for the tests. */
export function itemCountsQuery(viewer: Viewer, today: string): { sql: string; args: unknown[] } {
  const a = itemAccess(viewer, "w");
  return {
    sql: `SELECT w.system_id,
            SUM(CASE WHEN st.category <> 'DONE' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN st.category <> 'DONE' AND w.due_date IS NOT NULL AND w.due_date < ? THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN st.category = 'DONE' THEN 1 ELSE 0 END) AS done
          FROM work_items w JOIN work_statuses st ON st.id = w.status
          WHERE ${a.sql}
          GROUP BY w.system_id`,
    args: [today, ...a.args],
  };
}

async function loadReport(c: ItemContext, f: ProjectReportFilters): Promise<{ report: ProjectReport; systems: System[]; names: Map<string, string> }> {
  const { db } = c;
  const today = c.now.slice(0, 10);
  const counts = itemCountsQuery(c.viewer, today);
  const [systems, users, assigned, items, blockers, requests, features, limitsRow] = await Promise.all([
    db.prepare("SELECT data FROM systems").all<{ data: string }>(),
    db.prepare("SELECT id, name, role FROM users").all<{ id: string; name: string; role: Role }>(),
    db.prepare("SELECT user_id, system_id FROM assignments").all<{ user_id: string; system_id: string }>(),
    db.prepare(counts.sql).bind(...counts.args).all<{ system_id: string; open: number; overdue: number; done: number }>(),
    db.prepare("SELECT system_id, raised_at FROM blockers WHERE resolved_at IS NULL").all<{ system_id: string; raised_at: string }>(),
    db.prepare("SELECT system_id, created_at FROM requests").all<{ system_id: string; created_at: string }>(),
    db
      .prepare("SELECT assignee, COUNT(*) AS n FROM features WHERE assignee IS NOT NULL AND status NOT IN ('COMPLETED', 'CANCELLED') GROUP BY assignee")
      .all<{ assignee: string; n: number }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'workload_limits'").first<{ value: string }>(),
  ]);
  const limits: Limits = limitsRow ? { ...DEFAULT_LIMITS, ...JSON.parse(limitsRow.value) } : DEFAULT_LIMITS;
  const all = systems.results.map((r) => JSON.parse(r.data) as System);
  const report = buildProjectReport({
    systems: all,
    users: users.results,
    assignments: assigned.results.map((a) => ({ userId: a.user_id, systemId: a.system_id })),
    items: Object.fromEntries(items.results.map((r): [string, ItemCounts] => [r.system_id, { open: Number(r.open), overdue: Number(r.overdue), done: Number(r.done) }])),
    blockers: blockers.results.map((b) => ({ systemId: b.system_id, raisedAt: b.raised_at })),
    requests: requests.results.map((r) => ({ systemId: r.system_id, createdAt: r.created_at })),
    openFeatures: Object.fromEntries(features.results.map((r) => [r.assignee, Number(r.n)])),
    limits,
    now: Date.parse(c.now),
    filters: f,
  });
  return { report, systems: all, names: new Map(users.results.map((u) => [u.id, u.name])) };
}

async function loadTrends(c: ItemContext, report: ProjectReport): Promise<ProjectTrends> {
  const { db } = c;
  const f = report.filters;
  const ids = report.rows.map((r) => r.id);
  const weeks = weeksBetween(f.from, f.to);
  if (!ids.length) return { weeks: weeks.map((week) => ({ week, created: 0, resolved: 0, hours: 0, scope: 0, done: 0, avgProgress: null })), throughput: [] };
  const a = itemAccess(c.viewer, "w");
  const inIds = `w.system_id IN (${ids.map(() => "?").join(", ")})`;
  const start = `${weekOf(f.from)}T00:00:00.000Z`;
  const end = `${f.to}T23:59:59.999Z`;
  // Weeks start on Monday (ISO), worked out in UTC like weekOf().
  const wk = (col: string) => `to_char(date_trunc('week', (${col})::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
  const [created, resolved, hours, before, progress] = await Promise.all([
    db
      .prepare(`SELECT w.system_id, ${wk("w.created_at")} AS week, COUNT(*) AS n FROM work_items w WHERE ${a.sql} AND ${inIds} AND w.created_at >= ? AND w.created_at <= ? GROUP BY 1, 2`)
      .bind(...a.args, ...ids, start, end)
      .all<{ system_id: string; week: string; n: number }>(),
    db
      .prepare(`SELECT w.system_id, ${wk("w.resolved_at")} AS week, COUNT(*) AS n FROM work_items w WHERE ${a.sql} AND ${inIds} AND w.resolved_at >= ? AND w.resolved_at <= ? GROUP BY 1, 2`)
      .bind(...a.args, ...ids, start, end)
      .all<{ system_id: string; week: string; n: number }>(),
    db
      .prepare(
        `SELECT w.system_id, ${wk("l.work_date")} AS week, SUM(l.minutes) AS minutes FROM work_logs l JOIN work_items w ON w.id = l.item_id
         WHERE ${a.sql} AND ${inIds} AND l.work_date >= ? AND l.work_date <= ? GROUP BY 1, 2`,
      )
      .bind(...a.args, ...ids, weekOf(f.from), f.to)
      .all<{ system_id: string; week: string; minutes: number }>(),
    // Burn-up starts from what existed, and was done, before the period.
    db
      .prepare(
        `SELECT COUNT(*) AS scope, SUM(CASE WHEN w.resolved_at IS NOT NULL AND w.resolved_at < ? THEN 1 ELSE 0 END) AS done
         FROM work_items w WHERE ${a.sql} AND ${inIds} AND w.created_at < ?`,
      )
      .bind(start, ...a.args, ...ids, start)
      .first<{ scope: number; done: number }>(),
    // Progress over time, from the activity log (kept a year): no work items involved, so no access rule.
    db
      .prepare(`SELECT target, at, detail FROM activity WHERE action = ? AND at <= ? AND target IN (${ids.map(() => "?").join(", ")}) ORDER BY at`)
      .bind("system_progress", end, ...ids)
      .all<{ target: string; at: string; detail: string }>(),
  ]);
  const events: ProgressEvent[] = progress.results.flatMap((r) => {
    try {
      const d = JSON.parse(r.detail) as { from?: { progress?: number }; to?: { progress?: number } };
      return typeof d.to?.progress === "number" ? [{ systemId: r.target, at: r.at, from: Number(d.from?.progress ?? d.to.progress), to: d.to.progress }] : [];
    } catch {
      return [];
    }
  });
  const avg = progressByWeek(report.rows, events, weeks);
  const sumBy = <T extends { week: string }>(rows: T[], v: (r: T) => number) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.week, (m.get(r.week) ?? 0) + v(r));
    return m;
  };
  const cW = sumBy(created.results, (r) => Number(r.n));
  const rW = sumBy(resolved.results, (r) => Number(r.n));
  const hW = sumBy(hours.results, (r) => Number(r.minutes) / 60);
  let scope = Number(before?.scope ?? 0);
  let done = Number(before?.done ?? 0);
  const out = weeks.map((week, i) => {
    scope += cW.get(week) ?? 0;
    done += rW.get(week) ?? 0;
    return { week, created: cW.get(week) ?? 0, resolved: rW.get(week) ?? 0, hours: Math.round((hW.get(week) ?? 0) * 10) / 10, scope, done, avgProgress: avg[i] };
  });
  const throughput = report.rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      resolved: resolved.results.filter((x) => x.system_id === r.id).reduce((n, x) => n + Number(x.n), 0),
      hours: Math.round((hours.results.filter((x) => x.system_id === r.id).reduce((n, x) => n + Number(x.minutes), 0) / 60) * 10) / 10,
    }))
    .filter((t) => t.resolved || t.hours)
    .sort((x, y) => y.resolved - x.resolved || y.hours - x.hours);
  return { weeks: out, throughput };
}

/** Every visible work item of the report's projects, one row each, for pivoting. Capped at 10,000. */
async function itemRows(c: ItemContext, report: ProjectReport): Promise<Cell[][]> {
  const ids = report.rows.map((r) => r.id);
  if (!ids.length) return [];
  const a = itemAccess(c.viewer, "w");
  const today = c.now.slice(0, 10);
  const rows = await c.db
    .prepare(
      `SELECT s.key || '-' || w.number AS item_key, w.system_id, w.type, st.name AS status, st.category, w.priority, u.name AS assignee,
              w.story_points, w.due_date, w.created_at, w.resolved_at
       FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id LEFT JOIN users u ON u.id = w.assignee
       WHERE ${a.sql} AND w.system_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY w.system_id, w.number LIMIT 10000`,
    )
    .bind(...a.args, ...ids)
    .all<{ item_key: string; system_id: string; type: string; status: string; category: string; priority: string; assignee: string | null; story_points: number | null; due_date: string | null; created_at: string; resolved_at: string | null }>();
  const project = new Map(report.rows.map((r) => [r.id, r.name]));
  return rows.results.map((r) => [
    r.item_key,
    project.get(r.system_id) ?? "",
    r.type,
    r.status,
    r.category,
    r.priority,
    r.assignee ?? "",
    r.story_points === null ? null : Number(r.story_points),
    r.due_date ?? "",
    r.created_at.slice(0, 10),
    r.resolved_at?.slice(0, 10) ?? "",
    r.category !== "DONE" && r.due_date && r.due_date < today ? "Yes" : "",
  ]);
}

export async function projectReportsApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/reports/projects/")) return null;
  if (c.guest) throw new HttpError(403, "Reports need a Pulse account");
  if (!c.can("reports")) throw new HttpError(403, "You don't have permission to see reports");
  if (method !== "GET") throw new HttpError(405, "Method not allowed");
  const filters = parseFilters(new URL(c.req.url).searchParams, Date.parse(c.now));

  if (path === "/api/reports/projects/summary") {
    const { report } = await loadReport(c, filters);
    return json(report);
  }

  if (path === "/api/reports/projects/trends") {
    const { report } = await loadReport(c, filters);
    return json(await loadTrends(c, report));
  }

  if (path === "/api/reports/projects/export.xlsx") {
    const { report, names } = await loadReport(c, filters);
    const [trends, items] = await Promise.all([loadTrends(c, report), itemRows(c, report)]);
    const t = report.totals;
    const generated = new Date(report.generatedAt).toUTCString();
    const summary: Cell[][] = [
      ["Omni Contact · Pulse", "Projects report"],
      ["Generated", generated],
      ["Generated by", c.me.name],
      ...describeFilters(report.filters, (id) => names.get(id) ?? id).map((line): Cell[] => {
        const [k, ...v] = line.split(": ");
        return [k, v.join(": ")];
      }),
      [],
      ["Figure", "Value"],
      ["Projects in this report", t.projects],
      ["Projects in the portfolio", t.portfolio],
      ["Off track (red)", t.byRag.RED],
      ["At risk (amber)", t.byRag.AMBER],
      ["On track (green)", t.byRag.GREEN],
      ["Not rated (not started or delivered)", t.byRag.NONE],
      ["Need attention (overdue, due soon, blocked or stalled)", t.needsAttention],
      ["Average progress, projects being built (%)", t.averageProgress],
      ["Open blockers", t.openBlockers],
      ["Open update requests", t.openRequests],
      [`Update requests open over ${RAG_RULES.requestOverdueWorkingDays} working days`, t.overdueRequests],
      ["Open work items", t.openItems],
      ["Overdue work items", t.overdueItems],
      ["Developers over the workload limit", t.overloadedDevelopers],
      [],
      ["Stage", "Projects"],
      ...STAGE_KEYS.map((k): Cell[] => [STAGE_LABEL[k], t.byStage[k]]),
    ];
    const projects: Cell[][] = [
      ["Project", "Workspace", "Stage", "Schedule", "Health", "Health reasons", "Progress %", "Expected % by today", "Lead", "Developers", "Developer names", "Open work items", "Overdue work items", "Done work items", "Open blockers", "Open update requests", "Overdue update requests", "Started", "Due", "Delivered", "Last update", "Days since last update"],
      ...report.rows.map((r): Cell[] => [
        r.name,
        r.workspace,
        r.stageLabel,
        r.scheduleLabel,
        r.ragLabel,
        r.reasons.join("; "),
        r.progress,
        r.expected,
        r.lead,
        r.developers,
        r.developerNames.join(", "),
        r.openItems,
        r.overdueItems,
        r.doneItems,
        r.openBlockers,
        r.openRequests,
        r.overdueRequests,
        r.startedAt,
        r.dueAt,
        r.finishedAt,
        r.lastUpdate,
        r.daysSinceUpdate,
      ]),
    ];
    const developers: Cell[][] = [
      ["Developer", "Projects (all)", "Open feature requests", "Over the limit", "Why", "Projects in this report"],
      ...report.developers.map((d): Cell[] => [d.name, d.projects, d.openFeatures, d.overloaded ? "Yes" : "No", d.reasons.join("; "), d.projectsInReport.join(", ")]),
    ];
    const weeks: Cell[][] = [["Week starting", "Average progress %", "Items created", "Items resolved", "Hours logged", "Total items (burn-up)", "Done items (burn-up)"], ...trends.weeks.map((w): Cell[] => [w.week, w.avgProgress, w.created, w.resolved, w.hours, w.scope, w.done])];
    const throughput: Cell[][] = [["Project", "Items resolved in the period", "Hours logged in the period"], ...trends.throughput.map((x): Cell[] => [x.name, x.resolved, x.hours])];
    const itemSheet: Cell[][] = [["Item", "Project", "Type", "Status", "Status category", "Priority", "Assignee", "Story points", "Due", "Created", "Resolved", "Overdue"], ...items];
    const bytes = xlsx([
      { name: "Summary", rows: summary, header: false, widths: [52, 40] },
      { name: "Projects", rows: projects },
      { name: "Resourcing", rows: developers },
      { name: "Trends by week", rows: weeks },
      { name: "Throughput", rows: throughput },
      { name: "Work items", rows: itemSheet },
    ]);
    await c.audit("report_exported", null, { report: "projects", format: "xlsx", filters: describeFilters(report.filters, (id) => names.get(id) ?? id) });
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="pulse-projects-report-${report.filters.from}-to-${report.filters.to}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  throw new HttpError(404, "Not found");
}
