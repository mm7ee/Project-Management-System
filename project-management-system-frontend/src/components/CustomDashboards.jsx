/** @import { ReactNode } from 'react' */
/** @import { LucideIcon } from 'lucide-react' */
/** @import { ActivityEntry, User } from '../data/roles' */
/** @import { System } from '../data/systems' */
/** @import { WorkItemSummary } from '../data/workitems' */
/** @import { Dashboard, Gadget, GadgetKind, SavedFilter, ShareScope } from '../data/search' */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BarChart3, CalendarX2, Grid3x3, History, Inbox, LineChart as LineIcon, ListFilter, Pencil, PieChart, Plus, RefreshCw, Timer, Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { ROLES, ROLE_LABEL } from "../data/roles";
import { GADGETS, GADGET_KINDS, GROUP_FIELDS, shareLabel } from "../data/search";
import { formatDate, timeAgo } from "../time";
import { ItemPriority, ItemStatusPill, TypeIcon, itemHref } from "./WorkItemBits";
import { Donut } from "./reports/DashCharts";
import { LineChart } from "./reports/AgileCharts";
import { TooltipLayer } from "./reports/chartKit";
import { describe } from "./ActivityPage";
import { workspaceKey } from "../data/tenant";
const OVERVIEW = "overview";
const PICK_KEY = "pms:dashboard";
const OVERVIEW_DESC = "Projects, delivery and team workload across this workspace, as of now.";
// The categorical chart palette (styles.css --cat-*), in its fixed order. Status colours are kept for meaning.
const CAT = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];
const OTHER = "var(--cat-other)";
/** @type {Record<GadgetKind, LucideIcon>} */ const GADGET_ICON = {
  filter_results: ListFilter,
  pie: PieChart,
  created_resolved: LineIcon,
  sprint_health: Timer,
  workload: BarChart3,
  overdue: CalendarX2,
  two_d: Grid3x3,
  activity: History,
};
/**
 * More slices than palette slots fold into "Other", so no colour is ever generated or reused.
 * @param {{ label: string; count: number }[]} slices
 * @returns {{ color: string; label: string; count: number; }[]}
 */
function foldSlices(slices) {
  // The smallest slices fold; the rest keep the server's order, so a colour follows its value, not its rank.
  const big = new Set(
    slices.length > CAT.length
      ? [...slices]
          .sort((a, b) => b.count - a.count)
          .slice(0, CAT.length - 1)
          .map((s) => s.label)
      : slices.map((s) => s.label),
  );
  const keep = slices.filter((s) => big.has(s.label));
  const rest = slices.filter((s) => !big.has(s.label));
  const rows = keep.map((s, i) => ({ ...s, color: CAT[i] }));
  if (rest.length)
    rows.push({
      label: `Other (${rest.length})`,
      count: rest.reduce((n, s) => n + s.count, 0),
      color: OTHER,
    });
  return rows;
}
/**
 * @returns {string}
 */
function remembered() {
  try {
    return localStorage.getItem(workspaceKey(PICK_KEY)) ?? OVERVIEW;
  } catch {
    return OVERVIEW;
  }
}
/**
 * The Dashboard view: "Workspace overview" (the built-in one) or a configurable dashboard of gadgets.
 * @param {Props} arg1
 */
