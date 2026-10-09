import { useMemo, useState } from "react";
import { Menu, Plus, Search } from "lucide-react";
import { getSchedule, type System } from "./data/systems";
import { useSystems } from "./data/store";
import { useNow } from "./time";
import Sidebar, { type Filter } from "./components/Sidebar";
import SystemCard from "./components/SystemCard";
import SystemDrawer from "./components/SystemDrawer";
import UpdateModal, { type ProgressUpdate } from "./components/UpdateModal";
import AddSystemModal from "./components/AddSystemModal";

// Initials shown on updates posted from this browser, until there is a login.
const CURRENT_USER = "MM";

export default function App() {
  const now = useNow();
  const { systems, add, update, remove } = useSystems();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      ALL: systems.length, LIVE: 0, COMPLETED: 0, WIP: 0, TO_DEPLOY: 0, UPCOMING: 0, IDEA: 0, OVERDUE: 0,
    };
    systems.forEach((s) => {
      c[s.status]++;
      if (getSchedule(s, now) === "OVERDUE") c.OVERDUE++;
    });
    return c;
  }, [systems, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return systems
      .filter((s) => filter === "ALL" || (filter === "OVERDUE" ? getSchedule(s, now) === "OVERDUE" : s.status === filter))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [systems, filter, query, now]);

  const avgProgress = systems.length ? Math.round(systems.reduce((n, s) => n + s.progress, 0) / systems.length) : 0;
  const atRisk = systems.filter((s) => ["AT_RISK", "OVERDUE"].includes(getSchedule(s, now))).length;
  const stats = [
    { value: systems.length, label: "Projects tracked", tone: "navy" },
    { value: counts.LIVE, label: "Live", tone: "green" },
    { value: `${avgProgress}%`, label: "Average progress", tone: "cyan" },
    { value: atRisk, label: "At risk / overdue", tone: "red" },
  ];

  const saveUpdate = ({ id, progress, status }: ProgressUpdate) => {
    const stamp = new Date().toISOString();
    const s = systems.find((x) => x.id === id);
    update(id, {
      progress,
      status,
      updatedAt: stamp,
      updatedBy: CURRENT_USER,
      finishedAt: progress === 100 && (status === "LIVE" || status === "COMPLETED") ? s?.finishedAt ?? stamp : s?.finishedAt,
    });
    setPosting(false);
  };

  const addSystem = (s: System) => {
    add({ ...s, updatedBy: CURRENT_USER });
    setAdding(false);
    setFilter("ALL");
    setQuery("");
  };

  const selected = systems.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="shell">
      <Sidebar
        filter={filter}
        counts={counts}
        open={menuOpen}
        onFilter={setFilter}
        onClose={() => setMenuOpen(false)}
        onAdd={() => setAdding(true)}
      />

      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <h1>Projects Tracker</h1>
          <label className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects..."
              aria-label="Search projects"
            />
          </label>
          <button className="btn btn-amber post-btn" onClick={() => setPosting(true)}>
            <Plus size={17} strokeWidth={3} /> Post progress update
          </button>
        </header>

        <section className="stats">
          {stats.map(({ value, label, tone }) => (
            <div className="stat" key={label}>
              <span className={`stat-value text-${tone}`}>{value}</span>
              <span className="stat-label">{label}</span>
            </div>
          ))}
        </section>

        {visible.length ? (
          <div className="grid">
            {visible.map((s) => (
              <SystemCard key={s.id} system={s} now={now} onSelect={(x) => setSelectedId(x.id)} />
            ))}
          </div>
        ) : (
          <div className="empty">No projects match.</div>
        )}
      </main>

      <SystemDrawer
        system={selected}
        now={now}
        onClose={() => setSelectedId(null)}
        onDelete={(id) => {
          remove(id);
          setSelectedId(null);
        }}
      />
      {adding && (
        <AddSystemModal existingIds={systems.map((s) => s.id)} onSave={addSystem} onClose={() => setAdding(false)} />
      )}
      {posting && <UpdateModal systems={systems} onSave={saveUpdate} onClose={() => setPosting(false)} />}
    </div>
  );
}
