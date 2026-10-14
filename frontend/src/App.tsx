import { useMemo, useState } from "react";
import { Menu, Plus, Search } from "lucide-react";
import { getSchedule, type System } from "./data/systems";
import { api, useAppData, type AppData } from "./data/api";
import { isAssigned, type Permission, type Prefs } from "./data/roles";
import { useApplyPrefs } from "./prefs";
import { useNow } from "./time";
import Sidebar, { type Filter, type View } from "./components/Sidebar";
import SystemCard from "./components/SystemCard";
import SystemDrawer from "./components/SystemDrawer";
import UpdateModal, { type ProgressUpdate } from "./components/UpdateModal";
import AddSystemModal from "./components/AddSystemModal";
import SettingsPage from "./components/SettingsPage";
import FuturisticBackdrop from "./components/FuturisticBackdrop";
import ForcePasswordChange from "./components/ForcePasswordChange";
import ActivityPage from "./components/ActivityPage";
import Login from "./components/Login";
import UsersPage from "./components/UsersPage";
import ReportsPage from "./components/reports/ReportsPage";
import UpdateBanner from "./components/UpdateBanner";
import CountUp from "./components/CountUp";
import FeaturesPage from "./components/FeaturesPage";
import FeatureModal from "./components/FeatureModal";
import { isLate, isOpen, type Feature } from "./data/features";

export default function App() {
  const { data, mustChange, loading, reload } = useAppData();
  return (
    <>
      {loading ? (
        <div className="splash">Loading…</div>
      ) : data ? (
        <Dashboard data={data} reload={reload} />
      ) : mustChange ? (
        <ForcePasswordChange message={mustChange} onDone={reload} />
      ) : (
        <Login onSignedIn={reload} />
      )}
      <UpdateBanner />
    </>
  );
}

