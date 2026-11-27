/** @import { ReactNode } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { Feature } from '../data/features' */
/** @import { User } from '../data/roles' */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, RotateCcw, Sparkles, X } from "lucide-react";
import { ApiError, shareToken } from "../data/api";
import { isLate, isOpen } from "../data/features";
import AskToPql from "./AskToPql";
const PRIORITY_ORDER = /** @type {const} */ ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 });
/**
 * Copies an answer; "Draft:" sections are copied on their own when there is one.
 * @param {{ text: string }} props
 */
function CopyAnswer({ text }) {
  const [done, setDone] = useState(false);
  const draft = text.split(/^\s*\**Draft:?\**\s*$/im)[1]?.trim();
  return (
    <button
      type="button"
      className="ask-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText((draft || text).replace(/\*\*/g, ""));
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : draft ? "Copy draft" : "Copy"}
    </button>
  );
}
const escapeRe =
  /** @param {string} s
   * @returns {string}
   */ (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Ask Pulse: plain-English questions answered by the server from the live data.
 * The conversation stays while the page is open; follow-ups carry the last two turns.
 * @param {Props} arg1
 */
export default function AskPanel({ open, onClose, systems, users, features, me, developer, onOpenProject, onSearch }) {
  const [turns, setTurns] = useState(/** @type {Turn[] | (() => Turn[])} */ ([]));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const end = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 60);
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = /** @param {KeyboardEvent} e */ (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // Starter questions use real names from the data, so they always have an answer.
  const examples = useMemo(() => {
    if (developer) {
      // Built from this developer's own projects and requests.
      const now = Date.now();
      const mine = features.filter((f) => f.assignee === me.id && isOpen(f));
      const top = [...mine].sort((a, b) => Number(isLate(b, now)) - Number(isLate(a, now)) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])[0];
      const project = systems.find((s) => me.projectIds?.includes(s.id) && !s.finishedAt) ?? systems.find((s) => me.projectIds?.includes(s.id));
      return [
        "What should I work on today?",
        project ? `Draft a progress update for ${project.name}` : "Draft a progress update for my project",
        top ? `Break down "${top.title}" into tasks and acceptance criteria` : "Which of my requests are due soonest?",
        top ? `How should I approach "${top.title}" technically?` : "What's due for me in the next two weeks?",
        "Write a message to my manager about my blockers and what I need",
        "Which of my requests are overdue or at risk?",
      ];
    }
    const dev = users.find((u) => u.role === "developer" && u.projectIds?.length) ?? users.find((u) => u.role === "developer");
    const client = features.find((f) => f.client)?.client;
    return [
      "Which projects are blocked or stalled, and why?",
      dev ? `What did ${dev.name} deliver this quarter?` : "What was delivered this quarter?",
      client ? `Which projects for ${client} are still open?` : "Which projects are furthest behind schedule?",
      "Who has the most projects right now?",
      "Which critical or high-priority requests haven't started?",
      "What's due in the next 30 days?",
    ];
  }, [users, features, systems, me, developer]);
  const ask = /** @param {string} question */ async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    const history = turns
      .filter((t) => t.a)
      .slice(-2)
      .map((t) => ({ q: t.q, a: /** @type {NonNullable<typeof t.a>} */ (t.a) }));
    setTurns((t) => [...t, { q }]);
    setBusy(true);
    // The answer streams in (server-sent events), so it shows as it's written.
    const show = /** @param {string} a */ (a) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...(shareToken ? { "x-share-token": shareToken } : {}) },
        body: JSON.stringify({ question: q, history }),
      });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({}));
        throw new ApiError(res.status, payload.error ?? "The assistant didn't respond. Try again in a moment.", payload.code);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const data = ev.replace(/^data:\s*/m, "").trim();
          if (!data || data === "[DONE]") continue;
          try {
            // Number-only pieces can arrive in `response` as JSON numbers, so don't filter by type.
            const event = JSON.parse(data);
            const piece = event.choices?.[0]?.delta?.content ?? event.response;
            if (piece !== undefined && piece !== null) answer += String(piece);
          } catch {
            // A partial or non-JSON line: skip it.
          }
        }
        // The model very occasionally loops on one character; stop it rather than show it.
        if (/([^\s\-=_*#`.])\1{29,}/.test(answer)) {
          await reader.cancel().catch(() => undefined);
          throw new Error("The assistant got stuck on that one. Ask again, perhaps in different words.");
        }
        if (answer) show(answer);
      }
      show(answer.trim() || "Sorry, I couldn't put an answer together. Try asking another way.");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Couldn't reach Pulse. Check your connection.";
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: msg } : x)));
    } finally {
      setBusy(false);
    }
  };
  // Project names in answers become links to the project page.
  const linkify = useMemo(() => {
    const named = [...systems].filter((s) => s.name.trim().length > 2).sort((a, b) => b.name.length - a.name.length);
    if (!named.length) return /** @param {string} text @returns {ReactNode} */ (text) => text;
    const byName = new Map(named.map((s) => [s.name.toLowerCase(), s.id]));
    const re = new RegExp(`(${named.map((s) => escapeRe(s.name)).join("|")})`, "gi");
    return /** @param {string} text @returns {ReactNode} */ (text) =>
      text.split(re).map((part, i) => {
        const id = byName.get(part.toLowerCase());
        return id ? (
          <button
            key={i}
            className="ask-link"
            onClick={() => {
              onOpenProject(id);
              onClose();
            }}
          >
            {part}
          </button>
        ) : (
          part
        );
      });
  }, [systems, onOpenProject, onClose]);
  const inline = /** @param {string} text */ (text) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{linkify(part)}</b> : <span key={i}>{linkify(part)}</span>));
  // A light reading of the model's markdown: paragraphs, "-" and "1." lists, ``` code blocks
  // and headings (shown as bold lines).
  const render = /** @param {string} answer */ (answer) => {
    /** @type {ReactNode[]} */ const blocks = [];
    /** @type {string[]} */ let list = [];
    let ordered = false;
    /** @type {string[] | null} */ let code = null;
    const flush = () => {
      if (list.length) {
        const items = list.map((l, i) => <li key={i}>{inline(l)}</li>);
        blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      }
      list = [];
    };
    for (const raw of answer.split("\n")) {
      if (raw.trim().startsWith("```")) {
        if (code) {
          blocks.push(
            <pre key={blocks.length} className="ask-code">
              <code>{code.join("\n")}</code>
            </pre>,
          );
          code = null;
        } else {
          flush();
          code = [];
        }
        continue;
      }
      if (code) {
        code.push(raw);
        continue;
      }
      const line = raw.trim();
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const numbered = line.match(/^\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        if (list.length && ordered !== !!numbered) flush();
        ordered = !!numbered;
        list.push(/** @type {RegExpMatchArray} */ (bullet ?? numbered)[1]);
      } else {
        flush();
        if (/^#+\s/.test(line))
          blocks.push(
            <p key={blocks.length} className="ask-h">
              {inline(line.replace(/^#+\s*/, ""))}
            </p>,
          );
        else if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
      }
    }
    flush();
    // An unfinished code block while the answer is still streaming in.
    if (code)
      blocks.push(
        <pre key={blocks.length} className="ask-code">
          <code>{/** @type {string[]} */ (code).join("\n")}</code>
        </pre>,
      );
    return blocks;
  };
  if (!open) return null;
  return (
    <div className="backdrop drawer-backdrop ask-backdrop no-print" onClick={onClose}>
      <aside className="drawer ask" role="dialog" aria-label="Ask Pulse" onClick={(e) => e.stopPropagation()}>
        <header className="ask-head">
          <span className="ask-badge">
            <Sparkles size={18} />
          </span>
          <div>
            <h2>Ask Pulse</h2>
            <p>{developer ? "Your work assistant: priorities, drafts, task breakdowns and tech help." : "Plain-English answers from the live project data."}</p>
          </div>
          {turns.length > 0 && (
            <button className="ask-clear" onClick={() => setTurns([])} title="Start a new conversation" aria-label="Start a new conversation">
              <RotateCcw size={16} />
            </button>
          )}
          <button className="close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="ask-body">
          {turns.length === 0 && (
            <div className="ask-empty">
              <p>{developer ? "Plan your day, draft updates and messages, break requests into tasks, or get technical help with your work. Try:" : "Ask about projects, people, clients, feature requests, blockers or deadlines. Try:"}</p>
              <div className="ask-examples">
                {examples.map((e) => (
                  <button key={e} onClick={() => ask(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="ask-turn">
              <div className="ask-q">{t.q}</div>
              {t.a && (
                <div className="ask-a">
                  {render(t.a)}
                  {(!busy || i < turns.length - 1) && <CopyAnswer text={t.a} />}
                  {onSearch && !shareToken && (!busy || i < turns.length - 1) && <AskToPql question={t.q} onSearch={onSearch} />}
                </div>
              )}
              {t.error && <div className="ask-a ask-error">{t.error}</div>}
              {!t.a && !t.error && (
                <div className="ask-a ask-thinking" aria-live="polite">
                  <span className="ask-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  Reading the latest data…
                </div>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>

        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            maxLength={400}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask a question…"}
            aria-label="Your question"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
          />
          <button type="submit" className="ask-send" disabled={!draft.trim() || busy} aria-label="Ask">
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </form>
        <p className="ask-note">AI answers can be wrong. Check the project page before acting on them.</p>
      </aside>
    </div>
  );
}
/**
 * @typedef {Object} Turn
 * @property {string} q
 * @property {string} [a]
 * @property {string} [error]
 */
/**
 * @typedef {Object} Props
 * @property {boolean} open
 * @property {() => void} onClose
 * @property {System[]} systems
 * @property {User[]} users
 * @property {Feature[]} features
 * @property {User} me
 * @property {boolean} developer
 * @property {(id: string) => void} onOpenProject
 * @property {(pql: string) => void} [onSearch]
 */
