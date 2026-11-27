/** @import { User } from '../data/roles' */
/** @import { TemplateDefinition } from '../data/lifecycle' */
// Pipeline: every project with a lifecycle, by stage, grouped by phase (GET /api/lifecycle/pipeline). Filter by
// phase, lead and workspace. A red edge is an overdue stage, amber a project that has been sent back; closed
// projects collapse into one count. Each card opens the project's Lifecycle tab.
import { useEffect, useMemo, useState } from "react";
import { Milestone } from "lucide-react";
import { api } from "../data/api";

/**
 * @typedef {Object} PipelineProject
 * @property {string} id
 * @property {string} name
 * @property {string | null} lead
 * @property {string | null} workspace
 * @property {string} templateId
 * @property {string} stage
 * @property {string | null} phase
 * @property {"active" | "closed"} state
 * @property {string} enteredAt
 * @property {number} progress
 * @property {boolean} sentBack
 * @property {{ dueAt: string; usedDays: number; state: "running" | "warning" | "overdue" } | null} sla
 */

/** @param {{ users: User[] }} p */
export default function PipelinePage({ users }) {
  const [data, setData] = useState(/** @type {{ templates: { id: string; definition: TemplateDefinition }[]; projects: PipelineProject[] } | null} */ (null));
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const [lead, setLead] = useState("");
  const [workspace, setWorkspace] = useState("");
  useEffect(() => {
    api("/lifecycle/pipeline")
      .then((r) => setData(/** @type {any} */ (r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the pipeline"));
  }, []);
  const def = data?.templates[0]?.definition ?? null;
  const shown = useMemo(
    () => (data?.projects ?? []).filter((p) => (!phase || p.phase === phase) && (!lead || p.lead === lead) && (!workspace || p.workspace === workspace)),
    [data, phase, lead, workspace],
  );
  const nameOf = (/** @type {string | null} */ id) => users.find((u) => u.id === id)?.name ?? "No lead";
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading the pipeline…</p>;
  const leads = [...new Set(data.projects.map((p) => p.lead).filter(Boolean))];
  const spaces = [...new Set(data.projects.map((p) => p.workspace).filter(Boolean))];
  const active = shown.filter((p) => p.state === "active");
  const closed = shown.filter((p) => p.state === "closed").length;
  return (
    <div className="pipe-page">
      <header className="dash-head">
        <div>
          <h2>
            <Milestone size={22} aria-hidden="true" /> Pipeline
          </h2>
          <p>
            Every project by lifecycle stage. {active.length} active, {active.filter((p) => p.sla?.state === "overdue").length} overdue, {closed} closed.
          </p>
        </div>
      </header>
      {!def ? (
        <p className="muted">No project is on a lifecycle yet. An administrator sets one up in Settings → Project Lifecycle.</p>
      ) : (
        <>
          <div className="pipe-filters" role="group" aria-label="Filter the pipeline">
            <span className="seg" role="group" aria-label="Phase">
              <button className={!phase ? "on" : ""} aria-pressed={!phase} onClick={() => setPhase("")}>
                All phases
              </button>
              {def.phases.map((p) => (
                <button key={p.code} className={phase === p.code ? "on" : ""} aria-pressed={phase === p.code} onClick={() => setPhase(phase === p.code ? "" : p.code)}>
                  {p.code} · {p.name}
                </button>
              ))}
            </span>
            <select value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Lead">
              <option value="">Any lead</option>
              {leads.map((l) => (
                <option key={l} value={/** @type {string} */ (l)}>
                  {nameOf(l)}
                </option>
              ))}
            </select>
            {spaces.length > 1 && (
              <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} aria-label="Workspace">
                <option value="">Every workspace</option>
                {spaces.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
            )}
          </div>
          <div className="pipe" role="list" aria-label="Stages">
            {def.phases
              .filter((ph) => !phase || ph.code === phase)
              .map((ph) => (
                <section key={ph.code} className="pipe-phase" aria-label={ph.name}>
                  <small>
                    {ph.code} · {ph.name}
                  </small>
                  <div className="pipe-cols">
                    {def.stages
                      .filter((s) => s.phase === ph.code)
                      .map((s) => {
                        const here = active.filter((p) => p.stage === s.code);
                        return (
                          <div key={s.code} className="pipe-col" role="listitem">
                            <h4>
                              {s.name} <span>{here.length}</span>
                            </h4>
                            {here.map((p) => (
                              <a key={p.id} href={`#/projects/${p.id}/lifecycle`} className={`pipe-card ${p.sla?.state === "overdue" ? "late" : ""} ${p.sentBack ? "back" : ""}`}>
                                <b>{p.name}</b>
                                <span className="pipe-meta">
                                  <span>{nameOf(p.lead)}</span>
                                  <span>{p.sla ? (p.sla.state === "overdue" ? `${Math.round((p.sla.usedDays - (s.targetDays ?? 0)) * 10) / 10} days over` : `day ${Math.max(1, Math.ceil(p.sla.usedDays))} of ${s.targetDays}`) : ""}</span>
                                </span>
                                <span className="pipe-bar" aria-label={`${p.progress}% done`}>
                                  <i style={{ width: `${Math.min(100, p.progress)}%` }} />
                                </span>
                              </a>
                            ))}
                          </div>
                        );
                      })}
                    {ph.code === def.phases[def.phases.length - 1].code && closed > 0 && <div className="pipe-closed">{closed} closed (Live / Completed)</div>}
                  </div>
                </section>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
