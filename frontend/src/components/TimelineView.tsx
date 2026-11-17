import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronRight, Link2, Printer, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import type { User } from "../data/roles";
import { formatDate } from "../time";
import type { TimelineBar, TimelineLink, TimelineProject } from "../data/sprints";
import { TypeIcon, itemHref } from "./WorkItemBits";

type Zoom = "weeks" | "months" | "quarters";
const PX_PER_DAY: Record<Zoom, number> = { weeks: 26, months: 6, quarters: 2.2 };
const ROW = 36;
const DAY = 86_400_000;

interface Row {
  id: string; // item key, or "p:<project id>"
  label: string;
  depth: number;
  start: string | null;
  end: string | null;
  kind: "project" | "item";
  bar?: TimelineBar;
  project?: TimelineProject;
  canEdit: boolean;
  expandable: boolean;
  expanded: boolean;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** A Gantt chart: a project's epics and their work items, or a workspace's projects and their epics. */
export default function TimelineView({ scope, users, now, readOnly }: { scope: { systemId: string } | { workspace: string }; users: User[]; now: number; readOnly: boolean }) {
  const [data, setData] = useState<{ projects: TimelineProject[]; links: TimelineLink[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [zoom, setZoom] = useState<Zoom>("months");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [childrenOf, setChildrenOf] = useState<Record<string, TimelineBar[]>>({});
  const [drag, setDrag] = useState<{ row: Row; mode: "move" | "start" | "end" | "link"; x0: number; dx: number; overKey?: string } | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const workspace = "workspace" in scope;
  const scopeQuery = workspace ? `workspace=${encodeURIComponent(scope.workspace)}` : `system=${encodeURIComponent(scope.systemId)}`;

  const load = useCallback(async () => {
    try {
      const res = await api<{ projects: TimelineProject[]; links: TimelineLink[] }>(`/timeline?${scopeQuery}`);
      setData(res);
      setError("");
      if (!workspace) setOpen((o) => (o.size ? o : new Set(res.projects.flatMap((p) => p.epics.map((e) => e.key)))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the timeline");
    }
  }, [scopeQuery, workspace]);
  useEffect(() => {
    load();
  }, [load]);

  // In a workspace, an epic's work items load when it's opened.
  const expand = async (row: Row) => {
    const next = new Set(open);
    if (next.has(row.id)) next.delete(row.id);
    else {
      next.add(row.id);
      if (workspace && row.bar && !childrenOf[row.id]) {
        try {
          const res = await api<{ projects: TimelineProject[] }>(`/timeline?system=${encodeURIComponent(row.bar.systemId)}`);
          const epic = res.projects[0]?.epics.find((e) => e.key === row.id);
          setChildrenOf((c) => ({ ...c, [row.id]: epic?.children ?? [] }));
        } catch {
          setChildrenOf((c) => ({ ...c, [row.id]: [] }));
        }
      }
    }
    setOpen(next);
  };

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    const item = (b: TimelineBar, depth: number, expandable: boolean): Row => ({
      id: b.key,
      label: b.summary,
      depth,
      start: b.start,
      end: b.end,
      kind: "item",
      bar: b,
      canEdit: b.canEdit && !readOnly && !b.derived,
      expandable,
      expanded: open.has(b.key),
    });
    for (const p of data.projects) {
      const pid = `p:${p.id}`;
      if (workspace) out.push({ id: pid, label: `${p.key} · ${p.name}`, depth: 0, start: p.start, end: p.end, kind: "project", project: p, canEdit: p.canEdit && !readOnly, expandable: p.epics.length > 0, expanded: open.has(pid) });
      if (workspace && !open.has(pid)) continue;
      const base = workspace ? 1 : 0;
      for (const e of p.epics) {
        const kids = workspace ? (childrenOf[e.key] ?? []) : (e.children ?? []);
        out.push(item(e, base, workspace || kids.length > 0));
        if (open.has(e.key)) for (const k of kids) out.push(item(k, base + 1, false));
      }
      if (!workspace) for (const l of p.loose) out.push(item(l, 0, false));
    }
    return out;
  }, [data, open, childrenOf, workspace, readOnly]);

  // The calendar: from the earliest start to the latest end, with room either side, and today in view.
  const ppd = PX_PER_DAY[zoom];
  const { from, days } = useMemo(() => {
    const dates = rows.flatMap((r) => [r.start, r.end]).filter((d): d is string => !!d).map(t);
    const today = t(iso(now));
    const lo = Math.min(today - 14 * DAY, ...dates) - 7 * DAY;
    const hi = Math.max(today + 60 * DAY, ...dates) + 21 * DAY;
    return { from: lo, days: Math.round((hi - lo) / DAY) };
  }, [rows, now]);
  const x = (d: string) => ((t(d) - from) / DAY) * ppd;
  const width = days * ppd;

  // Header ticks: each week, month or quarter.
  const ticks = useMemo(() => {
    const out: { at: number; label: string }[] = [];
    const d = new Date(from);
    d.setUTCDate(1);
    for (let k = 0; k < 60; k++) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
      if (m.getTime() > from + days * DAY) break;
      if (zoom === "quarters" && m.getUTCMonth() % 3) continue;
      out.push({
        at: ((m.getTime() - from) / DAY) * ppd,
        label: zoom === "quarters" ? `Q${Math.floor(m.getUTCMonth() / 3) + 1} ${m.getUTCFullYear()}` : m.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
      });
    }
    if (zoom === "weeks") {
      const weeks: { at: number; label: string }[] = [];
      const start = new Date(from);
      start.setUTCDate(start.getUTCDate() + ((8 - start.getUTCDay()) % 7));
      for (let w = start.getTime(); w < from + days * DAY; w += 7 * DAY) weeks.push({ at: ((w - from) / DAY) * ppd, label: new Date(w).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) });
      return weeks;
    }
    return out;
  }, [from, days, ppd, zoom]);

  const save = async (row: Row, start: string | null, end: string | null) => {
    setError("");
    setNotice("");
    if (start && end && start > end) return setError("The start must be on or before the end");
    try {
      if (row.kind === "project") await api(`/systems/${row.project!.id}`, "PATCH", { startedAt: start, dueAt: end ? `${end}T17:00:00` : null });
      else await api(`/items/${row.id}`, "PATCH", { startDate: start, dueDate: end });
      setNotice(`${row.kind === "project" ? row.project!.name : row.id}: ${start ? formatDate(start) : "no start"} to ${end ? formatDate(end) : "no end"}.`);
      await load();
      if (workspace) setChildrenOf({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the dates");
    }
  };

  const link = async (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    try {
      await api(`/items/${fromKey}/links`, "POST", { type: "BLOCKS", target: toKey });
      setNotice(`${fromKey} now blocks ${toKey}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that dependency");
    }
  };

  // Dragging: move a bar, stretch an end, or draw a dependency from a bar's link dot to another bar.
  const shift = (d: string | null, by: number) => (d ? iso(t(d) + by * DAY) : d);
  const preview = (r: Row) => {
    if (!drag || drag.row.id !== r.id || drag.mode === "link") return { start: r.start, end: r.end };
    const by = Math.round(drag.dx / ppd);
    if (drag.mode === "move") return { start: shift(r.start, by), end: shift(r.end, by) };
    if (drag.mode === "start") return { start: shift(r.start, by), end: r.end };
    return { start: r.start, end: shift(r.end, by) };
  };
  const scroller = useRef<HTMLDivElement>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-bar]") as HTMLElement | null;
      setDrag((d) => (d ? { ...d, dx: e.clientX - d.x0, overKey: el?.dataset.bar } : d));
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.mode === "link") {
        if (d.overKey && d.overKey !== d.row.id && !d.overKey.startsWith("p:")) link(d.row.id, d.overKey);
        return;
      }
      const by = Math.round(d.dx / ppd);
      if (!by) return;
      const r = d.row;
      save(r, d.mode === "end" ? r.start : shift(r.start, by), d.mode === "start" ? r.end : shift(r.end, by));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag?.row.id, drag?.mode]);

  const startDrag = (e: ReactPointerEvent, row: Row, mode: "move" | "start" | "end" | "link") => {
    if (!row.canEdit && mode !== "link") return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({ row, mode, x0: e.clientX, dx: 0 });
  };

  if (error && !data) return <p className="form-error banner">{error}</p>;
  if (!data) return <p className="lead-none">Loading the timeline…</p>;
  const index = new Map(rows.map((r, i) => [r.id, i]));
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  const todayX = x(iso(now));
  const warnings = data.links.filter((l) => l.warning);

  return (
    <div className="timeline-wrap">
      <div className="board-bar no-print">
        <div className="seg sm" role="radiogroup" aria-label="Zoom">
          {(["weeks", "months", "quarters"] as Zoom[]).map((z) => (
            <button key={z} role="radio" aria-checked={zoom === z} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost sm" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, todayX - 200), behavior: "smooth" })}>
          <CalendarDays size={14} /> Today
        </button>
        <span className="muted tl-help">{readOnly ? "View only." : "Drag a bar to move it, its ends to change dates, or its dot onto another bar to say it blocks that one."}</span>
        <button className="btn btn-navy sm" onClick={() => window.print()}>
          <Printer size={14} /> Print / PDF
        </button>
      </div>
      {error && <p className="form-error banner">{error}</p>}
      {notice && (
        <p className="board-notice" role="status">
          {notice}
          <button className="icon-link" onClick={() => setNotice("")} aria-label="Dismiss">
            <X size={14} />
          </button>
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="tl-warnings" role="status" aria-label="Dependency warnings">
          {warnings.map((l) => (
            <li key={l.id}>
              <AlertTriangle size={14} /> {l.warning}
            </li>
          ))}
        </ul>
      )}

      <div className="tl">
        <div className="tl-labels" style={{ paddingTop: ROW }}>
          {rows.map((r) => (
            <div key={r.id} className={`tl-label depth-${r.depth}`} style={{ height: ROW }}>
              {r.expandable ? (
                <button className="icon-link" onClick={() => expand(r)} aria-expanded={r.expanded} aria-label={`${r.expanded ? "Collapse" : "Expand"} ${r.label}`}>
                  {r.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : (
                <span className="tl-spacer" />
              )}
              {r.bar && <TypeIcon type={r.bar.type} size={12} />}
              {r.kind === "item" ? (
                <a href={itemHref(r.bar!.systemId, r.id)} className="tl-name" title={r.label}>
                  <span className="mono">{r.id}</span> {r.label}
                </a>
              ) : (
                <a href={`#/projects/${r.project!.id}`} className="tl-name tl-project" title={r.label}>
                  {r.label}
                </a>
              )}
              {r.canEdit && (
                <button className="icon-link no-print" onClick={() => setEditing(r)} aria-label={`Change dates for ${r.kind === "item" ? r.id : r.label}`} title="Change dates">
                  <CalendarDays size={13} />
                </button>
              )}
            </div>
          ))}
          {!rows.length && <p className="lead-none">Nothing to show yet. Give epics and work items a start and due date to see them here.</p>}
        </div>
        <div className="tl-scroll" ref={scroller}>
          <div className="tl-canvas" style={{ width, height: ROW * (rows.length + 1) }}>
            <div className="tl-ticks" style={{ height: ROW }}>
              {ticks.map((k) => (
                <span key={k.at} style={{ left: k.at }}>
                  {k.label}
                </span>
              ))}
            </div>
            {ticks.map((k) => (
              <i key={`g${k.at}`} className="tl-grid" style={{ left: k.at, top: ROW }} />
            ))}
            <i className="tl-today" style={{ left: todayX }} aria-hidden="true">
              <span>Today</span>
            </i>
            {rows.map((r, i) => {
              const p = preview(r);
              const top = ROW * (i + 1) + 7;
              if (!p.start && !p.end) {
                return (
                  <span key={r.id} className="tl-nodates" style={{ top, left: Math.max(4, todayX - 60) }}>
                    No dates
                  </span>
                );
              }
              const s = p.start ?? p.end!;
              const e = p.end ?? p.start!;
              const left = x(s);
              const w = Math.max(ppd, x(e) - left + ppd);
              const cls = r.kind === "project" ? "tl-bar-project" : r.bar!.type === "EPIC" ? "tl-bar-epic" : `tl-bar-${r.bar!.statusCategory.toLowerCase()}`;
              return (
                <div
                  key={r.id}
                  data-bar={r.id}
                  className={`tl-bar ${cls} ${r.bar?.derived ? "derived" : ""} ${drag?.overKey === r.id && drag.mode === "link" ? "link-target" : ""} ${r.canEdit ? "editable" : ""}`}
                  style={{ top, left, width: w }}
                  onPointerDown={(ev) => startDrag(ev, r, "move")}
                  title={`${r.kind === "item" ? `${r.id} ` : ""}${r.label}: ${p.start ? formatDate(p.start) : "?"} to ${p.end ? formatDate(p.end) : "?"}${r.bar?.assignee ? ` · ${name(r.bar.assignee) ?? ""}` : ""}${r.bar?.derived ? " (from its work items)" : ""}`}
                  role="img"
                  aria-label={`${r.kind === "item" ? r.id : ""} ${r.label}, ${p.start ? formatDate(p.start) : "no start"} to ${p.end ? formatDate(p.end) : "no end"}`}
                >
                  {r.canEdit && <span className="tl-handle start" onPointerDown={(ev) => startDrag(ev, r, "start")} />}
                  <span className="tl-bar-text">{r.kind === "item" ? r.id : r.project!.key}</span>
                  {r.canEdit && <span className="tl-handle end" onPointerDown={(ev) => startDrag(ev, r, "end")} />}
                  {r.kind === "item" && !readOnly && <span className="tl-link-dot no-print" onPointerDown={(ev) => startDrag(ev, r, "link")} title="Drag onto another bar: this blocks that" />}
                </div>
              );
            })}
            <svg className="tl-links" width={width} height={ROW * (rows.length + 1)} aria-hidden="true">
              {data.links.map((l) => {
                const a = index.get(l.from);
                const b = index.get(l.to);
                if (a === undefined || b === undefined) return null;
                const ra = rows[a];
                const rb = rows[b];
                const ea = preview(ra).end ?? preview(ra).start;
                const sb = preview(rb).start ?? preview(rb).end;
                if (!ea || !sb) return null;
                const x1 = x(ea) + ppd;
                const y1 = ROW * (a + 1) + ROW / 2;
                const x2 = x(sb);
                const y2 = ROW * (b + 1) + ROW / 2;
                const mid = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
                return <path key={l.id} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} className={`tl-dep ${l.warning ? "warn" : ""}`} markerEnd="url(#tl-arrow)" />;
              })}
              <defs>
                <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="tl-arrow" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      {data.links.length > 0 && (
        <details className="tl-deps">
          <summary>
            <Link2 size={14} /> Dependencies ({data.links.length})
          </summary>
          <ul>
            {data.links.map((l) => (
              <li key={l.id} className={l.warning ? "warn" : ""}>
                <b className="mono">{l.from}</b> blocks <b className="mono">{l.to}</b>
                {l.warning && <small> · {l.warning}</small>}
                {!readOnly && (
                  <button
                    className="icon-link"
                    onClick={async () => {
                      try {
                        await api(`/items/${l.from}/links/${l.id}`, "DELETE");
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Couldn't remove it");
                      }
                    }}
                    aria-label={`Remove: ${l.from} blocks ${l.to}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <DatesDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={async (s, e) => {
            await save(editing, s, e);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Start and end dates for one bar, typed: the keyboard way to change a bar. */
function DatesDialog({ row, onClose, onSave }: { row: Row; onClose: () => void; onSave: (start: string | null, end: string | null) => Promise<void> }) {
  const [start, setStart] = useState(row.start ?? "");
  const [end, setEnd] = useState(row.end ?? "");
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Dates for ${row.label}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(start || null, end || null);
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{row.kind === "item" ? `${row.id} ${row.label}` : row.label}</h2>
        <div className="field-row">
          <label className="field">
            <span>{row.kind === "project" ? "Started" : "Start date"}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} autoFocus required={row.kind === "project"} />
          </label>
          <label className="field">
            <span>{row.kind === "project" ? "Due" : "Due date"}</span>
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Save dates
          </button>
        </div>
      </form>
    </div>
  );
}