export default function CustomDashboards({ overview, users, systems, workspaces, now, canShare, enabled }) {
  const [list, setList] = useState(/** @type {Dashboard[] | (() => Dashboard[])} */ ([]));
  const [pick, setPick] = useState(remembered);
  const [editing, setEditing] = useState(/** @type {Dashboard | "new" | null | (() => Dashboard | "new" | null)} */ (null));
  const [filters, setFilters] = useState(/** @type {SavedFilter[] | (() => SavedFilter[])} */ ([]));
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setList(await /** @type {Promise<Array<Dashboard>>} */ (/** @type {unknown} */ (api("/dashboards"))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load dashboards");
    }
  }, [enabled]);
  useEffect(() => {
    load();
  }, [load]);
  const choose = /** @param {string} id */ (id) => {
    setPick(id);
    try {
      localStorage.setItem(workspaceKey(PICK_KEY), id);
    } catch {
      /* this browser keeps no choice */
    }
  };
  const startEdit = /** @param {Dashboard | "new"} d */ async (d) => {
    try {
      setFilters(await /** @type {Promise<Array<SavedFilter>>} */ (/** @type {unknown} */ (api("/filters"))));
    } catch {
      setFilters([]);
    }
    setEditing(d);
  };
  const overviewHead = <DashHead title="Workspace overview" description={OVERVIEW_DESC} />;
  if (!enabled)
    return (
      <>
        {overviewHead}
        {overview}
      </>
    );
  const current = list.find((d) => d.id === pick);
  const showing = current ?? null;
  const actions = (
    <div className="dash-actions no-print">
      <label>
        <span className="sr-only">Dashboard</span>
        <select value={showing ? showing.id : OVERVIEW} onChange={(e) => choose(e.target.value)} aria-label="Choose a dashboard">
          <option value={OVERVIEW}>Workspace overview</option>
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
          <Pencil size={14} aria-hidden="true" /> Edit
        </button>
      )}
      <button className="btn btn-ghost sm" onClick={() => startEdit("new")}>
        <Plus size={14} aria-hidden="true" /> New dashboard
      </button>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
  return (
    <>
      {!editing &&
        (showing ? (
          <DashHead title={showing.name} description={`${showing.mine ? shareLabel(showing.shareScope, showing.shareValue) : `Shared by ${showing.ownerName}`} · each gadget shows only the work items you can see.`} actions={actions} />
        ) : (
          <DashHead title="Workspace overview" description={OVERVIEW_DESC} actions={actions} />
        ))}
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
        <DashboardBoard dashboard={showing} users={users} systems={systems} now={now} onEdit={showing.mine ? () => startEdit(showing) : undefined} />
      ) : (
        overview
      )}
    </>
  );
}
/**
 * The page header: the dashboard's name and a line about it, with its actions grouped on the right.
 * @param {{ title: string; description: string; actions?: ReactNode }} arg2
 */
function DashHead({ title, description, actions }) {
  return (
    <header className="dash-head">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions}
    </header>
  );
}
/**
 * @param {{ dashboard: Dashboard; users: User[]; systems: System[]; now: number; onEdit?: () => void }} props
 */
