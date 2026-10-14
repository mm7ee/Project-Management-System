import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, Info, Printer, TrendingDown } from "lucide-react";
import { SCHEDULE_META, STATUS_META, getSchedule, type System } from "../../data/systems";
import type { UpdateRequest, User } from "../../data/roles";
import { FEATURE_STATUS_META, KIND_META, PRIORITY_META, byUrgency, isLate, isOpen, type Feature } from "../../data/features";
import { FeatureStatusPill, PriorityBadge } from "../FeatureModal";
import { stalledDays, workloadOf, type Blocker, type Limits } from "../../data/project";
import { formatDate } from "../../time";
import { lastUpdate } from "../SystemCard";
import { TooltipLayer } from "./chartKit";
import { EngagementBars, FeatureStatusBar, PaceChart, PipelineBar, Roadmap, buildBrief, paceOf, type Pace } from "./Charts";

interface Props {
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
  features: Feature[];
  blockers: Blocker[];
  limits: Limits;
  now: number;
}

type Scope = "all" | "active" | "delivered" | "planned";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "In flight" },
  { key: "delivered", label: "Delivered" },
  { key: "planned", label: "Not started" },
];

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const TONE_ICON = { good: CheckCircle2, warn: TrendingDown, bad: AlertTriangle, info: Info };

