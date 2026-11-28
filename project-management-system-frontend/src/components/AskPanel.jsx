/** @import { ReactNode } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { Feature } from '../data/features' */
/** @import { User } from '../data/roles' */
import { BRAND } from "../data/brand";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Check, CircleCheck, Copy, Download, Plus, RotateCcw, Sparkles, X, Zap } from "lucide-react";
import { tableToProposal } from "../data/actions";
import { ApiError, api, shareToken } from "../data/api";
import { isLate, isOpen } from "../data/features";
import { modelLabel, readEvents } from "../data/assistant";
import { toCsv } from "../data/extraction";
import { CONTEXT_LABELS } from "../data/skills";
/** @type {Record<string, string>} */
const SKILL_HEADINGS = { ...CONTEXT_LABELS, document: "For this project's documents", project: "For this project", item: "For this work item", request: "For this request" };
/**
 * A change Ask AI proposes: what it would do, and Confirm / Cancel. Nothing happens until the person confirms; then
 * the server runs it with their own session and says how each step went.
 * @param {{ card: import("../data/actions").ActionCard }} props
 */
function ActionCardView({ card: first }) {
  const [card, setCard] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expired = card.status === "proposed" && Date.parse(card.expiresAt) <= Date.now();
  /** @param {"confirm" | "cancel"} what */
  const act = async (what) => {
    setBusy(true);
    setError("");
    try {
      setCard(/** @type {import("../data/actions").ActionCard} */ (await api(`/assistant/actions/${card.id}/${what}`, "POST")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const p = card.preview;
  const STATE = { done: "Done", partly_done: "Partly done", failed: "Didn't work", cancelled: "Cancelled", running: "Working…", proposed: expired ? "Expired: ask again" : "Waiting for you to confirm" };
  return (
    <section className={`ask-action is-${card.status}`} aria-label={card.title}>
      <header>
        <b>{card.title}</b>
        <span className="ask-action-state">{STATE[card.status]}</span>
      </header>
      {!!p.fields?.length && (
        <dl>
          {p.fields.map(([k, v], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {p.table && p.table.rows.length > 0 && (
        <div className="ask-table-wrap">
          <table>
            <thead>
              <tr>
                {p.table.columns.map((col) => (
                  <th key={col.key} scope="col">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.table.rows.map((r, i) => (
                <tr key={i}>
                  {p.table?.columns.map((col) => (
                    <td key={col.key}>{String(r[col.key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.warnings?.map((w, i) => (
        <p key={i} className="ask-action-warn">
          <AlertTriangle size={13} /> {w}
        </p>
      ))}
      {card.results && (
        <ul className="ask-action-results">
          {card.results.map((r, i) => (
            <li key={i} className={r.ok ? "ok" : "bad"}>
              {r.ok ? <Check size={13} /> : <X size={13} />} {r.href ? <a href={r.href}>{r.label}</a> : r.label}
              {r.message && <span className="muted"> · {r.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="ask-action-warn">{error}</p>}
      {card.status === "proposed" && !expired && (
        <div className="ask-action-buttons">
          <button type="button" className="btn btn-primary sm" disabled={busy} onClick={() => act("confirm")}>
            <Check size={14} /> {busy ? "Working…" : "Confirm"}
          </button>
          <button type="button" className="btn btn-ghost sm" disabled={busy} onClick={() => act("cancel")}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A table an answer carries (an extraction, a traceability check), with its note and CSV, and, for rows that can
 * become work items or risks, a button that proposes it (one confirmation for them all).
 * @param {{ table: import("../data/extraction").AnswerTable; canWrite: boolean }} props
 */
function AnswerTableView({ table, canWrite }) {
  const [copied, setCopied] = useState(false);
  const [card, setCard] = useState(/** @type {import("../data/actions").ActionCard | null} */ (null));
  const [making, setMaking] = useState("");
  const offer = canWrite && table.kind && table.projectId ? tableToProposal(/** @type {import("../data/extraction").ExtractionKind} */ (table.kind), table.rows, table.projectId) : null;
  const csv = () => toCsv(table.columns, table.rows);
  const file = `${table.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "table"}.csv`;
  return (
    <figure className="ask-table">
      <figcaption>
        <b>{table.title}</b> <span className="muted">· {table.rows.length} {table.rows.length === 1 ? "row" : "rows"}</span>
      </figcaption>
      {table.rows.length ? (
        <div className="ask-table-wrap">
          <table>
            <thead>
              <tr>
                {table.columns.map((col) => (
                  <th key={col.key} scope="col">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className={r.coverage === "Gap" ? "gap" : r.coverage === "Probably covered" ? "maybe" : ""}>
                  {table.columns.map((col) => (
                    <td key={col.key}>{r[col.key] === undefined || r[col.key] === null ? "" : String(r[col.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nothing found.</p>
      )}
      {table.note && <p className="ask-table-note">{table.note}</p>}
      {table.rows.length > 0 && (
        <div className="ask-table-actions">
          <button
            type="button"
            className="ask-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(csv());
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy table"}
          </button>
          <button
            type="button"
            className="ask-copy"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([`﻿${csv()}`], { type: "text/csv;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = file;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={13} /> Download CSV
          </button>
          {offer && !card && (
            <button
              type="button"
              className="ask-copy ask-make"
              disabled={making === "…"}
              onClick={async () => {
                setMaking("…");
                try {
                  setCard(/** @type {import("../data/actions").ActionCard} */ (await api("/assistant/actions", "POST", { tool: offer.tool, args: offer.args })));
                  setMaking("");
                } catch (e) {
                  setMaking(e instanceof Error ? e.message : "That didn't work");
                }
              }}
            >
              <Plus size={13} /> {offer.label}…
            </button>
          )}
        </div>
      )}
      {making && making !== "…" && <p className="ask-action-warn">{making}</p>}
      {card && <ActionCardView card={card} />}
    </figure>
  );
}
import AskToPql from "./AskToPql";
/** Source links the app can open (a project and its tabs, a chat, reports). */
const OPENABLE = /^#\/(projects|chat|reports)(\/|$)/;
/**
 * Sends a question. A view-only link carries its token.
 * @param {string} path @param {unknown} body
 */
const post = (path, body) =>
  fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(shareToken ? { "x-share-token": shareToken } : {}) },
    body: JSON.stringify(body),
  });
/** @param {Response} res */
const failure = async (res) => {
  const payload = await res.json().catch(() => ({}));
  return new ApiError(res.status, payload.error ?? "The assistant didn't respond. Try again in a moment.", payload.code);
};
/**
 * The earlier answer, from one snapshot of what the person may see, streamed as it's written. Used when the
 * assistant can't run its tools (an older server, or the model failing mid-way).
 * @param {string} question
 * @param {{ q: string; a: string }[]} history
 * @param {(f: (t: Turn) => Partial<Turn>) => void} patch
 */
async function askSnapshot(question, history, patch) {
  const res = await post("/api/ask", { question, history });
  if (!res.ok || !res.body) throw await failure(res);
  let answer = "";
  let stuck = false;
  patch(() => ({ snapshot: true }));
  await readEvents(res.body, (event) => {
    // Number-only pieces can arrive in `response` as JSON numbers, so don't filter by type.
    const piece = event.choices?.[0]?.delta?.content ?? event.response;
    if (piece !== undefined && piece !== null) answer += String(piece);
    // The model very occasionally loops on one character; stop it rather than show it.
    if (/([^\s\-=_*#`.])\1{29,}/.test(answer)) stuck = true;
    else if (answer) patch(() => ({ a: answer }));
    return stuck;
  });
  if (stuck) throw new ApiError(502, "The assistant got stuck on that one. Ask again, perhaps in different words.");
  patch(() => ({ a: answer.trim() || "Sorry, I couldn't put an answer together. Try asking another way." }));
}
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
 * Ask AI: plain-English questions answered by the server from the live data.
 * The conversation stays while the page is open; follow-ups carry the last two turns.
 * @param {Props} arg1
 */
export default function AskPanel({ open, onClose, systems, users, features, me, developer, onOpenProject, onSearch, context }) {
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
  // The skills for where the person is (the server knows whether an open item is a service request).
  const [skills, setSkills] = useState(/** @type {SkillButton[]} */ ([]));
  const where = JSON.stringify(context ?? {});
  useEffect(() => {
    if (!open) return;
    let live = true;
    const q = new URLSearchParams(Object.entries(context ?? {}).filter((e) => typeof e[1] === "string" && e[1]));
    api(`/assistant/skills?${q}`)
      .then((r) => live && setSkills(/** @type {{ skills: SkillButton[] }} */ (r).skills ?? []))
      .catch(() => live && setSkills([]));
    return () => {
      live = false;
    };
  }, [open, where]);
  /** @param {string} question @param {SkillButton} [skill] */
  const ask = async (question, skill) => {
    const q = (skill ? skill.prompt : question).trim();
    if (!q || busy) return;
    setDraft("");
    const history = turns
      .filter((t) => t.a)
      .slice(-4)
      .map((t) => ({ q: t.q, a: /** @type {NonNullable<typeof t.a>} */ (t.a) }));
    setTurns((t) => [...t, { q, steps: [], ...(skill ? { skill: skill.label } : {}) }]);
    setBusy(true);
    /** @param {(t: Turn) => Partial<Turn>} f */
    const patch = (f) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, ...f(x) } : x)));
    try {
      // The assistant looks things up with tools, as the person asking, and cites what it found.
      // A skill sends only its id: the server builds its question and decides its tools.
      const res = await post("/api/assistant", skill ? { skill: skill.id, history, context } : { question: q, history, context });
      let answered = false;
      // An older server (404) or the assistant off (503): the snapshot answer below says why, or answers.
      if (res.ok && res.body) {
        await readEvents(res.body, (event) => {
          if (event.type === "step") patch((t) => ({ steps: [...(t.steps ?? []), String(event.label)] }));
          if (event.type === "answer") {
            answered = true;
            patch(() => ({ a: String(event.text), sources: event.sources ?? [], tables: event.tables ?? [], actions: event.actions ?? [], unverified: event.unverified ?? [], meta:{ model: String(event.model), tools: (event.tools ?? []).length, ms: Number(event.ms) } }));
          }
        });
      } else if (![404, 405, 503].includes(res.status)) throw await failure(res);
      if (!answered) await askSnapshot(q, history.slice(-2), patch);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
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
  /** @param {string} href */
  const go = (href) => {
    window.location.hash = href.slice(1);
    onClose();
  };
  // [S2] marks become numbered links to the source they cite.
  /** @param {string} text @param {Source[]} sources */
  const cite = (text, sources) =>
    text.split(/\s?\[(S\d+)\]/g).map((part, i) => {
      if (i % 2 === 0) return <span key={i}>{linkify(part)}</span>;
      const n = sources.findIndex((s) => s.id === part);
      const s = sources[n];
      if (!s) return null;
      return OPENABLE.test(s.href) ? (
        <button key={i} type="button" className="ask-cite" title={s.label} onClick={() => go(s.href)}>
          {n + 1}
        </button>
      ) : (
        <sup key={i} className="ask-cite" title={s.label}>
          {n + 1}
        </sup>
      );
    });
  /** @type {Source[]} */ let citing = [];
  const inline = /** @param {string} text */ (text) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{cite(part, citing)}</b> : <span key={i}>{cite(part, citing)}</span>));
  // A light reading of the model's markdown: paragraphs, "-" and "1." lists, ``` code blocks
  // and headings (shown as bold lines).
  const render = /** @param {string} answer @param {Source[]} [sources] */ (answer, sources = []) => {
    citing = sources;
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
      <aside className="drawer ask" role="dialog" aria-label={BRAND.assistantName} onClick={(e) => e.stopPropagation()}>
        <header className="ask-head">
          <span className="ask-badge">
            <Sparkles size={18} />
          </span>
          <div>
            <h2>{BRAND.assistantName}</h2>
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
              {skills.length > 0 ? (
                // Skills for where the person is: the first context's first (a project, a document, an item…).
                [...new Set(skills.map((s) => s.context))].map((ctx) => (
                  <section key={ctx} className="ask-skills" aria-label={SKILL_HEADINGS[ctx] ?? "Skills"}>
                    <p className="ask-skills-h">{SKILL_HEADINGS[ctx] ?? "Skills"}</p>
                    <div className="ask-examples">
                      {skills
                        .filter((s) => s.context === ctx)
                        .map((s) => (
                          <button key={s.id} title={s.prompt} onClick={() => ask("", s)}>
                            <Zap size={13} aria-hidden="true" /> {s.label}
                            {s.custom && <span className="ask-skill-own">Your organisation's</span>}
                          </button>
                        ))}
                    </div>
                  </section>
                ))
              ) : (
                <>
                  <p>{developer ? "Plan your day, draft updates and messages, break requests into tasks, or get technical help with your work. Try:" : "Ask about projects, people, clients, feature requests, blockers or deadlines. Try:"}</p>
                  <div className="ask-examples">
                    {examples.map((e) => (
                      <button key={e} onClick={() => ask(e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="ask-turn">
              <div className="ask-q">
                {t.skill && (
                  <span className="ask-q-skill">
                    <Zap size={12} aria-hidden="true" /> {t.skill}
                  </span>
                )}
                {t.q}
              </div>
              {t.a && (
                <div className="ask-a">
                  {render(t.a, t.sources)}
                  {t.tables?.map((tb, n) => <AnswerTableView key={n} table={tb} canWrite={!shareToken} />)}
                  {t.actions?.map((card) => <ActionCardView key={card.id} card={card} />)}
                  {!!t.sources?.length && (
                    <ol className="ask-sources" aria-label="Sources">
                      {t.sources.map((s) => (
                        <li key={s.id}>
                          {OPENABLE.test(s.href) ? (
                            <button type="button" onClick={() => go(s.href)}>
                              {s.label}
                            </button>
                          ) : (
                            <span>{s.label}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {t.meta && (
                    <p className="ask-meta">
                      {t.unverified?.length ? (
                        <span className="ask-unverified" title="These figures weren't in anything the assistant looked up. Check them before you rely on them.">
                          <AlertTriangle size={13} /> Check {t.unverified.slice(0, 4).join(", ")}: not found in the data
                        </span>
                      ) : (
                        <span className="ask-verified">
                          <CircleCheck size={13} /> Figures checked against the data
                        </span>
                      )}
                      <span>
                        {modelLabel(t.meta.model)} · {t.meta.tools} {t.meta.tools === 1 ? "lookup" : "lookups"} · {(t.meta.ms / 1000).toFixed(1)} s
                      </span>
                    </p>
                  )}
                  {t.snapshot && !busy && <p className="ask-meta">Answered from a snapshot of the data.</p>}
                  {(!busy || i < turns.length - 1) && <CopyAnswer text={t.a.replace(/\s?\[S\d+\]/g, "")} />}
                  {onSearch && !shareToken && (!busy || i < turns.length - 1) && <AskToPql question={t.q} onSearch={onSearch} />}
                </div>
              )}
              {t.error && <div className="ask-a ask-error">{t.error}</div>}
              {!t.a && !t.error && (
                <div className="ask-a ask-thinking" aria-live="polite">
                  {!!t.steps?.length && (
                    <ul className="ask-steps">
                      {t.steps.map((s, n) => (
                        <li key={n}>
                          <Check size={12} /> {s}
                        </li>
                      ))}
                    </ul>
                  )}
                  <span className="ask-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  {t.steps?.length ? "Working it out…" : "Reading the latest data…"}
                </div>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
        {turns.length > 0 && skills.length > 0 && !busy && (
          <div className="ask-skill-row" aria-label="Skills">
            {skills.slice(0, 8).map((s) => (
              <button key={s.id} title={s.prompt} onClick={() => ask("", s)}>
                <Zap size={12} aria-hidden="true" /> {s.label}
              </button>
            ))}
          </div>
        )}

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
 * @property {string[]} [steps]  what the assistant looked up, as it goes
 * @property {Source[]} [sources]  what the answer cites
 * @property {string[]} [unverified]  figures in the answer that nothing looked up contains
 * @property {{ model: string; tools: number; ms: number }} [meta]
 * @property {boolean} [snapshot]  answered the earlier way, from one snapshot
 * @property {import("../data/extraction").AnswerTable[]} [tables]  extractions and checks, shown under the answer
 * @property {string} [skill]  the skill that asked
 * @property {import("../data/actions").ActionCard[]} [actions]  changes proposed, waiting for the person to confirm
 */
/**
 * A skill the server offers for where the person is.
 * @typedef {{ id: string; label: string; context: string; custom: boolean; prompt: string }} SkillButton
 */
/**
 * @typedef {Object} Source
 * @property {string} id
 * @property {string} label
 * @property {string} href
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
 * @property {{ projectId?: string; section?: string; itemKey?: string; document?: string; page?: string }} [context]  the page the person is on
 */
