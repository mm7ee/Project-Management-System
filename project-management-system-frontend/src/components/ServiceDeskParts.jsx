/** @import { WorkPriority } from '../data/workitems' */
/** @import { PortalRequest, RequestType, SlaClock } from '../data/servicedesk' */
import { useState } from "react";
import { Send } from "lucide-react";
import { WORK_PRIORITY_META } from "../data/workitems";
import { SLA_STATE_LABEL, formatBusinessMinutes } from "../data/servicedesk";
import { formatDate, timeAgo } from "../time";
import Markdown from "./Markdown";
/**
 * An SLA clock as a small badge: state, and time used of the target.
 * @param {{ label: string; clock: SlaClock }} props
 */
export function SlaBadge({ label, clock }) {
  const cls = clock.state === "breached" ? "breached" : clock.atRisk ? "at-risk" : clock.state;
  const text = `${label}: ${SLA_STATE_LABEL[clock.state]}${clock.atRisk && clock.state !== "breached" ? " (at risk)" : ""}`;
  return (
    <span className={`sla-badge ${cls}`} title={`${formatBusinessMinutes(clock.elapsedMinutes)} of ${formatBusinessMinutes(clock.targetMinutes)} business time used${clock.dueAt ? `; due ${new Date(clock.dueAt).toLocaleString("en-GB")}` : ""}`}>
      {text}
      <span className="sr-only">
        , {formatBusinessMinutes(clock.elapsedMinutes)} of {formatBusinessMinutes(clock.targetMinutes)} used
      </span>
    </span>
  );
}
/** @type {WorkPriority[]} */ const URGENCY = ["HIGHEST", "HIGH", "MEDIUM", "LOW"];
/**
 * The form people raise a request with, on the portal and in Pulse.
 * @param {{ types: RequestType[]; askContact: boolean; onSubmit: (b: Record<string, unknown>) => Promise<void> }} props
 */
export function RequestForm({ types, askContact, onSubmit }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(/** @type {WorkPriority | (() => WorkPriority)} */ ("MEDIUM"));
  const [answers, setAnswers] = useState(/** @type {Record<string, string> | (() => Record<string, string>)} */ ({}));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const type = types.find((t) => t.id === typeId);
  if (!types.length) return <p className="muted">There's nothing to ask for yet.</p>;
  return (
    <form
      className="set-form request-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit({ typeId, summary, description, priority, answers, ...(askContact ? { name, email } : {}) });
          setSummary("");
          setDescription("");
          setAnswers({});
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't send your request");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="request-types">
        <legend>What do you need?</legend>
        {types.map((t) => (
          <label key={t.id} className={`request-type ${t.id === typeId ? "on" : ""}`}>
            <input type="radio" name="request-type" value={t.id} checked={t.id === typeId} onChange={() => setTypeId(t.id)} />
            <b>{t.name}</b>
            <small>{t.description}</small>
          </label>
        ))}
      </fieldset>
      {askContact && (
        <div className="field-row">
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} required />
          </label>
          <label className="field">
            <span>Your email (we reply here)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} required />
          </label>
        </div>
      )}
      <label className="field">
        <span>Short title</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} required placeholder="The call-recording page won't load" />
      </label>
      {type?.fields.map((f) => (
        <label key={f.id} className="field">
          <span>
            {f.label}
            {f.required ? "" : " (optional)"}
          </span>
          {f.kind === "textarea" ? (
            <textarea rows={3} value={answers[f.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} required={f.required} maxLength={4000} />
          ) : f.kind === "select" ? (
            <select value={answers[f.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} required={f.required}>
              <option value="">Choose…</option>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input type={f.kind === "date" ? "date" : "text"} value={answers[f.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} required={f.required} maxLength={300} />
          )}
          {f.help && <small className="field-hint">{f.help}</small>}
        </label>
      ))}
      <label className="field">
        <span>Details</span>
        <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={20000} placeholder="What happened, what you expected, and anything you've tried." />
      </label>
      <label className="field narrow-select">
        <span>How urgent is it?</span>
        <select value={priority} onChange={(e) => setPriority(/** @type {WorkPriority} */ (e.target.value))}>
          {URGENCY.map((p) => (
            <option key={p} value={p}>
              {WORK_PRIORITY_META[p].label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-amber" disabled={busy || !summary.trim()}>
        <Send size={14} /> {busy ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
/**
 * One request as its customer sees it: what they asked, the public replies, and a reply box.
 * @param {{ request: PortalRequest; onReply: (text: string) => Promise<void> }} props
 */
export function RequestView({ request, onReply }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = Date.now();
  return (
    <article className="request-view">
      <header>
        <h3>
          <span className="muted">{request.key}</span> {request.summary}
        </h3>
        <p>
          <span className={`pill-lite ${request.done ? "done" : request.waiting ? "waiting" : ""}`}>{request.waiting ? "Waiting for your reply" : request.statusName}</span> · {request.typeName} · raised {formatDate(request.createdAt)}
          {request.resolvedAt ? ` · resolved ${formatDate(request.resolvedAt)}` : ""}
        </p>
      </header>
      {request.answers.length > 0 && (
        <dl className="answers">
          {request.answers.map((a) => (
            <div key={a.label}>
              <dt>{a.label}</dt>
              <dd>{a.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {request.description && (
        <div className="request-desc">
          <Markdown text={request.description} />
        </div>
      )}
      <h4>Conversation</h4>
      {!request.replies.length && <p className="muted">No replies yet. The team will reply here and by email.</p>}
      <ol className="replies">
        {request.replies.map((r, i) => (
          <li key={i} className={r.fromCustomer ? "mine" : ""}>
            <b>{r.fromCustomer ? `${r.author} (you)` : r.author}</b> <small className="muted">{timeAgo(r.at, now)}</small>
            <Markdown text={r.body} />
          </li>
        ))}
      </ol>
      <form
        className="reply-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onReply(text);
            setText("");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't send");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{request.done ? "Not fixed? Reply and the team will look again" : "Reply"}</span>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-navy sm" disabled={busy || !text.trim()}>
          <Send size={13} /> Send reply
        </button>
      </form>
    </article>
  );
}
