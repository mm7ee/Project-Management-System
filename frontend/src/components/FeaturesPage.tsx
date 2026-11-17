import { useMemo, useRef, useState } from "react";
import { CalendarClock, Plus, Search, StickyNote, X } from "lucide-react";
import type { System } from "../data/systems";
import type { User } from "../data/roles";
import { FEATURE_KINDS, KIND_META, PRIORITIES, PRIORITY_META, byUrgency, isLate, isOpen, type Feature, type FeatureKind } from "../data/features";
import { formatDate } from "../time";
import CountUp from "./CountUp";
import { FeatureStatusPill, PriorityBadge } from "./FeatureModal";

interface Props {
  features: Feature[];
  systems: System[];
  users: User[];
  me: User;
  now: number;
  canManage: boolean;
  ownOnly?: boolean;
  workspaces: string[]; // projects are grouped by workspace in the project filter // a developer: the server sends only requests assigned to or logged by them
  onOpen: (f: Feature) => void;
  onNew: () => void;
}

type Who = "mine" | "all";
type State = "open" | "done" | "all";
type Focus = "" | "urgent" | "late" | "completed";
/** What the search box looks in. */
type SearchIn = "all" | "feature" | "project" | "client" | "developer";
const SEARCH_IN: { key: SearchIn; label: string; hint: string }[] = [
  { key: "all", label: "Search everything", hint: "Search features, projects, clients, developers…" },
  { key: "feature", label: "By feature", hint: "Search by feature name or details…" },
  { key: "project", label: "By project", hint: "Search by project name…" },
  { key: "client", label: "By client", hint: "Search by client…" },
  { key: "developer", label: "By developer", hint: "Search by developer…" },
];
const UNASSIGNED = "__none";

