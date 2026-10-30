import { useEffect, useState, type ReactNode } from "react";
import PulseMark from "./PulseMark";
import {
  AlertOctagon,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  ListChecks,
  LockKeyhole,
  LogIn,
  Printer,
  ShieldCheck,
  Users,
} from "lucide-react";
import { SCHEDULE_META } from "../data/systems";
import { PRIORITY_META, PRIORITIES } from "../data/features";
import type { Showcase } from "../data/showcase";
import { api } from "../data/api";
import { useApplyPrefs } from "../prefs";
import { DEFAULT_PREFS } from "../data/roles";
import CountUp from "./CountUp";
import { TooltipLayer } from "./reports/chartKit";
import { StageBar } from "./reports/Charts";
import { COMPANY_URL } from "../brand";

/**
 * The public showcase at /executive: how Pulse works and how the portfolio is doing, for
 * leadership. No sign-in, so it shows totals only; no names of systems, people or blockers.
 * Nothing in the tracker links here; the address is shared directly.
 */
export default function ExecutivePage() {
  // Follows the visitor's device theme; there's no account to read a preference from.
  useApplyPrefs({ ...DEFAULT_PREFS, theme: "system" });
  const [data, setData] = useState<Showcase | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Showcase>("/showcase")
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const year = new Date().getFullYear();
  return (
    <TooltipLayer>
      <div className="exec">
        <header className="exec-top no-print">
          <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="exec-logo" title="Omni Contact website">
            <img src="/omni-logo.png" alt="Omni Contact" />
          </a>
          <span className="exec-who">
            <PulseMark tone="dark" />
          </span>
          <div className="page-actions">
            <button className="btn btn-ghost sm" onClick={() => window.print()}>
              <Printer size={15} /> Print / PDF
            </button>
            <a className="btn btn-ghost sm" href="/">
              <LogIn size={15} /> Staff sign-in
            </a>
          </div>
        </header>

        <section className="exec-hero">
          <span className="exec-eyebrow">Pulse · Executive overview</span>
          <h1>How the systems team tracks every build</h1>
          <p>
            Pulse is where the Omni Contact systems team plans, builds and runs every internal system. Below is how it works,
            and how the portfolio stands right now.
            {data && ` Live figures as of ${new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}.`}
          </p>
        </section>

        {error ? (
          <p className="form-error">The live figures couldn't be loaded. Please try again shortly.</p>
        ) : !data ? (
          <p className="lead-none">Loading the live figures…</p>
        ) : (
          <Figures data={data} />
        )}

        <HowItWorks stallDays={data?.stallDays ?? 14} />

        <footer className="exec-foot">
          © {year} Omni Contact · Pulse. Figures are live totals; individual systems and people are visible to staff only.
        </footer>
      </div>
    </TooltipLayer>
  );
}

function Figures({ data }: { data: Showcase }) {
  const kpis = [
    { value: data.systems, label: "Systems in the portfolio", tone: "navy" },
    { value: data.liveOrDelivered, label: "Live or delivered", tone: "green" },
    { value: data.inProgress, label: "In progress now", tone: "cyan" },
    { value: data.deliveredThisYear, label: `Delivered in ${new Date(data.generatedAt).getFullYear()}`, tone: "navy" },
    { value: data.needsAttention, label: "Need attention", tone: data.needsAttention ? "red" : "green" },
    { value: data.requests.open, label: "Open client requests", tone: "amber" },
  ];
  const health: { label: string; value: number; tone: string }[] = [
    { label: SCHEDULE_META.ON_TRACK.label, value: data.schedule.ON_TRACK, tone: "" },
    { label: SCHEDULE_META.AT_RISK.label + " (due within 7 days)", value: data.schedule.AT_RISK, tone: data.schedule.AT_RISK ? "text-amber" : "" },
    { label: SCHEDULE_META.OVERDUE.label, value: data.schedule.OVERDUE, tone: data.schedule.OVERDUE ? "text-red" : "" },
    { label: "Blocked", value: data.blocked, tone: data.blocked ? "text-red" : "" },
    { label: `Stalled (no update for ${data.stallDays}+ days)`, value: data.stalled, tone: data.stalled ? "text-amber" : "" },
    { label: "Under maintenance (live, being updated)", value: data.maintenance, tone: "" },
  ];

  return (
    <>
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

      <section className="viz-card">
        <h3>Where every system stands</h3>
        <p className="viz-sub">The lifecycle, from idea to live. Systems in progress are {data.averageProgress}% complete on average.</p>
        <StageBar counts={data.stages} />
      </section>

      <div className="exec-pair">
        <section className="viz-card">
          <h3>Delivery health</h3>
          <dl className="exec-facts">
            {health.map((h) => (
              <FactRow key={h.label} label={h.label} value={h.value} tone={h.tone} />
            ))}
          </dl>
        </section>
        <section className="viz-card">
          <h3>Team and client requests</h3>
          <dl className="exec-facts">
            <FactRow label="Developers" value={data.developers} />
            <FactRow label="Developers over their workload limit" value={data.overloadedDevelopers} tone={data.overloadedDevelopers ? "text-red" : ""} />
            <FactRow label="Open client requests" value={data.requests.open} />
            {PRIORITIES.map((p) => (
              <FactRow key={p} label={`· ${PRIORITY_META[p].label} priority`} value={data.requests.byPriority[p]} tone={p === "CRITICAL" && data.requests.byPriority[p] ? "text-red" : ""} />
            ))}
            <FactRow label="Past their delivery date" value={data.requests.late} tone={data.requests.late ? "text-red" : ""} />
            <FactRow label="Completed" value={data.requests.completed} />
          </dl>
        </section>
      </div>
    </>
  );
}

function FactRow({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </>
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
      <h3>How Pulse works</h3>
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
          <Users size={16} /> <b>Team Leaders</b> run their systems: add and edit them, staff them with developers, log client
          requests and produce reports.
        </div>
        <div>
          <Users size={16} /> <b>Projects Assistants</b> follow up on progress with update requests and produce reports.
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
