// Charts for the Dashboard: a monthly trend (lines with a crosshair), projects by stage (donut)
// and delivery health (columns). Built on the same kit and colour tokens as the Reports charts.

import { useState } from "react";
import { Legend, TipRows, useTip, useWidth } from "./chartKit";

/** A round axis maximum: the next of 4, 5, 10, 20… at or above `v`, never below 4. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  values: number[]; // one per month
}

/** Lines per month. Hovering a month shows a crosshair, its markers and every series' value. */
export function TrendChart({ months, series, legend = true }: { months: string[]; series: TrendSeries[]; legend?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const PAD = { l: 34, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max));
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (months.length > 1 ? (i / (months.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const step = months.length > 1 ? plotW / (months.length - 1) : plotW;

  return (
    <div ref={ref}>
      {/* Hidden when the caller shows its own key, such as totals per series. */}
      {legend && <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: "line" }))} />}
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg" onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="viz-axis">
                {t}
              </text>
            </g>
          ))}
          {months.map((m, i) => (
            <text key={m + i} x={x(i)} y={H - 8} textAnchor="middle" className={`viz-axis ${hover === i ? "viz-axis-on" : ""}`}>
              {m}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} className="viz-crosshair" />}
          {series.map((s) => (
            <path
              key={s.key}
              d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")}
              className="viz-line"
              style={{ stroke: s.color }}
            />
          ))}
          {hover !== null &&
            series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={5} className="viz-marker" style={{ fill: s.color }} />
            ))}
          {/* One tall hit area per month: hovering anywhere in the column picks the month. */}
          {months.map((m, i) => {
            const t = tip(
              <TipRows title={m} rows={series.map((s) => [s.label.toLowerCase(), s.values[i], s.color] as [string, number, string])} />,
              `${m}: ${series.map((s) => `${s.values[i]} ${s.label.toLowerCase()}`).join(", ")}`,
            );
            return (
              <rect
                key={i}
                x={x(i) - step / 2}
                y={PAD.t}
                width={step}
                height={plotH}
                fill="transparent"
                className="viz-hit"
                {...t}
                onPointerMove={(e) => {
                  setHover(i);
                  t.onPointerMove(e);
                }}
                onFocus={(e) => {
                  setHover(i);
                  t.onFocus(e);
                }}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

export interface DonutSlice {
  key: string;
  label: string;
  color: string;
  value: number;
}

/** Part-to-whole ring with a 2px surface gap between slices and the total in the middle. */
export function Donut({ slices, centre }: { slices: DonutSlice[]; centre: string }) {
  const tip = useTip();
  const total = slices.reduce((n, s) => n + s.value, 0);
  const R = 82;
  const W = 26;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 200 200" className="viz-donut" role="group" aria-label={`${total} ${centre}`}>
      {/* Rotated so the first slice starts at 12 o'clock. */}
      <g transform="rotate(-90 100 100)">
      <circle cx={100} cy={100} r={R} className="viz-donut-track" style={{ strokeWidth: W }} />
      {total > 0 &&
        slices
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * C;
            const gap = slices.filter((x) => x.value > 0).length > 1 ? 2 : 0;
            const el = (
              <circle
                key={s.key}
                cx={100}
                cy={100}
                r={R}
                className="viz-hit viz-donut-slice"
                style={{ stroke: s.color, strokeWidth: W, strokeDasharray: `${Math.max(0, len - gap)} ${C}`, strokeDashoffset: -offset }}
                {...tip(
                  <TipRows title={s.label} rows={[["projects", s.value, s.color], ["of all", `${Math.round((s.value / total) * 100)}%`]]} />,
                  `${s.label}: ${s.value} of ${total}`,
                )}
              />
            );
            offset += len;
            return el;
          })}
      </g>
      <text x={100} y={98} textAnchor="middle" className="viz-donut-total">
        {total}
      </text>
      <text x={100} y={120} textAnchor="middle" className="viz-donut-label">
        {centre}
      </text>
    </svg>
  );
}

/** Columns, one per category, with the count above each. */
export function Columns({ bars }: { bars: { key: string; label: string; color: string; value: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const H = 200;
  const PAD = { t: 22, b: 30 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = width / Math.max(1, bars.length);
  const bw = Math.min(46, slot * 0.55);
  const plotH = H - PAD.t - PAD.b;
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} className="viz-svg">
          <line x1={0} x2={width} y1={PAD.t + plotH} y2={PAD.t + plotH} className="viz-grid" />
          {bars.map((b, i) => {
            const h = b.value ? Math.max(4, (b.value / max) * plotH) : 0;
            const cx = slot * i + slot / 2;
            const top = PAD.t + plotH - h;
            return (
              <g key={b.key} className="viz-hit" {...tip(<TipRows title={b.label} rows={[["projects", b.value, b.color]]} />, `${b.label}: ${b.value}`)}>
                <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
                {h > 0 && <path d={topRounded(cx - bw / 2, top, bw, h)} style={{ fill: b.color }} />}
                <text x={cx} y={top - 7} textAnchor="middle" className="viz-end-label">
                  {b.value}
                </text>
                <text x={cx} y={H - 10} textAnchor="middle" className="viz-axis">
                  {b.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** A column rounded at its top end only (4px), anchored square on the baseline. */
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
