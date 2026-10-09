import { useEffect, useState } from "react";
import { ArrowUpRight, BellRing, Pencil, Trash2, X } from "lucide-react";
import { HEALTH_META, initials, type System } from "../data/systems";
import type { UpdateRequest, User } from "../data/roles";
import { formatDate, timeAgo } from "../time";
import LeadContact from "./LeadContact";
import { DateLine, ProgressBar, ScheduleChip, StatusPill, updatedText } from "./SystemCard";

interface Props {
  system: System | null;
  now: number;
  me: User;
  users: User[];
  requests: UpdateRequest[]; // open requests for this system
  canUpdate: boolean;
  canManage: boolean;
  canRequest: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: (id: string) => Promise<void>;
  onChangeLead: (id: string, lead: string) => Promise<void>;
  onRequest: (id: string, message: string) => Promise<void>;
  onDismiss: (requestId: string) => Promise<void>;
}

export default function SystemDrawer(p: Props) {
  const { system, now, me, users } = p;
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Opening a different system resets the panel's in-progress actions.
  useEffect(() => {
    setConfirming(false);
    setAsking(false);
    setMessage("");
    setError("");
  }, [system?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  if (!system) return null;
  const canOpen = system.status === "LIVE" || system.status === "COMPLETED";
  const lead = users.find((u) => u.id === system.lead);
  const developers = users.filter((u) => u.role === "developer" && u.projectId === system.id);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "Someone";
  const attempt = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <div className="backdrop drawer-backdrop" onClick={p.onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={system.name}>
        <button className="close-btn" onClick={p.onClose} aria-label="Close">
          <X size={18} />
        </button>

        <h2>{system.name}</h2>
        <div className="drawer-pills">
          <StatusPill status={system.status} />
          {system.health && <span className="pill fill-light">{system.health}</span>}
        </div>
        <p className="drawer-desc">{system.description}</p>
        {error && <p className="form-error">{error}</p>}

        <section className="panel">
          <ProgressBar value={system.progress} />
          <div className="card-row">
            <DateLine system={system} now={now} />
            <ScheduleChip system={system} now={now} />
          </div>
          {p.canUpdate && (
            <button className="btn btn-amber" onClick={p.onUpdate}>
              <Pencil size={15} /> Update progress
            </button>
          )}
        </section>

        {(p.requests.length > 0 || p.canRequest) && (
          <section className="requests">
            {p.requests.map((r) => (
              <div key={r.id} className="request">
                <BellRing size={16} />
                <div>
                  <b>
                    {nameOf(r.requestedBy)} requested an update · {timeAgo(r.createdAt, now)}
                  </b>
                  {r.message && <p>“{r.message}”</p>}
                </div>
                {(r.requestedBy === me.id || me.projectId === system.id || p.canManage) && (
                  <button className="link-btn" onClick={() => attempt(() => p.onDismiss(r.id))}>
                    Dismiss
                  </button>
                )}
              </div>
            ))}
            {p.canRequest &&
              (asking ? (
                <form
                  className="request-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    attempt(async () => {
                      await p.onRequest(system.id, message.trim());
                      setAsking(false);
                      setMessage("");
                    });
                  }}
                >
                  <textarea
                    rows={2}
                    autoFocus
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What do you need to know? (optional)"
                  />
                  <div className="confirm-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-navy">
                      Send request
                    </button>
                  </div>
                </form>
              ) : (
                <button className="btn btn-ghost block-sm" onClick={() => setAsking(true)}>
                  <BellRing size={15} /> Request update
                </button>
              ))}
          </section>
        )}

        <section className="lead-card">
          <div className="lead-head">
            <span className="avatar lg">{lead ? initials(lead.name) : "?"}</span>
            <div className="lead-who">
              <span className="lead-label">Project lead</span>
              <b>{lead ? lead.name : "Not assigned"}</b>
              {lead?.title && <span className="lead-title">{lead.title}</span>}
            </div>
          </div>
          {lead && <LeadContact person={lead} about={system.name} />}
          {p.canManage && (
            <label className="lead-change">
              <span>{lead ? "Change lead" : "Assign a lead"}</span>
              <select value={system.lead ?? ""} onChange={(e) => attempt(() => p.onChangeLead(system.id, e.target.value))}>
                {!lead && <option value="">Choose…</option>}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.title ? ` · ${u.title}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <dl className="facts">
          <dt>Developers</dt>
          <dd>{developers.length ? developers.map((d) => d.name).join(", ") : "None assigned"}</dd>
          <dt>Team</dt>
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
          <dd className="mono">{system.url || "—"}</dd>
        </dl>
        {system.health && <p className="health-note">{HEALTH_META[system.health]}</p>}

        <a
          className={`btn btn-navy block ${canOpen && system.url ? "" : "disabled"}`}
          href={canOpen && system.url ? system.url : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!canOpen}
        >
          {canOpen ? "Open system" : "Not live yet"} {canOpen && <ArrowUpRight size={16} />}
        </a>

        {p.canManage &&
          (confirming ? (
            <div className="confirm" role="alertdialog" aria-label="Confirm delete">
              <p>
                Delete <b>{system.name}</b>? It will be removed for everyone, along with its update requests.
              </p>
              <div className="confirm-actions">
                <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={() => attempt(() => p.onDelete(system.id))}>
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </div>
          ) : (
            <button className="delete-link" onClick={() => setConfirming(true)}>
              <Trash2 size={15} /> Delete system
            </button>
          ))}
      </aside>
    </div>
  );
}
