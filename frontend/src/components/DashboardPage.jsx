/** @import { ReactNode } from 'react' */
/** @import { Schedule, System } from '../data/systems' */
/** @import { UpdateRequest, User } from '../data/roles' */
/** @import { Feature } from '../data/features' */
/** @import { Blocker, Limits, ProjectDocument } from '../data/project' */
/** @import { Filter } from './Sidebar' */
import { useState } from "react";
import { Activity, AlertOctagon, AlertTriangle, ArrowRight, BarChart3, CalendarCheck, CalendarClock, CheckCircle2, FileText, FolderKanban, History, ListChecks, PieChart, Radio, TrendingUp, Upload, Users } from "lucide-react";
import { SCHEDULE_META, daysUntil, getSchedule, initials } from "../data/systems";
import { isOpen } from "../data/features";
import { isActive, stalledDays, workloadOf } from "../data/project";
import { needsAttention } from "../data/projectHealth";
import { formatDate, plural, timeAgo } from "../time";
import CountUp from "./CountUp";
import { ProgressBar, StatusPill } from "./SystemCard";
import { STAGES, STAGE_COLOR, TooltipLayer, stageOf } from "./reports/chartKit";
import { WorkloadBars } from "./reports/Charts";
import { Columns, Donut, Sparkline, TrendChart } from "./reports/DashCharts";
import Panel from "./Panel";
import MyWork from "./MyWork";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** @type {Record<Schedule, string>} */ const SCHEDULE_COLOR = {
  ON_TRACK: "var(--st-live)",
  AT_RISK: "var(--st-deploy)",
  OVERDUE: "var(--st-overdue)",
  DONE: "var(--st-done)",
  UNSCHEDULED: "var(--st-not)",
};
/**
 * The analytical home page, laid out like an admin dashboard: figures, trends, breakdowns, activity.
 * @param {Props} props
 */
