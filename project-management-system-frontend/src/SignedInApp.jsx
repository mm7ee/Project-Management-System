// The signed-in app: the shell around every page once someone is in (sidebar, top bar, pages, settings). Loaded on
// demand (App.jsx), so the sign-in page and the platform page don't wait for it.
/** @import { Pcn } from './data/pcn' */
/** @import { System } from './data/systems' */
/** @import { AppData } from './data/api' */
/** @import { Permission, Prefs } from './data/roles' */
/** @import { Filter, View } from './components/Sidebar' */
/** @import { ProgressUpdate } from './components/UpdateModal' */
/** @import { RequestDelivery } from './data/updateRequests' */
/** @import { Feature } from './data/features' */
/** @import { SignoffStatus } from './data/pcn' */
/** @import { User } from './data/roles' */
import { BRAND } from "./data/brand";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, Palette, ArrowLeft, Building2, Eye, FileText, Fingerprint, Gauge, History, LifeBuoy, Link2, LockKeyhole, Menu, Zap, Plug, BellRing, Lock, ListPlus, Headset, Layers, LayoutTemplate, Plus, ScrollText, Shapes, Timer, Search, Send, ShieldCheck, Sparkles, Users, Workflow, Milestone } from "lucide-react";
import { getSchedule } from "./data/systems";
import { api } from "./data/api";
import { isAssigned } from "./data/roles";
import { resolveTheme, useApplyPrefs } from "./prefs";
import ParticleField from "./components/ParticleField";
import { useNow } from "./time";
import { depth as sharedDepth, setDepthListener } from "./history";
import Sidebar from "./components/Sidebar";
import SystemCard from "./components/SystemCard";
import ProjectPage from "./components/ProjectPage";
import UpdateModal from "./components/UpdateModal";
import AddSystemModal from "./components/AddSystemModal";
import SettingsPage from "./components/SettingsPage";
import { DeliverySection } from "./components/NotificationSettings";
import ReportsHub from "./components/reports/ReportsHub";
import ActivityPage from "./components/ActivityPage";
import UsersPage from "./components/UsersPage";
import FeaturesPage from "./components/FeaturesPage";
import FeatureModal from "./components/FeatureModal";
import { isLate, isOpen } from "./data/features";
import { stalledDays, suggestDevelopers, workloadOf } from "./data/project";
import { needsAttention } from "./data/projectHealth";
import RebalanceModal from "./components/Rebalance";
import { PcnDocument } from "./components/Pcn";
import ConceptNotesPage from "./components/ConceptNotesPage";
import DashboardPage from "./components/DashboardPage";
import ProjectsPage from "./components/ProjectsPage";
import BoardsPage from "./components/BoardsPage";
import PipelinePage from "./components/PipelinePage";
import LifecycleSettings from "./components/LifecycleSettings";
import SearchPage from "./components/SearchPage";
import CustomDashboards from "./components/CustomDashboards";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import OrgAdmin from "./components/OrgAdmin";
import { setOpenWorkspace } from "./data/tenant";
import AutomationSettings from "./components/AutomationSettings";
import ServiceDeskPage from "./components/ServiceDeskPage";
import ChatPage, { useChatUnread } from "./components/ChatPage";
import ServiceDeskSettings from "./components/ServiceDeskSettings";
import { CustomFieldsSection, IntegrationsSection, NotificationSchemesSection, SecurityLevelsSection } from "./components/AdminSettings";
import WorkflowsSettings from "./components/WorkflowsSettings";
import ItemTypesSettings from "./components/ItemTypesSettings";
import SlaSettings from "./components/SlaSettings";
import { awaitingSignature } from "./data/pcn";
import { mfaRequiredFor } from "./data/roles";
import AskPanel from "./components/AskPanel";
import { applyBranding, setTitle } from "./brandTheme";
import OrgMark, { pageSurface } from "./components/OrgMark";
import VitalSign from "./components/VitalSign";
import WorkspaceBar from "./components/WorkspaceBar";
import NotificationBell from "./components/NotificationBell";
// A project page has its own address (#/projects/<id>), so it can be bookmarked, opened in a
// new tab and left with the browser's back button.
/**
 * "Good morning" and so on, by the visitor's own clock.
 * @returns {"Good morning" | "Good afternoon" | "Good evening"}
 */
