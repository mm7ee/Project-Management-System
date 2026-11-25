/** @import { Role, User } from '../data/roles' */
/** @import { System } from '../data/systems' */
/** @import { ApiToken, CustomField, CustomFieldKind, NotificationEvent, NotificationScheme, SecurityLevel, TokenScope, Webhook, WebhookDelivery, WebhookEvent } from '../data/admin' */
import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Copy, GitBranch, KeyRound, ListPlus, Lock, Plug, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon, X } from "lucide-react";
import { api } from "../data/api";
import { ROLES, ROLE_LABEL } from "../data/roles";
import { API_RATE_LIMIT, CUSTOM_FIELD_KINDS, NOTIFICATION_EVENTS, RECIPIENTS, TOKEN_DAYS, WEBHOOK_EVENTS } from "../data/admin";
import { Section } from "./SettingsParts";
import { formatDate, timeAgo } from "../time";
const errText =
  /** @param {unknown} e
   * @param {string} fallback
   * @returns {string}
   */ (e, fallback) => (e instanceof Error ? e.message : fallback);
/**
 * @param {{ label: string; value: string }} arg2
 */
function CopyOnce({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-once" role="status">
      <p>
        <b>{label}</b> It's shown only this once: copy it now.
      </p>
      <div className="secret-row">
        <code>{value}</code>
        <button
          type="button"
          className="btn btn-ghost sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
// ---------- Settings → Notifications: personal opt-outs ----------
/**
 */
export function NotificationOptOuts() {
  const [optOuts, setOptOuts] = useState(/** @type {NotificationEvent[] | null | (() => NotificationEvent[] | null)} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    /** @type {Promise<{ optOuts: NotificationEvent[]; }>} */ (/** @type {unknown} */ (api("/me/notification-optouts"))).then((r) => setOptOuts(r.optOuts)).catch((e) => setError(errText(e, "Couldn't load your choices")));
  }, []);
  const flip = /** @param {NotificationEvent} e */ async (e) => {
    if (!optOuts) return;
    const next = optOuts.includes(e) ? optOuts.filter((x) => x !== e) : [...optOuts, e];
    setOptOuts(next);
    try {
      await api("/me/notification-optouts", "PUT", { optOuts: next });
    } catch (err) {
      setError(errText(err, "Couldn't save"));
    }
  };
  return (
    <Section icon={<BellRing size={18} />} title="Work item notifications" sub="An administrator chooses who hears about each event. Untick anything you'd rather not hear about.">
      {error && <p className="form-error">{error}</p>}
      {!optOuts ? (
        <p className="muted">Loading…</p>
      ) : (
        <fieldset className="optout-list">
          <legend className="sr-only">Events you hear about</legend>
          {NOTIFICATION_EVENTS.map((e) => (
            <label key={e.key} className="wi-check">
              <input type="checkbox" checked={!optOuts.includes(e.key)} onChange={() => flip(e.key)} />
              <span>
                <b>{e.label}</b> <small className="muted">{e.help}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Section>
  );
}
// ---------- notification schemes ----------
/**
 */
export function NotificationSchemesSection() {
  const [schemes, setSchemes] = useState(/** @type {NotificationScheme[] | null | (() => NotificationScheme[] | null)} */ (null));
  const [msg, setMsg] = useState(/** @type {{ ok: boolean; text: string } | null | (() => { ok: boolean; text: string } | null)} */ (null));
  useEffect(() => {
    /** @type {Promise<Array<NotificationScheme>>} */ (/** @type {unknown} */ (api("/notification-schemes"))).then(setSchemes).catch((e) => setMsg({ ok: false, text: errText(e, "Couldn't load the schemes") }));
  }, []);
  const set = /** @param {NotificationEvent} event @param {Partial<NotificationScheme>} patch */ (event, patch) => setSchemes((list) => list?.map((s) => (s.event === event ? { ...s, ...patch } : s)) ?? null);
  return (
    <Section icon={<BellRing size={18} />} title="Notification schemes" sub="For each work item event, who hears about it and how. People only ever hear about items they can see, never about their own changes, and each person can opt out in Settings → Notifications.">
      {!schemes ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="table-wrap">
          <table className="table scheme-table">
            <caption className="sr-only">Who is notified of each event, and how</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                {RECIPIENTS.map((r) => (
                  <th key={r.key} scope="col">
                    {r.label}
                  </th>
                ))}
                <th scope="col">Everyone with a role</th>
                <th scope="col">Bell</th>
                <th scope="col">Email</th>
                <th scope="col">Teams</th>
              </tr>
            </thead>
            <tbody>
              {schemes.map((s) => {
                const ev = /** @type {{ key: NotificationEvent; label: string; help: string; }} */ (NOTIFICATION_EVENTS.find((e) => e.key === s.event));
                return (
                  <tr key={s.event}>
                    <th scope="row">{ev.label}</th>
                    {RECIPIENTS.map((r) => (
                      <td key={r.key}>
                        <input type="checkbox" checked={s[r.key]} onChange={(e) => set(s.event, { [r.key]: e.target.checked })} aria-label={`${ev.label}: ${r.label}`} />
                      </td>
                    ))}
                    <td>
                      <select value={s.role ?? ""} onChange={(e) => set(s.event, { role: /** @type {Role | undefined} */ (e.target.value || undefined) })} aria-label={`${ev.label}: everyone with a role`}>
                        <option value="">None</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/** @type {const} */ (["bell", "email", "teams"]).map((ch) => (
                      <td key={ch}>
                        <input type="checkbox" checked={s[ch]} onChange={(e) => set(s.event, { [ch]: e.target.checked })} aria-label={`${ev.label}: by ${ch === "teams" ? "Teams" : ch}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="set-note">Email follows each person's own email setting and needs email connected (Email & Teams). Teams posts one message to the channel; items with a security level never go there.</p>
      {msg && <p className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</p>}
      <button
        className="btn btn-navy"
        disabled={!schemes}
        onClick={async () => {
          try {
            setSchemes(await /** @type {Promise<Array<NotificationScheme>>} */ (/** @type {unknown} */ (api("/notification-schemes", "PUT", { schemes }))));
            setMsg({ ok: true, text: "Saved." });
          } catch (e) {
            setMsg({ ok: false, text: errText(e, "Couldn't save") });
          }
        }}
      >
        Save schemes
      </button>
    </Section>
  );
}
// ---------- security levels ----------
/**
 * @param {{ users: User[] }} arg3
 */
export function SecurityLevelsSection({ users }) {
  const [levels, setLevels] = useState(/** @type {SecurityLevel[] | null | (() => SecurityLevel[] | null)} */ (null));
  const [editing, setEditing] = useState(/** @type {Partial<SecurityLevel> | null | (() => Partial<SecurityLevel> | null)} */ (null));
  const [error, setError] = useState("");
  const load = useCallback(() => /** @type {Promise<Array<SecurityLevel>>} */ (/** @type {unknown} */ (api("/security-levels"))).then(setLevels).catch((e) => setError(errText(e, "Couldn't load levels"))), []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async () => {
    if (!editing) return;
    setError("");
    try {
      const b = { name: editing.name, description: editing.description, roles: editing.roles ?? [], people: editing.people ?? [] };
      if (editing.id) await api(`/security-levels/${editing.id}`, "PUT", b);
      else await api("/security-levels", "POST", b);
      setEditing(null);
      await load();
    } catch (e) {
      setError(errText(e, "Couldn't save"));
    }
  };
  return (
    <Section
      icon={<Lock size={18} />}
      title="Security levels"
      sub="A work item with a level is seen only by administrators, its assignee and reporter, and the roles and people the level names: in lists, boards, reports, search, Ask Pulse, notifications, the API and webhooks. View-only links never see them."
    >
      {error && <p className="form-error">{error}</p>}
      {!levels ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="level-list">
          {levels.map((l) => (
            <li key={l.id}>
              <div>
                <b>{l.name}</b>
                <small className="muted">
                  {[...l.roles.map((r) => ROLE_LABEL[r]), ...l.people.map((p) => users.find((u) => u.id === p)?.name ?? "Former user")].join(", ") || "Administrators, assignee and reporter only"} · {l.items} work item{l.items === 1 ? "" : "s"}
                </small>
              </div>
              <span className="row-actions">
                <button className="btn btn-ghost sm" onClick={() => setEditing({ ...l })}>
                  Edit
                </button>
                <button
                  className="icon-link danger"
                  aria-label={`Delete ${l.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete the level "${l.name}"?`)) return;
                    try {
                      await api(`/security-levels/${l.id}`, "DELETE");
                      await load();
                    } catch (e) {
                      setError(errText(e, "Couldn't delete it"));
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form
          className="set-form inline-editor"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} required />
            </label>
            <label className="field">
              <span>Description</span>
              <input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={200} />
            </label>
          </div>
          <fieldset className="field checks">
            <legend>Roles that see these items</legend>
            {ROLES.filter((r) => r !== "admin").map((r) => (
              <label key={r} className="wi-check">
                <input type="checkbox" checked={(editing.roles ?? []).includes(r)} onChange={(e) => setEditing({ ...editing, roles: e.target.checked ? [...(editing.roles ?? []), r] : (editing.roles ?? []).filter((x) => x !== r) })} /> {ROLE_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>People who see these items (hold Ctrl or Cmd to choose several)</span>
            <select multiple size={6} value={editing.people ?? []} onChange={(e) => setEditing({ ...editing, people: [...e.target.selectedOptions].map((o) => o.value) })}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({ROLE_LABEL[u.role]})
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-navy">
              Save level
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost" onClick={() => setEditing({ roles: [], people: [] })}>
          <Plus size={14} /> Add a security level
        </button>
      )}
    </Section>
  );
}
/**
 * @param {{ workspaces: string[] }} props
 */
export function CustomFieldsSection({ workspaces }) {
  const [fields, setFields] = useState(/** @type {CustomField[] | null | (() => CustomField[] | null)} */ (null));
  const [editing, setEditing] = useState(/** @type {FieldDraft | null | (() => FieldDraft | null)} */ (null));
  const [error, setError] = useState("");
  const load = useCallback(() => /** @type {Promise<Array<CustomField>>} */ (/** @type {unknown} */ (api("/custom-fields"))).then(setFields).catch((e) => setError(errText(e, "Couldn't load the fields"))), []);
  useEffect(() => {
    load();
  }, [load]);
  const blank = /** @param {string} workspace @returns {FieldDraft} */ (workspace) => ({ workspace, name: "", kind: "text", description: "", required: false, onCreate: true, onEdit: true, onView: true, onBoard: false, options: [] });
  const save = async () => {
    if (!editing) return;
    setError("");
    try {
      if (editing.id) await api(`/custom-fields/${editing.id}`, "PUT", editing);
      else await api("/custom-fields", "POST", editing);
      setEditing(null);
      await load();
    } catch (e) {
      setError(errText(e, "Couldn't save"));
    }
  };
  const selectish = editing && (editing.kind === "select" || editing.kind === "multiselect");
  return (
    <Section icon={<ListPlus size={18} />} title="Custom fields" sub='Extra fields for the work items in a workspace. They can be searched in PQL by name (in quotes if the name has spaces, like "Customer tier" = Gold), saved in filters, exported to CSV and shown on board cards.'>
      {error && <p className="form-error">{error}</p>}
      {!fields ? (
        <p className="muted">Loading…</p>
      ) : (
        workspaces.map((ws) => {
          const mine = fields.filter((f) => f.workspace === ws);
          return (
            <div key={ws} className="cf-workspace">
              <h4>{ws}</h4>
              {!mine.length && <p className="muted">No custom fields.</p>}
              <ul className="level-list">
                {mine.map((f) => (
                  <li key={f.id}>
                    <div>
                      <b>
                        {f.name}
                        {f.required && <span className="req-mark"> (required)</span>}
                      </b>
                      <small className="muted">
                        {CUSTOM_FIELD_KINDS[f.kind]}
                        {f.options.length ? `: ${f.options.map((o) => o.label).join(", ")}` : ""} · on {[f.onCreate && "create", f.onEdit && "edit", f.onView && "view", f.onBoard && "board cards"].filter(Boolean).join(", ") || "no screen"}
                      </small>
                    </div>
                    <span className="row-actions">
                      <button className="btn btn-ghost sm" onClick={() => setEditing({ ...f, options: f.options.map((o) => ({ ...o })) })}>
                        Edit
                      </button>
                      <button
                        className="icon-link danger"
                        aria-label={`Delete ${f.name}`}
                        onClick={async () => {
                          if (!window.confirm(`Delete "${f.name}"? Its values on every work item go with it.`)) return;
                          try {
                            await api(`/custom-fields/${f.id}`, "DELETE");
                            await load();
                          } catch (e) {
                            setError(errText(e, "Couldn't delete it"));
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {!editing && (
                <button className="btn btn-ghost sm" onClick={() => setEditing(blank(ws))}>
                  <Plus size={14} /> Add a field to {ws}
                </button>
              )}
            </div>
          );
        })
      )}
      {editing && (
        <form
          className="set-form inline-editor"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          aria-label={editing.id ? `Edit ${editing.name}` : `New field in ${editing.workspace}`}
        >
          <h4>{editing.id ? `Edit "${editing.name}"` : `New field in ${editing.workspace}`}</h4>
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} required />
            </label>
            <label className="field">
              <span>Kind</span>
              <select value={editing.kind} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, kind: /** @type {CustomFieldKind} */ (e.target.value) })}>
                {Object.entries(CUSTOM_FIELD_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Help text</span>
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={200} />
          </label>
          {selectish && (
            <fieldset className="field">
              <legend>Choices</legend>
              {editing.options.map((o, i) => (
                <div key={o.id ?? `new-${i}`} className="option-row">
                  <input value={o.label} onChange={(e) => setEditing({ ...editing, options: editing.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label={`Choice ${i + 1}`} maxLength={60} />
                  <button type="button" className="icon-link danger" aria-label={`Remove choice ${i + 1}`} onClick={() => setEditing({ ...editing, options: editing.options.filter((_, j) => j !== i) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost sm" onClick={() => setEditing({ ...editing, options: [...editing.options, { label: "" }] })}>
                <Plus size={13} /> Add a choice
              </button>
            </fieldset>
          )}
          <fieldset className="field checks">
            <legend>Where it appears</legend>
            {/** @type {const} */ ([
              ["onCreate", "Create form"],
              ["onEdit", "Editable on the item"],
              ["onView", "Shown on the item"],
              ["onBoard", "Board cards"],
              ["required", "Required"],
            ]).map(([k, label]) => (
              <label key={k} className="wi-check">
                <input type="checkbox" checked={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </fieldset>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-navy">
              Save field
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
// ---------- Settings → Security & privacy: API tokens ----------
/**
 * @param {{ canUse: boolean; isAdmin: boolean }} arg1
 */
export function ApiTokensSection({ canUse, isAdmin }) {
  const [tokens, setTokens] = useState(/** @type {ApiToken[] | null | (() => ApiToken[] | null)} */ (null));
  const [everyone, setEveryone] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState(/** @type {TokenScope | (() => TokenScope)} */ ("read"));
  const [days, setDays] = useState(30);
  const [fresh, setFresh] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [error, setError] = useState("");
  const load = useCallback(() => /** @type {Promise<Array<ApiToken>>} */ (/** @type {unknown} */ (api(`/tokens${everyone ? "?all=1" : ""}`))).then(setTokens).catch((e) => setError(errText(e, "Couldn't load tokens"))), [everyone]);
  useEffect(() => {
    load();
  }, [load]);
  const now = Date.now();
  const live = /** @param {ApiToken} t */ (t) => !t.revokedAt && Date.parse(t.expiresAt) > now;
  return (
    <Section icon={<KeyRound size={18} />} title="API tokens" sub={`For other systems that use Pulse's API. A token acts as you, with your permissions, up to ${API_RATE_LIMIT} requests a minute. Read tokens can't change anything. Only a hash is kept, so a token is shown once.`}>
      {error && <p className="form-error">{error}</p>}
      {fresh && <CopyOnce label="Your new token." value={fresh} />}
      {canUse ? (
        <form
          className="set-form token-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              const t = await /** @type {Promise<ApiToken & { token: string; }>} */ (/** @type {unknown} */ (api("/tokens", "POST", { name, scope, days })));
              setFresh(t.token);
              setName("");
              await load();
            } catch (err) {
              setError(errText(err, "Couldn't make the token"));
            }
          }}
        >
          <div className="field-row three">
            <label className="field">
              <span>What will use it</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reporting script" maxLength={60} required />
            </label>
            <label className="field">
              <span>Access</span>
              <select value={scope} onChange={(e) => setScope(/** @type {TokenScope} */ (e.target.value))}>
                <option value="read">Read only</option>
                <option value="write">Read and write</option>
              </select>
            </label>
            <label className="field">
              <span>Expires after</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {TOKEN_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="btn btn-navy">
            <KeyRound size={14} /> Make a token
          </button>
        </form>
      ) : (
        <p className="set-note">Your role doesn't use API tokens.</p>
      )}
      {isAdmin && (
        <label className="wi-check">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Show everyone's tokens (administrators)
        </label>
      )}
      {tokens && tokens.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">API tokens</caption>
            <thead>
              <tr>
                {everyone && <th scope="col">Person</th>}
                <th scope="col">Name</th>
                <th scope="col">Starts with</th>
                <th scope="col">Access</th>
                <th scope="col">Expires</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className={live(t) ? "" : "muted-row"}>
                  {everyone && <td>{t.userName ?? t.userId}</td>}
                  <td>{t.name}</td>
                  <td>
                    <code>{t.prefix}…</code>
                  </td>
                  <td>{t.scope === "write" ? "Read and write" : "Read only"}</td>
                  <td>{t.revokedAt ? `Revoked ${formatDate(t.revokedAt)}` : formatDate(t.expiresAt)}</td>
                  <td>{t.lastUsedAt ? timeAgo(t.lastUsedAt, now) : "Never"}</td>
                  <td>
                    {live(t) && (
                      <button
                        className="btn btn-ghost sm"
                        onClick={async () => {
                          if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working at once.`)) return;
                          try {
                            await api(`/tokens/${t.id}`, "DELETE");
                            await load();
                          } catch (e) {
                            setError(errText(e, "Couldn't revoke it"));
                          }
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ApiReference />
    </Section>
  );
}
/**
 * A short API reference; docs/API.md in the repository has the full one.
 */
export function ApiReference() {
  return (
    <details className="api-ref">
      <summary>API reference</summary>
      <p>
        Send the token in a header: <code>Authorization: Bearer pulse_…</code>. Every request runs as the token's owner, with the same permissions and visibility rules (including security levels). Responses are JSON. Errors come back as <code>{'{ "error": "…" }'}</code> with a 4xx status; 429 means
        slow down (up to {API_RATE_LIMIT} requests a minute).
      </p>
      <table className="table">
        <caption className="sr-only">Endpoints</caption>
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["GET /api/items?system=&status=&assignee=&q=&offset=&limit=", "A page of work items (filters, sort=key|updated|priority|due)"],
            ["GET /api/items/KEY-12", "One work item, with its links, fields and history"],
            ["POST /api/items", "Create a work item: systemId, type, summary, description, priority, assignee, customFields"],
            ["PATCH /api/items/KEY-12", "Change fields; status moves go through the workflow"],
            ["POST /api/items/KEY-12/transitions", "Make a workflow move: transitionId or to, plus comment"],
            ["GET|POST /api/items/KEY-12/comments", "Read or add comments"],
            ["POST /api/search", "Run PQL: { pql, offset, limit }"],
            ["GET /api/search/fields", "Fields, functions and values for PQL"],
            ["GET /api/service-desk/queues?queue=unassigned|mine|at_risk|breached|all_open", "Service desk queues, with SLA clocks"],
          ].map(([r, w]) => (
            <tr key={r}>
              <td>
                <code>{r}</code>
              </td>
              <td>{w}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="set-note">
        Tokens can't be used for accounts, sign-in, tokens, view-only links or integrations. Webhooks are signed: check <code>X-Pulse-Signature</code>, an HMAC-SHA256 of the body with the webhook's secret.
      </p>
    </details>
  );
}
/**
 * @returns {string}
 */
function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/**
 * @param {{ systems: System[] }} arg1
 */
export function IntegrationsSection({ systems }) {
  const [gh, setGh] = useState(/** @type {GitHubStatus | null | (() => GitHubStatus | null)} */ (null));
  const [secret, setSecret] = useState("");
  const [ghMsg, setGhMsg] = useState(/** @type {{ ok: boolean; text: string } | null | (() => { ok: boolean; text: string } | null)} */ (null));
  const [hooks, setHooks] = useState(/** @type {Webhook[] | null | (() => Webhook[] | null)} */ (null));
  const [editing, setEditing] = useState(/** @type {Partial<Webhook> | null | (() => Partial<Webhook> | null)} */ (null));
  const [freshSecret, setFreshSecret] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [deliveries, setDeliveries] = useState(/** @type {{ hook: Webhook; list: WebhookDelivery[] } | null | (() => { hook: Webhook; list: WebhookDelivery[] } | null)} */ (null));
  const [error, setError] = useState("");
  const loadGh = useCallback(() => /** @type {Promise<GitHubStatus>} */ (/** @type {unknown} */ (api("/integrations/github"))).then(setGh).catch((e) => setGhMsg({ ok: false, text: errText(e, "Couldn't load GitHub") })), []);
  const loadHooks = useCallback(() => /** @type {Promise<Array<Webhook>>} */ (/** @type {unknown} */ (api("/webhooks"))).then(setHooks).catch((e) => setError(errText(e, "Couldn't load webhooks"))), []);
  useEffect(() => {
    loadGh();
    loadHooks();
  }, [loadGh, loadHooks]);
  const now = Date.now();
  return (
    <>
      <Section icon={<GitBranch size={18} />} title="GitHub" sub="Commits, branches and pull requests that mention a work item's key (like INFRA-12) appear in that item's Development panel.">
        {gh && <p className={gh.connected ? "form-ok" : "muted"}>{gh.connected ? `Connected${gh.updatedAt ? ` since ${formatDate(gh.updatedAt)}` : ""}. ${gh.links} links so far.` : "Not connected."}</p>}
        <ol className="steps">
          <li>
            Make a secret:{" "}
            <button type="button" className="btn btn-ghost sm" onClick={() => setSecret(randomSecret())}>
              Make one for me
            </button>{" "}
            or type your own (20 characters or more).
          </li>
          <li>Save it here, below. Pulse seals it; it's never shown again.</li>
          <li>
            In GitHub, open the repository (or the organisation) → <b>Settings</b> → <b>Webhooks</b> → <b>Add webhook</b>.
          </li>
          <li>
            <b>Payload URL:</b> <code>{gh?.webhookUrl ?? "…/api/integrations/github/webhook"}</code>
          </li>
          <li>
            <b>Content type:</b> <code>application/json</code>. <b>Secret:</b> the same secret.
          </li>
          <li>
            <b>Which events:</b> "Let me select individual events" → <b>Pushes</b>, <b>Branch or tag creation</b> and <b>Pull requests</b>. Save; GitHub sends a ping, which shows below.
          </li>
          <li>Put the key in commit messages, branch names (feature/INFRA-12-login) or pull request titles.</li>
        </ol>
        <form
          className="set-form secret-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/integrations/github", "PUT", { secret });
              setGhMsg({ ok: true, text: "Saved. Use the same secret in GitHub." });
              await loadGh();
            } catch (err) {
              setGhMsg({ ok: false, text: errText(err, "Couldn't save") });
            }
          }}
        >
          <label className="field">
            <span>Webhook secret</span>
            <input value={secret} onChange={(e) => setSecret(e.target.value)} minLength={20} maxLength={200} autoComplete="off" spellCheck={false} className="mono" required />
          </label>
          <span className="set-actions">
            <button type="submit" className="btn btn-navy">
              Save secret
            </button>
            {gh?.connected && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  if (!window.confirm("Disconnect GitHub? Links already made stay on the items.")) return;
                  await api("/integrations/github", "DELETE").catch(() => undefined);
                  await loadGh();
                }}
              >
                Disconnect
              </button>
            )}
          </span>
        </form>
        {secret && <p className="set-note">Copy the secret before you save: it won't be shown again.</p>}
        {ghMsg && <p className={ghMsg.ok ? "form-ok" : "form-error"}>{ghMsg.text}</p>}
        {gh && gh.recent.length > 0 && (
          <div>
            <h4>Recent events from GitHub</h4>
            <ul className="plain-list">
              {gh.recent.map((r, i) => (
                <li key={i}>
                  {r.event}: {r.linked} link{r.linked === 1 ? "" : "s"} · {timeAgo(r.at, now)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        icon={<WebhookIcon size={18} />}
        title="Outbound webhooks"
        sub="Pulse posts work item events (created, updated, moved, commented) to other systems, signed with HMAC-SHA256 in X-Pulse-Signature. A failed delivery is retried after 15 seconds, then after 1, 2, 4 and 8 hours. Items with a security level are never sent."
      >
        {error && <p className="form-error">{error}</p>}
        {freshSecret && <CopyOnce label="The webhook's signing secret." value={freshSecret} />}
        {hooks && hooks.length === 0 && <p className="muted">No webhooks yet.</p>}
        {hooks && hooks.length > 0 && (
          <ul className="level-list">
            {hooks.map((h) => (
              <li key={h.id}>
                <div>
                  <b>
                    {h.name} {!h.enabled && <span className="muted">(off)</span>}
                  </b>
                  <small className="muted">
                    {new URL(h.url).host} · {h.events.map((e) => WEBHOOK_EVENTS.find((x) => x.key === e)?.label.toLowerCase()).join(", ")} · {h.systemId ? (systems.find((s) => s.id === h.systemId)?.name ?? "one project") : "every project"}
                    {h.lastDelivery && ` · last: ${h.lastDelivery.status}${h.lastDelivery.code ? ` (${h.lastDelivery.code})` : ""} ${timeAgo(h.lastDelivery.at, now)}`}
                  </small>
                </div>
                <span className="row-actions">
                  <button
                    className="btn btn-ghost sm"
                    onClick={async () => {
                      const r = await /** @type {Promise<{ ok: boolean; code?: number; error?: string; }>} */ (/** @type {unknown} */ (api(`/webhooks/${h.id}/test`, "POST"))).catch(/** @returns {{ ok: boolean; code?: number; error?: string }} */ (e) => ({ ok: false, error: errText(e, "failed") }));
                      window.alert(r.ok ? `Delivered${r.code ? ` (${r.code})` : ""}.` : `Not delivered: ${r.error ?? "unknown"}`);
                      await loadHooks();
                    }}
                  >
                    <Send size={13} /> Test
                  </button>
                  <button className="btn btn-ghost sm" onClick={async () => setDeliveries({ hook: h, list: await /** @type {Promise<Array<WebhookDelivery>>} */ (/** @type {unknown} */ (api(`/webhooks/${h.id}/deliveries`))) })}>
                    Deliveries
                  </button>
                  <button className="btn btn-ghost sm" onClick={() => setEditing({ ...h })}>
                    Edit
                  </button>
                  <button
                    className="icon-link danger"
                    aria-label={`Delete ${h.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Delete the webhook "${h.name}"?`)) return;
                      await api(`/webhooks/${h.id}`, "DELETE").catch((e) => setError(errText(e, "Couldn't delete it")));
                      await loadHooks();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {editing ? (
          <form
            className="set-form inline-editor"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const b = { name: editing.name, url: editing.url, systemId: editing.systemId ?? null, events: editing.events ?? [], enabled: editing.enabled !== false };
                if (editing.id) await api(`/webhooks/${editing.id}`, "PUT", b);
                else setFreshSecret((await /** @type {Promise<Webhook & { secret: string; }>} */ (/** @type {unknown} */ (api("/webhooks", "POST", b)))).secret);
                setEditing(null);
                await loadHooks();
              } catch (err) {
                setError(errText(err, "Couldn't save"));
              }
            }}
          >
            <div className="field-row">
              <label className="field">
                <span>Name</span>
                <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} required />
              </label>
              <label className="field">
                <span>Address (https://)</span>
                <input type="url" value={editing.url ?? ""} onChange={(e) => setEditing({ ...editing, url: e.target.value })} placeholder="https://example.com/pulse-events" required />
              </label>
            </div>
            <label className="field">
              <span>Projects</span>
              <select value={editing.systemId ?? ""} onChange={(e) => setEditing({ ...editing, systemId: e.target.value || undefined })}>
                <option value="">Every project</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field checks">
              <legend>Events</legend>
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev.key} className="wi-check">
                  <input type="checkbox" checked={(editing.events ?? []).includes(ev.key)} onChange={(e) => setEditing({ ...editing, events: e.target.checked ? [...(editing.events ?? []), ev.key] : (editing.events ?? []).filter(/** @param {WebhookEvent} x */ (x) => x !== ev.key) })} /> {ev.label}
                </label>
              ))}
              <label className="wi-check">
                <input type="checkbox" checked={editing.enabled !== false} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> On
              </label>
            </fieldset>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-navy">
                Save webhook
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-ghost" onClick={() => setEditing({ events: WEBHOOK_EVENTS.map((e) => e.key), enabled: true })}>
            <Plug size={14} /> Add a webhook
          </button>
        )}
        <ApiReference />
      </Section>

      {deliveries && (
        <div className="backdrop modal-backdrop" onClick={() => setDeliveries(null)}>
          <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Deliveries: ${deliveries.hook.name}`} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="close-btn" onClick={() => setDeliveries(null)} aria-label="Close">
              <X size={18} />
            </button>
            <h2>Deliveries: {deliveries.hook.name}</h2>
            <p className="modal-note">The last 50. Kept for 30 days.</p>
            {!deliveries.list.length ? (
              <p className="muted">None yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Event</th>
                      <th scope="col">Item</th>
                      <th scope="col">Result</th>
                      <th scope="col">Tries</th>
                      <th scope="col">
                        <span className="sr-only">Retry</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.list.map((d) => (
                      <tr key={d.id}>
                        <td>{timeAgo(d.createdAt, now)}</td>
                        <td>{d.event}</td>
                        <td>{d.itemKey ?? "—"}</td>
                        <td>
                          <span className={`run-status ${d.status === "delivered" ? "success" : d.status === "failed" ? "error" : "skipped"}`}>{d.status}</span> {d.lastStatus ? `(${d.lastStatus}) ` : ""}
                          {d.lastError ?? ""}
                          {d.nextAttemptAt ? ` · next try ${timeAgo(d.nextAttemptAt, now)}` : ""}
                        </td>
                        <td>{d.attempts}</td>
                        <td>
                          {d.status !== "delivered" && (
                            <button
                              className="btn btn-ghost sm"
                              onClick={async () => {
                                await api(`/webhooks/deliveries/${d.id}/retry`, "POST").catch(() => undefined);
                                setDeliveries({ hook: deliveries.hook, list: await /** @type {Promise<Array<WebhookDelivery>>} */ (/** @type {unknown} */ (api(`/webhooks/${deliveries.hook.id}/deliveries`))) });
                              }}
                            >
                              <RefreshCw size={13} /> Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
/** @typedef {Omit<CustomField, "id" | "options"> & { id?: string; options: { id?: string; label: string }[] }} FieldDraft */
/**
 * @typedef {Object} GitHubStatus
 * @property {boolean} connected
 * @property {string} [updatedAt]
 * @property {string} webhookUrl
 * @property {number} links
 * @property {{ event: string; linked: number; at: string }[]} recent
 */
