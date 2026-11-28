/** @import { ReactNode } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
// The top of a project's page (docs/design/project-cockpit-mockups.html), from GET /api/systems/:id/overview
// (worker/overview.js): the sticky header (who, status, health and why, the stage and its clock, the quick actions,
// the tabs), the lifecycle stepper with its stage drawer, and the KPI tiles. Every tile opens the list or the place
// behind its number.
import { useEffect, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, BellRing, Check, CheckCircle2, ChevronDown, CornerUpLeft, FileText, Link2, MoreHorizontal, Pencil, Plus, ShieldAlert, SkipForward, X } from "lucide-react";
import { ApiError, api } from "../data/api";
import { initials } from "../data/systems";
import { formatDate, timeAgo } from "../time";
import { StatusPill } from "./SystemCard";

/** @typedef {any} Overview  GET /api/systems/:id/overview, see docs/API.md "Project overview" */

/**
 * Loads the overview, again whenever `stamp` changes (the project's data moved). Keeps the last one while reloading.
 * @param {string} systemId
 * @param {string} stamp
 */
export function useOverview(systemId, stamp) {
  const [data, setData] = useState(/** @type {Overview | null} */ (null));
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  const last = useRef(systemId);
  useEffect(() => {
    let live = true;
    if (last.current !== systemId) {
      setData(null);
      last.current = systemId;
    }
    setError("");
    api(`/systems/${systemId}/overview`)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the project's figures"));
    return () => {
      live = false;
    };
  }, [systemId, stamp, n]);
  return { data: data && data.project?.id === systemId ? data : null, error, reload: () => setN((x) => x + 1) };
}

const RAG_TONE = { RED: "bad", AMBER: "warn", GREEN: "ok", NONE: "none" };
const RAG_ICON = { RED: AlertOctagon, AMBER: AlertTriangle, GREEN: CheckCircle2, NONE: CheckCircle2 };
const TABS = /** @type {const} */ ([
  ["overview", "Overview", ""],
  ["lifecycle", "Lifecycle", "/lifecycle"],
  ["items", "Work items", "/items"],
  ["board", "Board", "/board"],
  ["backlog", "Backlog", "/backlog"],
  ["timeline", "Timeline", "/timeline"],
  ["docs", "Documents", "/docs"],
]);
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (/** @type {string} */ d) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * The sticky header.
 * @param {{
 *   system: System; data: Overview | null; section: string; me: User; readOnly: boolean;
 *   canUpdate: boolean; canRequest: boolean; canCreateItems: boolean;
 *   onBack: () => void; onUpdate: () => void; onRequest: () => void; onAdvanced: () => void;
 * }} p
 */
