import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bell, Bookmark, Download, Play, Search, Sparkles, Star, Trash2, X } from "lucide-react";
import { api, ApiError } from "../data/api";
import { ROLES, ROLE_LABEL, type User } from "../data/roles";
import { formatDate, timeAgo } from "../time";
import { TYPE_META, WORK_PRIORITY_META, type WorkItemPage, type WorkItemSummary } from "../data/workitems";
import { basicToPql, suggestAt, type FieldDef, type Suggestion } from "../data/pql";
import { WEEKDAYS, shareLabel, type SavedFilter, type ShareScope } from "../data/search";
import { ItemPriority, ItemStatusPill, TypeIcon, itemHref } from "./WorkItemBits";

interface Props {
  users: User[];
  workspaces: string[];
  now: number;
  canShare: boolean;
  initialPql?: string;
}

type Values = Partial<Record<string, string[]>>;
const COLUMNS: { key: string; label: string; sort?: string }[] = [
  { key: "key", label: "Key", sort: "key" },
  { key: "summary", label: "Summary" },
  { key: "status", label: "Status", sort: "status" },
  { key: "priority", label: "Priority", sort: "priority" },
  { key: "assignee", label: "Assignee", sort: "assignee" },
  { key: "due", label: "Due", sort: "due" },
  { key: "updated", label: "Updated", sort: "updated" },
];

/** Replaces (or adds) the query's ORDER BY. */
function withOrder(pql: string, field: string, dir: "ASC" | "DESC") {
  const base = pql.replace(/\s+ORDER\s+BY[\s\S]*$/i, "").trim();
  return `${base}${base ? " " : ""}ORDER BY ${field} ${dir}`;
}
function currentOrder(pql: string): { field: string; dir: "ASC" | "DESC" } | null {
  const m = /ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i.exec(pql);
  return m ? { field: m[1], dir: (m[2]?.toUpperCase() as "ASC" | "DESC") ?? "ASC" } : null;
}

