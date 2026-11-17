import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { ROLES, ROLE_LABEL, type ActivityEntry, type User } from "../data/roles";
import type { System } from "../data/systems";
import type { WorkItemSummary } from "../data/workitems";
import { GADGETS, GADGET_KINDS, GROUP_FIELDS, shareLabel, type Dashboard, type Gadget, type GadgetKind, type SavedFilter, type ShareScope } from "../data/search";
import { formatDate, timeAgo } from "../time";
import { ItemPriority, ItemStatusPill, TypeIcon, itemHref } from "./WorkItemBits";
import { Donut } from "./reports/DashCharts";
import { LineChart } from "./reports/AgileCharts";
import { TooltipLayer } from "./reports/chartKit";
import { describe } from "./ActivityPage";

const OVERVIEW = "overview";
const PICK_KEY = "pulse:dashboard";
const SLICE_COLORS = ["var(--st-wip)", "var(--st-live)", "var(--st-deploy)", "var(--st-testing)", "var(--st-overdue)", "var(--st-done)", "var(--st-not)", "var(--navy)"];

interface Props {
  overview: ReactNode; // the built-in "Pulse overview"
  users: User[];
  systems: System[];
  workspaces: string[];
  now: number;
  canShare: boolean;
  enabled: boolean; // false on view-only links: only the overview
}

function remembered(): string {
  try {
    return localStorage.getItem(PICK_KEY) ?? OVERVIEW;
  } catch {
    return OVERVIEW;
  }
}

/** The Dashboard view: "Pulse overview" (the built-in one) or a configurable dashboard of gadgets. */
export default function CustomDashboards({ overview, users, systems, workspaces, now, canShare, enabled }: Props) {
  const [list, setList] = useState<Dashboard[]>([]);
  const [pick, setPick] = useState(remembered);
  const [editing, setEditing] = useState<Dashboard | "new" | null>(null);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setList(await api<Dashboard[]>("/dashboards"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load dashboards");
    }
  }, [enabled]);
  useEffect(() => {
    load();
  }, [load]);
  const choose = (id: string) => {
    setPick(id);
    try {
      localStorage.setItem(PICK_KEY, id);
    } catch {
      /* this browser keeps no choice */
    }
  };
  const startEdit = async (d: Dashboard | "new") => {
    try {
      setFilters(await api<SavedFilter[]>("/filters"));
    } catch {
      setFilters([]);
    }
    setEditing(d);
  };

  if (!enabled) return <>{overview}</>;
  const current = list.find((d) => d.id === pick);
  const showing = current ?? null;

  return (
    <>
      <div className="dash-picker no-print">
        <label>
          <span className="sr-only">Dashboard</span>
          <select value={showing ? showing.id : OVERVIEW} onChange={(e) => choose(e.target.value)} aria-label="Choose a dashboard">
            <option value={OVERVIEW}>Pulse overview</option>
            {list.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.mine ? "" : ` (${d.ownerName})`}
              </option>
            ))}
          </select>
        </label>
        {showing?.mine && (
          <button className="btn btn-ghost sm" onClick={() => startEdit(showing)}>
            <Pencil size={14} /> Edit
          </button>
        )}
        <button className="btn btn-ghost sm" onClick={() => startEdit("new")}>
          <Plus size={14} /> New dashboard
        </button>
        {error && <span className="form-error">{error}</span>}
      </div>
      {editing ? (
        <DashboardEditor
          dashboard={editing === "new" ? null : editing}
          filters={filters}
          workspaces={workspaces}
          canShare={canShare}
          onCancel={() => setEditing(null)}
          onSaved={async (d) => {
            setEditing(null);
            await load();
            choose(d ? d.id : OVERVIEW);
          }}
        />
      ) : showing ? (
        <DashboardBoard dashboard={showing} users={users} systems={systems} now={now} />
      ) : (
        overview
      )}
    </>
  );
}

