/** @import { System } from '../../data/systems' */
/** @import { Sprint } from '../../data/sprints' */
/** @import { StatusDef } from '../../data/workflows' */
/** @import { WorkItemSummary } from '../../data/workitems' */
/** @import { Series } from './AgileCharts' */
import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { api } from "../../data/api";
import { outlierLimit, percentiles, rollingAverage } from "../../data/sprints";
import Panel from "../Panel";
import { ControlChart, GroupedBars, LineChart, StackedArea } from "./AgileCharts";
/** @type {{ key: Report; label: string; sprint?: boolean; scrum?: boolean; note: string }[]} */ const REPORTS = [
  { key: "burndown", label: "Burndown", sprint: true, scrum: true, note: "Look for the remaining line tracking the ideal one. Flat stretches mean work isn't being finished; jumps up mean work was added mid-sprint." },
  { key: "burnup", label: "Burnup", sprint: true, scrum: true, note: "Look at the gap between the lines. A rising scope line is scope creep: the finish line moving while the team works." },
  { key: "velocity", label: "Velocity", scrum: true, note: "Look for completed bars close to committed ones, and a steady level. Plan the next sprint near the recent average." },
  { key: "sprint", label: "Sprint report", sprint: true, scrum: true, note: "Look at what didn't get done and what was added after the start: both explain a missed goal." },
  { key: "flow", label: "Cumulative flow", note: "Look for bands of even width. A band that keeps widening is a bottleneck: work arrives there faster than it leaves." },
  { key: "control", label: "Control chart", note: "Look for a falling or steady average and few red dots. Red dots took much longer than usual: worth asking why." },
  { key: "created", label: "Created vs resolved", note: "Look at which line is higher. More created than resolved, week after week, means the backlog is growing." },
  { key: "leadcycle", label: "Lead and cycle time", note: "Lead time is from asking to done; cycle time from starting to done. Quote the 85th percentile when promising dates." },
];
const COLORS = ["var(--st-not)", "var(--st-wip)", "var(--st-testing)", "var(--st-deploy)", "var(--st-live)", "var(--st-done)", "var(--st-overdue)"];
const short =
  /** @param {string} d
   * @returns {string}
   */ (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const csvCell =
  /** @param {unknown} v
   * @returns {string}
   */ (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
/**
 * @param {string} name
 * @param {string[]} header
 * @param {unknown[][]} rows
 * @returns {void}
 */
function download(name, header, rows) {
  const blob = new Blob([[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
/** The agile reports, for one project (sprints) or a workspace (flow and timing). */
/**
 * `overview` (the Reports → Delivery tab) opens on a whole workspace, created against resolved: is the team keeping up?
 * @param {{ systems: System[]; now: number; overview?: boolean }} arg5
 */
export default function AgileReports({ systems, now, overview = false }) {
  const workspaces = useMemo(() => [...new Set(systems.map((s) => s.workspace).filter(/** @returns {w is string} */ (w) => !!w))], [systems]);
  const scrum = systems.filter((s) => s.agileMode === "scrum");
  const [scope, setScope] = useState(() => (overview && workspaces[0] ? `w:${workspaces[0]}` : scrum[0] ? `p:${scrum[0].id}` : systems[0] ? `p:${systems[0].id}` : `w:${workspaces[0] ?? ""}`));
  const [report, setReport] = useState(/** @type {Report | (() => Report)} */ (overview ? "created" : scrum.length ? "burndown" : "flow"));
  const [sprints, setSprints] = useState(/** @type {Sprint[] | (() => Sprint[])} */ ([]));
  const [sprintId, setSprintId] = useState("");
  const [windowDays, setWindowDays] = useState(90);
  const [data, setData] = useState(/** @type {unknown | (() => unknown)} */ (null));
  const [error, setError] = useState("");
  const meta = /** @type {{ key: Report; label: string; sprint?: boolean; scrum?: boolean; note: string; }} */ (REPORTS.find((r) => r.key === report));
  const project = scope.startsWith("p:") ? systems.find((s) => s.id === scope.slice(2)) : undefined;
  const isScrum = project?.agileMode === "scrum";
  const scopeQuery = project ? `system=${encodeURIComponent(project.id)}` : `workspace=${encodeURIComponent(scope.slice(2))}`;
  const scopeName = project ? project.name : `${scope.slice(2)} workspace`;
  // The project's sprints, for the sprint reports and velocity.
  useEffect(() => {
    setSprints([]);
    setSprintId("");
    if (!project || !isScrum) return;
    /** @type {Promise<{ sprints: Sprint[]; }>} */ (/** @type {unknown} */ (api(`/reports/agile/sprints?system=${encodeURIComponent(project.id)}`)))
      .then((r) => {
        setSprints(r.sprints);
        setSprintId(r.sprints.find((s) => s.state === "ACTIVE")?.id ?? r.sprints.find((s) => s.state === "CLOSED")?.id ?? "");
      })
      .catch(() => setSprints([]));
  }, [project?.id, isScrum]);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    const path =
      report === "burndown" || report === "burnup"
        ? sprintId && `/reports/agile/burndown?sprint=${sprintId}`
        : report === "sprint"
          ? sprintId && `/reports/agile/sprint?sprint=${sprintId}`
          : report === "velocity"
            ? null
            : report === "flow" || report === "created"
              ? `/reports/agile/flow?${scopeQuery}&days=${windowDays}`
              : `/reports/agile/cycle?${scopeQuery}&days=${windowDays}`;
    if (!path) return;
    api(path)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the report"));
    return () => {
      live = false;
    };
  }, [report, sprintId, scopeQuery, windowDays]);
  const stamp = new Date(now).toISOString().slice(0, 10);
  const needsScrum = meta.scrum && !isScrum;
  const sprint = sprints.find((s) => s.id === sprintId);
  /** @type {JSX.Element | null} */ let body = null;
  /** @type {(() => void) | null} */ let csv = null;
  if (needsScrum) {
    body = <p className="lead-none">{project ? `${project.name} doesn't use sprints. Choose a Scrum project, or a flow report.` : "Choose a Scrum project for this report."}</p>;
  } else if (meta.sprint && !sprintId) {
    body = <p className="lead-none">No sprint has started on this project yet.</p>;
  } else if (report === "velocity") {
    const closed = sprints
      .filter((s) => s.snapshot)
      .slice(0, 6)
      .reverse();
    csv = () =>
      download(
        `pms-velocity-${stamp}.csv`,
        ["Sprint", "Committed points", "Completed points", "Added points", "Removed points"],
        closed.map((s) => [
          s.name,
          /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).committedPoints,
          /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).completedPoints,
          /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).addedPoints,
          /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).removedPoints,
        ]),
      );
    body = closed.length ? (
      <>
        <GroupedBars
          labels={closed.map((s) => s.name)}
          series={[
            { key: "c", label: "Committed", color: "var(--st-not)", values: closed.map((s) => /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).committedPoints) },
            { key: "d", label: "Completed", color: "var(--st-live)", values: closed.map((s) => /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).completedPoints) },
          ]}
        />
        <Figures
          header={["Sprint", "Committed", "Completed", "Added mid-sprint", "Removed"]}
          rows={closed.map((s) => [
            s.name,
            /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).committedPoints,
            /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).completedPoints,
            /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).addedPoints,
            /** @type {NonNullable<typeof s.snapshot>} */ (s.snapshot).removedPoints,
          ])}
        />
      </>
    ) : (
      <p className="lead-none">No sprint has finished yet. Velocity appears after the first one.</p>
    );
  } else if (!data) {
    body = <p className="lead-none">{error || "Loading…"}</p>;
  } else if (report === "burndown" || report === "burnup") {
    const d = /** @type {Burndown} */ (data);
    const labels = d.days.map(short);
    const unit = d.unit === "points" ? " pts" : "";
    /** @type {Series[]} */ const series =
      report === "burndown"
        ? [
            { key: "r", label: `Remaining ${d.unit}`, color: "var(--st-wip)", values: d.remaining },
            { key: "i", label: "Ideal", color: "var(--st-not)", values: d.ideal, dashed: true },
          ]
        : [
            { key: "s", label: `Total scope (${d.unit})`, color: "var(--st-deploy)", values: d.scope },
            { key: "c", label: `Completed ${d.unit}`, color: "var(--st-live)", values: d.completed },
          ];
    csv = () =>
      download(
        `pms-${report}-${stamp}.csv`,
        ["Day", "Scope", "Completed", "Remaining", "Ideal remaining"],
        d.days.map((day, i) => [day, d.scope[i] ?? "", d.completed[i] ?? "", d.remaining[i] ?? "", d.ideal[i]]),
      );
    body = (
      <>
        <p className="agile-sub">
          {d.sprint.name}: {d.sprint.startDate} to {d.sprint.endDate}
          {d.sprint.goal ? ` · Goal: ${d.sprint.goal}` : ""}
          {d.unit === "items" ? " · counted in work items, as nothing in it has story points" : ""}
        </p>
        <LineChart labels={labels} series={series} unit={unit} />
        <Figures header={["Day", "Scope", "Completed", "Remaining", "Ideal"]} rows={d.days.map((day, i) => [day, d.scope[i] ?? "–", d.completed[i] ?? "–", d.remaining[i] ?? "–", d.ideal[i]])} />
      </>
    );
  } else if (report === "sprint") {
    const d = /** @type {SprintReport} */ (data);
    const p = /** @param {{ storyPoints?: number }[]} list */ (list) => list.reduce((n, i) => n + (i.storyPoints ?? 0), 0);
    /** @type {[string, SprintReport["completed"]][]} */ const groups = [
      ["Completed", d.completed],
      ["Not completed", d.notCompleted],
      ["Added after the start", d.added],
      ["Removed during the sprint", d.removed],
    ];
    csv = () =>
      download(
        `pms-sprint-report-${stamp}.csv`,
        ["Group", "Key", "Summary", "Status", "Story points"],
        groups.flatMap(([g, list]) => list.map((i) => [g, i.key, i.summary, i.statusName, i.storyPoints ?? ""])),
      );
    body = (
      <>
        <p className="agile-sub">
          {d.sprint.name} ({d.sprint.state === "ACTIVE" ? "running" : d.sprint.state === "CLOSED" ? "finished" : "planned"}){d.sprint.snapshot ? ` · committed ${d.sprint.snapshot.committedPoints}, completed ${d.sprint.snapshot.completedPoints} points` : ""}
        </p>
        <div className="agile-groups">
          {groups.map(([g, list]) => (
            <section key={g}>
              <h4>
                {g}{" "}
                <span className="muted">
                  · {list.length} items, {p(list)} points
                </span>
              </h4>
              {list.length ? (
                <ul>
                  {list.map((i) => (
                    <li key={i.key}>
                      <span className="mono">{i.key}</span> {i.summary}{" "}
                      <small className="muted">
                        · {i.statusName}
                        {i.storyPoints != null ? ` · ${i.storyPoints} pts` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lead-none">None.</p>
              )}
            </section>
          ))}
        </div>
      </>
    );
  } else if (report === "flow") {
    const d = /** @type {Flow} */ (data);
    // To Do at the bottom, Done on top, as the work moves up.
    const order = /** @type {const} */ ({ DONE: 2, IN_PROGRESS: 1, TODO: 0 });
    const ordered = [...d.statuses].sort((a, b) => order[b.category] - order[a.category]).reverse();
    const series = ordered.map((s, i) => ({ key: s.id, label: s.name, color: COLORS[i % COLORS.length], values: d.counts[s.id] }));
    csv = () =>
      download(
        `pms-cumulative-flow-${stamp}.csv`,
        ["Day", ...ordered.map((s) => s.name)],
        d.days.map((day, i) => [day, ...ordered.map((s) => d.counts[s.id][i])]),
      );
    body = (
      <>
        <StackedArea labels={d.days.map(short)} series={series} />
        <Figures header={["Day", ...ordered.map((s) => s.name)]} rows={d.days.filter((_, i) => i % 7 === 0 || i === d.days.length - 1).map((day) => [day, ...ordered.map((s) => d.counts[s.id][d.days.indexOf(day)])])} />
      </>
    );
  } else if (report === "created") {
    const d = /** @type {Flow} */ (data);
    // Weekly totals, ending today.
    /** @type {{ label: string; created: number; resolved: number }[]} */ const weeks = [];
    for (let end = d.days.length; end > 0; end -= 7) {
      const from = Math.max(0, end - 7);
      weeks.unshift({ label: short(d.days[from]), created: d.created.slice(from, end).reduce((n, x) => n + x, 0), resolved: d.resolved.slice(from, end).reduce((n, x) => n + x, 0) });
    }
    const net = weeks.reduce((n, w) => n + w.created - w.resolved, 0);
    csv = () =>
      download(
        `pms-created-vs-resolved-${stamp}.csv`,
        ["Week starting", "Created", "Resolved"],
        weeks.map((w) => [w.label, w.created, w.resolved]),
      );
    body = (
      <>
        <p className="agile-sub">
          Over these {windowDays} days, {Math.abs(net)} {net > 0 ? "more were created than resolved: the backlog grew" : net < 0 ? "more were resolved than created: the backlog shrank" : "the backlog held steady"}.
        </p>
        <LineChart
          labels={weeks.map((w) => w.label)}
          series={[
            { key: "c", label: "Created", color: "var(--st-overdue)", values: weeks.map((w) => w.created) },
            { key: "r", label: "Resolved", color: "var(--st-live)", values: weeks.map((w) => w.resolved) },
          ]}
        />
        <Figures header={["Week starting", "Created", "Resolved"]} rows={weeks.map((w) => [w.label, w.created, w.resolved])} />
      </>
    );
  } else if (report === "control" || report === "leadcycle") {
    const d = /** @type {Cycle} */ (data);
    const withCycle = d.items.filter((i) => i.cycleDays != null);
    if (report === "control") {
      const days = withCycle.map((i) => /** @type {NonNullable<typeof i.cycleDays>} */ (i.cycleDays));
      const avg = rollingAverage(days);
      const limit = outlierLimit(days);
      csv = () =>
        download(
          `pms-control-chart-${stamp}.csv`,
          ["Key", "Summary", "Started", "Finished", "Cycle time (days)", "Rolling average", "Outlier"],
          withCycle.map((i, k) => [i.key, i.summary, i.started?.slice(0, 10), i.resolved.slice(0, 10), i.cycleDays, avg[k], limit != null && /** @type {NonNullable<typeof i.cycleDays>} */ (i.cycleDays) > limit ? "Yes" : ""]),
        );
      body = withCycle.length ? (
        <>
          <ControlChart points={withCycle.map((i) => ({ key: i.key, at: i.resolved, days: /** @type {NonNullable<typeof i.cycleDays>} */ (i.cycleDays), label: i.summary }))} average={avg} limit={limit} />
          <Figures header={["Key", "Summary", "Finished", "Cycle time (days)"]} rows={withCycle.map((i) => [i.key, i.summary, i.resolved.slice(0, 10), i.cycleDays])} />
        </>
      ) : (
        <p className="lead-none">Nothing was finished after being started in these {windowDays} days.</p>
      );
    } else {
      const lead = percentiles(d.items.map((i) => i.leadDays));
      const cycle = percentiles(withCycle.map((i) => /** @type {NonNullable<typeof i.cycleDays>} */ (i.cycleDays)));
      csv = () =>
        download(
          `pms-lead-cycle-time-${stamp}.csv`,
          ["Key", "Summary", "Type", "Created", "Started", "Finished", "Lead time (days)", "Cycle time (days)"],
          d.items.map((i) => [i.key, i.summary, i.type, i.created.slice(0, 10), i.started?.slice(0, 10) ?? "", i.resolved.slice(0, 10), i.leadDays, i.cycleDays ?? ""]),
        );
      body = d.items.length ? (
        <>
          <div className="d-kpis d-kpis-report agile-kpis">
            {[
              ["Finished", String(d.items.length), `in the last ${windowDays} days`],
              ["Lead time", lead ? `${lead.median}d` : "–", lead ? `median · 85% within ${lead.p85}d` : ""],
              ["Cycle time", cycle ? `${cycle.median}d` : "–", cycle ? `median · 85% within ${cycle.p85}d` : "no item was started then finished"],
            ].map(([l, v, sub]) => (
              <div key={l} className="d-kpi static">
                <span className="d-kpi-label">{l}</span>
                <span className="d-kpi-value">{v}</span>
                <span className="d-kpi-delta up">{sub}</span>
              </div>
            ))}
          </div>
          <Figures header={["Key", "Summary", "Lead time (days)", "Cycle time (days)"]} rows={d.items.map((i) => [i.key, i.summary, i.leadDays, i.cycleDays ?? "–"])} />
        </>
      ) : (
        <p className="lead-none">Nothing was finished in these {windowDays} days.</p>
      );
    }
  }
  return (
    <Panel title={overview ? "Delivery charts" : "Agile reports"} className="agile-reports" action={<span className="d-hint">from status history and sprint snapshots</span>}>
      <div className="agile-toolbar no-print" role="group" aria-label="Agile report options">
        <select className="d-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Project or workspace">
          <optgroup label="Projects">
            {systems.map((s) => (
              <option key={s.id} value={`p:${s.id}`}>
                {s.key ? `${s.key} · ` : ""}
                {s.name}
                {s.agileMode === "scrum" ? " (sprints)" : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Workspaces">
            {workspaces.map((w) => (
              <option key={w} value={`w:${w}`}>
                {w} workspace
              </option>
            ))}
          </optgroup>
        </select>
        <select className="d-select" value={report} onChange={(e) => setReport(/** @type {Report} */ (e.target.value))} aria-label="Report">
          {REPORTS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        {meta.sprint && sprints.length > 0 && (
          <select className="d-select" value={sprintId} onChange={(e) => setSprintId(e.target.value)} aria-label="Sprint">
            {sprints
              .filter((s) => s.state !== "FUTURE")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.state === "ACTIVE" ? " (running)" : ""}
                </option>
              ))}
          </select>
        )}
        {!meta.scrum && (
          <select className="d-select" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} aria-label="Period">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>
        )}
        <span className="page-actions">
          <button className="btn btn-ghost sm" onClick={() => csv?.()} disabled={!csv}>
            <Download size={15} /> CSV
          </button>
          <button className="btn btn-navy sm" onClick={() => window.print()}>
            <Printer size={15} /> Print / PDF
          </button>
        </span>
      </div>
      <h4 className="agile-title">
        {meta.label} · {scopeName}
        {meta.sprint && sprint ? ` · ${sprint.name}` : ""}
      </h4>
      <p className="agile-note">
        <b>What to look for:</b> {meta.note}
      </p>
      {body}
    </Panel>
  );
}
/**
 * The figures behind a chart, for screen readers and anyone who wants the numbers.
 * @param {{ header: string[]; rows: unknown[][] }} arg1
 */
function Figures({ header, rows }) {
  return (
    <details className="agile-figures">
      <summary>Show the figures</summary>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {header.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, k) => (
                  <td key={k}>{String(c ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
/** @typedef {"burndown" | "burnup" | "velocity" | "sprint" | "flow" | "control" | "created" | "leadcycle"} Report */
/**
 * @typedef {Object} Burndown
 * @property {Sprint} sprint
 * @property {"points" | "items"} unit
 * @property {string[]} days
 * @property {(number | null)[]} scope
 * @property {(number | null)[]} completed
 * @property {(number | null)[]} remaining
 * @property {number[]} ideal
 */
/**
 * @typedef {Object} SprintReport
 * @property {Sprint} sprint
 * @property {(WorkItemSummary & { pointsThen: number | null })[]} completed
 * @property {(WorkItemSummary & { pointsThen: number | null })[]} notCompleted
 * @property {(WorkItemSummary & { pointsThen: number | null })[]} added
 * @property {(WorkItemSummary & { pointsThen: number | null })[]} removed
 */
/**
 * @typedef {Object} Flow
 * @property {string[]} days
 * @property {StatusDef[]} statuses
 * @property {Record<string, number[]>} counts
 * @property {number[]} created
 * @property {number[]} resolved
 */
/**
 * @typedef {Object} Cycle
 * @property {{ key: string; summary: string; type: string; created: string; started: string | null; resolved: string; leadDays: number; cycleDays: number | null }[]} items
 */
