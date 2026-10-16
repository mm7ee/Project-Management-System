import { STATUS_META, SCHEDULE_META, daysUntil, getSchedule, type System } from "../../data/systems";
import { FEATURE_STATUS_META, type Feature, type FeatureStatus } from "../../data/features";
import type { User } from "../../data/roles";
import { formatDate, formatShort, plural } from "../../time";
import { HEALTH_COLOR, Legend, STAGES, STAGE_COLOR, TipRows, stageOf, useTip, useWidth, type Stage } from "./chartKit";

const DAY = 86_400_000;
const t = (iso: string) => new Date(iso).getTime();

// ---------- 1. Pipeline: part-to-whole across lifecycle stages ----------

export function PipelineBar({ systems }: { systems: System[] }) {
  const counts = Object.fromEntries(STAGES.map((st) => [st.key, systems.filter((s) => stageOf(s.status) === st.key).length])) as Record<Stage, number>;
  return <StageBar counts={counts} />;
}

/** The pipeline drawn from counts alone, so the public showcase needs no system details. */
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

export function Roadmap({ systems, now }: { systems: System[]; now: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const rows = [...systems].sort((a, b) => t(a.startedAt) - t(b.startedAt));
  const LABEL = Math.min(200, Math.max(120, width * 0.24));
  const ROW = 34;
  const TOP = 30;
  const plotW = Math.max(10, width - LABEL - 64);

  const ends = rows.flatMap((s) => [s.finishedAt, s.dueAt].filter(Boolean).map((d) => t(d!)));
  const min = Math.min(...rows.map((s) => t(s.startedAt)), now) - 10 * DAY;
  const max = Math.max(...ends, now) + 14 * DAY;
  const X = (ms: number) => LABEL + ((ms - min) / (max - min)) * plotW;

  // Month ticks, thinned to fit.
  const ticks: number[] = [];
  const d = new Date(min);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  while (d.getTime() < max) {
    ticks.push(d.getTime());
    d.setMonth(d.getMonth() + 1);
  }
  const every = Math.ceil(ticks.length / Math.max(1, Math.floor(plotW / 70)));
  const height = TOP + rows.length * ROW + 8;

  return (
    <div ref={ref}>
      <Legend
        items={[
          ...STAGES.map((s) => ({ label: s.label, color: STAGE_COLOR[s.key] })),
          { label: "Past due date", color: HEALTH_COLOR.OVERDUE },
          { label: "Due date", color: "var(--text)", shape: "tick" as const },
        ]}
      />
      {width > 0 && rows.length > 0 && (
        <svg width={width} height={height} className="viz-svg">
          {ticks.map((tk, i) =>
            i % every ? null : (
              <g key={tk}>
                <line x1={X(tk)} x2={X(tk)} y1={TOP - 6} y2={height - 4} className="viz-grid" />
                {/* the "Today" label owns its spot on the axis */}
                {Math.abs(X(tk) + 20 - X(now)) > 44 && (
                  <text x={X(tk) + 4} y={TOP - 12} className="viz-axis">
                    {new Date(tk).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
                  </text>
                )}
              </g>
            ),
          )}

          {rows.map((s, i) => {
            const y = TOP + i * ROW;
            const stage = stageOf(s.status);
            const color = STAGE_COLOR[stage];
            const start = X(t(s.startedAt));
            const schedule = getSchedule(s, now);
            const delivered = !!s.finishedAt;
            const plannedEnd = s.dueAt ? X(t(s.dueAt)) : null;
            // Delivered: start -> delivery. In flight: start -> today (solid, the time spent),
            // plus the planned remainder to the due date as a pale wash.
            const solidEnd = delivered ? X(t(s.finishedAt!)) : Math.min(X(now), plannedEnd ?? X(now));
            const overrunEnd = !delivered && plannedEnd !== null && X(now) > plannedEnd ? X(now) : null;
            const notStarted = t(s.startedAt) > now;
            const rightLabel = delivered
              ? `Delivered ${formatShort(s.finishedAt!)}`
              : s.dueAt
                ? `${s.progress}%`
                : "No due date";
            const labelX = Math.max(solidEnd, plannedEnd ?? 0, overrunEnd ?? 0) + 8;

            return (
              <g
                key={s.id}
                className="viz-hit"
                {...tip(
                  <TipRows
                    title={s.name}
                    rows={[
                      ["status", STATUS_META[s.status].label, color],
                      ["progress", `${s.progress}%`],
                      ["started", formatDate(s.startedAt)],
                      ...(s.finishedAt ? [["delivered", formatDate(s.finishedAt)] as [string, string]] : []),
                      ...(s.dueAt && !s.finishedAt ? [["due", formatDate(s.dueAt)] as [string, string]] : []),
                      ["schedule", SCHEDULE_META[schedule].label],
                    ]}
                  />,
                  `${s.name}: ${STATUS_META[s.status].label}, ${s.progress}%, ${rightLabel}`,
                )}
              >
                <rect x={0} y={y} width={width} height={ROW} fill="transparent" />
                <text x={0} y={y + ROW / 2 + 4} className="viz-row-label">
                  {truncate(s.name, Math.floor(LABEL / 7.6))}
                </text>
                {plannedEnd !== null && !delivered && plannedEnd > (notStarted ? start : solidEnd) && (
                  <rect
                    x={notStarted ? start : solidEnd}
                    y={y + 10}
                    width={plannedEnd - (notStarted ? start : solidEnd)}
                    height={14}
                    rx={4}
                    style={{ fill: color }}
                    opacity={notStarted ? 0.45 : 0.22}
                  />
                )}
                {!notStarted && (
                  <rect x={start} y={y + 10} width={Math.max(4, solidEnd - start)} height={14} rx={4} style={{ fill: color }} />
                )}
                {overrunEnd !== null && plannedEnd !== null && (
                  <rect x={plannedEnd + 2} y={y + 10} width={Math.max(4, overrunEnd - plannedEnd - 2)} height={14} rx={4} style={{ fill: HEALTH_COLOR.OVERDUE }} />
                )}
                {plannedEnd !== null && !delivered && (
                  <line x1={plannedEnd} x2={plannedEnd} y1={y + 6} y2={y + 28} className="viz-due" />
                )}
                {!s.dueAt && !delivered && <circle cx={start} cy={y + 17} r={5} style={{ fill: color, stroke: "var(--card)" }} strokeWidth={2} />}
                <text x={Math.min(labelX, width - 4)} y={y + ROW / 2 + 4} className="viz-end-label" textAnchor={labelX > width - 60 ? "end" : "start"}>
                  {rightLabel}
                </text>
              </g>
            );
          })}

          <line x1={X(now)} x2={X(now)} y1={TOP - 6} y2={height - 4} className="viz-today" />
          <text x={X(now)} y={TOP - 12} textAnchor="middle" className="viz-today-label">
            Today
          </text>
        </svg>
      )}
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- 3. Pace: progress vs where it should be by today ----------

export interface Pace {
  system: System;
  expected: number; // % of the planned time that has elapsed
  delta: number; // progress - expected, in points
}

export function paceOf(s: System, now: number): Pace | null {
  if (s.finishedAt || !s.dueAt) return null;
  const span = t(s.dueAt) - t(s.startedAt);
  if (span <= 0 || t(s.startedAt) > now) return null;
  const expected = Math.max(0, Math.min(100, Math.round(((now - t(s.startedAt)) / span) * 100)));
  return { system: s, expected, delta: s.progress - expected };
}

export function PaceChart({ paces, now }: { paces: Pace[]; now: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const rows = [...paces].sort((a, b) => a.delta - b.delta);
  const LABEL = Math.min(200, Math.max(110, width * 0.26));
  const RIGHT = 120;
  const ROW = 40;
  const trackW = Math.max(10, width - LABEL - RIGHT);
  const X = (pct: number) => LABEL + (pct / 100) * trackW;

  return (
    <div ref={ref}>
      <Legend
        items={[
          { label: "Progress", color: STAGE_COLOR.WIP },
          { label: "Where it should be by today", color: "var(--text)", shape: "tick" },
        ]}
      />
      {width > 0 &&
        (rows.length ? (
          <svg width={width} height={rows.length * ROW + 24} className="viz-svg">
            {(trackW < 220 ? [0, 50, 100] : [0, 25, 50, 75, 100]).map((p) => (
              <g key={p}>
                <line x1={X(p)} x2={X(p)} y1={0} y2={rows.length * ROW} className="viz-grid" />
                <text x={X(p)} y={rows.length * ROW + 16} textAnchor="middle" className="viz-axis">
                  {p}%
                </text>
              </g>
            ))}
            {rows.map((p, i) => {
              const y = i * ROW;
              const color = STAGE_COLOR[stageOf(p.system.status)];
              const behind = p.delta < -5;
              const ahead = p.delta > 5;
              const verdict = behind ? `${-p.delta} pts behind` : ahead ? `${p.delta} pts ahead` : "On pace";
              const daysLeft = daysUntil(p.system.dueAt!, now);
              return (
                <g
                  key={p.system.id}
                  className="viz-hit"
                  {...tip(
                    <TipRows
                      title={p.system.name}
                      rows={[
                        ["done", `${p.system.progress}%`, color],
                        ["expected by today", `${p.expected}%`],
                        ["pace", verdict],
                        ["due", daysLeft < 0 ? `${plural(-daysLeft, "day")} ago` : `in ${plural(daysLeft, "day")}`],
                      ]}
                    />,
                    `${p.system.name}: ${p.system.progress}% done, ${p.expected}% expected, ${verdict}`,
                  )}
                >
                  <rect x={0} y={y} width={width} height={ROW} fill="transparent" />
                  <text x={0} y={y + 24} className="viz-row-label">
                    {truncate(p.system.name, Math.floor(LABEL / 7.6))}
                  </text>
                  <rect x={LABEL} y={y + 12} width={trackW} height={16} rx={4} style={{ fill: "var(--track)" }} />
                  {p.system.progress > 0 && (
                    <rect x={LABEL} y={y + 12} width={Math.max(4, X(p.system.progress) - LABEL)} height={16} rx={4} style={{ fill: color }} />
                  )}
                  <line x1={X(p.expected)} x2={X(p.expected)} y1={y + 6} y2={y + 34} className="viz-expected" />
                  <text x={LABEL + trackW + 12} y={y + 24} className={`viz-verdict ${behind ? "behind" : ahead ? "ahead" : ""}`}>
                    {behind ? "▼ " : ahead ? "▲ " : "● "}
                    {verdict}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="viz-empty">No projects in flight with a due date in this view.</p>
        ))}
    </div>
  );
}

// ---------- 4. Engagement: visits per live system (one series, one colour) ----------

export function EngagementBars({ systems }: { systems: System[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const rows = systems.filter((s) => s.engagement > 0).sort((a, b) => b.engagement - a.engagement);
  const LABEL = Math.min(200, Math.max(110, width * 0.3));
  const ROW = 30;
  const maxV = Math.max(...rows.map((r) => r.engagement), 1);
  const plotW = Math.max(10, width - LABEL - 60);

  return (
    <div ref={ref}>
      {width > 0 &&
        (rows.length ? (
          <svg width={width} height={rows.length * ROW} className="viz-svg">
            {rows.map((s, i) => {
              const w = (s.engagement / maxV) * plotW;
              const y = i * ROW;
              return (
                <g
                  key={s.id}
                  className="viz-hit"
                  {...tip(
                    <TipRows title={s.name} rows={[["visits in the last 30 days", s.engagement.toLocaleString(), STAGE_COLOR.COMPLETED]]} />,
                    `${s.name}: ${s.engagement} visits`,
                  )}
                >
                  <rect x={0} y={y} width={width} height={ROW} fill="transparent" />
                  <text x={0} y={y + 19} className="viz-row-label">
                    {truncate(s.name, Math.floor(LABEL / 7.6))}
                  </text>
                  <path d={endRounded(LABEL, y + 7, Math.max(4, w), 16)} style={{ fill: STAGE_COLOR.COMPLETED }} />
                  <text x={LABEL + w + 8} y={y + 19} className="viz-end-label">
                    {s.engagement.toLocaleString()}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="viz-empty">No visits recorded for the systems in this view.</p>
        ))}
    </div>
  );
}

/** Bar square at the baseline, 4px rounded at the data end. */
function endRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

// ---------- 5. Auto-written brief ----------

export function buildBrief(systems: System[], users: User[], openRequests: number, now: number) {
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  const delivered = systems.filter((s) => s.finishedAt);
  const active = systems.filter((s) => !s.finishedAt && t(s.startedAt) <= now && s.status !== "IDEA");
  const flagged = systems.filter((s) => ["AT_RISK", "OVERDUE"].includes(getSchedule(s, now)));
  const paces = systems.map((s) => paceOf(s, now)).filter((p): p is Pace => !!p);
  const behind = paces.filter((p) => p.delta < -5).sort((a, b) => a.delta - b.delta);
  const next = systems
    .filter((s) => !s.finishedAt && s.dueAt && daysUntil(s.dueAt, now) >= 0)
    .sort((a, b) => t(a.dueAt!) - t(b.dueAt!))[0];
  const quiet = active
    .filter((s) => now - t(s.updatedAt ?? s.startedAt) > 14 * DAY)
    .sort((a, b) => t(a.updatedAt ?? a.startedAt) - t(b.updatedAt ?? b.startedAt));
  const top = [...systems].sort((a, b) => b.engagement - a.engagement)[0];

  const lines: { tone: "good" | "warn" | "bad" | "info"; text: string }[] = [];
  lines.push({
    tone: "info",
    text: `${plural(delivered.length, "system")} delivered and ${active.length} in flight, averaging ${
      active.length ? Math.round(active.reduce((n, s) => n + s.progress, 0) / active.length) : 0
    }% complete.`,
  });
  if (next) {
    const d = daysUntil(next.dueAt!, now);
    lines.push({
      tone: d <= 7 ? "warn" : "info",
      text: `Next deadline: ${next.name}, ${d === 0 ? "due today" : `due in ${plural(d, "day")}`} at ${next.progress}%${
        name(next.lead) ? ` (lead: ${name(next.lead)})` : ""
      }.`,
    });
  }
  lines.push(
    flagged.length
      ? { tone: "bad", text: `Needs attention: ${flagged.map((s) => `${s.name} (${SCHEDULE_META[getSchedule(s, now)].label.toLowerCase()})`).join(", ")}.` }
      : { tone: "good", text: "Nothing is at risk or overdue." },
  );
  if (behind.length) {
    lines.push({
      tone: "warn",
      text: `Behind pace: ${behind.slice(0, 3).map((p) => `${p.system.name} (${-p.delta} pts)`).join(", ")}. Progress is below the share of time already used.`,
    });
  } else if (paces.length) {
    lines.push({ tone: "good", text: "Every project in flight is keeping pace with its timeline." });
  }
  const maint = systems.filter((s) => s.health === "Maintenance");
  if (maint.length) {
    lines.push({
      tone: "info",
      text: `Under maintenance: ${maint.map((s) => (s.maintenanceNote ? `${s.name} (${s.maintenanceNote})` : s.name)).join(", ")}.`,
    });
  }
  if (quiet.length) {
    lines.push({ tone: "warn", text: `No update in over 2 weeks: ${quiet.map((s) => s.name).join(", ")}.` });
  }
  if (openRequests) lines.push({ tone: "warn", text: `${plural(openRequests, "update request")} waiting for a response.` });
  if (top && top.engagement > 0) {
    lines.push({ tone: "info", text: `Most used: ${top.name}, with ${top.engagement.toLocaleString()} visits in the last 30 days.` });
  }
  return { delivered: delivered.length, active: active.length, flagged: flagged.length, lines };
}

export { HEALTH_COLOR };

// ---------- 6. Feature requests: part-to-whole across request statuses ----------

const FEATURE_STAGES: { key: FeatureStatus; color: string }[] = [
  { key: "NOT_STARTED", color: "var(--st-not)" },
  { key: "IN_PROGRESS", color: "var(--st-wip)" },
  { key: "ON_HOLD", color: "var(--st-deploy)" },
  { key: "TESTING", color: "var(--st-testing)" },
  { key: "COMPLETED", color: "var(--st-live)" },
];

/** Cancelled requests are left out: they are counted in the caption instead. */
export function FeatureStatusBar({ features }: { features: Feature[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const counted = features.filter((f) => f.status !== "CANCELLED");
  const total = counted.length || 1;
  const GAP = 2;
  const segs = FEATURE_STAGES.map((st) => ({ ...st, n: counted.filter((f) => f.status === st.key).length })).filter((s) => s.n);
  let x = 0;
  const usable = Math.max(0, width - GAP * (segs.length - 1));

  return (
    <div ref={ref}>
      <Legend items={FEATURE_STAGES.map((s) => ({ label: FEATURE_STATUS_META[s.key].label, color: s.color }))} />
      {width > 0 && (
        <svg width={width} height={64} className="viz-svg">
          {segs.map((seg, i) => {
            const w = (seg.n / total) * usable;
            const x0 = x;
            x += w + GAP;
            const label = FEATURE_STATUS_META[seg.key].label;
            return (
              <g
                key={seg.key}
                {...tip(
                  <TipRows
                    title={label}
                    rows={[
                      ["requests", seg.n, seg.color],
                      ["of all requests", `${Math.round((seg.n / total) * 100)}%`],
                    ]}
                  />,
                  `${label}: ${seg.n} requests`,
                )}
                className="viz-hit"
              >
                <path d={roundedRect(x0, 8, w, 32, i === 0 ? 4 : 0, i === segs.length - 1 ? 4 : 0)} style={{ fill: seg.color }} />
                {w > 34 && (
                  <text x={x0 + w / 2} y={29} textAnchor="middle" className="viz-in-label" style={{ fill: seg.key === "NOT_STARTED" ? "var(--st-not-ink)" : "#fff" }}>
                    {seg.n}
                  </text>
                )}
                {w > 90 && (
                  <text x={x0 + 2} y={58} className="viz-axis">
                    {label}
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

// ---------- 7. Team workload: projects per developer against the limit ----------

/**
 * One bar per developer: how many projects they're on, with the limit marked. Over the limit is
 * drawn in the "overdue" red and labelled, so it never relies on colour alone.
 */
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
