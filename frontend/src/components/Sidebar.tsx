import { BellRing, FileBarChart, Plus, Users, X } from "lucide-react";
import { STATUS_META, initials, type Status } from "../data/systems";
import { ROLE_LABEL, type User } from "../data/roles";

export type Filter = "ALL" | Status | "OVERDUE" | "REQUESTED";
export type View = "projects" | "reports" | "users";

// Order follows the mock-up. Optional items only appear when something is in them.
const NAV: { key: Filter; label: string; optional?: boolean }[] = [
  { key: "ALL", label: "All projects" },
  { key: "LIVE", label: STATUS_META.LIVE.label },
  { key: "WIP", label: STATUS_META.WIP.label },
  { key: "TO_DEPLOY", label: STATUS_META.TO_DEPLOY.label, optional: true },
  { key: "UPCOMING", label: STATUS_META.UPCOMING.label },
  { key: "COMPLETED", label: STATUS_META.COMPLETED.label },
  { key: "IDEA", label: "Ideas", optional: true },
  { key: "OVERDUE", label: "Overdue" },
  { key: "REQUESTED", label: "Update requests", optional: true },
];

interface Props {
  me: User;
  filter: Filter;
  view: View;
  counts: Record<Filter, number>;
  open: boolean;
  canAdd: boolean;
  canReports: boolean;
  canUsers: boolean;
  onFilter: (f: Filter) => void;
  onView: (v: View) => void;
  onClose: () => void;
  onAdd: () => void;
  onAccount: () => void;
}

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
          <img src="/omni-logo-white.png" alt="Omni Contact" />
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
                {label}
              </span>
              <span className={`nav-count ${(key === "OVERDUE" || key === "REQUESTED") && p.counts[key] > 0 ? "alert" : ""}`}>
                {p.counts[key]}
              </span>
            </button>
          ))}

          {(p.canReports || p.canUsers) && <div className="nav-divider" />}
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
        </nav>

        {p.canAdd && (
          <button className="add-btn" onClick={go(p.onAdd)}>
            <Plus size={17} strokeWidth={2.75} /> Add system
          </button>
        )}

        <button className="profile" onClick={p.onAccount} aria-label="Your account">
          <span className="profile-avatar">{initials(p.me.name)}</span>
          <span className="profile-text">
            <span className="profile-name">{p.me.name}</span>
            <span className="profile-title">{p.me.title || ROLE_LABEL[p.me.role]}</span>
            <span className="role-tag">{ROLE_LABEL[p.me.role]}</span>
          </span>
        </button>
      </aside>
    </>
  );
}
