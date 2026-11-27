/** @import { User } from '../data/roles' */
/** @import { WorkItem } from '../data/workitems' */
/** @import { CustomField, CustomFieldValue, CustomValue } from '../data/admin' */
import { useEffect, useState } from "react";
import { GitBranch, GitCommitHorizontal, GitPullRequest, Headset, ListPlus, Lock, Stamp, Timer, Zap } from "lucide-react";
import { api } from "../data/api";
import { SLA_TARGET_LABEL, formatWorking } from "../data/workCalendar";
import { REQUEST_KINDS } from "../data/servicedesk";
import { formatDate, timeAgo } from "../time";
import { SlaBadge } from "./ServiceDeskParts";
/**
 * @param {{ title: string; icon: React.ReactNode; children: React.ReactNode }} props
 */
function Panel({ title, icon, children }) {
  return (
    <section className="p-card wi-section">
      <header className="wi-section-head">
        <h3>
          {icon} {title}
        </h3>
      </header>
      {children}
    </section>
  );
}
/**
 * One custom field's input, for the create form and the item page.
 * @param {{ field: CustomField; value: CustomValue; users: User[]; onChange: (v: CustomValue) => void; id?: string }} props
 */
export function CustomFieldInput({ field, value, users, onChange, id }) {
  const label = `${field.name}${field.required ? " (required)" : ""}`;
  switch (field.kind) {
    case "text":
      return <input id={id} value={/** @type {string} */ (value) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={500} aria-label={label} required={field.required} />;
    case "textarea":
      return <textarea id={id} rows={4} value={/** @type {string} */ (value) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={5000} aria-label={label} required={field.required} />;
    case "url":
      return <input id={id} type="url" placeholder="https://" value={/** @type {string} */ (value) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={500} aria-label={label} required={field.required} />;
    case "checkbox":
      return (
        <label className="wi-check">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {field.name}
        </label>
      );
    case "currency":
      return (
        <span className="cf-money">
          <span aria-hidden="true">{field.currency ?? ""}</span>
          <input id={id} type="number" step="0.01" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} aria-label={`${label}, in ${field.currency ?? "the field's currency"}`} required={field.required} />
        </span>
      );
    case "number":
      return <input id={id} type="number" step="any" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} aria-label={label} required={field.required} />;
    case "date":
      return <input id={id} type="date" value={/** @type {string} */ (value) ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} required={field.required} />;
    case "user":
      return (
        <select id={id} value={/** @type {string} */ (value) ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} required={field.required}>
          <option value="">Nobody</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    case "select":
      return (
        <select id={id} value={/** @type {string} */ (value) ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} required={field.required}>
          <option value="">None</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset className="cf-multi" id={id}>
          <legend className="sr-only">{label}</legend>
          {field.options.map((o) => (
            <label key={o.id} className="wi-check">
              <input type="checkbox" checked={chosen.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} /> {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
  }
}
/**
 * The item's custom fields: shown where "on view", editable where "on edit".
 * @param {{ item: WorkItem; users: User[]; canEdit: boolean; onSave: (patch: Record<string, CustomValue>) => Promise<boolean> }} props
 */
export function CustomFieldsPanel({ item, users, canEdit, onSave }) {
  const shown = item.fieldDefs.filter((f) => f.onView || (canEdit && f.onEdit));
  const valueOf = /** @param {CustomField} f */ (f) => item.fieldValues.find((v) => v.fieldId === f.id);
  const [editing, setEditing] = useState(/** @type {Record<string, CustomValue> | null | (() => Record<string, CustomValue> | null)} */ (null));
  if (!shown.length) return null;
  return (
    <Panel title="More fields" icon={<ListPlus size={16} />}>
      {editing ? (
        <form
          className="cf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave(editing)) setEditing(null);
          }}
        >
          {item.fieldDefs
            .filter((f) => f.onEdit)
            .map((f) => (
              <label key={f.id} className="field">
                <span>
                  {f.name}
                  {f.required ? " (required)" : ""}
                </span>
                <CustomFieldInput field={f} users={users} value={editing[f.id] ?? null} onChange={(v) => setEditing({ ...editing, [f.id]: v })} />
                {f.description && <small className="field-hint">{f.description}</small>}
              </label>
            ))}
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost sm" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-navy sm">
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="facts">
            {shown
              .filter((f) => f.onView)
              .map((f) => (
                <div key={f.id} className="fact-row">
                  <dt>{f.name}</dt>
                  <dd>
                    {f.kind === "url" && valueOf(f)?.display ? (
                      // Only https:// and http:// addresses are stored (worker/customfields.js), so this can't run script.
                      <a href={valueOf(f)?.display} target="_blank" rel="noopener noreferrer">
                        {valueOf(f)?.display}
                      </a>
                    ) : (
                      valueOf(f)?.display || <span className="muted">—</span>
                    )}
                  </dd>
                </div>
              ))}
          </dl>
          {canEdit && item.fieldDefs.some((f) => f.onEdit) && (
            <button className="btn btn-ghost sm" onClick={() => setEditing(Object.fromEntries(item.fieldDefs.filter((f) => f.onEdit).map((f) => [f.id, valueOf(f)?.value ?? null])))}>
              Edit fields
            </button>
          )}
        </>
      )}
    </Panel>
  );
}
/**
 * Values to show on a card or in a table row.
 * @param {{ values?: CustomFieldValue[] }} arg1
 */
export function CustomFieldChips({ values }) {
  const list = (values ?? []).filter((v) => v.display);
  if (!list.length) return null;
  return (
    <span className="cf-chips">
      {list.map((v) => (
        <span key={v.fieldId} className="cf-chip" title={v.name}>
          <span className="sr-only">{v.name}: </span>
          {v.display}
        </span>
      ))}
    </span>
  );
}
/**
 * The security level: who may see this item.
 * @param {{ item: WorkItem; canEdit: boolean; busy: boolean; onSave: (level: string | null) => void }} props
 */
export function SecurityLevelField({ item, canEdit, busy, onSave }) {
  const mayChange = canEdit && (!item.securityLevel || item.securityLevels.some((l) => l.id === item.securityLevel));
  if (!mayChange) {
    return item.securityLevel ? (
      <span className="level-tag">
        <Lock size={13} aria-hidden="true" /> {item.securityLevelName ?? "Restricted"}
      </span>
    ) : (
      <span className="muted">Anyone who can see the project</span>
    );
  }
  if (!item.securityLevels.length && !item.securityLevel) return <span className="muted">Anyone who can see the project</span>;
  return (
    <select value={item.securityLevel ?? ""} disabled={busy} onChange={(e) => onSave(e.target.value || null)} aria-label="Security level">
      <option value="">Anyone who can see the project</option>
      {item.securityLevels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
const DEV_ICON = { commit: GitCommitHorizontal, branch: GitBranch, pull_request: GitPullRequest };
const DEV_LABEL = { commit: "Commits", branch: "Branches", pull_request: "Pull requests" };
/**
 * Commits, branches and pull requests on GitHub that mention this item's key.
 * @param {{ item: WorkItem; now: number }} props
 */
export function DevelopmentPanel({ item, now }) {
  if (!item.devLinks.length) return null;
  return (
    <Panel title="Development" icon={<GitBranch size={16} />}>
      {/** @type {const} */ (["pull_request", "branch", "commit"]).map((kind) => {
        const list = item.devLinks.filter((l) => l.kind === kind);
        if (!list.length) return null;
        const Icon = DEV_ICON[kind];
        return (
          <div key={kind} className="dev-group">
            <h4>
              {DEV_LABEL[kind]} · {list.length}
            </h4>
            <ul className="dev-list">
              {list.slice(0, 20).map((l) => (
                <li key={l.id}>
                  <Icon size={14} aria-hidden="true" />
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {kind === "commit" ? <code>{l.ref.slice(0, 7)}</code> : kind === "pull_request" ? `#${l.ref}` : l.ref}
                  </a>
                  {kind !== "branch" && <span className="dev-title">{l.title}</span>}
                  {l.state && <span className={`dev-state ${l.state}`}>{l.state}</span>}
                  <small className="muted">
                    {l.repo}
                    {l.author ? ` · ${l.author}` : ""} · {timeAgo(l.at, now)}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Panel>
  );
}
/**
 * A service desk request: who asked, their answers, and the SLA clocks.
 * @param {{ item: WorkItem }} props
 */
export function RequestPanel({ item }) {
  const r = item.request;
  if (!r) return null;
  return (
    <Panel title={`Service desk: ${r.typeName}`} icon={<Headset size={16} />}>
      <div className="sla-row">
        <SlaBadge label="First reply" clock={r.firstResponse} />
        <SlaBadge label="Resolution" clock={r.resolution} />
        {r.waiting && <span className="sla-badge paused">Waiting for the customer: the clock is stopped</span>}
      </div>
      <dl className="facts">
        <div className="fact-row">
          <dt>Customer</dt>
          <dd>
            {r.customerName}
            {r.customerEmail && (
              <>
                {" "}
                · <a href={`mailto:${r.customerEmail}`}>{r.customerEmail}</a>
              </>
            )}
            {r.viaPortal ? " · through a portal link" : ""}
          </dd>
        </div>
        <div className="fact-row">
          <dt>Kind</dt>
          <dd>{REQUEST_KINDS[r.kind]}</dd>
        </div>
        {r.answers.map((a) => (
          <div key={a.label} className="fact-row">
            <dt>{a.label}</dt>
            <dd>{a.value}</dd>
          </div>
        ))}
      </dl>
      <p className="field-hint">
        The customer sees only replies marked "to the customer", and hears about status changes by email.
        {r.kind === "change" ? " A change is resolved through Change Approval, which a Manager approves." : ""}
        {r.firstResponse.dueAt ? ` First reply due ${formatDate(r.firstResponse.dueAt)}.` : ""}
      </p>
    </Panel>
  );
}
/**
 * Automation rules with a button ("Someone presses its button on a work item") that apply to this item.
 * @param {{ itemKey: string; onRan: () => void }} props
 */
export function AutomationButtons({ itemKey, onRan }) {
  const [rules, setRules] = useState(/** @type {{ id: string; name: string; description: string }[]} */ ([]));
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    api(`/automation/manual?item=${encodeURIComponent(itemKey)}`)
      .then((r) => setRules(/** @type {typeof rules} */ (r)))
      .catch(() => setRules([]));
  }, [itemKey]);
  if (!rules.length) return null;
  return (
    <Panel title="Automation" icon={<Zap size={16} />}>
      <div className="auto-buttons">
        {rules.map((r) => (
          <button
            key={r.id}
            className="btn btn-ghost sm"
            title={r.description}
            disabled={!!busy}
            onClick={async () => {
              setBusy(r.id);
              setNote("");
              try {
                const res = /** @type {{ ran: boolean; reason?: string; status?: string; message?: string }} */ (await api(`/automation/manual/${r.id}`, "POST", { itemKey }));
                setNote(res.ran ? `${r.name}: ${res.message ?? "done"}` : `${r.name} didn't run: ${res.reason}`);
                onRan();
              } catch (e) {
                setNote(e instanceof Error ? e.message : "Couldn't run it");
              } finally {
                setBusy("");
              }
            }}
          >
            <Zap size={13} /> {r.name}
          </button>
        ))}
      </div>
      {note && (
        <p className="field-hint" role="status">
          {note}
        </p>
      )}
    </Panel>
  );
}
/**
 * A move waiting for approval: who asked, who may approve and who has, and (for an approver who hasn't decided yet)
 * Approve and Reject; a rejection needs a reason. Whoever asked can cancel it.
 * @param {{ item: WorkItem; meId: string; onDone: () => void }} props
 */
export function ApprovalPanel({ item, meId, onDone }) {
  const a = item.approval;
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!a) return null;
  const decided = a.votes.some((v) => v.userId === meId);
  const mayDecide = a.approvers.some((p) => p.id === meId) && !decided;
  /** @param {"approve" | "reject" | "cancel"} what @param {Record<string, unknown>} [b] */
  const act = async (what, b = {}) => {
    setBusy(true);
    setError("");
    try {
      await api(`/approvals/${a.id}/${what}`, "POST", b);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Waiting for approval" icon={<Stamp size={16} />}>
      <p>
        <b>{a.requestedBy}</b> asked to <b>{a.move}</b> (to {a.toStatus}) {timeAgo(a.requestedAt, Date.now())}. It needs {a.needed === 1 ? "one approval" : `${a.needed} approvals`} from {a.approvers.map((p) => p.name).join(", ")}; {a.approvals} so far.
      </p>
      {a.votes.length > 0 && (
        <ul className="approval-votes">
          {a.votes.map((v, i) => (
            <li key={i}>
              {v.decision === "approve" ? "✓" : "✗"} {v.by}
              {v.comment ? `: ${v.comment}` : ""}
            </li>
          ))}
        </ul>
      )}
      {mayDecide &&
        (rejecting ? (
          <form
            className="approval-reject"
            onSubmit={(e) => {
              e.preventDefault();
              act("reject", { reason });
            }}
          >
            <label className="field">
              <span>Why it's rejected (required)</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} autoFocus />
            </label>
            <div className="org-row">
              <button className="btn btn-danger sm" disabled={busy || !reason.trim()}>
                Reject
              </button>
              <button type="button" className="btn btn-ghost sm" onClick={() => setRejecting(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="org-row">
            <button className="btn btn-navy sm" disabled={busy} onClick={() => act("approve")}>
              Approve
            </button>
            <button className="btn btn-ghost sm" disabled={busy} onClick={() => setRejecting(true)}>
              Reject…
            </button>
          </div>
        ))}
      {a.requestedById === meId && (
        <button className="btn btn-ghost sm" disabled={busy} onClick={() => window.confirm("Cancel this approval request? The item stays where it is.") && act("cancel")}>
          Cancel the request
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
/**
 * The item's SLA targets: time left, or met, missed or breached, in working time.
 * @param {{ item: WorkItem }} props
 */
export function SlaPanel({ item }) {
  if (!item.sla) return null;
  const rows = [item.sla.response, item.sla.resolution].filter(/** @returns {t is import("../data/workCalendar").SlaTarget} */ (t) => !!t);
  return (
    <Panel title={`SLA: ${item.sla.policy.name}`} icon={<Timer size={16} />}>
      <dl className="facts">
        {rows.map((t) => (
          <div key={t.target} className="fact-row">
            <dt>{t.target === "response" ? "First response" : "Resolution"}</dt>
            <dd>
              <span className={`sla-pill ${t.state}`}>{SLA_TARGET_LABEL[t.state]}</span>{" "}
              <span className="muted">
                {formatWorking(t.elapsedMinutes)} of {formatWorking(t.targetMinutes)}
                {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="field-hint">Counted in working hours.</p>
    </Panel>
  );
}
