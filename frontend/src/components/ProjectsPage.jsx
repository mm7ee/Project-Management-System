/** @import { ReactNode } from 'react' */
/** @import { Status, System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { Filter } from './Sidebar' */
import { useState } from "react";
import { AlertOctagon, ArrowDown, ArrowUp, BellRing, Clock, FolderGit2, LayoutGrid, List, Wrench } from "lucide-react";
import { SCHEDULE_META, STATUS_META, getSchedule, initials } from "../data/systems";
import { formatDate, timeAgo } from "../time";
import { ProgressBar, StatusPill, lastUpdate } from "./SystemCard";
// The lifecycle, left to right; each stop is a tab. Colours match the charts.
/** @type {{ key: Status; label: string; color: string }[]} */ const TRACK = [
  { key: "IDEA", label: "Ideas", color: "var(--st-not)" },
  { key: "UPCOMING", label: "Upcoming", color: "var(--st-not)" },
  { key: "WIP", label: "In progress", color: "var(--st-wip)" },
  { key: "TESTING", label: "Testing", color: "var(--st-testing)" },
  { key: "TO_DEPLOY", label: "To deploy", color: "var(--st-deploy)" },
  { key: "LIVE", label: "Live", color: "var(--st-live)" },
  { key: "COMPLETED", label: "Completed", color: "var(--st-done)" },
];
// Cross-cutting views, beside the track. `always` ones show even when empty.
/** @type {{ key: Filter; label: string; icon: typeof Wrench; tone: string; always?: boolean }[]} */ const SIGNALS = [
  { key: "MAINTENANCE", label: "In maintenance", icon: Wrench, tone: "orange", always: true },
  { key: "BLOCKED", label: "Blocked / stalled", icon: AlertOctagon, tone: "red", always: true },
  { key: "OVERDUE", label: "Overdue", icon: Clock, tone: "red" },
  { key: "REQUESTED", label: "Update requests", icon: BellRing, tone: "amber" },
  { key: "MINE", label: "Assigned to me", icon: FolderGit2, tone: "cyan" },
];
/** @type {Partial<Record<Filter, string>>} */ const TAB_HELP = {
  ALL: "Every project, whatever its stage.",
  IDEA: "Proposed, not yet planned. Concept Notes start here.",
  UPCOMING: "Planned and waiting to start.",
  WIP: "Being built.",
  TESTING: "Built and being tested.",
  TO_DEPLOY: "Tested and waiting to go live.",
  LIVE: "In use.",
  COMPLETED: "Delivered and finished.",
  MAINTENANCE: "Live systems being updated or improved.",
  BLOCKED: "Something is stopping them, or there's been no progress update for a while.",
  OVERDUE: "Past their due date and not delivered.",
  REQUESTED: "Someone asked the team for an update.",
  MINE: "Projects you're on or lead.",
};
/**
 * @param {Props} props
 */
