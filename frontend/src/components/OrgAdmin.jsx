/** @import { Role, User } from '../data/roles' */
// Settings → Organisation (Organisation Administrators only, multi-tenancy phase (d)): the organisation's
// workspaces (add, rename, archive) and its people (add, which workspaces they're in with a role in each,
// Organisation Administrator or not, remove). Everything here applies across the organisation.
import { useEffect, useState } from "react";
import { Layers, Plus, Trash2, Users } from "lucide-react";
import { api } from "../data/api";
import { ROLES, ROLE_LABEL } from "../data/roles";
import Panel from "./Panel";

/**
 * @typedef {{ id: string; name: string; key: string; status: "active" | "archived"; members: number }} Workspace
 * @typedef {{ workspaceId: string; role: Role }} Membership
 * @typedef {{ id: string; username: string; name: string; title: string; email?: string; orgAdmin: boolean; mustChangePassword?: boolean; locked?: boolean; workspaces: Membership[] }} Person
 * @typedef {{ organization: { id: string; name: string; code: string }; workspaces: Workspace[]; people: Person[] }} Org
 */

/** A workspace key from its name: "Human Resources" → "HR", "Finance" → "FINANCE". */
const keyFrom = /** @param {string} name */ (name) => {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const k = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return k.replace(/^[0-9]+/, "").slice(0, 10);
};

/** @param {{ me: User }} p */
export default function OrgAdmin({ me }) {
  const [org, setOrg] = useState(/** @type {Org | null} */ (null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reload = async () => {
    try {
      setOrg(/** @type {Org} */ (await api("/org")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the organisation");
    }
  };
  useEffect(() => {
    reload();
  }, []);
  /** @param {() => Promise<unknown>} fn @param {string} [done] */
  const act = async (fn, done) => {
    setError("");
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  if (!org) return <p className="muted">{error || "Loading…"}</p>;
  const active = org.workspaces.filter((w) => w.status === "active");
  return (
    <div className="org-admin">
      <p className="muted">
        {org.organization.name} · sign-in code <code>{org.organization.code}</code>. Changes here apply to the whole organisation.
      </p>
      {error && (
        <p className="org-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="org-ok" role="status">
          {notice}
        </p>
      )}
      <Workspaces org={org} act={act} />
      <People org={org} active={active} me={me} act={act} />
    </div>
  );
}

/** @param {{ org: Org; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }} p */
function Workspaces({ org, act }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  return (
    <Panel title="Workspaces" icon={Layers}>
      <table className="org-table">
        <thead>
          <tr>
            <th scope="col">Workspace</th>
            <th scope="col">Key</th>
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
          {org.workspaces.map((w) => (
            <tr key={w.id}>
              <th scope="row">{w.name}</th>
              <td>
                <code>{w.key}</code>
              </td>
              <td className="num">{w.members}</td>
              <td>{w.status === "active" ? "Active" : "Archived"}</td>
              <td className="org-actions">
                <button
                  className="btn btn-ghost sm"
                  onClick={() => {
                    const next = window.prompt("New name", w.name);
                    if (next && next.trim() && next.trim() !== w.name) act(() => api(`/org/workspaces/${w.id}`, "PATCH", { name: next.trim() }), `Renamed to ${next.trim()}.`);
                  }}
                >
                  Rename
                </button>
                {w.status === "active" ? (
                  <button
                    className="btn btn-ghost sm"
                    onClick={() => window.confirm(`Archive ${w.name}? Nobody can open it until it's active again; nothing in it is deleted.`) && act(() => api(`/org/workspaces/${w.id}`, "PATCH", { status: "archived" }), `${w.name} is archived.`)}
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
          ))}
        </tbody>
      </table>
      <form
        className="org-inline"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await api("/org/workspaces", "POST", { name, key });
            setName("");
            setKey("");
            setKeyTouched(false);
          }, `${name} is ready. You're its administrator; add people below.`);
        }}
      >
        <label className="field">
          New workspace
          <input
            required
            maxLength={40}
            value={name}
            placeholder="e.g. Finance"
            onChange={(e) => {
              setName(e.target.value);
              if (!keyTouched) setKey(keyFrom(e.target.value));
            }}
          />
        </label>
        <label className="field">
          Key
          <input
            required
            pattern="[A-Z][A-Z0-9]{1,9}"
            maxLength={10}
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase());
            }}
          />
        </label>
        <button className="btn btn-navy sm">
          <Plus size={15} /> Add workspace
        </button>
      </form>
    </Panel>
  );
}

