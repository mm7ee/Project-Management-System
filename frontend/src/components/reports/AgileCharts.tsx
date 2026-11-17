import { Legend, TipRows, useTip, useWidth } from "./chartKit";

// Small SVG charts for the agile reports, in the same style as the other report charts: theme colours
// from CSS variables, a legend for two or more series, tooltips on hover and keyboard focus, and every
// value also in the table under each report.

const H = 240;
const PAD = { l: 38, r: 14, t: 12, b: 30 };

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Labels along the bottom: every one when they fit, else every few. */
const every = (n: number, width: number) => Math.max(1, Math.ceil(n / Math.max(1, Math.floor(width / 70))));

export interface Series {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

export function LineChart({ labels, series, unit = "" }: { labels: string[]; series: Series[]; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v != null))));
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length > 1 ? (i / (labels.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const step = every(labels.length, plotW);
  return (
    <div ref={ref} className="agile-chart">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: "line" }))} />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(f * max)} y2={y(f * max)} className="viz-grid" />
              <text x={PAD.l - 6} y={y(f * max) + 4} textAnchor="end" className="viz-axis">
                {Math.round(f * max)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % step === 0 ? (
              <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle" className="viz-axis">
                {l}
              </text>
            ) : null,
          )}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v == null ? null : ([x(i), y(v)] as const))).filter((p): p is readonly [number, number] => !!p);
            if (!pts.length) return null;
            return (
              <g key={s.key}>
                <path d={pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ")} style={{ stroke: s.color }} className={`agile-line ${s.dashed ? "dashed" : ""}`} />
                {s.values.map((v, i) =>
                  v == null ? null : (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={labels.length > 40 ? 2 : 3.5}
                      style={{ fill: s.color }}
                      {...tip(<TipRows title={labels[i]} rows={series.map((z) => [z.label, `${z.values[i] ?? "–"}${unit}`, z.color])} />, `${labels[i]}: ${s.label} ${v}${unit}`)}
                    />
                  ),
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Stacked areas, bottom series first: cumulative flow. */
export function StackedArea({ labels, series }: { labels: string[]; series: Series[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const totals = labels.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length > 1 ? (i / (labels.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const step = every(labels.length, plotW);
  let below = labels.map(() => 0);
  const bands = series.map((s) => {
    const lo = below;
    const hi = lo.map((b, i) => b + (s.values[i] ?? 0));
    below = hi;
    return { s, lo, hi };
  });
  return (
    <div ref={ref} className="agile-chart">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(f * max)} y2={y(f * max)} className="viz-grid" />
              <text x={PAD.l - 6} y={y(f * max) + 4} textAnchor="end" className="viz-axis">
                {Math.round(f * max)}
              </text>
            </g>
          ))}
          {bands.map(({ s, lo, hi }) => (
            <path
              key={s.key}
              d={`${hi.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} ${lo
                .map((v, i) => [x(i), y(v)] as const)
                .reverse()
                .map(([px, py]) => `L${px},${py}`)
                .join(" ")} Z`}
              style={{ fill: s.color }}
              className="agile-area"
            />
          ))}
          {labels.map((l, i) => (
            <g key={l + i}>
              {i % step === 0 && (
                <text x={x(i)} y={H - 8} textAnchor="middle" className="viz-axis">
                  {l}
                </text>
              )}
              <rect
                x={x(i) - plotW / Math.max(1, labels.length) / 2}
                y={PAD.t}
                width={plotW / Math.max(1, labels.length)}
                height={plotH}
                className="agile-hit"
                {...tip(<TipRows title={l} rows={[...series].reverse().map((s) => [s.label, s.values[i] ?? 0, s.color])} />, `${l}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(", ")}`)}
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

/** Grouped bars per label: velocity. */
export function GroupedBars({ labels, series }: { labels: string[]; series: Series[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v != null))));
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const group = plotW / Math.max(1, labels.length);
  const bar = Math.min(34, (group * 0.7) / series.length);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  return (
    <div ref={ref} className="agile-chart">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(f * max)} y2={y(f * max)} className="viz-grid" />
              <text x={PAD.l - 6} y={y(f * max) + 4} textAnchor="end" className="viz-axis">
                {Math.round(f * max)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => {
            const gx = PAD.l + group * i + (group - bar * series.length) / 2;
            return (
              <g key={l + i}>
                {series.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  return (
                    <rect
                      key={s.key}
                      x={gx + k * bar}
                      y={y(v)}
                      width={bar - 2}
                      height={Math.max(0, PAD.t + plotH - y(v))}
                      rx={3}
                      style={{ fill: s.color }}
                      {...tip(<TipRows title={l} rows={series.map((z) => [z.label, z.values[i] ?? 0, z.color])} />, `${l}: ${s.label} ${v}`)}
                    />
                  );
                })}
                <text x={PAD.l + group * i + group / 2} y={H - 8} textAnchor="middle" className="viz-axis">
                  {l.length > 14 ? `${l.slice(0, 13)}…` : l}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Each item as a dot (days on the y axis, finish date on the x), with the rolling average and the outlier limit. */
export function ControlChart({
  points,
  average,
  limit,
}: {
  points: { key: string; at: string; days: number; label: string }[];
  average: number[];
  limit: number | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const max = niceMax(Math.max(1, limit ?? 0, ...points.map((p) => p.days)));
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const t0 = points.length ? Date.parse(points[0].at) : 0;
  const t1 = points.length ? Date.parse(points[points.length - 1].at) : 1;
  const x = (at: string) => PAD.l + (t1 > t0 ? ((Date.parse(at) - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  return (
    <div ref={ref} className="agile-chart">
      <Legend
        items={[
          { label: "Work item", color: "var(--st-wip)" },
          { label: "Outlier", color: "var(--st-overdue)" },
          { label: "Rolling average", color: "var(--st-done)", shape: "line" },
          ...(limit != null ? [{ label: "Outlier limit (2 standard deviations)", color: "var(--st-deploy)", shape: "line" as const }] : []),
        ]}
      />
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(f * max)} y2={y(f * max)} className="viz-grid" />
              <text x={PAD.l - 6} y={y(f * max) + 4} textAnchor="end" className="viz-axis">
                {Math.round(f * max)}d
              </text>
            </g>
          ))}
          {limit != null && <line x1={PAD.l} x2={width - PAD.r} y1={y(limit)} y2={y(limit)} className="agile-limit" />}
          {points.length > 1 && (
            <path d={points.map((p, i) => `${i ? "L" : "M"}${x(p.at)},${y(average[i])}`).join(" ")} className="agile-line" style={{ stroke: "var(--st-done)" }} />
          )}
          {points.map((p) => {
            const out = limit != null && p.days > limit;
            return (
              <circle
                key={p.key}
                cx={x(p.at)}
                cy={y(p.days)}
                r={out ? 5 : 4}
                style={{ fill: out ? "var(--st-overdue)" : "var(--st-wip)" }}
                className="agile-dot"
                {...tip(<TipRows title={`${p.key} ${p.label}`} rows={[["Days", p.days], ["Finished", p.at.slice(0, 10)]]} />, `${p.key}: ${p.days} days, finished ${p.at.slice(0, 10)}${out ? ", an outlier" : ""}`)}
              />
            );
          })}
          {points.length > 0 && (
            <>
              <text x={PAD.l} y={H - 8} className="viz-axis">
                {points[0].at.slice(0, 10)}
              </text>
              <text x={width - PAD.r} y={H - 8} textAnchor="end" className="viz-axis">
                {points[points.length - 1].at.slice(0, 10)}
              </text>
            </>
          )}
        </svg>
      )}
    </div>
  );
}
