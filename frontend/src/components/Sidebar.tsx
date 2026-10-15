import { AlertOctagon, BellRing, FileBarChart, FileText, FolderGit2, History, ListChecks, MonitorSmartphone, Moon, Orbit, Plus, Settings, Sun, Users, Wrench, X } from "lucide-react";
import { STATUS_META, initials, type Status } from "../data/systems";
import { ROLE_LABEL, type Prefs, type User } from "../data/roles";
import { COMPANY_URL } from "../brand";

export type Filter = "ALL" | Status | "OVERDUE" | "REQUESTED" | "MAINTENANCE" | "MINE" | "BLOCKED";
export type View = "projects" | "project" | "features" | "reports" | "users" | "activity" | "settings";

// Order follows the mock-up. Optional items only appear when something is in them.
const NAV: { key: Filter; label: string; optional?: boolean }[] = [
  { key: "ALL", label: "All projects" },
  { key: "MINE", label: "Assigned to me", optional: true },
  { key: "LIVE", label: STATUS_META.LIVE.label },
  { key: "WIP", label: STATUS_META.WIP.label },
  { key: "TESTING", label: STATUS_META.TESTING.label, optional: true },
  { key: "TO_DEPLOY", label: STATUS_META.TO_DEPLOY.label, optional: true },
  { key: "UPCOMING", label: STATUS_META.UPCOMING.label },
  { key: "COMPLETED", label: STATUS_META.COMPLETED.label },
  { key: "IDEA", label: "Ideas", optional: true },
  { key: "MAINTENANCE", label: "Maintenance" },
  { key: "BLOCKED", label: "Blocked / stalled", optional: true },
  { key: "OVERDUE", label: "Overdue" },
  { key: "REQUESTED", label: "Update requests", optional: true },
];

interface Props {
  me: User;
  filter: Filter;
  view: View;
  counts: Record<Filter, number>;
  features: { count: number; urgent: boolean }; // open requests to show beside "Feature requests"
  open: boolean;
  canAdd: boolean;
  canPropose: boolean; // may propose a project with a Concept Note
  canReports: boolean;
  canUsers: boolean;
  canActivity: boolean;
  onFilter: (f: Filter) => void;
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
          {NAV.filter((n) => !n.optional || p.counts[n.key] > 0).map(({ key, label }) => (
            <button
              key={key}
              className={`nav-item ${p.view === "projects" && p.filter === key ? "active" : ""}`}
              onClick={go(() => {
                p.onFilter(key);
                p.onView("projects");
              })}
            >
              <span>
                {key === "REQUESTED" && <BellRing size={15} className="nav-icon" />}
                {key === "MAINTENANCE" && <Wrench size={15} className="nav-icon" />}
                {key === "MINE" && <FolderGit2 size={15} className="nav-icon" />}
                {key === "BLOCKED" && <AlertOctagon size={15} className="nav-icon" />}
                {label}
              </span>
              <span
                className={`nav-count ${(key === "OVERDUE" || key === "REQUESTED" || key === "BLOCKED") && p.counts[key] > 0 ? "alert" : ""} ${
                  key === "MAINTENANCE" && p.counts[key] > 0 ? "maint" : ""
                }`}
              >
                {p.counts[key]}
              </span>
            </button>
          ))}

          <div className="nav-divider" />
          <button className={`nav-item ${p.view === "features" ? "active" : ""}`} onClick={go(() => p.onView("features"))}>
            <span>
              <ListChecks size={16} className="nav-icon" /> Feature requests
            </span>
            {p.features.count > 0 && <span className={`nav-count ${p.features.urgent ? "alert" : ""}`}>{p.features.count}</span>}
          </button>
          {p.canReports && (
            <button className={`nav-item ${p.view === "reports" ? "active" : ""}`} onClick={go(() => p.onView("reports"))}>
              <span>
                <FileBarChart size={16} className="nav-icon" /> Reports
              </span>
            </button>
          )}
          {p.canUsers && (
            <button className={`nav-item ${p.view === "users" ? "active" : ""}`} onClick={go(() => p.onView("users"))}>
              <span>
                <Users size={16} className="nav-icon" /> Users & roles
              </span>
            </button>
          )}
          {p.canActivity && (
            <button className={`nav-item ${p.view === "activity" ? "active" : ""}`} onClick={go(() => p.onView("activity"))}>
              <span>
                <History size={16} className="nav-icon" /> Activity log
              </span>
            </button>
          )}
          <button className={`nav-item ${p.view === "settings" ? "active" : ""}`} onClick={go(() => p.onView("settings"))}>
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
