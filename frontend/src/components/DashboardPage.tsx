import { AlertOctagon, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Info, TrendingDown } from "lucide-react";
import { SCHEDULE_META, daysUntil, getSchedule, type System } from "../data/systems";
import type { UpdateRequest, User } from "../data/roles";
import { PRIORITIES, PRIORITY_META, isOpen, type Feature } from "../data/features";
import { isActive, stalledDays, workloadOf, type Blocker, type Limits } from "../data/project";
import type { Filter } from "./Sidebar";
import { formatDate, plural } from "../time";
import CountUp from "./CountUp";
import { ProgressBar, StatusPill } from "./SystemCard";
import { TooltipLayer } from "./reports/chartKit";
import { EngagementBars, FeatureStatusBar, PaceChart, PipelineBar, Roadmap, WorkloadBars, buildBrief, paceOf, type Pace } from "./reports/Charts";

const TONE_ICON = { good: CheckCircle2, warn: TrendingDown, bad: AlertTriangle, info: Info };

interface Props {
  me: User;
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
  features: Feature[];
  blockers: Blocker[];
  limits: Limits;
  now: number;
  isMine: (s: System) => boolean;
  onOpen: (id: string) => void;
  onTab: (f: Filter) => void; // open the Projects page on a tab
}

/** The analytical home page: the whole portfolio in figures and charts, plus your own work. */
export default function DashboardPage({ me, systems, users, requests, features, blockers, limits, now, isMine, onOpen, onTab }: Props) {
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  const active = systems.filter((s) => isActive(s, now));
  const avg = active.length ? Math.round(active.reduce((n, s) => n + s.progress, 0) / active.length) : 0;
  const openBlockers = (s: System) => blockers.filter((b) => b.systemId === s.id && !b.resolvedAt);
  const blockedOrStalled = systems.filter((s) => openBlockers(s).length || stalledDays(s, now, limits) !== null);
  const atRisk = systems.filter((s) => ["AT_RISK", "OVERDUE"].includes(getSchedule(s, now)));
  const brief = buildBrief(systems, users, requests.length, now);
  const paces = active.map((s) => paceOf(s, now)).filter((p): p is Pace => !!p);
  const mine = systems.filter(isMine);
  const openFeatures = features.filter(isOpen);

  const kpis: { value: number | string; label: string; tone: string; tab: Filter; hint: string }[] = [
    { value: systems.length, label: "Projects", tone: "navy", tab: "ALL", hint: `${plural(systems.filter((s) => s.status === "IDEA").length, "idea")} included` },
    { value: systems.filter((s) => s.status === "LIVE").length, label: "Live", tone: "green", tab: "LIVE", hint: `${systems.filter((s) => s.status === "COMPLETED").length} more completed` },
    { value: active.length, label: "In progress", tone: "cyan", tab: "WIP", hint: "being built now" },
    { value: `${avg}%`, label: "Average progress", tone: "cyan", tab: "WIP", hint: "of projects in progress" },
    { value: atRisk.length, label: "At risk / overdue", tone: atRisk.length ? "red" : "green", tab: "OVERDUE", hint: "due within 7 days or past due" },
    { value: blockedOrStalled.length, label: "Blocked / stalled", tone: blockedOrStalled.length ? "amber" : "green", tab: "BLOCKED", hint: `no update for ${limits.stallDays}+ days, or a blocker` },
  ];

  // What needs a decision or a nudge, worst first.
  const attention = systems
    .map((s) => {
      const reasons: { bad: boolean; text: string }[] = [];
      const sched = getSchedule(s, now);
      if (sched === "OVERDUE") reasons.push({ bad: true, text: `Overdue by ${plural(-daysUntil(s.dueAt!, now), "day")}` });
      openBlockers(s).forEach((b) => reasons.push({ bad: true, text: `Blocked: ${b.text}` }));
      const stalled = stalledDays(s, now, limits);
      if (stalled !== null) reasons.push({ bad: false, text: `No progress update for ${stalled} days` });
      if (sched === "AT_RISK") reasons.push({ bad: false, text: `Due ${formatDate(s.dueAt!)} at ${s.progress}%` });
      const critical = openFeatures.filter((f) => f.systemId === s.id && f.priority === "CRITICAL").length;
      if (critical) reasons.push({ bad: false, text: `${plural(critical, "critical client request")} open` });
      return { s, reasons };
    })
    .filter((x) => x.reasons.length)
    .sort((a, b) => b.reasons.filter((r) => r.bad).length - a.reasons.filter((r) => r.bad).length || b.reasons.length - a.reasons.length);

  const deadlines = systems
    .filter((s) => !s.finishedAt && s.dueAt && daysUntil(s.dueAt, now) >= 0)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 6);

  const workload = users
    .filter((u) => u.role === "developer")
    .map((u) => {
      const w = workloadOf(u, systems, features, limits, now);
      return { name: u.name, projects: w.projects, openRequests: w.openFeatures };
    })
    .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name));

  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <TooltipLayer>
      <div className="dash">
        <header className="dash-hero">
          <div>
            <h2>
              {greeting}, {me.name.split(" ")[0]}
            </h2>
            <p>{new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · the portfolio at a glance</p>
          </div>
          <button className="btn btn-ghost" onClick={() => onTab("ALL")}>
            All projects <ArrowRight size={15} />
          </button>
        </header>

        <section className="dash-kpis" aria-label="Key figures">
          {kpis.map((k) => (
            <button key={k.label} className="stat dash-kpi" onClick={() => onTab(k.tab)} title={`Show these on the Projects page`}>
              <span className={`stat-value text-${k.tone}`}>
                <CountUp value={k.value} />
              </span>
              <span className="stat-label">{k.label}</span>
              <small>{k.hint}</small>
            </button>
          ))}
        </section>

        {mine.length > 0 && (
          <section className="viz-card">
            <h3>Your work</h3>
            <p className="viz-sub">Projects you're on or lead.</p>
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
          </section>
        )}

        <div className="dash-pair">
          <section className="viz-card">
            <h3>Summary</h3>
            <ul className="brief-lines">
              {brief.lines.map((l, i) => {
                const Icon = TONE_ICON[l.tone];
                return (
                  <li key={i} className={`tone-${l.tone}`}>
                    <Icon size={17} aria-hidden="true" />
                    <span>{l.text}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="viz-card">
            <h3>Needs attention</h3>
            {attention.length ? (
              <ul className="dash-list">
                {attention.slice(0, 6).map(({ s, reasons }) => (
                  <li key={s.id}>
                    <button onClick={() => onOpen(s.id)}>
                      <b>{s.name}</b>
                      {name(s.lead) && <small className="muted"> · {name(s.lead)}</small>}
                      {reasons.map((r, i) => (
                        <span key={i} className={r.bad ? "text-red" : "text-amber"}>
                          {r.bad ? <AlertOctagon size={13} /> : <AlertTriangle size={13} />} {r.text}
                        </span>
                      ))}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="exec-allclear">
                <CheckCircle2 size={18} /> Nothing is overdue, blocked or stalled.
              </p>
            )}
          </section>
        </div>

        <section className="viz-card">
          <h3>Where every project stands</h3>
          <p className="viz-sub">The lifecycle, from idea to live. Hover a segment for its share.</p>
          <PipelineBar systems={systems} />
        </section>

        <div className="dash-pair">
          <section className="viz-card">
            <h3>Upcoming deadlines</h3>
            {deadlines.length ? (
              <ul className="dash-list">
                {deadlines.map((s) => {
                  const d = daysUntil(s.dueAt!, now);
                  return (
                    <li key={s.id}>
                      <button onClick={() => onOpen(s.id)} className="dash-deadline">
                        <span className={`dash-days ${d <= 7 ? "soon" : ""}`}>
                          <b>{d}</b>
                          <small>{d === 1 ? "day" : "days"}</small>
                        </span>
                        <span>
                          <b>{s.name}</b>
                          <small className="muted">
                            <CalendarClock size={12} /> {formatDate(s.dueAt!)} · {s.progress}% done
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
          </section>
          <section className="viz-card">
            <h3>Team workload</h3>
            <p className="viz-sub">Projects per developer. Nobody can be given more than {limits.projects}.</p>
            <WorkloadBars rows={workload} limit={limits.projects} />
          </section>
        </div>

        <section className="viz-card">
          <h3>Delivery timeline</h3>
          <p className="viz-sub">Solid bars show time spent so far (or start to delivery); pale bars show the time left until the due date.</p>
          <Roadmap systems={systems} now={now} />
        </section>

        <div className="dash-pair">
          <section className="viz-card">
            <h3>Pace check</h3>
            <p className="viz-sub">Progress against the share of planned time already used. Behind-pace projects first.</p>
            <PaceChart paces={paces} now={now} />
          </section>
          <section className="viz-card">
            <h3>Client requests</h3>
            <p className="viz-sub">
              {openFeatures.length} open:{" "}
              {PRIORITIES.map((p) => `${openFeatures.filter((f) => f.priority === p).length} ${PRIORITY_META[p].label.toLowerCase()}`).join(", ")}.
            </p>
            {features.length ? <FeatureStatusBar features={features} /> : <p className="lead-none">No client requests yet.</p>}
          </section>
        </div>

        <section className="viz-card">
          <h3>Most used systems</h3>
          <p className="viz-sub">Visits in the last 30 days.</p>
          <EngagementBars systems={systems} />
        </section>
      </div>
    </TooltipLayer>
  );
}
