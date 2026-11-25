/** @import { ReactNode } from 'react' */
/** @import { LucideIcon } from 'lucide-react' */
/** @import { User } from '../../data/roles' */
/** @import { Schedule } from '../../data/systems' */
/** @import { Rag } from '../../data/projectHealth' */
/** @import { ProjectReport, ProjectReportFilters, ProjectRow, ProjectTrends } from '../../data/projectReport' */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, CheckCircle2, CircleDashed, FileSpreadsheet, FolderKanban, Gauge, Inbox, Link2, LineChart as LineIcon, ListChecks, MailWarning, PieChart, Printer, RefreshCw, RotateCcw, Search, Users } from "lucide-react";
import { api } from "../../data/api";
import { SCHEDULE_META } from "../../data/systems";
import { RAG_META, RAG_RULES } from "../../data/projectHealth";
import { RAG_KEYS, SCHEDULE_KEYS, STAGE_KEYS, STAGE_LABEL, defaultFilters, describeFilters, filtersToQuery, parseFilters } from "../../data/projectReport";
import { STAGE_COLOR, TooltipLayer } from "./chartKit";
import { Columns, Donut } from "./DashCharts";
import { LineChart } from "./AgileCharts";
import Panel from "../Panel";
import CountUp from "../CountUp";
const HASH = "#/reports/projects";
/** @type {Record<Rag, LucideIcon>} */ const RAG_ICON = { RED: AlertOctagon, AMBER: AlertTriangle, GREEN: CheckCircle2, NONE: CircleDashed };
/** @type {Record<Rag, string>} */ const RAG_COLOR = { RED: "var(--danger)", AMBER: "var(--warning)", GREEN: "var(--success)", NONE: "var(--st-not)" };
/** The filters in the address, so a filtered report can be bookmarked and shared. */
const readHash =
  /** @param {number} now
   * @returns {ProjectReportFilters}
   */ (now) => parseFilters(new URLSearchParams(window.location.hash.startsWith(HASH) ? (window.location.hash.split("?")[1] ?? "") : ""), now);
/**
 * @template T
 * @param {string} path
 * @returns {{ retry: () => void; data: T | null; error: string; loading: boolean; }}
 */
function useLoad(path) {
  const [state, setState] = useState(/** @type {{ data: T | null; error: string; loading: boolean } | (() => { data: T | null; error: string; loading: boolean })} */ ({ data: null, error: "", loading: true }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    /** @type {Promise<T>} */ (/** @type {unknown} */ (api(path))).then((data) => live && setState({ data, error: "", loading: false })).catch((e) => live && setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Couldn't load the report", loading: false })));
    return () => {
      live = false;
    };
  }, [path, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}
/**
 * Loading, error and empty states for every chart and table, the same way everywhere.
 * @param {{ loading: boolean; error: string; empty?: string | false | null; onRetry: () => void; children: ReactNode; lines?: number }} arg2
 */
function State({ loading, error, empty, onRetry, children, lines = 5 }) {
  if (error)
    return (
      <div className="gadget-state error" role="alert">
        <span className="gadget-state-icon" aria-hidden="true">
          <AlertTriangle size={18} />
        </span>
        <p>{error}</p>
        <button className="btn btn-ghost sm" onClick={onRetry}>
          <RefreshCw size={13} aria-hidden="true" /> Retry
        </button>
      </div>
    );
  if (loading)
    return (
      <div role="status">
        <span className="sr-only">Loading…</span>
        <span className="skel-stack" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} className="skel skel-line" />
          ))}
        </span>
      </div>
    );
  if (empty)
    return (
      <div className="gadget-state">
        <span className="gadget-state-icon" aria-hidden="true">
          <Inbox size={18} />
        </span>
        <p>{empty}</p>
      </div>
    );
  return <>{children}</>;
}
/**
 * @param {{ rag: Rag; reasons?: string[] }} props
 */
