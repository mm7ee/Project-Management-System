// /platform: the system's Platform Administrators (multi-tenancy, phase (d)). They create, rename, suspend and archive
// organisations and give each its first administrator. They see each organisation's name, code, status and how
// many workspaces and people it has; never anything inside it. Signing in always needs an authenticator app.
import { BRAND, tabTitle } from "../data/brand";
import { useEffect, useState } from "react";
import { Building2, KeyRound, LogOut, Plus, ShieldCheck } from "lucide-react";
import { ApiError, api } from "../data/api";
import { QrCode } from "./MfaSetup";
import { ToastProvider, useConfirm } from "./AdminKit";
import BrandingSettings from "./BrandingSettings";

/**
 * @typedef {{ id: string; name: string; code: string; status: "active" | "suspended" | "archived"; createdAt: string; deleteAfter?: string; workspaces: number; people: number; admins: number }} Org
 * @typedef {{ id: string; name: string; username: string; mustChangePassword: boolean }} Admin
 */

/** A code from a name: "Acme Holdings (ZW)" → "acme-holdings-zw". */
const codeFrom = /** @param {string} name */ (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export default function PlatformPage() {
  const [me, setMe] = useState(/** @type {Admin | null | undefined} */ (undefined));
  const load = async () => {
    try {
      setMe(await api("/platform/me"));
    } catch {
      setMe(null);
    }
  };
  useEffect(() => {
    document.title = tabTitle("Platform");
    load();
  }, []);
  return (
    <div className="platform">
      <header className="platform-top">
        <span className="platform-brand">
          {/* The platform is neutral: the product's own wordmark, never an organisation's. */}
          <b className="platform-pms">{BRAND.shortName}</b> <span>Platform</span>
        </span>
        {me && (
          <button
            className="btn btn-ghost sm"
            onClick={async () => {
              await api("/platform/logout", "POST").catch(() => undefined);
              setMe(null);
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        )}
      </header>
      <main className="platform-main">{me === undefined ? <p className="platform-muted">Loading…</p> : !me ? <SignIn onDone={load} /> : me.mustChangePassword ? <ChoosePassword onDone={load} /> : <Organisations />}</main>
    </div>
  );
}

/** @param {{ onDone: () => void }} p */
function SignIn({ onDone }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [setup, setSetup] = useState(/** @type {{ secret: string; uri: string } | null} */ (null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = /** @param {() => Promise<void>} fn */ async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      if (e instanceof ApiError && e.code === "mfa_expired") {
        setTicket("");
        setSetup(null);
        setCode("");
      }
    }
    setBusy(false);
  };
  return (
    <form
      className="platform-card platform-narrow"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!ticket) {
            const r = /** @type {{ ticket: string; setup?: { secret: string; uri: string } }} */ (await api("/platform/login", "POST", { username, password }));
            setTicket(r.ticket);
            setSetup(r.setup ?? null);
            setPassword("");
          } else {
            await api("/platform/login/code", "POST", { ticket, code });
            onDone();
          }
        });
      }}
    >
      <h1>
        <ShieldCheck size={20} aria-hidden="true" /> Platform sign-in
      </h1>
      {!ticket ? (
        <>
          <p className="platform-muted">For the platform's administrators. Organisations sign in at the main page.</p>
          <label className="field">
            Username
            <input autoFocus autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="field">
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          {setup ? (
            <>
              <p>Platform sign-in always needs an authenticator app. Scan this code with yours (or type the key), then enter the 6-digit code it shows.</p>
              <QrCode uri={setup.uri} />
              <p className="platform-muted">
                Key: <code>{setup.secret}</code>
              </p>
            </>
          ) : (
            <p>Enter the 6-digit code from your authenticator app.</p>
          )}
          <label className="field">
            Code
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        </>
      )}
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-navy" disabled={busy}>
        {busy ? "Checking…" : ticket ? "Sign in" : "Continue"}
      </button>
    </form>
  );
}

/** @param {{ onDone: () => void }} p */
function ChoosePassword({ onDone }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="platform-card platform-narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await api("/platform/me/password", "POST", { current, password });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't change the password");
        }
      }}
    >
      <h1>
        <KeyRound size={20} aria-hidden="true" /> Choose your own password
      </h1>
      <p className="platform-muted">You signed in with a temporary password. At least 12 characters, with letters, numbers and symbols.</p>
      <label className="field">
        Temporary password
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        New password
        <input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-navy">Save password</button>
    </form>
  );
}

