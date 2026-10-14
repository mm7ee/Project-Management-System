import { useEffect, useState, type ReactNode } from "react";
import { Trash2, X } from "lucide-react";
import type { System } from "../data/systems";
import type { User } from "../data/roles";
import {
  FEATURE_KINDS,
  FEATURE_STATUSES,
  FEATURE_STATUS_META,
  KIND_META,
  PRIORITIES,
  PRIORITY_META,
  type Feature,
} from "../data/features";
import { formatDate, timeAgo } from "../time";

export type FeatureDraft = Pick<Feature, "systemId" | "title" | "description" | "kind" | "client" | "status" | "priority"> & {
  assignee: string;
  notes: string;
  dueAt: string;
};

interface Props {
  feature: Feature | null; // null: logging a new request
  initialSystemId?: string;
  systems: System[];
  users: User[];
  me: User;
  canManage: boolean; // may edit everything; otherwise only the assignee's status and notes
  overloaded: (u: User) => string[]; // why a developer is overloaded; empty when they're not
  now: number;
  onSave: (draft: Partial<FeatureDraft>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

function Step({ n, title, sub, children }: { n: number; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="step">
      <header className="step-head">
        <span className="step-num">{n}</span>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

export default function FeatureModal({ feature, initialSystemId, systems, users, me, canManage, overloaded, now, onSave, onDelete, onClose }: Props) {
  const [f, setF] = useState<FeatureDraft>(() => ({
    systemId: feature?.systemId ?? initialSystemId ?? systems[0]?.id ?? "",
    title: feature?.title ?? "",
    description: feature?.description ?? "",
    kind: feature?.kind ?? "NEW_MODULE",
    client: feature?.client ?? "",
    status: feature?.status ?? "NOT_STARTED",
    priority: feature?.priority ?? "MEDIUM",
    assignee: feature?.assignee ?? "",
    notes: feature?.notes ?? "",
    dueAt: feature?.dueAt ?? "",
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const set = <K extends keyof FeatureDraft>(k: K, v: FeatureDraft[K]) => setF((x) => ({ ...x, [k]: v }));

  const isAssignee = !!feature && feature.assignee === me.id;
  const full = canManage; // edits every step
  const mayEdit = full || isAssignee; // the assignee edits the status and notes
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  const system = systems.find((s) => s.id === f.systemId);

  // Developers on the chosen project first, then everyone else.
  const developers = users.filter((u) => u.role === "developer");
  const onProject = developers.filter((d) => d.projectIds?.includes(f.systemId));
  const others = developers.filter((d) => !d.projectIds?.includes(f.systemId));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setError("");
    setSaving(true);
    try {
      await onSave(full ? f : { status: f.status, notes: f.notes });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the request");
    } finally {
      setSaving(false);
    }
  };

  const ro = (label: string, value: ReactNode) => (
    <div className="ro-field">
      <span>{label}</span>
      <b>{value || "—"}</b>
    </div>
  );

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-wide feature-modal"
        role="dialog"
        aria-label={feature ? feature.title : "Log a feature request"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{feature ? (full ? "Edit feature request" : feature.title) : "Log a feature request"}</h2>
        {feature && (
          <p className="modal-note">
            Logged by {name(feature.createdBy) ?? "someone"} · {formatDate(feature.createdAt)} · updated {timeAgo(feature.updatedAt, now)}
          </p>
        )}

        <Step n={1} title="The request" sub="What the client asked for, and on which project.">
          {full ? (
            <>
              <div className="field-row">
                <label className="field">
                  <span>Project</span>
                  <select value={f.systemId} onChange={(e) => set("systemId", e.target.value)} required>
                    {systems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Requested by (client)</span>
                  <input value={f.client} onChange={(e) => set("client", e.target.value)} placeholder="e.g. HR department, Acme Ltd" />
                </label>
              </div>
              <div className="field">
                <span>Type of request</span>
                <div className="choice wrap" role="radiogroup" aria-label="Type of request">
                  {FEATURE_KINDS.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={f.kind === k ? "on" : ""} onClick={() => set("kind", k)}>
                      {KIND_META[k]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Feature</span>
                <input required autoFocus={!feature} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Leave approvals module" />
              </label>
              <label className="field">
                <span>Details (optional)</span>
                <textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What should it do? Any changes to existing screens?" />
              </label>
            </>
          ) : (
            <>
              <div className="field-row">
                {ro("Project", system?.name)}
                {ro("Requested by", f.client)}
              </div>
              <div className="field-row">
                {ro("Type", KIND_META[f.kind])}
                {ro("Feature", f.title)}
              </div>
              {f.description && <p className="ro-text">{f.description}</p>}
            </>
          )}
        </Step>

        <Step n={2} title="Status" sub="Where the work is right now.">
          {mayEdit ? (
            <div className="choice wrap" role="radiogroup" aria-label="Status">
              {FEATURE_STATUSES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={f.status === s} className={f.status === s ? "on" : ""} onClick={() => set("status", s)}>
                  <i className={`dot dot-${FEATURE_STATUS_META[s].tone}`} /> {FEATURE_STATUS_META[s].label}
                </button>
              ))}
            </div>
          ) : (
            <FeatureStatusPill status={f.status} />
          )}
        </Step>

        <Step n={3} title="Priority">
          {full ? (
            <div className="choice wrap" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={f.priority === p} className={f.priority === p ? "on" : ""} onClick={() => set("priority", p)}>
                  <i className={`dot prio-dot-${p.toLowerCase()}`} /> {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          ) : (
            <PriorityBadge priority={f.priority} />
          )}
        </Step>

        <Step n={4} title="Developer" sub="Who builds it. They can add notes on blockers or anything they need.">
          {full ? (
            <label className="field">
              <span>Assigned developer</span>
              <select value={f.assignee} onChange={(e) => set("assignee", e.target.value)}>
                <option value="">Not assigned yet</option>
                {onProject.length > 0 && (
                  <optgroup label={`On ${system?.name ?? "this project"}`}>
                    {onProject.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {overloaded(d).length ? " (overloaded)" : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label={onProject.length ? "Other developers" : "Developers"}>
                    {others.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {overloaded(d).length ? " (overloaded)" : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {(() => {
                const dev = developers.find((d) => d.id === f.assignee);
                const reasons = dev ? overloaded(dev) : [];
                return reasons.length > 0 && <span className="form-warn">{dev!.name} is already overloaded: {reasons.join("; ")}.</span>;
              })()}
            </label>
          ) : (
            ro("Assigned developer", name(f.assignee) ?? "Not assigned yet")
          )}
          {mayEdit ? (
            <label className="field">
              <span>Developer notes (optional)</span>
              <textarea
                rows={3}
                value={f.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Blockers, questions for the client, access or data that's needed…"
              />
            </label>
          ) : (
            f.notes && <p className="ro-text">{f.notes}</p>
          )}
        </Step>

        <Step n={5} title="Expected delivery">
          {full ? (
            <label className="field">
              <span>Delivery date (optional)</span>
              <input type="date" value={f.dueAt} onChange={(e) => set("dueAt", e.target.value)} />
            </label>
          ) : (
            ro("Delivery date", f.dueAt ? formatDate(f.dueAt) : "Not set")
          )}
        </Step>

        {error && <p className="form-error">{error}</p>}

        {confirming && feature ? (
          <div className="confirm" role="alertdialog" aria-label="Confirm delete">
            <p>
              Delete <b>{feature.title}</b>? This can't be undone.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => onDelete(feature.id).catch((e) => setError(e.message))}>
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-actions">
            {feature && full && (
              <button type="button" className="delete-link inline" onClick={() => setConfirming(true)}>
                <Trash2 size={15} /> Delete
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {mayEdit ? "Cancel" : "Close"}
            </button>
            {mayEdit && (
              <button type="submit" className="btn btn-amber" disabled={saving || !systems.length}>
                {feature ? "Save" : "Log request"}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

export function FeatureStatusPill({ status }: { status: Feature["status"] }) {
  const m = FEATURE_STATUS_META[status];
  return <span className={`pill sm fill-${m.tone}`}>{m.label}</span>;
}

export function PriorityBadge({ priority }: { priority: Feature["priority"] }) {
  return <span className={`prio prio-${priority.toLowerCase()}`}>{PRIORITY_META[priority].label}</span>;
}
