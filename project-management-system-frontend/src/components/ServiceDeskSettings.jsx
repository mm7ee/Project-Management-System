/** @import { SlaTarget } from '../data/servicedesk' */
/** @import { System } from '../data/systems' */
/** @import { Holiday, PortalLink, RequestFieldKind, RequestKind, RequestType } from '../data/servicedesk' */
import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Headset, Link2, ListChecks, Plus, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { WORK_PRIORITY_META } from "../data/workitems";
import { BUSINESS_DAY_MINUTES, REQUEST_FIELD_KINDS, REQUEST_KINDS, formatBusinessMinutes } from "../data/servicedesk";
import { Section } from "./SettingsParts";
import { formatDate, timeAgo } from "../time";
const errText =
  /** @param {unknown} e
   * @param {string} fallback
   * @returns {string}
   */ (e, fallback) => (e instanceof Error ? e.message : fallback);
/** Minutes shown and typed as hours (business hours). */
const hours =
  /** @param {number} m
   * @returns {number}
   */ (m) => Math.round((m / 60) * 100) / 100;
/**
 * @param {{ systems: System[] }} arg3
 */
export default function ServiceDeskSettings({ systems }) {
  const [cfg, setCfg] = useState(/** @type {Config | null | (() => Config | null)} */ (null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(/** @type {RequestType | null | (() => RequestType | null)} */ (null));
  const [holidays, setHolidays] = useState(/** @type {Holiday[] | (() => Holiday[])} */ ([]));
  const [linkLabel, setLinkLabel] = useState("");
  const [linkDays, setLinkDays] = useState(90);
  const [freshUrl, setFreshUrl] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const load = useCallback(async () => {
    try {
      const c = await /** @type {Promise<Config>} */ (/** @type {unknown} */ (api("/service-desk/config")));
      setCfg(c);
      setHolidays(c.holidays);
    } catch (e) {
      setError(errText(e, "Couldn't load the service desk"));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!cfg) return <p className="muted">{error || "Loading…"}</p>;
  const now = Date.now();
  return (
    <>
      <Section icon={<Headset size={18} />} title="Service desk" sub="Requests raised on the portal become work items in one project, which uses the Service desk workflow (To Do → In Progress ⇄ Waiting for customer → Resolved, with Change Approval for changes).">
        {error && <p className="form-error">{error}</p>}
        {notice && (
          <p className="form-ok" role="status">
            {notice}
          </p>
        )}
        <label className="field">
          <span>Project that receives requests</span>
          <select
            value={cfg.systemId ?? ""}
            onChange={async (e) => {
              setError("");
              try {
                await api("/service-desk/config", "PUT", { systemId: e.target.value || null });
                setNotice(e.target.value ? "Saved. That project now uses the Service desk workflow." : "Saved. The portal is closed until a project is chosen.");
                await load();
              } catch (err) {
                setError(errText(err, "Couldn't save"));
              }
            }}
          >
            <option value="">Not set up: the portal is closed</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className="set-note">SLA clocks count business hours: Monday to Friday, 08:00 to 17:00 Harare time, except the holidays below. They stop while a request waits for the customer, warn at 75% and alert on a breach.</p>
      </Section>

      <Section icon={<ListChecks size={18} />} title="Request types" sub="What people can ask for, the questions each one asks, and its SLA targets.">
        <ul className="level-list">
          {cfg.types.map((t) => (
            <li key={t.id}>
              <div>
                <b>
                  {t.name} {!t.enabled && <span className="muted">(off)</span>}
                </b>
                <small className="muted">
                  {REQUEST_KINDS[t.kind]} · {t.fields.length} question{t.fields.length === 1 ? "" : "s"} · Medium: reply in {formatBusinessMinutes(/** @type {SlaTarget} */ (t.targets.find((x) => x.priority === "MEDIUM")).firstResponseMinutes)}, resolve in{" "}
                  {formatBusinessMinutes(/** @type {SlaTarget} */ (t.targets.find((x) => x.priority === "MEDIUM")).resolutionMinutes)}
                </small>
              </div>
              <button className="btn btn-ghost sm" onClick={() => setEditing(JSON.parse(JSON.stringify(t)))}>
                Edit
              </button>
            </li>
          ))}
        </ul>
        {!editing && (
          <button
            className="btn btn-ghost"
            onClick={() =>
              setEditing({
                id: "",
                name: "",
                kind: "service_request",
                description: "",
                itemType: "TASK",
                enabled: true,
                fields: [],
                targets: cfg.types[0]?.targets ?? /** @type {const} */ (["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"]).map((p) => ({ priority: p, firstResponseMinutes: 240, resolutionMinutes: 1620 })),
              })
            }
          >
            <Plus size={14} /> Add a request type
          </button>
        )}
        {editing && (
          <TypeEditor
            type={editing}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={async () => {
              setError("");
              try {
                if (editing.id) await api(`/service-desk/types/${editing.id}`, "PUT", editing);
                else await api("/service-desk/types", "POST", editing);
                setEditing(null);
                setNotice("Request type saved.");
                await load();
              } catch (e) {
                setError(errText(e, "Couldn't save"));
              }
            }}
            onDelete={
              editing.id
                ? async () => {
                    if (!window.confirm(`Delete "${editing.name}"? Only possible if no requests use it.`)) return;
                    try {
                      await api(`/service-desk/types/${editing.id}`, "DELETE");
                      setEditing(null);
                      await load();
                    } catch (e) {
                      setError(errText(e, "Couldn't delete it"));
                    }
                  }
                : undefined
            }
          />
        )}
      </Section>

      <Section icon={<CalendarOff size={18} />} title="Public holidays" sub="SLA clocks don't run on these days. Zimbabwe's 2026 and 2027 holidays are filled in; check them each year.">
        <div className="holiday-list">
          {holidays.map((h, i) => (
            <div key={i} className="option-row">
              <input type="date" value={h.day} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} aria-label={`Holiday ${i + 1} date`} required />
              <input value={h.name} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Holiday ${i + 1} name`} maxLength={80} />
              <button type="button" className="icon-link danger" aria-label={`Remove ${h.name || `holiday ${i + 1}`}`} onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <span className="set-actions">
          <button className="btn btn-ghost sm" onClick={() => setHolidays([...holidays, { day: "", name: "" }])}>
            <Plus size={13} /> Add a holiday
          </button>
          <button
            className="btn btn-navy sm"
            onClick={async () => {
              setError("");
              try {
                const saved = await /** @type {Promise<Array<Holiday>>} */ (/** @type {unknown} */ (api("/service-desk/holidays", "PUT", { holidays: holidays.filter((h) => h.day || h.name) })));
                setHolidays(saved);
                setNotice("Holidays saved.");
              } catch (e) {
                setError(errText(e, "Couldn't save the holidays"));
              }
            }}
          >
            Save holidays
          </button>
        </span>
      </Section>

      <Section icon={<Link2 size={18} />} title="Portal links" sub="Send a link to people without an account (a client, a site) so they can raise requests and follow their own. Like a view-only link, it expires and can be turned off. Staff can also use Service desk → Raise a request.">
        {freshUrl && (
          <div className="secret-once" role="status">
            <p>
              <b>The portal link.</b> It's shown only this once: copy it now.
            </p>
            <div className="secret-row">
              <code>{freshUrl}</code>
              <button className="btn btn-ghost sm" onClick={() => navigator.clipboard.writeText(freshUrl).catch(() => undefined)}>
                Copy
              </button>
            </div>
          </div>
        )}
        <form
          className="set-form token-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              const l = await /** @type {Promise<PortalLink>} */ (/** @type {unknown} */ (api("/service-desk/portal-links", "POST", { label: linkLabel, days: linkDays })));
              setFreshUrl(l.url ?? null);
              setLinkLabel("");
              await load();
            } catch (err) {
              setError(errText(err, "Couldn't make the link"));
            }
          }}
        >
          <div className="field-row">
            <label className="field">
              <span>Who it's for</span>
              <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Kopje Bank operations team" maxLength={80} required />
            </label>
            <label className="field">
              <span>Expires after</span>
              <select value={linkDays} onChange={(e) => setLinkDays(Number(e.target.value))}>
                {[7, 30, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="btn btn-navy">
            <Link2 size={14} /> Make a portal link
          </button>
        </form>
        {cfg.portalLinks.length > 0 && (
          <ul className="level-list">
            {cfg.portalLinks.map((l) => {
              const live = !l.revokedAt && Date.parse(l.expiresAt) > now;
              return (
                <li key={l.id} className={live ? "" : "muted-row"}>
                  <div>
                    <b>{l.label}</b>
                    <small className="muted">
                      {l.revokedAt ? `Turned off ${formatDate(l.revokedAt)}` : live ? `Expires ${formatDate(l.expiresAt)}` : `Expired ${formatDate(l.expiresAt)}`} · {l.requests} request{l.requests === 1 ? "" : "s"}
                      {l.lastUsedAt ? ` · last used ${timeAgo(l.lastUsedAt, now)}` : ""}
                    </small>
                  </div>
                  {live && (
                    <button
                      className="btn btn-ghost sm"
                      onClick={async () => {
                        if (!window.confirm(`Turn off the link for ${l.label}? It stops working at once.`)) return;
                        await api(`/service-desk/portal-links/${l.id}`, "DELETE").catch((e) => setError(errText(e, "Couldn't turn it off")));
                        await load();
                      }}
                    >
                      Turn off
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
/**
 * @param {{ type: RequestType; onChange: (t: RequestType) => void; onCancel: () => void; onSave: () => void; onDelete?: () => void }} props
 */
function TypeEditor({ type, onChange, onCancel, onSave, onDelete }) {
  const set = /** @param {Partial<RequestType>} patch */ (patch) => onChange({ ...type, ...patch });
  return (
    <form
      className="set-form inline-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      aria-label={type.id ? `Edit ${type.name}` : "New request type"}
    >
      <h4>{type.id ? `Edit "${type.name}"` : "New request type"}</h4>
      <div className="field-row">
        <label className="field">
          <span>Name</span>
          <input value={type.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required />
        </label>
        <label className="field">
          <span>Kind</span>
          <select value={type.kind} onChange={(e) => set({ kind: /** @type {RequestKind} */ (e.target.value) })}>
            {Object.entries(REQUEST_KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
                {k === "change" ? " (needs a Manager's approval)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Becomes a</span>
          <select value={type.itemType} onChange={(e) => set({ itemType: /** @type {"TASK" | "BUG"} */ (e.target.value) })}>
            <option value="TASK">Task</option>
            <option value="BUG">Bug</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Description (shown on the portal)</span>
        <input value={type.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} />
      </label>
      <label className="wi-check">
        <input type="checkbox" checked={type.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Offered on the portal
      </label>

      <fieldset className="rule-part">
        <legend>Questions</legend>
        {type.fields.map((f, i) => (
          <div key={f.id || i} className="question-row">
            <label className="field grow">
              <span>Question {i + 1}</span>
              <input value={f.label} onChange={(e) => set({ fields: type.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} maxLength={120} required />
            </label>
            <label className="field">
              <span>Answer</span>
              <select value={f.kind} onChange={(e) => set({ fields: type.fields.map((x, j) => (j === i ? { ...x, kind: /** @type {RequestFieldKind} */ (e.target.value) } : x)) })}>
                {Object.entries(REQUEST_FIELD_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {f.kind === "select" && (
              <label className="field grow">
                <span>Choices (one per line)</span>
                <textarea rows={3} value={f.options.map((o) => o.label).join("\n")} onChange={(e) => set({ fields: type.fields.map((x, j) => (j === i ? { ...x, options: e.target.value.split("\n").map((label, k) => ({ id: x.options[k]?.id ?? String(k), label })) } : x)) })} />
              </label>
            )}
            <label className="wi-check">
              <input type="checkbox" checked={f.required} onChange={(e) => set({ fields: type.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> Required
            </label>
            <button type="button" className="icon-link danger" aria-label={`Remove question ${i + 1}`} onClick={() => set({ fields: type.fields.filter((_, j) => j !== i) })}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost sm" onClick={() => set({ fields: [...type.fields, { id: "", label: "", kind: "text", help: "", required: false, options: [] }] })} disabled={type.fields.length >= 20}>
          <Plus size={13} /> Add a question
        </button>
      </fieldset>

      <fieldset className="rule-part">
        <legend>SLA targets, in business hours</legend>
        <p className="set-note">A business day is {BUSINESS_DAY_MINUTES / 60} hours. For example, 27 hours is three business days.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Priority</th>
                <th scope="col">First response (hours)</th>
                <th scope="col">Resolution (hours)</th>
              </tr>
            </thead>
            <tbody>
              {type.targets.map((t, i) => (
                <tr key={t.priority}>
                  <th scope="row">{WORK_PRIORITY_META[t.priority].label}</th>
                  <td>
                    <input
                      type="number"
                      min={0.25}
                      step={0.25}
                      value={hours(t.firstResponseMinutes)}
                      onChange={(e) => set({ targets: type.targets.map((x, j) => (j === i ? { ...x, firstResponseMinutes: Math.round(Number(e.target.value) * 60) } : x)) })}
                      aria-label={`${WORK_PRIORITY_META[t.priority].label}: first response in hours`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0.25}
                      step={0.25}
                      value={hours(t.resolutionMinutes)}
                      onChange={(e) => set({ targets: type.targets.map((x, j) => (j === i ? { ...x, resolutionMinutes: Math.round(Number(e.target.value) * 60) } : x)) })}
                      aria-label={`${WORK_PRIORITY_META[t.priority].label}: resolution in hours`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <div className="modal-actions">
        {onDelete && (
          <button type="button" className="delete-link inline" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-navy">
          Save request type
        </button>
      </div>
    </form>
  );
}
/**
 * @typedef {Object} Config
 * @property {string | null} systemId
 * @property {RequestType[]} types
 * @property {Holiday[]} holidays
 * @property {PortalLink[]} portalLinks
 */
