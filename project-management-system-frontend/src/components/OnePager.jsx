/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
// The project one-pager (docs/design/project-cockpit-mockups.html): one A4 page for a meeting or an email, printed or
// saved as PDF through the browser (no PDF library, as Reports does): the organisation's letterhead, the project, its
// health and stage, the KPI tiles, what needs attention, the burn-up, the risks and the summary. Paper always gets
// the light palette, whatever the screen's theme. Shown first as a preview; only the page itself is printed.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { api } from "../data/api";
import { riskRating } from "../data/lifecycle";
import { formatDate } from "../time";
import { Letterhead } from "./DocumentsTab";
import { Burnup } from "./ProjectCharts";

const LABEL = { blocker: "Blocker", signoff: "Sign-off", stage_overdue: "Stage late", gate: "Gate", overdue_item: "Overdue", update_request: "Update", stale: "Stale" };

/**
 * @param {{ system: System; data: any; me: User; onClose: () => void }} p
 */
export default function OnePager({ system, data, me, onClose }) {
  const [summary, setSummary] = useState(/** @type {string | null} */ (null));
  const [risks, setRisks] = useState(/** @type {any[] | null} */ (null));
  useEffect(() => {
    api(`/systems/${system.id}/summary`)
      .then((r) => setSummary(/** @type {any} */ (r).text))
      .catch(() => setSummary(""));
    api(`/systems/${system.id}/lifecycle`)
      .then((r) => setRisks(/** @type {any} */ (r).lifecycle?.risks ?? []))
      .catch(() => setRisks([]));
  }, [system.id]);
  useEffect(() => {
    const esc = (/** @type {KeyboardEvent} */ e) => e.key === "Escape" && onClose();
    const after = () => document.body.classList.remove("op-printing");
    document.addEventListener("keydown", esc);
    window.addEventListener("afterprint", after);
    return () => {
      document.removeEventListener("keydown", esc);
      window.removeEventListener("afterprint", after);
      document.body.classList.remove("op-printing");
    };
  }, [onClose]);
  const print = () => {
    document.body.classList.add("op-printing");
    window.print();
  };
  const k = data.kpis;
  const life = data.lifecycle;
  const f = k.forecast;
  const open = (risks ?? []).filter((r) => r.status === "open").map((r) => ({ ...r, rating: riskRating(Number(r.likelihood), Number(r.impact)) })).sort((a, b) => Number(b.likelihood) * Number(b.impact) - Number(a.likelihood) * Number(a.impact));
  const tiles = [
    ["Progress", `${k.progress.value}%`, k.progress.stages !== null ? `Stages ${k.progress.stages}% · work ${k.progress.work ?? 0}%` : ""],
    ["Forecast finish", f.finish ? formatDate(f.finish) : "–", f.varianceDays ? `${f.varianceDays > 0 ? "+" : ""}${f.varianceDays} days vs due` : f.target ? "On the due date" : ""],
    ["Open work items", String(k.openItems.value), k.openItems.change7 ? `${k.openItems.change7 > 0 ? "+" : ""}${k.openItems.change7} in 7 days` : ""],
    ["Overdue", String(k.overdueItems.value), k.openItems.value ? `${Math.round(k.overdueItems.share)}% of open` : ""],
    ["Blockers", String(k.blockers.value), k.blockers.oldestDays !== null ? `oldest ${k.blockers.oldestDays} days` : ""],
    ["Risks High/Critical", String(k.risks.highCritical), `of ${k.risks.open} open`],
    ["Security Critical/High", k.security.total ? String(k.security.criticalHigh) : "–", k.security.total ? `${k.security.open} open of ${k.security.total}` : "Not assessed yet"],
  ];
  const page = (
    <div className="op-print" aria-label={`One-pager: ${system.name}`}>
      <Letterhead title="Project one-pager" subtitle={formatDate(data.generatedAt)} />
      <div className="op-title">
        <div>
          <h1>{system.name}</h1>
          <p>
            {system.key} · {data.project.workspace} · lead {data.project.lead?.name ?? "not set"}
            {data.project.team.length ? ` · ${data.project.team.map((/** @type {any} */ t) => t.name).join(", ")}` : ""}
          </p>
        </div>
        <span className={`op-health ${String(data.health.rag).toLowerCase()}`}>{data.health.label}</span>
      </div>
      <p className="op-stage">
        {life ? (life.closed ? "Lifecycle closed." : `Stage ${life.stage.n} of ${life.stage.total}: ${life.stage.name}${life.sla && life.targetDays ? `, day ${Math.max(1, Math.ceil(life.sla.usedDays))} of ${life.targetDays}${life.sla.state === "overdue" ? ` (${Math.round((life.sla.usedDays - life.targetDays) * 10) / 10} over)` : ""}` : ""}.`) : "No lifecycle."}
        {data.health.rag !== "NONE" && data.health.reasons.length ? ` ${data.health.label}: ${data.health.reasons.slice(0, 3).join("; ")}.` : ""}
      </p>
      <div className="op-tiles">
        {tiles.map(([t, v, s]) => (
          <div key={t}>
            <small>{t}</small>
            <b>{v}</b>
            {s && <span>{s}</span>}
          </div>
        ))}
      </div>
      <div className="op-cols">
        <section>
          <h2>Summary</h2>
          <p className="op-summary">{summary === null ? "…" : summary || "No summary."}</p>
          <h2>What needs attention</h2>
          {data.attention.entries.length ? (
            <ol className="op-att">
              {data.attention.entries.slice(0, 7).map((/** @type {any} */ e) => (
                <li key={e.id}>
                  <b>{LABEL[/** @type {keyof typeof LABEL} */ (e.kind)] ?? e.kind}:</b> {e.title} <span>({e.detail})</span>
                </li>
              ))}
              {data.attention.total > 7 && <li className="op-more">…and {data.attention.total - 7} more</li>}
            </ol>
          ) : (
            <p>Nothing waiting on anyone.</p>
          )}
        </section>
        <section>
          <h2>Open risks</h2>
          {risks === null ? (
            <p>…</p>
          ) : open.length ? (
            <table className="op-risks">
              <tbody>
                {open.slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className={`op-rate ${r.rating.toLowerCase()}`}>{r.rating}</span>
                    </td>
                    <td>
                      {r.risk}
                      <small>{r.owner_name ? `Owner ${r.owner_name}` : "No owner"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No open risks.</p>
          )}
          <h2>Next 14 days</h2>
          {data.upcoming.length ? (
            <ul className="op-next">
              {data.upcoming.slice(0, 5).map((/** @type {any} */ u, /** @type {number} */ i) => (
                <li key={i}>
                  <b>{formatDate(u.date)}</b> {u.title}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing due.</p>
          )}
        </section>
      </div>
      <div className="op-chart">
        <Burnup data={data} keyName={data.project.key} open={() => undefined} />
      </div>
      <footer className="op-foot">
        <span>
          Generated by {me.name} on {new Date(data.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}, from the figures {me.name} may see.
        </span>
        <span>{system.name} · page 1 of 1</span>
      </footer>
    </div>
  );
  return createPortal(
    <div className="op-shell">
      <div className="op-bar no-print">
        <b>One-pager preview</b>
        <span className="ck-grow" />
        <button className="btn btn-navy sm" onClick={print}>
          <Printer size={15} aria-hidden="true" /> Print / Save as PDF
        </button>
        <button className="btn btn-ghost sm" onClick={onClose}>
          <X size={15} aria-hidden="true" /> Close
        </button>
      </div>
      <div className="op-paper">{page}</div>
    </div>,
    document.body,
  );
}
