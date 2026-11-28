/** @import { System } from '../data/systems' */
// The Overview's first row (docs/design/project-cockpit-mockups.html): "What needs attention", ranked by the server
// (src/data/attention.js), each entry with its one action; the plain-English summary (GET /api/systems/:id/summary);
// and the next 14 days.
import { useEffect, useState } from "react";
import { AlertOctagon, BellRing, CalendarDays, CheckCircle2, Clock, Flag, PenLine, RefreshCw, Sparkles, TimerReset } from "lucide-react";
import { api } from "../data/api";
import { ATTENTION_LABEL } from "../data/attention";
import { timeAgo } from "../time";

const TONE = { blocker: "bad", signoff: "warn", stage_overdue: "bad", gate: "warn", overdue_item: "warn", update_request: "info", stale: "info" };
const ICON = { blocker: AlertOctagon, signoff: PenLine, stage_overdue: TimerReset, gate: Flag, overdue_item: Clock, update_request: BellRing, stale: Clock };
/** Entries shown before "Show all". */
const FIRST = 6;

/**
 * @param {{
 *   data: any; system: System; readOnly: boolean; canContribute: boolean; canUpdate: boolean;
 *   onUpdate: () => void; onSearch?: (pql: string) => void; onChanged: () => void;
 * }} p
 */
