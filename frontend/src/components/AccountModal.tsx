import { useEffect, useState } from "react";
import { Check, LogOut, X } from "lucide-react";
import { api } from "../data/api";
import { PERMISSIONS, ROLE_LABEL, type Permission, type User } from "../data/roles";

interface Props {
  me: User;
  permissions: Permission[];
  projectName?: string;
  onSignOut: () => void;
  onClose: () => void;
}

export default function AccountModal({ me, permissions, projectName, onSignOut, onClose }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Your account" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{me.name}</h2>
        <p className="modal-note">
          {me.title ? `${me.title} · ` : ""}
          {ROLE_LABEL[me.role]} · signed in as <b>{me.username}</b>
          {projectName && (
            <>
              <br />
              Assigned project: <b>{projectName}</b>
            </>
          )}
        </p>

        <div className="perm-list">
          <span className="lead-label">What you can do</span>
          <span className="perm-item on">
            <Check size={14} /> View all systems and their progress
          </span>
          {PERMISSIONS.filter((p) => permissions.includes(p.key)).map((p) => (
            <span key={p.key} className="perm-item on">
              <Check size={14} /> {p.label}
            </span>
          ))}
        </div>

        <form
          className="pw-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/me/password", "POST", { current, next });
              setMsg({ ok: true, text: "Password changed." });
              setCurrent("");
              setNext("");
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't change password" });
            }
          }}
        >
          <span className="lead-label">Change password</span>
          <div className="field-row">
            <label className="field">
              <span>Current</span>
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="field">
              <span>New (8+ characters)</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
          </div>
          {msg && <p className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</p>}
          <button type="submit" className="btn btn-ghost">
            Update password
          </button>
        </form>

        <div className="modal-actions">
          <button
            className="btn btn-danger"
            onClick={async () => {
              await api("/logout", "POST").catch(() => undefined);
              onSignOut();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
