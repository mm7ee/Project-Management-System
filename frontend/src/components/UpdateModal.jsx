/** @import { Health, Status, System } from '../data/systems' */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, Search, Wrench, X } from "lucide-react";
import { STATUS_META } from "../data/systems";
/**
 * @param {Props} props
 */
export default function UpdateModal({ systems, initialId, onSave, onClose }) {
  const [id, setId] = useState(initialId ?? systems[0]?.id ?? "");
  const current = systems.find((s) => s.id === id);
  const [progress, setProgress] = useState(current?.progress ?? 0);
  const [status, setStatus] = useState(/** @type {Status | (() => Status)} */ (current?.status ?? "WIP"));
  const [health, setHealth] = useState(/** @type {Health | (() => Health)} */ (current?.health ?? "Stable"));
  const [note, setNote] = useState(current?.maintenanceNote ?? "");
  const [error, setError] = useState("");
  // Maintenance only applies once a system is in use.
  const delivered = status === "LIVE" || status === "COMPLETED";
  // Picking a different project starts from that project's current values.
  const pick = /** @param {string} next */ (next) => {
    const s = systems.find((x) => x.id === next);
    setId(next);
    if (s) {
      setProgress(s.progress);
      setStatus(s.status);
      setHealth(s.health ?? "Stable");
      setNote(s.maintenanceNote ?? "");
    }
  };
  useEffect(() => {
    const onKey = /** @param {KeyboardEvent} e */ (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-wide update-modal"
        role="dialog"
        aria-label="Post progress update"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave({
              id,
              progress,
              status,
              ...(delivered ? { health, maintenanceNote: health === "Maintenance" ? note.trim() : "" } : {}),
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the update");
          }
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <button type="button" className="modal-back" onClick={onClose} aria-label="Back to the previous page (nothing is saved)">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <h2>Post progress update</h2>

        <div className="field update-left">
          <span id="update-project-label">Project</span>
          <ProjectSearch systems={systems} value={id} onPick={pick} />
        </div>

        <label className="field update-left">
          <span>
            Progress <b>{progress}%</b>
          </span>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(+e.target.value)} />
        </label>

        <label className="field update-right">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(/** @type {Status} */ (e.target.value))}>
            {/** @type {Status[]} */ (Object.keys(STATUS_META)).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>

        {delivered && (
          <div className="field update-right">
            <span>System health</span>
            <div className="health-toggle" role="radiogroup" aria-label="System health">
              <button type="button" role="radio" aria-checked={health === "Stable"} className={health === "Stable" ? "on stable" : ""} onClick={() => setHealth("Stable")}>
                <CheckCircle2 size={16} /> Stable
              </button>
              <button type="button" role="radio" aria-checked={health === "Maintenance"} className={health === "Maintenance" ? "on maint" : ""} onClick={() => setHealth("Maintenance")}>
                <Wrench size={16} /> Under maintenance
              </button>
            </div>
          </div>
        )}
        {delivered && health === "Maintenance" && (
          <label className="field update-right">
            <span>What's being updated? (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Upgrading to v2.3 — reports may be slow until Friday" />
          </label>
        )}

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Post update
          </button>
        </div>
      </form>
    </div>
  );
}
/**
 * Type-to-find project box. Shows the chosen project's name; typing filters the list by name,
 * short code or status, ↑/↓ move, Enter picks, Escape closes the list without closing the form.
 * @param {{ systems: System[], value: string, onPick: (id: string) => void }} props
 */
function ProjectSearch({ systems, value, onPick }) {
  const [query, setQuery] = useState(/** @type {string | null} */ (null));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const chosen = systems.find((s) => s.id === value);
  const q = (query ?? "").trim().toLowerCase();
  const matches = systems.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.short ?? "").toLowerCase().includes(q) || STATUS_META[s.status].label.toLowerCase().includes(q),
  );
  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const choose = /** @param {string} next */ (next) => {
    onPick(next);
    close();
  };
  return (
    <div className="dev-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <label className="dev-search-box">
        <Search size={15} aria-hidden="true" />
        <input
          value={query ?? chosen?.name ?? ""}
          placeholder="Search projects by name…"
          role="combobox"
          aria-labelledby="update-project-label"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={(e) => {
            e.currentTarget.select();
            setOpen(true);
            setActive(Math.max(0, systems.findIndex((s) => s.id === value)));
          }}
          onClick={(e) => {
            // Not searching yet: select the shown name so typing replaces it.
            if (query === null) e.currentTarget.select();
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Enter picks a project instead of posting the update.
              if (open) {
                e.preventDefault();
                if (matches[active]) choose(matches[active].id);
              }
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              close();
            }
          }}
        />
      </label>
      {open && (
        <ul className="dev-menu" role="listbox">
          {matches.length ? (
            matches.map((s, i) => (
              <li key={s.id} role="option" aria-selected={s.id === value}>
                <button
                  type="button"
                  className={`dev-option ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s.id)}
                >
                  <span className="dev-option-text">
                    <b>{s.name}</b>
                    <span>
                      {STATUS_META[s.status].label} · {s.progress}%
                    </span>
                  </span>
                  {s.id === value && <Check size={15} aria-label="Current" />}
                </button>
              </li>
            ))
          ) : (
            <li className="dev-menu-empty">No project matches "{(query ?? "").trim()}"</li>
          )}
        </ul>
      )}
    </div>
  );
}
/**
 * @typedef {Object} ProgressUpdate
 * @property {string} id
 * @property {number} progress
 * @property {Status} status
 * @property {Health} [health]
 * @property {string} [maintenanceNote]
 */
/**
 * @typedef {Object} Props
 * @property {System[]} systems
 * @property {string} [initialId]
 * @property {(u: ProgressUpdate) => Promise<void>} onSave
 * @property {() => void} onClose
 */
