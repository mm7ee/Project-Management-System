/** @import { Feature } from '../../data/features' */
/** @import { System } from '../../data/systems' */
/** @import { UpdateRequest, User } from '../../data/roles' */
/** @import { Blocker, Limits } from '../../data/project' */
import { useHistoryTab } from "../../history";
import { BarChart3, Gauge, Headset, LayoutDashboard, ListChecks, Printer } from "lucide-react";
import BiDashboard from "./BiDashboard";
import ReportsPage from "./ReportsPage";
import AgileReports from "./AgileReports";
import FeatureInsights from "../FeatureInsights";
import { Reports as ServiceDeskReports } from "../ServiceDeskPage";
/**
 * Prints the Overview on A4 landscape: the page size is set only for this print, so other pages print as before.
 * @returns {void}
 */
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
/**
 * This browser remembers the last tab, so Reports opens where you left it.
 * @type {"pms:reports-tab"}
 */
const SAVED = "pms:reports-tab";
/**
 * A link to #/reports/projects?… opens the Projects tab with its filters.
 * @returns {boolean}
 */
const projectsInHash = () => typeof window !== "undefined" && window.location.hash.startsWith("#/reports/projects");
/**
 * @param {Props} props
 */
export default function ReportsHub({ me, workspaces, onOpenFeature, serviceDesk, ...projects }) {
  /** @type {{ key: Tab; label: string; icon: typeof BarChart3 }[]} */ const tabs = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "projects", label: "Projects", icon: BarChart3 },
    { key: "features", label: "Feature requests", icon: ListChecks },
    { key: "delivery", label: "Delivery", icon: Gauge },
    ...(serviceDesk ? [{ key: /** @type {const} */ ("service"), label: "Service desk", icon: Headset }] : []),
  ];
  // The open tab is a browser-history step: Back returns to the tab you were on.
  const [tab, setTab] = useHistoryTab("reports", () => {
    if (projectsInHash()) return /** @type {Tab} */ ("projects");
    try {
      const t = /** @type {Tab | null} */ (localStorage.getItem(SAVED));
      if (t && tabs.some((x) => x.key === t)) return t;
    } catch {
      // No storage: start on Projects.
    }
    return /** @type {Tab} */ ("overview");
  });
  const pick = /** @param {Tab} t */ (t) => {
    // Only the Projects tab keeps its filters in the address.
    setTab(t, t !== "projects" && projectsInHash() ? window.location.pathname + window.location.search : undefined);
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
/** @typedef {"overview" | "projects" | "features" | "delivery" | "service"} Tab */
/**
 * Reports, in one place: projects, feature requests, delivery (boards and sprints) and the service desk.
 * Managers reach the analysis here instead of the day-to-day pages behind it.
 * @typedef {Object} Props
 * @property {User} me
 * @property {System[]} systems
 * @property {User[]} users
 * @property {UpdateRequest[]} requests
 * @property {Feature[]} features
 * @property {Blocker[]} blockers
 * @property {Limits} limits
 * @property {number} now
 * @property {string[]} workspaces
 * @property {(f: Feature) => void} onOpenFeature
 * @property {boolean} serviceDesk
 */