export function CockpitHeader(p) {
  const { system, data } = p;
  const [menu, setMenu] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const menuBox = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    if (!menu && !advancing) return;
    const away = (/** @type {MouseEvent} */ e) => {
      if (menuBox.current && !menuBox.current.contains(/** @type {Node} */ (e.target))) {
        setMenu(false);
        setAdvancing(false);
      }
    };
    const esc = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") {
        setMenu(false);
        setAdvancing(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu, advancing]);
  useEffect(() => setNote(""), [system.id]);

  const life = data?.lifecycle ?? null;
  const health = data?.health ?? null;
  const team = /** @type {{ id: string; name: string }[]} */ (data?.project.team ?? []);
  const lead = data?.project.lead ?? null;
  const canOpen = (system.status === "LIVE" || system.status === "COMPLETED") && !!system.url;
  const tabs = TABS.filter(([k]) => k !== "backlog" || system.agileMode === "scrum");
  const base = `#/projects/${system.id}`;
  const advanceWhy = !life ? "" : life.closed ? "The project is closed" : !life.ready ? `Still needed: ${life.missing.join("; ")}` : !life.canAdvance ? "Only the project lead, a Manager or an Administrator can advance it" : `Move on from ${life.stage.name}`;
  const HealthIcon = health ? RAG_ICON[/** @type {keyof typeof RAG_ICON} */ (health.rag)] : CheckCircle2;
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${base}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied. People who can see this workspace can open it.");
    } catch {
      setNote(url);
    }
  };
  const advance = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/systems/${system.id}/lifecycle/advance`, "POST", comment.trim() ? { comment: comment.trim() } : {});
      setAdvancing(false);
      setComment("");
      p.onAdvanced();
    } catch (e) {
      setError(e instanceof ApiError && Array.isArray(e.payload?.missing) ? `Not yet: ${/** @type {string[]} */ (e.payload.missing).join("; ")}` : e instanceof Error ? e.message : "Couldn't advance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="ck-head no-print">
      <div className="ck-row">
        <button className="ck-back" onClick={p.onBack} aria-label="All projects">
          <ArrowLeft size={16} aria-hidden="true" /> <span className="ck-wide">Projects</span>
        </button>
        <span className="ck-mono" aria-hidden="true">
          {system.short}
        </span>
        <div className="ck-title">
          <h2>{system.name}</h2>
          {system.key && <span className="ck-key">{system.key}</span>}
          {data && (
            <span className="ck-ws ck-wide">
              <i aria-hidden="true" />
              {data.project.workspace}
            </span>
          )}
        </div>
        {(lead || team.length > 0) && (
          <div className="ck-people ck-wide" aria-label={`${lead ? `Lead ${lead.name}` : "No lead"}${team.length ? `, and ${plural(team.length, "team member")}` : ""}`}>
            {lead && (
              <span className="ck-av lead" title={`Lead: ${lead.name}`}>
                {initials(lead.name)}
              </span>
            )}
            {team.slice(0, 3).map((t) => (
              <span key={t.id} className="ck-av" title={t.name}>
                {initials(t.name)}
              </span>
            ))}
            {team.length > 3 && (
              <span className="ck-av more" title={team.slice(3).map((t) => t.name).join(", ")}>
                +{team.length - 3}
              </span>
            )}
          </div>
        )}
        <span className="ck-grow" />
        {!p.readOnly && (
          <div className="ck-actions" ref={menuBox}>
            {life && !life.closed && (
              <span className="ck-pop-wrap">
                <button className="btn btn-ghost sm" disabled={!life.canAdvance} title={advanceWhy} aria-describedby={life.canAdvance ? undefined : "ck-adv-why"} onClick={() => setAdvancing((v) => !v)}>
                  <ArrowRight size={15} aria-hidden="true" /> <span className="ck-wide-sm">Advance stage</span>
                </button>
                {!life.canAdvance && (
                  <span id="ck-adv-why" className="sr-only">
                    {advanceWhy}
                  </span>
                )}
                {advancing && (
                  <div className="ck-pop" role="dialog" aria-label={`Advance from ${life.stage.name}`}>
                    <b>Move on from {life.stage.name}?</b>
                    <label className="field">
                      <span>Comment (optional)</span>
                      <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                    </label>
                    {error && <p className="form-error">{error}</p>}
                    <div className="confirm-actions">
                      <button className="btn btn-ghost sm" onClick={() => setAdvancing(false)}>
                        Cancel
                      </button>
                      <button className="btn btn-navy sm" disabled={busy} onClick={advance}>
                        {busy ? "Moving…" : "Advance"}
                      </button>
                    </div>
                  </div>
                )}
              </span>
            )}
            {p.canRequest && (
              <button className="btn btn-ghost sm ck-wide" onClick={p.onRequest}>
                <BellRing size={15} aria-hidden="true" /> Request update
              </button>
            )}
            {p.canCreateItems && (
              <a className="btn btn-navy sm" href={`${base}/items`} onClick={() => {
                  try {
                    sessionStorage.setItem("pms:quick-create", system.id);
                  } catch {
                    // Without storage the list still opens; the box just isn't focused.
                  }
                }}
              >
                <Plus size={15} strokeWidth={3} aria-hidden="true" /> <span className="ck-wide-sm">Add work item</span>
              </a>
            )}
            <button className="btn btn-ghost sm ck-icon ck-wide" onClick={copyLink} aria-label="Copy a link to this project" title="Copy a link to this project">
              <Link2 size={16} aria-hidden="true" />
            </button>
            <span className="ck-pop-wrap">
              <button className="btn btn-ghost sm ck-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
              {menu && (
                <div className="ck-menu" role="menu">
                  {p.canUpdate && (
                    <button role="menuitem" onClick={() => (setMenu(false), p.onUpdate())}>
                      <Pencil size={15} aria-hidden="true" /> Update progress
                    </button>
                  )}
                  {p.canRequest && (
                    <button role="menuitem" onClick={() => (setMenu(false), p.onRequest())}>
                      <BellRing size={15} aria-hidden="true" /> Request update
                    </button>
                  )}
                  <button role="menuitem" onClick={() => (setMenu(false), copyLink())}>
                    <Link2 size={15} aria-hidden="true" /> Copy link
                  </button>
                  <a role="menuitem" href={`${base}/docs`} onClick={() => setMenu(false)}>
                    <FileText size={15} aria-hidden="true" /> Documents
                  </a>
                  {canOpen && (
                    <a role="menuitem" href={system.url} target="_blank" rel="noreferrer">
                      <ArrowUpRight size={15} aria-hidden="true" /> Open the app
                    </a>
                  )}
                </div>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="ck-row ck-status">
        <StatusPill status={system.status} />
        {health && health.rag !== "NONE" && (
          <span className="ck-why-wrap">
            <button className={`ck-health ${RAG_TONE[/** @type {keyof typeof RAG_TONE} */ (health.rag)]}`} aria-describedby="ck-why">
              <HealthIcon size={14} aria-hidden="true" /> {health.label}
            </button>
            <span id="ck-why" role="tooltip" className="ck-why">
              <b>{health.label} because</b>
              {health.reasons.map((/** @type {string} */ r) => (
                <span key={r}>· {r}</span>
              ))}
              <small>The same rule as Reports → Projects.</small>
            </span>
          </span>
        )}
        {life && (
          <>
            <span className="ck-sep ck-wide" aria-hidden="true" />
            <b className="ck-stage">{life.closed ? "Lifecycle closed" : `Stage ${life.stage.n} of ${life.stage.total} · ${life.stage.name}`}</b>
            {!life.closed && life.sla && life.targetDays ? <StageClock used={life.sla.usedDays} target={life.targetDays} state={life.sla.state} /> : null}
          </>
        )}
      </div>
      {note && (
        <p className="ck-note" role="status">
          {note}{" "}
          <button className="link-btn" onClick={() => setNote("")}>
            Dismiss
          </button>
        </p>
      )}

      <nav className="ck-tabs" aria-label="Project sections">
        {tabs.map(([k, label, path]) => (
          <a key={k} href={`${base}${path}`} className={p.section === k ? "on" : ""} aria-current={p.section === k ? "page" : undefined}>
            {label}
            {k === "items" && data ? <span className="ck-count">{data.kpis.openItems.value}</span> : null}
          </a>
        ))}
      </nav>
      <label className="ck-tab-select">
        <span className="sr-only">Project section</span>
        <select value={p.section} onChange={(e) => (window.location.hash = `${base}${tabs.find(([k]) => k === e.target.value)?.[2] ?? ""}`)}>
          {tabs.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

/** "day 7 of 5 · 2 over", with a small meter. @param {{ used: number; target: number; state: string }} p */
function StageClock({ used, target, state }) {
  const over = Math.round((used - target) * 10) / 10;
  const day = Math.max(1, Math.ceil(used));
  return (
    <span className={`ck-clock ${state}`}>
      <span className="ck-meter ck-wide" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (used / target) * 100)}%` }} />
      </span>
      {state === "overdue" ? `day ${day} of ${target} · ${over} over` : `day ${day} of ${target}`}
    </span>
  );
}

