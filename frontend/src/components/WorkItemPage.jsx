/** @import { WorkItemLink } from '../data/workitems' */
/** @import { FormEvent, ReactNode } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { LinkType, WorkComment, WorkItem, WorkItemPage as ItemPage, WorkItemSummary, WorkItemType } from '../data/workitems' */
/** @import { PendingMove } from './MoveDialog' */
import { useCallback, useEffect, useRef, useState } from "react";
import { AutomationButtons, CustomFieldsPanel, DevelopmentPanel, RequestPanel, SecurityLevelField } from "./WorkItemExtras";
import { ArrowLeft, Copy, Download, Eye, EyeOff, Link2, MessageSquare, Paperclip, Pencil, Plus, Timer, Trash2, Upload, X } from "lucide-react";
import { api, ApiError } from "../data/api";
import { formatBytes, MAX_DOCUMENT_BYTES } from "../data/project";
import { formatDate, timeAgo } from "../time";
import { LINK_META, LINK_TYPES, RESOLUTION_META, TYPE_META, WORK_PRIORITIES, WORK_PRIORITY_META, allowedParentTypes, childTypesOf, cleanLabel, formatMinutes, isDone, parseDuration } from "../data/workitems";
import Markdown from "./Markdown";
import { ItemPriority, ItemStatusPill, MarkdownField, Rollup, TypeIcon, itemHref } from "./WorkItemBits";
import MoveDialog from "./MoveDialog";
import { assignable as canHaveWork } from "../data/roles";
import { useItemTypes } from "../data/itemTypes";
/**
 * One work item's page: #/projects/<id>/items/<KEY-n>.
 * @param {Props} props
 */
