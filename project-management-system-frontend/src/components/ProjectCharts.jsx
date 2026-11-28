/** @import { ReactNode } from 'react' */
/** @import { System } from '../data/systems' */
// The Overview's charts (docs/design/project-cockpit-mockups.html), drawn in SVG with the theme's chart colours: the
// burn-up with its forecast cone, created vs resolved, cumulative flow, time in each stage against its target, and
// this week's workload against capacity. Each has a one-line insight (src/data/chartInsights.js), exact values on hover
// or focus, a data table, and opens the work items behind the part you click (as PQL in Search).
import { useState } from "react";
import { Table2 } from "lucide-react";
import { addDays, burnupInsight, categoryPql, cfdInsight, dayMonth, flowInsight, personPql, stageInsight, weekPql, workloadInsight } from "../data/chartInsights";

/** @typedef {{ x: number; y: number; lines: string[] } | null} Tip */

/**
 * A focusable, hoverable part of a chart: shows its values, and opens what's behind it on click or Enter.
 * @param {(t: Tip) => void} setTip
 * @param {{ label: string; lines: string[]; x: number; y: number; onOpen?: () => void }} o  x, y in % of the chart
 */
function hit(setTip, { label, lines, x, y, onOpen }) {
  const show = () => setTip({ x, y, lines: onOpen ? [...lines, "Click to list these work items"] : lines });
  return {
    tabIndex: 0,
    role: onOpen ? "button" : "img",
    "aria-label": `${label}${onOpen ? ". Open the list" : ""}`,
    "data-hit": onOpen ? "open" : "",
    onMouseEnter: show,
    onFocus: show,
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
    onClick: onOpen,
    onKeyDown: (/** @type {import("react").KeyboardEvent} */ e) => {
      if (onOpen && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onOpen();
      }
    },
  };
}

/**
 * The card every chart sits in: title, insight, legend, the chart, and a data table to swap in for it.
 * @param {{ id: string; title: string; insight: string; legend?: ReactNode; tip: Tip; table: { head: string[]; rows: (string | number)[][] }; foot?: ReactNode; className?: string; empty?: string; children: ReactNode }} p
 */
function ChartCard({ id, title, insight, legend, tip, table, foot, className = "", empty, children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`ck-card ck-chart ${className}`} aria-labelledby={`${id}-t`}>
      <div className="ck-chart-head">
        <div>
          <h3 id={`${id}-t`}>{title}</h3>
          <p className="ck-insight">{insight}</p>
        </div>
        {legend && !empty && <div className="ck-legend-row">{legend}</div>}
      </div>
      {empty ? (
        <p className="ck-chart-empty">{empty}</p>
      ) : asTable ? (
        <div className="ck-table-wrap">
          <table className="ck-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ck-plot">
          {children}
          {tip && (
            <div className="ck-tip" role="status" style={{ left: `${Math.min(82, Math.max(18, tip.x))}%`, top: `${tip.y}%` }}>
              {tip.lines.map((l, i) => (i === 0 ? <b key={i}>{l}</b> : <span key={i}>{l}</span>))}
            </div>
          )}
        </div>
      )}
      <div className="ck-foot">
        <span>{foot}</span>
        {!empty && (
          <button className="link-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            <Table2 size={13} aria-hidden="true" /> {asTable ? "Show the chart" : "Data table"}
          </button>
        )}
      </div>
    </section>
  );
}
const Key = (/** @type {{ c: string; label: string; line?: boolean; dash?: boolean }} */ { c, label, line, dash }) => (
  <span className="ck-key-item">
    <i className={`${c} ${line ? "line" : ""} ${dash ? "dash" : ""}`} aria-hidden="true" />
    {label}
  </span>
);
/** A round top for an axis: 10, 20, 25, 50, 100… @param {number} v */
const niceMax = (v) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
};

