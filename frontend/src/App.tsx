import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, Menu, Plus, Search } from "lucide-react";
import { getSchedule, type System } from "./data/systems";
import { api, useAppData, type AppData } from "./data/api";
import { isAssigned, type Permission, type Prefs } from "./data/roles";
import { useApplyPrefs } from "./prefs";
import { useNow } from "./time";
import Sidebar, { type Filter, type View } from "./components/Sidebar";
import SystemCard from "./components/SystemCard";
import ProjectPage from "./components/ProjectPage";
import UpdateModal, { type ProgressUpdate } from "./components/UpdateModal";
import AddSystemModal from "./components/AddSystemModal";
import SettingsPage from "./components/SettingsPage";
import FuturisticBackdrop from "./components/FuturisticBackdrop";
import ForcePasswordChange from "./components/ForcePasswordChange";
import ForceMfaSetup from "./components/ForceMfaSetup";
import ExecutivePage from "./components/ExecutivePage";
import ActivityPage from "./components/ActivityPage";
import Login from "./components/Login";
import UsersPage from "./components/UsersPage";
import ReportsPage from "./components/reports/ReportsPage";
import UpdateBanner from "./components/UpdateBanner";
import CountUp from "./components/CountUp";
import FeaturesPage from "./components/FeaturesPage";
import FeatureModal from "./components/FeatureModal";
import { isLate, isOpen, type Feature } from "./data/features";
import { stalledDays, suggestDevelopers, workloadOf } from "./data/project";
import RebalanceModal from "./components/Rebalance";
import type { User } from "./data/roles";

// A project page has its own address (#/projects/<id>), so it can be bookmarked, opened in a
// new tab and left with the browser's back button.
// /executive is a public showcase for leadership: totals only, no sign-in, linked from nowhere.
const isExecutive = () => /^\/executive\/?$/.test(window.location.pathname);