export default function WorkItemPage({ system, itemKey, users, me, now, readOnly, canCreate, onChanged }) {
  const [item, setItem] = useState(/** @type {WorkItem | null | (() => WorkItem | null)} */ (null));
  const [missing, setMissing] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const itemTypes = useItemTypes();
  const [pending, setPending] = useState(/** @type {PendingMove | null | (() => PendingMove | null)} */ (null));
  const load = useCallback(async () => {
    try {
      setItem(await /** @type {Promise<WorkItem>} */ (/** @type {unknown} */ (api(`/items/${itemKey}`))));
      setMissing("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing("That work item doesn't exist, or it isn't one you can see.");
      else setError(e instanceof Error ? e.message : "Couldn't load it");
    }
  }, [itemKey]);
  useEffect(() => {
    setItem(null);
    setError("");
    load();
    window.scrollTo({ top: 0 });
  }, [load]);
  const nameOf = /** @param {string} [id] */ (id) => (id ? (users.find((u) => u.id === id)?.name ?? "Former user") : "Nobody");
  const usernames = users.map((u) => u.username);
  /** Saves one change; the page shows what the server saved. A moved item gets a new key. */
  const save = /** @param {Record<string, unknown>} patch */ async (patch) => {
    if (!item) return false;
    setBusy(true);
    setError("");
    try {
      const next = await /** @type {Promise<WorkItem>} */ (/** @type {unknown} */ (api(`/items/${item.key}`, "PATCH", patch)));
      if (next.key !== item.key) window.location.hash = itemHref(next.systemId, next.key).slice(1);
      setItem(next);
      if (item.source === "client_request" || system.progressFromItems || patch.status) await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const run = /** @param {() => Promise<unknown>} fn */ async (fn) => {
    setError("");
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  };
  if (missing)
    return (
      <div className="empty">
        {missing}{" "}
        <a className="link-btn" href={`#/projects/${system.id}/items`}>
          Back to {system.name}'s work items
        </a>
      </div>
    );
  if (!item) return <p className="lead-none">{error || "Loading…"}</p>;
  const can = readOnly ? { edit: false, delete: false, comment: false, logTime: false, assignOthers: false, replyToCustomer: false } : item.can;
  const people = users.filter((u) => canHaveWork(u.role) && (item.source !== "client_request" || u.role === "developer")).sort((a, b) => a.name.localeCompare(b.name));
  const assignable = can.assignOthers ? people : people.filter((u) => u.id === me.id);
  const done = isDone(item);
  return (
    <div className="wi-page">
      <nav className="wi-crumbs" aria-label="Breadcrumb">
        <a href={`#/projects/${system.id}/items`}>
          <ArrowLeft size={15} /> {system.name}
        </a>
        {item.parent && (
          <>
            <span aria-hidden="true">/</span>
            <a href={itemHref(system.id, item.parent.key)}>
              <TypeIcon type={item.parent.type} size={13} /> {item.parent.key}
            </a>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">
          <TypeIcon type={item.type} size={13} /> {item.key}
        </span>
      </nav>

      <header className="wi-head">
        <Summary item={item} canEdit={can.edit} onSave={(summary) => save({ summary })} />
        <div className="page-actions">
          {!readOnly && (
            <button className="btn btn-ghost sm" onClick={() => run(() => api(`/items/${item.key}/watch`, item.watching ? "DELETE" : "POST"))} aria-pressed={item.watching} title={item.watching ? "Stop getting alerts about this item" : "Get an alert when this item changes"}>
              {item.watching ? <EyeOff size={15} /> : <Eye size={15} />} {item.watching ? "Stop watching" : "Watch"} · {item.watchers.length}
            </button>
          )}
          {canCreate && !readOnly && (
            <button
              className="btn btn-ghost sm"
              onClick={async () => {
                try {
                  const copy = await /** @type {Promise<WorkItem>} */ (/** @type {unknown} */ (api(`/items/${item.key}/clone`, "POST", {})));
                  window.location.hash = itemHref(copy.systemId, copy.key).slice(1);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Couldn't clone it");
                }
              }}
            >
              <Copy size={15} /> Clone
            </button>
          )}
          {can.delete && <DeleteButton item={item} systemId={system.id} onDeleted={onChanged} onError={setError} />}
        </div>
      </header>
      {error && (
        <p className="form-error banner" role="alert">
          {error}
        </p>
      )}

      {pending && (
        <MoveDialog
          move={pending}
          users={users}
          me={me}
          canAssignOthers={can.assignOthers}
          onCancel={() => setPending(null)}
          onDone={async (next) => {
            setPending(null);
            setItem(next);
            await onChanged();
          }}
        />
      )}

      <div className="wi-grid">
        <div className="wi-main">
          <Description item={item} canEdit={can.edit} usernames={usernames} people={users} onSave={(description) => save({ description })} />

          {item.source === "client_request" && (
            <Section title="Client request">
              <dl className="facts">
                <dt>Requested by</dt>
                <dd>
                  <InlineText value={item.client ?? ""} label="Requested by" canEdit={can.edit} onSave={(client) => save({ client })} />
                </dd>
                <dt>Developer's notes</dt>
                <dd>
                  <InlineText value={item.notes ?? ""} label="Developer's notes" canEdit={can.edit} multiline onSave={(notes) => save({ notes })} />
                </dd>
              </dl>
              <p className="field-hint">This work item is also a client feature request: it shows on the Feature requests page, and keeps its request type as a label.</p>
            </Section>
          )}

          <RequestPanel item={item} />

          <CustomFieldsPanel item={item} users={users} canEdit={can.edit} onSave={(customFields) => save({ customFields })} />

          {!readOnly && <AutomationButtons itemKey={item.key} onRan={load} />}

          {!readOnly && <DevelopmentPanel item={item} now={now} />}

          {item.type !== "SUBTASK" && <Children item={item} systemId={system.id} nameOf={nameOf} canCreate={canCreate && !readOnly} onAdded={load} />}

          <Links item={item} canEdit={can.edit} run={run} />

          {!readOnly && <Attachments item={item} canUpload={can.comment} canManage={can.assignOthers} me={me} nameOf={nameOf} now={now} run={run} />}

          <Comments item={item} me={me} now={now} nameOf={nameOf} usernames={usernames} people={users} canComment={can.comment} canReplyToCustomer={!!can.replyToCustomer} onCount={(n) => setItem((i) => (i ? { ...i, commentCount: n } : i))} onPublicReply={load} />

          <Section title="Status history" icon={<Timer size={16} />}>
            <ol className="timeline">
              {[...item.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="avatar">{nameOf(h.by).slice(0, 2).toUpperCase()}</span>
                  <div>
                    <p>
                      {h.from ? (
                        <>
                          {h.fromName ?? h.from} → <b>{h.toName}</b>
                        </>
                      ) : (
                        <>
                          Created in <b>{h.toName}</b>
                        </>
                      )}
                    </p>
                    <small title={new Date(h.at).toLocaleString("en-GB")}>
                      {nameOf(h.by)} · {timeAgo(h.at, now)}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="wi-side" aria-label="Details">
          <Field label="Status">
            <div className="wi-move">
              <ItemStatusPill item={item} />
              {!readOnly && item.moves.length > 0 && (
                <select
                  value=""
                  disabled={busy}
                  aria-label={`Move ${item.key} to another status`}
                  onChange={async (e) => {
                    const mv = item.moves.find((x) => x.transitionId === e.target.value);
                    if (!mv || !mv.allowed) return;
                    if (mv.needs.comment || mv.needs.assignee || mv.needs.fields.length) {
                      setPending({ itemKey: item.key, transitionId: mv.transitionId, name: mv.name, toName: mv.toName, needs: mv.needs, source: item.source });
                      return;
                    }
                    setBusy(true);
                    setError("");
                    try {
                      setItem(await /** @type {Promise<WorkItem>} */ (/** @type {unknown} */ (api(`/items/${item.key}/transitions`, "POST", { transitionId: mv.transitionId }))));
                      await onChanged();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Couldn't make that move");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <option value="">Move to…</option>
                  {item.moves.map((mv) => (
                    <option key={mv.transitionId} value={mv.transitionId} disabled={!mv.allowed} title={mv.reason}>
                      {mv.name} → {mv.toName}
                      {!mv.allowed && mv.reason ? ` (${mv.reason})` : mv.needs.comment ? " (needs a comment)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </Field>
          {done && (
            <Field label="Resolution">
              {can.edit ? (
                <select value={item.resolution ?? "DONE"} disabled={busy} onChange={(e) => save({ resolution: e.target.value })} aria-label="Resolution">
                  {Object.entries(RESOLUTION_META).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : (
                RESOLUTION_META[item.resolution ?? "DONE"]
              )}
            </Field>
          )}
          {!done && (can.edit || item.onHold) && (
            <Field label="On hold">
              {can.edit ? (
                <label className="wi-check">
                  <input type="checkbox" checked={item.onHold} disabled={busy} onChange={(e) => save({ onHold: e.target.checked })} /> Work is paused
                </label>
              ) : (
                "Work is paused"
              )}
            </Field>
          )}
          <Field label="Type">
            {can.edit ? (
              <select value={item.itemType ?? item.type} disabled={busy} onChange={(e) => save({ itemType: e.target.value })} aria-label="Type">
                {/* The workspace's types offered for new items, and this item's own even if it's switched off. */}
                {itemTypes
                  .filter((t) => t.active || t.id === (item.itemType ?? item.type))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            ) : (
              <span className="wi-inline">
                <TypeIcon type={item.type} /> {item.itemTypeName ?? TYPE_META[item.type].label}
              </span>
            )}
          </Field>
          <Field label="Priority">
            {can.edit ? (
              <select value={item.priority} disabled={busy} onChange={(e) => save({ priority: e.target.value })} aria-label="Priority">
                {WORK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {WORK_PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            ) : (
              <ItemPriority priority={item.priority} />
            )}
          </Field>
          <Field label="Assignee">
            {can.edit ? (
              <select value={item.assignee ?? ""} disabled={busy} onChange={(e) => save({ assignee: e.target.value || null })} aria-label="Assignee">
                <option value="">Unassigned</option>
                {item.assignee && !assignable.some((u) => u.id === item.assignee) && <option value={item.assignee}>{nameOf(item.assignee)}</option>}
                {assignable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id === me.id ? `${u.name} (me)` : u.name}
                  </option>
                ))}
              </select>
            ) : (
              nameOf(item.assignee)
            )}
          </Field>
          <Field label="Reporter">{nameOf(item.reporter)}</Field>
          {!readOnly && (
            <Field label="Security level">
              <SecurityLevelField item={item} canEdit={can.edit} busy={busy} onSave={(securityLevel) => save({ securityLevel })} />
            </Field>
          )}
          <ParentField item={item} systemId={system.id} canEdit={can.edit} busy={busy} onSave={(parent) => save({ parent })} />
          <Field label="Labels">
            <Labels item={item} canEdit={can.edit} onSave={(labels) => save({ labels })} />
          </Field>
          <Field label="Component">
            <InlineText value={item.component ?? ""} label="Component" canEdit={can.edit} onSave={(component) => save({ component })} />
          </Field>
          {item.type !== "EPIC" && item.type !== "SUBTASK" && (
            <Field label="Story points">
              <InlineText value={item.storyPoints != null ? String(item.storyPoints) : ""} label="Story points" canEdit={can.edit} inputMode="decimal" onSave={(v) => save({ storyPoints: v === "" ? null : Number(v) })} />
            </Field>
          )}
          <Field label="Start date">{can.edit ? <input type="date" value={item.startDate ?? ""} disabled={busy} onChange={(e) => save({ startDate: e.target.value || null })} aria-label="Start date" /> : item.startDate ? formatDate(item.startDate) : "—"}</Field>
          <Field label="Due date">{can.edit ? <input type="date" value={item.dueDate ?? ""} disabled={busy} onChange={(e) => save({ dueDate: e.target.value || null })} aria-label="Due date" /> : item.dueDate ? formatDate(item.dueDate) : "—"}</Field>

          <TimeTracking item={item} canEdit={can.edit} canLog={can.logTime} me={me} now={now} nameOf={nameOf} save={save} run={run} />

          <dl className="wi-dates">
            <dt>Created</dt>
            <dd title={new Date(item.createdAt).toLocaleString("en-GB")}>{timeAgo(item.createdAt, now)}</dd>
            <dt>Updated</dt>
            <dd title={new Date(item.updatedAt).toLocaleString("en-GB")}>{timeAgo(item.updatedAt, now)}</dd>
            {item.resolvedAt && (
              <>
                <dt>Resolved</dt>
                <dd title={new Date(item.resolvedAt).toLocaleString("en-GB")}>{formatDate(item.resolvedAt)}</dd>
              </>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
}
/**
 * @param {{ title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }} arg3
 */
function Section({ title, icon, action, children }) {
  return (
    <section className="p-card wi-section">
      <header className="p-card-head">
        <h3>
          {icon} {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}
/**
 * @param {{ label: string; children: ReactNode }} props
 */
function Field({ label, children }) {
  return (
    <div className="wi-field">
      <span className="wi-field-label">{label}</span>
      <div className="wi-field-value">{children}</div>
    </div>
  );
}
/**
 * @param {{ item: WorkItem; canEdit: boolean; onSave: (v: string) => Promise<boolean> }} props
 */
function Summary({ item, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(item.summary);
  useEffect(() => setV(item.summary), [item.summary]);
  if (editing)
    return (
      <form
        className="wi-summary-edit"
        onSubmit={async (e) => {
          e.preventDefault();
          if (v.trim() && (await onSave(v.trim()))) setEditing(false);
        }}
      >
        <input value={v} onChange={(e) => setV(e.target.value)} maxLength={255} aria-label="Summary" autoFocus onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
        <button className="btn btn-navy sm" type="submit" disabled={!v.trim()}>
          Save
        </button>
        <button className="btn btn-ghost sm" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  return (
    <h2 className="wi-summary">
      <span className="wi-key-tag mono">{item.key}</span> {item.summary}
      {canEdit && (
        <button className="icon-link" onClick={() => setEditing(true)} aria-label="Edit summary" title="Edit summary">
          <Pencil size={15} />
        </button>
      )}
    </h2>
  );
}
/**
 * @param {{ item: WorkItem; canEdit: boolean; usernames: string[]; people: { username: string; name: string }[]; onSave: (v: string) => Promise<boolean> }} props
 */
function Description({ item, canEdit, usernames, people, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(item.description);
  useEffect(() => setV(item.description), [item.description]);
  return (
    <Section
      title="Description"
      action={
        canEdit &&
        !editing && (
          <button className="btn btn-ghost sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
        )
      }
    >
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave(v)) setEditing(false);
          }}
        >
          <MarkdownField label="Description" value={v} onChange={setV} rows={10} usernames={usernames} people={people} autoFocus />
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-navy">
              Save
            </button>
          </div>
        </form>
      ) : item.description.trim() ? (
        <Markdown text={item.description} usernames={usernames} />
      ) : (
        <p className="lead-none">No description yet.</p>
      )}
    </Section>
  );
}
/**
 * Text shown as it reads, with a pencil to edit it in place.
 * @param {{
 *   value: string;
 *   label: string;
 *   canEdit: boolean;
 *   multiline?: boolean;
 *   inputMode?: "decimal" | "text";
 *   onSave: (v: string) => Promise<boolean>;
 * }} props
 */
function InlineText({ value, label, canEdit, multiline, inputMode, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing)
    return (
      <span className="wi-inline">
        {value ? <span className={multiline ? "pre-wrap" : ""}>{value}</span> : <span className="muted">None</span>}
        {canEdit && (
          <button className="icon-link" onClick={() => setEditing(true)} aria-label={`Edit ${label.toLowerCase()}`} title="Edit">
            <Pencil size={13} />
          </button>
        )}
      </span>
    );
  const submit = /** @param {FormEvent} e */ async (e) => {
    e.preventDefault();
    if (await onSave(v.trim())) setEditing(false);
  };
  return (
    <form className="wi-inline-edit" onSubmit={submit}>
      {multiline ? <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} aria-label={label} autoFocus /> : <input value={v} onChange={(e) => setV(e.target.value)} aria-label={label} inputMode={inputMode} autoFocus onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />}
      <button className="btn btn-navy sm" type="submit">
        Save
      </button>
      <button className="btn btn-ghost sm" type="button" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}
/**
 * @param {{ item: WorkItem; canEdit: boolean; onSave: (labels: string[]) => Promise<boolean> }} arg1
 */
function Labels({ item, canEdit, onSave }) {
  const [adding, setAdding] = useState("");
  return (
    <div className="wi-labels">
      {item.labels.length === 0 && !canEdit && <span className="muted">None</span>}
      {item.labels.map((l) => (
        <span key={l} className="wi-label">
          {l}
          {canEdit && (
            <button onClick={() => onSave(item.labels.filter((x) => x !== l))} aria-label={`Remove label ${l}`}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const l = cleanLabel(adding);
            if (l && !item.labels.includes(l) && (await onSave([...item.labels, l]))) setAdding("");
          }}
        >
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a label" aria-label="Add a label" maxLength={40} />
        </form>
      )}
    </div>
  );
}
/**
 * Epic for a story, task or bug; a story, task or bug for a sub-task; none for an epic.
 * @param {{ item: WorkItem; systemId: string; canEdit: boolean; busy: boolean; onSave: (parent: string | null) => Promise<boolean> }} props
 */
function ParentField({ item, systemId, canEdit, busy, onSave }) {
  const types = allowedParentTypes(item.type);
  const [options, setOptions] = useState(/** @type {WorkItemSummary[] | (() => WorkItemSummary[])} */ ([]));
  useEffect(() => {
    if (!canEdit || !types) return;
    /** @type {Promise<ItemPage>} */ (/** @type {unknown} */ (api(`/items?system=${systemId}&type=${types.join(",")}&sort=key&dir=desc&limit=100`))).then((p) => setOptions(p.items.filter((x) => x.id !== item.id))).catch(() => setOptions([]));
  }, [canEdit, systemId, item.id, item.type]);
  if (!types) return null;
  const label = item.type === "SUBTASK" ? "Parent" : "Epic";
  return (
    <Field label={label}>
      {canEdit ? (
        <select value={item.parentKey ?? ""} disabled={busy} onChange={(e) => onSave(e.target.value || null)} aria-label={label}>
          {item.type !== "SUBTASK" && <option value="">No epic</option>}
          {item.parentKey && !options.some((o) => o.key === item.parentKey) && <option value={item.parentKey}>{item.parentKey}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.key}>
              {o.key} {o.summary.slice(0, 50)}
            </option>
          ))}
        </select>
      ) : item.parent ? (
        <a href={itemHref(systemId, item.parent.key)}>
          {item.parent.key} {item.parent.summary}
        </a>
      ) : (
        "None"
      )}
    </Field>
  );
}
/**
 * The items under this one (an epic's stories, tasks and bugs; anything's sub-tasks), with their progress.
 * @param {{ item: WorkItem; systemId: string; nameOf: (id?: string) => string; canCreate: boolean; onAdded: () => Promise<void> }} props
 */
function Children({ item, systemId, nameOf, canCreate, onAdded }) {
  const types = childTypesOf(item.type);
  const [type, setType] = useState(/** @type {WorkItemType | (() => WorkItemType)} */ (types[0]));
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const done = item.childItems.filter(isDone).length;
  const title = item.type === "EPIC" ? "Work items in this epic" : "Sub-tasks";
  return (
    <Section title={title} action={item.childItems.length > 0 && <Rollup done={item.children?.done ?? done} total={item.children?.total ?? item.childItems.length} />}>
      {item.childItems.length ? (
        <ul className="wi-children">
          {item.childItems.map((c) => (
            <li key={c.id}>
              <a href={itemHref(systemId, c.key)}>
                <TypeIcon type={c.type} />
                <span className="mono">{c.key}</span>
                <span className={`wi-child-summary ${isDone(c) ? "wi-done" : ""}`}>{c.summary}</span>
                <small>{nameOf(c.assignee)}</small>
                <ItemStatusPill item={c} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead-none">{item.type === "EPIC" ? "Nothing in this epic yet." : "No sub-tasks."}</p>
      )}
      {canCreate && (
        <form
          className="wi-quick sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api("/items", "POST", { systemId, type, summary: summary.trim(), parent: item.key });
              setSummary("");
              await onAdded();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't add it");
            }
          }}
        >
          {types.length > 1 && (
            <select value={type} onChange={(e) => setType(/** @type {WorkItemType} */ (e.target.value))} aria-label="Type">
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_META[t].label}
                </option>
              ))}
            </select>
          )}
          <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={item.type === "EPIC" ? "Add a work item to this epic" : "Add a sub-task"} aria-label="Summary" maxLength={255} />
          <button className="btn btn-ghost sm" type="submit" disabled={!summary.trim()}>
            <Plus size={14} strokeWidth={3} /> Add
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </Section>
  );
}
/** @type {LinkChoice[]} */ const LINK_CHOICES = LINK_TYPES.flatMap(
  /** @returns {LinkChoice[]} */ (t) =>
    t === "RELATES"
      ? [{ value: "RELATES:outward", type: t, direction: /** @type {const} */ ("outward"), label: LINK_META[t].outward }]
      : [
          { value: `${t}:outward`, type: t, direction: /** @type {const} */ ("outward"), label: LINK_META[t].outward },
          { value: `${t}:inward`, type: t, direction: /** @type {const} */ ("inward"), label: LINK_META[t].inward },
        ],
);
/**
 * @param {{ item: WorkItem; canEdit: boolean; run: (fn: () => Promise<unknown>) => Promise<boolean> }} props
 */
function Links({ item, canEdit, run }) {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState("BLOCKS:outward");
  const [target, setTarget] = useState("");
  const groups = /** @type {Map<string, Array<WorkItemLink>>} */ (/** @type {unknown} */ (new Map()));
  for (const l of item.links) {
    const phrase = LINK_META[l.type][l.direction];
    groups.set(phrase, [...(groups.get(phrase) ?? []), l]);
  }
  return (
    <Section
      title="Linked work items"
      icon={<Link2 size={16} />}
      action={
        canEdit &&
        !adding && (
          <button className="btn btn-ghost sm" onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={3} /> Link
          </button>
        )
      }
    >
      {adding && (
        <form
          className="wi-quick sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const c = /** @type {LinkChoice} */ (LINK_CHOICES.find((x) => x.value === choice));
            if (await run(() => api(`/items/${item.key}/links`, "POST", { type: c.type, direction: c.direction, target: target.trim().toUpperCase() }))) {
              setTarget("");
              setAdding(false);
            }
          }}
        >
          <span className="mono">{item.key}</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="How they're linked">
            {LINK_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Work item key, such as INFRA-12" aria-label="Linked work item's key" />
          <button className="btn btn-navy sm" type="submit" disabled={!target.trim()}>
            Link
          </button>
          <button className="btn btn-ghost sm" type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}
      {item.links.length
        ? [...groups].map(([phrase, links]) => (
            <div key={phrase} className="wi-link-group">
              <span className="wi-field-label">{phrase}</span>
              <ul className="wi-children">
                {links.map((l) => (
                  <li key={l.id}>
                    <a href={itemHref(l.item.systemId, l.item.key)}>
                      <TypeIcon type={l.item.type} />
                      <span className="mono">{l.item.key}</span>
                      <span className={`wi-child-summary ${isDone(l.item) ? "wi-done" : ""}`}>{l.item.summary}</span>
                      <ItemStatusPill item={l.item} />
                    </a>
                    {canEdit && (
                      <button className="icon-link" onClick={() => run(() => api(`/items/${item.key}/links/${l.id}`, "DELETE"))} aria-label={`Remove the link to ${l.item.key}`} title="Remove link">
                        <X size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        : !adding && <p className="lead-none">Not linked to anything.</p>}
    </Section>
  );
}
/**
 * @param {{
 *   item: WorkItem;
 *   canUpload: boolean;
 *   canManage: boolean;
 *   me: User;
 *   nameOf: (id?: string) => string;
 *   now: number;
 *   run: (fn: () => Promise<unknown>) => Promise<boolean>;
 * }} props
 */
function Attachments({ item, canUpload, canManage, me, nameOf, now, run }) {
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const upload = /** @param {File} file */ async (file) => {
    setError("");
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`Files can be up to ${formatBytes(MAX_DOCUMENT_BYTES)}`);
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    await run(async () => {
      const res = await fetch(`/api/items/${item.key}/attachments`, { method: "POST", credentials: "same-origin", body: form });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, payload.error ?? `Upload failed (${res.status})`);
    });
    setUploading(false);
    if (input.current) input.current.value = "";
  };
  return (
    <Section
      title="Attachments"
      icon={<Paperclip size={16} />}
      action={
        canUpload && (
          <>
            <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Choose a file to attach" />
            <button className="btn btn-ghost sm" onClick={() => input.current?.click()} disabled={uploading}>
              <Upload size={14} /> {uploading ? "Uploading…" : "Attach a file"}
            </button>
          </>
        )
      }
    >
      {error && <p className="form-error">{error}</p>}
      {item.attachments.length ? (
        <ul className="doc-list">
          {item.attachments.map((a) => (
            <li key={a.id}>
              <a href={`/api/documents/${a.id}`} target="_blank" rel="noreferrer">
                {a.name}
              </a>
              <small>
                {formatBytes(a.size)} · {nameOf(a.uploadedBy)} · {timeAgo(a.uploadedAt, now)}
              </small>
              <a className="icon-link" href={`/api/documents/${a.id}?download`} aria-label={`Download ${a.name}`} title="Download">
                <Download size={14} />
              </a>
              {(a.uploadedBy === me.id || canManage) && (
                <button className="icon-link" onClick={() => run(() => api(`/items/${item.key}/attachments/${a.id}`, "DELETE"))} aria-label={`Remove ${a.name}`} title="Remove">
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead-none">No attachments. Files can be up to {formatBytes(MAX_DOCUMENT_BYTES)}.</p>
      )}
    </Section>
  );
}
/**
 * @param {{
 *   item: WorkItem;
 *   me: User;
 *   now: number;
 *   nameOf: (id?: string) => string;
 *   usernames: string[];
 *   people: { username: string; name: string }[];
 *   canComment: boolean;
 *   canReplyToCustomer: boolean;
 *   onCount: (n: number) => void;
 *   onPublicReply: () => Promise<void>;
 * }} arg1
 */
function Comments({ item, me, now, nameOf, usernames, people, canComment, canReplyToCustomer, onCount, onPublicReply }) {
  const [toCustomer, setToCustomer] = useState(false);
  const [comments, setComments] = useState(/** @type {WorkComment[] | null | (() => WorkComment[] | null)} */ (null));
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(/** @type {{ id: string; body: string } | null | (() => { id: string; body: string } | null)} */ (null));
  const [error, setError] = useState("");
  const load = useCallback(
    async (offset = 0) => {
      const res = await /** @type {Promise<{ comments: WorkComment[]; total: number; }>} */ (/** @type {unknown} */ (api(`/items/${item.key}/comments?offset=${offset}&limit=50`)));
      setComments((c) => (offset && c ? [...c, ...res.comments] : res.comments));
      setTotal(res.total);
    },
    [item.key],
  );
  useEffect(() => {
    load().catch(() => setComments([]));
  }, [load]);
  const act = /** @param {() => Promise<unknown>} fn */ async (fn) => {
    setError("");
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  };
  useEffect(() => onCount(total), [total]);
  return (
    <Section title={`Comments${total ? ` · ${total}` : ""}`} icon={<MessageSquare size={16} />}>
      {comments === null ? (
        <p className="lead-none">Loading…</p>
      ) : comments.length ? (
        <ol className="wi-comments">
          {comments.map((c) => (
            <li key={c.id}>
              <span className="avatar">{(c.customerName ?? nameOf(c.authorId)).slice(0, 2).toUpperCase()}</span>
              <div className={`wi-comment ${c.public ? "public" : ""}`}>
                <p className="wi-comment-head">
                  <b>{c.customerName ? `${c.customerName} (customer)` : nameOf(c.authorId)}</b> {c.public && !c.customerName && <span className="cf-chip">To the customer</span>}{" "}
                  <small title={new Date(c.createdAt).toLocaleString("en-GB")}>
                    {timeAgo(c.createdAt, now)}
                    {c.updatedAt ? " · edited" : ""}
                  </small>
                </p>
                {editing?.id === c.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await act(() => api(`/items/${item.key}/comments/${c.id}`, "PATCH", { body: editing.body }))) setEditing(null);
                    }}
                  >
                    <MarkdownField label="Edit comment" value={editing.body} onChange={(body) => setEditing({ id: c.id, body })} rows={4} usernames={usernames} people={people} autoFocus />
                    <div className="confirm-actions">
                      <button type="button" className="btn btn-ghost sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-navy sm" disabled={!editing.body.trim()}>
                        Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <Markdown text={c.body} usernames={usernames} />
                )}
                {c.authorId === me.id && !c.customerName && canComment && editing?.id !== c.id && (
                  <p className="wi-comment-actions">
                    <button className="link-btn" onClick={() => setEditing({ id: c.id, body: c.body })}>
                      Edit
                    </button>
                    <button className="link-btn danger-text" onClick={() => act(() => api(`/items/${item.key}/comments/${c.id}`, "DELETE"))}>
                      Delete
                    </button>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lead-none">No comments yet.</p>
      )}
      {comments && comments.length < total && (
        <button className="link-btn" onClick={() => load(comments.length)}>
          Show older comments
        </button>
      )}
      {error && <p className="form-error">{error}</p>}
      {canComment && (
        <form
          className="wi-comment-new"
          onSubmit={async (e) => {
            e.preventDefault();
            const pub = canReplyToCustomer && toCustomer;
            if (await act(() => api(`/items/${item.key}/comments`, "POST", { body: draft, ...(pub ? { public: true } : {}) }))) {
              setDraft("");
              if (pub) await onPublicReply();
            }
          }}
        >
          <MarkdownField
            label={canReplyToCustomer && toCustomer ? "Reply to the customer" : "Add a comment"}
            value={draft}
            onChange={setDraft}
            rows={3}
            usernames={usernames}
            people={people}
            placeholder={canReplyToCustomer && toCustomer ? "The customer sees this on the portal and by email." : "Type @ and a username to mention someone; they'll be told if they can see this item."}
          />
          {canReplyToCustomer && (
            <label className="wi-check">
              <input type="checkbox" checked={toCustomer} onChange={(e) => setToCustomer(e.target.checked)} /> Reply to the customer (otherwise an internal note)
            </label>
          )}
          <button type="submit" className="btn btn-navy sm" disabled={!draft.trim()}>
            {canReplyToCustomer && toCustomer ? "Send to customer" : "Comment"}
          </button>
        </form>
      )}
    </Section>
  );
}
/**
 * @param {{
 *   item: WorkItem;
 *   canEdit: boolean;
 *   canLog: boolean;
 *   me: User;
 *   now: number;
 *   nameOf: (id?: string) => string;
 *   save: (patch: Record<string, unknown>) => Promise<boolean>;
 *   run: (fn: () => Promise<unknown>) => Promise<boolean>;
 * }} arg1
 */
function TimeTracking({ item, canEdit, canLog, me, now, nameOf, save, run }) {
  const [logging, setLogging] = useState(false);
  const [spent, setSpent] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(new Date(now).toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const logged = item.loggedMinutes;
  const remaining = item.remainingEstimate ?? 0;
  const scale = Math.max(item.originalEstimate ?? 0, logged + remaining, 1);
  const duration = /** @param {string} label @param {number | undefined} value @param {string} field */ (label, value, field) => (
    <InlineText
      value={value != null ? formatMinutes(value) : ""}
      label={label}
      canEdit={canEdit}
      onSave={async (v) => {
        const m = v === "" ? null : parseDuration(v);
        if (v !== "" && m == null) {
          setError(`${label}: use a length such as 2h 30m, 1d or 45m`);
          return false;
        }
        setError("");
        return save({ [field]: m });
      }}
    />
  );
  return (
    <div className="wi-time" aria-label="Time tracking">
      <span className="wi-field-label">Time tracking</span>
      <div className="wi-time-bar" role="img" aria-label={`${formatMinutes(logged)} logged, ${formatMinutes(remaining)} remaining`}>
        <i className="logged" style={{ width: `${(logged / scale) * 100}%` }} />
        <i className="remaining" style={{ width: `${(remaining / scale) * 100}%` }} />
      </div>
      <dl className="wi-dates">
        <dt>Logged</dt>
        <dd>{formatMinutes(logged)}</dd>
        <dt>Remaining</dt>
        <dd>{duration("Remaining estimate", item.remainingEstimate, "remainingEstimate")}</dd>
        <dt>Original estimate</dt>
        <dd>{duration("Original estimate", item.originalEstimate, "originalEstimate")}</dd>
      </dl>
      {error && <p className="form-error">{error}</p>}
      {canLog &&
        (logging ? (
          <form
            className="wi-log-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const minutes = parseDuration(spent);
              if (!minutes) {
                setError("Time spent: use a length such as 2h 30m or 45m");
                return;
              }
              if (await run(() => api(`/items/${item.key}/worklogs`, "POST", { minutes, note, date: day }))) {
                setSpent("");
                setNote("");
                setLogging(false);
                setError("");
              }
            }}
          >
            <label>
              Time spent
              <input value={spent} onChange={(e) => setSpent(e.target.value)} placeholder="1h 30m" autoFocus />
            </label>
            <label>
              Date
              <input type="date" value={day} max={new Date(now).toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you worked on" maxLength={1000} />
            </label>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost sm" onClick={() => setLogging(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-navy sm" disabled={!spent.trim()}>
                Log time
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-ghost sm block-sm" onClick={() => setLogging(true)}>
            <Timer size={14} /> Log time
          </button>
        ))}
      {item.workLogs.length > 0 && (
        <ul className="wi-worklogs">
          {item.workLogs.map((l) => (
            <li key={l.id}>
              <b>{formatMinutes(l.minutes)}</b> · {nameOf(l.userId)} · {formatDate(l.workDate)}
              {l.note && <span className="muted"> · {l.note}</span>}
              {(l.userId === me.id || canEdit) && canLog && (
                <button className="icon-link" onClick={() => run(() => api(`/items/${item.key}/worklogs/${l.id}`, "DELETE"))} aria-label={`Remove ${formatMinutes(l.minutes)} logged on ${l.workDate}`} title="Remove">
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
/**
 * @param {{ item: WorkItem; systemId: string; onDeleted: () => Promise<void>; onError: (m: string) => void }} arg3
 */
function DeleteButton({ item, systemId, onDeleted, onError }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button className="btn btn-ghost sm danger-text" onClick={() => setConfirming(true)}>
        <Trash2 size={15} /> Delete
      </button>
    );
  const subtasks = item.childItems.filter((c) => c.type === "SUBTASK").length;
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm delete">
      <p>
        Delete <b>{item.key}</b>
        {subtasks ? ` and its ${subtasks} sub-task${subtasks === 1 ? "" : "s"}` : ""}? Its comments, attachments, links and time logs go too. This can't be undone.
      </p>
      <div className="confirm-actions">
        <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            try {
              await api(`/items/${item.key}`, "DELETE");
              window.location.hash = `/projects/${systemId}/items`;
              await onDeleted();
            } catch (e) {
              onError(e instanceof Error ? e.message : "Couldn't delete it");
              setConfirming(false);
            }
          }}
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>
    </div>
  );
}
/**
 * blocks / is blocked by, relates to, duplicates / is duplicated by, clones / is cloned by.
 * @typedef {Object} LinkChoice
 * @property {string} value
 * @property {LinkType} type
 * @property {"outward" | "inward"} direction
 * @property {string} label
 */
/**
 * @typedef {Object} Props
 * @property {System} system
 * @property {string} itemKey
 * @property {User[]} users
 * @property {User} me
 * @property {number} now
 * @property {boolean} readOnly
 * @property {boolean} canCreate
 * @property {() => Promise<void>} onChanged
 */
