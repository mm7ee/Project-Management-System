/** @import { User } from '../data/roles' */
/** @import { StatusDef } from '../data/workflows' */
/** @import { WorkFilters, WorkView } from '../data/pagePrefs' */
// The Work tab's saved views (kept in the person's preferences: src/data/pagePrefs.js) and its bulk edit: the
// selected work items get the new status, assignee or priority one by one, through the same rules as editing one
// (PATCH /api/items/:key: the workflow's transitions, who may assign whom); anything refused is listed with why.
import { useState } from "react";
import { Bookmark, Check, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { WORK_PRIORITIES, WORK_PRIORITY_META } from "../data/workitems";

/** A short random id for a saved view. */
export const newViewId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
/** The most work items one bulk change touches. */
export const BULK_MAX = 100;

/**
 * @param {{ systemId: string; views: WorkView[]; current: WorkFilters; onApply: (f: WorkFilters) => void; onSave: (name: string) => Promise<void>; onDelete: (id: string) => Promise<void> }} p
 */
export default function WorkViews({ views, current, onApply, onSave, onDelete }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const same = (/** @type {WorkView} */ v) => JSON.stringify(v.filters) === JSON.stringify(current);
  return (
    <div className="wv" role="group" aria-label="Saved views">
      <Bookmark size={15} aria-hidden="true" />
      {views.length ? (
        views.map((v) => (
          <span key={v.id} className={`wv-chip ${same(v) ? "on" : ""}`}>
            <button className="wv-open" aria-pressed={same(v)} onClick={() => onApply(v.filters)}>
              {v.name}
            </button>
            <button className="wv-del" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => onDelete(v.id).catch((e) => setError(e instanceof Error ? e.message : "Couldn't delete it"))}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))
      ) : (
        <span className="wv-none">No saved views yet.</span>
      )}
      {naming ? (
        <form
          className="wv-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              await onSave(name.trim().slice(0, 60));
              setNaming(false);
              setName("");
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't save the view");
            }
          }}
        >
          <label className="sr-only" htmlFor="wv-name">
            Name this view
          </label>
          <input id="wv-name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My open bugs" />
          <button className="btn btn-navy sm" type="submit" disabled={!name.trim()}>
            Save
          </button>
          <button className="btn btn-ghost sm" type="button" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="link-btn" onClick={() => setNaming(true)} disabled={views.some(same)}>
          Save these filters as a view
        </button>
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

/**
 * The bar shown while work items are selected.
 * @param {{ keys: string[]; statuses: StatusDef[]; people: User[]; onClear: () => void; onDone: () => void }} p
 */
export function BulkBar({ keys, statuses, people, onClear, onDone }) {
  const [field, setField] = useState(/** @type {"status" | "assignee" | "priority"} */ ("status"));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(/** @type {number | null} */ (null));
  const [result, setResult] = useState(/** @type {{ ok: number; failed: { key: string; why: string }[] } | null} */ (null));
  const over = keys.length > BULK_MAX;
  const run = async () => {
    setResult(null);
    /** @type {{ key: string; why: string }[]} */ const failed = [];
    let ok = 0;
    const todo = keys.slice(0, BULK_MAX);
    for (let i = 0; i < todo.length; i++) {
      setBusy(i + 1);
      try {
        await api(`/items/${todo[i]}`, "PATCH", { [field]: field === "assignee" ? value || null : value });
        ok++;
      } catch (e) {
        failed.push({ key: todo[i], why: e instanceof Error ? e.message : "Refused" });
      }
    }
    setBusy(null);
    setResult({ ok, failed });
    if (!failed.length) onDone();
  };
  return (
    <div className="wi-bulk" role="region" aria-label="Change the selected work items">
      <b>
        {keys.length} selected{over ? ` (the first ${BULK_MAX} will change)` : ""}
      </b>
      <label>
        <span className="sr-only">What to change</span>
        <select
          value={field}
          onChange={(e) => {
            setField(/** @type {"status" | "assignee" | "priority"} */ (e.target.value));
            setValue("");
          }}
        >
          <option value="status">Set status</option>
          <option value="assignee">Set assignee</option>
          <option value="priority">Set priority</option>
        </select>
      </label>
      <label>
        <span className="sr-only">New value</span>
        <select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{field === "assignee" ? "Unassigned" : "Choose…"}</option>
          {field === "status" && statuses.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          {field === "assignee" && people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          {field === "priority" && WORK_PRIORITIES.map((pr) => <option key={pr} value={pr}>{WORK_PRIORITY_META[pr].label}</option>)}
        </select>
      </label>
      <button className="btn btn-navy sm" disabled={busy !== null || (field !== "assignee" && !value)} onClick={run}>
        <Check size={14} aria-hidden="true" /> {busy !== null ? `Changing ${busy} of ${Math.min(keys.length, BULK_MAX)}…` : "Apply"}
      </button>
      <button className="btn btn-ghost sm" onClick={onClear} disabled={busy !== null}>
        <Trash2 size={14} aria-hidden="true" /> Clear selection
      </button>
      {result && (
        <p className="wi-bulk-result" role="status">
          {result.ok} changed.
          {result.failed.length > 0 && (
            <>
              {" "}
              {result.failed.length} couldn't be: {result.failed.map((f) => `${f.key} (${f.why})`).join("; ")}.{" "}
              <button className="link-btn" onClick={onDone}>
                Done
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