function DashboardBoard({ dashboard, users, systems, now, onEdit }) {
  const cols = dashboard.layout === "one" ? 1 : dashboard.layout === "two" ? 2 : 3;
  const columns = Array.from({ length: cols }, (_, i) => dashboard.gadgets.filter((g) => Math.min(g.column, cols - 1) === i));
  return (
    <TooltipLayer>
      <div className="page custom-dash">
        {!dashboard.gadgets.length ? (
          <div className="gadget gadget-state">
            <span className="gadget-state-icon" aria-hidden="true">
              <Inbox size={18} />
            </span>
            <p>This dashboard has no gadgets yet.</p>
            {onEdit && (
              <button className="btn btn-ghost sm" onClick={onEdit}>
                <Plus size={14} aria-hidden="true" /> Add a gadget
              </button>
            )}
          </div>
        ) : (
          <div className={`gadget-grid cols-${cols}`}>
            {columns.map((list, i) => (
              <div key={i} className="gadget-col">
                {list.map((g) => (
                  <GadgetCard key={g.id} dashboardId={dashboard.id} gadget={g} users={users} systems={systems} now={now} onEdit={onEdit} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipLayer>
  );
}
/**
 * @param {{ dashboardId: string; gadget: Gadget; users: User[]; systems: System[]; now: number; onEdit?: () => void }} props
 */
function GadgetCard({ dashboardId, gadget, users, systems, now, onEdit }) {
  const [data, setData] = useState(/** @type {GadgetResult | null | (() => GadgetResult | null)} */ (null));
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      setData(await /** @type {Promise<GadgetResult>} */ (/** @type {unknown} */ (api(`/dashboards/${dashboardId}/gadgets/${gadget.id}`))));
      setLoadedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this gadget");
    } finally {
      setBusy(false);
    }
  }, [dashboardId, gadget.id]);
  useEffect(() => {
    load();
  }, [load]);
  const title = gadget.title || GADGETS[gadget.kind].label;
  const Icon = GADGET_ICON[gadget.kind];
  const name = /** @param {string} [id] */ (id) => users.find((u) => u.id === id)?.name;
  return (
    <section className="gadget" aria-label={title} aria-busy={busy}>
      <header className="gadget-head">
        <span className="card-title">
          <span className="card-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span>
            <h3>{title}</h3>
            {gadget.filterName && <small title={`Filter: ${gadget.filterName}`}>Filter: {gadget.filterName}</small>}
          </span>
        </span>
        <span className="card-actions">
          <button className="icon-link" onClick={load} disabled={busy} aria-label={`Refresh ${title}`} title="Refresh">
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className="gadget-body">
        {error ? (
          <GadgetState
            tone="error"
            icon={AlertTriangle}
            text={error}
            action={
              <button className="btn btn-ghost sm" onClick={load}>
                <RefreshCw size={13} aria-hidden="true" /> Retry
              </button>
            }
          />
        ) : !data ? (
          <GadgetSkeleton kind={gadget.kind} title={title} />
        ) : data.empty ? (
          <GadgetState
            icon={Icon}
            text={data.empty}
            action={
              onEdit && (
                <button className="btn btn-ghost sm" onClick={onEdit}>
                  <Pencil size={13} aria-hidden="true" /> Edit dashboard
                </button>
              )
            }
          />
        ) : (
          <GadgetBody kind={gadget.kind} data={data} name={name} users={users} systems={systems} now={now} field={gadget.field} field2={gadget.field2} />
        )}
      </div>
      {loadedAt && !error && (
        <footer className="card-foot">
          <span>Updated {timeAgo(loadedAt, Math.max(now, Date.now()))}</span>
        </footer>
      )}
    </section>
  );
}
/**
 * Empty or error: an icon, one line, and an action where one fits.
 * @param {{ icon: LucideIcon; text: string; action?: ReactNode; tone?: "error" }} arg1
 */
function GadgetState({ icon: Icon, text, action, tone }) {
  return (
    <div className={`gadget-state ${tone ?? ""}`} role={tone === "error" ? "alert" : undefined}>
      <span className="gadget-state-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <p>{text}</p>
      {action}
    </div>
  );
}
/**
 * A placeholder in the shape of what's coming, so the card doesn't jump when the data lands.
 * @param {{ kind: GadgetKind; title: string }} props
 */
function GadgetSkeleton({ kind, title }) {
  const lines = /** @param {number} n */ (n) => (
    <span className="skel-stack">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="skel skel-line" />
      ))}
    </span>
  );
  return (
    <div role="status">
      <span className="sr-only">Loading {title}…</span>
      <div aria-hidden="true">
        {kind === "pie" ? (
          <div className="skel-row">
            <span className="skel skel-circle" />
            {lines(4)}
          </div>
        ) : kind === "created_resolved" ? (
          <span className="skel skel-chart" />
        ) : (
          lines(5)
        )}
      </div>
    </div>
  );
}
/**
 * @param {{ items: WorkItemSummary[]; name: (id?: string) => string | undefined }} arg1
 */
function ItemList({ items, name }) {
  if (!items.length) return <GadgetState icon={Inbox} text="No work items match this filter." />;
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
/**
 * @param {{ kind: GadgetKind; data: GadgetResult; name: (id?: string) => string | undefined; users: User[]; systems: System[]; now: number; field?: string; field2?: string }} props
 */
function GadgetBody({ kind, data, name, users, systems, now, field, field2 }) {
  switch (kind) {
    case "filter_results":
      return (
        <>
          <ItemList items={data.items ?? []} name={name} />
          {(data.total ?? 0) > (data.items?.length ?? 0) && (
            <p className="gadget-note">
              Showing {data.items?.length} of {data.total}
            </p>
          )}
        </>
      );
    case "overdue":
      return <ItemList items={data.items ?? []} name={name} />;
    case "pie": {
      const slices = foldSlices(data.slices ?? []);
      if (!slices.length) return <GadgetState icon={PieChart} text="No work items match this filter." />;
      const total = slices.reduce((n, s) => n + s.count, 0);
      return (
        <div className="gadget-pie">
          <Donut
            slices={slices.map((s) => ({
              key: s.label,
              label: s.label,
              color: s.color,
              value: s.count,
            }))}
            centre="items"
          />
          <div className="gadget-scroll">
            <table className="gadget-table">
              <caption className="sr-only">Work items by {GROUP_FIELDS[field ?? "status"]?.toLowerCase()}</caption>
              <thead>
                <tr>
                  <th scope="col">{GROUP_FIELDS[field ?? "status"]}</th>
                  <th scope="col" className="num">
                    Items
                  </th>
                  <th scope="col" className="num">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {slices.map((s) => (
                  <tr key={s.label}>
                    <th scope="row">
                      <i className="dot" style={{ background: s.color }} aria-hidden="true" />
                      {s.label}
                    </th>
                    <td className="num">{s.count}</td>
                    <td className="num muted">{Math.round((s.count / total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    case "two_d": {
      const cells = data.cells ?? [];
      if (!cells.length) return <GadgetState icon={Grid3x3} text="No work items match this filter." />;
      const rows = [...new Set(cells.map((c) => c.row))].sort();
      const cols = [...new Set(cells.map((c) => c.col))].sort();
      const at = /** @param {string} r @param {string} c */ (r, c) => cells.find((x) => x.row === r && x.col === c)?.count ?? 0;
      return (
        <div className="gadget-scroll">
          <table className="gadget-table two-d">
            <caption className="sr-only">
              {GROUP_FIELDS[field ?? "status"]} by {GROUP_FIELDS[field2 ?? "assignee"]}
            </caption>
            <thead>
              <tr>
                <th scope="col">{GROUP_FIELDS[field ?? "status"]}</th>
                {cols.map((c) => (
                  <th key={c} scope="col" className="num">
                    {c}
                  </th>
                ))}
                <th scope="col" className="num">
                  Total
                </th>
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
              {
                key: "c",
                label: "Created",
                color: "var(--cat-1)",
                values: created,
              },
              {
                key: "r",
                label: "Resolved",
                color: "var(--cat-2)",
                values: resolved,
              },
            ]}
            unit=" items"
          />
          <p className="gadget-note">
            Last 30 days: {created.reduce((a, b) => a + b, 0)} created, {resolved.reduce((a, b) => a + b, 0)} resolved.
          </p>
        </>
      );
    }
    case "sprint_health": {
      const sprints = data.sprints ?? [];
      if (!sprints.length) return <GadgetState icon={Timer} text="No running sprint has this filter's items." />;
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
                  {s.done} of {s.scope} points · {s.doneItems} of {s.items} items done · <span className={s.daysLeft < 0 ? "late" : ""}>{s.daysLeft < 0 ? `${-s.daysLeft} days over` : `${s.daysLeft} days left`}</span>
                </small>
              </li>
            );
          })}
        </ul>
      );
    }
    case "workload": {
      const people = data.people ?? [];
      if (!people.length) return <GadgetState icon={BarChart3} text="No open work items match this filter." />;
      const max = Math.max(...people.map((p) => p.open));
      return (
        <div className="gadget-scroll">
          <table className="gadget-table">
            <caption className="sr-only">Open work items per person</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" className="num">
                  Open
                </th>
                <th scope="col" className="num">
                  Points
                </th>
                <th scope="col" className="num">
                  Late
                </th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.name}>
                  <th scope="row">{p.name}</th>
                  <td className="num">
                    <span className="bar-cell">
                      <i style={{ width: `${(p.open / max) * 64}px` }} aria-hidden="true" />
                      <b>{p.open}</b>
                    </span>
                  </td>
                  <td className="num">{p.points}</td>
                  <td className={`num ${p.late ? "late" : "muted"}`}>{p.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "activity": {
      const entries = data.entries ?? [];
      if (!entries.length) return <GadgetState icon={History} text="No recent changes to this filter's items." />;
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
/**
 * @param {{ dashboard: Dashboard | null; filters: SavedFilter[]; workspaces: string[]; canShare: boolean; onCancel: () => void; onSaved: (d: Dashboard | null) => Promise<void> }} arg2
 */
function DashboardEditor({ dashboard, filters, workspaces, canShare, onCancel, onSaved }) {
  const [name, setName] = useState(dashboard?.name ?? "");
  const [layout, setLayout] = useState(/** @type {Dashboard["layout"] | (() => Dashboard["layout"])} */ (dashboard?.layout ?? "two"));
  const [scope, setScope] = useState(/** @type {ShareScope | (() => ShareScope)} */ (dashboard?.shareScope ?? "private"));
  const [value, setValue] = useState(dashboard?.shareValue ?? "");
  const [gadgets, setGadgets] = useState(/** @type {Draft[] | (() => Draft[])} */ (() => (dashboard?.gadgets ?? []).map((g) => ({ ...g, key: g.id }))));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cols = layout === "one" ? 1 : layout === "two" ? 2 : 3;
  const set = /** @param {number} i @param {Partial<Draft>} patch */ (i, patch) => setGadgets((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const move = /** @param {number} i @param {number} by */ (i, by) =>
    setGadgets((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () =>
    setGadgets((list) => [
      ...list,
      {
        key: `n${Date.now()}`,
        kind: "filter_results",
        title: "",
        column: list.length % cols,
        maxRows: 10,
        filterId: filters[0]?.id,
      },
    ]);
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const body = {
        name,
        layout,
        shareScope: scope,
        shareValue: scope === "role" || scope === "workspace" ? value : null,
        gadgets: gadgets.map((g) => ({
          id: g.id,
          kind: g.kind,
          filterId: g.filterId ?? null,
          title: g.title,
          column: Math.min(g.column, cols - 1),
          field: g.field ?? null,
          field2: g.field2 ?? null,
          maxRows: g.maxRows,
        })),
      };
      const d = dashboard ? await /** @type {Promise<Dashboard>} */ (/** @type {unknown} */ (api(`/dashboards/${dashboard.id}`, "PUT", body))) : await /** @type {Promise<Dashboard>} */ (/** @type {unknown} */ (api("/dashboards", "POST", body)));
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
            <select value={layout} onChange={(e) => setLayout(/** @type {Dashboard["layout"]} */ (e.target.value))}>
              <option value="one">One column</option>
              <option value="two">Two columns</option>
              <option value="three">Three columns</option>
            </select>
          </label>
          <label className="field">
            <span>Shared with</span>
            <select value={scope} onChange={(e) => setScope(/** @type {ShareScope} */ (e.target.value))} disabled={!canShare}>
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
                  <select value={g.kind} onChange={(e) => set(i, { kind: /** @type {GadgetKind} */ (e.target.value) })}>
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
/**
 * @typedef {Object} GadgetResult
 * @property {string} [empty]
 * @property {WorkItemSummary[]} [items]
 * @property {number} [total]
 * @property {{ label: string; count: number }[]} [slices]
 * @property {{ row: string; col: string; count: number }[]} [cells]
 * @property {string[]} [days]
 * @property {number[]} [created]
 * @property {number[]} [resolved]
 * @property {{
    name: string;
    project: string;
    endDate: string;
    daysLeft: number;
    scope: number;
    done: number;
    items: number;
    doneItems: number;
  }[]} [sprints]
 * @property {{ name: string; open: number; points: number; late: number }[]} [people]
 * @property {ActivityEntry[]} [entries]
 */
/** @typedef {Omit<Gadget, "id" | "position"> & { id?: string; key: string }} Draft */
/**
 * @typedef {Object} Props
 * @property {ReactNode} overview
 * @property {User[]} users
 * @property {System[]} systems
 * @property {string[]} workspaces
 * @property {number} now
 * @property {boolean} canShare
 * @property {boolean} enabled
 */
