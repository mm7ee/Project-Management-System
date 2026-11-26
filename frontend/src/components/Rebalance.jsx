/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { Feature } from '../data/features' */
/** @import { Limits, Suggestion } from '../data/project' */
import { useEffect, useState } from "react";
import { ArrowLeft, AlertOctagon, ArrowRightLeft, UserMinus, UserPlus, X } from "lucide-react";
import { initials } from "../data/systems";
import { suggestDevelopers, workloadOf } from "../data/project";
/**
 * Who could take a project over from an overloaded developer. "Hand over" swaps them;
 * "Add" brings someone in alongside; "Remove" takes the overloaded developer off.
 * @param {{
 *   system: System;
 *   from: User; // the overloaded developer
 *   suggestions: Suggestion[];
 *   teamIds: string[]; // everyone currently on the project
 *   busy: boolean;
 *   onSave: (ids: string[]) => void;
 * }} props
 */
export function HandoverSuggestions({ system, from, suggestions, teamIds, busy, onSave }) {
  const without = teamIds.filter((id) => id !== from.id);
  return (
    <div className="handover">
      {suggestions.length ? (
        <ul>
          {suggestions.map((s) => (
            <li key={s.user.id}>
              <span className="avatar">{initials(s.user.name)}</span>
              <span className="handover-who">
                <b>{s.user.name}</b>
                <small className={s.why === "No projects" ? "text-green" : ""}>{s.why}</small>
              </span>
              <button className="btn btn-navy sm" disabled={busy} title={`Take ${from.name} off ${system.name} and put ${s.user.name} on it`} onClick={() => onSave([...without, s.user.id])}>
                <ArrowRightLeft size={14} /> Hand over
              </button>
              <button className="btn btn-ghost sm" disabled={busy} title={`Add ${s.user.name} to ${system.name} alongside ${from.name}`} onClick={() => onSave([...teamIds, s.user.id])}>
                <UserPlus size={14} /> Add
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead-none">Every other developer is at or over the limit too.</p>
      )}
      <button className="btn btn-ghost sm danger-text" disabled={busy} onClick={() => onSave(without)}>
        <UserMinus size={14} /> Remove {from.name} from {system.name}
      </button>
    </div>
  );
}
/**
 * Every overloaded developer and their projects, with suggestions for each, so an admin or
 * manager can spread the work in one place.
 * @param {{
 *   users: User[];
 *   systems: System[];
 *   features: Feature[];
 *   limits: Limits;
 *   now: number;
 *   onSave: (systemId: string, developers: string[]) => Promise<void>;
 *   onClose: () => void;
 * }} props
 */
export default function RebalanceModal({ users, systems, features, limits, now, onSave, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(/** @type {string | null | (() => string | null)} */ (null)); // "devId:systemId" being handed over
  useEffect(() => {
    const onKey = /** @param {KeyboardEvent} e */ (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const overloaded = users
    .filter((u) => u.role === "developer")
    .map((u) => ({ user: u, load: workloadOf(u, systems, features, limits, now) }))
    .filter((x) => x.load.overloaded)
    .sort((a, b) => b.load.projects - a.load.projects);
  const teamOf = /** @param {System} s */ (s) => users.filter((u) => u.role === "developer" && u.projectIds?.includes(s.id)).map((u) => u.id);
  const save = /** @param {string} systemId @param {string[]} ids */ async (systemId, ids) => {
    setBusy(true);
    setError("");
    try {
      await onSave(systemId, ids);
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide rebalance" role="dialog" aria-label="Rebalance workload" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <button type="button" className="modal-back" onClick={onClose} aria-label="Back to the previous page (nothing is saved)">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <h2>Rebalance workload</h2>
        <p className="modal-note">
          Developers with more than {limits.projects} projects or {limits.features} open client requests. Hand a project to someone with fewer, add help, or take them off it.
        </p>
        {error && <p className="form-error">{error}</p>}

        {overloaded.length ? (
          overloaded.map(({ user, load }) => (
            <section key={user.id} className="rebalance-dev">
              <header>
                <span className="avatar md">{initials(user.name)}</span>
                <div>
                  <b>{user.name}</b>
                  <span className="flag flag-overload">
                    <AlertOctagon size={12} /> Too many: {load.reasons.join("; ")}
                  </span>
                </div>
              </header>
              <ul className="rebalance-projects">
                {systems
                  .filter((s) => user.projectIds?.includes(s.id))
                  .map((s) => {
                    const key = `${user.id}:${s.id}`;
                    return (
                      <li key={s.id}>
                        <div className="rebalance-row">
                          <span>
                            <b>{s.name}</b> <small>· {s.progress}%</small>
                          </span>
                          <button className="btn btn-ghost sm" onClick={() => setOpen(open === key ? null : key)}>
                            {open === key ? "Close" : "Rebalance"}
                          </button>
                        </div>
                        {open === key && <HandoverSuggestions system={s} from={user} suggestions={suggestDevelopers(users, systems, features, limits, now, s.id)} teamIds={teamOf(s)} busy={busy} onSave={(ids) => save(s.id, ids)} />}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        ) : (
          <p className="form-ok">Nobody is over the limit now.</p>
        )}

        <div className="modal-actions">
          <button className="btn btn-navy" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