function Organisations() {
  const [orgs, setOrgs] = useState(/** @type {Org[] | null} */ (null));
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  // The organisation whose branding is open below the table (a Platform Administrator may change any).
  const [branding, setBranding] = useState(/** @type {Org | null} */ (null));
  const [dialog, ask] = useConfirm();
  /** What a new organisation's (or a new) administrator needs: shown once. */
  const [handover, setHandover] = useState(/** @type {{ title: string; username: string; temporaryPassword: string; signInLink: string } | null} */ (null));
  const reload = async () => {
    try {
      setOrgs((/** @type {{ organizations: Org[] }} */ (await api("/platform/organizations"))).organizations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the organisations");
    }
  };
  useEffect(() => {
    reload();
  }, []);
  const change = /** @param {Org} o @param {Partial<Pick<Org, "name" | "status">>} patch @param {string} [confirmText] */ async (o, patch, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    try {
      await api(`/platform/organizations/${o.id}`, "PATCH", patch);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change it");
    }
  };
  return (
    <div className="platform-wide">
      {dialog}
      <div className="platform-head">
        <h1>
          <Building2 size={20} aria-hidden="true" /> Organisations
        </h1>
        <button className="btn btn-navy sm" onClick={() => setAdding(true)}>
          <Plus size={15} /> New organisation
        </button>
      </div>
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      {handover && (
        <section className="platform-card platform-handover" aria-live="polite">
          <h2>{handover.title}</h2>
          <p>Give these to the administrator through a safe channel. The password is shown only now; they choose their own at the first sign-in.</p>
          <dl>
            <dt>Sign-in link</dt>
            <dd>
              <code>{handover.signInLink}</code>
            </dd>
            <dt>Username</dt>
            <dd>
              <code>{handover.username}</code>
            </dd>
            <dt>Temporary password</dt>
            <dd>
              <code>{handover.temporaryPassword}</code>
            </dd>
          </dl>
          <button className="btn btn-ghost sm" onClick={() => setHandover(null)}>
            Done
          </button>
        </section>
      )}
      {branding && (
        <section className="platform-card platform-branding" aria-label={`Branding of ${branding.name}`}>
          <div className="platform-head">
            <h2>Branding: {branding.name}</h2>
            <button className="btn btn-ghost sm" onClick={() => setBranding(null)}>
              Close
            </button>
          </div>
          <ToastProvider>
            <BrandingSettings key={branding.id} orgName={branding.name} endpoint={`/platform/organizations/${branding.id}/branding`} own={false} />
          </ToastProvider>
        </section>
      )}
      {adding && (
        <NewOrganisation
          onCancel={() => setAdding(false)}
          onMade={async (r) => {
            setAdding(false);
            setHandover({ title: `${r.organization.name} is ready`, username: r.admin.username, temporaryPassword: r.admin.temporaryPassword, signInLink: r.signInLink });
            await reload();
          }}
        />
      )}
      {!orgs ? (
        <p className="platform-muted">Loading…</p>
      ) : !orgs.length ? (
        <p className="platform-muted">No organisations yet.</p>
      ) : (
        <div className="platform-table-wrap">
          <table className="platform-table">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">Code</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Workspaces
                </th>
                <th scope="col" className="num">
                  People
                </th>
                <th scope="col" className="num">
                  Admins
                </th>
                <th scope="col">Since</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <th scope="row">{o.name}</th>
                  <td>
                    <code>{o.code}</code>
                  </td>
                  <td>
                    <span className={`platform-status ${o.status}`}>{o.status === "active" ? "Active" : o.status === "suspended" ? "Suspended" : "Archived"}</span>
                    {o.deleteAfter && <span className="platform-muted"> · deleted on {new Date(o.deleteAfter).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                  </td>
                  <td className="num">{o.workspaces}</td>
                  <td className="num">{o.people}</td>
                  <td className="num">{o.admins}</td>
                  <td>{new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="platform-actions">
                    <button className="btn btn-ghost sm" aria-pressed={branding?.id === o.id} onClick={() => setBranding(branding?.id === o.id ? null : o)}>
                      Branding
                    </button>
                    <button
                      className="btn btn-ghost sm"
                      onClick={() => {
                        const name = window.prompt("New name", o.name);
                        if (name && name.trim() && name.trim() !== o.name) change(o, { name: name.trim() });
                      }}
                    >
                      Rename
                    </button>
                    {o.status === "active" ? (
                      <button className="btn btn-ghost sm" onClick={() => change(o, { status: "suspended" }, `Suspend ${o.name}? Nobody in it can sign in, and its links and tokens stop working, until you reactivate it.`)}>
                        Suspend
                      </button>
                    ) : (
                      <button className="btn btn-ghost sm" onClick={() => change(o, { status: "active" })}>
                        Reactivate
                      </button>
                    )}
                    {o.status !== "archived" && (
                      <button className="btn btn-ghost sm" onClick={() => change(o, { status: "archived" }, `Archive ${o.name}? It closes like a suspension, and is kept (nothing is deleted).`)}>
                        Archive
                      </button>
                    )}
                    {/* Deleting: only an archived organisation, 30 days after asking, and it can be called off until then. */}
                    {o.status === "archived" &&
                      (o.deleteAfter ? (
                        <button
                          className="btn btn-ghost sm"
                          onClick={async () => {
                            setError("");
                            try {
                              await api(`/platform/organizations/${o.id}/deletion`, "DELETE");
                              await reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Couldn't call it off");
                            }
                          }}
                        >
                          Keep it
                        </button>
                      ) : (
                        <button
                          className="btn btn-danger sm"
                          onClick={async () => {
                            const ok = await ask({
                              title: `Delete ${o.name}?`,
                              body: "In 30 days everything it holds is deleted for good: its workspaces, people, projects, work items and history. You can call it off until then.",
                              confirm: "Delete in 30 days",
                              danger: true,
                              typed: o.code,
                            });
                            if (!ok) return;
                            setError("");
                            try {
                              await api(`/platform/organizations/${o.id}/deletion`, "POST", { code: o.code });
                              await reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Couldn't plan the deletion");
                            }
                          }}
                        >
                          Delete…
                        </button>
                      ))}
                    <button
                      className="btn btn-ghost sm"
                      onClick={async () => {
                        const username = window.prompt(`A new administrator for ${o.name}: their username`);
                        if (!username) return;
                        const name = window.prompt("Their full name");
                        if (!name) return;
                        setError("");
                        try {
                          const r = /** @type {{ admin: { username: string; temporaryPassword: string }; signInLink: string }} */ (await api(`/platform/organizations/${o.id}/admins`, "POST", { username, name }));
                          setHandover({ title: `A new administrator for ${o.name}`, username: r.admin.username, temporaryPassword: r.admin.temporaryPassword, signInLink: r.signInLink });
                          await reload();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Couldn't add the administrator");
                        }
                      }}
                    >
                      Add admin
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{ onCancel: () => void; onMade: (r: { organization: { name: string }; admin: { username: string; temporaryPassword: string }; signInLink: string }) => void }} p
 */
function NewOrganisation({ onCancel, onMade }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [admin, setAdmin] = useState({ username: "", name: "", email: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="platform-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          onMade(await api("/platform/organizations", "POST", { name, code, admin }));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't make the organisation");
          setBusy(false);
        }
      }}
    >
      <h2>New organisation</h2>
      <p className="platform-muted">It starts with one workspace, Projects, and the standard statuses, workflows and service desk set-up. Its administrator adds the rest.</p>
      <div className="platform-grid">
        <label className="field">
          Name
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!codeTouched) setCode(codeFrom(e.target.value));
            }}
          />
        </label>
        <label className="field">
          Code (typed at sign-in)
          <input
            required
            pattern="[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?"
            value={code}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value.toLowerCase());
            }}
          />
        </label>
        <label className="field">
          Administrator's username
          <input required pattern="[a-z0-9._-]{3,32}" value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value.toLowerCase() })} />
        </label>
        <label className="field">
          Administrator's full name
          <input required value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
        </label>
        <label className="field">
          Administrator's email (optional)
          <input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
        </label>
      </div>
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      <div className="platform-row">
        <button className="btn btn-navy" disabled={busy}>
          {busy ? "Making it…" : "Make the organisation"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
