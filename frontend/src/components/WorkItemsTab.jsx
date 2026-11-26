/** @import { FormEvent } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { WorkItem, WorkItemPage, WorkItemSummary, WorkItemType } from '../data/workitems' */
/** @import { CustomField, CustomValue, SecurityLevel } from '../data/admin' */
/** @import { StatusDef } from '../data/workflows' */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, KeyRound, Plus, Search, X } from "lucide-react";
import { api } from "../data/api";
import { formatDate, timeAgo } from "../time";
import { KEY_PATTERN, PAGE_SIZE, TYPE_META, WORK_PRIORITIES, WORK_PRIORITY_META, WORK_TYPES, isDone } from "../data/workitems";
import { ItemPriority, ItemStatusPill, Rollup, TypeIcon, itemHref } from "./WorkItemBits";
import { CustomFieldInput } from "./WorkItemExtras";
import { assignable } from "../data/roles";
/** @type {{ key: string; label: string }[]} */ const SORTS = [
  { key: "key", label: "Key" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "due", label: "Due date" },
  { key: "updated", label: "Last updated" },
  { key: "created", label: "Created" },
  { key: "type", label: "Type" },
  { key: "summary", label: "Summary" },
];
/**
 * A project's work items: a list with filters and sorting, one page at a time, and quick create.
 * @param {Props} props
 */
