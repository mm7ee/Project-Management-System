/** @import { Status } from '../data/systems' */
/** @import { User } from '../data/roles' */
import { Milestone, Columns3, MessagesSquare, Eye, Search, Headset, FileBarChart, FileText, FolderKanban, LayoutDashboard, ListChecks, Plus, Settings, X } from "lucide-react";
import { initials } from "../data/systems";
import { ROLE_LABEL } from "../data/roles";
import { BRAND } from "../data/brand";
import OrgMark from "./OrgMark";
import WorkspaceCard from "./WorkspaceCard";
import ParticleField from "./ParticleField";
/**
 * @param {Props} p
 */
export default function Sidebar(p) {
  const go = /** @param {() => void} fn */ (fn) => () => {
    fn();
    p.onClose();
  };
  return (
    <>
      <div className={`sidebar-scrim ${p.open ? "show" : ""}`} onClick={p.onClose} />
      <aside className={`sidebar ${p.open ? "open" : ""}`}>
        {/* A faint web behind the menu: neutral, the same in every organisation. */}
        <ParticleField className="sidebar-web" palette="dark" />
        <button className="sidebar-close" onClick={p.onClose} aria-label="Close menu">
          <X size={18} />
        </button>
        {/* State C: the organisation's own logo (the variant for dark backgrounds: the sidebar is always dark), or its
            monogram, and the open workspace. Inside an organisation the product's name appears only as "Powered by". */}
        <div className="brand">
          {p.org?.branding ? <OrgMark branding={p.org.branding} surface="dark" size="md" /> : <span className="brand-pms">{BRAND.shortName}</span>}
          <WorkspaceCard tenant={p.tenant} viewOnly={!!p.viewOnly} />
        </div>

        <nav className="nav">
          <div className="nav-section">Navigation</div>
          <button className={`nav-item ${p.view === "dashboard" ? "active" : ""}`} onClick={go(() => p.onView("dashboard"))}>
            <span>
              <LayoutDashboard size={16} className="nav-icon" /> Dashboard
            </span>
          </button>
          <button className={`nav-item ${p.view === "projects" || p.view === "project" ? "active" : ""}`} onClick={go(() => p.onView("projects"))}>
            <span>
              <FolderKanban size={16} className="nav-icon" /> Projects
            </span>
            {p.counts.ALL > 0 && <span className="nav-count">{p.counts.ALL}</span>}
          </button>

          <button className={`nav-item ${p.view === "pipeline" ? "active" : ""}`} onClick={go(() => p.onView("pipeline"))}>
            <span>
              <Milestone size={16} className="nav-icon" /> Pipeline
            </span>
          </button>

          {p.canReports && p.simple && (
            <button className={`nav-item ${p.view === "reports" ? "active" : ""}`} onClick={go(() => p.onView("reports"))}>
              <span>
                <FileBarChart size={16} className="nav-icon" /> Reports
              </span>
            </button>
          )}

          <div className="nav-section">Workspace</div>
          {!p.simple && (
            <>
              <button className={`nav-item ${p.view === "features" ? "active" : ""}`} onClick={go(() => p.onView("features"))}>
                <span>
                  <ListChecks size={16} className="nav-icon" /> Feature requests
                </span>
                {p.features.count > 0 && <span className={`nav-count ${p.features.urgent ? "alert" : ""}`}>{p.features.count}</span>}
              </button>
              <button className={`nav-item ${p.view === "boards" ? "active" : ""}`} onClick={go(() => p.onView("boards"))}>
                <span>
                  <Columns3 size={16} className="nav-icon" /> Boards
                </span>
              </button>
            </>
          )}
          {!p.viewOnly && !p.simple && (
            <button className={`nav-item ${p.view === "search" ? "active" : ""}`} onClick={go(() => p.onView("search"))}>
              <span>
                <Search size={16} className="nav-icon" /> Search
              </span>
            </button>
          )}
          {!p.viewOnly && (
            <button className={`nav-item ${p.view === "chat" ? "active" : ""}`} onClick={go(() => p.onView("chat"))}>
              <span>
                <MessagesSquare size={16} className="nav-icon" /> Chat
              </span>
              {p.chatUnread > 0 && (
                <span className="nav-count alert" title={`${p.chatUnread} unread`}>
                  {p.chatUnread > 99 ? "99+" : p.chatUnread}
                </span>
              )}
            </button>
          )}
          {!p.viewOnly && !p.simple && (
            <button className={`nav-item ${p.view === "service-desk" ? "active" : ""}`} onClick={go(() => p.onView("service-desk"))}>
              <span>
                <Headset size={16} className="nav-icon" /> Service desk
              </span>
            </button>
          )}
          <button className={`nav-item ${p.view === "pcns" ? "active" : ""}`} onClick={go(() => p.onView("pcns"))}>
            <span>
              <FileText size={16} className="nav-icon" /> Concept Notes
            </span>
            {p.pcnsToSign > 0 && (
              <span className="nav-count alert" title={`${p.pcnsToSign} waiting for your signature`}>
                {p.pcnsToSign}
              </span>
            )}
          </button>
          {p.canReports && !p.simple && (
            <button className={`nav-item ${p.view === "reports" ? "active" : ""}`} onClick={go(() => p.onView("reports"))}>
              <span>
                <FileBarChart size={16} className="nav-icon" /> Reports
              </span>
            </button>
          )}
          {/* Users & roles and the activity log are tabs inside Settings. */}
          <button className={`nav-item ${p.view === "settings" || p.view === "activity" || p.view === "users" ? "active" : ""}`} onClick={go(() => p.onView("settings"))}>
            <span>
              <Settings size={16} className="nav-icon" /> Settings
            </span>
          </button>
        </nav>

        {p.canAdd ? (
          <button className="add-btn" onClick={go(p.onAdd)}>
            <Plus size={17} strokeWidth={2.75} /> Add system
          </button>
        ) : (
          // Without the right to add systems outright, new projects start as a Concept Note.
          p.canPropose && (
            <button className="add-btn" onClick={go(p.onAdd)}>
              <FileText size={17} strokeWidth={2.5} /> Propose a project
            </button>
          )
        )}
        {/* Feature requests are logged from the Feature requests page. */}

        {p.viewOnly ? (
          <button className={`profile ${p.view === "settings" ? "on" : ""}`} onClick={go(p.onAccount)} title="Opened through a view-only link: display settings">
            <span className="profile-avatar">
              <Eye size={16} />
            </span>
            <span className="profile-text">
              <span className="profile-name">{p.viewOnly.label}</span>
              <span className="role-tag">View only</span>
            </span>
          </button>
        ) : (
          <button className={`profile ${p.view === "settings" ? "on" : ""}`} onClick={go(p.onAccount)} aria-label="Your settings">
            <span className="profile-avatar">{initials(p.me.name)}</span>
            <span className="profile-text">
              <span className="profile-name">{p.me.name}</span>
              <span className="role-tag">{ROLE_LABEL[p.me.role]}</span>
            </span>
          </button>
        )}
      </aside>
    </>
  );
}
/** @typedef {"ALL" | Status | "OVERDUE" | "REQUESTED" | "MAINTENANCE" | "MINE" | "BLOCKED"} Filter */
/** @typedef {"dashboard" | "projects" | "project" | "pipeline" | "features" | "boards" | "search" | "service-desk" | "chat" | "pcns" | "reports" | "users" | "activity" | "settings"} View */
/**
 * @typedef {Object} Props
 * @property {User} me
 * @property {{ name: string; branding?: import("../data/branding").BrandingView | null } | null} [org]  the organisation, with its branding
 * @property {import("../data/api").Tenant} [tenant]  the open workspace (and the ones to switch to), for the card at the top
 * @property {View} view
 * @property {Record<Filter, number>} counts
 * @property {Object} features
 * @property {number} features.count
 * @property {boolean} features.urgent
 * @property {number} pcnsToSign
 * @property {number} chatUnread
 * @property {boolean} open
 * @property {boolean} canAdd
 * @property {boolean} canPropose
 * @property {boolean} canReports
 * @property {boolean} [simple]
 * @property {boolean} canUsers
 * @property {boolean} canActivity
 * @property {(v: View) => void} onView
 * @property {() => void} onClose
 * @property {() => void} onAdd
 * @property {() => void} onAccount
 * @property {{ label: string }} [viewOnly]
 */
