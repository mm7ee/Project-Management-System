import { Legend, STAGES, STAGE_COLOR, TipRows, useTip, useWidth, type Stage } from "./chartKit";

// Charts still shared outside Reports → Projects: the lifecycle bar (executive page) and workload bars (dashboard).

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function endRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

export function StageBar({ counts }: { counts: Record<Stage, number> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const total = Object.values(counts).reduce((n, c) => n + c, 0) || 1;
  const GAP = 2;
  const segs = STAGES.map((st) => ({ ...st, n: counts[st.key] ?? 0 })).filter((s) => s.n);
  let x = 0;
  const usable = Math.max(0, width - GAP * (segs.length - 1));

  return (
    <div ref={ref}>
      <Legend items={STAGES.map((s) => ({ label: s.label, color: STAGE_COLOR[s.key] }))} />
      {width > 0 && (
        <svg width={width} height={64} className="viz-svg">
          {segs.map((seg, i) => {
            const w = (seg.n / total) * usable;
            const x0 = x;
            x += w + GAP;
            const first = i === 0;
            const last = i === segs.length - 1;
            const label = `${seg.n}`;
            const fits = w > 34;
            return (
              <g
                key={seg.key}
                {...tip(
                  <TipRows
                    title={seg.label}
                    rows={[
                      ["projects", seg.n, STAGE_COLOR[seg.key]],
                      ["of all projects", `${Math.round((seg.n / total) * 100)}%`],
                    ]}
                  />,
                  `${seg.label}: ${seg.n} projects`,
                )}
                className="viz-hit"
              >
                <path d={roundedRect(x0, 8, w, 32, first ? 4 : 0, last ? 4 : 0)} style={{ fill: STAGE_COLOR[seg.key] }} />
                {fits && (
                  <text x={x0 + w / 2} y={29} textAnchor="middle" className="viz-in-label" style={{ fill: seg.key === "NOT_STARTED" ? "var(--st-not-ink)" : "#fff" }}>
                    {label}
                  </text>
                )}
                {/* names under the bar when the segment is wide enough */}
                {w > 90 && (
                  <text x={x0 + 2} y={58} className="viz-axis">
                    {seg.label}
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

/** Rect with rounded corners only on the outer ends of the stack. */
function roundedRect(x: number, y: number, w: number, h: number, rl: number, rr: number) {
  return `M${x + rl},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x + rl} Q${x},${y + h} ${x},${y + h - rl} V${y + rl} Q${x},${y} ${x + rl},${y} Z`;
}

// ---------- 2. Delivery roadmap: when each system started, is due, or shipped ----------


export function WorkloadBars({ rows, limit }: { rows: { name: string; projects: number; openRequests: number }[]; limit: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const LABEL = Math.min(170, Math.max(100, width * 0.28));
  const ROW = 30;
  const maxV = Math.max(limit + 1, ...rows.map((r) => r.projects));
  const plotW = Math.max(10, width - LABEL - 92);
  const x = (v: number) => LABEL + (v / maxV) * plotW;

  return (
    <div ref={ref}>
      {width > 0 &&
        (rows.length ? (
          <svg width={width} height={rows.length * ROW + 18} className="viz-svg">
            {rows.map((r, i) => {
              const y = i * ROW;
              const over = r.projects > limit;
              const color = over ? "var(--st-overdue)" : "var(--st-wip)";
              return (
                <g
                  key={r.name}
                  className="viz-hit"
                  {...tip(
                    <TipRows
                      title={r.name}
                      rows={[
                        ["projects", `${r.projects} of ${limit}`, color],
                        ["open client requests", r.openRequests],
                      ]}
                    />,
                    `${r.name}: ${r.projects} projects, limit ${limit}`,
                  )}
                >
                  <rect x={0} y={y} width={width} height={ROW} fill="transparent" />
                  <text x={0} y={y + 19} className="viz-row-label">
                    {truncate(r.name, Math.floor(LABEL / 7.6))}
                  </text>
                  {r.projects > 0 && <path d={endRounded(LABEL, y + 7, Math.max(4, x(r.projects) - LABEL), 16)} style={{ fill: color }} />}
                  <text x={x(r.projects) + 8} y={y + 19} className={`viz-end-label ${over ? "viz-over" : ""}`}>
                    {r.projects}
                    {over ? " · over limit" : ""}
                  </text>
                </g>
              );
            })}
            {/* The limit, as a dashed line across all rows. */}
            <line x1={x(limit)} x2={x(limit)} y1={0} y2={rows.length * ROW} className="viz-limit" />
            <text x={x(limit)} y={rows.length * ROW + 13} textAnchor="middle" className="viz-axis">
              limit {limit}
            </text>
          </svg>
        ) : (
          <p className="viz-empty">No developers yet.</p>
        ))}
    </div>
  );
}
