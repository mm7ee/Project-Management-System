/** @import { Role, User } from '../data/roles' */
/** @import { WorkspaceIcon } from '../data/orgAdmin' */
/** @import { LucideIcon } from 'lucide-react' */
// Settings → Organisation (Organisation Administrators only): the organisation's profile, its workspaces, its people
// and their role in each workspace, and the administration audit log. Each is its own page in the Settings menu
// (`section`). Everything here applies across the organisation; the Worker checks every change again.
import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  Building2,
  Code,
  FileUp,
  FlaskConical,
  FolderKanban,
  Headset,
  History,
  Layers,
  LayoutTemplate,
  Mail,
  Megaphone,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import { ApiError, api } from "../data/api";
import { ROLES, ROLE_LABEL } from "../data/roles";
import { AUDIT_ACTIONS, WEEKDAYS, WORKSPACE_ICONS } from "../data/orgAdmin";
import { formatDate } from "../time";
import Panel from "./Panel";
import { Empty, Help, ToastProvider, useConfirm, useToast } from "./AdminKit";
import BrandingSettings from "./BrandingSettings";

/**
 * @typedef {{ id: string; name: string; key: string; status: "active" | "archived"; members: number; icon: WorkspaceIcon; colour?: string; description: string; visibility: "private" | "organization" }} Workspace
 * @typedef {{ workspaceId: string; role: Role }} Membership
 * @typedef {{ id: string; username: string; name: string; title: string; email?: string; orgAdmin: boolean; mustChangePassword?: boolean; locked?: boolean; deactivated?: boolean; invited?: "pending" | "expired"; workspaces: Membership[] }} Person
 * @typedef {{ organization: { id: string; name: string; code: string }; workspaces: Workspace[]; people: Person[] }} Org
 * @typedef {"profile" | "branding" | "workspaces" | "people" | "audit" | "workspace-audit" | "templates"} OrgSection
 */

/** @type {Record<WorkspaceIcon, LucideIcon>} */ export const WORKSPACE_ICON = {
  layers: Layers,
  code: Code,
  megaphone: Megaphone,
  users: Users,
  briefcase: Briefcase,
  wallet: Wallet,
  headset: Headset,
  "folder-kanban": FolderKanban,
  "flask-conical": FlaskConical,
  "building-2": Building2,
};

/** A workspace key from its name: "Human Resources" → "HR", "Finance" → "FINANCE". */
const keyFrom = /** @param {string} name */ (name) => {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const k = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return k.replace(/^[0-9]+/, "").slice(0, 10);
};
const message = /** @param {unknown} e @param {string} fallback */ (e, fallback) => (e instanceof Error ? e.message : fallback);

/** @param {{ me: User; section: OrgSection }} p */
export default function OrgAdmin({ me, section }) {
  return (
    <ToastProvider>
      <OrgPage me={me} section={section} />
    </ToastProvider>
  );
}

/** @param {{ me: User; section: OrgSection }} p */
function OrgPage({ me, section }) {
  const [org, setOrg] = useState(/** @type {Org | null} */ (null));
  const [error, setError] = useState("");
  const toast = useToast();
  const reload = async () => {
    try {
      setOrg(/** @type {Org} */ (await api("/org")));
    } catch (e) {
      setError(message(e, "Couldn't load the organisation"));
    }
  };
  useEffect(() => {
    if (section !== "workspace-audit") reload();
  }, [section]);
  /** Runs a change, then says how it went and reloads. @param {() => Promise<unknown>} fn @param {string} [done] */
  const act = async (fn, done) => {
    try {
      await fn();
      if (done) toast(done);
      await reload();
      return true;
    } catch (e) {
      toast(message(e, "That didn't work"), false);
      return false;
    }
  };
  if (section === "workspace-audit") return <AuditLog workspaces={[]} own />;
  if (!org) return <p className="muted">{error || "Loading…"}</p>;
  const active = org.workspaces.filter((w) => w.status === "active");
  return (
    <div className="org-admin">
      <p className="muted">
        {org.organization.name} · sign-in code <code>{org.organization.code}</code>. Changes here apply to the whole organisation.
      </p>
      {section === "profile" && <Profile />}
      {section === "branding" && <BrandingSettings orgName={org.organization.name} />}
      {section === "workspaces" && <Workspaces org={org} act={act} />}
      {section === "people" && <People org={org} active={active} me={me} act={act} />}
      {section === "audit" && <AuditLog workspaces={org.workspaces} />}
      {section === "templates" && <Templates org={org} />}
    </div>
  );
}