function Dashboard({ data, reload }: { data: AppData; reload: () => Promise<void> }) {
  const now = useNow();
  const { me, systems, users, requests, features } = data;
  const can = (p: Permission) => data.permissions.includes(p);

  // Preferences apply instantly and save in the background.
  const [prefs, setPrefs] = useState<Prefs>(data.prefs);
  useApplyPrefs(prefs);
  const savePrefs = async (p: Prefs) => {
    const before = prefs;
    setPrefs(p);
    try {
      setPrefs(await api<Prefs>("/me/prefs", "PUT", p));
    } catch (e) {
      setPrefs(before);
      throw e;
    }
  };

  const isMine = (s: System) => isAssigned(me, s);
  const myProjects = systems.filter(isMine);

  const [view, setView] = useState<View>("projects");
  const [filter, setFilter] = useState<Filter>(() =>
    data.prefs.start === "MINE" && !myProjects.length ? "ALL" : (data.prefs.start as Filter),
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [posting, setPosting] = useState<{ initialId?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // The feature request open in the editor: an existing one, or a new one (feature null).
  const [featureEdit, setFeatureEdit] = useState<{ feature: Feature | null; systemId?: string } | null>(null);

  // The sidebar counts your own open feature requests; managers without any see every open one.
  const openFeatures = features.filter(isOpen);
  const myOpenFeatures = openFeatures.filter((f) => f.assignee === me.id);
  const featureBadge = myOpenFeatures.length ? myOpenFeatures : can("manage_features") ? openFeatures : [];

  // The projects this user may post progress for.
  const editable =
    can("edit_any") || can("manage_systems")
      ? systems
      : can("edit_assigned")
        ? systems.filter((s) => me.projectIds?.includes(s.id))
        : [];
  const mayUpdate = (s: System) => editable.some((e) => e.id === s.id);
  const requestsFor = (id: string) => requests.filter((r) => r.systemId === id);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      ALL: systems.length, LIVE: 0, COMPLETED: 0, WIP: 0, TESTING: 0, TO_DEPLOY: 0, UPCOMING: 0, IDEA: 0, OVERDUE: 0, REQUESTED: 0, MAINTENANCE: 0, MINE: 0,
    };
    systems.forEach((s) => {
      c[s.status]++;
      if (getSchedule(s, now) === "OVERDUE") c.OVERDUE++;
      if (requests.some((r) => r.systemId === s.id)) c.REQUESTED++;
      if (s.health === "Maintenance") c.MAINTENANCE++;
      if (isMine(s)) c.MINE++;
    });
    return c;
  }, [systems, requests, now, me]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return systems
      .filter((s) =>
        filter === "ALL"
          ? true
          : filter === "MINE"
            ? isMine(s)
            : filter === "OVERDUE"
            ? getSchedule(s, now) === "OVERDUE"
            : filter === "REQUESTED"
              ? requests.some((r) => r.systemId === s.id)
              : filter === "MAINTENANCE"
                ? s.health === "Maintenance"
                : s.status === filter,
      )
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      // Your own projects come first.
      .sort((a, b) => Number(isMine(b)) - Number(isMine(a)));
  }, [systems, requests, filter, query, now, me]);

  // On "All projects", the ones assigned to you get their own section above the rest.
  const sections =
    filter === "ALL" && visible.some(isMine)
      ? [
          { title: "Assigned to you", items: visible.filter(isMine) },
          { title: "All other projects", items: visible.filter((s) => !isMine(s)) },
        ].filter((x) => x.items.length)
      : [{ title: "", items: visible }];

  const avgProgress = systems.length ? Math.round(systems.reduce((n, s) => n + s.progress, 0) / systems.length) : 0;
  const atRisk = systems.filter((s) => ["AT_RISK", "OVERDUE"].includes(getSchedule(s, now))).length;
  const stats = [
    { value: systems.length, label: "Projects tracked", tone: "navy" },
    { value: counts.LIVE, label: "Live", tone: "green" },
    { value: counts.TESTING, label: "Testing", tone: "violet" },
    { value: `${avgProgress}%`, label: "Average progress", tone: "cyan" },
    { value: atRisk, label: "At risk / overdue", tone: "red" },
  ];

  const saveUpdate = async ({ id, ...update }: ProgressUpdate) => {
    await api(`/systems/${id}`, "PATCH", update);
    await reload();
    setPosting(null);
  };

  const selected = systems.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="shell">
      {prefs.theme === "futuristic" && <FuturisticBackdrop />}
      <Sidebar
        me={me}
        filter={filter}
        view={view}
        counts={counts}
        features={{
          count: featureBadge.length,
          urgent: featureBadge.some((f) => f.priority === "CRITICAL" || isLate(f, now)),
        }}
        open={menuOpen}
        canAdd={can("manage_systems")}
        canReports={can("reports")}
        canUsers={can("manage_users")}
        canActivity={can("audit_log")}
        onFilter={setFilter}
        onView={setView}
        onClose={() => setMenuOpen(false)}
        onAdd={() => {
          setAddError("");
          setAdding(true);
        }}
        onAccount={() => setView("settings")}
        theme={prefs.theme}
        onTheme={(theme) => savePrefs({ ...prefs, theme }).catch(() => undefined)}
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

        {view === "settings" ? (
          <SettingsPage
            me={me}
            prefs={prefs}
            permissions={data.permissions}
            projects={myProjects}
            onPrefs={savePrefs}
            onProfileSaved={reload}
            onSignedOut={reload}
          />
        ) : view === "features" ? (
          <FeaturesPage
            features={features}
            systems={systems}
            users={users}
            me={me}
            now={now}
            canManage={can("manage_features")}
            onOpen={(feature) => setFeatureEdit({ feature })}
            onNew={() => setFeatureEdit({ feature: null })}
          />
        ) : view === "activity" && can("audit_log") ? (
          <ActivityPage users={users} systems={systems} now={now} />
        ) : view === "users" && can("manage_users") ? (
          <UsersPage me={me} users={users} systems={systems} roleMatrix={data.roleMatrix} onChanged={reload} />
        ) : view === "reports" && can("reports") ? (
          <ReportsPage systems={systems} users={users} requests={requests} features={features} now={now} />
        ) : (
          <>
            {me.role === "developer" && !myProjects.length && (
              <p className="notice">You haven't been assigned any projects yet. Ask an administrator to assign you one.</p>
            )}
            <section className="stats five">
              {stats.map(({ value, label, tone }) => (
                <div className="stat" key={label}>
                  <span className={`stat-value text-${tone}`}>
                    <CountUp value={value} />
                  </span>
                  <span className="stat-label">{label}</span>
                </div>
              ))}
            </section>

            {visible.length ? (
              sections.map(({ title, items }, n) => (
                <section key={title || "all"} className="grid-section">
                  {title && (
                    <h2 className="grid-title">
                      {title} <span>{items.length}</span>
                    </h2>
                  )}
                  {/* Keyed on the filter so switching sections replays the entrance. */}
                  <div className="grid" key={filter}>
                    {items.map((s, i) => (
                      <SystemCard
                        key={s.id}
                        system={s}
                        now={now}
                        lead={users.find((u) => u.id === s.lead)}
                        developers={users.filter((u) => u.role === "developer" && u.projectIds?.includes(s.id))}
                        requests={requestsFor(s.id).length}
                        mine={isMine(s)}
                        index={n ? sections[0].items.length + i : i}
                        onSelect={(x) => setSelectedId(x.id)}
                      />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="empty">No projects match.</div>
            )}
          </>
        )}
      </main>

      <SystemDrawer
        system={selected}
        systems={systems}
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
        onChangeDevelopers={async (id, developers) => {
          await api(`/systems/${id}`, "PATCH", { developers });
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
        features={selected ? features.filter((f) => f.systemId === selected.id) : []}
        canLogFeatures={can("manage_features")}
        onOpenFeature={(feature) => setFeatureEdit({ feature })}
        onNewFeature={() => setFeatureEdit({ feature: null, systemId: selected?.id })}
      />
      {featureEdit && (
        <FeatureModal
          feature={featureEdit.feature}
          initialSystemId={featureEdit.systemId}
          systems={systems}
          users={users}
          me={me}
          now={now}
          canManage={can("manage_features")}
          onClose={() => setFeatureEdit(null)}
          onSave={async (draft) => {
            const id = featureEdit.feature?.id;
            await api(id ? `/features/${id}` : "/features", id ? "PATCH" : "POST", draft);
            await reload();
            setFeatureEdit(null);
          }}
          onDelete={async (id) => {
            await api(`/features/${id}`, "DELETE");
            await reload();
            setFeatureEdit(null);
          }}
        />
      )}
      {adding && (
        <AddSystemModal
          users={users}
          systems={systems}
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
