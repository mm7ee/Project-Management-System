import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { api, ApiError } from "../data/api";
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
  onOpenProject: (id: string) => void;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ask OmniTrack: plain-English questions answered by the server from the live data.
 * The conversation stays while the page is open; follow-ups carry the last two turns.
 */
export default function AskPanel({ open, onClose, systems, users, features, onOpenProject }: Props) {
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
  }, [users, features]);

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
    try {
      const { answer } = await api<{ answer: string }>("/ask", "POST", { question: q, history });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer } : x)));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Couldn't reach OmniTrack. Check your connection.";
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

  // A light reading of the model's markdown: paragraphs and "-" / "*" / "1." lists.
  const render = (answer: string) => {
    const blocks: ReactNode[] = [];
    let list: string[] = [];
    const flush = () => {
      if (list.length)
        blocks.push(
          <ul key={blocks.length}>
            {list.map((l, i) => (
              <li key={i}>{inline(l)}</li>
            ))}
          </ul>,
        );
      list = [];
    };
    for (const raw of answer.split("\n")) {
      const line = raw.trim();
      const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) list.push(item[1]);
      else {
        flush();
        if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
      }
    }
    flush();
    return blocks;
  };

  if (!open) return null;
  return (
    <div className="backdrop drawer-backdrop no-print" onClick={onClose}>
      <aside className="drawer ask" role="dialog" aria-label="Ask OmniTrack" onClick={(e) => e.stopPropagation()}>
        <header className="ask-head">
          <span className="ask-badge">
            <Sparkles size={18} />
          </span>
          <div>
            <h2>Ask OmniTrack</h2>
            <p>Plain-English answers from the live project data.</p>
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
              <p>Ask about projects, people, clients, feature requests, blockers or deadlines. Try:</p>
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
              {t.a && <div className="ask-a">{render(t.a)}</div>}
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
