import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { STATUS_META, type Health, type Status, type System } from "../data/systems";
import type { User } from "../data/roles";
import DeveloperPicker from "./DeveloperPicker";

interface Props {
  users: User[];
  systems: System[];
  error?: string;
  onSave: (s: Partial<System> & { developers: string[] }) => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function AddSystemModal({ users, systems, error, onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [lead, setLead] = useState("");
  const [developers, setDevelopers] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("WIP");
  const [progress, setProgress] = useState(0);
  const [startedAt, setStartedAt] = useState(today());
  const [dueAt, setDueAt] = useState("");
  const [finishedAt, setFinishedAt] = useState(today());
  const [health, setHealth] = useState<Health>("Stable");

  // Live / completed systems are delivered; everything else is still scheduled.
  const delivered = status === "LIVE" || status === "COMPLETED";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickStatus = (s: Status) => {
    setStatus(s);
    if (s === "LIVE" || s === "COMPLETED") setProgress(100);
  };

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-wide"
        role="dialog"
        aria-label="Add a system"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name: name.trim(),
            description: description.trim(),
            url: url.trim(),
            ...(lead ? { lead } : {}),
            developers,
            status,
            progress,
            startedAt,
            ...(delivered ? { finishedAt, health } : dueAt ? { dueAt: `${dueAt}T17:00:00` } : {}),
          });
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Add a system</h2>

        <label className="field">
          <span>Name</span>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Leave Planner" />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => pickStatus(e.target.value as Status)}>
              {(Object.keys(STATUS_META) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Project lead</span>
            <select value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">Not assigned yet</option>
              {users.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.title ? ` · ${p.title}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>
            Developers {developers.length > 0 && <b>{developers.length}</b>}
          </span>
          <DeveloperPicker users={users} systems={systems} value={developers} onChange={setDevelopers} />
        </div>

        <label className="field">
          <span>
            Progress <b>{progress}%</b>
          </span>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(+e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Start date</span>
            <input type="date" required value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
          </label>
          {delivered ? (
            <label className="field">
              <span>Delivered on</span>
              <input type="date" required value={finishedAt} min={startedAt} onChange={(e) => setFinishedAt(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>Due date</span>
              <input type="date" value={dueAt} min={startedAt} onChange={(e) => setDueAt(e.target.value)} />
            </label>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>Address (URL)</span>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.198.160:8087" />
          </label>
          {delivered && (
            <label className="field">
              <span>Health</span>
              <select value={health} onChange={(e) => setHealth(e.target.value as Health)}>
                <option value="Stable">Stable</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </label>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Add system
          </button>
        </div>
      </form>
    </div>
  );
}
