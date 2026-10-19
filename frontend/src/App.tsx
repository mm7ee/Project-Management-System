import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, Eye, FileText, History, LifeBuoy, Menu, Plus, Search, Settings, Sparkles, Users } from "lucide-react";
import { getSchedule, type System } from "./data/systems";
import { api, useAppData, type AppData } from "./data/api";
import { isAssigned, type Permission, type Prefs } from "./data/roles";
import { resolveTheme, useApplyPrefs } from "./prefs";
import { shareToken } from "./data/api";
import { useNow } from "./time";
import Sidebar, { type Filter, type View } from "./components/Sidebar";
import SystemCard from "./components/SystemCard";
import ProjectPage from "./components/ProjectPage";
import UpdateModal, { type ProgressUpdate } from "./components/UpdateModal";
import AddSystemModal from "./components/AddSystemModal";
import SettingsPage from "./components/SettingsPage";
import FuturisticBackdrop from "./components/FuturisticBackdrop";
import DaylightBackdrop from "./components/DaylightBackdrop";
import ForcePasswordChange from "./components/ForcePasswordChange";
import ForceMfaSetup from "./components/ForceMfaSetup";
import ExecutivePage from "./components/ExecutivePage";
import ActivityPage from "./components/ActivityPage";
import Login from "./components/Login";
import UsersPage from "./components/UsersPage";
import ReportsPage from "./components/reports/ReportsPage";
import UpdateBanner from "./components/UpdateBanner";
import FeaturesPage from "./components/FeaturesPage";
import FeatureModal from "./components/FeatureModal";
import { isLate, isOpen, type Feature } from "./data/features";
import { stalledDays, suggestDevelopers, workloadOf } from "./data/project";
import RebalanceModal from "./components/Rebalance";
import { PcnDocument } from "./components/Pcn";
import ConceptNotesPage from "./components/ConceptNotesPage";
import DashboardPage from "./components/DashboardPage";
import ProjectsPage from "./components/ProjectsPage";
import { awaitingSignature, type SignoffStatus } from "./data/pcn";
import type { User } from "./data/roles";
import AskPanel from "./components/AskPanel";
import WorkspaceBar from "./components/WorkspaceBar";

// A project page has its own address (#/projects/<id>), so it can be bookmarked, opened in a
// new tab and left with the browser's back button.
// /executive is a public showcase for leadership: totals only, no sign-in, linked from nowhere.
const isExecutive = () => /^\/executive\/?$/.test(window.location.pathname);

/** Where a view-only link keeps its display settings (this browser only). */
const VIEW_PREFS = "omnitrack:view-prefs";

