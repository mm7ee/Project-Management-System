/** @import { ReactNode } from 'react' */
/** @import { Schedule, System } from '../../data/systems' */
/** @import { Feature, FeatureKind } from '../../data/features' */
/** @import { User } from '../../data/roles' */
/** @import { Blocker } from '../../data/project' */
/** @import { BiData, BiFilters, Dim, Stage } from '../../data/bi' */
import { useMemo, useState } from "react";
import { FilterX, MousePointerClick, X } from "lucide-react";
import { SCHEDULE_META, getSchedule } from "../../data/systems";
import { FEATURE_KINDS, KIND_META, PRIORITIES, PRIORITY_META, isOpen } from "../../data/features";
import { EMPTY_FILTERS, NO_LEAD, activeCount, applyFilters, clientOf, countBy, kpis, lastMonths, squarify, stageOf, toggle, workspaceOf } from "../../data/bi";
import { Legend, TipRows, TooltipLayer, useTip, useWidth } from "./chartKit";
import OrgMark from "../OrgMark";
import { currentBranding } from "../../brandTheme";
/** @type {{ key: Stage; label: string; color: string }[]} */ const STAGES = [
  { key: "NOT_STARTED", label: "Not started", color: "var(--st-not)" },
  { key: "WIP", label: "In progress", color: "var(--st-wip)" },
  { key: "TESTING", label: "Testing", color: "var(--st-testing)" },
  { key: "TO_DEPLOY", label: "To deploy", color: "var(--st-deploy)" },
  { key: "LIVE", label: "Live", color: "var(--st-live)" },
  { key: "COMPLETED", label: "Completed", color: "var(--st-done)" },
];
/** @type {{ key: Schedule; color: string }[]} */ const SCHEDULES = [
  { key: "ON_TRACK", color: "var(--st-live)" },
  { key: "AT_RISK", color: "var(--st-deploy)" },
  { key: "OVERDUE", color: "var(--st-overdue)" },
  { key: "DONE", color: "var(--st-done)" },
  { key: "UNSCHEDULED", color: "var(--st-not)" },
];
// Priority is ordered, so it's one hue from strong to light (sequential), not four unrelated colours.
const PRIORITY_COLOR = { CRITICAL: "var(--st-done)", HIGH: "var(--bi-p2)", MEDIUM: "var(--bi-p3)", LOW: "var(--bi-p4)" };
/** @type {Record<Dim, string>} */ const DIM_LABEL = { workspace: "Workspace", stage: "Stage", schedule: "Schedule", lead: "Lead", project: "Project", client: "Client", kind: "Type" };
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pct =
  /** @param {number | null} r
   * @returns {string}
   */ (r) => (r === null ? "—" : `${Math.round(r * 100)}%`);
/**
 * The interactive BI dashboard: workspace slicer, headline figures, and charts that filter each other. Click
 * any tile, slice or bar to filter the whole page by it; click again to take the filter off.
 * @param {Props} arg1
 */
