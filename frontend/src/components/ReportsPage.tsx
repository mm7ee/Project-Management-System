import { Download, Printer } from "lucide-react";
import { SCHEDULE_META, STATUS_META, getSchedule, type Status, type System } from "../data/systems";
import type { UpdateRequest, User } from "../data/roles";
import { formatDate } from "../time";
import { lastUpdate } from "./SystemCard";

interface Props {
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
  now: number;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function ReportsPage({ systems, users, requests, now }: Props) {
  const userName = (id?: string) => users.find((u) => u.id === id)?.name ?? "";
  const devs = (id: string) => users.filter((u) => u.role === "developer" && u.projectId === id).map((u) => u.name);
  const open = (id: string) => requests.filter((r) => r.systemId === id).length;

  const rows = systems.map((s) => ({
    system: s,
    schedule: getSchedule(s, now),
    lead: userName(s.lead),
    developers: devs(s.id).join(", "),
    requests: open(s.id),
  }));
  const avg = systems.length ? Math.round(systems.reduce((n, s) => n + s.progress, 0) / systems.length) : 0;
  const byStatus = (Object.keys(STATUS_META) as Status[])
    .map((st) => ({ st, n: systems.filter((s) => s.status === st).length }))
    .filter((x) => x.n);
  const flagged = rows.filter((r) => r.schedule === "AT_RISK" || r.schedule === "OVERDUE");
  const generated = new Date(now).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  const downloadCsv = () => {
    const header = ["System", "Status", "Progress %", "Schedule", "Started", "Due", "Delivered", "Project lead", "Developers", "Last update", "Open update requests"];
    const lines = rows.map(({ system: s, schedule, lead, developers, requests }) =>
      [
        s.name,
        STATUS_META[s.status].label,
        s.progress,
        SCHEDULE_META[schedule].label,
        s.startedAt.slice(0, 10),
        s.dueAt?.slice(0, 10) ?? "",
        s.finishedAt?.slice(0, 10) ?? "",
        lead,
        developers,
        lastUpdate(s).slice(0, 10),
        requests,
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `omnitrack-report-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page report">
      <header className="page-head">
        <div>
          <h2>Projects report</h2>
          <p>Generated {generated}</p>
        </div>
        <div className="page-actions no-print">
          <button className="btn btn-ghost" onClick={downloadCsv}>
            <Download size={16} /> Download CSV
          </button>
          <button className="btn btn-navy" onClick={() => window.print()}>
            <Printer size={16} /> Print / PDF
          </button>
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <span className="stat-value text-navy">{systems.length}</span>
          <span className="stat-label">Projects</span>
        </div>
        <div className="stat">
          <span className="stat-value text-cyan">{avg}%</span>
          <span className="stat-label">Average progress</span>
        </div>
        <div className="stat">
          <span className="stat-value text-red">{flagged.length}</span>
          <span className="stat-label">At risk / overdue</span>
        </div>
        <div className="stat">
          <span className="stat-value text-navy">{requests.length}</span>
          <span className="stat-label">Open update requests</span>
        </div>
      </section>

      <div className="report-pills">
        {byStatus.map(({ st, n }) => (
          <span key={st} className={`pill fill-${STATUS_META[st].tone}`}>
            {STATUS_META[st].label}: {n}
          </span>
        ))}
      </div>

      {flagged.length > 0 && (
        <p className="report-flag">
          Needs attention: {flagged.map((r) => `${r.system.name} (${SCHEDULE_META[r.schedule].label.toLowerCase()})`).join(", ")}
        </p>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>System</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Schedule</th>
              <th>Due / delivered</th>
              <th>Lead</th>
              <th>Developers</th>
              <th>Last update</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ system: s, schedule, lead, developers, requests }) => (
              <tr key={s.id}>
                <td>
                  <b>{s.name}</b>
                  {requests > 0 && <small className="text-red"> · {requests} request{requests > 1 ? "s" : ""}</small>}
                </td>
                <td>{STATUS_META[s.status].label}</td>
                <td className="num">{s.progress}%</td>
                <td>
                  <span className={`chip line-${SCHEDULE_META[schedule].tone}`}>
                    <i />
                    {SCHEDULE_META[schedule].label}
                  </span>
                </td>
                <td>{s.finishedAt ? formatDate(s.finishedAt) : s.dueAt ? formatDate(s.dueAt) : "—"}</td>
                <td>{lead || "—"}</td>
                <td>{developers || "—"}</td>
                <td>{formatDate(lastUpdate(s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
