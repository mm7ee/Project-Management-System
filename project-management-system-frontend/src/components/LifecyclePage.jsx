/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { Stage, TemplateDefinition, GateResult } from '../data/lifecycle' */
// A project's lifecycle (worker/lifecycle.js): the stage tracker, grouped by phase, and the panel of the stage picked
// (the current one by default): what its gate still needs, the checklist, deliverables and their versions, sign-offs,
// the registers it reads (risks, security findings, tests, environments, the deployment record), requests waiting for
// a decision, and the history. Advance is enabled only when the gate is met; otherwise it lists what is missing, as
// the server decides it.
import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, CornerUpLeft, FastForward, FileUp, History, Lock, PenLine, RotateCcw, ShieldAlert, X } from "lucide-react";
import { ApiError, api, uploadDocument } from "../data/api";
import { ACTOR_LABEL, STAGE_TYPE_LABEL, riskRating, stageOf } from "../data/lifecycle";
import { formatDate, timeAgo } from "../time";

/**
 * @typedef {Object} LifecycleView  GET /api/systems/:id/lifecycle (worker/lifecycle.js lifecycleView)
 * @property {{ id: string; name: string; version: number; definition: TemplateDefinition }} template
 * @property {string} stage
 * @property {string} enteredAt
 * @property {"active" | "closed"} state
 * @property {boolean} migrated
 * @property {{ dueAt: string; usedDays: number; state: "running" | "warning" | "overdue" } | null} sla
 * @property {GateResult[]} gate
 * @property {boolean} ready
 * @property {{ code: string; name: string } | null} next
 * @property {number} progress
 * @property {string[]} sentBackFrom
 * @property {Record<string, string>} visited
 * @property {{ advance: boolean; sendBack: boolean; skip: boolean; decideRequests: boolean; requestSignoff: boolean; edit: boolean; acceptRisk: boolean }} can
 * @property {any[]} history
 * @property {any[]} checklist
 * @property {any[]} signoffs
 * @property {any[]} requests
 * @property {any[]} documents
 * @property {Record<string, any>} records
 * @property {any[]} risks
 * @property {any[]} findings
 * @property {any[]} tests
 * @property {Record<string, { total: number; pass: number; fail: number; blocked: number; notRun: number }>} testSummary
 * @property {any[]} environments
 * @property {{ signatories: any[]; missing: string[] } | null} pcn
 */

/**
 * The stages, grouped by phase: done, current, sent back from, overdue, upcoming.
 * @param {{ view: LifecycleView; picked?: string; onPick?: (code: string) => void; compact?: boolean }} p
 */