function DashboardBoard({ dashboard, users, systems, now }: { dashboard: Dashboard; users: User[]; systems: System[]; now: number }) {
  const cols = dashboard.layout === "one" ? 1 : dashboard.layout === "two" ? 2 : 3;
  const columns = Array.from({ length: cols }, (_, i) => dashboard.gadgets.filter((g) => Math.min(g.column, cols - 1) === i));
  return (
    <TooltipLayer>
      <div className="page custom-dash">
        <header className="page-head">
          <div>
            <h2>{dashboard.name}</h2>
            <p>
              {dashboard.mine ? shareLabel(dashboard.shareScope, dashboard.shareValue) : `Shared by ${dashboard.ownerName}`} · each gadget shows only the work items you can see.
            </p>
          </div>
        </header>
        {!dashboard.gadgets.length ? (
          <div className="empty">This dashboard has no gadgets yet.</div>
        ) : (
          <div className={`gadget-grid cols-${cols}`}>
            {columns.map((list, i) => (
              <div key={i} className="gadget-col">
                {list.map((g) => (
                  <GadgetCard key={g.id} dashboardId={dashboard.id} gadget={g} users={users} systems={systems} now={now} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipLayer>
  );
}

type GadgetResult = {
  empty?: string;
  items?: WorkItemSummary[];
  total?: number;
  slices?: { label: string; count: number }[];
  cells?: { row: string; col: string; count: number }[];
  days?: string[];
  created?: number[];
  resolved?: number[];
  sprints?: { name: string; project: string; endDate: string; daysLeft: number; scope: number; done: number; items: number; doneItems: number }[];
  people?: { name: string; open: number; points: number; late: number }[];
  entries?: ActivityEntry[];
};

function GadgetCard({ dashboardId, gadget, users, systems, now }: { dashboardId: string; gadget: Gadget; users: User[]; systems: System[]; now: number }) {
  const [data, setData] = useState<GadgetResult | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<GadgetResult>(`/dashboards/${dashboardId}/gadgets/${gadget.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this gadget");
    }
  }, [dashboardId, gadget.id]);
  useEffect(() => {
    load();
  }, [load]);
  const title = gadget.title || GADGETS[gadget.kind].label;
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  return (
    <section className="gadget" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <button className="icon-link" onClick={load} aria-label={`Refresh ${title}`}>
          <RefreshCw size={13} />
        </button>
      </header>
      {gadget.filterName && <p className="gadget-sub">Filter: {gadget.filterName}</p>}
      {error ? (
        <p className="form-error">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : data.empty ? (
        <p className="muted">{data.empty}</p>
      ) : (
        <GadgetBody kind={gadget.kind} data={data} name={name} users={users} systems={systems} now={now} field={gadget.field} field2={gadget.field2} />
      )}
    </section>
  );
}

function ItemList({ items, name }: { items: WorkItemSummary[]; name: (id?: string) => string | undefined }) {
  if (!items.length) return <p className="muted">Nothing here.</p>;
  return (
    <ul className="gadget-items">
      {items.map((i) => (
        <li key={i.id}>
          <TypeIcon type={i.type} />
          <a href={itemHref(i.systemId, i.key)}>{i.key}</a>
          <span className="gadget-item-sum">{i.summary}</span>
          <ItemPriority priority={i.priority} />
          <ItemStatusPill item={i} />
          <small className="muted">{name(i.assignee) ?? "Unassigned"}</small>
          {i.dueDate && <small className="muted">due {formatDate(i.dueDate)}</small>}
        </li>
      ))}
    </ul>
  );
}

function GadgetBody({ kind, data, name, users, systems, now, field, field2 }: { kind: GadgetKind; data: GadgetResult; name: (id?: string) => string | undefined; users: User[]; systems: System[]; now: number; field?: string; field2?: string }) {
  switch (kind) {
    case "filter_results":
      return (
        <>
          <ItemList items={data.items ?? []} name={name} />
          {(data.total ?? 0) > (data.items?.length ?? 0) && <p className="gadget-foot muted">Showing {data.items?.length} of {data.total}</p>}
        </>
      );
    case "overdue":
      return <ItemList items={data.items ?? []} name={name} />;
    case "pie": {
      const slices = data.slices ?? [];
      if (!slices.length) return <p className="muted">No work items match.</p>;
      const total = slices.reduce((n, s) => n + s.count, 0);
      return (
        <div className="gadget-pie">
          <Donut slices={slices.map((s, i) => ({ key: s.label, label: s.label, color: SLICE_COLORS[i % SLICE_COLORS.length], value: s.count }))} centre="items" />
          <table className="gadget-table">
            <caption className="sr-only">Work items by {GROUP_FIELDS[field ?? "status"]?.toLowerCase()}</caption>
            <tbody>
              {slices.map((s, i) => (
                <tr key={s.label}>
                  <th scope="row">
                    <i className="dot" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} /> {s.label}
                  </th>
                  <td>{s.count}</td>
                  <td className="muted">{Math.round((s.count / total) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "two_d": {
      const cells = data.cells ?? [];
      if (!cells.length) return <p className="muted">No work items match.</p>;
      const rows = [...new Set(cells.map((c) => c.row))].sort();
      const cols = [...new Set(cells.map((c) => c.col))].sort();
      const at = (r: string, c: string) => cells.find((x) => x.row === r && x.col === c)?.count ?? 0;
      return (
        <div className="table-wrap">
          <table className="gadget-table two-d">
            <caption className="sr-only">
              {GROUP_FIELDS[field ?? "status"]} by {GROUP_FIELDS[field2 ?? "assignee"]}
            </caption>
            <thead>
              <tr>
                <th scope="col">{GROUP_FIELDS[field ?? "status"]}</th>
                {cols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  <th scope="row">{r}</th>
                  {cols.map((c) => (
                    <td key={c}>{at(r, c) || <span className="muted">·</span>}</td>
                  ))}
                  <td>
                    <b>{cols.reduce((n, c) => n + at(r, c), 0)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "created_resolved": {
      const days = data.days ?? [];
      const created = data.created ?? [];
      const resolved = data.resolved ?? [];
      return (
        <>
          <LineChart
            labels={days.map((d) => formatDate(d).replace(/ \d{4}$/, ""))}
            series={[
              { key: "c", label: "Created", color: "var(--st-overdue)", values: created },
              { key: "r", label: "Resolved", color: "var(--st-live)", values: resolved },
            ]}
            unit=" items"
          />
          <p className="gadget-foot muted">
            Last 30 days: {created.reduce((a, b) => a + b, 0)} created, {resolved.reduce((a, b) => a + b, 0)} resolved.
          </p>
        </>
      );
    }
    case "sprint_health": {
      const sprints = data.sprints ?? [];
      if (!sprints.length) return <p className="muted">No running sprint has this filter's items.</p>;
      return (
        <ul className="gadget-sprints">
          {sprints.map((s) => {
            const pct = s.scope ? Math.round((s.done / s.scope) * 100) : s.items ? Math.round((s.doneItems / s.items) * 100) : 0;
            return (
              <li key={s.project + s.name}>
                <div>
                  <b>{s.name}</b> <small className="muted">{s.project}</small>
                </div>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${s.name}: ${pct}% done`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <small>
                  {s.done} of {s.scope} points · {s.doneItems} of {s.items} items done ·{" "}
                  <span className={s.daysLeft < 0 ? "late" : ""}>{s.daysLeft < 0 ? `${-s.daysLeft} days over` : `${s.daysLeft} days left`}</span>
                </small>
              </li>
            );
          })}
        </ul>
      );
    }
    case "workload": {
      const people = data.people ?? [];
      if (!people.length) return <p className="muted">No open work items match.</p>;
      const max = Math.max(...people.map((p) => p.open));
      return (
        <table className="gadget-table">
          <caption className="sr-only">Open work items per person</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Open</th>
              <th scope="col">Points</th>
              <th scope="col">Late</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td>
                  <span className="bar-cell">
                    <i style={{ width: `${(p.open / max) * 100}%` }} />
                    {p.open}
                  </span>
                </td>
                <td>{p.points}</td>
                <td className={p.late ? "late" : "muted"}>{p.late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "activity": {
      const entries = data.entries ?? [];
      if (!entries.length) return <p className="muted">No recent changes.</p>;
      return (
        <ul className="gadget-activity">
          {entries.map((e) => (
            <li key={e.id}>
              <b>{e.actor}</b> {describe(e, users, systems)} <small className="muted">{timeAgo(e.at, now)}</small>
            </li>
          ))}
        </ul>
      );
    }
  }
}

type Draft = Omit<Gadget, "id" | "position"> & { id?: string; key: string };

function DashboardEditor({ dashboard, filters, workspaces, canShare, onCancel, onSaved }: { dashboard: Dashboard | null; filters: SavedFilter[]; workspaces: string[]; canShare: boolean; onCancel: () => void; onSaved: (d: Dashboard | null) => Promise<void> }) {
  const [name, setName] = useState(dashboard?.name ?? "");
  const [layout, setLayout] = useState<Dashboard["layout"]>(dashboard?.layout ?? "two");
  const [scope, setScope] = useState<ShareScope>(dashboard?.shareScope ?? "private");
  const [value, setValue] = useState(dashboard?.shareValue ?? "");
  const [gadgets, setGadgets] = useState<Draft[]>(() => (dashboard?.gadgets ?? []).map((g) => ({ ...g, key: g.id })));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cols = layout === "one" ? 1 : layout === "two" ? 2 : 3;
  const set = (i: number, patch: Partial<Draft>) => setGadgets((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const move = (i: number, by: number) =>
    setGadgets((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => setGadgets((list) => [...list, { key: `n${Date.now()}`, kind: "filter_results", title: "", column: list.length % cols, maxRows: 10, filterId: filters[0]?.id }]);

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const body = {
        name,
        layout,
        shareScope: scope,
        shareValue: scope === "role" || scope === "workspace" ? value : null,
        gadgets: gadgets.map((g) => ({ id: g.id, kind: g.kind, filterId: g.filterId ?? null, title: g.title, column: Math.min(g.column, cols - 1), field: g.field ?? null, field2: g.field2 ?? null, maxRows: g.maxRows })),
      };
      const d = dashboard ? await api<Dashboard>(`/dashboards/${dashboard.id}`, "PUT", body) : await api<Dashboard>("/dashboards", "POST", body);
      await onSaved(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the dashboard");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page dash-editor">
      <header className="page-head">
        <div>
          <h2>{dashboard ? `Edit "${dashboard.name}"` : "New dashboard"}</h2>
          <p>Each gadget reads a saved filter. Whoever opens the dashboard sees only the items they're allowed to see.</p>
        </div>
      </header>
      <div className="set-card">
        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <label className="field">
            <span>Layout</span>
            <select value={layout} onChange={(e) => setLayout(e.target.value as Dashboard["layout"])}>
              <option value="one">One column</option>
              <option value="two">Two columns</option>
              <option value="three">Three columns</option>
            </select>
          </label>
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
              <select value={value} onChange={(e) => setValue(e.target.value)}>
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
              <select value={value} onChange={(e) => setValue(e.target.value)}>
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
        {!filters.length && <p className="field-hint">You have no saved filters yet. Save a search first (Search in the menu), then add gadgets that read it.</p>}
      </div>

      <ol className="gadget-edit-list">
        {gadgets.map((g, i) => {
          const meta = GADGETS[g.kind];
          return (
            <li key={g.key} className="set-card">
              <div className="gadget-edit-head">
                <b>
                  {i + 1}. {g.title || meta.label}
                </b>
                <span>
                  <button className="icon-link" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move gadget ${i + 1} up`}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-link" onClick={() => move(i, 1)} disabled={i === gadgets.length - 1} aria-label={`Move gadget ${i + 1} down`}>
                    <ArrowDown size={14} />
                  </button>
                  {cols > 1 && (
                    <>
                      <button className="icon-link" onClick={() => set(i, { column: Math.max(0, g.column - 1) })} disabled={g.column <= 0} aria-label={`Move gadget ${i + 1} to the column on the left`}>
                        <ArrowLeft size={14} />
                      </button>
                      <button className="icon-link" onClick={() => set(i, { column: Math.min(cols - 1, g.column + 1) })} disabled={g.column >= cols - 1} aria-label={`Move gadget ${i + 1} to the column on the right`}>
                        <ArrowRight size={14} />
                      </button>
                    </>
                  )}
                  <button className="icon-link danger" onClick={() => setGadgets((list) => list.filter((_, j) => j !== i))} aria-label={`Remove gadget ${i + 1}`}>
                    <X size={14} />
                  </button>
                </span>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Gadget</span>
                  <select value={g.kind} onChange={(e) => set(i, { kind: e.target.value as GadgetKind })}>
                    {GADGET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {GADGETS[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Saved filter</span>
                  <select value={g.filterId ?? ""} onChange={(e) => set(i, { filterId: e.target.value || undefined })}>
                    <option value="">Choose…</option>
                    {filters.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Title</span>
                  <input value={g.title} onChange={(e) => set(i, { title: e.target.value })} placeholder={meta.label} maxLength={80} />
                </label>
                {meta.field && (
                  <label className="field">
                    <span>{meta.field2 ? "Rows" : "Group by"}</span>
                    <select value={g.field ?? "status"} onChange={(e) => set(i, { field: e.target.value })}>
                      {Object.entries(GROUP_FIELDS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {meta.field2 && (
                  <label className="field">
                    <span>Columns</span>
                    <select value={g.field2 ?? "assignee"} onChange={(e) => set(i, { field2: e.target.value })}>
                      {Object.entries(GROUP_FIELDS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(g.kind === "filter_results" || g.kind === "overdue" || g.kind === "workload" || g.kind === "activity") && (
                  <label className="field narrow">
                    <span>Rows</span>
                    <input type="number" min={1} max={50} value={g.maxRows} onChange={(e) => set(i, { maxRows: Number(e.target.value) || 10 })} />
                  </label>
                )}
              </div>
              <p className="field-hint">
                {meta.description}
                {cols > 1 ? ` · column ${Math.min(g.column, cols - 1) + 1}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
      <button className="btn btn-ghost" onClick={add} disabled={gadgets.length >= 20}>
        <Plus size={14} /> Add a gadget
      </button>

      {error && <p className="form-error banner">{error}</p>}
      <div className="modal-actions dash-editor-actions">
        {dashboard && (
          <button
            className="delete-link inline"
            onClick={async () => {
              if (!window.confirm(`Delete the dashboard "${dashboard.name}"?`)) return;
              try {
                await api(`/dashboards/${dashboard.id}`, "DELETE");
                await onSaved(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't delete it");
              }
            }}
          >
            <Trash2 size={14} /> Delete dashboard
          </button>
        )}
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-amber" onClick={save} disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Save dashboard"}
        </button>
      </div>
    </div>
  );
}