export default function WorkItemsTab({ system, users, now, canCreate, canManage, readOnly, onChanged }) {
  const [state, setState] = useState(/** @type {State | (() => State)} */ ("open"));
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("key");
  const [dir, setDir] = useState(/** @type {"asc" | "desc" | (() => "asc" | "desc")} */ ("desc"));
  const [page, setPage] = useState(/** @type {WorkItemPage | null | (() => WorkItemPage | null)} */ (null));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(/** @type {WorkItem | null | (() => WorkItem | null)} */ (null));
  const [statuses, setStatuses] = useState(/** @type {StatusDef[] | (() => StatusDef[])} */ ([]));
  useEffect(() => {
    /** @type {Promise<Array<StatusDef>>} */ (/** @type {unknown} */ (api("/statuses"))).then(setStatuses).catch(() => setStatuses([]));
  }, []);
  const userName = /** @param {string} [id] */ (id) => users.find((u) => u.id === id)?.name;
  // The search box waits for a pause in typing.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const params = useMemo(() => {
    const p = new URLSearchParams({ system: system.id, sort, dir, limit: String(PAGE_SIZE) });
    if (state !== "all") p.set("state", state);
    if (type) p.set("type", type);
    if (status) p.set("status", status);
    if (priority) p.set("priority", priority);
    if (assignee) p.set("assignee", assignee);
    if (label.trim()) p.set("label", label.trim());
    if (debounced) p.set("q", debounced);
    return p;
  }, [system.id, state, type, status, priority, assignee, label, debounced, sort, dir]);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setError("");
    try {
      const res = await /** @type {Promise<WorkItemPage>} */ (/** @type {unknown} */ (api(`/items?${params}`)));
      if (ticket === latest.current) setPage(res);
    } catch (e) {
      if (ticket === latest.current) setError(e instanceof Error ? e.message : "Couldn't load work items");
    }
  }, [params]);
  useEffect(() => {
    load();
  }, [load]);
  const more = async () => {
    if (!page) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams(params);
      p.set("offset", String(page.items.length));
      const res = await /** @type {Promise<WorkItemPage>} */ (/** @type {unknown} */ (api(`/items?${p}`)));
      setPage({ ...res, items: [...page.items, ...res.items], offset: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  };
  const filtered = !!(type || status || priority || assignee || label || query || state !== "open");
  const clear = () => {
    setType("");
    setStatus("");
    setPriority("");
    setAssignee("");
    setLabel("");
    setQuery("");
    setState("open");
  };
  const people = users.filter((u) => assignable(u.role)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="wi-tab">
      <ProjectWorkSettings system={system} canManage={canManage && !readOnly} hasItems={!!system.hasWorkItems} onChanged={onChanged} />

      {canCreate && !readOnly && (
        <QuickCreate
          system={system}
          users={people}
          onCreated={(item) => {
            setCreated(item);
            load();
            onChanged();
          }}
        />
      )}
      {created && (
        <p className="form-ok banner" role="status">
          Created{" "}
          <a href={itemHref(system.id, created.key)}>
            {created.key} {created.summary}
          </a>
          <button className="link-btn" onClick={() => setCreated(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </p>
      )}

      <div className="feature-search" role="search">
        <Search size={17} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${system.key ?? ""} work items by key, summary or description…`} aria-label="Search work items" />
        {query && (
          <button className="feature-search-clear" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="viz-filters" role="group" aria-label="Filter work items">
        <div className="seg" role="radiogroup" aria-label="Open or done">
          {/** @type {const} */ ([
            ["open", "Open"],
            ["done", "Done"],
            ["all", "All"],
          ]).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={state === k} className={state === k ? "on" : ""} onClick={() => setState(k)}>
              {l}
            </button>
          ))}
        </div>
        <button className={`toggle-chip ${assignee === "me" ? "on" : ""}`} aria-pressed={assignee === "me"} onClick={() => setAssignee(assignee === "me" ? "" : "me")}>
          My work
        </button>
        <select className={type ? "set" : ""} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Any type</option>
          {WORK_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t].label}
            </option>
          ))}
        </select>
        <select className={status ? "set" : ""} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className={priority ? "set" : ""} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {WORK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {WORK_PRIORITY_META[p].label}
            </option>
          ))}
        </select>
        <select className={assignee ? "set" : ""} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input className={`wi-label-filter ${label ? "set" : ""}`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Label" />
        <span className="wi-sort">
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <button className="icon-link" onClick={() => setDir(dir === "asc" ? "desc" : "asc")} aria-label={dir === "asc" ? "Sorted ascending; sort descending" : "Sorted descending; sort ascending"} title={dir === "asc" ? "Ascending" : "Descending"}>
            {dir === "asc" ? <ArrowUpNarrowWide size={16} /> : <ArrowDownWideNarrow size={16} />}
          </button>
        </span>
      </div>

      <p className="feature-results" aria-live="polite">
        <span>
          {page ? (
            <>
              Showing <b>{page.items.length}</b> of {page.total} work item{page.total === 1 ? "" : "s"}
            </>
          ) : (
            "Loading…"
          )}
        </span>
        {filtered && (
          <button className="link-btn" onClick={clear}>
            Clear all filters
          </button>
        )}
      </p>
      {error && <p className="form-error banner">{error}</p>}

      {page && page.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table feature-table wi-table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Summary</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">Assignee</th>
                <th scope="col">Due</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((i) => (
                <Row key={i.id} item={i} assignee={userName(i.assignee)} now={now} systemId={system.id} />
              ))}
            </tbody>
          </table>
        </div>
      ) : page ? (
        <div className="empty">{filtered ? "No work items match these filters." : canCreate && !readOnly ? "No work items yet. Add the first one above: an epic for a big piece of work, or a story, task or bug." : "No work items yet."}</div>
      ) : null}
      {page && page.items.length < page.total && (
        <button className="btn btn-ghost block-sm wi-more" onClick={more} disabled={loadingMore}>
          {loadingMore ? "Loading…" : `Show ${Math.min(PAGE_SIZE, page.total - page.items.length)} more`}
        </button>
      )}
    </div>
  );
}
/**
 * @param {{ item: WorkItemSummary; assignee?: string; now: number; systemId: string }} arg1
 */
function Row({ item: i, assignee, now, systemId }) {
  const late = !!i.dueDate && !isDone(i) && new Date(i.dueDate).setHours(23, 59, 59, 999) < now;
  const open = () => {
    window.location.hash = itemHref(systemId, i.key).slice(1);
  };
  return (
    <tr className="clickable" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} aria-label={`${i.key} ${i.summary}`}>
      <td className="wi-key-cell">
        <TypeIcon type={i.type} />
        <a href={itemHref(systemId, i.key)} onClick={(e) => e.stopPropagation()} tabIndex={-1}>
          {i.key}
        </a>
      </td>
      <td>
        <span className="feature-cell">
          <b className={isDone(i) ? "wi-done" : ""}>{i.summary}</b>
          <small>
            {TYPE_META[i.type].label}
            {i.parentKey ? ` · in ${i.parentKey}` : ""}
            {i.source === "client_request" ? " · client request" : ""}
            {i.labels.map((l) => (
              <span key={l} className="wi-label">
                {l}
              </span>
            ))}
          </small>
          {i.children && <Rollup {...i.children} />}
        </span>
      </td>
      <td>
        <ItemStatusPill item={i} />
      </td>
      <td>
        <ItemPriority priority={i.priority} />
      </td>
      <td>{assignee ?? <i className="muted">Unassigned</i>}</td>
      <td className={late ? "text-red strong" : ""}>{i.dueDate ? formatDate(i.dueDate) : <span className="muted">—</span>}</td>
      <td title={new Date(i.updatedAt).toLocaleString("en-GB")}>{timeAgo(i.updatedAt, now)}</td>
    </tr>
  );
}
/**
 * Type and summary, then Enter: the quickest way to add a work item. Sub-tasks also need a parent.
 * @param {{ system: System; users: User[]; onCreated: (item: WorkItem) => void }} props
 */
function QuickCreate({ system, users, onCreated }) {
  const [type, setType] = useState(/** @type {WorkItemType | (() => WorkItemType)} */ ("TASK"));
  // The workspace's custom fields shown on the create form, and the security levels you may give.
  const [fields, setFields] = useState(/** @type {CustomField[] | (() => CustomField[])} */ ([]));
  const [levels, setLevels] = useState(/** @type {SecurityLevel[] | (() => SecurityLevel[])} */ ([]));
  const [values, setValues] = useState(/** @type {Record<string, CustomValue> | (() => Record<string, CustomValue>)} */ ({}));
  const [level, setLevel] = useState("");
  const [more, setMore] = useState(false);
  useEffect(() => {
    /** @type {Promise<Array<CustomField>>} */ (/** @type {unknown} */ (api(`/custom-fields?workspace=${encodeURIComponent(system.workspace ?? "Projects")}`))).then((f) => setFields(f.filter((x) => x.onCreate))).catch(() => setFields([]));
    /** @type {Promise<Array<SecurityLevel>>} */ (/** @type {unknown} */ (api("/security-levels"))).then(setLevels).catch(() => setLevels([]));
  }, [system.workspace]);
  const required = fields.filter((f) => f.required);
  const missing = required.some((f) => values[f.id] == null || values[f.id] === "" || (Array.isArray(values[f.id]) && !/** @type {string[]} */ (values[f.id]).length));
  const [summary, setSummary] = useState("");
  const [parent, setParent] = useState("");
  const [parents, setParents] = useState(/** @type {WorkItemSummary[] | (() => WorkItemSummary[])} */ ([]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Parents a new item may sit under: epics for stories, tasks and bugs; those for sub-tasks.
  useEffect(() => {
    if (type === "EPIC") {
      setParents([]);
      return;
    }
    const types = type === "SUBTASK" ? "STORY,TASK,BUG" : "EPIC";
    /** @type {Promise<WorkItemPage>} */ (/** @type {unknown} */ (api(`/items?system=${system.id}&type=${types}&state=open&sort=key&dir=desc&limit=100`))).then((p) => setParents(p.items)).catch(() => setParents([]));
    setParent("");
  }, [type, system.id]);
  const submit = /** @param {FormEvent} e */ async (e) => {
    e.preventDefault();
    if (!summary.trim()) return;
    setBusy(true);
    setError("");
    try {
      const item = await /** @type {Promise<WorkItem>} */ (
        /** @type {unknown} */ (
          api("/items", "POST", {
            systemId: system.id,
            type,
            summary: summary.trim(),
            ...(parent ? { parent } : {}),
            customFields: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))),
            ...(level ? { securityLevel: level } : {}),
          })
        )
      );
      setSummary("");
      setValues({});
      setLevel("");
      onCreated(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create it");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="wi-quick" onSubmit={submit} aria-label="Create a work item">
      <select value={type} onChange={(e) => setType(/** @type {WorkItemType} */ (e.target.value))} aria-label="Type of work item">
        {WORK_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_META[t].label}
          </option>
        ))}
      </select>
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What needs doing? Press Enter to add it" aria-label="Summary" maxLength={255} />
      {type !== "EPIC" && (
        <select value={parent} onChange={(e) => setParent(e.target.value)} aria-label={type === "SUBTASK" ? "Parent (required)" : "Epic (optional)"} required={type === "SUBTASK"}>
          <option value="">{type === "SUBTASK" ? "Choose its parent…" : "No epic"}</option>
          {parents.map((p) => (
            <option key={p.id} value={p.key}>
              {p.key} {p.summary.slice(0, 60)}
            </option>
          ))}
        </select>
      )}
      <button className="btn btn-amber" type="submit" disabled={busy || !summary.trim() || (type === "SUBTASK" && !parent) || missing}>
        <Plus size={16} strokeWidth={3} /> Create
      </button>
      {(fields.length > 0 || levels.length > 0) && (
        <button type="button" className="btn btn-ghost sm" aria-expanded={more || required.length > 0} onClick={() => setMore(!more)}>
          {more || required.length ? "Fewer fields" : "More fields"}
          {required.length ? ` (${required.length} required)` : ""}
        </button>
      )}
      {(more || required.length > 0) && (
        <div className="wi-quick-more">
          {fields.map((f) => (
            <label key={f.id} className="field">
              <span>
                {f.name}
                {f.required ? " (required)" : ""}
              </span>
              <CustomFieldInput field={f} users={users} value={values[f.id] ?? null} onChange={(v) => setValues({ ...values, [f.id]: v })} />
            </label>
          ))}
          {levels.length > 0 && (
            <label className="field">
              <span>Security level</span>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Anyone who can see the project</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
/**
 * The project's key (editable until the first work item exists) and where its progress comes from.
 * @param {{ system: System; canManage: boolean; hasItems?: boolean; onChanged: () => Promise<void> }} arg1
 */
function ProjectWorkSettings({ system, canManage, hasItems, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState(system.key ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setKey(system.key ?? ""), [system.key]);
  const save = /** @param {Record<string, unknown>} patch */ async (patch) => {
    setBusy(true);
    setError("");
    try {
      await api(`/systems/${system.id}`, "PATCH", patch);
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wi-settings" aria-label="Project key and progress">
      <div className="wi-key">
        <KeyRound size={16} aria-hidden="true" />
        <span>Key</span>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save({ key });
            }}
          >
            <input
              value={key}
              onChange={(e) =>
                setKey(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z]/g, "")
                    .slice(0, 10),
                )
              }
              aria-label="Project key"
              autoFocus
              aria-describedby="wi-key-hint"
            />
            <button className="btn btn-navy sm" type="submit" disabled={busy || !KEY_PATTERN.test(key)}>
              Save
            </button>
            <button className="btn btn-ghost sm" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <small id="wi-key-hint">
              2 to 10 capital letters. Work items will be {key || "KEY"}-1, {key || "KEY"}-2…
            </small>
          </form>
        ) : (
          <>
            <b className="mono">{system.key}</b>
            {canManage && !hasItems && (
              <button className="link-btn" onClick={() => setEditing(true)}>
                Change
              </button>
            )}
            {hasItems && <small className="muted">Fixed now that work items exist</small>}
          </>
        )}
      </div>
      {canManage ? (
        <label className="wi-progress-toggle">
          <input type="checkbox" checked={system.agileMode === "scrum"} disabled={busy} onChange={(e) => save({ agileMode: e.target.checked ? "scrum" : "kanban" })} />
          <span>Plan in sprints (Scrum), with a backlog</span>
        </label>
      ) : (
        system.agileMode === "scrum" && <small className="muted">Planned in sprints.</small>
      )}
      {canManage ? (
        <label className="wi-progress-toggle">
          <input type="checkbox" checked={!!system.progressFromItems} disabled={busy} onChange={(e) => save({ progressFromItems: e.target.checked })} />
          <span>Take the project's progress from its work items ({system.progress}% now)</span>
        </label>
      ) : (
        system.progressFromItems && <small className="muted">Progress comes from the work items that are done.</small>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
/** @typedef {"open" | "done" | "all"} State */
/**
 * @typedef {Object} Props
 * @property {System} system
 * @property {User[]} users
 * @property {number} now
 * @property {boolean} canCreate
 * @property {boolean} canManage
 * @property {boolean} readOnly
 * @property {() => Promise<void>} onChanged
 */
