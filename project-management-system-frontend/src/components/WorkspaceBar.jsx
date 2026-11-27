import { useEffect, useState } from "react";
import { Layers, Pencil, Plus, Trash2, X } from "lucide-react";
/**
 * Picks the workspace the Projects page shows. Administrators and team leaders edit the list.
 * @param {Props} props
 */
export default function WorkspaceBar({ workspaces, counts, value, onChange, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const chip = /** @param {string} key @param {string} label */ (key, label) => (
    <button key={key || "all"} className={`ws-chip ${value === key ? "on" : ""} ${counts[key] ? "" : "empty"}`} aria-pressed={value === key} onClick={() => onChange(key)}>
      {label} <b>{counts[key] ?? 0}</b>
    </button>
  );
  return (
    <div className="ws-bar" role="group" aria-label="Workspace">
      <span className="ws-label">
        <Layers size={15} /> Workspace
      </span>
      {chip("", "All")}
      {workspaces.map((w) => chip(w, w))}
      {canEdit && (
        <button className="ws-edit" onClick={() => setEditing(true)} title="Add, rename or remove workspaces">
          <Pencil size={13} /> Edit
        </button>
      )}
      {editing && <WorkspaceEditor workspaces={workspaces} counts={counts} onClose={() => setEditing(false)} onSave={onSave} />}
    </div>
  );
}
/**
 * @param {{
 *   workspaces: string[];
 *   counts: Record<string, number>;
 *   onClose: () => void;
 *   onSave: (list: { name: string; was?: string }[]) => Promise<void>;
 * }} arg2
 */
function WorkspaceEditor({ workspaces, counts, onClose, onSave }) {
  const [rows, setRows] = useState(() => workspaces.map((w) => ({ name: w, was: /** @type {string | undefined} */ (w) })));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = /** @param {KeyboardEvent} e */ (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const removed = workspaces.filter((w) => !rows.some((r) => r.was === w));
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave(rows.filter((r) => r.name.trim()));
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the workspaces");
          } finally {
            setSaving(false);
          }
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Workspaces</h2>
        <p className="modal-note">Group projects by the part of the business they serve. Renaming moves its projects along.</p>
        <ul className="ws-list">
          {rows.map((r, i) => (
            <li key={i}>
              <input value={r.name} maxLength={40} placeholder="e.g. Marketing" aria-label={`Workspace ${i + 1}`} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              {r.was && <small>{counts[r.was] ?? 0} projects</small>}
              <button type="button" className="icon-btn" aria-label={`Remove ${r.name || "workspace"}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost sm ws-add" onClick={() => setRows((x) => [...x, { name: "", was: undefined }])}>
          <Plus size={15} /> Add a workspace
        </button>
        {removed.some((w) => counts[w]) && (
          <p className="form-warn">
            Projects in {removed.filter((w) => counts[w]).join(", ")} will move to {rows.find((r) => r.name.trim())?.name.trim() ?? "the first workspace"}.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-navy" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
/**
 * @typedef {Object} Props
 * @property {string[]} workspaces
 * @property {Record<string, number>} counts
 * @property {string} value
 * @property {(v: string) => void} onChange
 * @property {boolean} canEdit
 * @property {(list: { name: string; was?: string }[]) => Promise<void>} onSave
 */
