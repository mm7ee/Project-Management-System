/** @import { DragEvent } from 'react' */
/** @import { User } from '../data/roles' */
/** @import { ItemMove, WorkItem, WorkItemSummary } from '../data/workitems' */
/** @import { StatusDef, Swimlanes, Workflow } from '../data/workflows' */
/** @import { PendingMove } from './MoveDialog' */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, ArrowDown, ArrowUp, CalendarClock, Plus, Settings2, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { initials } from "../data/systems";
import { formatDate } from "../time";
import { WORK_PRIORITY_META, isDone } from "../data/workitems";
import { CATEGORY_META, SWIMLANES, SWIMLANE_LABEL, checkTransition, transitionsFrom } from "../data/workflows";
import MoveDialog from "./MoveDialog";
import { ItemPriority, TypeIcon, itemHref } from "./WorkItemBits";
import { CustomFieldChips } from "./WorkItemExtras";
/**
 * A Kanban board: a project's, or a workspace's across its projects. Moving a card makes a workflow move.
 * @param {Props} props
 */
export default function BoardView({ scope, users, me, now, readOnly, canAssignOthers }) {
  const [data, setData] = useState(/** @type {BoardData | null | (() => BoardData | null)} */ (null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mine, setMine] = useState(false);
  const [bugs, setBugs] = useState(false);
  const [dueWeek, setDueWeek] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [label, setLabel] = useState("");
  const [lanes, setLanes] = useState(/** @type {Swimlanes | null | (() => Swimlanes | null)} */ (null));
  const [dragging, setDragging] = useState(/** @type {Card | null | (() => Card | null)} */ (null));
  const [busyKey, setBusyKey] = useState("");
  const [pending, setPending] = useState(/** @type {PendingMove | null | (() => PendingMove | null)} */ (null));
  const [configuring, setConfiguring] = useState(false);
  const scopeKey = "systemId" in scope ? `system=${encodeURIComponent(scope.systemId)}` : `workspace=${encodeURIComponent(scope.workspace)}`;
  const [debouncedLabel, setDebouncedLabel] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLabel(label.trim()), 300);
    return () => clearTimeout(t);
  }, [label]);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    const q = new URLSearchParams();
    if (mine) q.set("mine", "1");
    if (bugs) q.set("type", "BUG");
    if (dueWeek) q.set("due", "week");
    if (blocked) q.set("blocked", "1");
    if (debouncedLabel) q.set("label", debouncedLabel);
    try {
      const res = await /** @type {Promise<BoardData>} */ (/** @type {unknown} */ (api(`/boards?${scopeKey}&${q}`)));
      if (ticket === latest.current) {
        setData(res);
        setError("");
      }
    } catch (e) {
      if (ticket === latest.current) setError(e instanceof Error ? e.message : "Couldn't load the board");
    }
  }, [scopeKey, mine, bugs, dueWeek, blocked, debouncedLabel]);
  useEffect(() => {
    load();
  }, [load]);
  const statusName = useMemo(() => new Map((data?.statuses ?? []).map((s) => [s.id, s])), [data]);
  const workflowOf = /** @param {Card} card */ (card) => data?.workflows.find((w) => w.id === data.projectWorkflow[card.systemId]);
  const columnOf = /** @param {string} status */ (status) => data?.board?.columns.find((col) => col.statuses.includes(status));
  /** Columns this card may move to: a move this person may make lands in one of the column's statuses. */
  const reachable = /** @param {Card} card @param {BoardColumn} col */ (card, col) => {
    const wf = workflowOf(card);
    if (!wf || col.statuses.includes(card.status)) return false;
    return transitionsFrom(wf, card.status).some((t) => col.statuses.includes(t.to) && checkTransition(t, { ...card, reporter: card.reporter }, me).allowed);
  };
  /** Moves a card into a column: asks the server which moves it may make, then makes the first that lands there. */
  const moveTo = /** @param {Card} card @param {BoardColumn} col */ async (card, col) => {
    setNotice("");
    if (col.statuses.includes(card.status)) return;
    setBusyKey(card.key);
    try {
      const moves = await /** @type {Promise<Array<ItemMove>>} */ (/** @type {unknown} */ (api(`/items/${card.key}/transitions`)));
      const into = moves.filter((mv) => col.statuses.includes(mv.to));
      const mv = into.find((x) => x.allowed);
      if (!mv) {
        const why = into[0]?.reason ?? `the workflow has no move from ${card.statusName} to ${col.name}`;
        setNotice(`${card.key} stayed in ${columnOf(card.status)?.name ?? card.statusName}: ${why}.`);
        return;
      }
      if (mv.needs.comment || mv.needs.assignee || mv.needs.fields.length) {
        setPending({ itemKey: card.key, transitionId: mv.transitionId, name: mv.name, toName: mv.toName, needs: mv.needs, source: card.source });
        return;
      }
      await /** @type {Promise<WorkItem>} */ (/** @type {unknown} */ (api(`/items/${card.key}/transitions`, "POST", { transitionId: mv.transitionId })));
      setNotice(`${card.key} moved to ${mv.toName}.`);
      await load();
    } catch (e) {
      setNotice(`${card.key} stayed where it was: ${e instanceof Error ? e.message : "the move failed"}.`);
      await load();
    } finally {
      setBusyKey("");
    }
  };
  if (error) return <p className="form-error banner">{error}</p>;
  if (!data) return <p className="lead-none">Loading the board…</p>;
  if (!data.board) return <div className="empty">This board hasn't been set up yet.</div>;
  const board = data.board;
  const swim = lanes ?? board.swimlanes;
  const name = /** @param {string} [id] */ (id) => users.find((u) => u.id === id)?.name;
  // Swimlanes: groups of cards across every column.
  const laneOf = /** @param {Card} c @returns {{ key: string; label: string }} */ (c) => {
    if (swim === "assignee") return c.assignee ? { key: c.assignee, label: name(c.assignee) ?? "Former user" } : { key: "~", label: "Unassigned" };
    if (swim === "epic") return c.epic ? { key: c.epic.key, label: `${c.epic.key} ${c.epic.summary}` } : { key: "~", label: "No epic" };
    if (swim === "priority") return { key: String(WORK_PRIORITY_META[c.priority].rank), label: WORK_PRIORITY_META[c.priority].label };
    return { key: "", label: "" };
  };
  const laneList = [...new Map(data.cards.map((c) => [laneOf(c).key, laneOf(c)])).values()].sort((a, b) => (swim === "priority" ? a.key.localeCompare(b.key) : a.key === "~" ? 1 : b.key === "~" ? -1 : a.label.localeCompare(b.label)));
  if (swim === "priority") laneList.sort((a, b) => Number(a.key) - Number(b.key));
  const lanesToShow = swim === "none" ? [{ key: "", label: "" }] : laneList;
  const filtersOn = mine || bugs || dueWeek || blocked || !!label;
  const unmappedNames = data.unmapped.map((id) => statusName.get(id)?.name ?? id);
  return (
    <div className="board-wrap">
      <div className="board-bar" role="group" aria-label="Board filters">
        {/** @type {const} */ ([
          ["Only my items", mine, setMine],
          ["Bugs", bugs, setBugs],
          ["Due this week", dueWeek, setDueWeek],
          ["Blocked", blocked, setBlocked],
        ]).map(([l, on, set]) => (
          <button key={l} className={`toggle-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set(!on)}>
            {l}
          </button>
        ))}
        <input className={`wi-label-filter ${label ? "set" : ""}`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Show cards with this label" />
        <select value={swim} onChange={(e) => setLanes(/** @type {Swimlanes} */ (e.target.value))} aria-label="Swimlanes">
          {SWIMLANES.map((s) => (
            <option key={s} value={s}>
              {SWIMLANE_LABEL[s]}
            </option>
          ))}
        </select>
        {filtersOn && (
          <button
            className="link-btn"
            onClick={() => {
              setMine(false);
              setBugs(false);
              setDueWeek(false);
              setBlocked(false);
              setLabel("");
            }}
          >
            Clear filters
          </button>
        )}
        {data.canConfigure && !readOnly && (
          <button className="btn btn-ghost sm board-config-btn" onClick={() => setConfiguring(true)}>
            <Settings2 size={15} /> Columns
          </button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      {notice && (
        <p className="board-notice" role="status">
          {notice}
          <button className="icon-link" onClick={() => setNotice("")} aria-label="Dismiss">
            <X size={14} />
          </button>
        </p>
      )}
      {data.scrum && (
        <p className={data.sprint ? "board-sprint" : "board-unmapped"} role="status">
          {data.sprint ? (
            <>
              <b>{data.sprint.name}</b>
              {data.sprint.goal ? ` · ${data.sprint.goal}` : ""} · ends {formatDate(data.sprint.endDate)}
            </>
          ) : (
            "No sprint is running. Start one from the Backlog tab; this board shows the running sprint."
          )}
        </p>
      )}
      {data.unmapped.length > 0 && (
        <p className="board-unmapped">
          Not on this board: {unmappedNames.join(", ")}. {data.canConfigure ? "Add them to a column so their items show." : "Ask someone who edits systems to add them to a column."}
        </p>
      )}
      {data.truncated && <p className="board-unmapped">Showing the first 400 cards. Use the filters to narrow it down.</p>}

      <div className="board" style={/** @type {React.CSSProperties} */ ({ ["--cols"]: board.columns.length })}>
        <div className="board-head" role="row">
          {board.columns.map((col) => {
            const n = data.counts[col.id] ?? 0;
            const over = !!col.wipLimit && n > col.wipLimit;
            return (
              <div key={col.id} className={`board-col-head ${over ? "over" : ""}`} role="columnheader">
                <b>{col.name}</b>
                <span className="board-count" title={col.wipLimit ? `Work-in-progress limit ${col.wipLimit}` : undefined}>
                  {col.wipLimit ? `${n} / ${col.wipLimit}` : n}
                  {over && <span className="sr-only"> (over its limit)</span>}
                </span>
                {over && (
                  <small className="board-over">
                    <AlertOctagon size={12} /> {n - /** @type {NonNullable<typeof col.wipLimit>} */ (col.wipLimit)} over the limit
                  </small>
                )}
              </div>
            );
          })}
        </div>
        {lanesToShow.map((lane) => {
          const inLane = data.cards.filter((c) => swim === "none" || laneOf(c).key === lane.key);
          return (
            <section key={lane.key || "all"} className="board-lane" aria-label={lane.label || "All cards"}>
              {swim !== "none" && (
                <h4 className="board-lane-title">
                  {lane.label} <span className="muted">· {inLane.length}</span>
                </h4>
              )}
              <div className="board-cols">
                {board.columns.map((col) => {
                  const cards = inLane.filter((c) => col.statuses.includes(c.status));
                  const target = dragging && !col.statuses.includes(dragging.status);
                  const ok = dragging ? reachable(dragging, col) : false;
                  return (
                    <div
                      key={col.id}
                      className={`board-col ${target ? (ok ? "drop-ok" : "drop-no") : ""}`}
                      aria-label={`${col.name}${lane.label ? `, ${lane.label}` : ""}: ${cards.length} card${cards.length === 1 ? "" : "s"}`}
                      role="list"
                      onDragOver={
                        /** @param {DragEvent} e */ (e) => {
                          if (dragging && target) e.preventDefault();
                        }
                      }
                      onDrop={
                        /** @param {DragEvent} e */ (e) => {
                          e.preventDefault();
                          const card = dragging;
                          setDragging(null);
                          if (card) moveTo(card, col);
                        }
                      }
                    >
                      <span className="board-col-label">{col.name}</span>
                      {cards.map((c) => (
                        <CardView
                          key={c.id}
                          card={c}
                          assignee={name(c.assignee)}
                          now={now}
                          busy={busyKey === c.key}
                          columns={board.columns}
                          canMove={!readOnly}
                          reachable={(col2) => reachable(c, col2)}
                          showEpic={swim !== "epic"}
                          onDragStart={() => setDragging(c)}
                          onDragEnd={() => setDragging(null)}
                          onMove={(col2) => moveTo(c, col2)}
                        />
                      ))}
                      {!cards.length && <p className="board-empty">{dragging && target ? (ok ? "Drop here" : "Can't move here") : "No cards"}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!data.cards.length && <div className="empty">{filtersOn ? "No cards match these filters." : "No work items on this board yet."}</div>}
      </div>

      {pending && (
        <MoveDialog
          move={pending}
          users={users}
          me={me}
          canAssignOthers={canAssignOthers}
          onCancel={() => {
            setNotice(`${pending.itemKey} stayed where it was.`);
            setPending(null);
          }}
          onDone={async (item) => {
            setPending(null);
            setNotice(`${item.key} moved to ${item.statusName}.`);
            await load();
          }}
        />
      )}
      {configuring && (
        <BoardSettings
          board={board}
          statuses={data.statuses}
          relevant={new Set(data.workflows.flatMap((w) => w.statuses.map((s) => s.id)))}
          onClose={() => setConfiguring(false)}
          onSaved={async () => {
            setConfiguring(false);
            setLanes(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
/**
 * @param {{
 *   card: Card;
 *   assignee?: string;
 *   now: number;
 *   busy: boolean;
 *   columns: BoardColumn[];
 *   canMove: boolean;
 *   reachable: (col: BoardColumn) => boolean;
 *   showEpic: boolean;
 *   onDragStart: () => void;
 *   onDragEnd: () => void;
 *   onMove: (col: BoardColumn) => void;
 * }} arg10
 */
function CardView({ card: c, assignee, now, busy, columns, canMove, reachable, showEpic, onDragStart, onDragEnd, onMove }) {
  const late = !!c.dueDate && !isDone(c) && new Date(c.dueDate).setHours(23, 59, 59, 999) < now;
  const here = columns.find((col) => col.statuses.includes(c.status));
  return (
    <article
      className={`board-card ${busy ? "busy" : ""} ${c.blocked ? "blocked" : ""}`}
      role="listitem"
      draggable={canMove && !busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", c.key);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      aria-label={`${c.key} ${c.summary}. ${c.statusName}${c.blocked ? ", blocked" : ""}${assignee ? `, assigned to ${assignee}` : ", unassigned"}`}
    >
      <div className="board-card-top">
        <TypeIcon type={c.type} size={13} />
        <a href={itemHref(c.systemId, c.key)} className="board-card-key">
          {c.key}
        </a>
        {c.blocked && (
          <span className="flag flag-blocked board-blocked" title="Blocked by another work item, or on hold">
            <AlertOctagon size={12} /> Blocked
          </span>
        )}
      </div>
      <a href={itemHref(c.systemId, c.key)} className={`board-card-summary ${isDone(c) ? "wi-done" : ""}`} tabIndex={-1}>
        {c.summary}
      </a>
      {showEpic && c.epic && (
        <span className="board-epic" title={c.epic.summary}>
          {c.epic.key}
        </span>
      )}
      <CustomFieldChips values={c.customFields} />
      <div className="board-card-foot">
        <ItemPriority priority={c.priority} />
        {c.storyPoints != null && (
          <span className="board-points" title="Story points">
            {c.storyPoints}
          </span>
        )}
        {c.dueDate && (
          <span className={`board-due ${late ? "text-red strong" : ""}`} title={late ? "Past its due date" : "Due"}>
            <CalendarClock size={12} /> {formatDate(c.dueDate)}
          </span>
        )}
        <span className="avatar sm board-avatar" title={assignee ?? "Unassigned"} aria-hidden="true">
          {assignee ? initials(assignee) : "–"}
        </span>
      </div>
      {canMove && (
        <select
          className="board-move"
          value=""
          disabled={busy}
          onChange={(e) => {
            const col = columns.find((x) => x.id === e.target.value);
            if (col) onMove(col);
          }}
          aria-label={`Move ${c.key} to another column`}
        >
          <option value="">{busy ? "Moving…" : `Move… (${here?.name ?? c.statusName})`}</option>
          {columns
            .filter((col) => col !== here)
            .map((col) => (
              <option key={col.id} value={col.id} disabled={!reachable(col)}>
                {col.name}
                {reachable(col) ? "" : " (not allowed)"}
              </option>
            ))}
        </select>
      )}
    </article>
  );
}
/**
 * Columns: their names, statuses and work-in-progress limits, and the board's swimlanes.
 * @param {{
 *   board: NonNullable<BoardData["board"]>;
 *   statuses: StatusDef[];
 *   relevant: Set<string>;
 *   onClose: () => void;
 *   onSaved: () => Promise<void>;
 * }} props
 */
function BoardSettings({ board, statuses, relevant, onClose, onSaved }) {
  const [name, setName] = useState(board.name);
  const [swimlanes, setSwimlanes] = useState(/** @type {Swimlanes | (() => Swimlanes)} */ (board.swimlanes));
  const [cols, setCols] = useState(board.columns.map((c) => ({ ...c, wipLimit: c.wipLimit ? String(c.wipLimit) : "" })));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The statuses its projects' workflows use first, then the rest.
  const shown = [...statuses].sort((a, b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id)));
  const set = /** @param {number} i @param {Partial<(typeof cols)[number]>} patch */ (i, patch) => setCols(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const toggle = /** @param {number} i @param {string} st */ (i, st) => setCols(cols.map((c, j) => (j === i ? { ...c, statuses: c.statuses.includes(st) ? c.statuses.filter((x) => x !== st) : [...c.statuses, st] } : { ...c, statuses: c.statuses.filter((x) => x !== st) })));
  const move = /** @param {number} i @param {number} by */ (i, by) => {
    const next = [...cols];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c);
    setCols(next);
  };
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-wide board-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Board columns"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await api(`/boards/${board.id}`, "PUT", { name, swimlanes, columns: cols.map((c) => ({ id: c.id, name: c.name, wipLimit: c.wipLimit === "" ? null : Number(c.wipLimit), statuses: c.statuses })) });
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the board");
          } finally {
            setSaving(false);
          }
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Board columns</h2>
        <p className="modal-note">Each column shows one or more statuses. A status can be in one column. A column over its work-in-progress limit turns amber.</p>
        <div className="field-row">
          <label className="field">
            <span>Board name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <label className="field">
            <span>Swimlanes shown first</span>
            <select value={swimlanes} onChange={(e) => setSwimlanes(/** @type {Swimlanes} */ (e.target.value))}>
              {SWIMLANES.map((s) => (
                <option key={s} value={s}>
                  {SWIMLANE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ol className="board-settings-cols">
          {cols.map((c, i) => (
            <li key={c.id}>
              <div className="board-settings-row">
                <input value={c.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Column ${i + 1} name`} maxLength={40} required />
                <label className="board-wip">
                  WIP limit
                  <input type="number" min={1} max={999} inputMode="numeric" value={c.wipLimit} onChange={(e) => set(i, { wipLimit: e.target.value })} placeholder="None" aria-label={`${c.name} work-in-progress limit`} />
                </label>
                <button type="button" className="icon-link" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} left`}>
                  <ArrowUp size={15} />
                </button>
                <button type="button" className="icon-link" onClick={() => move(i, 1)} disabled={i === cols.length - 1} aria-label={`Move ${c.name} right`}>
                  <ArrowDown size={15} />
                </button>
                <button type="button" className="icon-link danger-text" onClick={() => setCols(cols.filter((_, j) => j !== i))} disabled={cols.length === 1} aria-label={`Remove ${c.name}`}>
                  <Trash2 size={15} />
                </button>
              </div>
              <fieldset className="board-settings-statuses">
                <legend className="sr-only">Statuses in {c.name}</legend>
                {shown.map((st) => (
                  <label key={st.id} className={`wi-check ${relevant.has(st.id) ? "" : "muted"}`}>
                    <input type="checkbox" checked={c.statuses.includes(st.id)} onChange={() => toggle(i, st.id)} />
                    {st.name} <small className="muted">{CATEGORY_META[st.category].label}</small>
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-ghost sm" onClick={() => setCols([...cols, { id: `new-${Date.now()}`, name: "New column", wipLimit: "", statuses: [] }])} disabled={cols.length >= 12}>
          <Plus size={14} strokeWidth={3} /> Add a column
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber" disabled={saving}>
            Save board
          </button>
        </div>
      </form>
    </div>
  );
}
/** @typedef {WorkItemSummary & CardOwn} Card */
/**
 * @typedef {Object} BoardColumn
 * @property {string} id
 * @property {string} name
 * @property {number | null} wipLimit
 * @property {string[]} statuses
 */
/**
 * @typedef {Object} CardOwn
 * @property {boolean} blocked
 * @property {{ key: string; summary: string }} [epic]
 */
/**
 * @typedef {Object} BoardData
 * @property {boolean} [scrum]
 * @property {{ id: string; name: string; goal: string | null; endDate: string } | null} [sprint]
 * @property {{ id: string; name: string; systemId: string | null; workspace: string | null; swimlanes: Swimlanes; columns: BoardColumn[] } | null} board
 * @property {StatusDef[]} statuses
 * @property {Workflow[]} workflows
 * @property {Record<string, string>} projectWorkflow
 * @property {Record<string, number>} counts
 * @property {string[]} unmapped
 * @property {Card[]} cards
 * @property {boolean} truncated
 * @property {boolean} canConfigure
 */
/**
 * @typedef {Object} Props
 * @property {{ systemId: string } | { workspace: string }} scope
 * @property {User[]} users
 * @property {User} me
 * @property {number} now
 * @property {boolean} readOnly
 * @property {boolean} canAssignOthers
 */
