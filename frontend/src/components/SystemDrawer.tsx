import { useEffect, useState } from "react";
import { ArrowUpRight, Trash2, X } from "lucide-react";
import { HEALTH_META, initials, type System } from "../data/systems";
import { formatDate } from "../time";
import { DateLine, ProgressBar, ScheduleChip, StatusPill, updatedText } from "./SystemCard";

interface Props {
  system: System | null;
  now: number;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export default function SystemDrawer({ system, now, onClose, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);

  // Opening a different system never starts in the "are you sure?" state.
  useEffect(() => setConfirming(false), [system?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!system) return null;
  const canOpen = system.status === "LIVE" || system.status === "COMPLETED";

  return (
    <div className="backdrop drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={system.name}>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <h2>{system.name}</h2>
        <div className="drawer-pills">
          <StatusPill status={system.status} />
          {system.health && <span className="pill fill-light">{system.health}</span>}
        </div>
        <p className="drawer-desc">{system.description}</p>

        <section className="panel">
          <ProgressBar value={system.progress} />
          <div className="card-row">
            <DateLine system={system} now={now} />
            <ScheduleChip system={system} now={now} />
          </div>
        </section>

        <dl className="facts">
          <dt>Owner</dt>
          <dd>{system.owner}</dd>
          <dt>Started</dt>
          <dd>{formatDate(system.startedAt)}</dd>
          {system.finishedAt && (
            <>
              <dt>Delivered</dt>
              <dd>{formatDate(system.finishedAt)}</dd>
            </>
          )}
          {system.dueAt && (
            <>
              <dt>Due</dt>
              <dd>{formatDate(system.dueAt)}</dd>
            </>
          )}
          <dt>Last update</dt>
          <dd>
            {updatedText(system, now)} · {system.updatedBy ?? initials(system.owner)}
          </dd>
          <dt>Engagement</dt>
          <dd>{system.engagement.toLocaleString()} visits / 30 days</dd>
          <dt>Address</dt>
          <dd className="mono">{system.url}</dd>
        </dl>
        {system.health && <p className="health-note">{HEALTH_META[system.health]}</p>}

        <a
          className={`btn btn-navy block ${canOpen ? "" : "disabled"}`}
          href={canOpen ? system.url : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!canOpen}
        >
          {canOpen ? "Open system" : "Not live yet"} {canOpen && <ArrowUpRight size={16} />}
        </a>

        {confirming ? (
          <div className="confirm" role="alertdialog" aria-label="Confirm delete">
            <p>
              Delete <b>{system.name}</b>? It will be removed from the tracker along with its progress updates.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => onDelete(system.id)}>
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        ) : (
          <button className="delete-link" onClick={() => setConfirming(true)}>
            <Trash2 size={15} /> Delete system
          </button>
        )}
      </aside>
    </div>
  );
}
