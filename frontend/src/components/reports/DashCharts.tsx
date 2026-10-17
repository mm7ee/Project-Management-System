// Charts for the Dashboard: a monthly trend (lines with a crosshair), projects by stage (donut)
// and delivery health (columns). Built on the same kit and colour tokens as the Reports charts.

import { useId, useState } from "react";
import { Legend, TipRows, useTip, useWidth } from "./chartKit";
import CountUp from "../CountUp";

/**
 * A smooth line through the points that never overshoots them (monotone cubic, Fritsch-Carlson),
 * so a month with 0 never dips below the axis.
 */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const d = pts.slice(1).map(([x, y], i) => (y - pts[i][1]) / (x - pts[i][0]));
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = (x1 - x0) / 3;
    path += ` C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return path;
}

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
  const uid = useId().replace(/:/g, "");
  // A new key when the figures change, so the lines draw in again (e.g. switching the period).
  const sig = months.join() + series.map((s) => s.values.join()).join("|");
  const last = months.length - 1;

  return (
    <div ref={ref}>
      {/* Hidden when the caller shows its own key, such as totals per series. */}
      {legend && (
        <Legend
          items={series.map((s) => ({
            label: s.label,
            color: s.color,
            shape: "line",
          }))}
        />
      )}
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
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.26 }} />
                <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>
          {hover !== null && (
            <>
              <rect x={x(hover) - step / 2} y={PAD.t} width={step} height={plotH} className="viz-band" />
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} className="viz-crosshair" />
            </>
          )}
          {series.map((s, k) => {
            const line = smoothPath(s.values.map((v, i) => [x(i), y(v)]));
            return (
              <g key={s.key + sig} style={{ ["--i" as string]: k }}>
                <path d={`${line} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} className="viz-area" style={{ fill: `url(#${uid}-${s.key})` }} />
                <path d={line} pathLength={1} className="viz-line viz-draw" style={{ stroke: s.color }} />
              </g>
            );
          })}
          {/* The latest month pulses: this is where the numbers stand now. */}
          {hover === null &&
            last >= 0 &&
            series.map((s, k) => (
              <g key={s.key + sig} className="viz-now" style={{ ["--i" as string]: k }}>
                <circle cx={x(last)} cy={y(s.values[last])} r={4} className="viz-now-ring" style={{ fill: s.color }} />
                <circle cx={x(last)} cy={y(s.values[last])} r={3.5} className="viz-marker" style={{ fill: s.color }} />
              </g>
            ))}
          {hover !== null &&
            series.map((s) => (
              <circle
                key={s.key + hover}
                cx={x(hover)}
                cy={y(s.values[hover])}
                r={5}
                className="viz-marker viz-pop"
                style={{ fill: s.color }}
              />
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
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((n, s) => n + s.value, 0);
  const on = slices.find((s) => s.key === active && s.value > 0);
  const sig = slices.map((s) => s.value).join();
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
            .map((s, k) => {
              const len = (s.value / total) * C;
              const gap = slices.filter((x) => x.value > 0).length > 1 ? 2 : 0;
              const t = tip(
                <TipRows
                  title={s.label}
                  rows={[
                    ["projects", s.value, s.color],
                    ["of all", `${Math.round((s.value / total) * 100)}%`],
                  ]}
                />,
                `${s.label}: ${s.value} of ${total}`,
              );
              const el = (
                <circle
                  key={s.key + sig}
                  cx={100}
                  cy={100}
                  r={R}
                  className={`viz-hit viz-donut-slice ${active && active !== s.key ? "dim" : ""}`}
                  style={{
                    stroke: s.color,
                    strokeWidth: active === s.key ? W + 8 : W,
                    strokeDasharray: `${Math.max(0, len - gap)} ${C}`,
                    strokeDashoffset: -offset,
                    ["--i" as string]: k,
                    ["--c" as string]: C,
                  }}
                  {...t}
                  onPointerEnter={() => setActive(s.key)}
                  onPointerLeave={() => {
                    setActive(null);
                    t.onPointerLeave();
                  }}
                  onFocus={(e) => {
                    setActive(s.key);
                    t.onFocus(e);
                  }}
                  onBlur={() => {
                    setActive(null);
                    t.onBlur();
                  }}
                />
              );
              offset += len;
              return el;
            })}
      </g>
      {/* The centre reads the hovered slice; otherwise the total. */}
      <text x={100} y={98} textAnchor="middle" className="viz-donut-total" style={on ? { fill: on.color } : undefined}>
        <CountUp value={on ? on.value : total} ms={on ? 350 : 900} />
      </text>
      <text x={100} y={120} textAnchor="middle" className="viz-donut-label">
        {on ? `${on.label} · ${Math.round((on.value / total) * 100)}%` : centre}
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
        <svg width={width} height={H} className="viz-svg viz-cols">
          <line x1={0} x2={width} y1={PAD.t + plotH} y2={PAD.t + plotH} className="viz-grid" />
          {bars.map((b, i) => {
            const h = b.value ? Math.max(4, (b.value / max) * plotH) : 0;
            const cx = slot * i + slot / 2;
            const top = PAD.t + plotH - h;
            return (
              <g
                key={b.key + b.value}
                className="viz-hit"
                style={{ ["--i" as string]: i }}
                {...tip(<TipRows title={b.label} rows={[["projects", b.value, b.color]]} />, `${b.label}: ${b.value}`)}
              >
                <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
                {h > 0 && <path d={topRounded(cx - bw / 2, top, bw, h)} className="viz-col" style={{ fill: b.color }} />}
                <text x={cx} y={top - 7} textAnchor="middle" className="viz-end-label viz-col-label">
                  <CountUp value={b.value} />
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

/** A small trend line for a figure card: draws itself in, with a soft fill underneath. */
export function Sparkline({ values, color, label }: { values: number[]; color: string; label: string }) {
  const uid = useId().replace(/:/g, "");
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 34;
  const max = Math.max(1, ...values);
  const pts = values.map(
    (v, i) => [values.length > 1 ? (i / (values.length - 1)) * W : W / 2, H - 3 - (v / max) * (H - 6)] as [number, number],
  );
  const line = smoothPath(pts);
  return (
    <div ref={ref} className="viz-spark-wrap">
      {W > 0 && (
        <svg width={W} height={H} className="viz-spark" role="img" aria-label={label}>
          <defs>
            <linearGradient id={uid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.3 }} />
              <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <g key={values.join()}>
            <path d={`${line} L${W},${H} L0,${H} Z`} className="viz-area" style={{ fill: `url(#${uid})` }} />
            <path d={line} pathLength={1} className="viz-line viz-draw" style={{ stroke: color }} />
          </g>
        </svg>
      )}
    </div>
  );
}
