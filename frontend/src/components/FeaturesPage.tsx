import { useMemo, useRef, useState } from "react";
import { CalendarClock, Plus, Search, StickyNote, X } from "lucide-react";
import type { System } from "../data/systems";
import type { User } from "../data/roles";
import { KIND_META, PRIORITIES, PRIORITY_META, byUrgency, isLate, isOpen, type Feature } from "../data/features";
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
  onOpen: (f: Feature) => void;
  onNew: () => void;
}

type Who = "mine" | "all";
type State = "open" | "done" | "all";
type Focus = "" | "urgent" | "late" | "completed";

export default function FeaturesPage({ features, systems, users, me, now, canManage, onOpen, onNew }: Props) {
  const mineCount = features.filter((f) => f.assignee === me.id).length;
  const [who, setWho] = useState<Who>(mineCount ? "mine" : "all");
  const [state, setState] = useState<State>("open");
  const [priority, setPriority] = useState("");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  // Set by clicking a figure card: narrows the list to exactly what that card counts.
  const [focus, setFocus] = useState<Focus>("");
  const listRef = useRef<HTMLDivElement>(null);
  // The card last clicked, and a counter so clicking again replays the highlight.
  const [picked, setPicked] = useState<{ label: string; n: number } | null>(null);

  const scoped = who === "mine" ? features.filter((f) => f.assignee === me.id) : features;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((f) => (state === "open" ? isOpen(f) : state === "done" ? !isOpen(f) : true))
      .filter((f) => !priority || f.priority === priority)
      .filter((f) => !project || f.systemId === project)
      .filter((f) => !q || [f.title, f.description, f.client, f.notes ?? ""].some((t) => t.toLowerCase().includes(q)))
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
  }, [scoped, state, priority, project, query, focus, now]);

  const open = scoped.filter(isOpen);
  const stats: { value: number; label: string; tone: string; focus: Focus; state: State }[] = [
    { value: open.length, label: "Open requests", tone: "navy", focus: "", state: "open" },
    { value: open.filter((f) => f.priority === "CRITICAL" || f.priority === "HIGH").length, label: "Critical / high", tone: "red", focus: "urgent", state: "open" },
    { value: open.filter((f) => isLate(f, now)).length, label: "Past delivery date", tone: "amber", focus: "late", state: "open" },
    { value: scoped.filter((f) => f.status === "COMPLETED").length, label: "Completed", tone: "green", focus: "completed", state: "done" },
  ];
  const activeCard = stats.find((c) => c.focus === focus && c.state === state && !priority && !project && !query);
  const showCard = (c: (typeof stats)[number]) => {
    setPicked((p) => ({ label: c.label, n: (p?.n ?? 0) + 1 }));
    setFocus(c.focus);
    setState(c.state);
    setPriority("");
    setProject("");
    setQuery("");
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // Rows light up in the clicked card's colour while its view is showing.
  const lit = picked && activeCard?.label === picked.label ? activeCard : null;
  const litCell = (cell: "priority" | "status" | "date") =>
    lit && ((cell === "priority" && lit.focus === "urgent") || (cell === "date" && lit.focus === "late") || (cell === "status" && lit.focus === "completed"))
      ? "hl-cell"
      : "";
  const systemName = (id: string) => systems.find((s) => s.id === id)?.name ?? "—";
  const userName = (id?: string) => users.find((u) => u.id === id)?.name;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Feature requests</h2>
          <p>Modules, changes and fixes clients ask for, on projects in progress or already delivered.</p>
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

      <div ref={listRef} className="viz-filters" role="group" aria-label="Filter feature requests">
        <div className="seg" role="radiogroup" aria-label="Whose requests">
          <button role="radio" aria-checked={who === "mine"} className={who === "mine" ? "on" : ""} onClick={() => setWho("mine")}>
            Assigned to me · {mineCount}
          </button>
          <button role="radio" aria-checked={who === "all"} className={who === "all" ? "on" : ""} onClick={() => setWho("all")}>
            All · {features.length}
          </button>
        </div>
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
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {systems
            .filter((s) => features.some((f) => f.systemId === s.id))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <label className="search sm">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search requests…" aria-label="Search requests" />
        </label>
        {focus && (
          <button className="filter-chip" onClick={() => setFocus("")} title="Clear this filter">
            Showing: {stats.find((c) => c.focus === focus)?.label.toLowerCase()} <X size={14} />
          </button>
        )}
      </div>

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
                    tabIndex={0} onClick={() => onOpen(f)} onKeyDown={(e) => e.key === "Enter" && onOpen(f)}>
                    <td>
                      <span className="feature-cell">
                        <b>{f.title}</b>
                        <small>
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
          {who === "mine" && !mineCount
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