export function RagPill({ rag, reasons }) {
  const Icon = RAG_ICON[rag];
  const why = reasons?.length ? reasons.join("; ") : RAG_META[rag].label;
  return (
    <span className={`rag-pill rag-${rag.toLowerCase()}`} title={why}>
      <Icon size={13} aria-hidden="true" />
      {RAG_META[rag].label}
      <span className="sr-only">: {why}</span>
    </span>
  );
}
/** @type {{ key: SortKey; label: string; num?: boolean }[]} */ const COLUMNS = [
  { key: "name", label: "Project" },
  { key: "stage", label: "Stage" },
  { key: "schedule", label: "Schedule" },
  { key: "rag", label: "Health" },
  { key: "progress", label: "Progress", num: true },
  { key: "lead", label: "Lead" },
  { key: "developers", label: "Devs", num: true },
  { key: "openItems", label: "Open items", num: true },
  { key: "overdueItems", label: "Overdue", num: true },
  { key: "openBlockers", label: "Blockers", num: true },
  { key: "lastUpdate", label: "Last update" },
  { key: "daysSinceUpdate", label: "Days since", num: true },
];
const sortValue =
  /**
   * @param {ProjectRow} r
   * @param {SortKey} k
   * @returns {string | number}
   */ (r, k) => {
    if (k === "rag") return RAG_META[r.rag].rank;
    if (k === "stage") return STAGE_KEYS.indexOf(r.stage);
    if (k === "schedule") return SCHEDULE_KEYS.indexOf(r.schedule);
    const v = r[k];
    return v === null ? -1 : v;
  };
/**
 * Reports → Projects: how every project is doing, worked out by the Worker (src/data/projectReport.ts).
 * @param {Props} arg2
 */
