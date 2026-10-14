import { useMemo, useState } from "react";
import { CalendarClock, Plus, Search, StickyNote } from "lucide-react";
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

export default function FeaturesPage({ features, systems, users, me, now, canManage, onOpen, onNew }: Props) {
  const mineCount = features.filter((f) => f.assignee === me.id).length;
  const [who, setWho] = useState<Who>(mineCount ? "mine" : "all");
  const [state, setState] = useState<State>("open");
  const [priority, setPriority] = useState("");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");

  const scoped = who === "mine" ? features.filter((f) => f.assignee === me.id) : features;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((f) => (state === "open" ? isOpen(f) : state === "done" ? !isOpen(f) : true))
      .filter((f) => !priority || f.priority === priority)
      .filter((f) => !project || f.systemId === project)
      .filter((f) => !q || [f.title, f.description, f.client, f.notes ?? ""].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byUrgency(a, b));
  }, [scoped, state, priority, project, query]);

  const open = scoped.filter(isOpen);
  const stats = [
    { value: open.length, label: "Open requests", tone: "navy" },
    { value: open.filter((f) => f.priority === "CRITICAL" || f.priority === "HIGH").length, label: "Critical / high", tone: "red" },
    { value: open.filter((f) => isLate(f, now)).length, label: "Past delivery date", tone: "amber" },
    { value: scoped.filter((f) => f.status === "COMPLETED").length, label: "Completed", tone: "green" },
  ];
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
        {stats.map(({ value, label, tone }) => (
          <div className="stat" key={label}>
            <span className={`stat-value text-${tone}`}>
              <CountUp value={value} />
            </span>
            <span className="stat-label">{label}</span>
          </div>
        ))}
      </section>

      <div className="viz-filters" role="group" aria-label="Filter feature requests">
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
              {visible.map((f) => {
                const late = isLate(f, now);
                return (
                  <tr key={f.id} className="clickable" tabIndex={0} onClick={() => onOpen(f)} onKeyDown={(e) => e.key === "Enter" && onOpen(f)}>
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
                    <td>
                      <PriorityBadge priority={f.priority} />
                    </td>
                    <td>
                      <FeatureStatusPill status={f.status} />
                    </td>
                    <td>{userName(f.assignee) ?? <i className="muted">Unassigned</i>}</td>
                    <td className={late ? "text-red strong" : ""}>
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
