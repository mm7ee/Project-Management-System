import { FileBarChart, FileText, FolderKanban, LayoutDashboard, ListChecks, MonitorSmartphone, Moon, Orbit, Plus, Settings, Sun, Users, X } from "lucide-react";
import { initials, type Status } from "../data/systems";
import { ROLE_LABEL, type Prefs, type User } from "../data/roles";
import { COMPANY_URL } from "../brand";

export type Filter = "ALL" | Status | "OVERDUE" | "REQUESTED" | "MAINTENANCE" | "MINE" | "BLOCKED";
export type View = "dashboard" | "projects" | "project" | "features" | "pcns" | "reports" | "users" | "activity" | "settings";

interface Props {
  me: User;
  view: View;
  counts: Record<Filter, number>;
  features: { count: number; urgent: boolean }; // open requests to show beside "Feature requests"
  pcnsToSign: number; // Concept Notes waiting for your signature
  open: boolean;
  canAdd: boolean;
  canPropose: boolean; // may propose a project with a Concept Note
  canReports: boolean;
  canUsers: boolean;
  canActivity: boolean;
  onView: (v: View) => void;
  onClose: () => void;
  onAdd: () => void;
  canLogFeature: boolean;
  onLogFeature: () => void;
  onAccount: () => void;
  theme: Prefs["theme"];
  onTheme: (t: Prefs["theme"]) => void;
}

const THEMES: { value: Prefs["theme"]; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "futuristic", label: "Futuristic", icon: Orbit },
  { value: "system", label: "Match device", icon: MonitorSmartphone },
];

export default function Sidebar(p: Props) {
  const go = (fn: () => void) => () => {
    fn();
    p.onClose();
  };
  return (
    <>
      <div className={`sidebar-scrim ${p.open ? "show" : ""}`} onClick={p.onClose} />
      <aside className={`sidebar ${p.open ? "open" : ""}`}>
        <button className="sidebar-close" onClick={p.onClose} aria-label="Close menu">
          <X size={18} />
        </button>
        <div className="brand">
          <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="logo-link" title="Omni Contact website">
            <img src="/omni-logo-white.png" alt="Omni Contact" />
          </a>
          <span>OmniTrack</span>
        </div>

        <nav className="nav">
          <div className="nav-section">Navigation</div>
          <button className={`nav-item ${p.view === "dashboard" ? "active" : ""}`} onClick={go(() => p.onView("dashboard"))}>
            <span>
              <LayoutDashboard size={16} className="nav-icon" /> Dashboard
            </span>
          </button>
          {/* The stage and status filters live on the Projects page itself. */}
          <button className={`nav-item ${p.view === "projects" ? "active" : ""}`} onClick={go(() => p.onView("projects"))}>
            <span>
              <FolderKanban size={16} className="nav-icon" /> Projects
            </span>
            <span className="nav-count">{p.counts.ALL}</span>
          </button>

          <div className="nav-section">Workspace</div>
          <button className={`nav-item ${p.view === "features" ? "active" : ""}`} onClick={go(() => p.onView("features"))}>
            <span>
              <ListChecks size={16} className="nav-icon" /> Feature requests
            </span>
            {p.features.count > 0 && <span className={`nav-count ${p.features.urgent ? "alert" : ""}`}>{p.features.count}</span>}
          </button>
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
          {p.canReports && (
            <button className={`nav-item ${p.view === "reports" ? "active" : ""}`} onClick={go(() => p.onView("reports"))}>
              <span>
                <FileBarChart size={16} className="nav-icon" /> Reports
              </span>
            </button>
          )}
          {p.canUsers && <div className="nav-section">Administration</div>}
          {p.canUsers && (
            <button className={`nav-item ${p.view === "users" ? "active" : ""}`} onClick={go(() => p.onView("users"))}>
              <span>
                <Users size={16} className="nav-icon" /> Users & roles
              </span>
            </button>
          )}
          {/* The activity log is a tab inside Settings. */}
          <button className={`nav-item ${p.view === "settings" || p.view === "activity" ? "active" : ""}`} onClick={go(() => p.onView("settings"))}>
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
        {p.canLogFeature && (
          <button className={`add-btn ${p.canAdd || p.canPropose ? "stacked" : ""}`} onClick={go(p.onLogFeature)}>
            <ListChecks size={17} strokeWidth={2.5} /> Log feature request
          </button>
        )}

        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="radio"
              aria-checked={p.theme === value}
              aria-label={label}
              title={label}
              className={p.theme === value ? "on" : ""}
              onClick={() => p.onTheme(value)}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>

        <button className={`profile ${p.view === "settings" ? "on" : ""}`} onClick={go(p.onAccount)} aria-label="Your settings">
          <span className="profile-avatar">{initials(p.me.name)}</span>
          <span className="profile-text">
            <span className="profile-name">{p.me.name}</span>
            <span className="role-tag">{ROLE_LABEL[p.me.role]}</span>
          </span>
        </button>
      </aside>
    </>
  );
}