const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};
/**
 * Where a view-only link keeps its display settings (this browser only).
 * @type {"pms:view-prefs"}
 */
const VIEW_PREFS = "pms:view-prefs";
// #/projects/<id>/items is its Work items tab; #/projects/<id>/items/<KEY-n> one work item.
const PROJECT_ROUTE = /^#\/projects\/([a-z0-9-]+)(?:\/(pcn|items|board|backlog|timeline|lifecycle|docs)(?:\/([A-Z]{2,10}-\d{1,7}|[a-z_]{2,30}(?:-\d{1,4})?))?)?\/?$/;
/**
 * @returns {string | null}
 */
const projectInHash = () => window.location.hash.match(PROJECT_ROUTE)?.[1] ?? null;
/**
 * @returns {boolean}
 */
const itemsInHash = () => window.location.hash.match(PROJECT_ROUTE)?.[2] === "items";
/**
 * @returns {boolean}
 */
const boardInHash = () => window.location.hash.match(PROJECT_ROUTE)?.[2] === "board";
/**
 * @returns {string | undefined}
 */
const tabInHash = () => window.location.hash.match(PROJECT_ROUTE)?.[2];
/**
 * @returns {string | undefined}
 */
const itemKeyInHash = () => window.location.hash.match(PROJECT_ROUTE)?.[3] ?? undefined;
// #/projects/<id>/pcn shows that project's Concept Note as a printable document.
/**
 * @returns {boolean}
 */
const pcnInHash = () => /^#\/projects\/[a-z0-9-]+\/pcn$/.test(window.location.hash);
// #/chat/<id> opens a conversation (links in chat notifications).
/**
 * @returns {boolean}
 */
const reportsInHash = () => window.location.hash.startsWith("#/reports");
/**
 * @returns {string | null}
 */
