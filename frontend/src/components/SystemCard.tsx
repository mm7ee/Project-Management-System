import { ChevronRight, Clock } from "lucide-react";
import { SCHEDULE_META, STATUS_META, daysUntil, getSchedule, initials, type System } from "../data/systems";
import { formatShort, plural, timeAgo } from "../time";

interface Props {
  system: System;
  now: number;
  onSelect: (s: System) => void;
}

export function StatusPill({ status }: { status: System["status"] }) {
  const meta = STATUS_META[status];
  return <span className={`pill fill-${meta.tone}`}>{meta.label}</span>;
}

export function ScheduleChip({ system, now }: { system: System; now: number }) {
  const meta = SCHEDULE_META[getSchedule(system, now)];
  return (
    <span className={`chip line-${meta.tone}`}>
      <i />
      {meta.label}
    </span>
  );
}

/** The date line under the progress bar differs by lifecycle stage. */
export function DateLine({ system, now }: { system: System; now: number }) {
  const schedule = getSchedule(system, now);
  let text: string;
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

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-row">
      <div className="progress">
        <div className={`progress-fill ${value >= 100 ? "done" : ""}`} style={{ width: `${value}%` }} />
      </div>
      <span className="progress-pct">{value}%</span>
    </div>
  );
}

export const lastUpdate = (s: System) => s.updatedAt ?? s.finishedAt ?? s.startedAt;

/** "Updated 2d ago", or "No updates yet" for a project whose start date is still ahead. */
export function updatedText(s: System, now: number): string {
  const at = lastUpdate(s);
  return !s.updatedAt && new Date(at).getTime() > now ? "No updates yet" : `Updated ${timeAgo(at, now)}`;
}

export default function SystemCard({ system, now, onSelect }: Props) {
  return (
    <article className="card">
      <header className="card-head">
        <h3>{system.name}</h3>
        <StatusPill status={system.status} />
      </header>

      <ProgressBar value={system.progress} />

      <div className="card-row">
        <DateLine system={system} now={now} />
        <ScheduleChip system={system} now={now} />
      </div>

      <footer className="card-foot">
        <span className="updated">
          <span className="avatar">{system.updatedBy ?? initials(system.owner)}</span>
          {updatedText(system, now)}
        </span>
        <button className="view-link" onClick={() => onSelect(system)}>
          View <ChevronRight size={15} />
        </button>
      </footer>
    </article>
  );
}
