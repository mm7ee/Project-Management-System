import { Plus, X } from "lucide-react";
import { STATUS_META, type Status } from "../data/systems";

export type Filter = "ALL" | Status | "OVERDUE";

// Order follows the mock-up. "To deploy" and "Ideas" only appear when something is in them.
const NAV: { key: Filter; label: string; optional?: boolean }[] = [
  { key: "ALL", label: "All projects" },
  { key: "LIVE", label: STATUS_META.LIVE.label },
  { key: "WIP", label: STATUS_META.WIP.label },
  { key: "TO_DEPLOY", label: STATUS_META.TO_DEPLOY.label, optional: true },
  { key: "UPCOMING", label: STATUS_META.UPCOMING.label },
  { key: "COMPLETED", label: STATUS_META.COMPLETED.label },
  { key: "IDEA", label: "Ideas", optional: true },
  { key: "OVERDUE", label: "Overdue" },
];

interface Props {
  filter: Filter;
  counts: Record<Filter, number>;
  open: boolean;
  onFilter: (f: Filter) => void;
  onClose: () => void;
  onAdd: () => void;
}

export default function Sidebar({ filter, counts, open, onFilter, onClose, onAdd }: Props) {
  return (
    <>
      <div className={`sidebar-scrim ${open ? "show" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>
        <div className="brand">
          <img src="/omni-logo-white.png" alt="Omni Contact" />
          <span>OmniTrack</span>
        </div>

        <nav className="nav">
          {NAV.filter((n) => !n.optional || counts[n.key] > 0).map(({ key, label }) => (
            <button
              key={key}
              className={`nav-item ${filter === key ? "active" : ""}`}
              onClick={() => {
                onFilter(key);
                onClose();
              }}
            >
              <span>{label}</span>
              <span className={`nav-count ${key === "OVERDUE" && counts.OVERDUE > 0 ? "alert" : ""}`}>
                {counts[key]}
              </span>
            </button>
          ))}
        </nav>

        <button
          className="add-btn"
          onClick={() => {
            onAdd();
            onClose();
          }}
        >
          <Plus size={17} strokeWidth={2.75} /> Add system
        </button>
      </aside>
    </>
  );
}