const projectInHash = () => window.location.hash.match(/^#\/projects\/([a-z0-9-]+)$/)?.[1] ?? null;

export default function App() {
  // The public showcase needs no account, so it skips sign-in entirely.
  return isExecutive() ? <ExecutivePage /> : <Tracker />;
}

function Tracker() {
  const { data, mustChange, mfaSetup, loading, reload } = useAppData();
  return (
    <>
      {loading ? (
        <div className="splash">Loading…</div>
      ) : data ? (
        <Dashboard data={data} reload={reload} />
      ) : mustChange ? (
        <ForcePasswordChange message={mustChange} onDone={reload} />
      ) : mfaSetup ? (
        <ForceMfaSetup message={mfaSetup} onDone={reload} />
      ) : (
        <Login onSignedIn={reload} />
      )}
      <UpdateBanner />
    </>
  );
}

function Dashboard({ data, reload }: { data: AppData; reload: () => Promise<void> }) {
  const now = useNow();
  const { me, systems, users, requests, features, documents, blockers, limits } = data;
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
  const [selectedId, setSelectedId] = useState<string | null>(projectInHash);
  useEffect(() => {
    const onHash = () => setSelectedId(projectInHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const openProject = (id: string) => {
    window.location.hash = `/projects/${id}`;
  };
  const closeProject = () => {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    setSelectedId(null);
  };
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
  const openBlockersFor = (id: string) => blockers.filter((b) => b.systemId === id && !b.resolvedAt);
  const isBlocked = (s: System) => openBlockersFor(s.id).length > 0 || stalledDays(s, now, limits) !== null;
  // Why a developer has too much on; empty when they don't.
  const overloaded = (u: User) => (u.role === "developer" ? workloadOf(u, systems, features, limits, now).reasons : []);
  // Admins and managers can add and remove developers, and are told when someone has too much on.
  const canAssign = can("manage_systems") || can("assign_developers");
  const overloadedDevs = users.filter((u) => overloaded(u).length > 0);
  const [rebalancing, setRebalancing] = useState(false);
  const mayContribute = (s: System) => can("edit_any") || can("manage_systems") || s.lead === me.id || !!me.projectIds?.includes(s.id);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      ALL: systems.length, LIVE: 0, COMPLETED: 0, WIP: 0, TESTING: 0, TO_DEPLOY: 0, UPCOMING: 0, IDEA: 0, OVERDUE: 0, REQUESTED: 0, MAINTENANCE: 0, MINE: 0, BLOCKED: 0,
    };
    systems.forEach((s) => {
      c[s.status]++;
      if (getSchedule(s, now) === "OVERDUE") c.OVERDUE++;
      if (requests.some((r) => r.systemId === s.id)) c.REQUESTED++;
      if (s.health === "Maintenance") c.MAINTENANCE++;
      if (isMine(s)) c.MINE++;
      if (isBlocked(s)) c.BLOCKED++;
    });
    return c;
  }, [systems, requests, blockers, limits, now, me]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return systems
      .filter((s) =>
        filter === "ALL"
          ? true
          : filter === "MINE"
            ? isMine(s)
            : filter === "BLOCKED"
            ? isBlocked(s)
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
  }, [systems, requests, blockers, limits, filter, query, now, me]);

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
    { value: counts.BLOCKED, label: "Blocked / stalled", tone: "amber" },
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
        view={selectedId ? "project" : view}
        counts={counts}
        features={{
          count: featureBadge.length,
          urgent: featureBadge.some((f) => f.priority === "CRITICAL" || isLate(f, now)),
        }}
        open={menuOpen}
        canAdd={can("manage_systems")}
        canLogFeature={can("manage_features") && systems.length > 0}
        onLogFeature={() => setFeatureEdit({ feature: null, systemId: selectedId ?? undefined })}
        canReports={can("reports")}
        canUsers={can("manage_users")}
        canActivity={can("audit_log")}
        onFilter={(f) => {
          setFilter(f);
          if (selectedId) closeProject();
        }}
        onView={(v) => {
          setView(v);
          if (selectedId) closeProject();
        }}
        onClose={() => setMenuOpen(false)}
        onAdd={() => {
          setAddError("");
          setAdding(true);
        }}
        onAccount={() => {
          setView("settings");
          if (selectedId) closeProject();
        }}
        theme={prefs.theme}
        onTheme={(theme) => savePrefs({ ...prefs, theme }).catch(() => undefined)}
      />

      <main className="main">
        <header className="topbar no-print">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <h1>Projects Tracker</h1>
          {view === "projects" && !selectedId && (
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

        {selectedId ? (
          selected ? (
            <ProjectPage
              system={selected}
              systems={systems}
              now={now}
              me={me}
              users={users}
              requests={requestsFor(selected.id)}
              features={features.filter((f) => f.systemId === selected.id)}
              documents={documents.filter((d) => d.systemId === selected.id)}
              blockers={blockers.filter((b) => b.systemId === selected.id)}
              limits={limits}
              overloaded={overloaded}
              canUpdate={mayUpdate(selected)}
              canManage={can("manage_systems")}
              canAssign={canAssign}
              suggestions={suggestDevelopers(users, systems, features, limits, now, selected.id)}
              canRequest={can("request_updates")}
              canContribute={mayContribute(selected)}
              canLogFeatures={can("manage_features")}
              onBack={closeProject}
              onUpdate={() => setPosting({ initialId: selected.id })}
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
                closeProject();
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
              onOpenFeature={(feature) => setFeatureEdit({ feature })}
              onNewFeature={() => setFeatureEdit({ feature: null, systemId: selected.id })}
              onChanged={reload}
            />
          ) : (
            <div className="empty">
              That project doesn't exist any more.{" "}
              <button className="link-btn" onClick={closeProject}>
                Back to all projects
              </button>
            </div>
          )
        ) : view === "settings" ? (
          <SettingsPage
            me={me}
            prefs={prefs}
            permissions={data.permissions}
            projects={myProjects}
            mfaRequired={data.mfaPolicy.roles.includes(me.role)}
            recoveryCodesLeft={data.recoveryCodesLeft}
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
          <UsersPage
            me={me}
            users={users}
            systems={systems}
            roleMatrix={data.roleMatrix}
            limits={limits}
            mfaPolicy={data.mfaPolicy}
            workload={(u) => workloadOf(u, systems, features, limits, now)}
            onChanged={reload}
          />
        ) : view === "reports" && can("reports") ? (
          <ReportsPage
            systems={systems}
            users={users}
            requests={requests}
            features={features}
            blockers={blockers}
            limits={limits}
            now={now}
          />
        ) : (
          <>
            {canAssign && overloadedDevs.length > 0 && (
              <div className="overload-banner" role="status">
                <AlertOctagon size={18} />
                <span>
                  <b>
                    {overloadedDevs.length === 1
                      ? `${overloadedDevs[0].name} has too many projects`
                      : `${overloadedDevs.length} developers have too many projects`}
                  </b>{" "}
                  (
                  {overloadedDevs.length === 1
                    ? overloaded(overloadedDevs[0]).join(", ")
                    : overloadedDevs.map((u) => `${u.name}: ${overloaded(u).join(", ")}`).join("; ")}
                  ). Others have room to help.
                </span>
                <button className="btn btn-navy sm" onClick={() => setRebalancing(true)}>
                  Rebalance
                </button>
              </div>
            )}
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
                        blockers={openBlockersFor(s.id).map((b) => b.text)}
                        stalled={stalledDays(s, now, limits)}
                        index={n ? sections[0].items.length + i : i}
                        onSelect={(x) => openProject(x.id)}
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

      {featureEdit && (
        <FeatureModal
          feature={featureEdit.feature}
          initialSystemId={featureEdit.systemId}
          systems={systems}
          users={users}
          me={me}
          now={now}
          overloaded={overloaded}
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
          limit={limits.projects}
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
      {rebalancing && (
        <RebalanceModal
          users={users}
          systems={systems}
          features={features}
          limits={limits}
          now={now}
          onSave={async (id, developers) => {
            await api(`/systems/${id}`, "PATCH", { developers });
            await reload();
          }}
          onClose={() => setRebalancing(false)}
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