export function StageTracker({ view, picked, onPick, compact = false }) {
  const def = view.template.definition;
  const at = def.stages.findIndex((s) => s.code === view.stage);
  const closed = view.state === "closed";
  return (
    <div className={`lc-tracker ${compact ? "compact" : ""}`} role="list" aria-label="Lifecycle stages">
      {def.phases.map((ph) => {
        const stages = def.stages.map((s, i) => ({ s, i })).filter((x) => x.s.phase === ph.code);
        if (!stages.length) return null;
        const here = !closed && stages.some((x) => x.s.code === view.stage);
        return (
          <div key={ph.code} className={`lc-phase ${here ? "here" : ""}`}>
            <small>
              {ph.code} · {ph.name}
            </small>
            <div className="lc-steps">
              {stages.map(({ s, i }) => {
                const state = closed || i < at ? "done" : i === at ? "current" : "upcoming";
                const back = view.sentBackFrom.includes(s.code) && state !== "done";
                const late = state === "current" && view.sla?.state === "overdue";
                const label = `${s.name}: ${state === "done" ? "done" : state === "current" ? "current stage" : "upcoming"}${back ? ", sent back before" : ""}${late ? ", overdue" : ""}`;
                return (
                  <button
                    key={s.code}
                    type="button"
                    role="listitem"
                    className={`lc-step ${state} ${back ? "back" : ""} ${late ? "late" : ""} ${picked === s.code ? "picked" : ""}`}
                    aria-label={label}
                    aria-current={state === "current" ? "step" : undefined}
                    onClick={() => onPick?.(s.code)}
                    disabled={!onPick}
                  >
                    <span className="lc-dot" aria-hidden="true">
                      {state === "done" ? <Check size={14} strokeWidth={3} /> : back ? <RotateCcw size={13} /> : i + 1}
                    </span>
                    {!compact && <span className="lc-name">{s.name}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The project's place in its lifecycle, small, on the Overview: the tracker, the current stage and how long it has
 * been there, linking to the Lifecycle tab. Nothing when the project has no lifecycle.
 * @param {{ systemId: string }} p
 */
export function LifecycleStrip({ systemId }) {
  const [view, setView] = useState(/** @type {LifecycleView | null} */ (null));
  useEffect(() => {
    api(`/systems/${systemId}/lifecycle`)
      .then((r) => setView(/** @type {{ lifecycle: LifecycleView | null }} */ (r).lifecycle))
      .catch(() => setView(null));
  }, [systemId]);
  if (!view) return null;
  const stage = /** @type {Stage} */ (stageOf(view.template.definition, view.stage));
  return (
    <a className="lc-strip" href={`#/projects/${systemId}/lifecycle`} aria-label={`Lifecycle: ${view.state === "closed" ? "closed" : stage.name}. Open the Lifecycle tab`}>
      <span className="lc-strip-text">
        <b>{view.state === "closed" ? "Closed" : stage.name}</b>
        <small className={view.sla?.state === "overdue" ? "bad" : ""}>{slaText(view, stage)}</small>
      </span>
      <StageTracker view={view} compact />
    </a>
  );
}

/** "day 6 of 5 business days · 1 day over" @param {LifecycleView} v @param {Stage} s */
function slaText(v, s) {
  if (v.state === "closed") return "Closed";
  if (!v.sla || !s.targetDays) return `In this stage since ${formatDate(v.enteredAt)}`;
  const over = v.sla.usedDays - s.targetDays;
  return `${v.sla.usedDays} of ${s.targetDays} business days${over > 0 ? ` · ${Math.round(over * 10) / 10} over` : ` · due ${new Date(v.sla.dueAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}`;
}

/**
 * @param {{ system: System; me: User; users: User[]; now: number; readOnly?: boolean; onChanged?: () => void }} p
 */
export default function LifecyclePage({ system, me, users, now, readOnly = false, onChanged }) {
  const [view, setView] = useState(/** @type {LifecycleView | null | undefined} */ (undefined));
  const [start, setStart] = useState(/** @type {{ defaultTemplate: { id: string; name: string } | null; canStart: boolean } | null} */ (null));
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(/** @type {string[]} */ ([]));
  const base = `/systems/${system.id}/lifecycle`;
  const take = (/** @type {any} */ r) => {
    setView(r.lifecycle);
    if (!r.lifecycle) setStart({ defaultTemplate: r.defaultTemplate, canStart: r.canStart });
    else setPicked((x) => x || r.lifecycle.stage);
  };
  useEffect(() => {
    // Another project: start again from its own current stage.
    setView(undefined);
    setPicked("");
    setError("");
    api(base)
      .then(take)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the lifecycle"));
  }, [base]);
  /** Calls the API and shows the new state (or what went wrong, and what's missing). @param {string} path @param {string} method @param {unknown} [body] */
  const call = async (path, method, body) => {
    setBusy(true);
    setError("");
    setMissing([]);
    try {
      const r = await api(`${base}${path}`, method, body);
      take(r);
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't do that");
      if (e instanceof ApiError && Array.isArray(e.payload.missing)) setMissing(/** @type {string[]} */ (e.payload.missing));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (view === undefined) return <p className="muted">{error || "Loading the lifecycle…"}</p>;
  if (view === null) {
    return (
      <section className="lc-empty p-card">
        <h3>No lifecycle yet</h3>
        <p className="muted">
          {start?.defaultTemplate ? `This project isn't on ${start.defaultTemplate.name} yet.` : "Your organisation hasn't set up a project lifecycle yet (Settings → Project Lifecycle)."}
        </p>
        {start?.canStart && start.defaultTemplate && !readOnly && (
          <button className="btn btn-navy sm" disabled={busy} onClick={() => call("/start", "POST", {})}>
            Start {start.defaultTemplate.name}
          </button>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }
  const def = view.template.definition;
  const current = /** @type {Stage} */ (stageOf(def, view.stage));
  const stage = stageOf(def, picked) ?? current;
  const isCurrent = stage.code === current.code && view.state === "active";
  const phase = def.phases.find((p) => p.code === stage.phase);
  const nameOf = (/** @type {string | null | undefined} */ id) => users.find((u) => u.id === id)?.name ?? id ?? "";

  return (
    <div className="lc">
      <header className="lc-head">
        <div>
          <b>{view.template.name}</b> <span className="muted">v{view.template.version}</span>
          {view.migrated && <span className="lc-tag">migrated</span>}
        </div>
        <div className="lc-head-facts">
          <span className={`lc-pill ${view.state === "closed" ? "ok" : view.sla?.state === "overdue" ? "bad" : view.sla?.state === "warning" ? "warn" : "info"}`}>
            {view.state === "closed" ? "Closed" : `${current.name} · ${slaText(view, current)}`}
          </span>
          <span className="lc-pill info">Lifecycle progress {view.progress}%</span>
        </div>
      </header>
      <StageTracker view={view} picked={stage.code} onPick={setPicked} />

      <section className="lc-panel" aria-label={`${stage.name} stage`}>
        <header className="lc-panel-head">
          <h3>
            {def.stages.indexOf(stage) + 1} · {stage.name}
          </h3>
          <span className="lc-pill info">{STAGE_TYPE_LABEL[stage.type]}</span>
          <span className="lc-pill info">{phase?.name}</span>
          {stage.targetDays && <span className="lc-pill">Target {stage.targetDays} business days</span>}
          <span className="muted">Responsible: {stage.responsible.map((a) => ACTOR_LABEL[a]).join(", ") || "—"}</span>
        </header>

        <div className="lc-grid">
          <div className="lc-col">
            {isCurrent ? <Gate gate={view.gate} /> : <PlainGate stage={stage} done={view.state === "closed" || def.stages.indexOf(stage) < def.stages.indexOf(current)} />}
            {isCurrent && stage.exit.some((c) => c.kind === "checklist") && <Checklist stage={stage} view={view} disabled={readOnly || busy} call={call} />}
            {(stage.deliverables.length > 0 || stage.exit.some((c) => c.kind === "pcn_complete")) && <Deliverables system={system} stage={stage} view={view} current={isCurrent} disabled={readOnly || busy || !view.can.edit} call={call} base={base} setError={setError} />}
            {stage.signoff && <Signoffs stage={stage} view={view} me={me} current={isCurrent} disabled={readOnly || busy} call={call} systemId={system.id} />}
            {stage.exit.some((c) => c.kind === "risk_register" || c.kind === "risks_mitigated") && <Risks view={view} users={users} disabled={readOnly || busy || !view.can.edit} call={call} nameOf={nameOf} />}
            {stage.exit.some((c) => c.kind === "security_clear") && <Findings view={view} disabled={readOnly || busy || !view.can.edit} call={call} now={now} />}
            {(stage.testing || stage.exit.some((c) => c.kind === "test_pass_rate")) && <Tests view={view} suite={stage.testing?.suite ?? stage.exit.find((c) => c.kind === "test_pass_rate")?.suite ?? "QAT"} disabled={readOnly || busy || !view.can.edit} call={call} />}
            {stage.exit.some((c) => c.kind === "environments") && <Environments view={view} required={stage.exit.find((c) => c.kind === "environments")?.required ?? []} disabled={readOnly || busy || !view.can.edit} call={call} />}
            {stage.exit.some((c) => c.kind === "deployment_recorded" || c.kind === "change_approved") && <Deployment view={view} disabled={readOnly || busy || !view.can.edit} call={call} />}
          </div>
          <div className="lc-col">
            {isCurrent && !readOnly && <Actions stage={stage} view={view} busy={busy} call={call} error={error} missing={missing} />}
            {!isCurrent && error && <p className="form-error">{error}</p>}
            <Requests view={view} me={me} disabled={readOnly || busy} call={call} />
            <HistoryList view={view} def={def} now={now} code={stage.code} />
          </div>
        </div>
      </section>
    </div>
  );
}

/** @param {{ gate: GateResult[] }} p */
function Gate({ gate }) {
  return (
    <div className="lc-box">
      <h4>Exit criteria</h4>
      <ul className="lc-list">
        {gate.map((g) => (
          <li key={g.label} className={g.ok ? "ok" : "no"}>
            <span className="lc-tick" aria-hidden="true">
              {g.ok ? <Check size={13} strokeWidth={3} /> : <X size={13} />}
            </span>
            <span>
              {g.label}
              {!g.ok && g.missing && <small>{g.missing}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
/** A stage that isn't the current one: its criteria, as words. @param {{ stage: Stage; done: boolean }} p */
function PlainGate({ stage, done }) {
  return (
    <div className="lc-box">
      <h4>Exit criteria {done ? "(passed)" : "(upcoming)"}</h4>
      <ul className="lc-list">
        {stage.exit.map((c) => (
          <li key={c.label} className={done ? "ok" : ""}>
            <span className="lc-tick" aria-hidden="true">
              {done ? <Check size={13} strokeWidth={3} /> : "·"}
            </span>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** @param {{ stage: Stage; view: LifecycleView; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean> }} p */
function Checklist({ stage, view, disabled, call }) {
  return (
    <div className="lc-box">
      <h4>Checklist</h4>
      <ul className="lc-list">
        {stage.exit
          .filter((c) => c.kind === "checklist")
          .map((c) => {
            const done = view.checklist.find((x) => x.stage_code === stage.code && x.key === c.key);
            return (
              <li key={c.key}>
                <label className="lc-check">
                  <input type="checkbox" checked={!!done} disabled={disabled} onChange={(e) => call(`/checklist/${c.key}`, "PUT", { done: e.target.checked })} />
                  <span>
                    {c.label}
                    {c.by?.length ? <small>By: {c.by.map((a) => ACTOR_LABEL[a]).join(" or ")}</small> : null}
                    {done && (
                      <small>
                        {done.done_name} · {formatDate(done.done_at)}
                      </small>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

/**
 * The stage's deliverables: each version, locked once signed; upload a new version or use a project document.
 * @param {{ system: System; stage: Stage; view: LifecycleView; current: boolean; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean>; base: string; setError: (s: string) => void }} p
 */
function Deliverables({ system, stage, view, current, disabled, call, setError }) {
  const linked = stage.exit.find((c) => c.kind === "linked");
  const free = view.documents.filter((d) => !d.deliverable_key);
  const [pick, setPick] = useState(/** @type {Record<string, string>} */ ({}));
  return (
    <div className="lc-box">
      <h4>Deliverables</h4>
      {stage.exit.some((c) => c.kind === "pcn_complete") && (
        <div className="lc-doc">
          <span className="lc-ico">PCN</span>
          <div>
            Project Concept Note
            <small>{view.pcn ? (view.pcn.missing.length ? `To complete: ${view.pcn.missing.join(", ")}` : "Complete") : "Not written yet"}</small>
          </div>
          <a className="btn btn-ghost sm" href={`#/projects/${system.id}/pcn`}>
            Open
          </a>
        </div>
      )}
      {stage.deliverables
        .filter((d) => d.source === "document")
        .map((d) => {
          const versions = view.documents.filter((x) => x.deliverable_key === d.key).sort((a, b) => b.version - a.version);
          return (
            <div key={d.key} className="lc-deliv">
              <b>{d.name}</b>
              {versions.length === 0 && <p className="muted">Not attached yet.</p>}
              {versions.map((v) => (
                <div key={v.id} className="lc-doc">
                  <span className="lc-ico">{d.key.slice(0, 3).toUpperCase()}</span>
                  <div>
                    {v.kind === "link" ? (
                      <a href={v.url} target="_blank" rel="noreferrer">
                        {v.name}
                      </a>
                    ) : (
                      <a href={`/api/documents/${v.id}`} target="_blank" rel="noreferrer">
                        {v.name}
                      </a>
                    )}{" "}
                    <b>v{v.version}</b>
                    <small>
                      {v.uploaded_name} · {formatDate(v.uploaded_at)}
                    </small>
                  </div>
                  {v.locked_at ? (
                    <span className="lc-pill ok">
                      <Lock size={12} /> Signed · locked
                    </span>
                  ) : null}
                </div>
              ))}
              {current && !disabled && (
                <div className="lc-row">
                  <label className="btn btn-ghost sm">
                    <FileUp size={14} aria-hidden="true" /> Upload {versions.length ? `version ${versions[0].version + 1}` : "it"}
                    <input
                      type="file"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const up = await uploadDocument(system.id, f);
                          if (up.id) await call("/deliverables", "POST", { documentId: up.id, key: d.key, ...(linked?.from === d.key ? { linkedTo: linked.to } : {}) });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Couldn't upload it");
                        }
                      }}
                    />
                  </label>
                  {free.length > 0 && (
                    <>
                      <select value={pick[d.key] ?? ""} onChange={(e) => setPick({ ...pick, [d.key]: e.target.value })} aria-label={`Use a project document as the ${d.name}`}>
                        <option value="">…or use a project document</option>
                        {free.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      {pick[d.key] && (
                        <button className="btn btn-ghost sm" onClick={() => call("/deliverables", "POST", { documentId: pick[d.key], key: d.key, ...(linked?.from === d.key ? { linkedTo: linked.to } : {}) })}>
                          Use it
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

/**
 * The current round of sign-offs; the signatory approves or declines here.
 * @param {{ stage: Stage; view: LifecycleView; me: User; current: boolean; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean>; systemId: string }} p
 */
function Signoffs({ stage, view, me, current, disabled, call, systemId }) {
  const [comment, setComment] = useState("");
  if (stage.signoff?.source === "pcn_signatories") {
    return (
      <div className="lc-box">
        <h4>
          <PenLine size={15} aria-hidden="true" /> Sign-offs: the Concept Note's signatories
        </h4>
        <SignTable rows={(view.pcn?.signatories ?? []).map((s) => ({ key: s.name, name: s.name, label: s.primary ? "Primary" : "Signatory", status: s.status.toLowerCase(), when: s.date, comment: s.remarks }))} />
        <a className="btn btn-ghost sm" href={`#/projects/${systemId}/pcn`}>
          Open the Concept Note to sign
        </a>
      </div>
    );
  }
  const rows = view.signoffs.filter((s) => s.stage_code === stage.code);
  const round = rows.reduce((m, r) => Math.max(m, r.round), 0);
  const now = rows.filter((r) => r.round === round);
  const mine = current ? now.find((r) => r.signer_id === me.id && r.status === "pending") : null;
  return (
    <div className="lc-box">
      <h4>
        <PenLine size={15} aria-hidden="true" /> Sign-offs {round ? `(round ${round})` : ""} · all must approve
      </h4>
      {now.length ? (
        <SignTable rows={now.map((r) => ({ key: r.id, name: r.signer_name, label: r.label, status: r.status, when: r.decided_at ?? (r.reminded_at ? `reminded ${formatDate(r.reminded_at)}` : null), comment: r.comment, version: r.document_version }))} />
      ) : (
        <p className="muted">Not requested yet.</p>
      )}
      {!view.template.definition.settings.selfSignoff && now.length > 0 && <p className="muted small">Whoever submitted the document can't sign it; their alternate signs instead.</p>}
      {mine && (
        <div className="lc-sign">
          <b>Your sign-off{mine.document_version ? ` (version ${mine.document_version})` : ""}</b>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required to decline)" maxLength={1000} />
          <div className="lc-row">
            <button className="btn btn-navy sm" disabled={disabled} onClick={() => call(`/signoffs/${mine.id}`, "POST", { decision: "approve", comment })}>
              Approve
            </button>
            <button className="btn btn-ghost sm" disabled={disabled || comment.trim().length < 3} onClick={() => call(`/signoffs/${mine.id}`, "POST", { decision: "decline", comment })}>
              Decline
            </button>
          </div>
        </div>
      )}
      {current && view.can.requestSignoff && (
        <div className="lc-row">
          <button className="btn btn-ghost sm" disabled={disabled} onClick={() => call("/signoffs", "POST", {})}>
            {round ? "Request sign-off again" : "Request sign-off"}
          </button>
          {now.some((r) => r.status === "pending") && (
            <button className="btn btn-ghost sm" disabled={disabled} onClick={() => call("/remind", "POST", {})}>
              Remind signatories
            </button>
          )}
        </div>
      )}
    </div>
  );
}
/** @param {{ rows: { key: string; name: string; label: string; status: string; when?: string | null; comment?: string; version?: number }[] }} p */
function SignTable({ rows }) {
  if (!rows.length) return <p className="muted">No signatories.</p>;
  return (
    <table className="lc-table">
      <thead>
        <tr>
          <th>Signatory</th>
          <th>As</th>
          <th>Status</th>
          <th>When</th>
          <th>Comment</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.name}</td>
            <td>
              {r.label}
              {r.version ? ` · v${r.version}` : ""}
            </td>
            <td>
              <span className={`lc-pill ${r.status === "approved" ? "ok" : r.status === "declined" ? "bad" : "warn"}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
            </td>
            <td>{r.when ? (/^\d{4}-\d{2}-\d{2}/.test(r.when) ? formatDate(r.when) : r.when) : "—"}</td>
            <td>{r.comment || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** @param {{ view: LifecycleView; users: User[]; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean>; nameOf: (id: string) => string }} p */
function Risks({ view, users, disabled, call }) {
  const [d, setD] = useState({ risk: "", likelihood: 3, impact: 3, ownerId: "", mitigation: "" });
  return (
    <div className="lc-box">
      <h4>
        <ShieldAlert size={15} aria-hidden="true" /> Risk register
      </h4>
      {view.risks.length ? (
        <table className="lc-table">
          <thead>
            <tr>
              <th>Risk</th>
              <th>L × I</th>
              <th>Rating</th>
              <th>Owner</th>
              <th>Mitigation</th>
            </tr>
          </thead>
          <tbody>
            {view.risks.map((r) => (
              <tr key={r.id} className={r.status === "closed" ? "muted" : ""}>
                <td>{r.risk}</td>
                <td>
                  {r.likelihood} × {r.impact}
                </td>
                <td>
                  <span className={`lc-pill ${r.rating === "Critical" || r.rating === "High" ? "bad" : r.rating === "Medium" ? "warn" : "ok"}`}>{r.rating}</span>
                </td>
                <td>
                  <select value={r.owner_id ?? ""} disabled={disabled} onChange={(e) => call(`/risks/${r.id}`, "PATCH", { ownerId: e.target.value || null })} aria-label="Owner">
                    <option value="">No owner</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input defaultValue={r.mitigation} disabled={disabled} onBlur={(e) => e.target.value !== r.mitigation && call(`/risks/${r.id}`, "PATCH", { mitigation: e.target.value })} aria-label="Mitigation" placeholder="How it's reduced" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No risks recorded yet.</p>
      )}
      {!disabled && (
        <form
          className="lc-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("/risks", "POST", { ...d, ownerId: d.ownerId || null })) setD({ risk: "", likelihood: 3, impact: 3, ownerId: "", mitigation: "" });
          }}
        >
          <input value={d.risk} onChange={(e) => setD({ ...d, risk: e.target.value })} placeholder="New risk" required maxLength={500} />
          <label>
            Likelihood
            <select value={d.likelihood} onChange={(e) => setD({ ...d, likelihood: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Impact
            <select value={d.impact} onChange={(e) => setD({ ...d, impact: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <span className="lc-pill">{riskRating(d.likelihood, d.impact)}</span>
          <select value={d.ownerId} onChange={(e) => setD({ ...d, ownerId: e.target.value })} aria-label="Owner">
            <option value="">Owner…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input value={d.mitigation} onChange={(e) => setD({ ...d, mitigation: e.target.value })} placeholder="Mitigation" maxLength={1000} />
          <button className="btn btn-ghost sm">Add risk</button>
        </form>
      )}
    </div>
  );
}

/** @param {{ view: LifecycleView; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean>; now: number }} p */
function Findings({ view, disabled, call, now }) {
  const [d, setD] = useState({ title: "", severity: "High" });
  const [accepting, setAccepting] = useState(/** @type {{ id: string; reason: string; until: string } | null} */ (null));
  return (
    <div className="lc-box">
      <h4>Security findings</h4>
      {view.findings.length ? (
        <ul className="lc-list">
          {view.findings.map((f) => (
            <li key={f.id}>
              <span className={`lc-pill ${f.severity === "Critical" || f.severity === "High" ? "bad" : f.severity === "Medium" ? "warn" : "info"}`}>{f.severity}</span>
              <span>
                {f.title}
                <small>
                  {f.status === "accepted" ? `Risk accepted by ${f.accepted_name} until ${formatDate(f.accepted_until)}: ${f.accepted_reason}` : f.status === "fixed" ? "Fixed" : "Open"}
                  {f.status === "accepted" && f.accepted_until < new Date(now).toISOString().slice(0, 10) ? " (expired)" : ""}
                </small>
              </span>
              {!disabled && f.status !== "fixed" && (
                <button className="btn btn-ghost sm" onClick={() => call(`/findings/${f.id}`, "PATCH", { status: "fixed" })}>
                  Mark fixed
                </button>
              )}
              {!disabled && view.can.acceptRisk && f.status === "open" && (
                <button className="btn btn-ghost sm" onClick={() => setAccepting({ id: f.id, reason: "", until: "" })}>
                  Accept the risk…
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No findings recorded.</p>
      )}
      {accepting && (
        <form
          className="lc-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(`/findings/${accepting.id}/accept`, "POST", { reason: accepting.reason, until: accepting.until })) setAccepting(null);
          }}
        >
          <input value={accepting.reason} onChange={(e) => setAccepting({ ...accepting, reason: e.target.value })} placeholder="Why the risk is accepted" required />
          <label>
            Until
            <input type="date" value={accepting.until} onChange={(e) => setAccepting({ ...accepting, until: e.target.value })} required />
          </label>
          <button className="btn btn-navy sm">Accept the risk</button>
          <button type="button" className="btn btn-ghost sm" onClick={() => setAccepting(null)}>
            Cancel
          </button>
        </form>
      )}
      {!disabled && (
        <form
          className="lc-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("/findings", "POST", d)) setD({ title: "", severity: "High" });
          }}
        >
          <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="New finding" required maxLength={300} />
          <select value={d.severity} onChange={(e) => setD({ ...d, severity: e.target.value })} aria-label="Severity">
            {["Critical", "High", "Medium", "Low", "Info"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="btn btn-ghost sm">Add finding</button>
        </form>
      )}
    </div>
  );
}

/** @param {{ view: LifecycleView; suite: string; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean> }} p */
function Tests({ view, suite, disabled, call }) {
  const [title, setTitle] = useState("");
  const cases = view.tests.filter((t) => t.suite === suite);
  const sum = view.testSummary[suite];
  return (
    <div className="lc-box">
      <h4>
        {suite} tests {sum ? `· ${sum.pass} of ${sum.total} pass (${sum.total ? Math.round((sum.pass / sum.total) * 100) : 0}%)` : ""}
      </h4>
      {cases.length ? (
        <ul className="lc-list">
          {cases.map((t) => {
            const last = t.runs[t.runs.length - 1];
            return (
              <li key={t.id}>
                <span className={`lc-pill ${last?.result === "pass" ? "ok" : last?.result === "fail" ? "bad" : last ? "warn" : ""}`}>{last ? last.result : "not run"}</span>
                <span>
                  {t.title}
                  {last?.bug_item_id && <small>A bug was raised for the failure.</small>}
                </span>
                {!disabled && (
                  <span className="lc-row">
                    {["pass", "fail", "blocked"].map((r) => (
                      <button key={r} className="btn btn-ghost sm" onClick={() => call(`/tests/${t.id}/runs`, "POST", { result: r })}>
                        {r[0].toUpperCase() + r.slice(1)}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No test cases yet.</p>
      )}
      {!disabled && (
        <form
          className="lc-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("/tests", "POST", { title, suite })) setTitle("");
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`New ${suite} test case`} required maxLength={300} />
          <button className="btn btn-ghost sm">Add test</button>
        </form>
      )}
    </div>
  );
}

/** @param {{ view: LifecycleView; required: string[]; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean> }} p */
function Environments({ view, required, disabled, call }) {
  const [d, setD] = useState({ name: required.find((r) => !view.environments.some((e) => e.name === r)) ?? "", server: "", resources: "", access: "" });
  return (
    <div className="lc-box">
      <h4>Environments</h4>
      <table className="lc-table">
        <thead>
          <tr>
            <th>Environment</th>
            <th>Server</th>
            <th>Resources</th>
            <th>Verified</th>
          </tr>
        </thead>
        <tbody>
          {[...new Set([...required, ...view.environments.map((e) => e.name)])].map((n) => {
            const e = view.environments.find((x) => x.name === n);
            return (
              <tr key={n}>
                <td>{n}</td>
                <td>{e?.server || "—"}</td>
                <td>{e?.resources || "—"}</td>
                <td>
                  {e?.verified_at ? (
                    <span className="lc-pill ok">
                      {e.verified_name} · {formatDate(e.verified_at)}
                    </span>
                  ) : e && !disabled ? (
                    <button className="btn btn-ghost sm" onClick={() => call(`/environments/${e.id}/verify`, "POST", {})}>
                      Verify
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!disabled && (
        <form
          className="lc-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("/environments", "POST", d)) setD({ name: "", server: "", resources: "", access: "" });
          }}
        >
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Environment" required maxLength={40} />
          <input value={d.server} onChange={(e) => setD({ ...d, server: e.target.value })} placeholder="Server" maxLength={300} />
          <input value={d.resources} onChange={(e) => setD({ ...d, resources: e.target.value })} placeholder="Resources (CPU, RAM, storage)" maxLength={1000} />
          <input value={d.access} onChange={(e) => setD({ ...d, access: e.target.value })} placeholder="Access" maxLength={1000} />
          <button className="btn btn-ghost sm">Save environment</button>
        </form>
      )}
    </div>
  );
}

/** @param {{ view: LifecycleView; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean> }} p */
function Deployment({ view, disabled, call }) {
  const rec = view.records.deployment ?? {};
  const [d, setD] = useState({ plan: rec.plan ?? "", rollbackPlan: rec.rollbackPlan ?? "", scheduledAt: rec.scheduledAt ?? "", approver: rec.approver ?? "" });
  const change = view.records.change;
  return (
    <div className="lc-box">
      <h4>Deployment</h4>
      <p className="small">
        Change request:{" "}
        {change?.key ? (
          <a href={`#/service-desk`}>{change.key}</a>
        ) : change?.error ? (
          <span className="muted">couldn't be raised ({change.error}). Raise one on the service desk.</span>
        ) : (
          <span className="muted">raised automatically on entering Deployment</span>
        )}
      </p>
      <form
        className="lc-form stack"
        onSubmit={(e) => {
          e.preventDefault();
          call("/records/deployment", "PUT", d);
        }}
      >
        <label>
          Deployment plan
          <textarea value={d.plan} onChange={(e) => setD({ ...d, plan: e.target.value })} disabled={disabled} maxLength={4000} />
        </label>
        <label>
          Rollback plan
          <textarea value={d.rollbackPlan} onChange={(e) => setD({ ...d, rollbackPlan: e.target.value })} disabled={disabled} maxLength={4000} />
        </label>
        <label>
          Date and time
          <input type="datetime-local" value={d.scheduledAt} onChange={(e) => setD({ ...d, scheduledAt: e.target.value })} disabled={disabled} />
        </label>
        <label>
          Approver
          <input value={d.approver} onChange={(e) => setD({ ...d, approver: e.target.value })} disabled={disabled} maxLength={100} />
        </label>
        {!disabled && <button className="btn btn-ghost sm">Save the deployment record</button>}
      </form>
    </div>
  );
}

/**
 * Advance (with what's missing), send back, ask to skip or defer.
 * @param {{ stage: Stage; view: LifecycleView; busy: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean>; error: string; missing: string[] }} p
 */
function Actions({ stage, view, busy, call, error, missing }) {
  const [mode, setMode] = useState(/** @type {"" | "back" | "skip" | "defer"} */ (""));
  const [to, setTo] = useState(stage.transitions.sendBackTo[stage.transitions.sendBackTo.length - 1] ?? "");
  const [reason, setReason] = useState("");
  const def = view.template.definition;
  const notMet = view.gate.filter((g) => !g.ok);
  const closing = stage.type === "closure" || !view.next;
  const deferable = stage.exit.some((c) => c.kind === "work_items_done" && c.allowDeferredWithApproval);
  const pending = view.requests.some((r) => r.status === "pending");
  return (
    <div className="lc-box lc-actions">
      <h4>Move the project</h4>
      <button className="btn btn-navy" disabled={busy || !view.can.advance || !view.ready} onClick={() => call("/advance", "POST", {})}>
        <FastForward size={15} aria-hidden="true" /> {closing ? "Close the project" : `Advance to ${view.next?.name}`}
      </button>
      {!view.can.advance && <p className="muted small">Only the project lead, a Manager or an Administrator can move it on.</p>}
      {view.can.advance && !view.ready && (
        <div className="lc-missing" role="status">
          <b>Not ready yet:</b>
          <ul>
            {(missing.length ? missing : notMet.map((g) => g.missing ?? g.label)).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="lc-row">
        {view.can.sendBack && (
          <button className={`btn btn-ghost sm ${mode === "back" ? "on" : ""}`} onClick={() => setMode(mode === "back" ? "" : "back")}>
            <CornerUpLeft size={14} aria-hidden="true" /> Send back…
          </button>
        )}
        {view.can.skip && !pending && (
          <button className={`btn btn-ghost sm ${mode === "skip" ? "on" : ""}`} onClick={() => setMode(mode === "skip" ? "" : "skip")}>
            Ask to skip…
          </button>
        )}
        {deferable && !pending && (
          <button className={`btn btn-ghost sm ${mode === "defer" ? "on" : ""}`} onClick={() => setMode(mode === "defer" ? "" : "defer")}>
            Ask to defer open items…
          </button>
        )}
      </div>
      {mode && (
        <form
          className="lc-form stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = mode === "back" ? await call("/send-back", "POST", { to, reason }) : await call(mode === "skip" ? "/skip" : "/defer", "POST", { reason });
            if (ok) {
              setMode("");
              setReason("");
            }
          }}
        >
          {mode === "back" && (
            <label>
              Back to
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {stage.transitions.sendBackTo.map((c) => (
                  <option key={c} value={c}>
                    {stageOf(def, c)?.name ?? c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {mode === "back" ? "Why it's going back (required)" : "Justification (a Manager or Administrator approves it)"}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={1000} />
          </label>
          <button className="btn btn-navy sm" disabled={busy || reason.trim().length < 3}>
            {mode === "back" ? "Send back" : "Send the request"}
          </button>
        </form>
      )}
    </div>
  );
}

/** Skips and deferrals waiting for a Manager or Administrator. @param {{ view: LifecycleView; me: User; disabled: boolean; call: (p: string, m: string, b?: unknown) => Promise<boolean> }} p */
function Requests({ view, me, disabled, call }) {
  const pending = view.requests.filter((r) => r.status === "pending");
  const [note, setNote] = useState("");
  if (!pending.length) return null;
  return (
    <div className="lc-box">
      <h4>
        <CircleAlert size={15} aria-hidden="true" /> Waiting for a decision
      </h4>
      {pending.map((r) => (
        <div key={r.id} className="lc-request">
          <p>
            <b>{r.kind === "skip" ? "Skip this stage" : "Defer the open work items"}</b>, asked by {r.requested_name}: {r.reason}
          </p>
          {view.can.decideRequests && r.requested_by !== me.id && !disabled ? (
            <div className="lc-row">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject)" />
              <button className="btn btn-navy sm" onClick={() => call(`/requests/${r.id}`, "POST", { decision: "approve", note })}>
                Approve
              </button>
              <button className="btn btn-ghost sm" disabled={note.trim().length < 3} onClick={() => call(`/requests/${r.id}`, "POST", { decision: "reject", note })}>
                Reject
              </button>
            </div>
          ) : (
            <p className="muted small">A Manager or Administrator (not the person asking) decides.</p>
          )}
        </div>
      ))}
    </div>
  );
}

const KIND_TEXT = { start: "started at", advance: "advanced to", send_back: "sent back to", skip: "skipped to", decline: "declined: back to", migrate: "placed at", close: "closed", reopen: "reopened at", template: "moved to" };
/** @param {{ view: LifecycleView; def: TemplateDefinition; now: number; code: string }} p */
function HistoryList({ view, def, now, code }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => (all ? view.history : view.history.filter((h) => h.to_code === code || h.from_code === code)), [all, view.history, code]);
  return (
    <div className="lc-box">
      <h4>
        <History size={15} aria-hidden="true" /> History
        <button className="btn btn-ghost sm" onClick={() => setAll(!all)}>
          {all ? "This stage only" : "Whole project"}
        </button>
      </h4>
      {rows.length ? (
        <ul className="lc-hist">
          {rows.map((h) => (
            <li key={h.id}>
              <b>{h.by_name}</b> {KIND_TEXT[/** @type {keyof typeof KIND_TEXT} */ (h.kind)] ?? h.kind} {h.kind === "close" ? "" : stageOf(def, h.to_code)?.name ?? h.to_code}
              {h.from_code && h.kind !== "close" ? <span className="muted"> (from {stageOf(def, h.from_code)?.name ?? h.from_code})</span> : null}
              {h.reason && <q>{h.reason}</q>}
              <small>{timeAgo(h.at, now)}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing yet.</p>
      )}
    </div>
  );
}