/** @param {{ org: Org; active: Workspace[]; me: User; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }} p */
function People({ org, active, me, act }) {
  const [adding, setAdding] = useState(false);
  const [handover, setHandover] = useState(/** @type {{ username: string; temporaryPassword: string } | null} */ (null));
  /** A person's role in a workspace, or "" for not in it. */
  const roleIn = /** @param {Person} p @param {string} w */ (p, w) => p.workspaces.find((m) => m.workspaceId === w)?.role ?? "";
  const setRole = /** @param {Person} p @param {string} w @param {Role | ""} role */ (p, w, role) => {
    const rest = p.workspaces.filter((m) => m.workspaceId !== w);
    const next = role ? [...rest, { workspaceId: w, role }] : rest;
    if (!next.length) {
      window.alert(`${p.name} must stay in at least one workspace. To take them out of the organisation, use Remove.`);
      return;
    }
    act(() => api(`/org/people/${p.id}/workspaces`, "PUT", { workspaces: next }), role ? `${p.name}'s role is saved.` : `${p.name} is no longer in that workspace.`);
  };
  return (
    <Panel title="People" icon={Users}>
      {handover && (
        <div className="org-handover" role="status">
          <p>
            Give <b>{handover.username}</b> this temporary password through a safe channel. It's shown only now; they choose their own at the first sign-in.
          </p>
          <code>{handover.temporaryPassword}</code>
          <button className="btn btn-ghost sm" onClick={() => setHandover(null)}>
            Done
          </button>
        </div>
      )}
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
              <tr key={p.id}>
                <th scope="row">
                  {p.name}
                  <span className="muted org-sub">
                    {" "}
                    {p.username}
                    {p.mustChangePassword ? " · temporary password" : ""}
                    {p.locked ? " · locked" : ""}
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
                  {p.id !== me.id && (
                    <button
                      className="btn btn-ghost sm"
                      aria-label={`Remove ${p.name} from the organisation`}
                      onClick={() => window.confirm(`Remove ${p.name} from the organisation? Their account goes; what they did stays, shown as a former user.`) && act(() => api(`/org/people/${p.id}`, "DELETE"), `${p.name} is removed.`)}
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
      {adding ? (
        <NewPerson
          active={active}
          onCancel={() => setAdding(false)}
          onMade={(r) => {
            setAdding(false);
            setHandover(r);
            return act(async () => undefined);
          }}
        />
      ) : (
        <button className="btn btn-navy sm" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add person
        </button>
      )}
    </Panel>
  );
}

/** @param {{ active: Workspace[]; onCancel: () => void; onMade: (r: { username: string; temporaryPassword: string }) => void }} p */
function NewPerson({ active, onCancel, onMade }) {
  const [form, setForm] = useState({ username: "", name: "", title: "", email: "", orgAdmin: false });
  const [roles, setRoles] = useState(/** @type {Record<string, Role | "">} */ ({ [active[0]?.id ?? ""]: "developer" }));
  const [error, setError] = useState("");
  return (
    <form
      className="org-new"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        const workspaces = Object.entries(roles)
          .filter(([, r]) => r)
          .map(([workspaceId, role]) => ({ workspaceId, role }));
        try {
          const r = /** @type {{ temporaryPassword: string }} */ (await api("/org/people", "POST", { ...form, workspaces }));
          onMade({ username: form.username, temporaryPassword: r.temporaryPassword });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't add them");
        }
      }}
    >
      <div className="org-grid">
        <label className="field">
          Username
          <input required pattern="[a-z0-9._-]{3,32}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
        </label>
        <label className="field">
          Full name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          Title (optional)
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="field">
          Email (optional)
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
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
        <button className="btn btn-navy sm">Add and get a temporary password</button>
        <button type="button" className="btn btn-ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