export default function DashboardPage({ systems, users, features, blockers, documents, limits, now, isMine, onOpen, onTab, showMyWork = false }) {
  const [range, setRange] = useState(/** @type {"year" | "12m" | (() => "year" | "12m")} */ ("year"));
  const [stageScope, setStageScope] = useState(/** @type {"all" | "mine" | (() => "all" | "mine")} */ ("all"));
  const name = /** @param {string} [id] */ (id) => users.find((u) => u.id === id)?.name;
  const sysName = /** @param {string} id */ (id) => systems.find((s) => s.id === id)?.name ?? "a project";
  const year = new Date(now).getFullYear();
  const inYear = /** @param {string} [iso] */ (iso) => !!iso && new Date(iso).getFullYear() === year;
  // ---- headline figures ----
  const active = systems.filter((s) => isActive(s, now));
  const avg = active.length ? Math.round(active.reduce((n, s) => n + s.progress, 0) / active.length) : 0;
  const openBlockers = /** @param {System} s */ (s) => blockers.filter((b) => b.systemId === s.id && !b.resolvedAt);
  const blockedOrStalled = systems.filter((s) => openBlockers(s).length || stalledDays(s, now, limits) !== null);
  const overdue = systems.filter((s) => getSchedule(s, now) === "OVERDUE");
  // The shared rule (src/data/projectHealth.ts): the same on the executive page and in Reports.
  const attentionIds = new Set(systems.filter((s) => needsAttention(s, openBlockers(s).length > 0, now, limits)).map((s) => s.id));
  const live = systems.filter((s) => s.status === "LIVE");
  const startedThisYear = systems.filter((s) => inYear(s.startedAt) && new Date(s.startedAt).getTime() <= now).length;
  const deliveredThisYear = systems.filter((s) => inYear(s.finishedAt)).length;
  // Due in the next 7 days (today included), not yet finished.
  const dueThisWeek = systems.filter((s) => !s.finishedAt && s.dueAt && daysUntil(s.dueAt, now) >= 0 && daysUntil(s.dueAt, now) <= 7).sort((a, b) => /** @type {NonNullable<typeof a.dueAt>} */ (a.dueAt).localeCompare(/** @type {NonNullable<typeof b.dueAt>} */ (b.dueAt)));
  // trend: "up" good news, "down" needs action, "flat" information. Each carries an icon and words, never colour alone.
  /** @type {Kpi[]} */ const kpis = [
    {
      label: "In progress",
      value: active.length,
      delta: `${avg}% average progress · ${startedThisYear} started in ${year}`,
      trend: avg >= 50 ? "up" : "flat",
      icon: TrendingUp,
      tone: "cyan",
      tab: "WIP",
      title: "Show projects in progress",
    },
    {
      label: "Due this week",
      value: dueThisWeek.length,
      delta: dueThisWeek.length ? `Next: ${dueThisWeek[0].name}, ${formatDate(/** @type {string} */ (dueThisWeek[0].dueAt))}` : "Nothing due in the next 7 days",
      trend: "flat",
      icon: CalendarClock,
      tone: "amber",
      tab: "ALL",
      title: "Show all projects",
    },
    {
      label: "Need attention",
      value: attentionIds.size,
      delta: attentionIds.size ? `${blockedOrStalled.length} blocked or stalled · ${overdue.length} overdue` : "Nothing overdue, blocked or stalled",
      trend: attentionIds.size ? "down" : "up",
      icon: AlertTriangle,
      tone: "red",
      tab: /** @type {Filter} */ (blockedOrStalled.length ? "BLOCKED" : "OVERDUE"),
      title: "Show the projects that need attention",
    },
    {
      label: "Live",
      value: live.length,
      delta: `${plural(deliveredThisYear, "project")} delivered in ${year}`,
      trend: "up",
      icon: Radio,
      tone: "green",
      tab: "LIVE",
      title: "Show live projects",
    },
  ];
  const TREND_ICON = { up: CheckCircle2, down: AlertOctagon, flat: ArrowRight };
  // ---- monthly trend ----
  const buckets =
    range === "year"
      ? MONTHS.map((m, i) => ({ label: m, y: year, m: i }))
      : Array.from({ length: 12 }, (_, k) => {
          const d = new Date(now);
          d.setDate(1);
          d.setMonth(d.getMonth() - 11 + k);
          return {
            label: MONTHS[d.getMonth()],
            y: d.getFullYear(),
            m: d.getMonth(),
          };
        });
  const countIn = /** @param {(string | undefined)[]} dates */ (dates) =>
    buckets.map(
      (b) =>
        dates.filter((iso) => {
          if (!iso) return false;
          const d = new Date(iso);
          return d.getFullYear() === b.y && d.getMonth() === b.m && d.getTime() <= now;
        }).length,
    );
  const trend = [
    // Series identity, not status: the categorical chart palette.
    {
      key: "started",
      label: "Projects started",
      color: "var(--cat-1)",
      values: countIn(systems.map((s) => s.startedAt)),
    },
    {
      key: "delivered",
      label: "Projects delivered",
      color: "var(--cat-7)",
      values: countIn(systems.map((s) => s.finishedAt)),
    },
    {
      key: "requests",
      label: "Client requests",
      color: "var(--cat-2)",
      values: countIn(features.map((f) => f.createdAt)),
    },
  ];
  const sum = /** @param {number[]} v */ (v) => v.reduce((n, x) => n + x, 0);
  // Card sparklines over the same months as the trend, in the same series colours.
  /** @type {Record<string, { values: number[]; color: string; label: string }>} */ const sparks = {
    "In progress": {
      values: trend[0].values,
      color: "var(--cat-1)",
      label: "Projects started per month",
    },
    Live: {
      values: trend[1].values,
      color: "var(--cat-7)",
      label: "Projects delivered per month",
    },
  };
  // ---- projects by stage ----
  const scoped = stageScope === "mine" ? systems.filter(isMine) : systems;
  const stageRows = STAGES.map((st) => {
    const items = scoped.filter((s) => stageOf(s.status) === st.key);
    return {
      key: st.key,
      label: st.label,
      color: STAGE_COLOR[st.key],
      value: items.length,
      avg: items.length ? Math.round(items.reduce((n, s) => n + s.progress, 0) / items.length) : 0,
    };
  });
  // ---- delivery health ----
  const health = /** @type {Schedule[]} */ (["ON_TRACK", "AT_RISK", "OVERDUE", "DONE", "UNSCHEDULED"]).map((k) => ({
    key: k,
    label: SCHEDULE_META[k].label,
    color: SCHEDULE_COLOR[k],
    value: systems.filter((s) => getSchedule(s, now) === k).length,
  }));
  // ---- project leads ----
  const leads = users
    .map((u) => ({ user: u, items: systems.filter((s) => s.lead === u.id) }))
    .filter((x) => x.items.length)
    .sort((a, b) => b.items.length - a.items.length || a.user.name.localeCompare(b.user.name))
    .slice(0, 6);
  // ---- recent activity, from what everyone can already see ----
  /** @type {{
      at: string;
      icon: typeof Activity;
      tone: string;
      text: ReactNode;
      id?: string;
    }[]} */ const events = [
    ...systems
      .filter((s) => s.updatedAt && new Date(s.updatedAt).getTime() <= now)
      .map((s) => ({
        at: /** @type {NonNullable<typeof s.updatedAt>} */ (s.updatedAt),
        icon: TrendingUp,
        tone: "cyan",
        id: s.id,
        text: (
          <>
            <b>{s.name}</b> updated to {s.progress}% ({s.updatedBy})
          </>
        ),
      })),
    ...features.map((f) => ({
      at: f.createdAt,
      icon: ListChecks,
      tone: "amber",
      id: f.systemId,
      text: (
        <>
          <b>{name(f.createdBy) ?? "Someone"}</b> logged a client request "{f.title}" on {sysName(f.systemId)}
        </>
      ),
    })),
    ...blockers.map((b) => ({
      at: b.resolvedAt ?? b.raisedAt,
      icon: b.resolvedAt ? CheckCircle2 : AlertOctagon,
      tone: b.resolvedAt ? "green" : "red",
      id: b.systemId,
      text: b.resolvedAt ? (
        <>
          <b>{name(b.resolvedBy) ?? "Someone"}</b> resolved a blocker on {sysName(b.systemId)}
        </>
      ) : (
        <>
          <b>{name(b.raisedBy) ?? "Someone"}</b> raised a blocker on {sysName(b.systemId)}: "{b.text}"
        </>
      ),
    })),
    ...documents.map((d) => ({
      at: d.uploadedAt,
      icon: Upload,
      tone: "violet",
      id: d.systemId,
      text: (
        <>
          <b>{name(d.uploadedBy) ?? "Someone"}</b> added "{d.name}" to {sysName(d.systemId)}
        </>
      ),
    })),
    ...systems
      .filter((s) => s.pcn)
      .map((s) => ({
        at: `${/** @type {NonNullable<typeof s.pcn>} */ (s.pcn).date}T08:00:00`,
        icon: FileText,
        tone: "navy",
        id: s.id,
        text: (
          <>
            <b>{/** @type {NonNullable<typeof s.pcn>} */ (s.pcn).originator || "Someone"}</b> proposed "{/** @type {NonNullable<typeof s.pcn>} */ (s.pcn).title}"
          </>
        ),
      })),
  ]
    .filter((e) => new Date(e.at).getTime() <= now)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 7);
  // ---- needs attention, deadlines, workload ----
  const attention = systems
    .filter((s) => attentionIds.has(s.id))
    .map((s) => {
      const b = openBlockers(s)[0];
      const st = stalledDays(s, now, limits);
      const sched = getSchedule(s, now);
      const why = b
        ? { bad: true, text: `Blocked: ${b.text}` }
        : sched === "OVERDUE"
          ? {
              bad: true,
              text: `Overdue by ${plural(-daysUntil(/** @type {NonNullable<typeof s.dueAt>} */ (s.dueAt), now), "day")}`,
            }
          : st !== null
            ? { bad: false, text: `No progress update for ${st} days` }
            : {
                bad: false,
                text: `Due ${formatDate(/** @type {NonNullable<typeof s.dueAt>} */ (s.dueAt))} at ${s.progress}%`,
              };
      return { s, why };
    })
    .sort((a, b) => Number(b.why.bad) - Number(a.why.bad));
  const deadlines = systems
    .filter((s) => !s.finishedAt && s.dueAt && daysUntil(s.dueAt, now) >= 0)
    .sort((a, b) => /** @type {NonNullable<typeof a.dueAt>} */ (a.dueAt).localeCompare(/** @type {NonNullable<typeof b.dueAt>} */ (b.dueAt)))
    .slice(0, 5);
  const workload = users
    .filter((u) => u.role === "developer")
    .map((u) => {
      const w = workloadOf(u, systems, features, limits, now);
      return {
        name: u.name,
        projects: w.projects,
        openRequests: w.openFeatures,
      };
    })
    .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name));
  const mine = systems.filter(isMine);
  const openFeatures = features.filter(isOpen).length;
  return (
    <TooltipLayer>
      <div className="dash d-style">
        <section className="d-kpis dash-kpi-row" aria-label="Key figures">
          {kpis.map((k, i) => {
            const Trend = TREND_ICON[k.trend];
            return (
              <button key={k.label} className="d-kpi" style={/** @type {React.CSSProperties} */ ({ ["--i"]: i })} onClick={() => onTab(k.tab)} title={k.title} aria-label={`${k.label}: ${k.value}. ${k.delta}. ${k.title}`}>
                <span className="d-kpi-label">{k.label}</span>
                <span className="d-kpi-value">
                  <CountUp value={k.value} />
                </span>
                <span className={`d-kpi-delta ${k.trend}`}>
                  <Trend size={13} aria-hidden="true" />
                  {k.delta}
                </span>
                {sparks[k.label] && <Sparkline {...sparks[k.label]} />}
                <span className={`d-kpi-icon tone-${k.tone}`} aria-hidden="true">
                  <k.icon size={18} />
                </span>
              </button>
            );
          })}
        </section>

        <div className="d-top">
          <div className="d-top-main">
            <Panel
              title="Project activity"
              icon={Activity}
              action={
                <select className="d-select" value={range} onChange={(e) => setRange(/** @type {"year" | "12m"} */ (e.target.value))} aria-label="Period">
                  <option value="year">This year</option>
                  <option value="12m">Last 12 months</option>
                </select>
              }
            >
              <div className="d-trend-totals">
                {trend.map((s) => (
                  <span key={s.key}>
                    <i style={{ background: s.color }} />
                    <b>{sum(s.values)}</b> {s.label.toLowerCase()}
                  </span>
                ))}
              </div>
              <TrendChart months={buckets.map((b) => b.label)} series={trend} legend={false} />
            </Panel>
          </div>

          <Panel
            title="Projects by stage"
            icon={PieChart}
            className="d-side"
            action={
              <select className="d-select" value={stageScope} onChange={(e) => setStageScope(/** @type {"all" | "mine"} */ (e.target.value))} aria-label="Whose projects">
                <option value="all">All</option>
                <option value="mine">Mine</option>
              </select>
            }
          >
            <div className="d-donut-wrap">
              <Donut slices={stageRows} centre={stageScope === "mine" ? "yours" : "projects"} />
            </div>
            <ul className="viz-legend d-donut-legend">
              {stageRows.map((r) => (
                <li key={r.key}>
                  <i className="viz-key rect" style={{ background: r.color }} />
                  {r.label}
                </li>
              ))}
            </ul>
            <p className="d-range">
              {stageScope === "mine" ? "Projects you're on or lead" : `All ${systems.length} projects`} · as of {formatDate(new Date(now).toISOString())}
            </p>
            <table className="d-table">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Projects</th>
                  <th scope="col">Share</th>
                  <th scope="col">Avg %</th>
                </tr>
              </thead>
              <tbody>
                {stageRows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td>{r.value}</td>
                    <td>{scoped.length ? Math.round((r.value / scoped.length) * 100) : 0}%</td>
                    <td>{r.value ? `${r.avg}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="d-row3">
          <Panel title="Project leads" icon={Users} action={<span className="d-hint">by projects led</span>}>
            {leads.length ? (
              <ul className="d-leads">
                {leads.map(({ user, items }) => {
                  const avgLead = Math.round(items.reduce((n, s) => n + s.progress, 0) / items.length);
                  return (
                    <li key={user.id}>
                      <span className="avatar md">{initials(user.name)}</span>
                      <span className="d-lead-text">
                        <b>{user.name}</b>
                        <small>
                          {user.title || "—"} · {avgLead}% average progress
                        </small>
                      </span>
                      <span className="d-badge">{items.length}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="lead-none">No project leads assigned yet.</p>
            )}
          </Panel>

          <Panel title="Delivery health" icon={CalendarCheck} action={<span className="d-hint">by schedule</span>}>
            <Columns bars={health} />
          </Panel>

          <Panel title="Recent activity" icon={History}>
            {events.length ? (
              <ol className="d-timeline">
                {events.map((e, i) => (
                  <li key={i}>
                    <span className={`d-tl-icon tone-${e.tone}`} aria-hidden="true">
                      <e.icon size={14} />
                    </span>
                    {e.id ? (
                      <button className="d-tl-text" onClick={() => onOpen(/** @type {NonNullable<typeof e.id>} */ (e.id))}>
                        <span>{e.text}</span>
                        <small>{timeAgo(e.at, now)}</small>
                      </button>
                    ) : (
                      // Nothing to open: plain text, so it takes no keyboard stop.
                      <span className="d-tl-text static">
                        <span>{e.text}</span>
                        <small>{timeAgo(e.at, now)}</small>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="lead-none">Nothing yet.</p>
            )}
          </Panel>
        </div>

        <div className="d-row3">
          <Panel
            title="Needs attention"
            icon={AlertTriangle}
            action={
              <span className={`d-badge ${attention.length ? "red" : ""}`} aria-label={`${attention.length} need attention`}>
                {attention.length}
              </span>
            }
            footer={
              attention.length > 0 && (
                <>
                  <span>{attention.length > 6 ? `Showing 6 of ${attention.length}` : `${plural(attention.length, "project")}`}</span>
                  <button className="card-link" onClick={() => onTab(blockedOrStalled.length ? "BLOCKED" : "OVERDUE")}>
                    View all <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </>
              )
            }
          >
            {attention.length ? (
              <ul className="d-mini-list">
                {attention.slice(0, 6).map(({ s, why }) => (
                  <li key={s.id}>
                    <button onClick={() => onOpen(s.id)}>
                      <b>{s.name}</b>
                      <span className={why.bad ? "text-red" : "text-amber"}>
                        {why.bad ? <AlertOctagon size={13} /> : <AlertTriangle size={13} />} {why.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="exec-allclear">
                <CheckCircle2 size={18} /> Nothing is overdue, blocked or stalled.
              </p>
            )}
          </Panel>

          <Panel
            title="Upcoming deadlines"
            icon={CalendarClock}
            footer={
              deadlines.length > 0 && (
                <>
                  <span>Next {plural(deadlines.length, "due date")}</span>
                  <button className="card-link" onClick={() => onTab("ALL")}>
                    View all <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </>
              )
            }
          >
            {deadlines.length ? (
              <ul className="d-mini-list">
                {deadlines.map((s) => {
                  const d = daysUntil(/** @type {NonNullable<typeof s.dueAt>} */ (s.dueAt), now);
                  return (
                    <li key={s.id}>
                      <button onClick={() => onOpen(s.id)} className="d-deadline">
                        <span className={`dash-days ${d <= 7 ? "soon" : ""}`}>
                          <b>{d}</b>
                          <small>{d === 1 ? "day" : "days"}</small>
                        </span>
                        <span>
                          <b>{s.name}</b>
                          <small className="muted">
                            <CalendarClock size={12} /> {formatDate(/** @type {NonNullable<typeof s.dueAt>} */ (s.dueAt))} · {s.progress}% done
                          </small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="lead-none">No upcoming due dates.</p>
            )}
          </Panel>

          <Panel
            title="Team workload"
            icon={BarChart3}
            action={
              <span className="d-hint">
                limit {limits.projects} each · {openFeatures} open requests
              </span>
            }
          >
            <WorkloadBars rows={workload} limit={limits.projects} />
          </Panel>
        </div>

        {showMyWork && <MyWork systems={systems} now={now} />}

        {mine.length > 0 && (
          <Panel
            title="Your projects"
            icon={FolderKanban}
            action={<span className="d-hint">projects you're on or lead</span>}
            footer={
              <button className="card-link" onClick={() => onTab("MINE")}>
                View all <ArrowRight size={13} aria-hidden="true" />
              </button>
            }
          >
            <ul className="dash-mine">
              {mine.map((s) => {
                const sched = SCHEDULE_META[getSchedule(s, now)];
                return (
                  <li key={s.id}>
                    <button onClick={() => onOpen(s.id)}>
                      <span className="dash-mine-name">
                        <b>{s.name}</b>
                        <StatusPill status={s.status} />
                      </span>
                      <ProgressBar value={s.progress} />
                      <span className={`chip line-${sched.tone}`}>
                        <i />
                        {sched.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </TooltipLayer>
  );
}
/**
 * @typedef {Object} Kpi
 * @property {string} label
 * @property {number} value
 * @property {string} delta
 * @property {"up" | "down" | "flat"} trend
 * @property {typeof Activity} icon
 * @property {string} tone
 * @property {Filter} tab
 * @property {string} title
 */
/**
 * @typedef {Object} Props
 * @property {User} me
 * @property {System[]} systems
 * @property {User[]} users
 * @property {UpdateRequest[]} requests
 * @property {Feature[]} features
 * @property {Blocker[]} blockers
 * @property {ProjectDocument[]} documents
 * @property {Limits} limits
 * @property {number} now
 * @property {(s: System) => boolean} isMine
 * @property {(id: string) => void} onOpen
 * @property {(f: Filter) => void} onTab
 * @property {boolean} [showMyWork]
 */
