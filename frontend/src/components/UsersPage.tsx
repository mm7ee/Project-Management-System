import { useEffect, useState } from "react";
import { AlertOctagon, Check, Copy, Fingerprint, KeyRound, LifeBuoy, Pencil, Plus, ShieldCheck, ShieldOff, Smartphone, Trash2, X } from "lucide-react";
import { api, type MfaHelpRequest } from "../data/api";
import { initials, type System } from "../data/systems";
import { timeAgo } from "../time";
import {
  PERMISSIONS,
  ROLES,
  ROLE_LABEL,
  MFA_EXEMPT_USER,
  mfaRequiredFor,
  type Permission,
  type MfaPolicy,
  type Role,
  type RolePermissions,
  type User,
} from "../data/roles";
import type { Limits, Workload } from "../data/project";
import PasswordRules, { generatePassword } from "./PasswordRules";
import ShareLinks from "./ShareLinks";
import { PASSWORD_MIN, passwordProblem } from "../data/password";

interface Props {
  me: User;
  users: User[];
  systems: System[];
  roleMatrix: RolePermissions;
  limits: Limits;
  mfaPolicy: MfaPolicy;
  mfaHelp: MfaHelpRequest[]; // people locked out of two-step verification
  workload: (u: User) => Workload;
  onChanged: () => Promise<void>;
  section: "people" | "twostep" | "links" | "limits" | "roles"; // which part Settings is showing
}