// ---------- the organisation profile ----------

/** @typedef {{ name: string; code: string; timeZone: string; workDays: number[]; workStart: string; workEnd: string; contactEmail: string | null }} Profile */

function Profile() {
  const toast = useToast();
  const [p, setP] = useState(/** @type {Profile | null} */ (null));
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => {
    try {
      return /** @type {string[]} */ (/** @type {any} */ (Intl).supportedValuesOf("timeZone"));
    } catch {
      return ["Africa/Harare", "Africa/Johannesburg", "Africa/Nairobi", "Africa/Lagos", "Europe/London", "UTC"];
    }
  }, []);
  useEffect(() => {
    api("/org/profile")
      .then((r) => setP(/** @type {{ profile: Profile }} */ (r).profile))
      .catch((e) => toast(message(e, "Couldn't load the profile"), false));
  }, []);
  if (!p) return <p className="muted">Loading…</p>;
  return (
    <Panel title="Organisation profile" icon={Building2}>
      <Help>Working hours and the time zone drive schedules, digests and SLA clocks. The logo, colours and display name are under Branding.</Help>
      <form
        className="org-new"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            const r = /** @type {{ profile: Profile }} */ (
              await api("/org/profile", "PUT", { timeZone: p.timeZone, workDays: p.workDays, workStart: p.workStart, workEnd: p.workEnd, contactEmail: p.contactEmail })
            );
            setP(r.profile);
            toast("The profile is saved.");
          } catch (err) {
            toast(message(err, "Couldn't save"), false);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="org-grid">
          <label className="field">
            Time zone
            <input list="org-zones" value={p.timeZone} onChange={(e) => setP({ ...p, timeZone: e.target.value })} required />
            <datalist id="org-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <small className="muted">Schedules, digests and SLA clocks run in this time zone.</small>
          </label>
          <label className="field">
            Contact email
            <input type="email" value={p.contactEmail ?? ""} onChange={(e) => setP({ ...p, contactEmail: e.target.value || null })} placeholder="it@yourcompany.com" />
          </label>
        </div>
        <fieldset className="org-fieldset">
          <legend>Working days</legend>
          {WEEKDAYS.map(([d, label]) => (
            <label key={d} className="org-check">
              <input
                type="checkbox"
                checked={p.workDays.includes(d)}
                onChange={(e) => setP({ ...p, workDays: e.target.checked ? [...p.workDays, d].sort() : p.workDays.filter((x) => x !== d) })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="org-grid">
          <label className="field">
            Working day starts
            <input type="time" value={p.workStart} onChange={(e) => setP({ ...p, workStart: e.target.value })} required />
          </label>
          <label className="field">
            Working day ends
            <input type="time" value={p.workEnd} onChange={(e) => setP({ ...p, workEnd: e.target.value })} required />
          </label>
        </div>
        <div className="org-row">
          <button className="btn btn-navy sm" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

// ---------- workspaces ----------

/** @param {{ org: Org; act: (fn: () => Promise<unknown>, done?: string) => Promise<boolean> }} p */
function Workspaces({ org, act }) {
  const [editing, setEditing] = useState(/** @type {Workspace | "new" | null} */ (null));
  const [dialog, ask] = useConfirm();
  return (
    <Panel
      title="Workspaces"
      icon={Layers}
      action={
        editing === null && (
          <button className="btn btn-navy sm" onClick={() => setEditing("new")}>
            <Plus size={15} /> Add workspace
          </button>
        )
      }
    >
      {dialog}
      <Help>Each workspace has its own projects, work items, workflow, fields and automation. Nothing in one is visible from another.</Help>
      {editing && <WorkspaceForm org={org} ws={editing === "new" ? null : editing} act={act} onDone={() => setEditing(null)} />}
      <div className="org-table-wrap">
        <table className="org-table">
          <thead>
            <tr>
              <th scope="col">Workspace</th>
              <th scope="col">Key</th>
              <th scope="col">Visibility</th>
              <th scope="col" className="num">
                Members
              </th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {org.workspaces.map((w) => {
              const Icon = WORKSPACE_ICON[w.icon] ?? Layers;
              return (
                <tr key={w.id}>
                  <th scope="row">
                    <span className="org-ws">
                      <span className="org-ws-icon" style={w.colour ? { background: w.colour } : undefined} aria-hidden="true">
                        <Icon size={14} />
                      </span>
                      <span>
                        {w.name}
                        {w.description && <span className="muted org-sub"> {w.description}</span>}
                      </span>
                    </span>
                  </th>
                  <td>
                    <code>{w.key}</code>
                  </td>
                  <td>{w.visibility === "organization" ? "Whole organisation (read-only)" : "Members only"}</td>
                  <td className="num">{w.members}</td>
                  <td>{w.status === "active" ? "Active" : "Archived"}</td>
                  <td className="org-actions">
                    <button className="btn btn-ghost sm" aria-label={`Edit ${w.name}`} onClick={() => setEditing(w)}>
                      <Pencil size={14} /> Edit
                    </button>
                    {w.status === "active" ? (
                      <button
                        className="btn btn-ghost sm"
                        onClick={async () => {
                          const ok = await ask({ title: `Archive ${w.name}?`, body: "Nobody can open it until it's reactivated. Nothing in it is deleted.", confirm: "Archive", danger: true });
                          if (ok) act(() => api(`/org/workspaces/${w.id}`, "PATCH", { status: "archived" }), `${w.name} is archived.`);
                        }}
                      >
                        Archive
                      </button>
                    ) : (
                      <button className="btn btn-ghost sm" onClick={() => act(() => api(`/org/workspaces/${w.id}`, "PATCH", { status: "active" }), `${w.name} is active again.`)}>
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** @param {{ org: Org; ws: Workspace | null; act: (fn: () => Promise<unknown>, done?: string) => Promise<boolean>; onDone: () => void }} p */
function WorkspaceForm({ org, ws, act, onDone }) {
  const [f, setF] = useState({
    name: ws?.name ?? "",
    key: ws?.key ?? "",
    icon: ws?.icon ?? /** @type {WorkspaceIcon} */ ("layers"),
    colour: ws?.colour ?? "",
    description: ws?.description ?? "",
    visibility: ws?.visibility ?? /** @type {"private" | "organization"} */ ("private"),
    cloneFrom: "",
  });
  const [keyTouched, setKeyTouched] = useState(!!ws);
  const [templates, setTemplates] = useState(/** @type {TemplateList | null} */ (null));
  useEffect(() => {
    if (!ws) api("/org/templates").then((r) => setTemplates(/** @type {TemplateList} */ (r))).catch(() => setTemplates(null));
  }, [ws]);
  return (
    <form
      className="org-new org-boxed"
      aria-label={ws ? `Edit ${ws.name}` : "New workspace"}
      onSubmit={async (e) => {
        e.preventDefault();
        const payload = { name: f.name, key: f.key, icon: f.icon, colour: f.colour || null, description: f.description, visibility: f.visibility };
        // "Start from": a template ("builtin:…" or "org:…") or another workspace's id.
        const start = f.cloneFrom.startsWith("builtin:") || f.cloneFrom.startsWith("org:") ? { template: f.cloneFrom } : f.cloneFrom ? { cloneFrom: f.cloneFrom } : {};
        const ok = ws
          ? await act(() => api(`/org/workspaces/${ws.id}`, "PATCH", payload), `${f.name} is saved.`)
          : await act(() => api("/org/workspaces", "POST", { ...payload, ...start }), `${f.name} is ready. You're its administrator.`);
        if (ok) onDone();
      }}
    >
      <div className="org-grid">
        <label className="field">
          Name
          <input
            required
            maxLength={40}
            value={f.name}
            placeholder="e.g. Marketing"
            onChange={(e) => setF({ ...f, name: e.target.value, ...(keyTouched ? {} : { key: keyFrom(e.target.value) }) })}
          />
        </label>
        <label className="field">
          Key
          <input
            required
            pattern="[A-Z][A-Z0-9]{1,9}"
            maxLength={10}
            value={f.key}
            onChange={(e) => {
              setKeyTouched(true);
              setF({ ...f, key: e.target.value.toUpperCase() });
            }}
            aria-describedby="ws-key-help"
          />
          <small id="ws-key-help" className="muted">
            2–10 capitals or digits, such as MKT.
          </small>
        </label>
        <label className="field">
          Colour
          <span className="org-colour">
            <input type="color" value={f.colour || "#1f6feb"} onChange={(e) => setF({ ...f, colour: e.target.value })} aria-label="Workspace colour" />
            {f.colour && (
              <button type="button" className="btn btn-ghost sm" onClick={() => setF({ ...f, colour: "" })}>
                Clear
              </button>
            )}
          </span>
        </label>
        <label className="field">
          Visibility
          <select value={f.visibility} onChange={(e) => setF({ ...f, visibility: /** @type {"private" | "organization"} */ (e.target.value) })}>
            <option value="private">Members only</option>
            <option value="organization">Whole organisation (read-only for non-members)</option>
          </select>
        </label>
      </div>
      <label className="field">
        Description
        <input maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What this workspace is for" />
      </label>
      <fieldset className="org-fieldset" aria-label="Icon">
        <legend>Icon</legend>
        {WORKSPACE_ICONS.map((i) => {
          const Icon = WORKSPACE_ICON[i];
          return (
            <label key={i} className={`org-icon-pick ${f.icon === i ? "on" : ""}`}>
              <input type="radio" name="ws-icon" className="sr-only" checked={f.icon === i} onChange={() => setF({ ...f, icon: i })} />
              <Icon size={16} aria-hidden="true" />
              <span className="sr-only">{i}</span>
            </label>
          );
        })}
      </fieldset>
      {!ws && (
        <label className="field">
          Start from
          <select
            value={f.cloneFrom}
            onChange={(e) => {
              const v = e.target.value;
              // A built-in template suggests its icon (and a key, if none is typed yet).
              const t = templates?.builtIn.find((x) => x.id === v);
              setF({ ...f, cloneFrom: v, ...(t ? { icon: /** @type {WorkspaceIcon} */ (t.icon), ...(!f.key ? { key: t.key } : {}) } : {}) });
            }}
          >
            <option value="">A blank workspace (the organisation's default workflow)</option>
            {templates && (
              <optgroup label="Templates">
                {[...templates.builtIn, ...templates.organisation].map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="A copy of a workspace's set-up (no work)">
              {org.workspaces
                .filter((w) => w.status === "active")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </optgroup>
          </select>
          <small className="muted">
            {(() => {
              const t = templates && [...templates.builtIn, ...templates.organisation].find((x) => x.id === f.cloneFrom);
              if (t) return `${t.statuses.join(" → ")}. Types: ${t.itemTypes.join(", ")}.${t.fields.length ? ` Fields: ${t.fields.join(", ")}.` : ""} Everything can be changed afterwards.`;
              return f.cloneFrom ? "Its workflows, item types, fields and automation rules (switched off, to check first). No projects or work items." : "";
            })()}
          </small>
        </label>
      )}
      <div className="org-row">
        <button className="btn btn-navy sm">{ws ? "Save" : "Add workspace"}</button>
        <button type="button" className="btn btn-ghost sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- people ----------

/** @param {{ org: Org; active: Workspace[]; me: User; act: (fn: () => Promise<unknown>, done?: string) => Promise<boolean> }} p */
function People({ org, active, me, act }) {
  const [mode, setMode] = useState(/** @type {"" | "invite" | "temp" | "import"} */ (""));
  const [handover, setHandover] = useState(/** @type {{ title: string; lines: { who: string; secret: string }[] } | null} */ (null));
  const [dialog, ask] = useConfirm();
  const toast = useToast();
  /** A person's role in a workspace, or "" for not in it. */
  const roleIn = /** @param {Person} p @param {string} w */ (p, w) => p.workspaces.find((m) => m.workspaceId === w)?.role ?? "";
  const setRole = /** @param {Person} p @param {string} w @param {Role | ""} role */ (p, w, role) => {
    const rest = p.workspaces.filter((m) => m.workspaceId !== w);
    const next = role ? [...rest, { workspaceId: w, role }] : rest;
    if (!next.length) return toast(`${p.name} must stay in at least one workspace. To take them out of the organisation, use Remove.`, false);
    act(() => api(`/org/people/${p.id}/workspaces`, "PUT", { workspaces: next }), role ? `${p.name}'s role is saved.` : `${p.name} is no longer in that workspace.`);
  };
  const status = /** @param {Person} p */ (p) =>
    [p.deactivated && "deactivated", p.invited === "pending" && "invited", p.invited === "expired" && "invitation expired", p.mustChangePassword && "temporary password", p.locked && "locked"].filter(Boolean).join(" · ");
  return (
    <Panel
      title="Members and roles"
      icon={Users}
      action={
        !mode && (
          <span className="org-row">
            <button className="btn btn-navy sm" onClick={() => setMode("invite")}>
              <Mail size={15} /> Invite by email
            </button>
            <button className="btn btn-ghost sm" onClick={() => setMode("import")}>
              <FileUp size={15} /> Import CSV
            </button>
            <button className="btn btn-ghost sm" onClick={() => setMode("temp")}>
              <Plus size={15} /> Add with a temporary password
            </button>
          </span>
        )
      }
    >
      {dialog}
      <Help>
        Choose each person's role in each workspace. <b>Viewer</b> can only read; <b>Administrator</b> runs that workspace. Organisation Administrators manage workspaces, people and organisation settings.
      </Help>
      {handover && (
        <div className="org-handover" role="status">
          <p>{handover.title}</p>
          {handover.lines.map((l) => (
            <p key={l.who}>
              <b>{l.who}</b>: <code>{l.secret}</code>
            </p>
          ))}
          <button className="btn btn-ghost sm" onClick={() => setHandover(null)}>
            Done
          </button>
        </div>
      )}
      {mode === "invite" && (
        <NewPerson
          active={active}
          invite
          onCancel={() => setMode("")}
          onMade={(r) => {
            setMode("");
            if (r.link) setHandover({ title: "Email isn't set up, so send them this link yourself, through a safe channel. It works once, within 72 hours, and is shown only now.", lines: [{ who: r.username, secret: r.link }] });
            act(async () => undefined, r.link ? `${r.username} is added.` : `Invitation sent. Their username is ${r.username}.`);
          }}
        />
      )}
      {mode === "temp" && (
        <NewPerson
          active={active}
          onCancel={() => setMode("")}
          onMade={(r) => {
            setMode("");
            setHandover({ title: "Give them this temporary password through a safe channel. It's shown only now; they choose their own at the first sign-in.", lines: [{ who: r.username, secret: r.temporaryPassword ?? "" }] });
            act(async () => undefined, `${r.username} is added.`);
          }}
        />
      )}
      {mode === "import" && (
        <ImportPeople
          onCancel={() => setMode("")}
          onMade={(made) => {
            setMode("");
            const links = made.filter((m) => m.link);
            if (links.length) setHandover({ title: "Email isn't set up, so send each person their link yourself. Each works once, within 72 hours, and is shown only now.", lines: links.map((m) => ({ who: m.username, secret: m.link ?? "" })) });
            act(async () => undefined, `${made.length} ${made.length === 1 ? "person" : "people"} invited.`);
          }}
        />
      )}
      {org.people.length === 0 ? (
        <Empty title="Nobody here yet">Invite people by email, or import a CSV file.</Empty>
      ) : (
        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                {active.map((w) => (
                  <th scope="col" key={w.id}>
                    {w.name}
                  </th>
                ))}
                <th scope="col">Organisation admin</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {org.people.map((p) => (
                <tr key={p.id} className={p.deactivated ? "org-off" : ""}>
                  <th scope="row">
                    {p.name}
                    <span className="muted org-sub">
                      {" "}
                      {p.username}
                      {status(p) && ` · ${status(p)}`}
                    </span>
                  </th>
                  {active.map((w) => (
                    <td key={w.id}>
                      <select aria-label={`${p.name}'s role in ${w.name}`} value={roleIn(p, w.id)} onChange={(e) => setRole(p, w.id, /** @type {Role | ""} */ (e.target.value))}>
                        <option value="">Not in it</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${p.name} is an Organisation Administrator`}
                      checked={p.orgAdmin}
                      onChange={(e) => act(() => api(`/org/people/${p.id}`, "PATCH", { orgAdmin: e.target.checked }), e.target.checked ? `${p.name} is now an Organisation Administrator.` : `${p.name} is no longer an Organisation Administrator.`)}
                    />
                  </td>
                  <td className="org-actions">
                    {p.id !== me.id &&
                      (p.deactivated ? (
                        <button className="btn btn-ghost sm" onClick={() => act(() => api(`/org/people/${p.id}/reactivate`, "POST"), `${p.name} can sign in again.`)}>
                          <UserCheck size={14} /> Reactivate
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost sm"
                          onClick={async () => {
                            const ok = await ask({ title: `Deactivate ${p.name}?`, body: "They're signed out at once and can't sign in. Their history, workspaces and assignments stay, and you can reactivate them later.", confirm: "Deactivate", danger: true });
                            if (ok) act(() => api(`/org/people/${p.id}/deactivate`, "POST"), `${p.name} is deactivated.`);
                          }}
                        >
                          <UserX size={14} /> Deactivate
                        </button>
                      ))}
                    {p.id !== me.id && (
                      <button
                        className="btn btn-ghost sm"
                        aria-label={`Remove ${p.name} from the organisation`}
                        onClick={async () => {
                          const ok = await ask({ title: `Remove ${p.name}?`, body: "Their account goes for good; what they did stays, shown as a former user. To keep the account, deactivate them instead.", confirm: "Remove", danger: true, typed: p.username });
                          if (ok) act(() => api(`/org/people/${p.id}`, "DELETE"), `${p.name} is removed.`);
                        }}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** @param {{ active: Workspace[]; invite?: boolean; onCancel: () => void; onMade: (r: { username: string; temporaryPassword?: string; link?: string }) => void }} p */
function NewPerson({ active, invite = false, onCancel, onMade }) {
  const [form, setForm] = useState({ username: "", name: "", title: "", email: "", orgAdmin: false });
  const [roles, setRoles] = useState(/** @type {Record<string, Role | "">} */ ({ [active[0]?.id ?? ""]: "developer" }));
  const [error, setError] = useState("");
  return (
    <form
      className="org-new org-boxed"
      aria-label={invite ? "Invite by email" : "Add with a temporary password"}
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        const workspaces = Object.entries(roles)
          .filter(([, r]) => r)
          .map(([workspaceId, role]) => ({ workspaceId, role }));
        try {
          if (invite) {
            const r = /** @type {{ username: string; link?: string }} */ (await api("/org/invites", "POST", { ...form, username: form.username || undefined, workspaces }));
            onMade(r);
          } else {
            const r = /** @type {{ temporaryPassword: string }} */ (await api("/org/people", "POST", { ...form, workspaces }));
            onMade({ username: form.username, temporaryPassword: r.temporaryPassword });
          }
        } catch (err) {
          setError(message(err, "Couldn't add them"));
        }
      }}
    >
      <div className="org-grid">
        <label className="field">
          Email{invite ? "" : " (optional)"}
          <input type="email" required={invite} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="field">
          Full name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          Username{invite ? " (optional)" : ""}
          <input required={!invite} pattern="[a-z0-9._-]{3,32}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder={invite ? "From their email" : ""} />
        </label>
        <label className="field">
          Title (optional)
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
      </div>
      <fieldset className="org-fieldset">
        <legend>Workspaces and roles</legend>
        {active.map((w) => (
          <label key={w.id} className="org-role">
            <span>{w.name}</span>
            <select value={roles[w.id] ?? ""} onChange={(e) => setRoles({ ...roles, [w.id]: /** @type {Role | ""} */ (e.target.value) })}>
              <option value="">Not in it</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <label className="org-check">
        <input type="checkbox" checked={form.orgAdmin} onChange={(e) => setForm({ ...form, orgAdmin: e.target.checked })} /> Organisation Administrator (manages workspaces, people and organisation settings)
      </label>
      {error && (
        <p className="org-error" role="alert">
          {error}
        </p>
      )}
      <div className="org-row">
        <button className="btn btn-navy sm">{invite ? "Send invitation" : "Add and get a temporary password"}</button>
        <button type="button" className="btn btn-ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** @typedef {{ line: number; name: string; username: string; email: string; emailed?: boolean; link?: string; workspaces?: Record<string, Role> }} ImportRow */

/** @param {{ onCancel: () => void; onMade: (made: ImportRow[]) => void }} p */
function ImportPeople({ onCancel, onMade }) {
  const [csv, setCsv] = useState("");
  const [checked, setChecked] = useState(/** @type {ImportRow[] | null} */ (null));
  const [problems, setProblems] = useState(/** @type {{ line: number; problem: string }[]} */ ([]));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** @param {boolean} check */
  const send = async (check) => {
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const r = /** @type {{ people: ImportRow[] }} */ (await api("/org/people/import", "POST", { csv, check }));
      if (check) setChecked(r.people);
      else onMade(r.people);
    } catch (e) {
      setChecked(null);
      setError(message(e, "Couldn't read the file"));
      if (e instanceof ApiError && Array.isArray(e.payload.problems)) setProblems(/** @type {{ line: number; problem: string }[]} */ (e.payload.problems));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="org-new org-boxed" role="group" aria-label="Import people from CSV">
      <Help>
        A header row, then one row per person: <code>email, name, workspace, role</code>, and optionally <code>username, title, orgadmin</code>. <b>workspace</b> is a key or name (several separated by <code>;</code>); <b>role</b> is a role name such as Developer or Viewer. Everyone gets an invitation; nobody is added if any row has a problem.
      </Help>
      <label className="btn btn-ghost sm org-file">
        <FileUp size={14} /> Choose a .csv file
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            file.text().then((t) => {
              setCsv(t);
              setChecked(null);
            });
          }}
        />
      </label>
      <label className="field">
        Or paste it
        <textarea
          rows={6}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setChecked(null);
          }}
          placeholder={"email,name,workspace,role\nann@example.com,Ann Ade,MKT,Developer"}
        />
      </label>
      {error && (
        <div className="org-error" role="alert">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul>
              {problems.map((p) => (
                <li key={`${p.line}-${p.problem}`}>
                  Line {p.line}: {p.problem}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {checked && (
        <p role="status">
          Ready to invite {checked.length} {checked.length === 1 ? "person" : "people"}: {checked.map((p) => `${p.name} (${p.username})`).join(", ")}.
        </p>
      )}
      <div className="org-row">
        {checked ? (
          <button className="btn btn-navy sm" disabled={busy} onClick={() => send(false)}>
            Invite {checked.length}
          </button>
        ) : (
          <button className="btn btn-navy sm" disabled={busy || !csv.trim()} onClick={() => send(true)}>
            Check the file
          </button>
        )}
        <button type="button" className="btn btn-ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- templates for new workspaces ----------

/**
 * @typedef {{ id: string; name: string; description: string; statuses: string[]; itemTypes: string[]; fields: string[] }} TemplateSummary
 * @typedef {{ builtIn: (TemplateSummary & { icon: string; key: string })[]; organisation: (TemplateSummary & { createdAt: string })[] }} TemplateList
 */

/** The built-in templates, the organisation's own, and saving a workspace as one. @param {{ org: Org }} p */
function Templates({ org }) {
  const toast = useToast();
  const [dialog, ask] = useConfirm();
  const [list, setList] = useState(/** @type {TemplateList | null} */ (null));
  const [form, setForm] = useState({ workspaceId: "", name: "", description: "" });
  const load = () =>
    api("/org/templates")
      .then((r) => setList(/** @type {TemplateList} */ (r)))
      .catch((e) => toast(message(e, "Couldn't load the templates"), false));
  useEffect(() => {
    load();
  }, []);
  if (!list) return <p className="muted">Loading…</p>;
  /** @param {TemplateSummary} t @param {import('react').ReactNode} [action] */
  const card = (t, action) => (
    <li key={t.id} className="tpl-card">
      <div>
        <b>{t.name}</b>
        {t.description && <p className="muted">{t.description}</p>}
        <p className="tpl-flow" aria-label={`Statuses: ${t.statuses.join(", ")}`}>
          {t.statuses.map((s, i) => (
            <span key={s}>
              {i > 0 && <span aria-hidden="true"> → </span>}
              {s}
            </span>
          ))}
        </p>
        <small className="muted">
          Types: {t.itemTypes.join(", ")}
          {t.fields.length ? ` · Fields: ${t.fields.join(", ")}` : ""}
        </small>
      </div>
      {action}
    </li>
  );
  return (
    <Panel title="Templates for new workspaces" icon={LayoutTemplate}>
      {dialog}
      <Help>
        A new workspace can start from a template: its statuses and workflow, item types and fields become the workspace's own, to change as it likes. Choose one under Workspaces → Add workspace → Start from.
      </Help>
      <h4 className="tpl-head">Built in</h4>
      <ul className="tpl-list">{list.builtIn.map((t) => card(t))}</ul>
      <h4 className="tpl-head">Your organisation's</h4>
      {list.organisation.length === 0 ? (
        <Empty title="None yet">Save a workspace you've set up as a template, below.</Empty>
      ) : (
        <ul className="tpl-list">
          {list.organisation.map((t) =>
            card(
              t,
              <button
                className="btn btn-ghost sm"
                aria-label={`Delete the template ${t.name}`}
                onClick={async () => {
                  if (!(await ask({ title: `Delete the template ${t.name}?`, body: "Workspaces made from it keep their set-up.", confirm: "Delete", danger: true }))) return;
                  try {
                    await api(`/org/templates/${t.id.slice(4)}`, "DELETE");
                    toast(`${t.name} is deleted.`);
                    await load();
                  } catch (e) {
                    toast(message(e, "Couldn't delete it"), false);
                  }
                }}
              >
                <Trash2 size={14} /> Delete
              </button>,
            ),
          )}
        </ul>
      )}
      <form
        className="org-new org-boxed"
        aria-label="Save a workspace as a template"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/org/templates", "POST", form);
            toast(`${form.name} is saved as a template.`);
            setForm({ workspaceId: "", name: "", description: "" });
            await load();
          } catch (err) {
            toast(message(err, "Couldn't save it"), false);
          }
        }}
      >
        <h4>Save a workspace as a template</h4>
        <Help>Its workflow, item types and fields are kept. Its projects, work, people and automation rules aren't.</Help>
        <div className="org-grid">
          <label className="field">
            Workspace
            <select required value={form.workspaceId} onChange={(e) => setForm({ ...form, workspaceId: e.target.value, name: form.name || `${org.workspaces.find((w) => w.id === e.target.value)?.name ?? ""} set-up` })}>
              <option value="">Choose…</option>
              {org.workspaces
                .filter((w) => w.status === "active")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Template name
            <input required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Description (optional)
          <input maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="org-row">
          <button className="btn btn-navy sm">Save as a template</button>
        </div>
      </form>
    </Panel>
  );
}

// ---------- the audit log ----------

/** @typedef {{ id: number; at: string; actor: string; action: string; targetType: string; targetId: string | null; workspace: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip: string | null }} AuditRow */

/** A value in a before/after cell. @param {unknown} v */
const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** @param {{ workspaces: Workspace[]; own?: boolean }} p  own: the open workspace's entries (/api/audit-log) */
function AuditLog({ workspaces, own = false }) {
  const toast = useToast();
  const [rows, setRows] = useState(/** @type {AuditRow[]} */ ([]));
  const [more, setMore] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [loading, setLoading] = useState(true);
  /** @param {number} [before] */
  const load = async (before) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (workspace) q.set("workspace", workspace);
      if (before) q.set("before", String(before));
      const r = /** @type {{ entries: AuditRow[]; more: boolean }} */ (await api(`${own ? "/audit-log" : "/org/audit"}?${q}`));
      setRows(before ? (x) => [...x, ...r.entries] : r.entries);
      setMore(r.more);
    } catch (e) {
      toast(message(e, "Couldn't load the audit log"), false);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [workspace]);
  return (
    <Panel
      title={own ? "This workspace's audit log" : "Audit log"}
      icon={History}
      action={
        !own && (
          <label className="org-role">
            <span className="sr-only">Workspace</span>
            <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
              <option value="">Everything</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      <Help>Every change to workspaces, people, roles and organisation settings, with who made it and what it was before. Entries can't be edited or removed.</Help>
      {!loading && rows.length === 0 ? (
        <Empty title="No changes recorded yet" />
      ) : (
        <div className="org-table-wrap">
          <table className="org-table org-audit">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                {!own && <th scope="col">Workspace</th>}
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])];
                return (
                  <tr key={r.id}>
                    <td title={r.at}>{formatDate(r.at)}</td>
                    <td>
                      {r.actor}
                      {r.ip && <span className="muted org-sub"> {r.ip}</span>}
                    </td>
                    <td>{AUDIT_ACTIONS[r.action] ?? r.action.replace(/_/g, " ")}</td>
                    {!own && <td>{r.workspace ?? "Organisation"}</td>}
                    <td>
                      {keys.map((k) => (
                        <div key={k} className="org-kv">
                          <span className="muted">{k}</span> {show(r.before?.[k])}
                        </div>
                      ))}
                    </td>
                    <td>
                      {keys.map((k) => (
                        <div key={k} className="org-kv">
                          <span className="muted">{k}</span> {show(r.after?.[k])}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <button className="btn btn-ghost sm" disabled={loading} onClick={() => load(rows[rows.length - 1]?.id)}>
          {loading ? "Loading…" : "Show older"}
        </button>
      )}
    </Panel>
  );
}