export function AttentionPanel({ data, system, readOnly, canContribute, canUpdate, onUpdate, onSearch, onChanged }) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(/** @type {{ text: string; undo?: () => Promise<void> } | null} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    setAll(false);
    setNote(null);
    setError("");
  }, [system.id]);
  /** @type {any[]} */ const entries = data.attention.entries;
  const shown = all ? entries : entries.slice(0, FIRST);
  const run = async (/** @type {any} */ e, /** @type {() => Promise<{ text: string; undo?: () => Promise<void> } | void>} */ fn) => {
    setBusy(e.id);
    setError("");
    try {
      const done = await fn();
      if (done) setNote(done);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy("");
    }
  };
  /** The entry's action, or nothing when the viewer can't take it. @param {any} e */
  const action = (e) => {
    const a = e.action;
    const label = busy === e.id ? "…" : a.label;
    if (a.href) return <a className="btn btn-ghost sm" href={a.href}>{a.label}</a>;
    if (readOnly) return null;
    if (a.kind === "resolve_blocker" && canContribute)
      return (
        <button className="btn btn-ghost sm" disabled={!!busy} onClick={() => run(e, async () => {
          await api(`/blockers/${a.ref}`, "PATCH", { resolved: true });
          return { text: `Resolved: ${e.title}`, undo: async () => { await api(`/blockers/${a.ref}`, "PATCH", { resolved: false }); } };
        })}>
          <CheckCircle2 size={14} aria-hidden="true" /> {label}
        </button>
      );
    if (a.kind === "remind")
      return (
        <button className="btn btn-ghost sm" disabled={!!busy} onClick={() => run(e, async () => {
          await api(`/systems/${system.id}/lifecycle/remind`, "POST");
          return { text: "Reminder sent to the signatories still to sign." };
        })}>
          <BellRing size={14} aria-hidden="true" /> {label}
        </button>
      );
    if (a.kind === "open_list" && onSearch && a.pql) return <button className="btn btn-ghost sm" onClick={() => onSearch(a.pql)}>{a.label}</button>;
    if (a.kind === "post_update" && canUpdate) return <button className="btn btn-ghost sm" onClick={onUpdate}>{a.label}</button>;
    return null;
  };
  return (
    <section className={`ck-card ck-att ${entries.length ? "has" : ""}`} aria-labelledby="ck-att-title">
      <div className="ck-card-head">
        <h3 id="ck-att-title">What needs attention</h3>
        {entries.length > 0 && <span className="ck-chip bad">{data.attention.total}</span>}
        <span className="ck-grow" />
        {entries.length > 1 && <small>Most urgent first</small>}
      </div>
      {note && (
        <p className="ck-att-note" role="status">
          {note.text}
          {note.undo && (
            <button className="link-btn" onClick={async () => {
              const undo = note.undo;
              setNote(null);
              try {
                await undo?.();
                onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't undo that");
              }
            }}>
              Undo
            </button>
          )}
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      {entries.length ? (
        <ol className="ck-att-list">
          {shown.map((e, i) => {
            const Icon = ICON[/** @type {keyof typeof ICON} */ (e.kind)] ?? Clock;
            return (
              <li key={e.id}>
                <span className="ck-att-n" aria-hidden="true">{i + 1}</span>
                <span className={`ck-chip ${TONE[/** @type {keyof typeof TONE} */ (e.kind)] ?? "info"} ck-att-kind`}>
                  <Icon size={12} aria-hidden="true" /> {ATTENTION_LABEL[/** @type {keyof typeof ATTENTION_LABEL} */ (e.kind)] ?? e.kind}
                </span>
                <span className="ck-att-text">
                  <b>{e.title}</b>
                  <small>{e.detail}</small>
                </span>
                {action(e)}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="ck-att-none">
          <CheckCircle2 size={18} aria-hidden="true" /> Nothing is waiting on anyone: no blockers, sign-offs or overdue work.
        </p>
      )}
      {entries.length > FIRST && (
        <button className="link-btn ck-att-more" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * The summary: three plain sentences, written by AI from this project's figures (as the viewer sees them), or the
 * plain one when the AI text can't be backed up.
 * @param {{ system: System; stamp: string; readOnly: boolean; now: number }} p
 */
export function SummaryCard({ system, stamp, readOnly, now }) {
  const [s, setS] = useState(/** @type {{ text: string; source: "ai" | "plain"; generatedAt: string; upToDate: boolean } | null} */ (null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setError("");
    api(`/systems/${system.id}/summary`)
      .then((r) => live && setS(/** @type {any} */ (r)))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't write the summary"));
    return () => {
      live = false;
    };
  }, [system.id, stamp]);
  const regenerate = async () => {
    setBusy(true);
    setError("");
    try {
      setS(/** @type {any} */ (await api(`/systems/${system.id}/summary`, "POST")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the summary");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ck-card ck-summary" aria-labelledby="ck-sum-title" aria-busy={!s && !error}>
      <div className="ck-card-head">
        <Sparkles size={16} className="ck-ai" aria-hidden="true" />
        <h3 id="ck-sum-title">Summary</h3>
        <span className="ck-grow" />
        {!readOnly && s && (
          <button className="link-btn" onClick={regenerate} disabled={busy}>
            <RefreshCw size={13} aria-hidden="true" className={busy ? "spin" : ""} /> {busy ? "Writing…" : "Regenerate"}
          </button>
        )}
      </div>
      {s ? <p className="ck-sum-text">{s.text}</p> : error ? <p className="form-error">{error}</p> : <p className="ck-sum-wait">Writing the summary…</p>}
      {s && (
        <p className="ck-foot">
          <span>{s.source === "ai" ? "Written by AI from this project's figures only; every number checked against them" : "Written from this project's figures"}</span>
          <span title={new Date(s.generatedAt).toLocaleString("en-GB")}>{timeAgo(s.generatedAt, now)}</span>
        </p>
      )}
    </section>
  );
}

/** @param {{ data: any }} p */
export function NextDays({ data }) {
  /** @type {any[]} */ const list = data.upcoming;
  const day = (/** @type {string} */ d) => new Date(`${d}T12:00:00Z`);
  return (
    <section className="ck-card ck-next" aria-labelledby="ck-next-title">
      <div className="ck-card-head">
        <CalendarDays size={16} aria-hidden="true" />
        <h3 id="ck-next-title">Next 14 days</h3>
      </div>
      {list.length ? (
        <ul>
          {list.map((u, i) => (
            <li key={`${u.date}-${i}`}>
              <span className="ck-next-date">
                <b>{day(u.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</b>
                <small>{day(u.date).toLocaleDateString("en-GB", { weekday: "long" })}</small>
              </span>
              <span className="ck-next-text">
                {u.href ? <a href={u.href}>{u.title}</a> : <span>{u.title}</span>}
                <small>{u.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead-none">Nothing due in the next 14 days.</p>
      )}
    </section>
  );
}
