import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { initials, type System } from "../data/systems";
import type { User } from "../data/roles";
import { formatDate } from "../time";
import { MAX_WEEKS, MIN_WEEKS, daysLeft, sprintEnd, type BacklogData, type SprintWithItems } from "../data/sprints";
import type { WorkItemSummary } from "../data/workitems";
import { ItemPriority, ItemStatusPill, TypeIcon, itemHref } from "./WorkItemBits";

interface Props {
  system: System;
  users: User[];
  now: number;
  readOnly: boolean;
  canEditPoints: boolean; // may change story points on any item (edit any work item)
  onChanged: () => Promise<void>;
}

const points = (list: WorkItemSummary[]) => list.reduce((n, i) => n + (i.storyPoints ?? 0), 0);

/** A Scrum project's backlog: open sprints, then the ranked backlog. Drag items, or use each row's controls. */
export default function BacklogView({ system, users, now, readOnly, canEditPoints, onChanged }: Props) {
  const [data, setData] = useState<BacklogData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragKeys, setDragKeys] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SprintWithItems | null>(null);
  const [completing, setCompleting] = useState<SprintWithItems | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<BacklogData>(`/backlog?system=${encodeURIComponent(system.id)}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the backlog");
    }
  }, [system.id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  };

  /** Moves items to a sprint (or the backlog), just above `before` or at the end. */
  const place = (keys: string[], target: string, before?: string) =>
    act(
      () => api("/backlog/rank", "POST", { system: system.id, keys, target, ...(before && !keys.includes(before) ? { before } : {}) }),
      `${keys.length === 1 ? keys[0] : `${keys.length} items`} moved${target === "backlog" ? " to the backlog" : ` to ${data?.sprints.find((s) => s.id === target)?.name ?? "the sprint"}`}.`,
    ).then(() => setSelected(new Set()));

  if (error && !data) return <p className="form-error banner">{error}</p>;
  if (!data) return <p className="lead-none">Loading the backlog…</p>;
  if (data.mode !== "scrum")
    return <div className="empty">This project works in Kanban. Turn on sprints in its Work items tab to plan with a backlog.</div>;

  const can = data.canPlan && !readOnly;
  const active = data.sprints.find((s) => s.state === "ACTIVE");
  const all = [...data.sprints.flatMap((s) => s.items), ...data.backlog];
  const picked = all.filter((i) => selected.has(i.key));
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  const toggle = (key: string) => setSelected((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const targets = [...data.sprints.map((s) => ({ id: s.id, name: s.name })), { id: "backlog", name: "Backlog" }];

  const list = (items: WorkItemSummary[], target: string, sprintState?: string) => (
    <ol
      className={`backlog-list ${dragKeys ? "dropping" : ""}`}
      onDragOver={(e: DragEvent) => {
        if (dragKeys && can) e.preventDefault();
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        if (dragKeys) place(dragKeys, target);
        setDragKeys(null);
      }}
      aria-label={`${targets.find((t) => t.id === target)?.name}: ${items.length} item${items.length === 1 ? "" : "s"}`}
    >
      {items.map((i, idx) => (
        <li
          key={i.id}
          className={`backlog-row ${selected.has(i.key) ? "picked" : ""}`}
          draggable={can}
          onDragStart={(e) => {
            const keys = selected.has(i.key) ? [...selected] : [i.key];
            e.dataTransfer.setData("text/plain", keys.join(","));
            setDragKeys(keys);
          }}
          onDragEnd={() => setDragKeys(null)}
          onDragOver={(e: DragEvent) => {
            if (dragKeys && can) e.preventDefault();
          }}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragKeys) place(dragKeys, target, i.key);
            setDragKeys(null);
          }}
        >
          {can && <GripVertical size={14} className="backlog-grip" aria-hidden="true" />}
          <input type="checkbox" checked={selected.has(i.key)} onChange={() => toggle(i.key)} aria-label={`Select ${i.key}`} />
          <TypeIcon type={i.type} size={13} />
          <a href={itemHref(system.id, i.key)} className="mono backlog-key">
            {i.key}
          </a>
          <span className="backlog-summary">{i.summary}</span>
          <ItemPriority priority={i.priority} />
          <ItemStatusPill item={i} />
          <span className="avatar sm" title={name(i.assignee) ?? "Unassigned"} aria-label={name(i.assignee) ? `Assigned to ${name(i.assignee)}` : "Unassigned"}>
            {i.assignee ? initials(name(i.assignee) ?? "?") : "–"}
          </span>
          <PointsInput item={i} editable={!readOnly && canEditPoints} onSaved={load} onError={setError} />
          {can && (
            <span className="backlog-controls">
              <button className="icon-link" disabled={idx === 0} onClick={() => place([i.key], target, items[idx - 1]?.key)} aria-label={`Move ${i.key} up`}>
                <ArrowUp size={14} />
              </button>
              <button className="icon-link" disabled={idx === items.length - 1} onClick={() => place([i.key], target, items[idx + 2]?.key)} aria-label={`Move ${i.key} down`}>
                <ArrowDown size={14} />
              </button>
              <select value="" onChange={(e) => e.target.value && place([i.key], e.target.value)} aria-label={`Move ${i.key} to a sprint or the backlog`}>
                <option value="">Move to…</option>
                {targets
                  .filter((t) => t.id !== target)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </span>
          )}
        </li>
      ))}
      {!items.length && <li className="backlog-empty">{sprintState === "ACTIVE" ? "Nothing in this sprint." : can ? "Drag work items here, or use their Move to… list." : "Empty."}</li>}
    </ol>
  );

  return (
    <div className="backlog">
      <div className="backlog-bar">
        {data.velocity.average != null ? (
          <span className="backlog-velocity" title={data.velocity.recent.map((r) => `${r.name}: ${r.completed} of ${r.committed}`).join("; ")}>
            Average velocity: <b>{data.velocity.average}</b> points a sprint (last {Math.min(3, data.velocity.recent.length)})
          </span>
        ) : (
          <span className="muted">No finished sprints yet, so no velocity to plan by.</span>
        )}
        {picked.length > 0 && (
          <span className="backlog-picked" role="status">
            {picked.length} selected · <b>{points(picked)}</b> points
            {can && (
              <select value="" onChange={(e) => e.target.value && place([...selected], e.target.value)} aria-label="Move the selected items">
                <option value="">Move selected to…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button className="link-btn" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </span>
        )}
        {can && (
          <button className="btn btn-ghost sm backlog-new" onClick={() => setCreating(true)}>
            <Plus size={14} strokeWidth={3} /> New sprint
          </button>
        )}
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

      {data.sprints.map((s) => {
        const planned = s.points;
        const over = s.state === "FUTURE" && data.velocity.average != null && planned > data.velocity.average;
        return (
          <section key={s.id} className={`sprint-panel ${s.state === "ACTIVE" ? "active" : ""}`} aria-label={s.name}>
            <header className="sprint-head">
              <div>
                <h3>
                  {s.name} {s.state === "ACTIVE" && <span className="pill sm fill-cyan">Running</span>}
                </h3>
                <p className="muted">
                  {formatDate(s.startDate)} – {formatDate(s.endDate)} · {s.lengthWeeks} week{s.lengthWeeks === 1 ? "" : "s"}
                  {s.state === "ACTIVE" ? ` · ${daysLeft(s.endDate, now)} days left` : ""}
                  {s.goal ? ` · Goal: ${s.goal}` : ""}
                </p>
              </div>
              <div className="sprint-figures">
                <span>
                  <b>{s.items.length}</b> items · <b>{planned}</b> points{s.state === "ACTIVE" ? ` · ${s.donePoints} done` : ""}
                </span>
                {s.state === "FUTURE" && data.velocity.average != null && (
                  <small className={over ? "sprint-over" : "muted"}>
                    {over ? `More than your average of ${data.velocity.average}` : `Room for about ${Math.max(0, Math.round((data.velocity.average - planned) * 10) / 10)} more, by past velocity`}
                  </small>
                )}
              </div>
              {can && (
                <div className="page-actions">
                  {s.state === "FUTURE" && (
                    <button className="btn btn-navy sm" disabled={!!active} title={active ? `Complete ${active.name} first` : undefined} onClick={() => act(() => api(`/sprints/${s.id}/start`, "POST", {}), `${s.name} has started.`)}>
                      <Play size={14} /> Start sprint
                    </button>
                  )}
                  {s.state === "ACTIVE" && (
                    <button className="btn btn-amber sm" onClick={() => setCompleting(s)}>
                      <Square size={13} /> Complete sprint
                    </button>
                  )}
                  <button className="icon-link" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                    <Pencil size={14} />
                  </button>
                  {s.state === "FUTURE" && (
                    <button
                      className="icon-link danger-text"
                      onClick={() => window.confirm(`Delete ${s.name}? Its items go back to the backlog.`) && act(() => api(`/sprints/${s.id}`, "DELETE"), `${s.name} deleted.`)}
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </header>
            {list(s.items, s.id, s.state)}
          </section>
        );
      })}

      <section className="sprint-panel" aria-label="Backlog">
        <header className="sprint-head">
          <div>
            <h3>Backlog</h3>
            <p className="muted">Highest first. {data.backlogTotal > data.backlog.length ? `Showing the top ${data.backlog.length} of ${data.backlogTotal}.` : `${data.backlogTotal} items.`}</p>
          </div>
          <div className="sprint-figures">
            <b>{points(data.backlog)}</b> points
          </div>
        </header>
        {list(data.backlog, "backlog")}
      </section>

      {(creating || editing) && (
        <SprintForm
          sprint={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (b) => {
            const ok = await act(() => (editing ? api(`/sprints/${editing.id}`, "PATCH", b) : api("/sprints", "POST", { systemId: system.id, ...b })), editing ? "Sprint saved." : "Sprint created.");
            if (ok) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}
      {completing && (
        <CompleteSprint
          sprint={completing}
          future={data.sprints.filter((s) => s.state === "FUTURE")}
          onClose={() => setCompleting(null)}
          onComplete={async (moveTo) => {
            const ok = await act(() => api(`/sprints/${completing.id}/complete`, "POST", { moveTo }), `${completing.name} is complete.`);
            if (ok) {
              setCompleting(null);
              await onChanged();
            }
          }}
        />
      )}
    </div>
  );
}

/** Story points, typed in place. */
function PointsInput({ item, editable, onSaved, onError }: { item: WorkItemSummary; editable: boolean; onSaved: () => Promise<void>; onError: (m: string) => void }) {
  const [v, setV] = useState(item.storyPoints != null ? String(item.storyPoints) : "");
  useEffect(() => setV(item.storyPoints != null ? String(item.storyPoints) : ""), [item.storyPoints]);
  if (!editable) return <span className="backlog-points">{item.storyPoints ?? "–"}</span>;
  const save = async () => {
    const next = v.trim() === "" ? null : Number(v);
    if ((next ?? null) === (item.storyPoints ?? null)) return;
    try {
      await api(`/items/${item.key}`, "PATCH", { storyPoints: next });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save the points");
      setV(item.storyPoints != null ? String(item.storyPoints) : "");
    }
  };
  return (
    <input
      className="backlog-points"
      type="number"
      min={0}
      max={999}
      step={0.5}
      inputMode="decimal"
      value={v}
      placeholder="–"
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      aria-label={`Story points for ${item.key}`}
    />
  );
}

function SprintForm({ sprint, onClose, onSave }: { sprint: SprintWithItems | null; onClose: () => void; onSave: (b: { name: string; goal: string; startDate: string; lengthWeeks: number }) => Promise<void> }) {
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [start, setStart] = useState(sprint?.startDate ?? new Date().toISOString().slice(0, 10));
  const [weeks, setWeeks] = useState(sprint?.lengthWeeks ?? 2);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ name, goal, startDate: start, lengthWeeks: weeks });
  };
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-label={sprint ? `Edit ${sprint.name}` : "New sprint"} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{sprint ? `Edit ${sprint.name}` : "New sprint"}</h2>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank for the next number" maxLength={80} autoFocus />
        </label>
        <label className="field">
          <span>Goal</span>
          <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What this sprint is for, in a sentence" maxLength={500} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Starts</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required disabled={sprint?.state === "ACTIVE"} />
          </label>
          <label className="field">
            <span>Length</span>
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} disabled={sprint?.state === "ACTIVE"}>
              {Array.from({ length: MAX_WEEKS - MIN_WEEKS + 1 }, (_, i) => i + MIN_WEEKS).map((w) => (
                <option key={w} value={w}>
                  {w} week{w === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-hint">Ends on {formatDate(sprintEnd(start, weeks))}.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            {sprint ? "Save" : "Create sprint"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CompleteSprint({ sprint, future, onClose, onComplete }: { sprint: SprintWithItems; future: SprintWithItems[]; onClose: () => void; onComplete: (moveTo: string) => Promise<void> }) {
  const open = sprint.items.filter((i) => i.statusCategory !== "DONE");
  const [moveTo, setMoveTo] = useState(future[0]?.id ?? "next");
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Complete ${sprint.name}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onComplete(moveTo);
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Complete {sprint.name}</h2>
        <p>
          {sprint.items.length - open.length} of {sprint.items.length} items are done ({sprint.donePoints} of {sprint.points} points). Pulse keeps a snapshot of the sprint
          for the velocity and sprint reports.
        </p>
        {open.length > 0 && (
          <label className="field">
            <span>
              The {open.length} unfinished item{open.length === 1 ? "" : "s"} move to
            </span>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="backlog">The backlog</option>
              {future.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {!future.length && <option value="next">A new next sprint</option>}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Complete sprint
          </button>
        </div>
      </form>
    </div>
  );
}
