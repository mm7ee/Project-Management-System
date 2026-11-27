/** @import { Feature } from '../data/features' */
/** @import { System } from '../data/systems' */
/** @import { FlowWeek } from '../data/featureInsights' */
import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { PRIORITIES, PRIORITY_META } from "../data/features";
import { ageing, clientDemand, days, insightSentences, leadByKind, openByPriority, periodTotals, weeklyFlow } from "../data/featureInsights";
import { Legend, TipRows, TooltipLayer, useTip, useWidth } from "./reports/chartKit";
const DAY = 86400000;
const RANGES = /** @type {const} */ ([
  { key: "month", label: "4 weeks", days: 28, weeks: 8, before: "the 4 weeks before" },
  { key: "quarter", label: "Quarter", days: 91, weeks: 13, before: "the quarter before" },
  { key: "half", label: "6 months", days: 182, weeks: 26, before: "the 6 months before" },
]);
const C = {
  arrived: "var(--st-wip)",
  delivered: "var(--st-live)",
  cancelled: "var(--st-not)",
  backlog: "var(--st-done)",
  late: "var(--st-overdue)",
  dated: "var(--st-wip)",
  undated: "var(--st-not)",
  p80: "var(--st-testing)",
};
const shortDate =
  /** @param {number} t
   * @returns {string}
   */ (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const pct =
  /** @param {number | null} r
   * @returns {string}
   */ (r) => (r === null ? "—" : `${Math.round(r * 100)}%`);
/**
 * Feature request insights for managers: the reading in sentences, the flow in and out, how old the
 * open backlog is, who is asking, and how long each type of request takes to deliver.
 * @param {{ features: Feature[]; systems: System[]; workspaces: string[]; now: number; onOpen: (f: Feature) => void }} arg2
 */
export default function FeatureInsights({ features, systems, workspaces, now, onOpen }) {
  const [rangeKey, setRangeKey] = useState(/** @type {RangeKey | (() => RangeKey)} */ ("quarter"));
  const [workspace, setWorkspace] = useState("");
  const range =
    /** @type {{ readonly key: "month"; readonly label: "4 weeks"; readonly days: 28; readonly weeks: 8; readonly before: "the 4 weeks before"; } | { readonly key: "quarter"; readonly label: "Quarter"; readonly days: 91; readonly weeks: 13; readonly before: "the quarter before"; } | { readonly key: "half"; readonly label: "6 months"; readonly days: 182; readonly weeks: 26; readonly before: "the 6 months before"; }} */ (
      RANGES.find((r) => r.key === rangeKey)
    );
  const wsOf = /** @param {string} id */ (id) => {
    const w = systems.find((s) => s.id === id)?.workspace;
    return w && workspaces.includes(w) ? w : workspaces[0];
  };
  const scoped = useMemo(() => (workspace ? features.filter((f) => wsOf(f.systemId) === workspace) : features), [features, workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = periodTotals(scoped, now - range.days * DAY, now + 1);
  const prev = periodTotals(scoped, now - 2 * range.days * DAY, now - range.days * DAY);
  const sentences = insightSentences(scoped, now, range.days);
  const flow = weeklyFlow(scoped, now, range.weeks);
  return (
    <TooltipLayer>
      <div className="viz-filters" role="group" aria-label="Insight settings">
        <div className="seg" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.key} role="radio" aria-checked={r.key === rangeKey} className={r.key === rangeKey ? "on" : ""} onClick={() => setRangeKey(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        {workspaces.length > 1 && (
          <select className={workspace ? "set" : ""} value={workspace} onChange={(e) => setWorkspace(e.target.value)} aria-label="Workspace">
            <option value="">Every workspace</option>
            {workspaces.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        )}
        <span className="viz-count">
          {scoped.length} requests · figures compare the last {range.label === "Quarter" ? "quarter" : range.label} with {range.before}
        </span>
      </div>

      {!scoped.length ? (
        <p className="viz-empty">No feature requests yet{workspace ? ` in ${workspace}` : ""}.</p>
      ) : (
        <>
          <section className="viz-card fi-reading" aria-label="The reading">
            <h3 className="fi-reading-title">
              <Activity size={17} /> The reading
            </h3>
            <ul className="fi-sentences">
              {sentences.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <div className="fi-tiles">
              <Tile label="Came in" value={cur.arrived} was={prev.arrived} goodWhen="neutral" />
              <Tile label="Delivered" value={cur.delivered} was={prev.delivered} goodWhen="up" />
              <Tile label="Open backlog change" value={cur.openAtEnd - cur.openAtStart} was={prev.openAtEnd - prev.openAtStart} goodWhen="down" signed />
              <Tile label="Typical delivery" value={cur.medianLead} was={prev.medianLead} goodWhen="down" format={(v) => (v === null ? "—" : `${Math.round(v)}d`)} />
              <Tile label="Delivered on time" value={cur.onTimeRate} was={prev.onTimeRate} goodWhen="up" format={pct} />
            </div>
          </section>

          <section className="viz-card">
            <h3>Flow: in and out, week by week</h3>
            <p className="viz-sub">New requests rise above the line; deliveries and cancellations fall below it. When the blue outweighs the green, the backlog grows.</p>
            <FlowChart weeks={flow} />
            <BacklogStrip weeks={flow} />
            <details className="fi-table">
              <summary>Show as a table</summary>
              <table className="table">
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th>Came in</th>
                    <th>Delivered</th>
                    <th>Cancelled</th>
                    <th>Open at week end</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.map((w) => (
                    <tr key={w.start}>
                      <td>{shortDate(w.start)}</td>
                      <td>{w.arrived}</td>
                      <td>{w.delivered}</td>
                      <td>{w.cancelled}</td>
                      <td>{w.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="viz-card">
            <h3>Ageing backlog</h3>
            <p className="viz-sub">Every open request is a dot, placed by how long it has waited and grouped by priority. Dots far to the right in the top lanes are the ones clients feel most. Click a dot to open it.</p>
            <AgeingChart features={scoped} now={now} onOpen={onOpen} />
          </section>

          <div className="viz-pair">
            <section className="viz-card">
              <h3>Who's asking</h3>
              <p className="viz-sub">Requests per client, delivered and still open, with how often their dated requests arrived on time.</p>
              <ClientChart features={scoped} now={now} />
            </section>
            <section className="viz-card">
              <h3>Time to deliver, by type</h3>
              <p className="viz-sub">The dot is the typical (median) time; the bar runs on to the slow end, the time 4 in 5 requests beat. All delivered requests.</p>
              <LeadChart features={scoped} />
            </section>
          </div>
        </>
      )}
    </TooltipLayer>
  );
}
/**
 * A headline number with the change from the period before, as an arrow and words (not colour alone).
 * @param {{
 *   label: string;
 *   value: number | null;
 *   was: number | null;
 *   goodWhen: "up" | "down" | "neutral";
 *   signed?: boolean;
 *   format?: (v: number | null) => string;
 * }} arg1
 */
function Tile({ label, value, was, goodWhen, signed = false, format = (v) => (v === null ? "—" : String(v)) }) {
  const shown = signed && value !== null && value > 0 ? `+${format(value)}` : format(value);
  const diff = value !== null && was !== null ? value - was : null;
  const dir = diff === null || Math.abs(diff) < 1e-9 ? "same" : diff > 0 ? "up" : "down";
  const tone = dir === "same" || goodWhen === "neutral" ? "" : dir === goodWhen ? "good" : "bad";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <div className="fi-tile">
      <span className="fi-tile-label">{label}</span>
      <span className="fi-tile-value">{shown}</span>
      <span className={`fi-tile-delta ${tone}`}>
        <Icon size={13} aria-hidden="true" />
        {was === null ? "nothing to compare" : dir === "same" ? `same as before (${format(was)})` : `was ${format(was)}`}
      </span>
    </div>
  );
}
// ---------- flow: mirrored weekly bars ----------
/**
 * @param {{ weeks: FlowWeek[] }} props
 */
function FlowChart({ weeks }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const H = 220;
  const PAD = { l: 46, r: 8, t: 10, b: 24 };
  const up = Math.max(1, ...weeks.map((w) => w.arrived));
  const down = Math.max(1, ...weeks.map((w) => w.delivered + w.cancelled));
  const scale = (H - PAD.t - PAD.b) / (up + down);
  const zero = PAD.t + up * scale;
  const slot = (width - PAD.l - PAD.r) / weeks.length;
  const bw = Math.max(4, Math.min(28, slot - 6));
  const every = Math.ceil(weeks.length / Math.max(1, Math.floor((width - PAD.l) / 64)));
  return (
    <div ref={ref}>
      <Legend
        items={[
          { label: "Came in", color: C.arrived },
          { label: "Delivered", color: C.delivered },
          { label: "Cancelled", color: C.cancelled },
        ]}
      />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg" role="group" aria-label="Requests in and out each week">
          <line x1={PAD.l} x2={width - PAD.r} y1={zero} y2={zero} className="fi-zero" />
          <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" className="viz-axis">
            {up} in
          </text>
          <text x={PAD.l - 6} y={zero + 4} textAnchor="end" className="viz-axis">
            0
          </text>
          <text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" className="viz-axis">
            {down} out
          </text>
          {weeks.map((w, i) => {
            const x = PAD.l + i * slot + (slot - bw) / 2;
            const hIn = w.arrived * scale;
            const hDel = w.delivered * scale;
            const hCan = w.cancelled * scale;
            const label = `Week of ${shortDate(w.start)}: ${w.arrived} in, ${w.delivered} delivered, ${w.cancelled} cancelled`;
            return (
              <g
                key={w.start}
                className="viz-hit"
                {...tip(
                  <TipRows
                    title={`Week of ${shortDate(w.start)}`}
                    rows={[
                      ["came in", w.arrived, C.arrived],
                      ["delivered", w.delivered, C.delivered],
                      ["cancelled", w.cancelled, C.cancelled],
                      ["open at week end", w.open],
                    ]}
                  />,
                  label,
                )}
              >
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
                {hIn > 0 && <path d={bar(x, zero - 1, bw, hIn, "up")} style={{ fill: C.arrived }} />}
                {hDel > 0 && <path d={bar(x, zero + 1, bw, hDel, hCan > 0 ? "none" : "down")} style={{ fill: C.delivered }} />}
                {hCan > 0 && <path d={bar(x, zero + 1 + hDel + (hDel > 0 ? 2 : 0), bw, hCan, "down")} style={{ fill: C.cancelled }} />}
                {i % every === 0 && (
                  <text x={PAD.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="viz-axis">
                    {shortDate(w.start)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
/**
 * A bar anchored at y, growing up or down, with 4px rounding on its free end only.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {"up" | "down" | "none"} round
 * @returns {string}
 */
function bar(x, y, w, h, round) {
  const r = Math.min(4, h, w / 2);
  if (round === "up") return `M${x},${y} V${y - h + r} Q${x},${y - h} ${x + r},${y - h} H${x + w - r} Q${x + w},${y - h} ${x + w},${y - h + r} V${y} Z`;
  if (round === "down") return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
  return `M${x},${y} V${y + h} H${x + w} V${y} Z`;
}
/**
 * The open backlog at each week's end: a separate small chart on the same weeks (never a second axis).
 * @param {{ weeks: FlowWeek[] }} arg5
 */
function BacklogStrip({ weeks }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const H = 70;
  const PAD = { l: 46, r: 8, t: 12, b: 8 };
  const max = Math.max(1, ...weeks.map((w) => w.open));
  const slot = (width - PAD.l - PAD.r) / weeks.length;
  const pts = weeks.map((w, i) => /** @type {const} */ ([PAD.l + i * slot + slot / 2, PAD.t + (1 - w.open / max) * (H - PAD.t - PAD.b)]));
  const first = weeks[0]?.open ?? 0;
  const last = weeks[weeks.length - 1]?.open ?? 0;
  return (
    <div ref={ref} className="fi-strip">
      <p className="fi-strip-title">
        Open backlog at the end of each week: {first} → <b>{last} now</b>
      </p>
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg" role="img" aria-label={`Open backlog went from ${first} to ${last}`}>
          <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" className="viz-axis">
            {max}
          </text>
          <text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" className="viz-axis">
            0
          </text>
          <path d={`M${pts[0][0]},${H - PAD.b} ${pts.map((p) => `L${p[0]},${p[1]}`).join(" ")} L${pts[pts.length - 1][0]},${H - PAD.b} Z`} className="fi-area" style={{ fill: C.backlog }} />
          <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ")} className="viz-line" style={{ stroke: C.backlog }} />
          {weeks.map((w, i) => (
            <g key={w.start} className="viz-hit" {...tip(<TipRows title={`End of week of ${shortDate(w.start)}`} rows={[["open requests", w.open, C.backlog]]} />, `${w.open} open`)}>
              <rect x={PAD.l + i * slot} y={0} width={slot} height={H} fill="transparent" />
              {i === weeks.length - 1 && <circle cx={pts[i][0]} cy={pts[i][1]} r={4.5} className="viz-marker" style={{ fill: C.backlog }} />}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
// ---------- ageing: one dot per open request, lanes by priority ----------
/**
 * @param {{ features: Feature[]; now: number; onOpen: (f: Feature) => void }} props
 */
function AgeingChart({ features, now, onOpen }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const aged = ageing(features, now);
  const counts = openByPriority(features);
  if (!aged.length) return <p className="viz-empty">No open requests: the backlog is clear.</p>;
  const LANE = 46;
  const narrow = width < 560;
  const PAD = { l: 70, r: narrow ? 64 : 112, t: 8, b: 26 };
  const H = PAD.t + LANE * PRIORITIES.length + PAD.b;
  const maxAge = Math.max(30, ...aged.map((a) => a.ageDays));
  // Square-root scale: spreads out the young requests, still fits the oldest on the chart.
  const x = /** @param {number} d */ (d) => PAD.l + Math.sqrt(d / maxAge) * (width - PAD.l - PAD.r);
  // Ticks at least 40px apart, so they never collide on a phone.
  const ticks = /** @type {Array<number>} */ (/** @type {unknown} */ ([0, 7, 30, 60, 90, 180, 365].filter((t) => t <= maxAge).reduce((kept, t) => (!kept.length || x(t) - x(kept[kept.length - 1]) >= 40 ? [...kept, t] : kept), /** @type {number[]} */ ([]))));
  // Dots that would overlap stack upwards and downwards within their lane (a simple beeswarm).
  /** @type {{ cx: number; cy: number; a: (typeof aged)[number] }[]} */ const placed = [];
  for (const [li, p] of PRIORITIES.entries()) {
    const mid = PAD.t + li * LANE + LANE / 2;
    /** @type {{ cx: number; cy: number }[]} */ const taken = [];
    for (const a of aged.filter((a) => a.feature.priority === p).sort((m, n) => m.ageDays - n.ageDays)) {
      const cx = x(a.ageDays);
      let cy = mid;
      for (let k = 1; taken.some((t) => Math.hypot(t.cx - cx, t.cy - cy) < 11) && k < 12; k++) cy = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 9;
      cy = Math.max(mid - LANE / 2 + 6, Math.min(mid + LANE / 2 - 6, cy));
      taken.push({ cx, cy });
      placed.push({ cx, cy, a });
    }
  }
  const late = /** @param {string} p */ (p) => aged.filter((a) => a.feature.priority === p && a.late).length;
  return (
    <div ref={ref}>
      <Legend
        items={[
          { label: "Past its delivery date", color: C.late },
          { label: "Dated, on schedule", color: C.dated },
          { label: "No delivery date", color: C.undated },
        ]}
      />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg" role="group" aria-label="Open requests by age and priority">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} className="viz-grid" />
              <text x={x(t)} y={H - 8} textAnchor="middle" className="viz-axis">
                {t === 0 ? "today" : t < 30 ? `${t}d` : t < 365 ? `${t / 30}mo` : "1y"}
              </text>
            </g>
          ))}
          {PRIORITIES.map((p, li) => (
            <g key={p}>
              {li > 0 && <line x1={PAD.l} x2={width - PAD.r} y1={PAD.t + li * LANE} y2={PAD.t + li * LANE} className="viz-grid" />}
              <text x={0} y={PAD.t + li * LANE + LANE / 2 + 4} className="viz-row-label">
                {PRIORITY_META[p].label}
              </text>
              <text x={width - PAD.r + 10} y={PAD.t + li * LANE + LANE / 2 + 4} className="viz-end-label">
                {narrow ? `${counts[p]}${late(p) ? ` (${late(p)} late)` : ""}` : `${counts[p]} open${late(p) ? ` · ${late(p)} late` : ""}`}
              </text>
            </g>
          ))}
          {placed.map(({ cx, cy, a }) => {
            const f = a.feature;
            const color = a.late ? C.late : f.dueAt ? C.dated : C.undated;
            return (
              <g
                key={f.id}
                className="viz-hit fi-dot"
                onClick={() => onOpen(f)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(f)}
                {...tip(
                  <TipRows
                    title={f.title}
                    rows={[
                      ["waiting", days(a.ageDays), color],
                      ["client", f.client || "—"],
                      ["priority", PRIORITY_META[f.priority].label],
                      ["delivery date", f.dueAt ? `${f.dueAt}${a.late ? " (passed)" : ""}` : "none set"],
                    ]}
                  />,
                  `${f.title}, ${PRIORITY_META[f.priority].label}, open ${days(a.ageDays)}${a.late ? ", past its delivery date" : ""}`,
                )}
              >
                <circle cx={cx} cy={cy} r={9} fill="transparent" />
                <circle cx={cx} cy={cy} r={a.late ? 5.5 : 4.5} className="viz-marker" style={{ fill: color }} />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
// ---------- clients: delivered | open (late part marked) ----------
/**
 * @param {{ features: Feature[]; now: number }} arg2
 */
function ClientChart({ features, now }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const rows = clientDemand(features, now);
  const ROW = 34;
  const LABEL = Math.min(150, Math.max(96, width * 0.3));
  const END = width < 420 ? 44 : 112;
  const max = Math.max(1, ...rows.map((r) => r.delivered + r.open));
  const w = /** @param {number} n */ (n) => (n / max) * Math.max(0, width - LABEL - 6 - END - 4);
  return (
    <div ref={ref}>
      <Legend
        items={[
          { label: "Delivered", color: C.delivered },
          { label: "Open", color: C.dated },
          { label: "Open, late", color: C.late },
        ]}
      />
      {width > 0 && (
        <svg width={width} height={rows.length * ROW} className="viz-svg" role="group" aria-label="Requests per client">
          {rows.map((r, i) => {
            const y = i * ROW + 8;
            const segs = [
              { n: r.delivered, color: C.delivered },
              { n: r.open - r.late, color: C.dated },
              { n: r.late, color: C.late },
            ].filter((s) => s.n > 0);
            let at = LABEL + 6;
            return (
              <g
                key={r.client}
                className="viz-hit"
                {...tip(
                  <TipRows
                    title={r.client}
                    rows={[
                      ["delivered", r.delivered, C.delivered],
                      ["open", r.open, C.dated],
                      ["open and late", r.late, C.late],
                      ["delivered on time", pct(r.onTimeRate)],
                    ]}
                  />,
                  `${r.client}: ${r.total} requests, ${r.open} open, ${r.late} late`,
                )}
              >
                <rect x={0} y={i * ROW} width={width} height={ROW} fill="transparent" />
                <text x={0} y={y + 13} className="viz-row-label">
                  {r.client.length > Math.floor(LABEL / 8) ? `${r.client.slice(0, Math.floor(LABEL / 8) - 1)}…` : r.client}
                </text>
                {segs.map((s, k) => {
                  const sw = w(s.n);
                  const x0 = at;
                  at += sw + 2;
                  const last = k === segs.length - 1;
                  return <path key={k} d={hbar(x0, y + 2, Math.max(1, sw), 16, last)} style={{ fill: s.color }} />;
                })}
                <text x={at + 4} y={y + 14} className="viz-end-label">
                  {r.total}
                  {r.onTimeRate !== null && END > 60 ? ` · ${pct(r.onTimeRate)} on time` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
/**
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {boolean} roundEnd
 * @returns {string}
 */
function hbar(x, y, w, h, roundEnd) {
  const r = roundEnd ? Math.min(4, w / 2, h / 2) : 0;
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}
// ---------- lead time: median dot on a median→p80 bar, per type ----------
/**
 * @param {{ features: Feature[] }} arg6
 */
function LeadChart({ features }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const rows = leadByKind(features);
  if (!rows.some((r) => r.n)) return <p className="viz-empty">Nothing delivered yet, so there are no delivery times to show.</p>;
  const ROW = 40;
  const LABEL = 104;
  const END = 70;
  const max = Math.max(7, ...rows.map((r) => r.p80 ?? 0));
  const x = /** @param {number} d */ (d) => LABEL + (d / max) * Math.max(0, width - LABEL - END);
  const H = rows.length * ROW + 22;
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  return (
    <div ref={ref}>
      <Legend
        items={[
          { label: "Typical (median)", color: C.backlog, shape: "tick" },
          { label: "Up to the slow end (80%)", color: C.p80 },
        ]}
      />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg" role="group" aria-label="Delivery time by type of request">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={rows.length * ROW} className="viz-grid" />
              <text x={x(t)} y={H - 4} textAnchor="middle" className="viz-axis">
                {t}d
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cy = i * ROW + ROW / 2;
            return (
              <g
                key={r.kind}
                className="viz-hit"
                {...tip(
                  <TipRows
                    title={r.label}
                    rows={[
                      ["typical", r.median === null ? "—" : days(r.median), C.backlog],
                      ["slow end (80%)", r.p80 === null ? "—" : days(r.p80), C.p80],
                      ["delivered", r.n],
                      ["still open", r.open],
                    ]}
                  />,
                  `${r.label}: typically ${r.median === null ? "no deliveries" : days(r.median)}`,
                )}
              >
                <rect x={0} y={i * ROW} width={width} height={ROW} fill="transparent" />
                <text x={0} y={cy + 4} className="viz-row-label">
                  {r.label}
                </text>
                {r.median !== null && r.p80 !== null ? (
                  <>
                    <path d={hbar(x(r.median), cy - 5, Math.max(2, x(r.p80) - x(r.median)), 10, true)} style={{ fill: C.p80 }} className="fi-range" />
                    <line x1={x(r.median)} x2={x(r.median)} y1={cy - 9} y2={cy + 9} className="fi-median" style={{ stroke: C.backlog }} />
                    <text x={x(r.p80) + 8} y={cy + 4} className="viz-end-label">
                      {Math.round(r.median)}–{Math.round(r.p80)}d · {r.n}
                    </text>
                  </>
                ) : (
                  <text x={LABEL} y={cy + 4} className="viz-axis">
                    none delivered yet
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
/** @typedef {(typeof RANGES)[number]["key"]} RangeKey */