/** Even steps up an axis: quarters, fifths or halves, whichever comes out whole. @param {number} top */
const axisTicks = (top) => {
  const n = top % 4 === 0 ? 4 : top % 5 === 0 ? 5 : 2;
  return Array.from({ length: n + 1 }, (_, i) => (top / n) * i);
};

/**
 * All five charts.
 * @param {{ data: any; system: System; onSearch?: (pql: string) => void }} p
 */
export default function ProjectCharts({ data, system, onSearch }) {
  const key = data.project.key;
  const open = (/** @type {string} */ pql) => (onSearch ? () => onSearch(pql) : undefined);
  return (
    <div className="ck-charts">
      <Burnup data={data} keyName={key} open={open} />
      {data.lifecycle ? <TimeInStage data={data} system={system} /> : null}
      <CreatedResolved data={data} keyName={key} open={open} />
      <CumulativeFlow data={data} keyName={key} open={open} />
      <Workload data={data} keyName={key} open={open} full={!!data.lifecycle} />
    </div>
  );
}
/** @typedef {{ data: any; keyName: string; open: (pql: string) => (() => void) | undefined }} ChartProps */

/** @param {ChartProps} p */
export function Burnup({ data, keyName, open }) {
  const [tip, setTip] = useState(/** @type {Tip} */ (null));
  /** @type {{ week: string; scope: number; done: number; created: number; resolved: number }[]} */ const weeks = data.series.weeks;
  const f = data.kpis.forecast;
  const ok = f.items?.status === "ok";
  const last = weeks[weeks.length - 1];
  const now = weeks.length - 1;
  const H = ok ? Math.min(26, f.items.p85.weeks + 1) : 0;
  const T = weeks.length + H;
  const W = 640;
  const L = 44;
  const R = 624;
  const TOP = 22;
  const B = 192;
  const x = (/** @type {number} */ i) => L + ((R - L) * i) / Math.max(1, T - 1);
  const top = niceMax(Math.max(1, ...weeks.map((w) => w.scope)) * 1.08);
  const y = (/** @type {number} */ v) => B - ((B - TOP) * v) / top;
  const pts = (/** @type {(w: any) => number} */ v) => weeks.map((w, i) => `${x(i).toFixed(1)},${y(v(w)).toFixed(1)}`).join(" ");
  const colDate = (/** @type {number} */ i) => addDays(weeks[0].week, 7 * i);
  const months = [];
  for (let i = 0; i < T; i++) {
    const d = colDate(i);
    if (i === 0 || d.slice(5, 7) !== colDate(i - 1).slice(5, 7)) months.push({ i, label: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" }) });
  }
  const targetIdx = f.target ? now + (Date.parse(f.target) - Date.parse(last.week)) / (7 * 86_400_000) : null;
  const ticks = axisTicks(top);
  const step = (R - L) / Math.max(1, T - 1);
  return (
    <ChartCard
      id="ck-burnup"
      className="wide"
      title="Burn-up and forecast"
      insight={burnupInsight(weeks, f)}
      tip={tip}
      empty={last.scope ? undefined : "No work items yet. The burn-up starts with the first one."}
      legend={
        <>
          <Key c="c2" line label="Scope" />
          <Key c="c1" line label="Done" />
          {ok && <Key c="cone" label="Forecast 50–85%" />}
        </>
      }
      foot={ok ? `Forecast: ${f.items.explanation.split(":")[0]} from the last ${f.items.history.weeks} weeks of throughput.` : f.items?.explanation ?? ""}
      table={{ head: ["Week of", "Scope", "Done", "Created", "Resolved"], rows: weeks.map((w) => [dayMonth(w.week), w.scope, w.done, w.created, w.resolved]) }}
    >
      <svg viewBox={`0 0 ${W} 222`} className="ck-svg" role="img" aria-label={`Burn-up: scope ${weeks[0].scope} to ${last.scope} items, ${last.done} done${ok ? `; forecast 50% by ${dayMonth(f.items.p50.date)}, 85% by ${dayMonth(f.items.p85.date)}` : ""}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={R} y1={y(t)} y2={y(t)} className="ck-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ck-axis">
              {t}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.i} x={x(m.i)} y={212} className="ck-axis">
            {m.label}
          </text>
        ))}
        {ok && (
          <>
            <polygon className="ck-cone" points={`${x(now)},${y(last.done)} ${x(now + f.items.p50.weeks)},${y(last.scope)} ${x(now + f.items.p85.weeks)},${y(last.scope)}`} />
            <line className="ck-median" x1={x(now)} y1={y(last.done)} x2={x(now + f.items.p50.weeks)} y2={y(last.scope)} />
            <line className="ck-scope-ahead" x1={x(now)} y1={y(last.scope)} x2={R} y2={y(last.scope)} />
          </>
        )}
        <polyline className="ck-line c2" points={pts((w) => w.scope)} />
        <polyline className="ck-line c1" points={pts((w) => w.done)} />
        <line className="ck-today" x1={x(now)} x2={x(now)} y1={TOP - 6} y2={B} />
        <text className="ck-axis strong" x={x(now) + 4} y={TOP - 8}>
          Today
        </text>
        {targetIdx !== null && targetIdx >= 0 && targetIdx <= T - 1 && (
          <>
            <line className="ck-target" x1={x(targetIdx)} x2={x(targetIdx)} y1={TOP - 6} y2={B} />
            <text className="ck-axis bad" x={x(targetIdx) - 4} y={TOP - 8} textAnchor="end">
              Due {dayMonth(f.target)}
            </text>
          </>
        )}
        {ok && (
          <>
            <circle className="ck-mark c1" cx={x(now + f.items.p50.weeks)} cy={y(last.scope)} r={4.5} />
            <circle className="ck-mark hollow" cx={x(now + f.items.p85.weeks)} cy={y(last.scope)} r={4.5} />
            <text className="ck-axis strong" x={x(now + f.items.p50.weeks)} y={y(last.scope) - 9} textAnchor="middle">
              50%
            </text>
            <text className="ck-axis strong" x={x(now + f.items.p85.weeks)} y={y(last.scope) - 9} textAnchor="middle">
              85%
            </text>
          </>
        )}
        {weeks.map((w, i) => (
          <rect
            key={w.week}
            x={x(i) - step / 2}
            y={TOP}
            width={step}
            height={B - TOP}
            {...hit(setTip, {
              label: `Week of ${dayMonth(w.week)}: scope ${w.scope}, done ${w.done}, ${w.resolved} resolved that week`,
              lines: [`Week of ${dayMonth(w.week)}`, `Scope ${w.scope} · Done ${w.done}`, `Resolved that week: ${w.resolved}`],
              x: (x(i) / W) * 100,
              y: 18,
              onOpen: w.resolved ? open(weekPql(keyName, "resolved", w.week)) : undefined,
            })}
          />
        ))}
      </svg>
    </ChartCard>
  );
}

/** @param {ChartProps} p */
function CreatedResolved({ data, keyName, open }) {
  const [tip, setTip] = useState(/** @type {Tip} */ (null));
  /** @type {{ week: string; created: number; resolved: number }[]} */ const weeks = data.series.weeks.slice(-8);
  const W = 320;
  const L = 30;
  const R = 312;
  const TOP = 16;
  const B = 170;
  const top = niceMax(Math.max(1, ...weeks.map((w) => Math.max(w.created, w.resolved))));
  const y = (/** @type {number} */ v) => B - ((B - TOP) * v) / top;
  const slot = (R - L) / weeks.length;
  const bw = Math.min(14, slot / 2 - 3);
  const none = !weeks.some((w) => w.created || w.resolved);
  return (
    <ChartCard
      id="ck-cr"
      title="Created vs resolved"
      insight={flowInsight(weeks)}
      tip={tip}
      empty={none ? "Nothing created or resolved in the last 8 weeks." : undefined}
      legend={
        <>
          <Key c="c1" label="Created" />
          <Key c="c2" label="Resolved" />
        </>
      }
      table={{ head: ["Week of", "Created", "Resolved"], rows: weeks.map((w) => [dayMonth(w.week), w.created, w.resolved]) }}
    >
      <svg viewBox={`0 0 ${W} 196`} className="ck-svg" role="img" aria-label={`Created and resolved work items in each of the last ${weeks.length} weeks`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={R} y1={y(top * t)} y2={y(top * t)} className="ck-grid" />
            <text x={L - 6} y={y(top * t) + 4} textAnchor="end" className="ck-axis">
              {Math.round(top * t)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={w.week}>
              <rect className="ck-bar c1" x={cx - bw - 1} y={y(w.created)} width={bw} height={B - y(w.created)} rx={2} {...hit(setTip, { label: `Week of ${dayMonth(w.week)}: ${w.created} created`, lines: [`Week of ${dayMonth(w.week)}`, `Created: ${w.created}`], x: (cx / W) * 100, y: 10, onOpen: w.created ? open(weekPql(keyName, "created", w.week)) : undefined })} />
              <rect className="ck-bar c2" x={cx + 1} y={y(w.resolved)} width={bw} height={B - y(w.resolved)} rx={2} {...hit(setTip, { label: `Week of ${dayMonth(w.week)}: ${w.resolved} resolved`, lines: [`Week of ${dayMonth(w.week)}`, `Resolved: ${w.resolved}`], x: (cx / W) * 100, y: 10, onOpen: w.resolved ? open(weekPql(keyName, "resolved", w.week)) : undefined })} />
              {i % 2 === 0 && (
                <text x={cx} y={188} textAnchor="middle" className="ck-axis">
                  {dayMonth(w.week)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

/** @param {ChartProps} p */
function CumulativeFlow({ data, keyName, open }) {
  // (Two columns wide: with the stage chart beside the burn-up, the five charts fill three columns with no gaps.)
  const [tip, setTip] = useState(/** @type {Tip} */ (null));
  /** @type {{ week: string; todo: number; inProgress: number; done: number }[]} */ const weeks = data.series.cumulative;
  const W = 640;
  const L = 30;
  const R = 628;
  const TOP = 14;
  const B = 170;
  const top = niceMax(Math.max(1, ...weeks.map((w) => w.todo + w.inProgress + w.done)));
  const x = (/** @type {number} */ i) => L + ((R - L) * i) / Math.max(1, weeks.length - 1);
  const y = (/** @type {number} */ v) => B - ((B - TOP) * v) / top;
  /** Band between two cumulative lines. @param {(w: any) => number} lo @param {(w: any) => number} hi */
  const band = (lo, hi) => [...weeks.map((w, i) => `${x(i)},${y(hi(w))}`), ...weeks.map((w, i) => `${x(i)},${y(lo(w))}`).reverse()].join(" ");
  const lastW = weeks[weeks.length - 1];
  const none = !weeks.some((w) => w.todo + w.inProgress + w.done);
  /** @type {[string, "todo" | "inProgress" | "done", string, (w: any) => number, (w: any) => number][]} */
  const bands = [
    ["Done", "done", "c1", () => 0, (w) => w.done],
    ["In progress", "inProgress", "c2", (w) => w.done, (w) => w.done + w.inProgress],
    ["To do", "todo", "c4", (w) => w.done + w.inProgress, (w) => w.done + w.inProgress + w.todo],
  ];
  return (
    <ChartCard
      id="ck-cfd"
      className="wide"
      title="Cumulative flow"
      insight={cfdInsight(weeks)}
      tip={tip}
      empty={none ? "No status history yet." : undefined}
      legend={
        <>
          <Key c="c4" label="To do" />
          <Key c="c2" label="In progress" />
          <Key c="c1" label="Done" />
        </>
      }
      table={{ head: ["Week of", "To do", "In progress", "Done"], rows: weeks.map((w) => [dayMonth(w.week), w.todo, w.inProgress, w.done]) }}
    >
      <svg viewBox={`0 0 ${W} 196`} className="ck-svg" role="img" aria-label={`Cumulative flow: now ${lastW.todo} to do, ${lastW.inProgress} in progress, ${lastW.done} done`}>
        {bands.map(([label, cat, c, lo, hi]) => (
          <polygon key={cat} className={`ck-band ${c}`} points={band(lo, hi)} {...hit(setTip, { label: `${label}: ${lastW[cat]} now`, lines: [label, `Now: ${lastW[cat]}`, `${dayMonth(weeks[0].week)}: ${weeks[0][cat]}`], x: 60, y: 30, onOpen: lastW[cat] ? open(categoryPql(keyName, cat)) : undefined })} />
        ))}
        <line x1={L} x2={R} y1={B} y2={B} className="ck-grid" />
        <text x={L} y={188} className="ck-axis">
          {dayMonth(weeks[0].week)}
        </text>
        <text x={R} y={188} textAnchor="end" className="ck-axis">
          This week
        </text>
      </svg>
    </ChartCard>
  );
}

/** @param {{ data: any; system: System }} p */
function TimeInStage({ data, system }) {
  const [tip, setTip] = useState(/** @type {Tip} */ (null));
  /** @type {{ code: string; name: string; days: number; targetDays: number | null; visits: number; current: boolean }[]} */ const stages = data.series.timeInStage;
  const W = 320;
  const LBL = 112;
  const R = 270;
  const row = 28;
  const H = Math.max(1, stages.length) * row + 24;
  const top = niceMax(Math.max(1, ...stages.map((s) => Math.max(s.days, s.targetDays ?? 0))) * 1.05);
  const x = (/** @type {number} */ v) => LBL + ((R - LBL) * v) / top;
  const go = () => (window.location.hash = `#/projects/${system.id}/lifecycle`);
  return (
    <ChartCard
      id="ck-tis"
      title="Time in each stage vs target"
      insight={stageInsight(stages)}
      tip={tip}
      empty={stages.length ? undefined : "No stage has been worked in yet."}
      legend={
        <>
          <Key c="c1" label="Within target" />
          <Key c="bad" label="Over" />
          <Key c="tick" label="Target" />
        </>
      }
      foot="Business days, on the organisation's calendar."
      table={{ head: ["Stage", "Business days", "Target", "Visits"], rows: stages.map((s) => [`${s.name}${s.current ? " (now)" : ""}`, s.days, s.targetDays ?? "–", s.visits]) }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="ck-svg" role="img" aria-label="Business days spent in each stage, against its target">
        {stages.map((s, i) => {
          const yy = 8 + i * row;
          const over = !!s.targetDays && s.days > s.targetDays;
          return (
            <g key={s.code}>
              <text x={LBL - 8} y={yy + 13} textAnchor="end" className={`ck-axis label ${s.current ? "strong" : ""}`}>
                {s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}
              </text>
              <rect className={`ck-bar ${over ? "bad" : "c1"}`} x={LBL} y={yy} width={Math.max(2, x(s.days) - LBL)} height={17} rx={3} {...hit(setTip, { label: `${s.name}: ${s.days} business days${s.targetDays ? ` against a target of ${s.targetDays}` : ""}`, lines: [s.name, `${s.days} business days${s.current ? " so far" : ""}`, s.targetDays ? `Target ${s.targetDays}${over ? ` · ${Math.round((s.days - s.targetDays) * 10) / 10} over` : ""}` : "No target", ...(s.visits > 1 ? [`${s.visits} visits`] : [])], x: 55, y: Math.min(80, ((yy + 20) / H) * 100), onOpen: go })} />
              {s.targetDays ? <line className="ck-tick" x1={x(s.targetDays)} x2={x(s.targetDays)} y1={yy - 3} y2={yy + 20} /> : null}
              <text x={Math.max(x(s.days), s.targetDays ? x(s.targetDays) : 0) + 6} y={yy + 13} className={`ck-axis strong ${over ? "bad" : ""}`}>
                {s.days}
                {s.targetDays ? ` / ${s.targetDays}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

/** @param {ChartProps & { full: boolean }} p */
function Workload({ data, keyName, open, full }) {
  const [tip, setTip] = useState(/** @type {Tip} */ (null));
  /** @type {{ capacityHours: number; people: { id: string; name: string; username: string | null; lead: boolean; loggedHours: number; plannedHours: number; openItems: number; openItemsHere: number }[] }} */ const w = data.series.workload;
  // Full width (three columns) gets a wider drawing, so its text stays the size of the other charts'.
  const W = full ? 1160 : 640;
  const LBL = 170;
  const R = W - 100;
  const row = 30;
  const H = Math.max(1, w.people.length) * row + 26;
  const top = niceMax(Math.max(w.capacityHours * 1.2, ...w.people.map((p) => p.loggedHours + p.plannedHours)));
  const x = (/** @type {number} */ v) => LBL + ((R - LBL) * v) / top;
  return (
    <ChartCard
      id="ck-wl"
      className={full ? "full" : ""}
      title="Workload this week"
      insight={workloadInsight(w)}
      tip={tip}
      empty={w.people.length ? undefined : "Nobody is on this project yet."}
      legend={
        <>
          <Key c="c1" label="Logged" />
          <Key c="c4" label="Planned (due by Sunday)" />
          <Key c="tick" label={`Capacity ${w.capacityHours} h`} />
        </>
      }
      foot="Across all of the workspace's projects you can see. Capacity is set per workspace."
      table={{ head: ["Person", "Logged (h)", "Planned (h)", "Total (h)", "Open items (all projects)", "Open here"], rows: w.people.map((p) => [`${p.name}${p.lead ? " (lead)" : ""}`, p.loggedHours, p.plannedHours, p.loggedHours + p.plannedHours, p.openItems, p.openItemsHere]) }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="ck-svg" role="img" aria-label={`Hours per person this week against ${w.capacityHours} hours of capacity`}>
        {w.people.map((p, i) => {
          const yy = 16 + i * row;
          const total = p.loggedHours + p.plannedHours;
          const over = total > w.capacityHours;
          return (
            <g key={p.id}>
              <text x={LBL - 10} y={yy + 14} textAnchor="end" className="ck-axis label">
                {p.name}
                {p.lead ? " (lead)" : ""}
              </text>
              <rect className="ck-track" x={LBL} y={yy} width={R - LBL} height={19} rx={4} />
              <g {...hit(setTip, { label: `${p.name}: ${p.loggedHours} hours logged, ${p.plannedHours} planned, ${p.openItemsHere} open items here`, lines: [p.name, `Logged ${p.loggedHours} h · planned ${p.plannedHours} h`, `${total} of ${w.capacityHours} h${over ? ` · ${Math.round((total - w.capacityHours) * 10) / 10} over` : ""}`, `Open items here: ${p.openItemsHere}`], x: 55, y: Math.min(80, ((yy + 20) / H) * 100), onOpen: p.username && p.openItemsHere ? open(personPql(keyName, p.username)) : undefined })}>
                <rect className="ck-bar c1" x={LBL} y={yy} width={Math.max(0, x(p.loggedHours) - LBL)} height={19} rx={4} />
                <rect className={`ck-bar ${over ? "bad" : "c4"}`} x={x(p.loggedHours)} y={yy} width={Math.max(0, x(total) - x(p.loggedHours))} height={19} rx={4} />
              </g>
              <text x={R + 8} y={yy + 14} className={`ck-axis strong ${over ? "bad" : ""}`}>
                {total} h{over ? ` · ${Math.round((total - w.capacityHours) * 10) / 10} over` : ""}
              </text>
            </g>
          );
        })}
        <line className="ck-capacity" x1={x(w.capacityHours)} x2={x(w.capacityHours)} y1={6} y2={H - 4} />
      </svg>
    </ChartCard>
  );
}
