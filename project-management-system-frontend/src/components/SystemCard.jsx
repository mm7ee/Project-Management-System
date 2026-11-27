/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
import { BRAND } from "../data/brand";
import { AlertOctagon, BellRing, ChevronRight, Clock, Mail, Wrench } from "lucide-react";
import { SCHEDULE_META, STATUS_META, daysUntil, getSchedule, initials } from "../data/systems";
import { formatShort, plural, timeAgo } from "../time";
import { lastUpdateOf } from "../data/project";
import CountUp from "./CountUp";
/**
 * @param {{ status: System["status"] }} props
 */
export function StatusPill({ status }) {
  const meta = STATUS_META[status];
  return (
    <span className={`pill fill-${meta.tone}`}>
      {status === "LIVE" && <i className="pill-dot" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
/**
 * @param {{ system: System; now: number }} props
 */
export function ScheduleChip({ system, now }) {
  const meta = SCHEDULE_META[getSchedule(system, now)];
  return (
    <span className={`chip line-${meta.tone}`}>
      <i />
      {meta.label}
    </span>
  );
}
/**
 * The date line under the progress bar differs by lifecycle stage.
 * @param {{ system: System; now: number }} props
 */
export function DateLine({ system, now }) {
  const schedule = getSchedule(system, now);
  /** @type {string} */ let text;
  const toStart = daysUntil(system.startedAt, now);
  if (system.finishedAt) {
    text = `Delivered ${formatShort(system.finishedAt)}`;
  } else if (toStart > 0) {
    text = `Starts in ${plural(toStart, "day")}`;
  } else if (system.dueAt) {
    const left = daysUntil(system.dueAt, now);
    text = left < 0 ? `Overdue by ${plural(-left, "day")}` : left === 0 ? "Due today" : `Due in ${plural(left, "day")}`;
  } else {
    text = `Proposed ${formatShort(system.startedAt)}`;
  }
  return (
    <span className={`date-line ${schedule === "OVERDUE" || schedule === "AT_RISK" ? `text-${SCHEDULE_META[schedule].tone}` : ""}`}>
      <Clock size={15} />
      {text}
    </span>
  );
}
/**
 * @param {{ value: number }} props
 */
export function ProgressBar({ value }) {
  return (
    <div className="progress-row">
      <div className="progress">
        <div className={`progress-fill ${value >= 100 ? "done" : value > 0 ? "active" : ""}`} style={{ width: `${value}%` }} />
      </div>
      <span className="progress-pct">
        <CountUp value={value} />%
      </span>
    </div>
  );
}
export const lastUpdate = lastUpdateOf;
/**
 * "Updated 2d ago", or "No updates yet" for a project whose start date is still ahead.
 * @param {System} s
 * @param {number} now
 * @returns {string}
 */
export function updatedText(s, now) {
  const at = lastUpdate(s);
  return !s.updatedAt && new Date(at).getTime() > now ? "No updates yet" : `Updated ${timeAgo(at, now)}`;
}
/**
 * @param {Props} arg2
 */
export default function SystemCard({ system, now, lead, developers, requests, mine, blockers = [], stalled = null, index = 0, onSelect }) {
  const maintenance = system.health === "Maintenance";
  const blocked = blockers.length > 0;
  return (
    <article
      className={`card ${mine ? "mine" : ""} ${maintenance ? "maint" : ""} ${blocked ? "blocked" : ""}`}
      style={/** @type {React.CSSProperties} */ ({ ["--i"]: Math.min(index, 12) })}
      // Clicking anywhere on the card opens the project; its own links and buttons keep their job.
      onClick={(e) => {
        if (!/** @type {HTMLElement} */ (e.target).closest("a, button")) onSelect(system);
      }}
      // Spotlight that follows the pointer (drawn by .card::before).
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      <header className="card-head">
        <h3>{system.name}</h3>
        <StatusPill status={system.status} />
      </header>
      {(blocked || stalled !== null) && (
        <div className={`card-blocker ${blocked ? "" : "stalled"}`} title={blockers.join("\n")}>
          <AlertOctagon size={15} />
          <span>
            {blocked ? (
              <>
                <b>Blocked{blockers.length > 1 ? ` (${blockers.length})` : ""}:</b> {blockers[0]}
              </>
            ) : (
              <>
                <b>Stalled:</b> no progress update for {stalled} days
              </>
            )}
          </span>
        </div>
      )}
      {(mine || requests > 0 || maintenance) && (
        <div className="card-flags">
          {maintenance && (
            <span className="flag flag-maint" title={system.maintenanceNote || "Updates in progress"}>
              <Wrench size={13} /> Under maintenance
            </span>
          )}
          {mine && <span className="flag flag-mine">Assigned to you</span>}
          {requests > 0 && (
            <span className="flag flag-request">
              <BellRing size={13} /> Update requested
            </span>
          )}
        </div>
      )}

      <ProgressBar value={system.progress} />

      <div className="card-row">
        <DateLine system={system} now={now} />
        <ScheduleChip system={system} now={now} />
      </div>

      <footer className="card-foot">
        <span className="updated">
          <span className="avatar" title={lead ? `Project lead: ${lead.name}` : undefined}>
            {lead ? initials(lead.name) : (system.updatedBy ?? initials(system.owner))}
          </span>
          {developers.length > 0 && (
            <span className="dev-stack" title={`Developers: ${developers.map((d) => d.name).join(", ")}`}>
              {developers.slice(0, 3).map((d) => (
                <span key={d.id} className="avatar">
                  {initials(d.name)}
                </span>
              ))}
              {developers.length > 3 && <span className="avatar">+{developers.length - 3}</span>}
            </span>
          )}
          <span className="updated-text">
            {lead && <b className="lead-name">{lead.name}</b>}
            <span>{updatedText(system, now)}</span>
          </span>
        </span>
        <span className="foot-actions">
          {lead?.email && (
            <a className="icon-link" href={`mailto:${lead.email}?subject=${encodeURIComponent(`${BRAND.shortName}: ${system.name}`)}`} title={`Email ${lead.name}`} aria-label={`Email ${lead.name}`}>
              <Mail size={16} />
            </a>
          )}
          {/* A real link, so ctrl-click or middle-click opens the project in a new tab. */}
          <a
            className="view-link"
            href={`#/projects/${system.id}`}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onSelect(system);
            }}
          >
            View <ChevronRight size={15} />
          </a>
        </span>
      </footer>
    </article>
  );
}
/**
 * @typedef {Object} Props
 * @property {System} system
 * @property {number} now
 * @property {User} [lead]
 * @property {User[]} developers
 * @property {number} requests
 * @property {boolean} mine
 * @property {string[]} [blockers]
 * @property {number | null} [stalled]
 * @property {number} [index]
 * @property {(s: System) => void} onSelect
 */
