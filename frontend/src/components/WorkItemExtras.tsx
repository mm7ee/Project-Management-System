import { useState } from "react";
import { GitBranch, GitCommitHorizontal, GitPullRequest, Headset, ListPlus, Lock } from "lucide-react";
import type { User } from "../data/roles";
import type { WorkItem } from "../data/workitems";
import type { CustomField, CustomFieldValue, CustomValue } from "../data/admin";
import { REQUEST_KINDS } from "../data/servicedesk";
import { formatDate, timeAgo } from "../time";
import { SlaBadge } from "./ServiceDeskParts";

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
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

/** One custom field's input, for the create form and the item page. */
export function CustomFieldInput({ field, value, users, onChange, id }: { field: CustomField; value: CustomValue; users: User[]; onChange: (v: CustomValue) => void; id?: string }) {
  const label = `${field.name}${field.required ? " (required)" : ""}`;
  switch (field.kind) {
    case "text":
      return <input id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={500} aria-label={label} required={field.required} />;
    case "number":
      return <input id={id} type="number" step="any" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} aria-label={label} required={field.required} />;
    case "date":
      return <input id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} required={field.required} />;
    case "user":
      return (
        <select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} required={field.required}>
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
        <select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} required={field.required}>
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

/** The item's custom fields: shown where "on view", editable where "on edit". */
export function CustomFieldsPanel({ item, users, canEdit, onSave }: { item: WorkItem; users: User[]; canEdit: boolean; onSave: (patch: Record<string, CustomValue>) => Promise<boolean> }) {
  const shown = item.fieldDefs.filter((f) => f.onView || (canEdit && f.onEdit));
  const valueOf = (f: CustomField) => item.fieldValues.find((v) => v.fieldId === f.id);
  const [editing, setEditing] = useState<Record<string, CustomValue> | null>(null);
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
                  <dd>{valueOf(f)?.display || <span className="muted">—</span>}</dd>
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

/** Values to show on a card or in a table row. */
export function CustomFieldChips({ values }: { values?: CustomFieldValue[] }) {
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

/** The security level: who may see this item. */
export function SecurityLevelField({ item, canEdit, busy, onSave }: { item: WorkItem; canEdit: boolean; busy: boolean; onSave: (level: string | null) => void }) {
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

/** Commits, branches and pull requests on GitHub that mention this item's key. */
export function DevelopmentPanel({ item, now }: { item: WorkItem; now: number }) {
  if (!item.devLinks.length) return null;
  return (
    <Panel title="Development" icon={<GitBranch size={16} />}>
      {(["pull_request", "branch", "commit"] as const).map((kind) => {
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

/** A service desk request: who asked, their answers, and the SLA clocks. */
export function RequestPanel({ item }: { item: WorkItem }) {
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