/** Search: basic mode (dropdowns) or PQL with suggestions; results to sort and export; saved filters. */
export default function SearchPage({ users, workspaces, now, canShare, initialPql }: Props) {
  const [mode, setMode] = useState<"basic" | "advanced">(initialPql ? "advanced" : "basic");
  const [pql, setPql] = useState(initialPql ?? "statusCategory != Done ORDER BY updated DESC");
  const [ran, setRan] = useState<string | null>(null);
  const [page, setPage] = useState<WorkItemPage | null>(null);
  const [error, setError] = useState<{ message: string; start?: number; end?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [openFilter, setOpenFilter] = useState<SavedFilter | null>(null);
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState<SavedFilter | null>(null);
  const [notice, setNotice] = useState("");
  const name = (id?: string) => users.find((u) => u.id === id)?.name;

  const loadFilters = useCallback(async () => {
    try {
      setFilters(await api<SavedFilter[]>("/filters"));
    } catch {
      setFilters([]);
    }
  }, []);
  useEffect(() => {
    api<{ fields: FieldDef[]; values: Values }>("/search/fields")
      .then((r) => setValues(r.values))
      .catch(() => setValues({}));
    loadFilters();
  }, [loadFilters]);

  const run = useCallback(async (text: string, offset = 0) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<WorkItemPage>("/search", "POST", { pql: text, offset, limit: 50 });
      setPage((p) => (offset && p ? { ...r, items: [...p.items, ...r.items] } : r));
      setRan(text);
    } catch (e) {
      if (e instanceof ApiError && e.code === "pql") setError({ message: e.message, start: e.payload.start as number, end: e.payload.end as number });
      else setError({ message: e instanceof Error ? e.message : "The search failed" });
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    run(pql);
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new initialPql remounts this page (App gives it a new key), so the first run covers it.

  const sortBy = (field: string) => {
    const cur = currentOrder(pql);
    const next = withOrder(pql, field, cur?.field === field && cur.dir === "ASC" ? "DESC" : "ASC");
    setPql(next);
    run(next);
  };

  const exportCsv = async () => {
    if (ran === null) return;
    setBusy(true);
    try {
      const all: WorkItemSummary[] = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const r = await api<WorkItemPage>("/search", "POST", { pql: ran, offset, limit: 100 });
        all.push(...r.items);
        if (all.length >= r.total) break;
      }
      const cell = (v: unknown) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = [
        ["Key", "Type", "Summary", "Status", "Priority", "Assignee", "Reporter", "Labels", "Story points", "Due", "Created", "Updated", "Resolved"],
        ...all.map((i) => [i.key, TYPE_META[i.type].label, i.summary, i.statusName, WORK_PRIORITY_META[i.priority].label, name(i.assignee) ?? "", name(i.reporter) ?? "", i.labels.join(" "), i.storyPoints ?? "", i.dueDate ?? "", i.createdAt.slice(0, 10), i.updatedAt.slice(0, 10), i.resolvedAt?.slice(0, 10) ?? ""]),
      ];
      const blob = new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pulse-search-${new Date(now).toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Couldn't export" });
    } finally {
      setBusy(false);
    }
  };

  const order = currentOrder(ran ?? "");
  const favourites = filters.filter((f) => f.favourite);
  const others = filters.filter((f) => !f.favourite);

  return (
    <div className="page search-page">
      <header className="page-head">
        <div>
          <h2>Search</h2>
          <p>Find work items across every project you can see. Choose from the lists, or write a query in PQL (like Jira's JQL).</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Search mode">
          {(["basic", "advanced"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "basic" ? "Basic" : "PQL"}
            </button>
          ))}
        </div>
      </header>

      <div className="search-grid">
        <aside className="search-filters" aria-label="Saved filters">
          <h3>Saved filters</h3>
          {!filters.length && <p className="lead-none">None yet. Run a search, then save it.</p>}
          {[
            ["Favourites", favourites],
            ["All filters", others],
          ].map(([title, list]) =>
            (list as SavedFilter[]).length ? (
              <div key={title as string}>
                <h4>{title as string}</h4>
                <ul>
                  {(list as SavedFilter[]).map((f) => (
                    <li key={f.id} className={openFilter?.id === f.id ? "on" : ""}>
                      <button
                        className="icon-link"
                        onClick={async () => {
                          await api(`/filters/${f.id}/favourite`, f.favourite ? "DELETE" : "POST");
                          await loadFilters();
                        }}
                        aria-pressed={f.favourite}
                        aria-label={f.favourite ? `Remove ${f.name} from favourites` : `Add ${f.name} to favourites`}
                      >
                        <Star size={14} className={f.favourite ? "star-on" : ""} />
                      </button>
                      <button
                        className="search-filter-name"
                        onClick={() => {
                          setOpenFilter(f);
                          setPql(f.pql);
                          setMode("advanced");
                          run(f.pql);
                        }}
                        title={f.pql || "Everything"}
                      >
                        {f.name}
                        <small>
                          {f.mine ? shareLabel(f.shareScope, f.shareValue) : `by ${f.ownerName}`}
                          {f.subscriptions.length ? " · subscribed" : ""}
                        </small>
                      </button>
                      <button className="icon-link" onClick={() => setSubscribing(f)} aria-label={`Email subscriptions for ${f.name}`} title="Email me this filter">
                        <Bell size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </aside>

        <section className="search-main">
          {mode === "basic" ? (
            <BasicMode
              values={values}
              onRun={(q) => {
                setPql(q);
                run(q);
              }}
            />
          ) : (
            <PqlEditor value={pql} onChange={setPql} onRun={() => run(pql)} values={values} error={error} />
          )}
          {mode === "advanced" && <AskBox onPql={(q) => setPql(q)} />}
          {error && mode === "basic" && <p className="form-error banner">{error.message}</p>}
          {notice && (
            <p className="form-ok banner" role="status">
              {notice}
            </p>
          )}

          <div className="search-bar">
            <span aria-live="polite">{page ? `${page.total} work item${page.total === 1 ? "" : "s"}` : busy ? "Searching…" : ""}</span>
            {ran !== null && <code className="search-ran">{ran || "everything"}</code>}
            <span className="page-actions">
              <button className="btn btn-ghost sm" onClick={exportCsv} disabled={!page?.total || busy}>
                <Download size={14} /> CSV
              </button>
              <button className="btn btn-navy sm" onClick={() => setSaving(true)} disabled={ran === null}>
                <Bookmark size={14} /> {openFilter?.mine ? "Save filter" : "Save as filter"}
              </button>
            </span>
          </div>

          {page && page.items.length > 0 ? (
            <div className="table-wrap">
              <table className="table feature-table wi-table">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th key={col.key} scope="col" aria-sort={order && order.field === col.sort ? (order.dir === "ASC" ? "ascending" : "descending") : undefined}>
                        {col.sort ? (
                          <button className="th-sort" onClick={() => sortBy(col.sort!)}>
                            {col.label} {order && order.field === col.sort ? (order.dir === "ASC" ? "▲" : "▼") : ""}
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((i) => (
                    <tr key={i.id}>
                      <td className="wi-key-cell">
                        <TypeIcon type={i.type} />
                        <a href={itemHref(i.systemId, i.key)}>{i.key}</a>
                      </td>
                      <td>{i.summary}</td>
                      <td>
                        <ItemStatusPill item={i} />
                      </td>
                      <td>
                        <ItemPriority priority={i.priority} />
                      </td>
                      <td>{name(i.assignee) ?? <i className="muted">Unassigned</i>}</td>
                      <td>{i.dueDate ? formatDate(i.dueDate) : <span className="muted">—</span>}</td>
                      <td title={new Date(i.updatedAt).toLocaleString("en-GB")}>{timeAgo(i.updatedAt, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : page ? (
            <div className="empty">No work items match this search.</div>
          ) : null}
          {page && page.items.length < page.total && (
            <button className="btn btn-ghost block-sm wi-more" onClick={() => run(ran ?? pql, page.items.length)} disabled={busy}>
              Show more
            </button>
          )}
        </section>
      </div>

      {saving && ran !== null && (
        <SaveFilter
          pql={ran}
          existing={openFilter?.mine ? openFilter : null}
          workspaces={workspaces}
          canShare={canShare}
          onClose={() => setSaving(false)}
          onSaved={async (msg) => {
            setSaving(false);
            setNotice(msg);
            await loadFilters();
          }}
        />
      )}
      {subscribing && (
        <Subscriptions
          filter={subscribing}
          onClose={() => setSubscribing(null)}
          onChanged={async () => {
            await loadFilters();
            const fresh = (await api<SavedFilter[]>("/filters")).find((f) => f.id === subscribing.id);
            setSubscribing(fresh ?? null);
          }}
        />
      )}
    </div>
  );
}

function BasicMode({ values, onRun }: { values: Values; onRun: (pql: string) => void }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [assignee, setAssignee] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const q = basicToPql({ projects, types, statuses, priorities, assignee, text, open });
  const multi = (label: string, list: string[] | undefined, value: string[], set: (v: string[]) => void) => (
    <label className="field">
      <span>{label}</span>
      <select multiple size={4} value={value} onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))}>
        {(list ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      className="search-basic set-card"
      onSubmit={(e) => {
        e.preventDefault();
        onRun(q);
      }}
    >
      <div className="search-basic-grid">
        {multi("Project", values.project, projects, setProjects)}
        {multi("Type", values.type, types, setTypes)}
        {multi("Status", values.status, statuses, setStatuses)}
        {multi("Priority", values.priority, priorities, setPriorities)}
        <label className="field">
          <span>Assignee</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {(values.assignee ?? []).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Words</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="In the summary, description or comments" />
        </label>
      </div>
      <label className="wi-check">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Open items only
      </label>
      <p className="field-hint">
        As PQL: <code>{q || "(everything)"}</code>. Hold Ctrl (or Cmd) to choose several in a list.
      </p>
      <button className="btn btn-amber" type="submit">
        <Search size={15} /> Search
      </button>
    </form>
  );
}

/** A PQL text box: suggestions as you type (arrow keys and Enter or Tab), errors pointed at where they are. */
function PqlEditor({ value, onChange, onRun, values, error }: { value: string; onChange: (v: string) => void; onRun: () => void; values: Values; error: { message: string; start?: number; end?: number } | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const sugg = useMemo(() => suggestAt(value, cursor, values), [value, cursor, values]);
  const items: Suggestion[] = open ? sugg.items.slice(0, 8) : [];
  const pick = (s: Suggestion) => {
    const next = value.slice(0, sugg.from) + s.insert + value.slice(sugg.to);
    onChange(next);
    const at = sugg.from + s.insert.length;
    setCursor(at);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
    setActive(0);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setOpen(false);
      onRun();
      return;
    }
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div className="pql-editor">
      <label htmlFor="pql-input" className="pql-label">
        PQL query <small className="muted">Ctrl+Enter runs it</small>
      </label>
      <div className="pql-box">
        <textarea
          id="pql-input"
          ref={ref}
          rows={3}
          value={value}
          spellCheck={false}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="pql-suggestions"
          aria-activedescendant={items.length ? `pql-s-${active}` : undefined}
          aria-invalid={!!error?.start || undefined}
          aria-describedby={error ? "pql-error" : "pql-help"}
          onChange={(e) => {
            onChange(e.target.value);
            setCursor(e.target.selectionStart);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKey}
          onKeyUp={(e) => !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) && setCursor((e.target as HTMLTextAreaElement).selectionStart)}
          onClick={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="project = INFRA AND status != Done AND assignee = currentUser()"
        />
        {items.length > 0 && (
          <ul id="pql-suggestions" className="pql-suggestions" role="listbox" aria-label="Suggestions">
            {items.map((s, i) => (
              <li key={s.label} id={`pql-s-${i}`} role="option" aria-selected={i === active} className={i === active ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), pick(s))}>
                <b>{s.label}</b>
                {s.detail && <small>{s.detail}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <div id="pql-error" className="pql-error" role="alert">
          <p>{error.message}</p>
          {error.start !== undefined && error.end !== undefined && (
            <code>
              {value.slice(0, error.start)}
              <mark>{value.slice(error.start, Math.max(error.end, error.start + 1)) || " "}</mark>
              {value.slice(Math.max(error.end, error.start + 1))}
            </code>
          )}
        </div>
      ) : (
        <p id="pql-help" className="field-hint">
          Fields such as project, status, assignee, priority, due, sprint and text; = != &gt; &lt; IN ~ IS EMPTY; AND OR NOT; functions currentUser(), openSprints(), now(); dates like -7d.
        </p>
      )}
      <button className="btn btn-amber" onClick={onRun}>
        <Play size={14} /> Search
      </button>
    </div>
  );
}

function AskBox({ onPql }: { onPql: (pql: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <form
      className="ask-box"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!q.trim()) return;
        setBusy(true);
        setMsg("");
        try {
          const r = await api<{ pql: string; error?: string }>("/ask/pql", "POST", { question: q });
          onPql(r.pql);
          setMsg(r.error ? `Written, but check it: ${r.error}` : "Written: check it, then search.");
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "Couldn't write a query for that");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Sparkles size={15} aria-hidden="true" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or ask in plain English: my open bugs due this week" aria-label="Describe the search in plain English" maxLength={400} />
      <button className="btn btn-ghost sm" type="submit" disabled={busy || !q.trim()}>
        {busy ? "Writing…" : "Write the query"}
      </button>
      {msg && <small className="muted ask-box-msg">{msg}</small>}
    </form>
  );
}

function SaveFilter({ pql, existing, workspaces, canShare, onClose, onSaved }: { pql: string; existing: SavedFilter | null; workspaces: string[]; canShare: boolean; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [scope, setScope] = useState<ShareScope>(existing?.shareScope ?? "private");
  const [value, setValue] = useState(existing?.shareValue ?? "");
  const [asNew, setAsNew] = useState(!existing);
  const [error, setError] = useState("");
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Save filter"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const b = { name, description, pql, shareScope: scope, shareValue: scope === "role" || scope === "workspace" ? value : null };
            if (existing && !asNew) await api(`/filters/${existing.id}`, "PUT", b);
            else await api("/filters", "POST", b);
            await onSaved(`Saved "${name}".`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save it");
          }
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{existing && !asNew ? `Save "${existing.name}"` : "Save as a filter"}</h2>
        <p className="modal-note">
          <code>{pql || "(everything)"}</code>
        </p>
        {existing && (
          <label className="wi-check">
            <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} /> Save as a new filter instead
          </label>
        )}
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Shared with</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as ShareScope)} disabled={!canShare}>
              <option value="private">Only me</option>
              <option value="role">A role</option>
              <option value="workspace">A workspace</option>
              <option value="everyone">Everyone</option>
            </select>
          </label>
          {scope === "role" && (
            <label className="field">
              <span>Role</span>
              <select value={value} onChange={(e) => setValue(e.target.value)} required>
                <option value="">Choose…</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scope === "workspace" && (
            <label className="field">
              <span>Workspace</span>
              <select value={value} onChange={(e) => setValue(e.target.value)} required>
                <option value="">Choose…</option>
                {workspaces.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!canShare && <p className="field-hint">Sharing filters needs the "Share filters and dashboards" permission.</p>}
        <p className="field-hint">Whoever opens a shared filter sees only the work items they're allowed to see.</p>
        {error && <p className="form-error">{error}</p>}
        {existing && !asNew && (
          <button
            type="button"
            className="delete-link inline"
            onClick={async () => {
              if (!window.confirm(`Delete the filter "${existing.name}"?`)) return;
              try {
                await api(`/filters/${existing.id}`, "DELETE");
                await onSaved(`Deleted "${existing.name}".`);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't delete it");
              }
            }}
          >
            <Trash2 size={14} /> Delete filter
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function Subscriptions({ filter, onClose, onChanged }: { filter: SavedFilter; onClose: () => void; onChanged: () => Promise<void> }) {
  const [frequency, setFrequency] = useState<"daily" | "weekly">("weekly");
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(8);
  const [error, setError] = useState("");
  const when = (s: { frequency: string; weekday?: number; hour: number }) => `${s.frequency === "daily" ? "Every day" : `Every ${WEEKDAYS[(s.weekday ?? 1) - 1]}`} at ${String(s.hour).padStart(2, "0")}:00`;
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Email subscriptions for ${filter.name}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await api(`/filters/${filter.id}/subscriptions`, "POST", { frequency, weekday, hour });
            await onChanged();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't subscribe");
          }
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Email me "{filter.name}"</h2>
        <p className="modal-note">Pulse sends the results under your bell, and by email once email is connected, at the time you choose (Harare time). You get only the items you can see.</p>
        {filter.subscriptions.length > 0 && (
          <ul className="sub-list">
            {filter.subscriptions.map((s) => (
              <li key={s.id}>
                {when(s)}
                {s.lastSentAt ? <small className="muted"> · last sent {formatDate(s.lastSentAt)}</small> : null}
                <button
                  type="button"
                  className="icon-link"
                  onClick={async () => {
                    await api(`/filters/${filter.id}/subscriptions/${s.id}`, "DELETE");
                    await onChanged();
                  }}
                  aria-label={`Stop: ${when(s)}`}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="field-row">
          <label className="field">
            <span>How often</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </label>
          {frequency === "weekly" && (
            <label className="field">
              <span>Day</span>
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Time</span>
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-amber">
            <Bell size={14} /> Subscribe
          </button>
        </div>
      </form>
    </div>
  );
}