/**
 * The lifecycle stepper: stages by phase, each with its state as an icon and words, not colour alone. Clicking one
 * opens its drawer. On a phone it folds into "Stage 6 of 16" with a bar, which opens the full list.
 * @param {{ data: Overview; system: System; users: User[]; now: number }} p
 */
export function Stepper({ data, system, users, now }) {
  const life = data.lifecycle;
  const [open, setOpen] = useState(/** @type {string | null} */ (null));
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setOpen(null), [system.id]);
  if (!life) return null;
  /** @type {any[]} */ const stages = life.stages;
  const label = (/** @type {any} */ s) =>
    ({ done: `completed${s.date ? ` ${formatDate(s.date)}` : ""}`, skipped: "skipped", migrated: "placed here when the lifecycle started", current: "current", overdue: "current, over its target", upcoming: "upcoming" })[/** @type {string} */ (s.state)] + (s.sentBack ? ", sent back before" : "");
  return (
    <>
      <section className={`ck-card ck-stepper ${expanded ? "expanded" : ""}`} aria-label="Lifecycle stages">
        <button className="ck-step-compact" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <StageDot s={stages[life.stage.n - 1]} />
          <span>
            <b>{life.closed ? "Lifecycle closed" : `Stage ${life.stage.n} of ${life.stage.total} · ${life.stage.name}`}</b>
            <span className="ck-mini" aria-hidden="true">
              {stages.map((s) => (
                <i key={s.code} className={s.state} />
              ))}
            </span>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <div className="ck-phases">
          {life.phases.map((/** @type {{ code: string; name: string }} */ ph) => {
            const mine = stages.filter((s) => s.phase === ph.code);
            if (!mine.length) return null;
            return (
              <div key={ph.code} className="ck-phase" style={{ flexGrow: mine.length }}>
                <div className="ck-phase-name">
                  <span>{ph.name}</span>
                  <i aria-hidden="true" />
                </div>
                <div className="ck-phase-stages">
                  {mine.map((s) => (
                    <button key={s.code} className={`ck-step ${s.state} ${open === s.code ? "sel" : ""}`} aria-label={`Stage ${s.n}, ${s.name}: ${label(s)}. Open details`} onClick={() => setOpen(s.code)}>
                      <StageDot s={s} />
                      <span className="ck-step-name">{s.name}</span>
                      <span className="ck-step-date">{s.state === "done" && s.date ? shortDate(s.date) : s.state === "current" || s.state === "overdue" ? (life.sla && life.targetDays ? `day ${Math.max(1, Math.ceil(life.sla.usedDays))} of ${life.targetDays}` : "now") : s.state === "skipped" ? "skipped" : s.state === "migrated" ? "earlier" : " "}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="ck-legend" aria-hidden="true">
          <span>
            <i className="done" /> Completed
          </span>
          <span>
            <i className="back" /> Sent back before
          </span>
          <span>
            <i className="overdue" /> Current, over target
          </span>
          <span>
            <i className="upcoming" /> Upcoming
          </span>
          <span className="ck-legend-hint">Click a stage for its checklist, sign-offs and history</span>
        </div>
      </section>
      {open && <StageDrawer system={system} code={open} overview={data} users={users} now={now} onClose={() => setOpen(null)} />}
    </>
  );
}

/** @param {{ s: any }} p */
function StageDot({ s }) {
  if (!s) return null;
  if (s.state === "done") return <span className={`ck-dot done ${s.sentBack ? "back" : ""}`}>{s.sentBack ? <CornerUpLeft size={12} strokeWidth={3} aria-hidden="true" /> : <Check size={13} strokeWidth={3.2} aria-hidden="true" />}</span>;
  if (s.state === "skipped") return <span className="ck-dot skipped"><SkipForward size={11} strokeWidth={3} aria-hidden="true" /></span>;
  if (s.state === "migrated") return <span className="ck-dot migrated"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>;
  if (s.state === "current" || s.state === "overdue") return <span className={`ck-dot ${s.state} pulse`}>{s.n}</span>;
  return <span className="ck-dot upcoming">{s.n}</span>;
}

/**
 * A stage's drawer: what its gate needs (for the current stage, as the server decides it), its sign-offs, the
 * deliverables, and its history. From the lifecycle view, loaded when the drawer opens.
 * @param {{ system: System; code: string; overview: Overview; users: User[]; now: number; onClose: () => void }} p
 */
function StageDrawer({ system, code, overview, now, onClose }) {
  const [view, setView] = useState(/** @type {any} */ (null));
  const [error, setError] = useState("");
  const panel = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => {
    let live = true;
    api(`/systems/${system.id}/lifecycle`)
      .then((r) => live && setView(/** @type {any} */ (r).lifecycle))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the stage"));
    return () => {
      live = false;
    };
  }, [system.id]);
  useEffect(() => {
    const back = /** @type {HTMLElement | null} */ (document.activeElement);
    panel.current?.focus();
    const esc = (/** @type {KeyboardEvent} */ e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("keydown", esc);
      back?.focus?.();
    };
  }, [onClose]);
  const s = overview.lifecycle.stages.find((/** @type {any} */ x) => x.code === code);
  const def = view?.template.definition;
  const stage = def?.stages.find((/** @type {any} */ x) => x.code === code);
  const phase = overview.lifecycle.phases.find((/** @type {any} */ x) => x.code === s?.phase);
  const current = view && view.stage === code && view.state !== "closed";
  const signoffs = (view?.signoffs ?? []).filter((/** @type {any} */ x) => x.stage_code === code);
  const lastRound = signoffs.reduce((/** @type {number} */ m, /** @type {any} */ x) => Math.max(m, Number(x.round)), 0);
  const round = signoffs.filter((/** @type {any} */ x) => Number(x.round) === lastRound);
  const keys = new Set((stage?.deliverables ?? []).map((/** @type {any} */ d) => d.key));
  const docs = (view?.documents ?? []).filter((/** @type {any} */ d) => d.stage_code === code || (d.deliverable_key && keys.has(d.deliverable_key)));
  const history = (view?.history ?? []).filter((/** @type {any} */ h) => h.to_code === code || h.from_code === code);
  const name = (/** @type {string | null} */ c) => def?.stages.find((/** @type {any} */ x) => x.code === c)?.name ?? c ?? "";
  const verb = { start: "Started here", migrate: "Placed here", advance: "Moved on", send_back: "Sent back", decline: "Declined, sent back", skip: "Skipped", close: "Closed" };
  return (
    <div className="ck-drawer-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ck-drawer" role="dialog" aria-modal="true" aria-label={`Stage ${s?.n}, ${s?.name}`} tabIndex={-1} ref={panel}>
        <div className="ck-drawer-head">
          <StageDot s={s} />
          <div>
            <small>
              {phase?.name} · stage {s?.n} of {overview.lifecycle.stages.length}
            </small>
            <h3>{s?.name}</h3>
            {current && view.sla && stage?.targetDays ? <p className={view.sla.state === "overdue" ? "bad" : ""}>{`Day ${Math.max(1, Math.ceil(view.sla.usedDays))} of ${stage.targetDays} business days${view.sla.state === "overdue" ? ` · ${Math.round((view.sla.usedDays - stage.targetDays) * 10) / 10} over` : ` · due ${formatDate(view.sla.dueAt)}`}`}</p> : stage?.targetDays ? <p>Target: {stage.targetDays} business days</p> : null}
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {!view && !error && <p className="lead-none">Loading…</p>}
        {view && stage && (
          <>
            <h4>Done when</h4>
            <ul className="ck-drows">
              {current
                ? view.gate.map((/** @type {any} */ g) => (
                    <li key={g.label}>
                      <span className={`ck-tick ${g.ok ? "ok" : ""}`}>{g.ok && <Check size={11} strokeWidth={3.4} aria-hidden="true" />}</span>
                      <span>{g.ok ? g.label : g.missing ?? g.label}</span>
                      <small className={g.ok ? "ok" : "warn"}>{g.ok ? "Done" : "Waiting"}</small>
                    </li>
                  ))
                : stage.exit.map((/** @type {any} */ x) => (
                    <li key={x.label}>
                      <span className={`ck-tick ${s.state === "done" ? "ok" : ""}`}>{s.state === "done" && <Check size={11} strokeWidth={3.4} aria-hidden="true" />}</span>
                      <span>{x.label}</span>
                    </li>
                  ))}
            </ul>
            {round.length > 0 && (
              <>
                <h4>Sign-offs</h4>
                <ul className="ck-drows">
                  {round.map((/** @type {any} */ x) => (
                    <li key={x.id}>
                      <span className="ck-av sm">{initials(x.signer_name)}</span>
                      <span className="ck-drow-text">
                        <b>{x.signer_name}</b>
                        <small>
                          {x.label}
                          {x.document_version ? ` · version ${x.document_version}` : ""} · asked {timeAgo(x.requested_at, now)}
                          {x.decided_at ? `, decided ${formatDate(x.decided_at)}` : ""}
                        </small>
                      </span>
                      <span className={`ck-chip ${x.status === "approved" ? "ok" : x.status === "declined" ? "bad" : "warn"}`}>{x.status === "approved" ? "Approved" : x.status === "declined" ? "Declined" : "Waiting"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {docs.length > 0 && (
              <>
                <h4>Deliverables</h4>
                <ul className="ck-drows">
                  {docs.map((/** @type {any} */ d) => (
                    <li key={d.id}>
                      <FileText size={16} aria-hidden="true" />
                      <span className="ck-drow-text">
                        <a href={d.kind === "link" ? d.url : `/api/documents/${d.id}`} target="_blank" rel="noreferrer noopener">
                          {d.name}
                          {d.version ? ` · v${d.version}` : ""}
                        </a>
                        <small>
                          {d.uploaded_name ?? "Someone"} · {formatDate(d.uploaded_at)}
                          {d.locked_at ? " · signed, locked" : ""}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4>History</h4>
            {history.length ? (
              <ul className="ck-drows">
                {history.map((/** @type {any} */ h) => (
                  <li key={h.id}>
                    <small className="ck-when">{formatDate(h.at)}</small>
                    <span className="ck-drow-text">
                      <span>
                        {h.to_code === code && h.from_code !== code ? `${verb[/** @type {keyof typeof verb} */ (h.kind)] ?? h.kind}${h.from_code ? ` from ${name(h.from_code)}` : ""}` : `${verb[/** @type {keyof typeof verb} */ (h.kind)] ?? h.kind} to ${name(h.to_code)}`}
                      </span>
                      <small>
                        {h.by_name}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lead-none">Not reached yet.</p>
            )}
            <div className="ck-drawer-foot">
              <a className="btn btn-ghost sm" href={`#/projects/${system.id}/lifecycle`} onClick={onClose}>
                Open in Lifecycle
              </a>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * A small line of the last 30 days; nothing without at least two points.
 * @param {{ values: number[]; tone?: string }} p
 */
function Sparkline({ values, tone = "c1" }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(24 - ((v - min) / span) * 20).toFixed(1)}`).join(" ");
  return (
    <svg className={`ck-spark ${tone}`} viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * A KPI tile: a button that opens what is behind its number.
 * @param {{ title: string; value: ReactNode; sub?: ReactNode; extra?: ReactNode; spark?: number[]; tone?: string; label: string; onOpen?: () => void }} p
 */
function Tile({ title, value, sub, extra, spark, tone, label, onOpen }) {
  const body = (
    <>
      <span className="ck-k-title">{title}</span>
      <span className="ck-k-num">{value}</span>
      {extra}
      {sub && <span className="ck-k-sub">{sub}</span>}
      {spark && <Sparkline values={spark} tone={tone} />}
    </>
  );
  return onOpen ? (
    <button className="ck-tile" aria-label={label} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="ck-tile static" role="group" aria-label={label}>
      {body}
    </div>
  );
}

/**
 * The KPI tiles. Each opens the work-item list behind it (as PQL), or the place its figure comes from.
 * @param {{ data: Overview; system: System; onSearch?: (pql: string) => void; onBlockers: () => void }} p
 */
export function KpiTiles({ data, system, onSearch, onBlockers }) {
  const [forecastOpen, setForecastOpen] = useState(false);
  const k = data.kpis;
  const days = /** @type {any[]} */ (data.series.days);
  const series = (/** @type {string} */ f) => days.map((d) => Number(d[f]));
  const base = `#/projects/${system.id}`;
  const go = (/** @type {string} */ path) => () => (window.location.hash = `${base}${path}`);
  const f = k.forecast;
  const ring = 2 * Math.PI * 22;
  const ch = k.openItems.change7;
  return (
    <>
      <section className="ck-kpis" aria-label="Key figures">
        <Tile
          title="Overall progress"
          label={`Overall progress ${k.progress.value}%. Open the lifecycle`}
          onOpen={data.lifecycle ? go("/lifecycle") : undefined}
          value={
            <span className="ck-ring-row">
              <svg width="52" height="52" viewBox="0 0 54 54" aria-hidden="true">
                <circle cx="27" cy="27" r="22" className="ck-ring-track" />
                <circle cx="27" cy="27" r="22" className="ck-ring-fill" strokeDasharray={`${(ring * k.progress.value) / 100} ${ring}`} transform="rotate(-90 27 27)" />
              </svg>
              {k.progress.value}%
            </span>
          }
          sub={k.progress.stages !== null ? `Stages ${k.progress.stages}%${k.progress.work !== null ? ` · work ${k.progress.work}%` : ""}` : k.progress.work !== null ? `Work items ${k.progress.work}% done` : undefined}
        />
        <Tile
          title="Forecast finish"
          label={f.finish ? `Forecast finish ${formatDate(f.finish)}${f.varianceDays !== null ? `, ${Math.abs(f.varianceDays)} days ${f.varianceDays > 0 ? "after" : "before"} the target` : ""}. How it was worked out` : "No forecast yet. Why"}
          onOpen={() => setForecastOpen(true)}
          value={<span className="ck-k-date">{f.finish ? shortDate(f.finish) : "–"}</span>}
          extra={f.varianceDays !== null && f.varianceDays !== 0 ? <span className={`ck-chip ${f.varianceDays > 0 ? "bad" : "ok"}`}>{f.varianceDays > 0 ? `+${f.varianceDays}` : f.varianceDays} days vs {shortDate(/** @type {string} */ (f.target))}</span> : f.varianceDays === 0 ? <span className="ck-chip ok">On the target</span> : null}
          sub={f.items?.status === "ok" ? `50% likely · 85%: ${shortDate(f.items.p85.date)}` : f.basis === "lifecycle" || f.lifecycle ? "From the remaining stages' targets" : f.items?.status === "insufficient" ? "Not enough history yet" : "No due date or work items"}
        />
        <Tile title="Open work items" label={`${k.openItems.value} open work items. Show them`} onOpen={onSearch && (() => onSearch(k.openItems.pql))} value={k.openItems.value} sub={ch === null ? undefined : ch === 0 ? "No change in 7 days" : <span className={ch < 0 ? "ok" : "warn"}>{ch < 0 ? "▼" : "▲"} {Math.abs(ch)} in 7 days</span>} spark={series("open")} />
        <Tile title="Overdue items" label={`${k.overdueItems.value} overdue work items. Show them`} onOpen={onSearch && (() => onSearch(k.overdueItems.pql))} value={<span className={k.overdueItems.value ? "bad" : ""}>{k.overdueItems.value}</span>} sub={k.openItems.value ? `${Math.round(k.overdueItems.share)}% of open items` : "Nothing open"} spark={series("overdue")} tone="bad" />
        <Tile title="Open blockers" label={`${k.blockers.value} open blockers. Show them`} onOpen={onBlockers} value={k.blockers.value} sub={k.blockers.oldestDays !== null ? `Oldest ${plural(k.blockers.oldestDays, "day")}` : "Nothing in the way"} spark={series("blockers")} tone="c2" />
        {data.lifecycle && (
          <Tile title="Risks: High / Critical" label={`${k.risks.highCritical} open High or Critical risks. Open the register`} onOpen={go("/lifecycle")} value={k.risks.highCritical} sub={k.risks.open ? `of ${k.risks.open} open${k.risks.unowned ? ` · ${k.risks.unowned} without an owner` : " · all have owners"}` : "No open risks"} spark={series("risks")} tone="c3" />
        )}
        {data.lifecycle && (
          <Tile
            title={k.tests?.inTesting ? "Tests: pass rate" : "Security: Critical / High"}
            label={k.tests?.inTesting ? "Test pass rates. Open the lifecycle" : `${k.security.criticalHigh} open Critical or High security findings. Open the lifecycle`}
            onOpen={go("/lifecycle")}
            value={k.tests?.inTesting ? <TestRates tests={k.tests} /> : k.security.total || k.security.stage?.reached ? <span className={k.security.criticalHigh ? "bad" : ""}>{k.security.criticalHigh}</span> : <span className="faint">–</span>}
            sub={k.tests?.inTesting ? "Latest run of each test; waived ones set aside" : k.security.total ? `${k.security.open} open of ${k.security.total}` : k.security.stage && !k.security.stage.reached ? `Not assessed yet (stage ${k.security.stage.n})` : "No findings recorded"}
            extra={k.tests?.inTesting || !k.security.criticalHigh ? null : <ShieldAlert size={16} className="bad" aria-hidden="true" />}
          />
        )}
      </section>
      {forecastOpen && <ForecastDialog forecast={f} onClose={() => setForecastOpen(false)} />}
    </>
  );
}

/** @param {{ tests: any }} p */
function TestRates({ tests }) {
  const rows = /** @type {[string, any][]} */ ([["QAT", tests.QAT], ["UAT", tests.UAT]]).filter(([, t]) => t && t.total);
  if (!rows.length) return <span className="faint">–</span>;
  return (
    <span className="ck-rates">
      {rows.map(([name, t]) => (
        <span key={name}>
          <small>{name}</small> {t.rate === null ? "–" : `${t.rate}%`}
        </span>
      ))}
    </span>
  );
}

/** How the finish date was worked out. @param {{ forecast: any; onClose: () => void }} p */
function ForecastDialog({ forecast: f, onClose }) {
  const box = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    box.current?.focus();
    const esc = (/** @type {KeyboardEvent} */ e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="backdrop modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ck-forecast" role="dialog" aria-modal="true" aria-label="How the finish date is worked out" tabIndex={-1} ref={box}>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Forecast finish</h2>
        <p className="ck-f-big">
          {f.finish ? formatDate(f.finish) : "No forecast yet"}
          {f.target ? <small> · target {formatDate(f.target)}</small> : null}
        </p>
        <p>The work and the remaining stages must both be done, so the finish is the later of these two:</p>
        <dl className="ck-f-list">
          <dt>From work items</dt>
          <dd>
            {f.items?.status === "ok" ? (
              <>
                <b>
                  50% likely by {formatDate(f.items.p50.date)}, 85% by {formatDate(f.items.p85.date)}.
                </b>{" "}
                {f.items.explanation}
              </>
            ) : f.items ? (
              f.items.explanation
            ) : (
              "This project has no work items."
            )}
          </dd>
          <dt>From the lifecycle</dt>
          <dd>{f.lifecycle ? `${formatDate(f.lifecycle.date)}: what's left of this stage's target plus the targets of the stages after it (${f.lifecycle.businessDays} business days).` : "No lifecycle with targets."}</dd>
        </dl>
      </div>
    </div>
  );
}