export default function UsersPage({ me, users, systems, roleMatrix, limits, mfaPolicy, mfaHelp, workload, onChanged, section }: Props) {
  const now = Date.now();
  const [mfaResetting, setMfaResetting] = useState<string | null>(null);
  const [confirmHelp, setConfirmHelp] = useState<string | null>(null);
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
      {section === "people" && (
      <header className="page-head">
        <div>
          <h2>People</h2>
          <p>{users.length} people can sign in. Developers can be on up to {limits.projects} projects each.</p>
        </div>
        <button className="btn btn-amber" onClick={() => setEditing("new")}>
          <Plus size={17} strokeWidth={3} /> Add user
        </button>
      </header>
      )}
      {error && <p className="form-error banner">{error}</p>}

      {section === "people" && (
      <>
      {mfaHelp.length > 0 && (
        <section className="set-card mfa-requests" aria-label="Two-step verification help requests">
          <header className="set-head">
            <span className="set-icon">
              <LifeBuoy size={18} />
            </span>
            <div>
              <h3>Locked out of two-step verification</h3>
              <p>
                They signed in with the right password but have lost their phone, recovery codes and passkeys. <b>Confirm it's really them</b> (a call to a
                number you already have, or in person) before resetting. A reset signs them out everywhere; they set it up again at next sign-in.
              </p>
            </div>
          </header>
          <ul>
            {mfaHelp.map((h) => (
              <li key={h.id}>
                <span className="avatar">{initials(h.name)}</span>
                <span className="mfa-request-text">
                  <b>{h.name}</b>
                  <small>
                    Asked {timeAgo(h.createdAt, now)}
                    {h.ip ? ` · from ${h.ip}` : ""}
                  </small>
                  {h.message && <q>{h.message}</q>}
                </span>
                {confirmHelp === h.id ? (
                  <span className="page-actions">
                    <button className="btn btn-ghost sm" onClick={() => setConfirmHelp(null)}>
                      Cancel
                    </button>
                    <button className="btn btn-navy sm" onClick={() => run(() => api(`/users/${h.userId}/mfa`, "DELETE")).then(() => setConfirmHelp(null))}>
                      Yes, I've confirmed it's them: reset
                    </button>
                  </span>
                ) : (
                  <span className="page-actions">
                    <button className="btn btn-ghost sm" onClick={() => run(() => api(`/mfa-help/${h.id}`, "DELETE"))} title="Not genuine, or no longer needed">
                      Dismiss
                    </button>
                    <button className="btn btn-navy sm" onClick={() => setConfirmHelp(h.id)}>
                      <ShieldOff size={14} /> Reset two-step
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Assigned projects</th>
              <th>Workload</th>
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
                  {u.mfaEnabled ? (
                    <span
                      className="flag flag-mfa"
                      title={`Two-step with ${(u.mfaMethods ?? ["app"]).map((m) => (m === "app" ? "an authenticator app" : "a passkey")).join(" and ")}`}
                    >
                      <ShieldCheck size={12} /> 2-step on
                      {u.mfaMethods?.includes("app") && <Smartphone size={11} aria-label="authenticator app" />}
                      {u.mfaMethods?.includes("passkey") && <Fingerprint size={11} aria-label="passkey" />}
                    </span>
                  ) : (
                    mfaRequiredFor(u, mfaPolicy) && <span className="flag flag-request">2-step required, not set up</span>
                  )}
                </td>
                <td>{u.role === "developer" ? projectNames(u.projectIds) || <i className="muted">Not assigned</i> : "—"}</td>
                <td>
                  {u.role === "developer"
                    ? (() => {
                        const w = workload(u);
                        return (
                          <span className="workload-cell">
                            <span>
                              {w.projects} project{w.projects === 1 ? "" : "s"} · {w.openFeatures} request{w.openFeatures === 1 ? "" : "s"}
                            </span>
                            {w.overloaded && (
                              <span className="flag flag-overload" title={w.reasons.join("; ")}>
                                <AlertOctagon size={12} /> Overloaded
                              </span>
                            )}
                          </span>
                        );
                      })()
                    : "—"}
                </td>
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
                    ) : mfaResetting === u.id ? (
                      <>
                        <span className="confirm-inline">Reset {u.name}'s two-step verification? They'll be signed out and set it up again.</span>
                        <button className="btn btn-ghost sm" onClick={() => setMfaResetting(null)}>
                          Cancel
                        </button>
                        <button className="btn btn-navy sm" onClick={() => run(() => api(`/users/${u.id}/mfa`, "DELETE")).then(() => setMfaResetting(null))}>
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
                        {u.id !== me.id && u.mfaEnabled && (
                          <button
                            className="icon-link"
                            onClick={() => {
                              setResetting(null);
                              setDeleting(null);
                              setMfaResetting(u.id);
                            }}
                            aria-label={`Reset ${u.name}'s two-step verification`}
                            title="Reset two-step verification (lost phone)"
                          >
                            <ShieldOff size={15} />
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
      </>
      )}

      {section === "twostep" && <MfaPolicyEditor me={me} policy={mfaPolicy} users={users} onSave={(p) => run(() => api("/settings/mfa", "PUT", p))} />}

      {section === "links" && <ShareLinks />}

      {section === "limits" && <LimitsEditor limits={limits} onSave={(l) => run(() => api("/settings/limits", "PUT", l))} />}

      {section === "roles" && <RoleMatrix matrix={roleMatrix} onSave={(m) => run(() => api("/roles", "PUT", m))} />}

      {issued && <TempPasswordDialog {...issued} onClose={() => setIssued(null)} />}

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          systems={systems}
          limit={limits.projects}
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

/** Which roles must sign in with two-step verification. */
function MfaPolicyEditor({ me, policy, users, onSave }: { me: User; policy: MfaPolicy; users: User[]; onSave: (p: MfaPolicy) => Promise<boolean> }) {
  const [draft, setDraft] = useState<Role[]>(policy.roles);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(policy.roles), [policy]);
  const dirty = [...draft].sort().join() !== [...policy.roles].sort().join();
  const pending = (r: Role) => users.filter((u) => u.role === r && !u.mfaEnabled && u.id !== MFA_EXEMPT_USER).length;
  return (
    <section className="matrix-section">
      <header className="page-head">
        <div>
          <h2>Two-step rules</h2>
          <p>
            Required roles sign in with a password and a code from an authenticator app. Anyone without it set up is asked to set it
            up before they can do anything else; everyone else can turn it on in Settings.
          </p>
        </div>
        <button className="btn btn-navy" disabled={!dirty} onClick={async () => setSaved(await onSave({ roles: draft }))}>
          {saved && !dirty ? "Saved" : "Save"}
        </button>
      </header>
      <p className="set-note">The default admin account is the one exception: two-step verification is optional for it.</p>
      <div className="set-card mfa-policy">
        {ROLES.map((r) => (
          <label key={r} className="mfa-check">
            <input
              type="checkbox"
              checked={draft.includes(r)}
              // Requiring it for your own role before you have it would lock you out of this page.
              disabled={r === me.role && !me.mfaEnabled && me.id !== MFA_EXEMPT_USER && !draft.includes(r)}
              onChange={() => {
                setSaved(false);
                setDraft((d) => (d.includes(r) ? d.filter((x) => x !== r) : [...d, r]));
              }}
            />
            Require for {ROLE_LABEL[r]}s
            {r === me.role && !me.mfaEnabled && me.id !== MFA_EXEMPT_USER && <em className="muted"> · turn it on for yourself in Settings first</em>}
            <small>
              {users.filter((u) => u.role === r).length - pending(r)} of {users.filter((u) => u.role === r).length} set up
            </small>
          </label>
        ))}
      </div>
    </section>
  );
}

/** When developers are flagged as overloaded and projects as stalled. */
function LimitsEditor({ limits, onSave }: { limits: Limits; onSave: (l: Limits) => Promise<boolean> }) {
  const [draft, setDraft] = useState(limits);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(limits), [limits]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(limits);
  const field = (k: keyof Limits, label: string, hint: string, max: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        required
        value={draft[k]}
        onChange={(e) => {
          setSaved(false);
          setDraft((d) => ({ ...d, [k]: Number(e.target.value) }));
        }}
      />
      <small className="field-hint">{hint}</small>
    </label>
  );
  return (
    <section className="matrix-section">
      <header className="page-head">
        <div>
          <h2>Workload & stall limits</h2>
          <p>Nobody can be assigned more projects than the limit, and anyone already over it is flagged. Projects still being built without a progress update for too long are flagged as stalled.</p>
        </div>
        <button className="btn btn-navy" disabled={!dirty} onClick={async () => setSaved(await onSave(draft))}>
          {saved && !dirty ? "Saved" : "Save limits"}
        </button>
      </header>
      <div className="limits-grid set-card">
        {field("projects", "Projects per developer", "Every project they're on, live ones included. Nobody can be given more.", 50)}
        {field("features", "Open feature requests per developer", "Requests not yet completed or cancelled.", 200)}
        {field("stallDays", "Days without progress before \"stalled\"", "Counted from the last progress update.", 365)}
      </div>
    </section>
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
  limit,
  onSave,
  onClose,
}: {
  user: User | null;
  systems: System[];
  limit: number; // most projects a developer may have
  onSave: (u: UserForm) => Promise<boolean>;
  onClose: () => void;
}) {
  const [f, setF] = useState<UserForm>(
    user ? { ...user, password: "" } : { role: "viewer", name: "", username: "", title: "", email: "", phone: "", password: "" },
  );
  const set = (k: keyof UserForm) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  // Only projects that still exist count; at the limit, the rest can't be ticked.
  const picked = (f.projectIds ?? []).filter((id) => systems.some((s) => s.id === id));
  const atLimit = picked.length >= limit;

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
            <span>
              Assigned projects{" "}
              <b className={picked.length > limit ? "text-red" : ""}>
                {picked.length}/{limit}
              </b>
            </span>
            <div className="choice wrap" role="group" aria-label="Assigned projects">
              {systems.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={picked.includes(s.id)}
                  className={picked.includes(s.id) ? "on" : ""}
                  disabled={atLimit && !picked.includes(s.id)}
                  title={atLimit && !picked.includes(s.id) ? `A developer can be on at most ${limit} projects` : undefined}
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
            {atLimit && (
              <small className={picked.length > limit ? "form-warn" : "field-hint"}>
                {picked.length > limit
                  ? `Over the limit of ${limit}. Untick ${picked.length - limit} to save, or hand projects over from the dashboard's Rebalance.`
                  : `That's the limit of ${limit} projects. Untick one to choose another.`}
              </small>
            )}
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
        <div className="field">
          <span>
            {user
              ? "Set a temporary password (leave blank to keep). They choose their own at their next sign-in."
              : "Temporary password. They choose their own at first sign-in."}
          </span>
          <div className="pw-issue">
            <input
              type="text"
              autoComplete="off"
              required={!user}
              minLength={PASSWORD_MIN}
              value={f.password ?? ""}
              onChange={set("password")}
              aria-label="Temporary password"
            />
            <button type="button" className="btn btn-ghost sm" onClick={() => setF((v) => ({ ...v, password: generatePassword() }))}>
              <KeyRound size={14} /> Generate
            </button>
          </div>
          {(!user || f.password) && <PasswordRules password={f.password ?? ""} who={{ username: f.username, name: f.name }} />}
          {f.password && <small className="field-hint">Give it to them privately; it's only shown here.</small>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber" disabled={!!f.password && !!passwordProblem(f.password, { username: f.username, name: f.name })}>
            {user ? "Save" : "Add user"}
          </button>
        </div>
      </form>
    </div>
  );
}