export default function FeaturesPage({ features, systems, users, me, now, canManage, ownOnly = false, workspaces, onOpen, onNew }: Props) {
  const mineCount = features.filter((f) => f.assignee === me.id).length;
  const [who, setWho] = useState<Who>(mineCount && !ownOnly ? "mine" : "all");
  const [state, setState] = useState<State>("open");
  const [priority, setPriority] = useState("");
  const [project, setProject] = useState("");
  const [workspace, setWorkspace] = useState(""); // "" = every workspace
  // A project's workspace (an unknown or missing one counts in the first, as elsewhere).
  const wsOf = (systemId: string) => {
    const w = systems.find((s) => s.id === systemId)?.workspace;
    return w && workspaces.includes(w) ? w : workspaces[0];
  };
  const [query, setQuery] = useState("");
  const [searchIn, setSearchIn] = useState<SearchIn>("all");
  const [kind, setKind] = useState<FeatureKind | "">("");
  const [developer, setDeveloper] = useState(""); // a user id, UNASSIGNED, or "" for anyone
  // Set by clicking a figure card: narrows the list to exactly what that card counts.
  const [focus, setFocus] = useState<Focus>("");
  const listRef = useRef<HTMLDivElement>(null);
  // The card last clicked, and a counter so clicking again replays the highlight.
  const [picked, setPicked] = useState<{ label: string; n: number } | null>(null);

  // The chosen workspace narrows everything on the page, figure cards included.
  const inWorkspace = (f: Feature) => !workspace || wsOf(f.systemId) === workspace;
  const scoped = (who === "mine" ? features.filter((f) => f.assignee === me.id) : features).filter(inWorkspace);
  const visible = useMemo(() => {
    const projectOf = (f: Feature) => systems.find((s) => s.id === f.systemId)?.name ?? "";
    const developerOf = (f: Feature) => users.find((u) => u.id === f.assignee)?.name ?? "";
    const fields = (f: Feature) =>
      searchIn === "feature"
        ? [f.title, f.description, f.notes ?? ""]
        : searchIn === "project"
          ? [projectOf(f)]
          : searchIn === "client"
            ? [f.client]
            : searchIn === "developer"
              ? [developerOf(f)]
              : [f.title, f.description, f.client, f.notes ?? "", projectOf(f), developerOf(f), KIND_META[f.kind], f.key ?? ""];
    // Every word must appear somewhere in the chosen fields, so "lms export" finds an export request on the LMS.
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return scoped
      .filter((f) => (state === "open" ? isOpen(f) : state === "done" ? !isOpen(f) : true))
      .filter((f) => !priority || f.priority === priority)
      .filter((f) => !project || f.systemId === project)
      .filter((f) => !kind || f.kind === kind)
      .filter((f) => !developer || (developer === UNASSIGNED ? !f.assignee : f.assignee === developer))
      .filter((f) => {
        if (!words.length) return true;
        const text = fields(f).join(" ").toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .filter((f) =>
        focus === "urgent"
          ? f.priority === "CRITICAL" || f.priority === "HIGH"
          : focus === "late"
            ? isLate(f, now)
            : focus === "completed"
              ? f.status === "COMPLETED"
              : true,
      )
      .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byUrgency(a, b));
  }, [scoped, state, priority, project, kind, developer, query, searchIn, focus, now, systems, users, workspaces, workspace]);

  const open = scoped.filter(isOpen);
  const stats: { value: number; label: string; tone: string; focus: Focus; state: State }[] = [
    { value: open.length, label: "Open requests", tone: "navy", focus: "", state: "open" },
    {
      value: open.filter((f) => f.priority === "CRITICAL" || f.priority === "HIGH").length,
      label: "Critical / high",
      tone: "red",
      focus: "urgent",
      state: "open",
    },
    { value: open.filter((f) => isLate(f, now)).length, label: "Past delivery date", tone: "amber", focus: "late", state: "open" },
    { value: scoped.filter((f) => f.status === "COMPLETED").length, label: "Completed", tone: "green", focus: "completed", state: "done" },
  ];
  const activeCard = stats.find((c) => c.focus === focus && c.state === state && !priority && !project && !kind && !developer && !query);
  const showCard = (c: (typeof stats)[number]) => {
    setPicked((p) => ({ label: c.label, n: (p?.n ?? 0) + 1 }));
    setFocus(c.focus);
    setState(c.state);
    setPriority("");
    setProject("");
    setKind("");
    setDeveloper("");
    setQuery("");
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // Rows light up in the clicked card's colour while its view is showing.
  const lit = picked && activeCard?.label === picked.label ? activeCard : null;
  const litCell = (cell: "priority" | "status" | "date") =>
    lit &&
    ((cell === "priority" && lit.focus === "urgent") ||
      (cell === "date" && lit.focus === "late") ||
      (cell === "status" && lit.focus === "completed"))
      ? "hl-cell"
      : "";
  // Anything narrowing the list beyond the default view, so it can all be cleared at once.
  const filtered = !!(priority || project || kind || developer || workspace || query || focus || state !== "open");
  const clearAll = () => {
    setPriority("");
    setProject("");
    setKind("");
    setDeveloper("");
    setWorkspace("");
    setQuery("");
    setFocus("");
    setState("open");
  };
  // Developers who have requests, for the developer filter.
  const developers = users.filter((u) => scoped.some((f) => f.assignee === u.id)).sort((a, b) => a.name.localeCompare(b.name));
  const searchHint = SEARCH_IN.find((o) => o.key === searchIn)!.hint;
  const systemName = (id: string) => systems.find((s) => s.id === id)?.name ?? "—";
  const userName = (id?: string) => users.find((u) => u.id === id)?.name;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Feature requests</h2>
          <p>
            {ownOnly
              ? "Requests assigned to you, and any you logged yourself."
              : "Modules, changes and fixes clients ask for, on projects in progress or already delivered."}
          </p>
        </div>
        {canManage && (
          <button className="btn btn-amber" onClick={onNew} disabled={!systems.length}>
            <Plus size={17} strokeWidth={3} /> Log feature request
          </button>
        )}
      </header>

      <section className="stats">
        {stats.map((c) => (
          <button
            className={`stat stat-btn ${activeCard === c ? "on" : ""}`}
            key={c.label}
            aria-pressed={activeCard === c}
            title={`Show ${c.label.toLowerCase()}`}
            onClick={() => showCard(c)}
          >
            <span className={`stat-value text-${c.tone}`}>
              <CountUp value={c.value} />
            </span>
            <span className="stat-label">{c.label}</span>
          </button>
        ))}
      </section>

      <div ref={listRef} className="feature-search" role="search">
        <select value={searchIn} onChange={(e) => setSearchIn(e.target.value as SearchIn)} aria-label="Search in">
          {SEARCH_IN.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <Search size={17} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchHint} aria-label="Search feature requests" />
        {query && (
          <button className="feature-search-clear" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="viz-filters" role="group" aria-label="Filter feature requests">
        {!ownOnly && (
          <div className="seg" role="radiogroup" aria-label="Whose requests">
            <button role="radio" aria-checked={who === "mine"} className={who === "mine" ? "on" : ""} onClick={() => setWho("mine")}>
              Assigned to me · {mineCount}
            </button>
            <button role="radio" aria-checked={who === "all"} className={who === "all" ? "on" : ""} onClick={() => setWho("all")}>
              All · {features.length}
            </button>
          </div>
        )}
        <div className="seg" role="radiogroup" aria-label="Status">
          {(
            [
              ["open", "Open"],
              ["done", "Closed"],
              ["all", "Any status"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={state === k} className={state === k ? "on" : ""} onClick={() => setState(k)}>
              {label}
            </button>
          ))}
        </div>
        <select className={priority ? "set" : ""} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>
        <select className={kind ? "set" : ""} value={kind} onChange={(e) => setKind(e.target.value as FeatureKind | "")} aria-label="Type of request">
          <option value="">Any type</option>
          {FEATURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_META[k]}
            </option>
          ))}
        </select>
        {!ownOnly && (
          <select className={developer ? "set" : ""} value={developer} onChange={(e) => setDeveloper(e.target.value)} aria-label="Developer">
            <option value="">Any developer</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {developers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select
          className={workspace ? "set" : ""}
          value={workspace}
          onChange={(e) => {
            setWorkspace(e.target.value);
            setProject("");
          }}
          aria-label="Workspace"
        >
          <option value="">All workspaces</option>
          {workspaces.map((w) => (
            <option key={w} value={w}>
              {w} · {features.filter((f) => wsOf(f.systemId) === w).length}
            </option>
          ))}
        </select>
        <select className={project ? "set" : ""} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">{workspace ? `All ${workspace} projects` : "All projects"}</option>
          {/* Projects in the chosen workspace that have requests: busiest first, then by name. */}
          {systems
            .filter((s) => !workspace || wsOf(s.id) === workspace)
            .map((s) => {
              const mine = features.filter((f) => f.systemId === s.id);
              return { s, total: mine.length, open: mine.filter(isOpen).length };
            })
            .filter((x) => x.total)
            .sort((a, b) => Number(b.open > 0) - Number(a.open > 0) || a.s.name.localeCompare(b.s.name))
            .map(({ s, total, open }) => (
              <option key={s.id} value={s.id}>
                {s.name} ({open ? `${open} open of ${total}` : `${total} closed`})
              </option>
            ))}
        </select>
        {focus && (
          <button className="filter-chip" onClick={() => setFocus("")} title="Clear this filter">
            Showing: {stats.find((c) => c.focus === focus)?.label.toLowerCase()} <X size={14} />
          </button>
        )}
      </div>

      <p className="feature-results" aria-live="polite">
        <span>
          Showing <b>{visible.length}</b> of {scoped.length} request{scoped.length === 1 ? "" : "s"}
        </span>
        {filtered && (
          <button className="link-btn" onClick={clearAll}>
            Clear all filters
          </button>
        )}
      </p>

      {visible.length ? (
        <div className="table-wrap">
          <table className="table feature-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Project</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Developer</th>
                <th>Expected delivery</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f, i) => {
                const late = isLate(f, now);
                return (
                  <tr
                    key={lit ? `${f.id}-${picked!.n}` : f.id}
                    className={`clickable ${lit ? `hl hl-${lit.tone}` : ""}`}
                    style={lit ? { ["--i" as string]: Math.min(i, 12) } : undefined}
                    tabIndex={0}
                    onClick={() => onOpen(f)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(f)}
                  >
                    <td>
                      <span className="feature-cell">
                        <b>{f.title}</b>
                        <small>
                          {f.key && <span className="mono wi-key-inline">{f.key}</span>}
                          {KIND_META[f.kind]}
                          {f.client ? ` · for ${f.client}` : ""}
                          {f.notes && (
                            <span className="note-tag" title={f.notes}>
                              <StickyNote size={12} /> Note
                            </span>
                          )}
                        </small>
                      </span>
                    </td>
                    <td>{systemName(f.systemId)}</td>
                    <td className={litCell("priority")}>
                      <PriorityBadge priority={f.priority} />
                    </td>
                    <td className={litCell("status")}>
                      <FeatureStatusPill status={f.status} />
                    </td>
                    <td>{userName(f.assignee) ?? <i className="muted">Unassigned</i>}</td>
                    <td className={`${late ? "text-red strong" : ""} ${litCell("date")}`}>
                      {f.completedAt ? (
                        <>Delivered {formatDate(f.completedAt)}</>
                      ) : f.dueAt ? (
                        <span className="due">
                          {late && <CalendarClock size={14} />} {formatDate(f.dueAt)}
                        </span>
                      ) : (
                        <span className="muted">Not set</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          {(who === "mine" || ownOnly) && !features.length
            ? "No feature requests are assigned to you yet."
            : features.length
              ? "No requests match these filters."
              : canManage
                ? "No feature requests yet. Log the first one when a client asks for something."
                : "No feature requests yet."}
        </div>
      )}
    </div>
  );
}
