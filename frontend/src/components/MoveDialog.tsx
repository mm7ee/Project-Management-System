import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "../data/api";
import type { User } from "../data/roles";
import { cleanLabel, parseDuration, type WorkItem } from "../data/workitems";
import { FIELD_RULE_LABEL } from "../data/workflows";
import { MarkdownField } from "./WorkItemBits";

/** What a move needs from the person, as the item page and the board know it. */
export interface PendingMove {
  itemKey: string;
  transitionId: string;
  name: string;
  toName: string;
  needs: { comment: boolean; assignee: boolean; fields: string[] };
  source?: string; // client requests go to developers only
}

/**
 * Asks for what a workflow move needs (a comment, an assignee, a field) and then makes it. The server
 * checks everything again; its message shows here when it refuses.
 */
export default function MoveDialog({
  move,
  users,
  me,
  canAssignOthers,
  onDone,
  onCancel,
}: {
  move: PendingMove;
  users: User[];
  me: User;
  canAssignOthers: boolean;
  onDone: (item: WorkItem) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const [assignee, setAssignee] = useState(canAssignOthers ? "" : me.id);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const people = users
    .filter((u) => u.role !== "viewer" && (move.source !== "client_request" || u.role === "developer"))
    .filter((u) => canAssignOthers || u.id === me.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const values: Record<string, unknown> = {};
    if (move.needs.assignee) values.assignee = assignee || null;
    for (const f of move.needs.fields) {
      const v = (fields[f] ?? "").trim();
      if (f === "storyPoints") values[f] = v === "" ? null : Number(v);
      else if (f === "originalEstimate") {
        const m = parseDuration(v);
        if (v && m == null) return setError("Original estimate: use a length such as 2h 30m");
        values[f] = m;
      } else if (f === "labels") values[f] = v.split(",").map(cleanLabel).filter(Boolean);
      else values[f] = v || null;
    }
    setBusy(true);
    try {
      onDone(await api<WorkItem>(`/items/${move.itemKey}/transitions`, "POST", { transitionId: move.transitionId, ...(comment.trim() ? { comment } : {}), fields: values }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make that move");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop modal-backdrop" onClick={onCancel}>
      <form className="modal move-dialog" role="dialog" aria-modal="true" aria-label={`${move.name}: ${move.itemKey}`} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="close-btn" onClick={onCancel} aria-label="Close">
          <X size={18} />
        </button>
        <h2>
          {move.name} <span className="mono muted">{move.itemKey}</span>
        </h2>
        <p className="modal-note">This move to {move.toName} needs a little more first.</p>
        {move.needs.comment && <MarkdownField label="Comment (required)" value={comment} onChange={setComment} rows={4} autoFocus />}
        {move.needs.assignee && (
          <label className="field">
            <span>Assignee (required)</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} required autoFocus={!move.needs.comment}>
              <option value="">Choose someone…</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === me.id ? `${u.name} (me)` : u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {move.needs.fields.map((f, i) => (
          <label className="field" key={f}>
            <span>{FIELD_RULE_LABEL[f] ?? f} (required)</span>
            {f === "description" ? (
              <textarea rows={4} value={fields[f] ?? ""} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} required autoFocus={!move.needs.comment && !move.needs.assignee && i === 0} />
            ) : (
              <input
                type={f === "dueDate" || f === "startDate" ? "date" : f === "storyPoints" ? "number" : "text"}
                inputMode={f === "storyPoints" ? "decimal" : undefined}
                placeholder={f === "originalEstimate" ? "2h 30m" : f === "labels" ? "Comma-separated" : undefined}
                value={fields[f] ?? ""}
                onChange={(e) => setFields({ ...fields, [f]: e.target.value })}
                required
                autoFocus={!move.needs.comment && !move.needs.assignee && i === 0}
              />
            )}
          </label>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber" disabled={busy || (move.needs.comment && !comment.trim())}>
            {move.name}
          </button>
        </div>
      </form>
    </div>
  );
}
