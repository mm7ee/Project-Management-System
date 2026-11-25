/** @import { Health, Status, System } from '../data/systems' */
import { useEffect, useState } from "react";
import { CheckCircle2, Wrench, X } from "lucide-react";
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
        <h2>Post progress update</h2>

        <label className="field update-left">
          <span>Project</span>
          <select value={id} onChange={(e) => pick(e.target.value)}>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

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