export default function ReportsPage({ systems, users, requests, features, blockers, limits, now }: Props) {
  const [scope, setScope] = useState<Scope>("all");
  const [lead, setLead] = useState("");
  const [copied, setCopied] = useState(false);

  // One filter row scopes every chart, the brief and the table.
  const view = useMemo(
    () =>
      systems.filter((s) => {
        const planned = s.status === "IDEA" || (s.status === "UPCOMING" && new Date(s.startedAt).getTime() > now);
        const inScope =
          scope === "all" ||
          (scope === "delivered" && !!s.finishedAt) ||
          (scope === "planned" && planned && !s.finishedAt) ||
          (scope === "active" && !s.finishedAt && !planned);
        return inScope && (!lead || s.lead === lead);
      }),
    [systems, scope, lead, now],
  );
  const ids = new Set(view.map((s) => s.id));
  const viewRequests = requests.filter((r) => ids.has(r.systemId));
  const viewFeatures = features.filter((f) => ids.has(f.systemId));
  const openFeatures = viewFeatures.filter(isOpen).sort(byUrgency);
  const lateFeatures = openFeatures.filter((f) => isLate(f, now)).length;
  const cancelled = viewFeatures.filter((f) => f.status === "CANCELLED").length;
  const unassigned = openFeatures.filter((f) => !f.assignee).length;
  // One row per developer on a system in scope or with a request in scope, busiest first.
  // The overload flag counts all their work, not just what this filter shows.
  const workload = users
    .filter((u) => u.role === "developer" && (viewFeatures.some((f) => f.assignee === u.id) || u.projectIds?.some((id) => ids.has(id))))
    .map((u) => {
      const mine = viewFeatures.filter((f) => f.assignee === u.id);
      const open = mine.filter(isOpen);
      return {
        user: u,
        load: workloadOf(u, systems, features, limits, now),
        open: open.length,
        critical: open.filter((f) => f.priority === "CRITICAL").length,
        high: open.filter((f) => f.priority === "HIGH").length,
        late: open.filter((f) => isLate(f, now)).length,
        completed: mine.filter((f) => f.status === "COMPLETED").length,
        next: open.map((f) => f.dueAt).filter((d): d is string => !!d).sort()[0],
      };
    })
    .sort((a, b) => Number(b.load.overloaded) - Number(a.load.overloaded) || b.load.active - a.load.active || b.open - a.open);
  // Systems that are blocked or have stopped moving.
  const stuck = view
    .map((s) => ({
      system: s,
      open: blockers.filter((b) => b.systemId === s.id && !b.resolvedAt),
      stalled: stalledDays(s, now, limits),
    }))
    .filter((x) => x.open.length || x.stalled !== null)
    .sort((a, b) => b.open.length - a.open.length || (b.stalled ?? 0) - (a.stalled ?? 0));
  const brief = buildBrief(view, users, viewRequests.length, now);
  const paces = view.map((s) => paceOf(s, now)).filter((p): p is Pace => !!p);
  const leads = users.filter((u) => systems.some((s) => s.lead === u.id));
  const userName = (id?: string) => users.find((u) => u.id === id)?.name ?? "";
  const devs = (id: string) => users.filter((u) => u.role === "developer" && u.projectIds?.includes(id)).map((u) => u.name);
  const generated = new Date(now).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const scopeText = `${SCOPES.find((s) => s.key === scope)!.label}${lead ? ` · lead: ${userName(lead)}` : ""}`;

  const copyBrief = async () => {
    const text = [`OmniTrack brief (${generated}, ${scopeText})`, ...brief.lines.map((l) => `• ${l.text}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const downloadCsv = () => {
    const header = ["System", "Status", "Progress %", "Expected % by today", "Schedule", "Started", "Due", "Delivered", "Project lead", "Developers", "Last update", "Visits (30 days)", "Open update requests"];
    const lines = view.map((s) => {
      const pace = paceOf(s, now);
      return [
        s.name,
        STATUS_META[s.status].label,
        s.progress,
        pace?.expected ?? "",
        SCHEDULE_META[getSchedule(s, now)].label,
        s.startedAt.slice(0, 10),
        s.dueAt?.slice(0, 10) ?? "",
        s.finishedAt?.slice(0, 10) ?? "",
        userName(s.lead),
        devs(s.id).join(", "),
        lastUpdate(s).slice(0, 10),
        s.engagement,
        viewRequests.filter((r) => r.systemId === s.id).length,
      ]
        .map(csvCell)
        .join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `omnitrack-report-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadFeaturesCsv = () => {
    const header = ["Feature", "Type", "Project", "Requested by", "Priority", "Status", "Developer", "Expected delivery", "Delivered", "Past due", "Developer notes", "Logged"];
    const lines = [...viewFeatures]
      .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byUrgency(a, b))
      .map((f) =>
        [
          f.title,
          KIND_META[f.kind],
          systems.find((s) => s.id === f.systemId)?.name ?? "",
          f.client,
          PRIORITY_META[f.priority].label,
          FEATURE_STATUS_META[f.status].label,
          userName(f.assignee),
          f.dueAt ?? "",
          f.completedAt?.slice(0, 10) ?? "",
          isLate(f, now) ? "Yes" : "",
          f.notes ?? "",
          f.createdAt.slice(0, 10),
        ]
          .map(csvCell)
          .join(","),
      );
    const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `omnitrack-feature-requests-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <TooltipLayer>
      <div className="page report">
        <header className="page-head">
          <div>
            <h2>Projects report</h2>
            <p>
              Generated {generated} · {scopeText}
            </p>
          </div>
          <div className="page-actions no-print">
            <button className="btn btn-ghost" onClick={copyBrief}>
              <ClipboardCopy size={16} /> {copied ? "Copied" : "Copy brief"}
            </button>
            <button className="btn btn-ghost" onClick={downloadCsv}>
              <Download size={16} /> CSV
            </button>
            {viewFeatures.length > 0 && (
              <button className="btn btn-ghost" onClick={downloadFeaturesCsv}>
                <Download size={16} /> Feature requests CSV
              </button>
            )}
            <button className="btn btn-navy" onClick={() => window.print()}>
              <Printer size={16} /> Print / PDF
            </button>
          </div>
        </header>

        <div className="viz-filters no-print" role="group" aria-label="Report filters">
          <div className="seg" role="radiogroup" aria-label="Scope">
            {SCOPES.map((s) => (
              <button key={s.key} role="radio" aria-checked={scope === s.key} className={scope === s.key ? "on" : ""} onClick={() => setScope(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <select value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Project lead">
            <option value="">All leads</option>
            {leads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span className="viz-count">{view.length} of {systems.length} systems</span>
        </div>

        <section className="viz-card brief">
          <div className="brief-hero">
            <span className="brief-figure">
              {brief.delivered}
              <small>/{view.length}</small>
            </span>
            <span className="brief-caption">systems delivered</span>
            <div className="brief-mini">
              <span>
                <b>{brief.active}</b> in flight
              </span>
              <span>
                <b>{brief.flagged}</b> need attention
              </span>
              <span>
                <b>{viewRequests.length}</b> open requests
              </span>
            </div>
          </div>
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
          <h3>Blocked & stalled</h3>
          <p className="viz-sub">
            Systems with an open blocker, or still being built with no progress update for {limits.stallDays}+ days.
          </p>
          {stuck.length ? (
            <div className="table-wrap flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Blocker</th>
                    <th>Raised</th>
                    <th>Last progress update</th>
                  </tr>
                </thead>
                <tbody>
                  {stuck.map(({ system, open, stalled }) => (
                    <tr key={system.id}>
                      <td>
                        <b>{system.name}</b>
                      </td>
                      <td className="notes-cell">
                        {open.length ? open.map((b) => <div key={b.id}>{b.text}</div>) : <i className="muted">None recorded</i>}
                      </td>
                      <td>{open.length ? open.map((b) => <div key={b.id}>{formatDate(b.raisedAt)} · {userName(b.raisedBy)}</div>) : "—"}</td>
                      <td className={stalled !== null ? "text-red" : ""}>
                        {formatDate(lastUpdate(system))}
                        {stalled !== null && ` (${stalled} days ago)`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="lead-none">Nothing is blocked or stalled.</p>
          )}
        </section>

        <section className="viz-card">
          <h3>Pipeline</h3>
          <p className="viz-sub">Where every system sits in its lifecycle.</p>
          <PipelineBar systems={view} />
        </section>

        <section className="viz-card">
          <h3>Delivery roadmap</h3>
          <p className="viz-sub">
            Solid bars show time spent so far (or start to delivery); pale bars show the time left until the due date.
          </p>
          <Roadmap systems={view} now={now} />
        </section>

        <div className="viz-pair">
          <section className="viz-card">
            <h3>Pace check</h3>
            <p className="viz-sub">Progress against the share of planned time already used. Behind-pace projects are listed first.</p>
            <PaceChart paces={paces} now={now} />
          </section>
          <section className="viz-card">
            <h3>Engagement</h3>
            <p className="viz-sub">Visits in the last 30 days.</p>
            <EngagementBars systems={view} />
          </section>
        </div>

        <section className="viz-card">
          <h3>Data table</h3>
          <div className="table-wrap flat">
            <table className="table">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Expected by today</th>
                  <th>Schedule</th>
                  <th>Due / delivered</th>
                  <th>Lead</th>
                  <th>Last update</th>
                  <th>Visits</th>
                </tr>
              </thead>
              <tbody>
                {view.map((s) => {
                  const schedule = getSchedule(s, now);
                  const n = viewRequests.filter((r) => r.systemId === s.id).length;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{s.name}</b>
                        {n > 0 && <small className="text-red"> · {n} request{n > 1 ? "s" : ""}</small>}
                      </td>
                      <td>{STATUS_META[s.status].label}</td>
                      <td className="num">{s.progress}%</td>
                      <td className="num">{paceOf(s, now) ? `${paceOf(s, now)!.expected}%` : "—"}</td>
                      <td>
                        <span className={`chip line-${SCHEDULE_META[schedule].tone}`}>
                          <i />
                          {SCHEDULE_META[schedule].label}
                        </span>
                      </td>
                      <td>{s.finishedAt ? formatDate(s.finishedAt) : s.dueAt ? formatDate(s.dueAt) : "—"}</td>
                      <td>{userName(s.lead) || "—"}</td>
                      <td>{!s.updatedAt && new Date(lastUpdate(s)).getTime() > now ? "—" : formatDate(lastUpdate(s))}</td>
                      <td className="num">{s.engagement.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="viz-card">
          <h3>Feature requests</h3>
          <p className="viz-sub">
            Client requests on the systems above: {openFeatures.length} open
            {lateFeatures > 0 && `, ${lateFeatures} past their delivery date`}
            {unassigned > 0 && `, ${unassigned} not yet assigned`}
            {cancelled > 0 && `. ${cancelled} cancelled, not shown in the bar`}.
          </p>
          {viewFeatures.length ? <FeatureStatusBar features={viewFeatures} /> : <p className="lead-none">No feature requests on these systems.</p>}
        </section>

        {workload.length > 0 && (
          <section className="viz-card">
            <h3>Developer workload</h3>
            <p className="viz-sub">
              Active projects and feature requests per developer. Flagged when above {limits.projects} active projects or {limits.features} open requests.
            </p>
            <div className="table-wrap flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>Developer</th>
                    <th>Active projects</th>
                    <th>Open requests</th>
                    <th>Critical</th>
                    <th>High</th>
                    <th>Past due</th>
                    <th>Completed</th>
                    <th>Next delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.user.id}>
                      <td>
                        <b>{w.user.name}</b>
                        {w.load.overloaded && (
                          <span className="flag flag-overload" title={w.load.reasons.join("; ")}>
                            Overloaded
                          </span>
                        )}
                      </td>
                      <td className={`num ${w.load.active > limits.projects ? "text-red" : ""}`}>{w.load.active}</td>
                      <td className="num">{w.open}</td>
                      <td className={`num ${w.critical ? "text-red" : ""}`}>{w.critical}</td>
                      <td className="num">{w.high}</td>
                      <td className={`num ${w.late ? "text-red" : ""}`}>{w.late}</td>
                      <td className="num">{w.completed}</td>
                      <td>{w.next ? formatDate(w.next) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {openFeatures.length > 0 && (
          <section className="viz-card">
            <h3>Open feature requests</h3>
            <p className="viz-sub">Most urgent first: by priority, then expected delivery.</p>
            <div className="table-wrap flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Project</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Developer</th>
                    <th>Expected delivery</th>
                    <th>Developer notes</th>
                  </tr>
                </thead>
                <tbody>
                  {openFeatures.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <b>{f.title}</b>
                        <small className="muted">
                          {" "}
                          · {KIND_META[f.kind]}
                          {f.client ? ` for ${f.client}` : ""}
                        </small>
                      </td>
                      <td>{systems.find((s) => s.id === f.systemId)?.name}</td>
                      <td>
                        <PriorityBadge priority={f.priority} />
                      </td>
                      <td>
                        <FeatureStatusPill status={f.status} />
                      </td>
                      <td>{userName(f.assignee) || <i className="muted">Unassigned</i>}</td>
                      <td className={isLate(f, now) ? "text-red" : ""}>{f.dueAt ? formatDate(f.dueAt) : "—"}</td>
                      <td className="notes-cell">{f.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </TooltipLayer>
  );
}
