import { useMemo, useState } from "react";
import { Menu, Plus, Search } from "lucide-react";
import { getSchedule, type System } from "./data/systems";
import { api, useAppData, type AppData } from "./data/api";
import type { Permission } from "./data/roles";
import { useNow } from "./time";
import Sidebar, { type Filter, type View } from "./components/Sidebar";
import SystemCard from "./components/SystemCard";
import SystemDrawer from "./components/SystemDrawer";
import UpdateModal, { type ProgressUpdate } from "./components/UpdateModal";
import AddSystemModal from "./components/AddSystemModal";
import AccountModal from "./components/AccountModal";
import Login from "./components/Login";
import UsersPage from "./components/UsersPage";
import ReportsPage from "./components/ReportsPage";

export default function App() {
  const { data, loading, reload } = useAppData();
  if (loading) return <div className="splash">Loading…</div>;
  if (!data) return <Login onSignedIn={reload} />;
  return <Dashboard data={data} reload={reload} />;
}

function Dashboard({ data, reload }: { data: AppData; reload: () => Promise<void> }) {
  const now = useNow();
  const { me, systems, users, requests } = data;
  const can = (p: Permission) => data.permissions.includes(p);

  const [view, setView] = useState<View>("projects");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [posting, setPosting] = useState<{ initialId?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [account, setAccount] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // The projects this user may post progress for.
  const editable =
    can("edit_any") || can("manage_systems")
      ? systems
      : can("edit_assigned")
        ? systems.filter((s) => s.id === me.projectId)
        : [];
  const mayUpdate = (s: System) => editable.some((e) => e.id === s.id);
  const requestsFor = (id: string) => requests.filter((r) => r.systemId === id);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      ALL: systems.length, LIVE: 0, COMPLETED: 0, WIP: 0, TESTING: 0, TO_DEPLOY: 0, UPCOMING: 0, IDEA: 0, OVERDUE: 0, REQUESTED: 0,
    };
    systems.forEach((s) => {
      c[s.status]++;
      if (getSchedule(s, now) === "OVERDUE") c.OVERDUE++;
      if (requests.some((r) => r.systemId === s.id)) c.REQUESTED++;
    });
    return c;
  }, [systems, requests, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return systems
      .filter((s) =>
        filter === "ALL"
          ? true
          : filter === "OVERDUE"
            ? getSchedule(s, now) === "OVERDUE"
            : filter === "REQUESTED"
              ? requests.some((r) => r.systemId === s.id)
              : s.status === filter,
      )
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      // A developer's own project comes first.
      .sort((a, b) => Number(b.id === me.projectId) - Number(a.id === me.projectId));
  }, [systems, requests, filter, query, now, me.projectId]);

  const avgProgress = systems.length ? Math.round(systems.reduce((n, s) => n + s.progress, 0) / systems.length) : 0;
  const atRisk = systems.filter((s) => ["AT_RISK", "OVERDUE"].includes(getSchedule(s, now))).length;
  const stats = [
    { value: systems.length, label: "Projects tracked", tone: "navy" },
    { value: counts.LIVE, label: "Live", tone: "green" },
    { value: `${avgProgress}%`, label: "Average progress", tone: "cyan" },
    { value: atRisk, label: "At risk / overdue", tone: "red" },
  ];

  const saveUpdate = async ({ id, progress, status }: ProgressUpdate) => {
    await api(`/systems/${id}`, "PATCH", { progress, status });
    await reload();
    setPosting(null);
  };

  const selected = systems.find((s) => s.id === selectedId) ?? null;
  const myProject = systems.find((s) => s.id === me.projectId);

  return (
    <div className="shell">
      <Sidebar
        me={me}
        filter={filter}
        view={view}
        counts={counts}
        open={menuOpen}
        canAdd={can("manage_systems")}
        canReports={can("reports")}
        canUsers={can("manage_users")}
        onFilter={setFilter}
        onView={setView}
        onClose={() => setMenuOpen(false)}
        onAdd={() => {
          setAddError("");
          setAdding(true);
        }}
        onAccount={() => setAccount(true)}
      />

      <main className="main">
        <header className="topbar no-print">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <h1>Projects Tracker</h1>
          {view === "projects" && (
            <>
              <label className="search">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects..."
                  aria-label="Search projects"
                />
              </label>
              {editable.length > 0 && (
                <button className="btn btn-amber post-btn" onClick={() => setPosting({})}>
                  <Plus size={17} strokeWidth={3} /> Post progress update
                </button>
              )}
            </>
          )}
        </header>

        {view === "users" && can("manage_users") ? (
          <UsersPage me={me} users={users} systems={systems} roleMatrix={data.roleMatrix} onChanged={reload} />
        ) : view === "reports" && can("reports") ? (
          <ReportsPage systems={systems} users={users} requests={requests} now={now} />
        ) : (
          <>
            {me.role === "developer" && !myProject && (
              <p className="notice">You haven't been assigned a project yet. Ask an administrator to assign you one.</p>
            )}
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
                  <SystemCard
                    key={s.id}
                    system={s}
                    now={now}
                    lead={users.find((u) => u.id === s.lead)}
                    requests={requestsFor(s.id).length}
                    mine={s.id === me.projectId}
                    onSelect={(x) => setSelectedId(x.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">No projects match.</div>
            )}
          </>
        )}
      </main>

      <SystemDrawer
        system={selected}
        now={now}
        me={me}
        users={users}
        requests={selected ? requestsFor(selected.id) : []}
        canUpdate={!!selected && mayUpdate(selected)}
        canManage={can("manage_systems")}
        canRequest={can("request_updates")}
        onClose={() => setSelectedId(null)}
        onUpdate={() => setPosting({ initialId: selected?.id })}
        onChangeLead={async (id, lead) => {
          await api(`/systems/${id}`, "PATCH", { lead });
          await reload();
        }}
        onDelete={async (id) => {
          await api(`/systems/${id}`, "DELETE");
          setSelectedId(null);
          await reload();
        }}
        onRequest={async (id, message) => {
          await api("/requests", "POST", { systemId: id, message });
          await reload();
        }}
        onDismiss={async (requestId) => {
          await api(`/requests/${requestId}`, "DELETE");
          await reload();
        }}
      />
      {account && (
        <AccountModal
          me={me}
          permissions={data.permissions}
          projectName={myProject?.name}
          onClose={() => setAccount(false)}
          onSignOut={() => {
            setAccount(false);
            reload();
          }}
        />
      )}
      {adding && (
        <AddSystemModal
          users={users}
          error={addError}
          onClose={() => setAdding(false)}
          onSave={async (s) => {
            try {
              await api("/systems", "POST", s);
              await reload();
              setAdding(false);
              setFilter("ALL");
              setQuery("");
            } catch (e) {
              setAddError(e instanceof Error ? e.message : "Couldn't add the system");
            }
          }}
        />
      )}
      {posting && (
        <UpdateModal
          systems={editable}
          initialId={posting.initialId}
          onSave={saveUpdate}
          onClose={() => setPosting(null)}
        />
      )}
    </div>
  );
}
