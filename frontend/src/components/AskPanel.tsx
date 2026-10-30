import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, Copy, RotateCcw, Sparkles, X } from "lucide-react";
import { ApiError, shareToken } from "../data/api";
import { isLate, isOpen } from "../data/features";
import type { System } from "../data/systems";
import type { Feature } from "../data/features";
import type { User } from "../data/roles";

interface Turn {
  q: string;
  a?: string;
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  systems: System[];
  users: User[];
  features: Feature[];
  me: User;
  developer: boolean; // a developer's personal work assistant rather than the team view
  onOpenProject: (id: string) => void;
}

const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/** Copies an answer; "Draft:" sections are copied on their own when there is one. */
function CopyAnswer({ text }: { text: string }) {
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ask Pulse: plain-English questions answered by the server from the live data.
 * The conversation stays while the page is open; follow-ups carry the last two turns.
 */
export default function AskPanel({ open, onClose, systems, users, features, me, developer, onOpenProject }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 60);
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Starter questions use real names from the data, so they always have an answer.
  const examples = useMemo(() => {
    if (developer) {
      // Built from this developer's own projects and requests.
      const now = Date.now();
      const mine = features.filter((f) => f.assignee === me.id && isOpen(f));
      const top = [...mine].sort(
        (a, b) => Number(isLate(b, now)) - Number(isLate(a, now)) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
      )[0];
      const project =
        systems.find((s) => me.projectIds?.includes(s.id) && !s.finishedAt) ?? systems.find((s) => me.projectIds?.includes(s.id));
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

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    const history = turns
      .filter((t) => t.a)
      .slice(-2)
      .map((t) => ({ q: t.q, a: t.a! }));
    setTurns((t) => [...t, { q }]);
    setBusy(true);
    // The answer streams in (server-sent events), so it shows as it's written.
    const show = (a: string) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
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
            const piece = JSON.parse(data).response;
            if (typeof piece === "string") answer += piece;
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
    if (!named.length) return (text: string): ReactNode => text;
    const byName = new Map(named.map((s) => [s.name.toLowerCase(), s.id]));
    const re = new RegExp(`(${named.map((s) => escapeRe(s.name)).join("|")})`, "gi");
    return (text: string): ReactNode =>
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

  const inline = (text: string) =>
    text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{linkify(part)}</b> : <span key={i}>{linkify(part)}</span>));

  // A light reading of the model's markdown: paragraphs, "-" and "1." lists, ``` code blocks
  // and headings (shown as bold lines).
  const render = (answer: string) => {
    const blocks: ReactNode[] = [];
    let list: string[] = [];
    let ordered = false;
    let code: string[] | null = null;
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
        list.push((bullet ?? numbered)![1]);
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
          <code>{(code as string[]).join("\n")}</code>
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
            <p>
              {developer
                ? "Your work assistant: priorities, drafts, task breakdowns and tech help."
                : "Plain-English answers from the live project data."}
            </p>
          </div>
          {turns.length > 0 && (
            <button
              className="ask-clear"
              onClick={() => setTurns([])}
              title="Start a new conversation"
              aria-label="Start a new conversation"
            >
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
              <p>
                {developer
                  ? "Plan your day, draft updates and messages, break requests into tasks, or get technical help with your work. Try:"
                  : "Ask about projects, people, clients, feature requests, blockers or deadlines. Try:"}
              </p>
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
