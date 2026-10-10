import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, Info, Printer, TrendingDown } from "lucide-react";
import { SCHEDULE_META, STATUS_META, getSchedule, type System } from "../../data/systems";
import type { UpdateRequest, User } from "../../data/roles";
import { formatDate } from "../../time";
import { lastUpdate } from "../SystemCard";
import { TooltipLayer } from "./chartKit";
import { EngagementBars, PaceChart, PipelineBar, Roadmap, buildBrief, paceOf, type Pace } from "./Charts";

interface Props {
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
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

export default function ReportsPage({ systems, users, requests, now }: Props) {
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
  const brief = buildBrief(view, users, viewRequests.length, now);
  const paces = view.map((s) => paceOf(s, now)).filter((p): p is Pace => !!p);
  const leads = users.filter((u) => systems.some((s) => s.lead === u.id));
  const userName = (id?: string) => users.find((u) => u.id === id)?.name ?? "";
  const devs = (id: string) => users.filter((u) => u.role === "developer" && u.projectId === id).map((u) => u.name);
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
      </div>
    </TooltipLayer>
  );
}