const chatInHash = () => window.location.hash.match(/^#\/chat\/([A-Za-z0-9_-]{4,80})$/)?.[1] ?? null;
/**
 * @param {{ data: AppData; reload: () => Promise<void> }} props
 */
export default function Dashboard({ data, reload }) {
  // Before anything reads browser storage: what is remembered inside a workspace is kept per workspace.
  setOpenWorkspace(data.tenant?.workspace?.id ?? "", data.tenant?.organization?.name ?? "");
  // State C: inside an organisation, its branding (accent tokens, favicon) and its name in the tab title.
  const branding = data.tenant?.organization?.branding ?? null;
  const brandingKey = JSON.stringify(branding);
  useEffect(() => {
    applyBranding(branding);
    setTitle(branding?.name ?? data.tenant?.organization?.name ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandingKey]);
  const now = useNow();
  const { me, systems, users, requests, features, documents, blockers, limits } = data;
  const can = /** @param {Permission} p */ (p) => data.permissions.includes(p);
  // Preferences apply instantly and save in the background.
  // A view-only link has no account: its display choices are kept in this browser instead.
  const [prefs, setPrefs] = useState(
    /** @type {Prefs | (() => Prefs)} */ (
      () => {
        if (!data.viewOnly) return data.prefs;
        try {
          return { ...data.prefs, ...JSON.parse(localStorage.getItem(VIEW_PREFS) ?? "{}") };
        } catch {
          return data.prefs;
        }
      }
    ),
  );
  useApplyPrefs(prefs);
  const savePrefs = /** @param {Prefs} p */ async (p) => {
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
      setPrefs(await /** @type {Promise<Prefs>} */ (/** @type {unknown} */ (api("/me/prefs", "PUT", p))));
    } catch (e) {
      setPrefs(before);
      throw e;
    }
  };
  const isMine = /** @param {System} s */ (s) => isAssigned(me, s);
  const myProjects = systems.filter(isMine);
  // Sign-in opens the Dashboard, unless someone chose a Projects tab to start on.
  const [signOutJump, setSignOutJump] = useState(0);
  const [view, setView] = useState(/** @type {View | (() => View)} */ (() => (chatInHash() ? "chat" : reportsInHash() ? "reports" : prefs.start === "DASHBOARD" ? "dashboard" : "projects")));
  // Chat: the conversation a link asked for, and the unread count beside "Chat" in the sidebar.
  const [chatOpen, setChatOpen] = useState(/** @type {string | null | (() => string | null)} */ (chatInHash));
  const [chatUnread, setChatUnread] = useChatUnread(!data.viewOnly);
  // A search opened from somewhere else (Ask AI): the query, and a counter so the same one reruns.
  const [searchFor, setSearchFor] = useState(/** @type {{ pql: string; n: number } | null | (() => { pql: string; n: number } | null)} */ (null));
  const [filter, setFilter] = useState(/** @type {Filter | (() => Filter)} */ (() => (prefs.start === "DASHBOARD" || (prefs.start === "MINE" && !myProjects.length) ? "ALL" : /** @type {Filter} */ (prefs.start))));
  const showTab = /** @param {Filter} f */ (f) => {
    setFilter(f);
    setView("projects");
  };
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  // The workspace the Projects page shows, remembered on this device.
  const [workspace, setWorkspaceState] = useState(() => {
    try {
      return localStorage.getItem("pms:workspace") ?? "";
    } catch {
      return "";
    }
  });
  const setWorkspace = /** @param {string} v */ (v) => {
    setWorkspaceState(v);
    try {
      localStorage.setItem("pms:workspace", v);
    } catch {
      // Only a convenience.
    }
  };
  const [selectedId, setSelectedId] = useState(/** @type {string | null | (() => string | null)} */ (projectInHash));
  const [showPcn, setShowPcn] = useState(pcnInHash);
  const [showItems, setShowItems] = useState(itemsInHash);
  const [showBoard, setShowBoard] = useState(boardInHash);
  const [projectTab, setProjectTab] = useState(tabInHash);
  const [itemKey, setItemKey] = useState(itemKeyInHash);
  useEffect(() => {
    const onHash = () => {
      setSelectedId(projectInHash());
      setShowPcn(pcnInHash());
      setShowItems(itemsInHash());
      setShowBoard(boardInHash());
      setProjectTab(tabInHash());
      setItemKey(itemKeyInHash());
      if (reportsInHash()) setView("reports");
      const chat = chatInHash();
      if (chat) {
        setChatOpen(chat);
        setView("chat");
        // Forget the address, so the same link works again later.
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const openProject = /** @param {string} id */ (id) => {
    window.location.hash = `/projects/${id}`;
  };
  // ---------- Back and forward ----------
  // Every screen is a browser history entry carrying { view, filter, depth }, so the browser's Back and
  // Forward (and a phone's back gesture) move between the system's pages, and the ← in the top bar does the same.
  // Projects keep their address (#/projects/…); the entry for one also remembers the page underneath.
  // `depth` counts the steps since PMS opened, so the ← only shows when there's somewhere to go back to.
  const viewRef = useRef(view);
  const filterRef = useRef(filter);
  const depthRef = sharedDepth; // shared with tab switches inside pages (history.js)
  const fromHistory = useRef(false);
  const leftProjectAt = useRef(0);
  viewRef.current = view;
  filterRef.current = filter;
  const [canGoBack, setCanGoBack] = useState(false);
  /** @param {number} depth @param {boolean} [keepTabs] keep the tabs this entry remembers (same screen, e.g. after a reload) */
  const stamp = (depth, keepTabs = false) => {
    const s = window.history.state ?? {};
    return { ...s, pms: { view: viewRef.current, filter: filterRef.current, depth, ...(keepTabs && s.pms?.tabs ? { tabs: s.pms.tabs } : {}) } };
  };
  useEffect(() => {
    // The first screen: whatever was there before PMS (a link, a bookmark) stays out of reach of the ←.
    depthRef.current = Number(window.history.state?.pms?.depth ?? 0);
    window.history.replaceState(stamp(depthRef.current, true), "");
    setCanGoBack(depthRef.current > 0);
    setDepthListener(setCanGoBack);
    const onPop = /** @param {PopStateEvent} e */ (e) => {
      const s = e.state?.pms;
      if (!s) return;
      depthRef.current = Number(s.depth ?? 0);
      setCanGoBack(depthRef.current > 0);
      if (s.view !== viewRef.current || s.filter !== filterRef.current) {
        fromHistory.current = true;
        setView(s.view);
        setFilter(s.filter);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // A new page or Projects tab becomes an entry, unless Back or Forward brought us here.
  useEffect(() => {
    if (fromHistory.current) {
      fromHistory.current = false;
      return;
    }
    const s = window.history.state?.pms;
    if (s && s.view === view && s.filter === filter) return;
    // Leaving a project for another page: that page takes over the entry made for leaving it.
    if (Date.now() - leftProjectAt.current < 400) {
      window.history.replaceState(stamp(depthRef.current), "");
      return;
    }
    depthRef.current += 1;
    window.history.pushState(stamp(depthRef.current), "");
    setCanGoBack(true);
  }, [view, filter]);
  // Opening a project (or moving within one) changes the address: give that entry a screen and a depth too.
  useEffect(() => {
    const onHash = () => {
      if (window.history.state?.pms) return; // an entry we already know (Back or Forward)
      depthRef.current += 1;
      window.history.replaceState(stamp(depthRef.current), "");
      setCanGoBack(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const closeProject = () => {
    depthRef.current += 1;
    leftProjectAt.current = Date.now();
    window.history.pushState(stamp(depthRef.current), "", window.location.pathname + window.location.search);
    setCanGoBack(true);
    setSelectedId(null);
  };
  const [posting, setPosting] = useState(/** @type {{ initialId?: string } | null | (() => { initialId?: string } | null)} */ (null));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // The feature request open in the editor: an existing one, or a new one (feature null).
  const [featureEdit, setFeatureEdit] = useState(/** @type {{ feature: Feature | null; systemId?: string } | null | (() => { feature: Feature | null; systemId?: string } | null)} */ (null));
  // The sidebar counts your own open feature requests; managers without any see every open one.
  const openFeatures = features.filter(isOpen);
  const myOpenFeatures = openFeatures.filter((f) => f.assignee === me.id);
  const featureBadge = myOpenFeatures.length ? myOpenFeatures : can("manage_features") ? openFeatures : [];
  // The projects this user may post progress for.
  const editable = can("edit_any") || can("manage_systems") ? systems : can("edit_assigned") ? systems.filter((s) => me.projectIds?.includes(s.id)) : [];
  const mayUpdate = /** @param {System} s */ (s) => editable.some((e) => e.id === s.id);
  const requestsFor = /** @param {string} id */ (id) => requests.filter((r) => r.systemId === id);
  const openBlockersFor = /** @param {string} id */ (id) => blockers.filter((b) => b.systemId === id && !b.resolvedAt);
  const isBlocked = /** @param {System} s */ (s) => openBlockersFor(s.id).length > 0 || stalledDays(s, now, limits) !== null;
  // Needing attention, the same way the Dashboard counts it: blocked, stalled, overdue or at risk.
  const attention = systems.filter((s) => needsAttention(s, openBlockersFor(s.id).length > 0, now, limits));
  // Why a developer has too much on; empty when they don't.
  const overloaded = /** @param {User} u */ (u) => (u.role === "developer" ? workloadOf(u, systems, features, limits, now).reasons : []);
  // Admins and managers can add and remove developers, and are told when someone has too much on.
  const canAssign = can("manage_systems") || can("assign_developers");
  const overloadedDevs = users.filter((u) => overloaded(u).length > 0);
  // Concept Notes waiting for this person's signature.
  const pcnsToSign = systems.filter((s) => awaitingSignature(s.pcn, me.id));
  const signPcn = /** @param {string} systemId @param {number} index @param {SignoffStatus} decision @param {string} [remarks] */ async (systemId, index, decision, remarks) => {
    await api(`/systems/${systemId}/pcn/sign`, "POST", { index, decision, ...(remarks !== undefined ? { remarks } : {}) });
    await reload();
  };
  const [rebalancing, setRebalancing] = useState(false);
  const mayContribute = /** @param {System} s */ (s) => can("edit_any") || can("manage_systems") || s.lead === me.id || !!me.projectIds?.includes(s.id);
  // Projects in the chosen workspace (all of them when none is chosen, or it no longer exists).
  // Every project sits in a workspace; one without a known workspace counts in the first.
  const wsOf = /** @param {System} s */ (s) => (s.workspace && data.workspaces.includes(s.workspace) ? s.workspace : data.workspaces[0]);
  const wsActive = data.workspaces.includes(workspace) ? workspace : "";
  const wsSystems = useMemo(() => (wsActive ? systems.filter((s) => wsOf(s) === wsActive) : systems), [systems, wsActive, data.workspaces]);
  const wsCounts = useMemo(() => {
    /** @type {Record<string, number>} */ const c = { "": systems.length };
    for (const s of systems) c[wsOf(s)] = (c[wsOf(s)] ?? 0) + 1;
    return c;
  }, [systems, data.workspaces]);
  const countIn = /** @param {System[]} list */ (list) => {
    /** @type {Record<Filter, number>} */ const c = {
      ALL: list.length,
      LIVE: 0,
      COMPLETED: 0,
      WIP: 0,
      TESTING: 0,
      TO_DEPLOY: 0,
      UPCOMING: 0,
      IDEA: 0,
      OVERDUE: 0,
      REQUESTED: 0,
      MAINTENANCE: 0,
      MINE: 0,
      BLOCKED: 0,
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
    return (
      wsSystems
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
        // Name, short code, description, owning team or lead.
        .filter((s) => !q || [s.name, s.short, s.description, s.owner, users.find((u) => u.id === s.lead)?.name].some((t) => (t ?? "").toLowerCase().includes(q)))
        // Your own projects come first.
        .sort((a, b) => Number(isMine(b)) - Number(isMine(a)))
    );
  }, [wsSystems, requests, blockers, limits, filter, query, now, me, users]);
  // On "All projects", the ones assigned to you get their own section above the rest.
  const sections =
    filter === "ALL" && visible.some(isMine)
      ? [
          { title: "Assigned to you", items: visible.filter(isMine) },
          { title: "All other projects", items: visible.filter((s) => !isMine(s)) },
        ].filter((x) => x.items.length)
      : [{ title: "", items: visible }];
  const saveUpdate = /** @param {ProgressUpdate} arg0 */ async ({ id, ...update }) => {
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
            <b>{data.mfaHelp.length === 1 ? `${data.mfaHelp[0].name} can't complete two-step verification` : `${data.mfaHelp.length} people can't complete two-step verification`}</b> Confirm it's really them, then reset it.
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
            <b>{pcnsToSign.length === 1 ? `"${/** @type {Pcn} */ (pcnsToSign[0].pcn).title}" is waiting for your signature` : `${pcnsToSign.length} Concept Notes are waiting for your signature`}</b> Read the PCN, then approve or decline it.
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
            <b>{overloadedDevs.length === 1 ? `${overloadedDevs[0].name} has too many projects` : `${overloadedDevs.length} developers have too many projects`}</b> (
            {overloadedDevs.length === 1 ? overloaded(overloadedDevs[0]).join(", ") : overloadedDevs.map((u) => `${u.name}: ${overloaded(u).join(", ")}`).join("; ")}
            ). Others have room to help.
          </span>
          <button className="btn btn-navy sm" onClick={() => setRebalancing(true)}>
            Rebalance
          </button>
        </div>
      )}
      {me.role === "developer" && !myProjects.length && <p className="notice">You haven't been assigned any projects yet. Ask an administrator to assign you one.</p>}
    </>
  );
  // Shared by the administration pages that come from the old Users & roles page.
  const usersPageProps = {
    me,
    users,
    systems,
    roleMatrix: data.roleMatrix,
    limits,
    mfaPolicy: data.mfaPolicy,
    mfaHelp: data.mfaHelp,
    signinRules: data.signinRules,
    workload: /** @param {User} u */ (u) => workloadOf(u, systems, features, limits, now),
    onChanged: reload,
  };
  return (
    <div className="shell">
      {/* The drifting web behind the pages. Keyed on motion and theme: the canvas decides once how to draw. */}
      <ParticleField key={prefs.motion + resolveTheme(prefs.theme)} className="app-web no-print" palette={resolveTheme(prefs.theme) === "futuristic" ? "appDark" : "appLight"} />
      <Sidebar
        org={data.tenant?.organization ?? null}
        tenant={data.tenant}
        me={me}
        view={selectedId ? "project" : view}
        counts={counts}
        pcnsToSign={pcnsToSign.length}
        chatUnread={chatUnread}
        features={{
          count: featureBadge.length,
          urgent: featureBadge.some((f) => f.priority === "CRITICAL" || isLate(f, now)),
        }}
        open={menuOpen}
        canAdd={can("manage_systems")}
        canPropose={can("propose_projects")}
        canReports={can("reports")}
        // Managers get the high-level menu: the day-to-day pages' analysis lives under Reports.
        simple={me.role === "manager" && can("reports")}
        canUsers={can("manage_users")}
        canActivity={can("audit_log")}
        onView={(v) => {
          // The sidebar's Projects always opens on All projects, whatever tab was last used.
          if (v === "projects") setFilter("ALL");
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
          setSignOutJump((n) => n + 1);
          if (selectedId) closeProject();
        }}
        viewOnly={data.viewOnly}
      />

      <main className="main">
        <header className="topbar no-print">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          {/* On narrow screens the sidebar is a drawer: the organisation's mark stays in view here. */}
          {data.tenant?.organization?.branding && (
            <span className="topbar-org" title={data.tenant.organization.branding.name}>
              <OrgMark branding={data.tenant.organization.branding} surface={pageSurface()} size="sm" icon={!!data.tenant.organization.branding.icon} />
            </span>
          )}
          {canGoBack && (
            <button className="back-btn" onClick={() => window.history.back()} aria-label="Back to the previous page" title="Back">
              <ArrowLeft size={18} />
            </button>
          )}
          <h1>{data.viewOnly ? "Welcome" : `${greeting()}, ${me.name.split(" ")[0]}`}</h1>
          <WorkspaceSwitcher tenant={data.tenant} />
          <VitalSign
            attention={attention.length}
            total={systems.length}
            onClick={() => {
              setFilter(attention.some(isBlocked) ? "BLOCKED" : attention.some((s) => getSchedule(s, now) === "OVERDUE") ? "OVERDUE" : "ALL");
              setView("projects");
              if (selectedId) closeProject();
            }}
          />
          {(view === "projects" || view === "dashboard") && !selectedId && (
            <>
              <label className="search">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // The Dashboard has no list to filter: show the matches on the full project list.
                    if (view === "dashboard" && e.target.value.trim()) showTab("ALL");
                  }}
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
          <NotificationBell
            viewOnly={!!data.viewOnly}
            onFollow={(link) => {
              if (link.startsWith("view:")) {
                setView(/** @type {View} */ (link.slice(5)));
                if (selectedId) closeProject();
              } else window.location.hash = link.slice(1);
            }}
          />
          <button className="ask-btn" onClick={() => setAsking(true)} title="Ask a question about projects, people and deadlines">
            <Sparkles size={17} /> <span>{BRAND.assistantName}</span>
          </button>
        </header>
        {data.viewOnly && (
          <div className="view-only-banner no-print" role="status">
            <Eye size={17} />
            <span>
              <b>View only</b> · {data.viewOnly.label}. You're seeing this workspace live and can request updates on any project; nothing else can be changed. Link expires {new Date(data.viewOnly.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
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
          onSearch={
            data.viewOnly
              ? undefined
              : (pql) => {
                  setSearchFor((s) => ({ pql, n: (s?.n ?? 0) + 1 }));
                  setView("search");
                  setAsking(false);
                  if (selectedId) closeProject();
                }
          }
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
              requestChannels={data.requestChannels}
              onRequest={async (id, message, via) => {
                const r = await /** @type {Promise<{ sent: RequestDelivery; }>} */ (/** @type {unknown} */ (api("/requests", "POST", { systemId: id, message, via })));
                await reload();
                return r.sent;
              }}
              onDismiss={async (requestId) => {
                await api(`/requests/${requestId}`, "DELETE");
                await reload();
              }}
              onOpenFeature={(feature) => setFeatureEdit({ feature })}
              onNewFeature={() => setFeatureEdit({ feature: null, systemId: selected.id })}
              onChanged={reload}
              canEditPcn={can("manage_systems") || selected.pcnBy === me.id}
              section={projectTab === "docs" ? "docs" : projectTab === "lifecycle" ? "lifecycle" : projectTab === "backlog" ? "backlog" : projectTab === "timeline" ? "timeline" : showBoard ? "board" : showItems ? "items" : "overview"}
              canAssignOthers={can("edit_work_items")}
              itemKey={showItems || projectTab === "docs" ? itemKey : undefined}
              canCreateItems={can("create_work_items")}
              readOnly={!!data.viewOnly}
              onSignPcn={(index, decision, remarks) => signPcn(selected.id, index, decision, remarks)}
              onSearch={
                data.viewOnly
                  ? undefined
                  : (pql) => {
                      setSearchFor((s) => ({ pql, n: (s?.n ?? 0) + 1 }));
                      setView("search");
                      closeProject();
                    }
              }
            />
          ) : (
            <div className="empty">
              That project doesn't exist any more.{" "}
              <button className="link-btn" onClick={closeProject}>
                Back to all projects
              </button>
            </div>
          )
        ) : view === "settings" || view === "users" || view === "activity" ? (
          <SettingsPage
            me={me}
            prefs={prefs}
            permissions={data.permissions}
            projects={myProjects}
            mfaRequired={mfaRequiredFor(me, data.mfaPolicy)}
            recoveryCodesLeft={data.recoveryCodesLeft}
            twoStep={data.twoStep}
            viewOnly={data.viewOnly}
            onPrefs={savePrefs}
            onProfileSaved={reload}
            onSignedOut={reload}
            signOutJump={signOutJump}
            openPage={view === "users" ? "people" : view === "activity" ? "activity" : undefined}
            onPage={() => {
              // Settings just made a history step for the new page; that step is the Settings screen,
              // so it takes the place of the entry the view change would add.
              if (view === "settings") return;
              const s = window.history.state ?? {};
              window.history.replaceState({ ...s, pms: { ...s.pms, view: "settings" } }, "");
              setView("settings");
            }}
            adminPages={(() => {
              // The admin console, in three groups: the organisation (its administrators only), the open workspace,
              // and the remaining settings. Organisation-wide settings are changed by its administrators only.
              const orgAdmin = !!data.tenant?.orgAdmin;
              const ORG = "Organisation";
              const WS = `This workspace${data.tenant?.workspace?.name ? `: ${data.tenant.workspace.name}` : ""}`;
              const SET = "Settings";
              return [
                ...(orgAdmin
                  ? [
                      { group: ORG, key: "org-profile", label: "Profile", icon: Building2, content: <OrgAdmin me={me} section="profile" /> },
                      { group: ORG, key: "org-branding", label: "Branding", icon: Palette, content: <OrgAdmin me={me} section="branding" /> },
                      { group: ORG, key: "organisation", label: "Workspaces", icon: Layers, content: <OrgAdmin me={me} section="workspaces" /> },
                      { group: ORG, key: "org-people", label: "Members & roles", icon: Users, content: <OrgAdmin me={me} section="people" /> },
                      ...(can("manage_users") ? [{ group: ORG, key: "roles", label: "Roles & permissions", icon: ShieldCheck, content: <UsersPage section="roles" {...usersPageProps} /> }] : []),
                      { group: ORG, key: "org-templates", label: "Templates", icon: LayoutTemplate, content: <OrgAdmin me={me} section="templates" /> },
                      { group: ORG, key: "org-lifecycle", label: "Project Lifecycle", icon: Milestone, content: <LifecycleSettings users={users} /> },
                      { group: ORG, key: "org-audit", label: "Audit log", icon: ScrollText, content: <OrgAdmin me={me} section="audit" /> },
                    ]
                  : []),
                ...(can("manage_workflows")
                  ? [
                      { group: WS, key: "workflows", label: "Workflows", icon: Workflow, content: <WorkflowsSettings users={users} workspaces={data.workspaces} canEdit={can("manage_workflows")} /> },
                      { group: WS, key: "item-types", label: "Item types", icon: Shapes, content: <ItemTypesSettings canEdit={can("manage_workflows")} /> },
                      { group: WS, key: "slas", label: "SLAs", icon: Timer, content: <SlaSettings canEdit={can("manage_workflows")} /> },
                    ]
                  : []),
                ...(can("manage_schemes") ? [{ group: WS, key: "fields", label: "Fields", icon: ListPlus, content: <CustomFieldsSection workspaces={data.workspaces} /> }] : []),
                ...(can("manage_automation") ? [{ group: WS, key: "automation", label: "Automations", icon: Zap, content: <AutomationSettings users={users} systems={systems} workspaces={data.workspaces} now={now} orgAdmin={orgAdmin} /> }] : []),
                ...(can("manage_users") ? [{ group: WS, key: "people", label: "Users", icon: Users, content: <UsersPage section="people" {...usersPageProps} /> }] : []),
                ...(can("audit_log")
                  ? [
                      { group: WS, key: "ws-audit", label: "Audit log", icon: ScrollText, content: <OrgAdmin me={me} section="workspace-audit" /> },
                      { group: WS, key: "activity", label: "Activity log", icon: History, content: <ActivityPage users={users} systems={systems} now={now} /> },
                    ]
                  : []),
                ...(can("manage_users") && orgAdmin
                  ? [
                      { group: SET, key: "twostep", label: "Two-step rules", icon: Fingerprint, content: <UsersPage section="twostep" {...usersPageProps} /> },
                      { group: SET, key: "signin", label: "Sign-in security", icon: LockKeyhole, content: <UsersPage section="signin" {...usersPageProps} /> },
                      { group: SET, key: "delivery", label: "Email & Teams", icon: Send, content: <DeliverySection /> },
                    ]
                  : []),
                ...(can("manage_users")
                  ? [
                      { group: SET, key: "limits", label: "Workload limits", icon: Gauge, content: <UsersPage section="limits" {...usersPageProps} /> },
                      { group: SET, key: "links", label: "View-only links", icon: Link2, content: <UsersPage section="links" {...usersPageProps} /> },
                    ]
                  : []),
                ...(can("manage_integrations") ? [{ group: SET, key: "integrations", label: "Integrations", icon: Plug, content: <IntegrationsSection systems={systems} /> }] : []),
                ...(can("manage_schemes")
                  ? [
                      { group: SET, key: "schemes", label: "Notification schemes", icon: BellRing, content: <NotificationSchemesSection /> },
                      { group: SET, key: "levels", label: "Security levels", icon: Lock, content: <SecurityLevelsSection users={users} /> },
                    ]
                  : []),
                ...(can("manage_service_desk") ? [{ group: SET, key: "service-desk", label: "Service desk", icon: Headset, content: <ServiceDeskSettings systems={systems} /> }] : []),
              ];
            })()}
          />
        ) : view === "chat" && !data.viewOnly ? (
          <ChatPage me={me} users={users} canModerate={can("manage_users")} openId={chatOpen} onUnread={setChatUnread} />
        ) : view === "service-desk" && !data.viewOnly ? (
          <ServiceDeskPage users={users} canWork={can("work_service_desk")} canReports={can("reports") || can("manage_service_desk")} />
        ) : view === "search" && !data.viewOnly ? (
          <SearchPage key={searchFor?.n ?? 0} users={users} workspaces={data.workspaces} now={now} canShare={can("share_searches")} initialPql={searchFor?.pql} />
        ) : view === "pipeline" ? (
          <PipelinePage users={users} />
        ) : view === "boards" ? (
          <BoardsPage workspaces={data.workspaces} systems={systems} users={users} me={me} now={now} readOnly={!!data.viewOnly} canAssignOthers={can("edit_work_items")} />
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
            insights={can("reports")}
            onOpen={(feature) => setFeatureEdit({ feature })}
            onNew={() => setFeatureEdit({ feature: null })}
          />
        ) : view === "reports" && can("reports") ? (
          <ReportsHub me={me} workspaces={data.workspaces} onOpenFeature={(feature) => setFeatureEdit({ feature })} serviceDesk={can("reports") || can("manage_service_desk")} systems={systems} users={users} requests={requests} features={features} blockers={blockers} limits={limits} now={now} />
        ) : view === "dashboard" ? (
          <>
            {banners}
            <CustomDashboards
              enabled={!data.viewOnly}
              users={users}
              systems={systems}
              workspaces={data.workspaces}
              now={now}
              canShare={can("share_searches")}
              overview={
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
                  // Managers oversee the work rather than hold it, so the dashboard skips their (empty) list.
                  showMyWork={!data.viewOnly && me.role !== "manager"}
                />
              }
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
              setAddError(e instanceof Error ? e.message : "Couldn't add the project");
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
      {posting && <UpdateModal systems={editable} initialId={posting.initialId} onSave={saveUpdate} onClose={() => setPosting(null)} />}
    </div>
  );
}
