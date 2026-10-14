import type { ReactNode } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Info,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  LogOut,
  Printer,
  ShieldCheck,
  TrendingDown,
  Users,
} from "lucide-react";
import { SCHEDULE_META, STATUS_META, getSchedule, type System } from "../data/systems";
import { ROLE_LABEL } from "../data/roles";
import { isLate, isOpen } from "../data/features";
import { stalledDays, workloadOf } from "../data/project";
import { api, type AppData } from "../data/api";
import { useApplyPrefs } from "../prefs";
import { formatDate, timeAgo, useNow } from "../time";
import CountUp from "./CountUp";
import { ProgressBar, StatusPill, lastUpdate } from "./SystemCard";
import { TooltipLayer } from "./reports/chartKit";
import { PipelineBar, Roadmap, buildBrief } from "./reports/Charts";
import { COMPANY_URL } from "../brand";

const TONE_ICON = { good: CheckCircle2, warn: TrendingDown, bad: AlertTriangle, info: Info };

/**
 * The executive overview at /executive: one read-only page with the whole portfolio and how the
 * system works, for leadership who want the picture without working inside the tracker.
 */
export default function ExecutivePage({ data }: { data: AppData }) {
  const now = useNow();
  useApplyPrefs(data.prefs);
  const { me, systems, users, requests, features, blockers, limits } = data;

  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  const brief = buildBrief(systems, users, requests.length, now);
  const openBlockers = (s: System) => blockers.filter((b) => b.systemId === s.id && !b.resolvedAt);
  const live = systems.filter((s) => s.status === "LIVE" || s.status === "COMPLETED");
  const year = new Date(now).getFullYear();
  const deliveredThisYear = systems.filter((s) => s.finishedAt && new Date(s.finishedAt).getFullYear() === year).length;
  const openFeatures = features.filter(isOpen);
  const developers = users.filter((u) => u.role === "developer");
  const overloaded = developers.filter((d) => workloadOf(d, systems, features, limits, now).overloaded);

  // Everything leadership should know about, worst first, in plain words.
  const attention = systems
    .map((s) => {
      const reasons: { tone: "bad" | "warn"; text: string }[] = [];
      const schedule = getSchedule(s, now);
      if (schedule === "OVERDUE") reasons.push({ tone: "bad", text: `Overdue since ${formatDate(s.dueAt!)}` });
      openBlockers(s).forEach((b) => reasons.push({ tone: "bad", text: `Blocked: ${b.text}` }));
      const stalled = stalledDays(s, now, limits);
      if (stalled !== null) reasons.push({ tone: "warn", text: `No progress update for ${stalled} days` });
      if (schedule === "AT_RISK") reasons.push({ tone: "warn", text: `Due ${formatDate(s.dueAt!)} at ${s.progress}%` });
      const critical = openFeatures.filter((f) => f.systemId === s.id && f.priority === "CRITICAL");
      if (critical.length) reasons.push({ tone: "warn", text: `${critical.length} critical client request${critical.length > 1 ? "s" : ""} open` });
      return { system: s, reasons };
    })
    .filter((x) => x.reasons.length)
    .sort((a, b) => b.reasons.filter((r) => r.tone === "bad").length - a.reasons.filter((r) => r.tone === "bad").length || b.reasons.length - a.reasons.length);

  const kpis = [
    { value: systems.length, label: "Systems in the portfolio", tone: "navy" },
    { value: live.length, label: "Live or delivered", tone: "green" },
    // Same count as the summary's "in flight", so the figures agree.
    { value: brief.active, label: "In progress now", tone: "cyan" },
    { value: deliveredThisYear, label: `Delivered in ${year}`, tone: "navy" },
    { value: attention.length, label: "Need attention", tone: attention.length ? "red" : "green" },
    { value: openFeatures.length, label: "Open client requests", tone: "amber" },
  ];

  return (
    <TooltipLayer>
      <div className="exec">
        <header className="exec-top no-print">
          <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="exec-logo" title="Omni Contact website">
            <img src="/omni-logo.png" alt="Omni Contact" />
          </a>
          <span className="exec-who">
            {me.name} · {ROLE_LABEL[me.role]}
          </span>
          <div className="page-actions">
            <a className="btn btn-ghost sm" href="/">
              <LayoutDashboard size={15} /> Open the full tracker
            </a>
            <button className="btn btn-ghost sm" onClick={() => window.print()}>
              <Printer size={15} /> Print / PDF
            </button>
            <button
              className="btn btn-ghost sm"
              onClick={async () => {
                await api("/logout", "POST").catch(() => undefined);
                window.location.reload();
              }}
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </header>

        <section className="exec-hero">
          <span className="exec-eyebrow">OmniTrack · Executive overview</span>
          <h1>Systems portfolio at a glance</h1>
          <p>
            Every system the Omni Contact systems team is building or running, live from the tracker. As of{" "}
            {new Date(now).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}.
          </p>
        </section>

        <section className="exec-kpis" aria-label="Key figures">
          {kpis.map(({ value, label, tone }) => (
            <div className="stat" key={label}>
              <span className={`stat-value text-${tone}`}>
                <CountUp value={value} />
              </span>
              <span className="stat-label">{label}</span>
            </div>
          ))}
        </section>

        <div className="exec-pair">
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
              <ul className="exec-attention">
                {attention.map(({ system, reasons }) => (
                  <li key={system.id}>
                    <b>{system.name}</b>
                    {name(system.lead) && <small> · lead: {name(system.lead)}</small>}
                    <ul>
                      {reasons.map((r, i) => (
                        <li key={i} className={r.tone === "bad" ? "text-red" : "text-amber"}>
                          {r.tone === "bad" ? <AlertOctagon size={14} /> : <AlertTriangle size={14} />} {r.text}
                        </li>
                      ))}
                    </ul>
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
          <h3>Where every system stands</h3>
          <p className="viz-sub">The lifecycle, from idea to live.</p>
          <PipelineBar systems={systems} />
        </section>

        <section className="viz-card">
          <h3>Delivery timeline</h3>
          <p className="viz-sub">Solid bars show time spent so far (or start to delivery); pale bars show the time left until the due date.</p>
          <Roadmap systems={systems} now={now} />
        </section>

        <section className="viz-card">
          <h3>All systems</h3>
          <div className="table-wrap flat">
            <table className="table exec-table">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Schedule</th>
                  <th>Due / delivered</th>
                  <th>Lead</th>
                  <th>Last update</th>
                </tr>
              </thead>
              <tbody>
                {[...systems]
                  .sort((a, b) => Number(!!a.finishedAt) - Number(!!b.finishedAt) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"))
                  .map((s) => {
                    const schedule = SCHEDULE_META[getSchedule(s, now)];
                    const blocked = openBlockers(s).length > 0;
                    return (
                      <tr key={s.id}>
                        <td>
                          <b>{s.name}</b>
                          {s.description && <small className="exec-desc">{s.description}</small>}
                          {blocked && (
                            <span className="flag flag-blocked">
                              <AlertOctagon size={12} /> Blocked
                            </span>
                          )}
                          {s.health === "Maintenance" && <span className="flag flag-maint">Under maintenance</span>}
                        </td>
                        <td>
                          <StatusPill status={s.status} />
                        </td>
                        <td className="exec-progress">
                          <ProgressBar value={s.progress} />
                        </td>
                        <td>
                          <span className={`chip line-${schedule.tone}`}>
                            <i />
                            {schedule.label}
                          </span>
                        </td>
                        <td>{s.finishedAt ? formatDate(s.finishedAt) : s.dueAt ? formatDate(s.dueAt) : "—"}</td>
                        <td>{name(s.lead) ?? "—"}</td>
                        <td>{!s.updatedAt && new Date(lastUpdate(s)).getTime() > now ? "—" : timeAgo(lastUpdate(s), now)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="viz-sub exec-legend">
            Status labels: {Object.values(STATUS_META).map((m) => m.label).join(" · ")}.
          </p>
        </section>

        <div className="exec-pair">
          <section className="viz-card">
            <h3>Team capacity</h3>
            <dl className="exec-facts">
              <dt>Developers</dt>
              <dd>{developers.length}</dd>
              <dt>Over their workload limit</dt>
              <dd className={overloaded.length ? "text-red" : ""}>
                {overloaded.length ? overloaded.map((d) => d.name).join(", ") : "None"}
              </dd>
              <dt>Limit per developer</dt>
              <dd>
                {limits.projects} active systems or {limits.features} open client requests
              </dd>
              <dt>Systems without a lead</dt>
              <dd>{systems.filter((s) => !s.lead).length || "None"}</dd>
            </dl>
          </section>
          <section className="viz-card">
            <h3>Client requests</h3>
            <dl className="exec-facts">
              <dt>Open</dt>
              <dd>{openFeatures.length}</dd>
              <dt>Critical or high priority</dt>
              <dd>{openFeatures.filter((f) => f.priority === "CRITICAL" || f.priority === "HIGH").length}</dd>
              <dt>Past their delivery date</dt>
              <dd className={openFeatures.some((f) => isLate(f, now)) ? "text-red" : ""}>{openFeatures.filter((f) => isLate(f, now)).length}</dd>
              <dt>Completed</dt>
              <dd>{features.filter((f) => f.status === "COMPLETED").length}</dd>
            </dl>
          </section>
        </div>

        <HowItWorks stallDays={limits.stallDays} />

        <footer className="exec-foot">
          © {year} Omni Contact · OmniTrack. Live data; figures change as the team posts updates.
        </footer>
      </div>
    </TooltipLayer>
  );
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="exec-step">
      <span className="exec-step-icon">{icon}</span>
      <div>
        <h4>{title}</h4>
        <p>{children}</p>
      </div>
    </div>
  );
}

/** A plain-language tour of the system, for readers who never use it day to day. */
function HowItWorks({ stallDays }: { stallDays: number }) {
  const stages = ["Idea", "Upcoming", "In progress", "Testing", "To deploy", "Live"];
  return (
    <section className="viz-card exec-how">
      <h3>How OmniTrack works</h3>
      <p className="viz-sub">The systems team's single place to plan, build and run every internal system.</p>

      <div className="exec-flow" aria-label="Lifecycle of a system">
        {stages.map((s, i) => (
          <span key={s} className="exec-flow-step">
            <span className="exec-flow-node">{s}</span>
            {i < stages.length - 1 && <ArrowRight size={16} aria-hidden="true" />}
          </span>
        ))}
      </div>
      <p className="exec-note">
        Live systems can be flagged <b>Under maintenance</b> while they're being updated. Delivered systems still take client
        requests for new modules and changes.
      </p>

      <div className="exec-steps">
        <Step icon={<ClipboardList size={18} />} title="1. Every system is registered">
          Each system has a lead, the developers working on it, a start and due date, and its status. Clicking a system in the
          tracker opens its own page with everything about it.
        </Step>
        <Step icon={<CheckCircle2 size={18} />} title="2. Developers post progress">
          The assigned developers post progress (0–100%) and status as work moves. Managers can ask for an update at any time,
          and the request stays open until progress is posted.
        </Step>
        <Step icon={<ListChecks size={18} />} title="3. Client requests are tracked">
          New modules, changes and fixes that clients ask for are logged with a priority (critical to low), an assigned
          developer and an expected delivery date, so nothing is lost after go-live.
        </Step>
        <Step icon={<AlertOctagon size={18} />} title="4. Problems surface on their own">
          A system is flagged <b>at risk</b> within 7 days of its due date, <b>overdue</b> after it, <b>stalled</b> after{" "}
          {stallDays} days without a progress update, and <b>blocked</b> when the team records what's stopping it. Developers
          with too much on are flagged <b>overloaded</b>.
        </Step>
        <Step icon={<FileText size={18} />} title="5. Documents and history stay with the system">
          Specifications, contracts and designs are attached to each system, and every change is recorded in its history.
        </Step>
        <Step icon={<BellRing size={18} />} title="6. Reports in one click">
          Managers produce printable reports and spreadsheets of progress, deadlines, client requests and developer workload.
          This page is the summary version.
        </Step>
      </div>

      <h4 className="exec-subhead">Who can do what</h4>
      <div className="exec-roles">
        <div>
          <Users size={16} /> <b>Administrators</b> add systems, manage people, roles and security settings.
        </div>
        <div>
          <Users size={16} /> <b>Managers</b> request updates, log client requests and produce reports.
        </div>
        <div>
          <Users size={16} /> <b>Developers</b> update the systems they're assigned to and raise blockers.
        </div>
        <div>
          <Users size={16} /> <b>Standard users</b>, including executives, can view everything but change nothing.
        </div>
      </div>

      <h4 className="exec-subhead">Security</h4>
      <div className="exec-roles">
        <div>
          <LockKeyhole size={16} /> Everyone signs in with their own account; there are no shared logins.
        </div>
        <div>
          <ShieldCheck size={16} /> Two-step verification with a phone app can be required for any role.
        </div>
        <div>
          <History size={16} /> Every sign-in, failed sign-in and change is kept in an activity log for a year.
        </div>
      </div>
    </section>
  );
}
