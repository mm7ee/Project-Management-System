import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { initials, type System } from "../data/systems";
import { timeAgo } from "../time";
import {
  PERMISSIONS,
  ROLES,
  ROLE_LABEL,
  type Permission,
  type Role,
  type RolePermissions,
  type User,
} from "../data/roles";

interface Props {
  me: User;
  users: User[];
  systems: System[];
  roleMatrix: RolePermissions;
  onChanged: () => Promise<void>;
}

export default function UsersPage({ me, users, systems, roleMatrix, onChanged }: Props) {
  // Last sign-in is only sent to people who can view the activity log.
  const showLastLogin = users.some((u) => u.lastLogin !== undefined) || me.lastLogin !== undefined;
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [error, setError] = useState("");
  const projectNames = (ids: string[] = []) =>
    ids.map((id) => systems.find((s) => s.id === id)?.name).filter(Boolean).join(", ");

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Users</h2>
          <p>{users.length} people can sign in. Developers can be assigned to several projects.</p>
        </div>
        <button className="btn btn-amber" onClick={() => setEditing("new")}>
          <Plus size={17} strokeWidth={3} /> Add user
        </button>
      </header>
      {error && <p className="form-error banner">{error}</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Assigned projects</th>
              <th>Email</th>
              {showLastLogin && <th>Last sign-in</th>}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="user-cell">
                    <span className="avatar">{initials(u.name)}</span>
                    <span>
                      <b>{u.name}</b>
                      <small>{u.username}</small>
                    </span>
                  </span>
                </td>
                <td>
                  <span className={`role-chip role-${u.role}`}>{ROLE_LABEL[u.role]}</span>
                  {u.mustChangePassword && <span className="flag flag-request pw-pending">Must set a new password</span>}
                </td>
                <td>{u.role === "developer" ? projectNames(u.projectIds) || <i className="muted">Not assigned</i> : "—"}</td>
                <td className="muted">{u.email ?? "—"}</td>
                {showLastLogin && (
                  <td className="muted" title={u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-GB") : undefined}>
                    {u.lastLogin ? timeAgo(u.lastLogin, Date.now()) : "Never"}
                  </td>
                )}
                <td>
                  <div className="row-actions">
                    {resetting === u.id ? (
                      <>
                        <span className="confirm-inline">Reset {u.name}'s password?</span>
                        <button className="btn btn-ghost sm" onClick={() => setResetting(null)}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-navy sm"
                          onClick={() =>
                            run(async () => {
                              const { password } = await api<{ password: string }>(`/users/${u.id}/reset-password`, "POST");
                              setIssued({ name: u.name, password });
                            }).then(() => setResetting(null))
                          }
                        >
                          Reset
                        </button>
                      </>
                    ) : deleting === u.id ? (
                      <>
                        <span className="confirm-inline">Delete {u.name}?</span>
                        <button className="btn btn-ghost sm" onClick={() => setDeleting(null)}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-danger sm"
                          onClick={() => run(() => api(`/users/${u.id}`, "DELETE")).then(() => setDeleting(null))}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="icon-link" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`} title="Edit">
                          <Pencil size={15} />
                        </button>
                        {u.id !== me.id && (
                          <button
                            className="icon-link"
                            onClick={() => {
                              setDeleting(null);
                              setResetting(u.id);
                            }}
                            aria-label={`Reset ${u.name}'s password`}
                            title="Reset password"
                          >
                            <KeyRound size={15} />
                          </button>
                        )}
                        {u.id !== me.id && (
                          <button
                            className="icon-link danger"
                            onClick={() => {
                              setResetting(null);
                              setDeleting(u.id);
                            }} aria-label={`Delete ${u.name}`} title="Delete">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RoleMatrix matrix={roleMatrix} onSave={(m) => run(() => api("/roles", "PUT", m))} />

      {issued && <TempPasswordDialog {...issued} onClose={() => setIssued(null)} />}

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          systems={systems}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const ok = await run(() =>
              editing === "new" ? api("/users", "POST", data) : api(`/users/${editing.id}`, "PATCH", data),
            );
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}

function RoleMatrix({ matrix, onSave }: { matrix: RolePermissions; onSave: (m: RolePermissions) => Promise<boolean> }) {
  const [draft, setDraft] = useState(matrix);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(matrix), [matrix]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(matrix);

  const toggle = (role: Role, p: Permission) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [role]: d[role].includes(p) ? d[role].filter((x) => x !== p) : [...d[role], p] }));
  };

  return (
    <section className="matrix-section">
      <header className="page-head">
        <div>
          <h2>Roles & permissions</h2>
          <p>Everyone who signs in can view all systems. Tick what else each role can do. Administrators always have everything.</p>
        </div>
        <button className="btn btn-navy" disabled={!dirty} onClick={async () => setSaved(await onSave(draft))}>
          {saved && !dirty ? "Saved" : "Save permissions"}
        </button>
      </header>
      <div className="table-wrap">
        <table className="table matrix">
          <thead>
            <tr>
              <th>Permission</th>
              {ROLES.map((r) => (
                <th key={r}>{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.key}>
                <td>{p.label}</td>
                {ROLES.map((r) => (
                  <td key={r}>
                    <input
                      type="checkbox"
                      aria-label={`${ROLE_LABEL[r]}: ${p.label}`}
                      checked={r === "admin" || draft[r].includes(p.key)}
                      disabled={r === "admin"}
                      onChange={() => toggle(r, p.key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Shows a freshly issued temporary password once; only its hash is kept on the server. */
function TempPasswordDialog({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={`Temporary password for ${name}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Password reset for {name}</h2>
        <p className="modal-note">
          Give {name} this temporary password. When they sign in with it they must choose a new one. They have been signed
          out everywhere.
        </p>
        <div className="temp-pw">
          <code>{password}</code>
          <button
            className="btn btn-ghost sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(password);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="set-note">It won't be shown again. If it's lost, reset the password again.</p>
        <div className="modal-actions">
          <button className="btn btn-navy" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

type UserForm = Partial<User> & { password?: string };

function UserModal({
  user,
  systems,
  onSave,
  onClose,
}: {
  user: User | null;
  systems: System[];
  onSave: (u: UserForm) => Promise<boolean>;
  onClose: () => void;
}) {
  const [f, setF] = useState<UserForm>(
    user ? { ...user, password: "" } : { role: "viewer", name: "", username: "", title: "", email: "", phone: "", password: "" },
  );
  const set = (k: keyof UserForm) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const picked = f.projectIds ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-wide"
        role="dialog"
        aria-label={user ? `Edit ${user.name}` : "Add user"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const { password, ...rest } = f;
          onSave(password ? { ...rest, password } : rest);
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{user ? `Edit ${user.name}` : "Add user"}</h2>

        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input required autoFocus value={f.name ?? ""} onChange={set("name")} />
          </label>
          <label className="field">
            <span>Username</span>
            <input
              required
              disabled={!!user}
              pattern="[a-zA-Z0-9._\-]{3,32}"
              title="3–32 letters, numbers, dots or dashes"
              value={f.username ?? ""}
              onChange={set("username")}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Title</span>
            <input value={f.title ?? ""} onChange={set("title")} placeholder="e.g. Developer" />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={f.role} onChange={set("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {f.role === "developer" && (
          <div className="field">
            <span>Assigned projects {picked.length > 0 && <b>{picked.length}</b>}</span>
            <div className="choice wrap" role="group" aria-label="Assigned projects">
              {systems.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={picked.includes(s.id)}
                  className={picked.includes(s.id) ? "on" : ""}
                  onClick={() =>
                    setF((v) => ({
                      ...v,
                      projectIds: picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id],
                    }))
                  }
                >
                  {picked.includes(s.id) && <Check size={14} />} {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span>Email</span>
            <input type="email" value={f.email ?? ""} onChange={set("email")} placeholder="name.surname@omnicontact.biz" />
          </label>
          <label className="field">
            <span>Phone</span>
            <input type="tel" value={f.phone ?? ""} onChange={set("phone")} placeholder="+263 77 123 4567" />
          </label>
        </div>
        <label className="field">
          <span>
            {user ? "Set a temporary password (leave blank to keep); they choose their own at sign-in" : "Password (8+ characters)"}
          </span>
          <input
            type="text"
            autoComplete="off"
            required={!user}
            minLength={8}
            value={f.password ?? ""}
            onChange={set("password")}
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            {user ? "Save" : "Add user"}
          </button>
        </div>
      </form>
    </div>
  );
}
