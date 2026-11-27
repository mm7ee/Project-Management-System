// Reports → Projects: the lifecycle section (GET /api/lifecycle/report, worker/lifecycle.js lifecycleReport).
// Projects per phase and stage, average business days in each stage against its target, the bottlenecks, sign-off
// turnaround, send-backs (rework), QAT/UAT pass rates, security findings by severity, and on-time versus overdue
// stages. Printed with the rest of the report; the Excel export has the same figures on its Lifecycle sheet.
import { useEffect, useState } from "react";
import { Milestone } from "lucide-react";
import { api } from "../../data/api";
import Panel from "../Panel";

/**
 * @typedef {Object} LifecycleReportData
 * @property {boolean} hasLifecycle
 * @property {{ active: number; closed: number; overdue: number }} totals
 * @property {{ code: string; name: string; projects: number }[]} phases
 * @property {{ code: string; name: string; phase: string; targetDays: number | null; projects: number; overdue: number; avgDays: number | null; onTime: number; late: number; sendBacks: number }[]} stages
 * @property {string[]} bottlenecks
 * @property {number | null} signoffTurnaroundDays
 * @property {Record<string, { total: number; pass: number; rate: number | null }>} passRates
 * @property {Record<string, { open: number; total: number }>} findings
 */

export default function LifecycleReport() {
  const [data, setData] = useState(/** @type {LifecycleReportData | null} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    api("/lifecycle/report")
      .then((r) => setData(/** @type {LifecycleReportData} */ (r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the lifecycle figures"));
  }, []);
  if (error) return null;
  if (!data?.hasLifecycle) return null;
  const max = Math.max(1, ...data.stages.map((s) => s.projects));
  return (
    <Panel title="Project lifecycle" icon={Milestone} className="lr">
      <div className="lr-kpis">
        <div>
          <b>{data.totals.active}</b>
          <span>active projects</span>
        </div>
        <div className={data.totals.overdue ? "bad" : ""}>
          <b>{data.totals.overdue}</b>
          <span>overdue in their stage</span>
        </div>
        <div>
          <b>{data.totals.closed}</b>
          <span>closed</span>
        </div>
        <div>
          <b>{data.signoffTurnaroundDays ?? "—"}</b>
          <span>days: average sign-off turnaround</span>
        </div>
        {["QAT", "UAT"].map((s) => (
          <div key={s}>
            <b>{data.passRates[s]?.rate != null ? `${data.passRates[s].rate}%` : "—"}</b>
            <span>{s} pass rate</span>
          </div>
        ))}
      </div>
      {data.bottlenecks.length > 0 && (
        <p className="lr-note">
          <b>Bottlenecks:</b> {data.bottlenecks.join(", ")} (where projects pile up, run over their target, or are overdue now).
        </p>
      )}
      <div className="lr-phases">
        {data.phases.map((p) => (
          <span key={p.code} className="lc-pill info">
            {p.code} · {p.name}: {p.projects}
          </span>
        ))}
      </div>
      <div className="table-wrap">
        <table className="d-table lr-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Projects now</th>
              <th>Spread</th>
              <th className="num">Overdue now</th>
              <th className="num">Avg days in stage</th>
              <th className="num">Target</th>
              <th className="num">On time</th>
              <th className="num">Late</th>
              <th className="num">Sent back</th>
            </tr>
          </thead>
          <tbody>
            {data.stages.map((s) => (
              <tr key={s.code}>
                <td>
                  <span className="muted">{s.phase}</span> {s.name}
                </td>
                <td className="num">{s.projects}</td>
                <td aria-hidden="true">
                  <span className="lr-bar">
                    <i style={{ width: `${(s.projects / max) * 100}%` }} />
                  </span>
                </td>
                <td className={`num ${s.overdue ? "late" : ""}`}>{s.overdue}</td>
                <td className={`num ${s.avgDays != null && s.targetDays && s.avgDays > s.targetDays ? "late" : ""}`}>{s.avgDays ?? "—"}</td>
                <td className="num">{s.targetDays ?? "—"}</td>
                <td className="num">{s.onTime}</td>
                <td className={`num ${s.late ? "late" : ""}`}>{s.late}</td>
                <td className={`num ${s.sendBacks ? "late" : ""}`}>{s.sendBacks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lr-findings">
        <b>Security findings:</b>{" "}
        {["Critical", "High", "Medium", "Low", "Info"]
          .filter((s) => data.findings[s])
          .map((s) => `${s} ${data.findings[s].open} open of ${data.findings[s].total}`)
          .join(" · ") || "none recorded"}
      </div>
    </Panel>
  );
}
