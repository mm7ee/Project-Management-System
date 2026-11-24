import { useState } from "react";
import { BarChart3, Gauge, Headset, LayoutDashboard, ListChecks, Printer } from "lucide-react";
import BiDashboard from "./BiDashboard";
import type { Feature } from "../../data/features";
import type { System } from "../../data/systems";
import type { UpdateRequest, User } from "../../data/roles";
import type { Blocker, Limits } from "../../data/project";
import ReportsPage from "./ReportsPage";
import AgileReports from "./AgileReports";
import FeatureInsights from "../FeatureInsights";
import { Reports as ServiceDeskReports } from "../ServiceDeskPage";

/** Prints the Overview on A4 landscape: the page size is set only for this print, so other pages print as before. */
function printLandscape() {
  const style = document.createElement("style");
  style.textContent = "@page { size: A4 landscape; margin: 10mm; }";
  document.head.appendChild(style);
  const done = () => {
    style.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

type Tab = "overview" | "projects" | "features" | "delivery" | "service";
/** This browser remembers the last tab, so Reports opens where you left it. */
const SAVED = "pulse:reports-tab";

/**
 * Reports, in one place: projects, feature requests, delivery (boards and sprints) and the service desk.
 * Managers reach the analysis here instead of the day-to-day pages behind it.
 */
interface Props {
  me: User;
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
  features: Feature[];
  blockers: Blocker[];
  limits: Limits;
  now: number;
  workspaces: string[];
  onOpenFeature: (f: Feature) => void;
  serviceDesk: boolean;
}

/** A link to #/reports/projects?… opens the Projects tab with its filters. */
const projectsInHash = () => typeof window !== "undefined" && window.location.hash.startsWith("#/reports/projects");

export default function ReportsHub({ me, workspaces, onOpenFeature, serviceDesk, ...projects }: Props) {
  const tabs: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "projects", label: "Projects", icon: BarChart3 },
    { key: "features", label: "Feature requests", icon: ListChecks },
    { key: "delivery", label: "Delivery", icon: Gauge },
    ...(serviceDesk ? [{ key: "service" as const, label: "Service desk", icon: Headset }] : []),
  ];
  const [tab, setTab] = useState<Tab>(() => {
    if (projectsInHash()) return "projects";
    try {
      const t = localStorage.getItem(SAVED) as Tab | null;
      if (t && tabs.some((x) => x.key === t)) return t;
    } catch {
      // No storage: start on Projects.
    }
    return "overview";
  });
  const pick = (t: Tab) => {
    setTab(t);
    // Only the Projects tab keeps its filters in the address.
    if (t !== "projects" && projectsInHash()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    try {
      localStorage.setItem(SAVED, t);
    } catch {
      // Only a convenience.
    }
  };

  return (
    <>
      <div className="reports-tabs no-print">
        <div className="seg" role="tablist" aria-label="Reports">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => pick(key)}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "overview" && (
        <div className="page bi-page">
          <header className="page-head no-print">
            <div>
              <h2>Overview</h2>
              <p>The portfolio at a glance. Every chart filters the others: click to drill in.</p>
            </div>
            <button className="btn btn-navy" onClick={printLandscape} title="Print, or save as PDF from the print dialog">
              <Printer size={16} /> Print / PDF
            </button>
          </header>
          <BiDashboard systems={projects.systems} features={projects.features} blockers={projects.blockers} users={projects.users} workspaces={workspaces} now={projects.now} />
        </div>
      )}
      {tab === "projects" && <ReportsPage me={me} users={projects.users} workspaces={workspaces} now={projects.now} />}
      {tab === "features" && (
        <div className="page">
          <header className="page-head">
            <div>
              <h2>Feature requests</h2>
              <p>What clients are asking for, how fast it's delivered, and what's waiting too long.</p>
            </div>
          </header>
          <FeatureInsights features={projects.features} systems={projects.systems} workspaces={workspaces} now={projects.now} onOpen={onOpenFeature} />
        </div>
      )}
      {tab === "delivery" && (
        <div className="page report d-style">
          <header className="page-head">
            <div>
              <h2>Delivery</h2>
              <p>How work moves across the boards and sprints: flow, throughput, and how each sprint went.</p>
            </div>
          </header>
          <AgileReports systems={projects.systems} now={projects.now} overview />
        </div>
      )}
      {tab === "service" && serviceDesk && (
        <div className="page service-desk">
          <header className="page-head">
            <div>
              <h2>Service desk</h2>
              <p>Requests raised and resolved, and how often response and resolution targets were met.</p>
            </div>
          </header>
          <div className="sd-panel">
            <ServiceDeskReports />
          </div>
        </div>
      )}
    </>
  );
}
