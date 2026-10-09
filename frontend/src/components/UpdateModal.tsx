import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { STATUS_META, type Status, type System } from "../data/systems";

export interface ProgressUpdate {
  id: string;
  progress: number;
  status: Status;
}

interface Props {
  systems: System[];
  onSave: (u: ProgressUpdate) => void;
  onClose: () => void;
}

export default function UpdateModal({ systems, onSave, onClose }: Props) {
  const [id, setId] = useState(systems[0]?.id ?? "");
  const current = systems.find((s) => s.id === id);
  const [progress, setProgress] = useState(current?.progress ?? 0);
  const [status, setStatus] = useState<Status>(current?.status ?? "WIP");

  // Picking a different project starts from that project's current values.
  const pick = (next: string) => {
    const s = systems.find((x) => x.id === next);
    setId(next);
    if (s) {
      setProgress(s.progress);
      setStatus(s.status);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="Post progress update"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ id, progress, status });
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Post progress update</h2>

        <label className="field">
          <span>Project</span>
          <select value={id} onChange={(e) => pick(e.target.value)}>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>
            Progress <b>{progress}%</b>
          </span>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(+e.target.value)} />
        </label>

        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {(Object.keys(STATUS_META) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>

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