export default function ReportsPage({ me, users, workspaces, now }) {
  const [filters, setFilters] = useState(/** @type {ProjectReportFilters | (() => ProjectReportFilters)} */ (() => readHash(now)));
  const query = filtersToQuery(filters, now);
  const summary = /** @type {{ retry: () => void; data: ProjectReport | null; error: string; loading: boolean; }} */ (/** @type {unknown} */ (useLoad(`/reports/projects/summary?${query}`)));
  const trends = /** @type {{ retry: () => void; data: ProjectTrends | null; error: string; loading: boolean; }} */ (/** @type {unknown} */ (useLoad(`/reports/projects/trends?${query}`)));
  const report = summary.data;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(/** @type {{ key: SortKey; dir: 1 | -1 } | (() => { key: SortKey; dir: 1 | -1 })} */ ({ key: "rag", dir: -1 }));
  const [copied, setCopied] = useState(false);
  // The address follows the filters (without adding history entries, so Back leaves Reports).
  useEffect(() => {
    const next = `${HASH}${query ? `?${query}` : ""}`;
    if (window.location.hash !== next) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${next}`);
  }, [query]);
  useEffect(() => {
    const onHash = () => window.location.hash.startsWith(HASH) && setFilters(readHash(Date.now()));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const set = /** @template {keyof ProjectReportFilters} K @param {K} k @param {ProjectReportFilters[K]} v */ (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const nameOf = useCallback(/** @param {string} id */ (id) => users.find((u) => u.id === id)?.name ?? id, [users]);
  const leads = useMemo(() => users.filter((u) => ["admin", "manager", "team_lead", "developer", "assistant"].includes(u.role)).sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const filterWords = describeFilters(filters, nameOf);
  const generated = report ? new Date(report.generatedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }) : "";
  const isDefault = filtersToQuery(filters, now) === filtersToQuery(defaultFilters(now), now);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase();
    const list = (report?.rows ?? []).filter((r) => !words || `${r.name} ${r.lead} ${r.workspace}`.toLowerCase().includes(words));
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [report, q, sort]);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const printPdf = () => {
    // A4 landscape, page numbers in the footer; only for this print.
    const style = document.createElement("style");
    style.textContent = `@page { size: A4 landscape; margin: 12mm 12mm 16mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt Inter, sans-serif; color: #464b66; } @bottom-left { content: "Omni Contact · Pulse · Projects report"; font: 9pt Inter, sans-serif; color: #464b66; } }`;
    document.head.appendChild(style);
    document.body.classList.add("printing-project-report");
    const done = () => {
      style.remove();
      document.body.classList.remove("printing-project-report");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };
  const t = report?.totals;
  /** @type {{ label: string; value: number; suffix?: string; note: string; icon: LucideIcon; tone: string; trend: "up" | "down" | "flat" }[]} */ const kpis = t
    ? [
        { label: "Projects", value: t.projects, note: `${t.portfolio} in the portfolio · ${t.needsAttention} need attention`, icon: FolderKanban, tone: "cyan", trend: "flat" },
        { label: "Off track", value: t.byRag.RED, note: `${t.byRag.AMBER} at risk · ${t.byRag.GREEN} on track`, icon: AlertOctagon, tone: "red", trend: t.byRag.RED ? "down" : "up" },
        { label: "Average progress", value: t.averageProgress, suffix: "%", note: `Across ${t.byRag.RED + t.byRag.AMBER + t.byRag.GREEN} projects being built`, icon: Gauge, tone: "green", trend: "flat" },
        { label: "Open blockers", value: t.openBlockers, note: `${t.overdueItems} of ${t.openItems} open work items overdue`, icon: AlertTriangle, tone: "amber", trend: t.openBlockers ? "down" : "up" },
        { label: "Overdue update requests", value: t.overdueRequests, note: `${t.openRequests} open · overdue after ${RAG_RULES.requestOverdueWorkingDays} working days`, icon: MailWarning, tone: "violet", trend: t.overdueRequests ? "down" : "up" },
        { label: "Over the workload limit", value: t.overloadedDevelopers, note: `${/** @type {NonNullable<typeof report>} */ (report).developers.length} developers on these projects`, icon: Users, tone: "cyan", trend: t.overloadedDevelopers ? "down" : "up" },
      ]
    : [];
  const TREND_ICON = { up: CheckCircle2, down: AlertTriangle, flat: ListChecks };
  const weekLabels = (trends.data?.weeks ?? []).map((w) => new Date(`${w.week}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }));
  const noItems = !!trends.data && trends.data.weeks.every((w) => !w.created && !w.resolved && !w.scope);
  return (
    <TooltipLayer>
      <div className="page report d-style project-report">
        {/* Printed first: the cover. */}
        <section className="pr-cover" aria-hidden="true">
          <img src="/omni-logo.png" alt="" className="pr-cover-logo" />
          <p className="pr-cover-kicker">Pulse · Omni Contact</p>
          <h1>Projects report</h1>
          <p className="pr-cover-period">
            {filters.from} to {filters.to}
          </p>
          <dl>
            <dt>Filters</dt>
            <dd>{filterWords.slice(1).join(" · ") || "None: the whole portfolio"}</dd>
            <dt>Generated by</dt>
            <dd>{me.name}</dd>
            <dt>Generated at</dt>
            <dd>{generated}</dd>
          </dl>
          <p className="pr-cover-note">Health (RAG) follows the rule in DECISIONS.md. Figures count only the work items {me.name.split(" ")[0]} may see.</p>
        </section>

        <header className="dash-head no-print">
          <div>
            <h2>Projects report</h2>
            <p>How every project is doing: health, progress, blockers and who's on them. {generated && `Generated ${generated}.`}</p>
          </div>
          <div className="dash-actions">
            <button className="btn btn-ghost sm" onClick={copyLink} title="Copy a link to this report with its filters">
              <Link2 size={14} aria-hidden="true" /> {copied ? "Link copied" : "Copy link"}
            </button>
            <a className="btn btn-ghost sm" href={`/api/reports/projects/export.xlsx?${query}`} download>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </a>
            <button className="btn btn-navy sm" onClick={printPdf} disabled={!report} title="Opens the print dialog: choose Save as PDF">
              <Printer size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        </header>

        <section className="d-card pr-filters no-print" role="group" aria-label="Report filters">
          <label>
            <span>From</span>
            <input type="date" value={filters.from} max={filters.to} onChange={(e) => e.target.value && set("from", e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={filters.to} min={filters.from} onChange={(e) => e.target.value && set("to", e.target.value)} />
          </label>
          <label>
            <span>Stage</span>
            <select value={filters.stage} onChange={(e) => set("stage", /** @type {ProjectReportFilters["stage"]} */ (e.target.value))}>
              <option value="">All stages</option>
              {STAGE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {STAGE_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Schedule</span>
            <select value={filters.schedule} onChange={(e) => set("schedule", /** @type {Schedule | ""} */ (e.target.value))}>
              <option value="">Any schedule</option>
              {SCHEDULE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SCHEDULE_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Health</span>
            <select value={filters.rag} onChange={(e) => set("rag", /** @type {Rag | ""} */ (e.target.value))}>
              <option value="">Any health</option>
              {RAG_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RAG_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Lead</span>
            <select value={filters.lead} onChange={(e) => set("lead", e.target.value)}>
              <option value="">Any lead</option>
              {leads.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Workspace</span>
            <select value={filters.workspace} onChange={(e) => set("workspace", e.target.value)}>
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost sm" onClick={() => setFilters(defaultFilters(now))} disabled={isDefault}>
            <RotateCcw size={13} aria-hidden="true" /> Reset
          </button>
        </section>
        <p className="pr-filter-line">{filterWords.join(" · ")}</p>

        {/* 1. Figures */}
        <section className="d-kpis pr-kpis" aria-label="Key figures" aria-busy={summary.loading}>
          {summary.error ? (
            <div className="d-card pr-kpi-error">
              <State loading={false} error={summary.error} onRetry={summary.retry}>
                {null}
              </State>
            </div>
          ) : !t ? (
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="d-kpi static" aria-hidden="true">
                <span className="skel skel-line" />
                <span className="skel skel-line" />
              </div>
            ))
          ) : (
            kpis.map((k) => {
              const Trend = TREND_ICON[k.trend];
              return (
                <div key={k.label} className="d-kpi static">
                  <span className="d-kpi-label">{k.label}</span>
                  <span className="d-kpi-value">
                    <CountUp value={k.value} />
                    {k.suffix}
                  </span>
                  <span className={`d-kpi-delta ${k.trend}`}>
                    <Trend size={13} aria-hidden="true" />
                    {k.note}
                  </span>
                  <span className={`d-kpi-icon tone-${k.tone}`} aria-hidden="true">
                    <k.icon size={18} />
                  </span>
                </div>
              );
            })
          )}
        </section>

        {/* 2. Charts */}
        <div className="pr-grid">
          <Panel title="Health" icon={AlertOctagon} className="pr-span-4">
            <State loading={summary.loading && !report} error={summary.error} onRetry={summary.retry} empty={report && !report.rows.length && "No projects match these filters."}>
              {report && (
                <>
                  <div className="pr-rag-bar" role="img" aria-label={RAG_KEYS.map((k) => `${RAG_META[k].label}: ${report.totals.byRag[k]}`).join(", ")}>
                    {RAG_KEYS.filter((k) => report.totals.byRag[k]).map((k) => (
                      <span key={k} style={{ flexGrow: report.totals.byRag[k], background: RAG_COLOR[k] }} title={`${RAG_META[k].label}: ${report.totals.byRag[k]}`} />
                    ))}
                  </div>
                  <ul className="pr-rag-list">
                    {RAG_KEYS.map((k) => (
                      <li key={k}>
                        <button className={filters.rag === k ? "on" : ""} onClick={() => set("rag", filters.rag === k ? "" : k)} aria-pressed={filters.rag === k} title={`Show only "${RAG_META[k].label}"`}>
                          <RagPill rag={k} />
                          <b>{report.totals.byRag[k]}</b>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="d-hint">Off track and at risk are worked out from due dates, blockers, updates, pace and overdue work. Hover a project's health in the table for its reasons.</p>
                </>
              )}
            </State>
          </Panel>

          <Panel title="By stage" icon={PieChart} className="pr-span-4">
            <State loading={summary.loading && !report} error={summary.error} onRetry={summary.retry} empty={report && !report.rows.length && "No projects match these filters."}>
              {report && (
                <div className="pr-donut">
                  <Donut slices={STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABEL[k], color: STAGE_COLOR[k], value: report.totals.byStage[k] }))} centre="projects" />
                  <ul className="viz-legend">
                    {STAGE_KEYS.filter((k) => report.totals.byStage[k]).map((k) => (
                      <li key={k}>
                        <i className="viz-key rect" style={{ background: STAGE_COLOR[k] }} />
                        {STAGE_LABEL[k]} <b>{report.totals.byStage[k]}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </State>
          </Panel>

          <Panel title="By schedule" icon={BarChart3} className="pr-span-4">
            <State loading={summary.loading && !report} error={summary.error} onRetry={summary.retry} empty={report && !report.rows.length && "No projects match these filters."}>
              {report && <Columns bars={SCHEDULE_KEYS.map((k) => ({ key: k, label: SCHEDULE_META[k].label, color: `var(--st-${{ ON_TRACK: "live", AT_RISK: "deploy", OVERDUE: "overdue", DONE: "done", UNSCHEDULED: "not" }[k]})`, value: report.totals.bySchedule[k] }))} />}
            </State>
          </Panel>

          <Panel title="Progress over time" icon={LineIcon} className="pr-span-6" action={<span className="d-hint">average of projects under way, weekly</span>}>
            <State loading={trends.loading && !trends.data} error={trends.error} onRetry={trends.retry} empty={trends.data && trends.data.weeks.every((w) => w.avgProgress === null) && "No projects were under way in this period."}>
              {trends.data && <LineChart labels={weekLabels} series={[{ key: "p", label: "Average progress", color: "var(--cat-1)", values: trends.data.weeks.map((w) => w.avgProgress) }]} unit="%" />}
            </State>
          </Panel>

          <Panel title="Work items created vs resolved" icon={ListChecks} className="pr-span-6" action={<span className="d-hint">weekly, items you can see</span>}>
            <State loading={trends.loading && !trends.data} error={trends.error} onRetry={trends.retry} empty={noItems && "These projects have no work items in this period."}>
              {trends.data && (
                <LineChart
                  labels={weekLabels}
                  series={[
                    { key: "c", label: "Created", color: "var(--cat-1)", values: trends.data.weeks.map((w) => w.created) },
                    { key: "r", label: "Resolved", color: "var(--cat-2)", values: trends.data.weeks.map((w) => w.resolved) },
                  ]}
                  unit=" items"
                />
              )}
            </State>
          </Panel>

          <Panel title="Burn-up" icon={LineIcon} className="pr-span-6" action={<span className="d-hint">all items vs done, cumulative</span>}>
            <State loading={trends.loading && !trends.data} error={trends.error} onRetry={trends.retry} empty={noItems && "These projects have no work items in this period."}>
              {trends.data && (
                <LineChart
                  labels={weekLabels}
                  series={[
                    { key: "s", label: "All items", color: "var(--cat-4)", values: trends.data.weeks.map((w) => w.scope) },
                    { key: "d", label: "Done", color: "var(--cat-7)", values: trends.data.weeks.map((w) => w.done) },
                  ]}
                  unit=" items"
                />
              )}
            </State>
          </Panel>

          <Panel title="Throughput by project" icon={BarChart3} className="pr-span-6" action={<span className="d-hint">items resolved and hours logged in the period</span>}>
            <State loading={trends.loading && !trends.data} error={trends.error} onRetry={trends.retry} empty={trends.data && !trends.data.throughput.length && "Nothing was resolved or logged in this period."}>
              {trends.data && (
                <ul className="pr-bars">
                  {trends.data.throughput.slice(0, 10).map((x) => {
                    const max = Math.max(.../** @type {NonNullable<typeof trends.data>} */ (trends.data).throughput.map((y) => y.resolved), 1);
                    return (
                      <li key={x.id} title={`${x.name}: ${x.resolved} resolved, ${x.hours} hours logged`}>
                        <span className="pr-bar-name">{x.name}</span>
                        <span className="pr-bar-track">
                          <i style={{ width: `${(x.resolved / max) * 100}%` }} />
                        </span>
                        <b>{x.resolved}</b>
                        <small>{x.hours} h</small>
                      </li>
                    );
                  })}
                </ul>
              )}
            </State>
          </Panel>
        </div>

        {/* 3. Resourcing */}
        <Panel title="Resourcing" icon={Users} className="pr-block" action={<span className="d-hint">developers on these projects; the limit counts all their projects</span>}>
          <State loading={summary.loading && !report} error={summary.error} onRetry={summary.retry} empty={report && !report.developers.length && "No developers are assigned to these projects."}>
            {report && (
              <div className="gadget-scroll">
                <table className="gadget-table">
                  <caption className="sr-only">Developer allocation across the projects in this report</caption>
                  <thead>
                    <tr>
                      <th scope="col">Developer</th>
                      <th scope="col" className="num">
                        Projects
                      </th>
                      <th scope="col" className="num">
                        Open requests
                      </th>
                      <th scope="col">Workload</th>
                      <th scope="col">On these projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.developers.map((d) => (
                      <tr key={d.id}>
                        <th scope="row">{d.name}</th>
                        <td className="num">{d.projects}</td>
                        <td className="num">{d.openFeatures}</td>
                        <td>
                          {d.overloaded ? (
                            <span className="rag-pill rag-red" title={d.reasons.join("; ")}>
                              <AlertOctagon size={13} aria-hidden="true" /> Over the limit<span className="sr-only">: {d.reasons.join("; ")}</span>
                            </span>
                          ) : (
                            <span className="rag-pill rag-green">
                              <CheckCircle2 size={13} aria-hidden="true" /> Within limit
                            </span>
                          )}
                        </td>
                        <td>{d.projectsInReport.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </State>
        </Panel>

        {/* 4. The table */}
        <Panel
          title="Projects"
          icon={FolderKanban}
          className="pr-block pr-table-card"
          action={
            <label className="pr-search no-print">
              <Search size={14} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a project, lead or workspace" aria-label="Find a project" />
            </label>
          }
          footer={report && <span>{rows.length === report.rows.length ? `${rows.length} projects` : `${rows.length} of ${report.rows.length} projects`}</span>}
        >
          <State loading={summary.loading && !report} error={summary.error} onRetry={summary.retry} lines={8} empty={report && !rows.length && (q ? "No project matches that search." : "No projects match these filters.")}>
            <div className="gadget-scroll pr-table-scroll">
              <table className="gadget-table pr-table">
                <caption className="sr-only">Projects in this report. Column headers sort the table.</caption>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => {
                      const on = sort.key === c.key;
                      const Icon = on ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <th key={c.key} scope="col" className={c.num ? "num" : ""} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                          <button className="pr-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? /** @type {1 | -1} */ (-s.dir) : c.num || c.key === "rag" ? -1 : 1 }))}>
                            {c.label}
                            <Icon size={12} aria-hidden="true" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        <a href={`#/projects/${r.id}`}>{r.name}</a>
                        {r.workspace && <small className="muted"> · {r.workspace}</small>}
                      </th>
                      <td>{r.stageLabel}</td>
                      <td>{r.scheduleLabel}</td>
                      <td>
                        <RagPill rag={r.rag} reasons={r.reasons} />
                      </td>
                      <td className="num">
                        <span className="pr-progress" title={r.expected !== null ? `${r.progress}% done, ${r.expected}% expected by today` : `${r.progress}% done`}>
                          <i style={{ width: `${r.progress}%` }} />
                          {r.expected !== null && <em style={{ left: `${r.expected}%` }} aria-hidden="true" />}
                        </span>
                        {r.progress}%
                      </td>
                      <td>{r.lead || <span className="muted">—</span>}</td>
                      <td className="num" title={r.developerNames.join(", ")}>
                        {r.developers}
                      </td>
                      <td className="num">{r.openItems}</td>
                      <td className={`num ${r.overdueItems ? "late" : ""}`}>{r.overdueItems}</td>
                      <td className={`num ${r.openBlockers ? "late" : ""}`}>{r.openBlockers}</td>
                      <td>{r.lastUpdate}</td>
                      <td className="num">{r.daysSinceUpdate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </State>
        </Panel>
      </div>
    </TooltipLayer>
  );
}
/** @typedef {"name" | "stage" | "schedule" | "rag" | "progress" | "lead" | "developers" | "openItems" | "overdueItems" | "openBlockers" | "lastUpdate" | "daysSinceUpdate"} SortKey */
/**
 * @typedef {Object} Props
 * @property {User} me
 * @property {User[]} users
 * @property {string[]} workspaces
 * @property {number} now
 */