const projectInHash = () => window.location.hash.match(/^#\/projects\/([a-z0-9-]+)(\/pcn)?$/)?.[1] ?? null;
// #/projects/<id>/pcn shows that project's Concept Note as a printable document.
const pcnInHash = () => /^#\/projects\/[a-z0-9-]+\/pcn$/.test(window.location.hash);

export default function App() {
  // The public showcase needs no account, so it skips sign-in entirely.
  return isExecutive() ? <ExecutivePage /> : <Tracker />;
}

function Tracker() {
  const { data, mustChange, changeFor, mfaSetup, shareError, loading, reload } = useAppData();
  return (
    <>
      {loading ? (
        <div className="splash">Loading…</div>
      ) : shareToken && !data ? (
        // A view-only link never falls through to the sign-in screen.
        <div className="share-ended">
          <Eye size={28} />
          <h1>This link no longer works</h1>
          <p>{shareError ?? "This view-only link has expired or been turned off."} Ask whoever sent it for a new one.</p>
        </div>
      ) : data ? (
        <Dashboard data={data} reload={reload} />
      ) : mustChange ? (
        <ForcePasswordChange message={mustChange} who={changeFor} onDone={reload} />
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
  // A view-only link has no account: its display choices are kept in this browser instead.
  const [prefs, setPrefs] = useState<Prefs>(() => {
    if (!data.viewOnly) return data.prefs;
    try {
      return { ...data.prefs, ...JSON.parse(localStorage.getItem(VIEW_PREFS) ?? "{}") };
    } catch {
      return data.prefs;
    }
  });
  useApplyPrefs(prefs);
  const savePrefs = async (p: Prefs) => {
    const before = prefs;
    setPrefs(p);
    if (data.viewOnly) {
      try {
        localStorage.setItem(VIEW_PREFS, JSON.stringify(p));
      } catch {
        // Not saved; it still applies for now.
      }
      return;
    }
    try {
      setPrefs(await api<Prefs>("/me/prefs", "PUT", p));
    } catch (e) {
      setPrefs(before);
      throw e;
    }
  };

  const isMine = (s: System) => isAssigned(me, s);
  const myProjects = systems.filter(isMine);

  // Sign-in opens the Dashboard, unless someone chose a Projects tab to start on.
  const [view, setView] = useState<View>(() => (prefs.start === "DASHBOARD" ? "dashboard" : "projects"));
  const [filter, setFilter] = useState<Filter>(() =>
    prefs.start === "DASHBOARD" || (prefs.start === "MINE" && !myProjects.length) ? "ALL" : (prefs.start as Filter),
  );
  const showTab = (f: Filter) => {
    setFilter(f);
    setView("projects");
  };
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  // The workspace the Projects page shows, remembered on this device.
  const [workspace, setWorkspaceState] = useState(() => {
    try {
      return localStorage.getItem("omnitrack:workspace") ?? "";
    } catch {
      return "";
    }
  });
  const setWorkspace = (v: string) => {
    setWorkspaceState(v);
    try {
      localStorage.setItem("omnitrack:workspace", v);
    } catch {
      // Only a convenience.
    }
  };
  const [selectedId, setSelectedId] = useState<string | null>(projectInHash);
  const [showPcn, setShowPcn] = useState(pcnInHash);
  useEffect(() => {
    const onHash = () => {
      setSelectedId(projectInHash());
      setShowPcn(pcnInHash());
    };
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
  // Concept Notes waiting for this person's signature.
  const pcnsToSign = systems.filter((s) => awaitingSignature(s.pcn, me.id));
  const signPcn = async (systemId: string, index: number, decision: SignoffStatus, remarks?: string) => {
    await api(`/systems/${systemId}/pcn/sign`, "POST", { index, decision, ...(remarks !== undefined ? { remarks } : {}) });
    await reload();
  };
  const [rebalancing, setRebalancing] = useState(false);
  const mayContribute = (s: System) => can("edit_any") || can("manage_systems") || s.lead === me.id || !!me.projectIds?.includes(s.id);

  // Projects in the chosen workspace (all of them when none is chosen, or it no longer exists).
  // Every project sits in a workspace; one without a known workspace counts in the first.
  const wsOf = (s: System) => (s.workspace && data.workspaces.includes(s.workspace) ? s.workspace : data.workspaces[0]);
  const wsActive = data.workspaces.includes(workspace) ? workspace : "";
  const wsSystems = useMemo(() => (wsActive ? systems.filter((s) => wsOf(s) === wsActive) : systems), [systems, wsActive, data.workspaces]);
  const wsCounts = useMemo(() => {
    const c: Record<string, number> = { "": systems.length };
    for (const s of systems) c[wsOf(s)] = (c[wsOf(s)] ?? 0) + 1;
    return c;
  }, [systems, data.workspaces]);

  const countIn = (list: System[]) => {
    const c: Record<Filter, number> = {
      ALL: list.length, LIVE: 0, COMPLETED: 0, WIP: 0, TESTING: 0, TO_DEPLOY: 0, UPCOMING: 0, IDEA: 0, OVERDUE: 0, REQUESTED: 0, MAINTENANCE: 0, MINE: 0, BLOCKED: 0,
    };
    list.forEach((s) => {
      c[s.status]++;
      if (getSchedule(s, now) === "OVERDUE") c.OVERDUE++;
      if (requests.some((r) => r.systemId === s.id)) c.REQUESTED++;
      if (s.health === "Maintenance") c.MAINTENANCE++;
      if (isMine(s)) c.MINE++;
      if (isBlocked(s)) c.BLOCKED++;
    });
    return c;
  };
  const counts = useMemo(() => countIn(systems), [systems, requests, blockers, limits, now, me]);
  // The Projects page counts only the chosen workspace.
  const pageCounts = useMemo(() => countIn(wsSystems), [wsSystems, requests, blockers, limits, now, me]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return wsSystems
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
  }, [wsSystems, requests, blockers, limits, filter, query, now, me]);

  // On "All projects", the ones assigned to you get their own section above the rest.
  const sections =
    filter === "ALL" && visible.some(isMine)
      ? [
          { title: "Assigned to you", items: visible.filter(isMine) },
          { title: "All other projects", items: visible.filter((s) => !isMine(s)) },
        ].filter((x) => x.items.length)
      : [{ title: "", items: visible }];

  const saveUpdate = async ({ id, ...update }: ProgressUpdate) => {
    await api(`/systems/${id}`, "PATCH", update);
    await reload();
    setPosting(null);
  };

  const selected = systems.find((s) => s.id === selectedId) ?? null;
  // Things waiting on this person, shown above the Dashboard and the Projects page.
  const banners = (
    <>
            {can("manage_users") && data.mfaHelp.length > 0 && (
              <div className="pcn-banner mfa-help-banner" role="status">
                <LifeBuoy size={18} />
                <span>
                  <b>
                    {data.mfaHelp.length === 1
                      ? `${data.mfaHelp[0].name} can't complete two-step verification`
                      : `${data.mfaHelp.length} people can't complete two-step verification`}
                  </b>{" "}
                  Confirm it's really them, then reset it.
                </span>
                <button className="btn btn-navy sm" onClick={() => setView("users")}>
                  Review
                </button>
              </div>
            )}
            {pcnsToSign.length > 0 && (
              <div className="pcn-banner" role="status">
                <FileText size={18} />
                <span>
                  <b>
                    {pcnsToSign.length === 1
                      ? `"${pcnsToSign[0].pcn!.title}" is waiting for your signature`
                      : `${pcnsToSign.length} Concept Notes are waiting for your signature`}
                  </b>{" "}
                  Read the PCN, then approve or decline it.
                </span>
                <button className="btn btn-navy sm" onClick={() => setView("pcns")}>
                  Review
                </button>
              </div>
            )}
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
    </>
  );

  return (
    <div className="shell">
      {resolveTheme(prefs.theme) === "futuristic" ? <FuturisticBackdrop /> : <DaylightBackdrop />}
      <Sidebar
        me={me}
        view={selectedId ? "project" : view}
        counts={counts}
        pcnsToSign={pcnsToSign.length}
        features={{
          count: featureBadge.length,
          urgent: featureBadge.some((f) => f.priority === "CRITICAL" || isLate(f, now)),
        }}
        open={menuOpen}
        canAdd={can("manage_systems")}
        canPropose={can("propose_projects")}
        canReports={can("reports")}
        canUsers={can("manage_users")}
        canActivity={can("audit_log")}
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
        viewOnly={data.viewOnly}
      />

      <main className="main">
        <header className="topbar no-print">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <h1>Projects Tracker</h1>
          {(view === "projects" || view === "dashboard") && !selectedId && (
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
          <button className="ask-btn" onClick={() => setAsking(true)} title="Ask a question about projects, people and deadlines">
            <Sparkles size={17} /> <span>Ask OmniTrack</span>
          </button>
        </header>
        {data.viewOnly && (
          <div className="view-only-banner no-print" role="status">
            <Eye size={17} />
            <span>
              <b>View only</b> · {data.viewOnly.label}. You're seeing OmniTrack live and can request updates on any project; nothing else can be changed. Link expires{" "}
              {new Date(data.viewOnly.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
            </span>
          </div>
        )}
        <AskPanel
          open={asking}
          onClose={() => setAsking(false)}
          systems={systems}
          users={users}
          features={features}
          me={me}
          developer={me.role === "developer" && !can("manage_features")}
          onOpenProject={openProject}
        />

        {selectedId ? (
          selected && showPcn && selected.pcn ? (
            <PcnDocument system={{ ...selected, pcn: selected.pcn }} onBack={() => openProject(selected.id)} />
          ) : selected ? (
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
              canLogFeatures={can("manage_features") || can("log_features")}
              onBack={closeProject}
              onUpdate={() => setPosting({ initialId: selected.id })}
              workspaces={data.workspaces}
              onChangeWorkspace={async (id, ws) => {
                await api(`/systems/${id}`, "PATCH", { workspace: ws });
                await reload();
              }}
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
              canEditPcn={can("manage_systems") || selected.pcnBy === me.id}
              onSignPcn={(index, decision, remarks) => signPcn(selected.id, index, decision, remarks)}
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
          <>
          {(can("audit_log") || can("manage_users")) && <SettingsTabs active="settings" onChange={setView} canUsers={can("manage_users")} canActivity={can("audit_log")} />}
          <SettingsPage
            me={me}
            prefs={prefs}
            permissions={data.permissions}
            projects={myProjects}
            mfaRequired={data.mfaPolicy.roles.includes(me.role)}
            recoveryCodesLeft={data.recoveryCodesLeft}
            twoStep={data.twoStep}
            viewOnly={data.viewOnly}
            onPrefs={savePrefs}
            onProfileSaved={reload}
            onSignedOut={reload}
          />
          </>
        ) : view === "pcns" ? (
          <ConceptNotesPage
            systems={systems}
            me={me}
            canRecord={can("manage_systems")}
            canPropose={can("propose_projects") || can("manage_systems")}
            onSign={signPcn}
            onPropose={() => {
              setAddError("");
              setAdding(true);
            }}
          />
        ) : view === "features" ? (
          <FeaturesPage
            features={features}
            workspaces={data.workspaces}
            systems={systems}
            users={users}
            me={me}
            now={now}
            canManage={can("manage_features") || can("log_features")}
            ownOnly={me.role === "developer" && !can("manage_features")}
            onOpen={(feature) => setFeatureEdit({ feature })}
            onNew={() => setFeatureEdit({ feature: null })}
          />
        ) : view === "activity" && can("audit_log") ? (
          <>
            <SettingsTabs active="activity" onChange={setView} canUsers={can("manage_users")} canActivity={can("audit_log")} />
            <ActivityPage users={users} systems={systems} now={now} />
          </>
        ) : view === "users" && can("manage_users") ? (
          <>
          <SettingsTabs active="users" onChange={setView} canUsers={can("manage_users")} canActivity={can("audit_log")} />
          <UsersPage
            me={me}
            users={users}
            systems={systems}
            roleMatrix={data.roleMatrix}
            limits={limits}
            mfaPolicy={data.mfaPolicy}
            mfaHelp={data.mfaHelp}
            workload={(u) => workloadOf(u, systems, features, limits, now)}
            onChanged={reload}
          />
          </>
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
        ) : view === "dashboard" ? (
          <>
            {banners}
            <DashboardPage
              me={me}
              systems={systems}
              users={users}
              requests={requests}
              features={features}
              blockers={blockers}
              documents={documents}
              limits={limits}
              now={now}
              isMine={isMine}
              onOpen={openProject}
              onTab={showTab}
            />
          </>
        ) : (
          <ProjectsPage
            counts={pageCounts}
            workspaceBar={
              <WorkspaceBar
                workspaces={data.workspaces}
                counts={wsCounts}
                value={wsActive}
                onChange={setWorkspace}
                canEdit={can("manage_systems")}
                onSave={async (list) => {
                  await api("/settings/workspaces", "PUT", { workspaces: list });
                  await reload();
                }}
              />
            }
            filter={filter}
            onFilter={setFilter}
            mode={prefs.projectsView}
            onMode={(projectsView) => savePrefs({ ...prefs, projectsView }).catch(() => undefined)}
            sections={sections}
            now={now}
            banners={banners}
            onOpen={openProject}
            info={(s) => ({
              lead: users.find((u) => u.id === s.lead),
              developers: users.filter((u) => u.role === "developer" && u.projectIds?.includes(s.id)),
              requests: requestsFor(s.id).length,
              blockers: openBlockersFor(s.id).map((b) => b.text),
              stalled: stalledDays(s, now, limits),
              mine: isMine(s),
            })}
            card={(s, index) => (
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
                index={index}
                onSelect={(x) => openProject(x.id)}
              />
            )}
          />
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
          canLog={can("log_features")}
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
          workspaces={data.workspaces}
          initialWorkspace={wsActive}
          users={users}
          systems={systems}
          limit={limits.projects}
          templates={data.templates}
          me={me}
          proposeOnly={!can("manage_systems")}
          error={addError}
          onDeleteTemplate={async (id) => {
            try {
              await api(`/templates/${id}`, "DELETE");
              await reload();
            } catch (e) {
              setAddError(e instanceof Error ? e.message : "Couldn't delete the template");
            }
          }}
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

/** Tabs at the top of Settings: your own settings, then the admin pages each person may open. */
function SettingsTabs({
  active,
  onChange,
  canUsers,
  canActivity,
}: {
  active: "settings" | "users" | "activity";
  onChange: (v: View) => void;
  canUsers: boolean;
  canActivity: boolean;
}) {
  const tabs = [
    { key: "settings" as const, label: "My settings", icon: Settings, show: true },
    { key: "users" as const, label: "Users & roles", icon: Users, show: canUsers },
    { key: "activity" as const, label: "Activity log", icon: History, show: canActivity },
  ].filter((t) => t.show);
  return (
    <div className="view-toggle settings-tabs no-print" role="tablist" aria-label="Settings">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button key={key} role="tab" aria-selected={active === key} className={active === key ? "on" : ""} onClick={() => onChange(key)}>
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  );
}