export default function ProjectsPage({ counts, filter, onFilter, mode, onMode, sections, now, info, card, onOpen, banners, workspaceBar }) {
  const [sort, setSort] = useState(/** @type {{ key: SortKey; dir: 1 | -1 } | (() => { key: SortKey; dir: 1 | -1 })} */ ({ key: "name", dir: 1 }));
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const title = filter === "ALL" ? "All projects" : (TRACK.find((t) => t.key === filter)?.label ?? SIGNALS.find((s) => s.key === filter)?.label ?? STATUS_META[/** @type {Status} */ (filter)]?.label);
  const sorted = /** @param {System[]} items */ (items) => {
    const value = /** @param {System} s @returns {string | number} */ (s) => (sort.key === "name" ? s.name.toLowerCase() : sort.key === "progress" ? s.progress : sort.key === "due" ? (s.finishedAt ?? s.dueAt ?? "9999") : lastUpdate(s));
    return [...items].sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * sort.dir);
  };
  const header = /** @param {SortKey} key @param {string} label */ (key, label) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? /** @type {1 | -1} */ (-s.dir) : 1 }))}>
        {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
  return (
    <div className="projects-page">
      {banners}
      {workspaceBar}

      <nav className="stage-track" aria-label="Project stages">
        <button className={`stage-all ${filter === "ALL" ? "on" : ""}`} aria-pressed={filter === "ALL"} onClick={() => onFilter("ALL")}>
          <b>{counts.ALL}</b>
          <span>All projects</span>
        </button>
        <ol className="stage-line">
          {TRACK.map((t) => (
            <li key={t.key}>
              <button className={`stage ${filter === t.key ? "on" : ""} ${counts[t.key] ? "" : "empty"}`} aria-pressed={filter === t.key} style={/** @type {React.CSSProperties} */ ({ ["--stage"]: t.color })} onClick={() => onFilter(t.key)}>
                <span className="stage-dot">{counts[t.key]}</span>
                <span className="stage-label">{t.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="signal-row" role="group" aria-label="Other views">
        {SIGNALS.filter((s) => s.always || counts[s.key] > 0).map(({ key, label, icon: Icon, tone }) => (
          <button key={key} className={`signal tone-${tone} ${filter === key ? "on" : ""}`} aria-pressed={filter === key} onClick={() => onFilter(key)}>
            <Icon size={14} /> {label} <b>{counts[key]}</b>
          </button>
        ))}
      </div>

      <header className="projects-head">
        <div>
          <h2>
            {title} <span className="p-count">{total}</span>
          </h2>
          {TAB_HELP[filter] && <p>{TAB_HELP[filter]}</p>}
        </div>
        <div className="view-toggle" role="radiogroup" aria-label="Layout">
          <button role="radio" aria-checked={mode === "grid"} className={mode === "grid" ? "on" : ""} onClick={() => onMode("grid")}>
            <LayoutGrid size={15} /> Grid
          </button>
          <button role="radio" aria-checked={mode === "list"} className={mode === "list" ? "on" : ""} onClick={() => onMode("list")}>
            <List size={15} /> List
          </button>
        </div>
      </header>

      {!total ? (
        <div className="empty">No projects here{filter !== "ALL" ? " right now" : ""}.</div>
      ) : (
        sections.map(({ title: t, items }, n) => (
          <section key={t || "all"} className="grid-section">
            {t && (
              <h2 className="grid-title">
                {t} <span>{items.length}</span>
              </h2>
            )}
            {mode === "grid" ? (
              // Keyed on the tab so switching replays the entrance.
              <div className="grid" key={filter}>
                {items.map((s, i) => card(s, n ? sections[0].items.length + i : i))}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table project-list">
                  <thead>
                    <tr>
                      {header("name", "Project")}
                      <th>Status</th>
                      {header("progress", "Progress")}
                      <th>Schedule</th>
                      {header("due", "Due / delivered")}
                      <th>Lead</th>
                      <th>Team</th>
                      {header("updated", "Updated")}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted(items).map((s) => {
                      const x = info(s);
                      const sched = SCHEDULE_META[getSchedule(s, now)];
                      return (
                        <tr key={s.id} className="clickable" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(s.id)}>
                          <td>
                            <span className="pl-name">
                              <b>{s.name}</b>
                              <span className="pl-flags">
                                {x.blockers.length > 0 && (
                                  <span className="flag flag-blocked" title={x.blockers.join("\n")}>
                                    <AlertOctagon size={11} /> Blocked
                                  </span>
                                )}
                                {!x.blockers.length && x.stalled !== null && <span className="flag flag-stalled">Stalled {x.stalled}d</span>}
                                {s.health === "Maintenance" && (
                                  <span className="flag flag-maint">
                                    <Wrench size={11} /> Maintenance
                                  </span>
                                )}
                                {x.requests > 0 && (
                                  <span className="flag flag-request">
                                    <BellRing size={11} /> Update requested
                                  </span>
                                )}
                                {x.mine && <span className="flag flag-mine">Yours</span>}
                              </span>
                            </span>
                          </td>
                          <td>
                            <StatusPill status={s.status} />
                          </td>
                          <td className="pl-progress">
                            <ProgressBar value={s.progress} />
                          </td>
                          <td>
                            <span className={`chip line-${sched.tone}`}>
                              <i />
                              {sched.label}
                            </span>
                          </td>
                          <td>{s.finishedAt ? formatDate(s.finishedAt) : s.dueAt ? formatDate(s.dueAt) : <span className="muted">—</span>}</td>
                          <td>{x.lead?.name ?? <span className="muted">—</span>}</td>
                          <td>
                            {x.developers.length ? (
                              <span className="dev-stack" title={x.developers.map((d) => d.name).join(", ")}>
                                {x.developers.slice(0, 3).map((d) => (
                                  <span key={d.id} className="avatar">
                                    {initials(d.name)}
                                  </span>
                                ))}
                                {x.developers.length > 3 && <span className="avatar">+{x.developers.length - 3}</span>}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="muted">{!s.updatedAt && new Date(lastUpdate(s)).getTime() > now ? "—" : timeAgo(lastUpdate(s), now)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
/** @typedef {"name" | "progress" | "due" | "updated"} SortKey */
/**
 * @typedef {Object} ProjectInfo
 * @property {User} [lead]
 * @property {User[]} developers
 * @property {number} requests
 * @property {string[]} blockers
 * @property {number | null} stalled
 * @property {boolean} mine
 */
/**
 * @typedef {Object} Props
 * @property {Record<Filter, number>} counts
 * @property {Filter} filter
 * @property {(f: Filter) => void} onFilter
 * @property {"grid" | "list"} mode
 * @property {(m: "grid" | "list") => void} onMode
 * @property {{ title: string; items: System[] }[]} sections
 * @property {number} now
 * @property {(s: System) => ProjectInfo} info
 * @property {(s: System, index: number) => ReactNode} card
 * @property {(id: string) => void} onOpen
 * @property {ReactNode} [banners]
 * @property {ReactNode} [workspaceBar]
 */
