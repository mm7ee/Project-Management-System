// "What needs attention" on a project's page: everything waiting on someone, in one ranked list, each with the one
// action that moves it. Shared by the Worker (which gathers the facts) and the screens (DECISIONS.md, "Project page").
//
// The ranking is by kind first, most urgent kind first, then the oldest first within a kind:
//   1 an open blocker  2 a sign-off waiting on someone  3 the stage over its target  4 the stage nearing its target
//   with its gate not met  5 an overdue work item  6 an open update request  7 no progress update for too long.
import { workingDaysSince } from "./projectHealth";

export const ATTENTION_ORDER = /** @type {const} */ (["blocker", "signoff", "stage_overdue", "gate", "overdue_item", "update_request", "stale"]);
export const ATTENTION_LABEL = { blocker: "Blocker", signoff: "Sign-off", stage_overdue: "Stage late", gate: "Gate", overdue_item: "Overdue", update_request: "Update", stale: "Stale" };
/** Overdue work items listed one by one, at most; the rest are summed up in one entry. */
export const OVERDUE_LISTED = 5;
const DAY = 86_400_000;
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (/** @type {string} */ iso, /** @type {number} */ now) => {
  const d = Math.floor((now - Date.parse(iso)) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
/**
 * Sorts entries: kind by ATTENTION_ORDER, then the oldest first, then by title.
 * @param {AttentionEntry[]} entries
 * @returns {AttentionEntry[]}
 */
export function rankAttention(entries) {
  const rank = (/** @type {AttentionEntry} */ e) => ATTENTION_ORDER.indexOf(e.kind);
  return [...entries].sort((a, b) => rank(a) - rank(b) || (a.since < b.since ? -1 : a.since > b.since ? 1 : 0) || a.title.localeCompare(b.title));
}
/**
 * The ranked list for one project.
 * @param {AttentionFacts} f
 * @param {number} now
 * @returns {AttentionEntry[]}
 */
export function attentionFor(f, now) {
  const base = `#/projects/${f.systemId}`;
  /** @type {AttentionEntry[]} */ const out = [];
  for (const b of f.blockers) {
    out.push({ kind: "blocker", id: `blocker:${b.id}`, since: b.raisedAt, title: b.text, detail: `Raised by ${b.raisedByName} ${ago(b.raisedAt, now)}`, action: { kind: "resolve_blocker", label: "Resolve", ref: b.id } });
  }
  for (const s of f.signoffs) {
    const waited = workingDaysSince(s.requestedAt, now);
    out.push({
      kind: "signoff",
      id: `signoff:${s.id}`,
      since: s.requestedAt,
      title: `${s.document ?? s.stageName} is waiting on ${s.signerName}`,
      detail: `${s.label} · requested ${waited ? `${plural(waited, "business day")} ago` : "today"}`,
      action: { kind: "remind", label: "Send reminder", href: `${base}/lifecycle` },
    });
  }
  const st = f.stage;
  if (st && st.targetDays) {
    const still = st.missing.length ? `Still needed: ${st.missing.join("; ")}` : "Its exit criteria are met: it can move on";
    if (st.state === "overdue") {
      const over = Math.round((st.usedDays - st.targetDays) * 10) / 10;
      out.push({ kind: "stage_overdue", id: `stage:${st.code}`, since: st.enteredAt, title: `${st.name} is ${plural(over, "business day")} over its target`, detail: still, action: { kind: "open_stage", label: "Open stage", href: `${base}/lifecycle` } });
    } else if (st.state === "warning" && st.missing.length) {
      out.push({ kind: "gate", id: `gate:${st.code}`, since: st.enteredAt, title: `${st.name} has used ${st.usedDays} of its ${st.targetDays} business days`, detail: still, action: { kind: "open_stage", label: "Open stage", href: `${base}/lifecycle` } });
    }
  }
  const overdue = [...f.overdueItems].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  for (const w of overdue.slice(0, OVERDUE_LISTED)) {
    const late = Math.max(1, Math.floor((now - Date.parse(`${w.dueDate}T23:59:59Z`)) / DAY) + 1);
    out.push({ kind: "overdue_item", id: `item:${w.key}`, since: w.dueDate, title: `${w.key} ${w.summary}`, detail: `Due ${w.dueDate} (${plural(late, "day")} late) · ${w.assigneeName ?? "Unassigned"}`, action: { kind: "open_item", label: "Open", href: `${base}/items/${w.key}` } });
  }
  if (overdue.length > OVERDUE_LISTED) {
    const rest = overdue.slice(OVERDUE_LISTED);
    out.push({ kind: "overdue_item", id: "item:more", since: rest[0].dueDate, title: `${plural(rest.length, "more overdue work item")}`, detail: `The oldest was due ${rest[0].dueDate}`, action: { kind: "open_list", label: `Show ${rest.length}`, pql: f.overduePql } });
  }
  for (const r of f.requests) {
    out.push({ kind: "update_request", id: `request:${r.id}`, since: r.createdAt, title: `${r.requestedByName} asked for an update`, detail: r.message ? `“${r.message.slice(0, 140)}” · ${ago(r.createdAt, now)}` : ago(r.createdAt, now), action: { kind: "post_update", label: "Post update" } });
  }
  if (f.stalledDays !== null) {
    out.push({ kind: "stale", id: "stale", since: f.lastUpdate, title: `No progress update for ${plural(f.stalledDays, "day")}`, detail: "Say where it stands, or record what's in the way", action: { kind: "post_update", label: "Update progress" } });
  }
  return rankAttention(out);
}
/**
 * @typedef {Object} AttentionEntry
 * @property {typeof ATTENTION_ORDER[number]} kind
 * @property {string} id stable, for the screen's list
 * @property {string} since ISO date or timestamp: when it started waiting (the ranking's tie-break, oldest first)
 * @property {string} title
 * @property {string} detail
 * @property {{ kind: "resolve_blocker" | "remind" | "open_stage" | "open_item" | "open_list" | "post_update"; label: string; ref?: string; href?: string; pql?: string }} action
 */
/**
 * @typedef {Object} AttentionFacts
 * @property {string} systemId
 * @property {{ id: string; text: string; raisedAt: string; raisedByName: string }[]} blockers open ones
 * @property {{ id: string; signerName: string; label: string; stageName: string; document?: string | null; requestedAt: string }[]} signoffs pending ones of the current stage
 * @property {{ code: string; name: string; enteredAt: string; usedDays: number; targetDays: number | null; state: "running" | "warning" | "overdue"; missing: string[] } | null} stage
 * @property {{ key: string; summary: string; dueDate: string; assigneeName: string | null }[]} overdueItems visible to the viewer
 * @property {string} overduePql the work-item list behind "N more overdue"
 * @property {{ id: string; requestedByName: string; message: string; createdAt: string }[]} requests open update requests
 * @property {number | null} stalledDays
 * @property {string} lastUpdate
 */