export default function BiDashboard({ systems, features, blockers, users, workspaces, now }) {
  const [f, setF] = useState(/** @type {BiFilters | (() => BiFilters)} */ (EMPTY_FILTERS));
  /** @type {BiData} */ const d = useMemo(() => ({ systems, features, blockers, workspaces, now }), [systems, features, blockers, workspaces, now]);
  const pick = /** @template {Dim} D @param {D} dim @param {BiFilters[D][number]} v */ (dim, v) => setF((x) => toggle(x, dim, v));
  const view = /** @param {Dim} [except] */ (except) => applyFilters(d, f, except);
  const k = kpis(d, f);
  const leadName = /** @param {string} id */ (id) => (id === NO_LEAD ? "No lead" : (users.find((u) => u.id === id)?.name ?? "Former member"));
  const projectName = /** @param {string} id */ (id) => systems.find((s) => s.id === id)?.name ?? id;
  const chipLabel = /** @param {Dim} dim @param {string} v */ (dim, v) =>
    dim === "lead"
      ? leadName(v)
      : dim === "project"
        ? projectName(v)
        : dim === "stage"
          ? /** @type {{ key: Stage; label: string; color: string; }} */ (STAGES.find((s) => s.key === v)).label
          : dim === "schedule"
            ? SCHEDULE_META[/** @type {Schedule} */ (v)].label
            : dim === "kind"
              ? KIND_META[/** @type {FeatureKind} */ (v)]
              : v;
  const dimmed = /** @param {Dim} dim @param {string} v */ (dim, v) => f[dim].length > 0 && !/** @type {string[]} */ (f[dim]).includes(v);
  // ----- each chart's data: every filter but its own -----
  const wsView = view("workspace");
  const wsCounts = countBy(wsView.systems, (s) => workspaceOf(s, workspaces), workspaces);
  const stageView = view("stage");
  const stageCounts = countBy(
    stageView.systems,
    stageOf,
    STAGES.map((s) => s.key),
  );
  const schedView = view("schedule");
  const schedRows = workspaces
    .map((w) => ({
      key: w,
      segs: SCHEDULES.map((s) => ({
        key: s.key,
        label: SCHEDULE_META[s.key].label,
        color: s.color,
        n: schedView.systems.filter((x) => workspaceOf(x, workspaces) === w && getSchedule(x, now) === s.key).length,
      })),
    }))
    .filter((r) => r.segs.some((s) => s.n));
  const clientView = view("client");
  const clients = [...new Set(clientView.features.map(clientOf))]
    .map((c) => {
      const of = clientView.features.filter((x) => clientOf(x) === c);
      return { key: c, open: of.filter(isOpen).length, done: of.filter((x) => x.status === "COMPLETED").length, total: of.length };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const kindView = view("kind");
  const kindRows = FEATURE_KINDS.map((kind) => ({
    key: kind,
    segs: PRIORITIES.map((p) => ({ key: p, label: PRIORITY_META[p].label, color: PRIORITY_COLOR[p], n: kindView.features.filter((x) => x.kind === kind && x.priority === p).length })),
  }));
  const leadView = view("lead");
  const leads = [...new Set(leadView.systems.map((s) => s.lead ?? NO_LEAD))]
    .map((id) => {
      const of = leadView.systems.filter((s) => (s.lead ?? NO_LEAD) === id);
      const flying = of.filter((s) => !s.finishedAt);
      return { key: id, n: of.length, avg: flying.length ? Math.round(flying.reduce((n, s) => n + s.progress, 0) / flying.length) : null };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const projView = view("project");
  const tiles = projView.systems.map((s) => ({ key: s.id, value: 1 + projView.features.filter((x) => x.systemId === s.id && isOpen(x)).length, s }));
  const months = lastMonths(now, 12);
  const all = view();
  const monthly = months.map((m) => ({
    key: m,
    created: all.features.filter((x) => x.createdAt.slice(0, 7) === m).length,
    delivered: all.features.filter((x) => x.status === "COMPLETED" && (x.completedAt ?? x.updatedAt).slice(0, 7) === m).length,
  }));
  const chips = /** @type {Dim[]} */ (Object.keys(f)).flatMap((dim) => /** @type {string[]} */ (f[dim]).map((v) => ({ dim, v })));
  return (
    <TooltipLayer>
      <div className="bi">
        {/* On paper only: the letterhead, and what the page was filtered to. */}
        <header className="bi-print-head print-only">
          <div className="bi-print-brand">
            {/* The organisation's letterhead: paper is a light surface. */}
            {currentBranding() && <OrgMark branding={/** @type {import("../../data/branding").BrandingView} */ (currentBranding())} surface="light" size="md" />}
            <span>{currentBranding()?.name ?? ""}</span>
          </div>
          <div className="bi-print-title">
            <h1>Portfolio overview</h1>
            <p>
              Generated {new Date(now).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {chips.length ? `Filtered to ${chips.map((c) => `${DIM_LABEL[c.dim].toLowerCase()}: ${chipLabel(c.dim, c.v)}`).join("; ")}` : "All projects and feature requests"}
            </p>
          </div>
        </header>
        <section className="bi-card bi-slicer" aria-label="Workspace slicer">
          <span className="bi-slicer-title">Workspace</span>
          <div className="bi-tiles">
            {wsCounts.map((w) => (
              <button key={w.key} type="button" className={`bi-tile ${/** @type {string[]} */ (f.workspace).includes(w.key) ? "on" : ""} ${dimmed("workspace", w.key) ? "dim" : ""}`} aria-pressed={/** @type {string[]} */ (f.workspace).includes(w.key)} onClick={() => pick("workspace", w.key)}>
                <b>{w.key}</b>
                <small>
                  {w.n} project{w.n === 1 ? "" : "s"}
                </small>
              </button>
            ))}
          </div>
        </section>

        <div className="bi-filterbar no-print" role="status">
          {chips.length ? (
            <>
              {chips.map((c) => (
                <button key={`${c.dim}:${c.v}`} type="button" className="bi-chip" onClick={() => pick(c.dim, /** @type {never} */ (c.v))} title="Remove this filter">
                  {DIM_LABEL[c.dim]}: <b>{chipLabel(c.dim, c.v)}</b> <X size={13} />
                </button>
              ))}
              <button type="button" className="btn btn-ghost sm" onClick={() => setF(EMPTY_FILTERS)}>
                <FilterX size={14} /> Clear all ({activeCount(f)})
              </button>
            </>
          ) : (
            <span className="bi-hint">
              <MousePointerClick size={14} /> Click any tile, slice or bar to filter the whole page. Click it again to undo.
            </span>
          )}
        </div>

        <section className="bi-kpis" aria-label="Key figures">
          <Kpi value={String(k.projects)} label="Projects" tone="wip" />
          <Kpi value={k.avgProgress === null ? "—" : `${k.avgProgress}%`} label="Average progress, in flight" tone="testing" />
          <Kpi value={String(k.openRequests)} label="Open feature requests" tone="deploy" />
          <Kpi value={pct(k.onTimeRate)} label="Requests delivered on time" tone="live" />
          <Kpi value={String(k.openBlockers)} label={`Open blockers · ${k.overdue} project${k.overdue === 1 ? "" : "s"} overdue`} tone="overdue" />
        </section>

        <div className="bi-grid">
          <Card title="Projects by stage" dim="stage" f={f} onClear={() => setF({ ...f, stage: [] })}>
            <StageDonut rows={stageCounts.map((c) => ({ .../** @type {{ key: Stage; label: string; color: string; }} */ (STAGES.find((s) => s.key === c.key)), n: c.n }))} dimmed={(v) => dimmed("stage", v)} onPick={(v) => pick("stage", /** @type {Stage} */ (v))} />
          </Card>
          <Card title="Schedule by workspace" dim="schedule" f={f} onClear={() => setF({ ...f, schedule: [] })}>
            <Legend items={SCHEDULES.map((s) => ({ label: SCHEDULE_META[s.key].label, color: s.color }))} />
            <StackBars rows={schedRows.map((r) => ({ key: r.key, label: r.key, segs: r.segs }))} unit="project" dimmedSeg={(v) => dimmed("schedule", v)} dimmedRow={(v) => dimmed("workspace", v)} onSeg={(v) => pick("schedule", /** @type {Schedule} */ (v))} onRow={(v) => pick("workspace", v)} />
          </Card>
          <Card title="Feature requests by client" dim="client" f={f} onClear={() => setF({ ...f, client: [] })}>
            <Legend
              items={[
                { label: "Delivered", color: "var(--st-live)" },
                { label: "Still open", color: "var(--st-wip)" },
              ]}
            />
            <StackBars
              rows={clients.map((c) => ({
                key: c.key,
                label: c.key,
                segs: [
                  { key: "done", label: "Delivered", color: "var(--st-live)", n: c.done },
                  { key: "open", label: "Still open", color: "var(--st-wip)", n: c.open },
                ],
              }))}
              unit="request"
              dimmedRow={(v) => dimmed("client", v)}
              onRow={(v) => pick("client", v)}
              onSeg={(_, row) => pick("client", row)}
              empty="No feature requests match these filters."
            />
          </Card>
          <Card title="Requests by type and priority" dim="kind" f={f} onClear={() => setF({ ...f, kind: [] })}>
            <Legend items={PRIORITIES.map((p) => ({ label: PRIORITY_META[p].label, color: PRIORITY_COLOR[p] }))} />
            <StackBars
              rows={kindRows.map((r) => ({ key: r.key, label: KIND_META[r.key], segs: r.segs }))}
              unit="request"
              dimmedRow={(v) => dimmed("kind", v)}
              onRow={(v) => pick("kind", /** @type {FeatureKind} */ (v))}
              onSeg={(_, row) => pick("kind", /** @type {FeatureKind} */ (row))}
              empty="No feature requests match these filters."
            />
          </Card>
          <Card title="Progress by project lead" dim="lead" f={f} onClear={() => setF({ ...f, lead: [] })}>
            <LeadBars rows={leads.map((l) => ({ ...l, label: leadName(l.key) }))} dimmed={(v) => dimmed("lead", v)} onPick={(v) => pick("lead", v)} />
          </Card>
          <Card title="Feature requests over 12 months" wide>
            <Legend
              items={[
                { label: "Came in", color: "var(--st-wip)" },
                { label: "Delivered", color: "var(--st-live)" },
              ]}
            />
            <MonthColumns rows={monthly} />
          </Card>
          <Card title="Portfolio map" dim="project" f={f} onClear={() => setF({ ...f, project: [] })} wide>
            <p className="bi-sub">
              Each project is a tile, sized by its open feature requests and coloured by schedule.<span className="no-print"> Click one to focus the page on it.</span>
            </p>
            <Legend items={SCHEDULES.map((s) => ({ label: SCHEDULE_META[s.key].label, color: s.color }))} />
            <Treemap tiles={tiles} now={now} dimmed={(v) => dimmed("project", v)} onPick={(v) => pick("project", v)} />
          </Card>
        </div>
      </div>
    </TooltipLayer>
  );
}
/**
 * @param {{ value: string; label: string; tone: string }} arg9
 */
function Kpi({ value, label, tone }) {
  return (
    <div className={`bi-kpi tone-${tone}`}>
      <span className="bi-kpi-value">{value}</span>
      <span className="bi-kpi-label">{label}</span>
    </div>
  );
}
/**
 * @param {{ title: string; children: ReactNode; dim?: Dim; f?: BiFilters; onClear?: () => void; wide?: boolean }} props
 */
function Card({ title, children, dim, f, onClear, wide = false }) {
  const n = dim && f ? f[dim].length : 0;
  return (
    <section className={`bi-card ${wide ? "wide" : ""}`}>
      <header className="bi-card-head">
        <h3>{title}</h3>
        {n > 0 && onClear && (
          <button type="button" className="bi-clear no-print" onClick={onClear} title="Clear this chart's filter">
            <FilterX size={14} /> {n}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}
// ---------- donut: projects by stage ----------
/**
 * @param {{ rows: { key: string; label: string; color: string; n: number }[]; dimmed: (v: string) => boolean; onPick: (v: string) => void }} props
 */
function StageDonut({ rows, dimmed, onPick }) {
  const tip = useTip();
  const total = rows.reduce((n, r) => n + r.n, 0);
  const R = 70;
  const W = 24;
  const C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="bi-donut-wrap">
      <svg viewBox="0 0 200 200" className="bi-donut" role="group" aria-label="Projects by stage">
        <circle cx={100} cy={100} r={R} className="viz-donut-track" strokeWidth={W} />
        {total > 0 &&
          rows
            .filter((r) => r.n > 0)
            .map((r) => {
              const len = (r.n / total) * C;
              const gap = rows.filter((x) => x.n > 0).length > 1 ? 2 : 0;
              const el = (
                <circle
                  key={r.key}
                  cx={100}
                  cy={100}
                  r={R}
                  fill="none"
                  strokeWidth={W}
                  style={{ stroke: r.color, opacity: dimmed(r.key) ? 0.25 : 1 }}
                  strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                  strokeDashoffset={-at}
                  transform="rotate(-90 100 100)"
                  className="bi-click"
                  onClick={() => onPick(r.key)}
                  {...tip(
                    <TipRows
                      title={r.label}
                      rows={[
                        ["projects", r.n, r.color],
                        ["of these", `${Math.round((r.n / total) * 100)}%`],
                      ]}
                    />,
                    `${r.label}: ${r.n} projects`,
                  )}
                />
              );
              at += len;
              return el;
            })}
        <text x={100} y={100} textAnchor="middle" className="viz-donut-total">
          {total}
        </text>
        <text x={100} y={120} textAnchor="middle" className="viz-donut-label">
          projects
        </text>
      </svg>
      <ul className="bi-donut-legend">
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" className={`bi-legend-btn ${dimmed(r.key) ? "dim" : ""}`} onClick={() => onPick(r.key)}>
              <i style={{ background: r.color }} />
              {r.label}
              <b>{r.n}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
/**
 * @param {{
 *   rows: { key: string; label: string; segs: Seg[] }[];
 *   unit: string;
 *   dimmedSeg?: (v: string) => boolean;
 *   dimmedRow?: (v: string) => boolean;
 *   onSeg: (seg: string, row: string) => void;
 *   onRow: (row: string) => void;
 *   empty?: string;
 * }} props
 */
function StackBars({ rows, unit, dimmedSeg = () => false, dimmedRow = () => false, onSeg, onRow, empty = "Nothing matches these filters." }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const shown = rows.filter((r) => r.segs.some((s) => s.n));
  if (!shown.length) return <p className="viz-empty">{empty}</p>;
  const ROW = 30;
  const LABEL = Math.min(140, Math.max(90, width * 0.3));
  const END = 34;
  const max = Math.max(1, ...shown.map((r) => r.segs.reduce((n, s) => n + s.n, 0)));
  const scale = /** @param {number} n */ (n) => (n / max) * Math.max(0, width - LABEL - 10 - END - 8);
  const plural = /** @param {number} n */ (n) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={shown.length * ROW} viewBox={`0 0 ${width} ${shown.length * ROW}`} className="viz-svg" role="group">
          {shown.map((r, i) => {
            const y = i * ROW;
            const total = r.segs.reduce((n, s) => n + s.n, 0);
            let x = LABEL + 10;
            const segs = r.segs.filter((s) => s.n > 0);
            return (
              <g key={r.key} style={{ opacity: dimmedRow(r.key) ? 0.3 : 1 }}>
                <text x={0} y={y + 19} className="viz-row-label bi-click" onClick={() => onRow(r.key)}>
                  <title>{r.label}</title>
                  {r.label.length > LABEL / 8.2 ? `${r.label.slice(0, Math.floor(LABEL / 8.2) - 1)}…` : r.label}
                </text>
                {segs.map((s, j) => {
                  const w = scale(s.n);
                  const x0 = x;
                  x += w + (j < segs.length - 1 ? 2 : 0);
                  const last = j === segs.length - 1;
                  return (
                    <path
                      key={s.key}
                      d={bar(x0, y + 6, Math.max(1, w), 18, last)}
                      style={{ fill: s.color, opacity: dimmedSeg(s.key) ? 0.25 : 1 }}
                      className="bi-click"
                      onClick={() => onSeg(s.key, r.key)}
                      {...tip(
                        <TipRows
                          title={`${r.label} · ${s.label}`}
                          rows={[
                            [`${unit}s`, s.n, s.color],
                            [`of ${plural(total)}`, `${Math.round((s.n / total) * 100)}%`],
                          ]}
                        />,
                        `${r.label}, ${s.label}: ${s.n}`,
                      )}
                    />
                  );
                })}
                <text x={x + 6} y={y + 19} className="viz-end-label">
                  {total}
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
function bar(x, y, w, h, roundEnd) {
  const r = roundEnd ? Math.min(4, w / 2, h / 2) : 0;
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}
// ---------- leads: average progress, with how many projects ----------
/**
 * @param {{ rows: { key: string; label: string; n: number; avg: number | null }[]; dimmed: (v: string) => boolean; onPick: (v: string) => void }} arg7
 */
function LeadBars({ rows, dimmed, onPick }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  if (!rows.length) return <p className="viz-empty">No projects match these filters.</p>;
  const ROW = 30;
  const LABEL = Math.min(140, Math.max(90, width * 0.3));
  const END = 92;
  const scale = /** @param {number} p */ (p) => (p / 100) * Math.max(0, width - LABEL - 10 - END);
  return (
    <div ref={ref}>
      <p className="bi-sub">Average progress of each lead's projects still in flight (bar), and how many projects they lead.</p>
      {width > 0 && (
        <svg width={width} height={rows.length * ROW} viewBox={`0 0 ${width} ${rows.length * ROW}`} className="viz-svg" role="group">
          {rows.map((r, i) => {
            const y = i * ROW;
            return (
              <g
                key={r.key}
                className="bi-click"
                style={{ opacity: dimmed(r.key) ? 0.3 : 1 }}
                onClick={() => onPick(r.key)}
                {...tip(
                  <TipRows
                    title={r.label}
                    rows={[
                      ["projects led", r.n],
                      ["average progress", r.avg === null ? "all delivered" : `${r.avg}%`, "var(--st-wip)"],
                    ]}
                  />,
                  `${r.label}: ${r.n} projects`,
                )}
              >
                <rect x={0} y={y} width={width} height={ROW} fill="transparent" />
                <text x={0} y={y + 19} className="viz-row-label">
                  {r.label.length > LABEL / 8.2 ? `${r.label.slice(0, Math.floor(LABEL / 8.2) - 1)}…` : r.label}
                </text>
                <rect x={LABEL + 10} y={y + 8} width={scale(100)} height={14} rx={4} className="bi-track" />
                {r.avg !== null && r.avg > 0 && <path d={bar(LABEL + 10, y + 8, Math.max(2, scale(r.avg)), 14, true)} style={{ fill: "var(--st-wip)" }} />}
                <text x={LABEL + 10 + scale(100) + 8} y={y + 19} className="viz-end-label">
                  {r.avg === null ? "done" : `${r.avg}%`} · {r.n}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
// ---------- monthly columns: came in and delivered side by side (one axis) ----------
/**
 * @param {{ rows: { key: string; created: number; delivered: number }[] }} arg1
 */
function MonthColumns({ rows }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  const H = 190;
  const PAD = { l: 28, b: 22, t: 8 };
  const max = Math.max(1, ...rows.map((r) => Math.max(r.created, r.delivered)));
  const slot = (width - PAD.l) / rows.length;
  const bw = Math.max(3, Math.min(14, slot / 2 - 4));
  const y = /** @param {number} n */ (n) => PAD.t + (1 - n / max) * (H - PAD.t - PAD.b);
  const label = /** @param {string} m */ (m) => MONTH[Number(m.slice(5)) - 1];
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="viz-svg" role="group" aria-label="Feature requests each month">
          {[0, Math.round(max / 2), max].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={width} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">
                {t}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx = PAD.l + i * slot + slot / 2;
            return (
              <g
                key={r.key}
                {...tip(
                  <TipRows
                    title={`${label(r.key)} ${r.key.slice(0, 4)}`}
                    rows={[
                      ["came in", r.created, "var(--st-wip)"],
                      ["delivered", r.delivered, "var(--st-live)"],
                    ]}
                  />,
                  `${r.key}: ${r.created} in, ${r.delivered} delivered`,
                )}
              >
                <rect x={PAD.l + i * slot} y={0} width={slot} height={H} fill="transparent" />
                {r.created > 0 && <path d={col(cx - bw - 1, y(r.created), bw, H - PAD.b - y(r.created))} style={{ fill: "var(--st-wip)" }} />}
                {r.delivered > 0 && <path d={col(cx + 1, y(r.delivered), bw, H - PAD.b - y(r.delivered))} style={{ fill: "var(--st-live)" }} />}
                <text x={cx} y={H - 6} textAnchor="middle" className="viz-axis">
                  {label(r.key)}
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
 * @returns {string}
 */
function col(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
// ---------- treemap: the portfolio ----------
/**
 * @param {{ tiles: { key: string; value: number; s: System }[]; now: number; dimmed: (v: string) => boolean; onPick: (v: string) => void }} arg6
 */
function Treemap({ tiles, now, dimmed, onPick }) {
  const [ref, width] = /** @type {readonly [React.RefObject<HTMLDivElement>, number]} */ (/** @type {unknown} */ (useWidth()));
  const tip = useTip();
  if (!tiles.length) return <p className="viz-empty">No projects match these filters.</p>;
  const H = 300;
  const laid = squarify(tiles, 0, 0, width, H);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="viz-svg" role="group" aria-label="Projects sized by open requests">
          {laid.map((t) => {
            const s = /** @type {{ key: string; value: number; s: System; }} */ (tiles.find((x) => x.key === t.key)).s;
            const sched = getSchedule(s, now);
            const color = /** @type {{ key: Schedule; color: string; }} */ (SCHEDULES.find((x) => x.key === sched)).color;
            const open = t.value - 1;
            return (
              <g
                key={t.key}
                className="bi-click"
                style={{ opacity: dimmed(t.key) ? 0.3 : 1 }}
                onClick={() => onPick(t.key)}
                {...tip(
                  <TipRows
                    title={s.name}
                    rows={[
                      ["open requests", open, color],
                      ["schedule", SCHEDULE_META[sched].label],
                      ["progress", `${s.progress}%`],
                    ]}
                  />,
                  `${s.name}: ${open} open requests, ${SCHEDULE_META[sched].label}`,
                )}
              >
                <rect x={t.x + 1} y={t.y + 1} width={Math.max(0, t.w - 2)} height={Math.max(0, t.h - 2)} rx={4} style={{ fill: color }} />
                {t.w > 60 && t.h > 30 && (
                  <text x={t.x + 8} y={t.y + 18} className="bi-tile-label" style={{ fill: sched === "UNSCHEDULED" ? "var(--st-not-ink)" : "#fff" }}>
                    {s.name.length > t.w / 7.5 ? `${s.name.slice(0, Math.max(3, Math.floor(t.w / 7.5) - 1))}…` : s.name}
                  </text>
                )}
                {t.w > 60 && t.h > 48 && (
                  <text x={t.x + 8} y={t.y + 34} className="bi-tile-sub" style={{ fill: sched === "UNSCHEDULED" ? "var(--st-not-ink)" : "#fff" }}>
                    {open} open · {s.progress}%
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
 * @typedef {Object} Props
 * @property {System[]} systems
 * @property {Feature[]} features
 * @property {Blocker[]} blockers
 * @property {User[]} users
 * @property {string[]} workspaces
 * @property {number} now
 */
/**
 * @typedef {Object} Seg
 * @property {string} key
 * @property {string} label
 * @property {string} color
 * @property {number} n
 */
