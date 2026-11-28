// Ask AI, phase (d) (docs/assistant-plan.md): changes the assistant proposes and the person confirms. Shared by the
// Worker (src/actions.js) and the panel.
//   - A write tool never changes anything: it stores a proposal (ai_actions) and the panel shows it as a card. Only
//     the person's own click on Confirm runs it, as ordinary API requests with their own session.
//   - tableToProposal: an extracted table (requirements, action items, defects…) as the work items or risks it
//     would become, for the "Create work items" button under the table.
//   - fillPlaceholders: a request that needs the result of an earlier one ({{0.id}}: the id the first one returned).
import { WORK_PRIORITIES, WORK_TYPES } from "./workitems.js";

/** A proposal waits this long for the person to confirm it. */
export const ACTION_TTL_MS = 30 * 60_000;
/** Most items one proposal may create or change. */
export const MAX_BULK = 50;
export { WORK_PRIORITIES, WORK_TYPES };

/** A priority as documents write it (Must, Should, M, High…) as a work item's. @param {unknown} v @returns {string | undefined} */
export function priorityOf(v) {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return undefined;
  if (/^(critical|blocker|highest|urgent|p0)$/.test(t)) return "HIGHEST";
  if (/^(must( have)?|m|high|major|p1|required)$/.test(t)) return "HIGH";
  if (/^(should( have)?|s|medium|normal|p2)$/.test(t)) return "MEDIUM";
  if (/^(could( have)?|c|low|minor|p3|optional)$/.test(t)) return "LOW";
  if (/^(won'?t( have)?|w|lowest|trivial|p4)$/.test(t)) return "LOWEST";
  return undefined;
}
const cut = (/** @type {unknown} */ v, /** @type {number} */ n) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

/**
 * What an extracted table would become, or null when its kind doesn't make anything.
 * @param {import("./extraction.js").ExtractionKind} kind
 * @param {Record<string, unknown>[]} rows
 * @param {string} projectId
 * @returns {{ tool: "create_work_items" | "create_risks"; args: Record<string, unknown>; label: string } | null}
 */
export function tableToProposal(kind, rows, projectId) {
  const take = rows.slice(0, MAX_BULK);
  if (!take.length) return null;
  /** @param {Record<string, unknown>} x */
  const clean = (x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && v !== ""));
  if (kind === "risks") {
    return {
      tool: "create_risks",
      label: `Add ${take.length} ${take.length === 1 ? "risk" : "risks"} to the register`,
      args: { projectId, risks: take.map((r) => clean({ risk: cut(r.risk, 500), likelihood: Number(r.likelihood) || 3, impact: Number(r.impact) || 3, mitigation: cut(r.mitigation, 1000), owner: cut(r.owner, 120) })) },
    };
  }
  /** @type {Record<string, unknown>[]} */ let items;
  if (kind === "requirements") items = take.map((r) => clean({ type: "STORY", summary: cut(`${r.id ? `${r.id} ` : ""}${r.description}`, 200), description: String(r.description ?? ""), priority: priorityOf(r.priority), assignee: cut(r.owner, 120), labels: ["requirement"] }));
  else if (kind === "actions") items = take.map((r) => clean({ type: "TASK", summary: cut(r.action, 200), description: String(r.action ?? ""), assignee: cut(r.owner, 120), dueDate: r.due, labels: ["action"] }));
  else if (kind === "defects")
    items = take.map((r) =>
      clean({
        type: "BUG",
        summary: cut(r.title, 200),
        description: [r.steps ? `Steps: ${r.steps}` : "", r.expected ? `Expected: ${r.expected}` : "", r.actual ? `Actual: ${r.actual}` : ""].filter(Boolean).join("\n\n") || String(r.title ?? ""),
        priority: priorityOf(r.severity),
        labels: ["uat"],
      }),
    );
  else if (kind === "acceptance_criteria") items = take.map((r) => clean({ type: "TASK", summary: cut(`${r.feature ? `${r.feature}: ` : ""}${r.criterion}`, 200), description: `Acceptance criterion: ${r.criterion}`, labels: ["acceptance"] }));
  else if (kind === "milestones") items = take.map((r) => clean({ type: "TASK", summary: cut(r.milestone, 200), dueDate: r.date, labels: ["milestone"] }));
  else return null;
  return { tool: "create_work_items", label: `Create ${items.length} work ${items.length === 1 ? "item" : "items"}`, args: { projectId, items } };
}

/**
 * A later request's body or path, with {{n.field}} replaced by what request n returned.
 * @template T
 * @param {T} value
 * @param {unknown[]} results  what each earlier request returned (its JSON)
 * @returns {T}
 */
export function fillPlaceholders(value, results) {
  /** @param {string} s */
  const fill = (s) =>
    s.replace(/\{\{(\d+)\.([a-zA-Z_]+)\}\}/g, (_m, i, f) => {
      const v = /** @type {any} */ (results[Number(i)])?.[f];
      if (v === undefined || v === null) throw new Error(`Step ${Number(i) + 1} didn't return its ${f}`);
      return String(v);
    });
  return /** @type {T} */ (JSON.parse(fill(JSON.stringify(value))));
}

/**
 * A proposal as the panel shows it.
 * @typedef {Object} ActionCard
 * @property {string} id
 * @property {string} tool
 * @property {string} title  what it does, in a sentence
 * @property {{ fields?: [string, string][]; table?: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }; warnings?: string[] }} preview
 * @property {"proposed" | "running" | "done" | "partly_done" | "failed" | "cancelled"} status  (an expired one reads as proposed past expiresAt)
 * @property {string} expiresAt
 * @property {{ ok: boolean; label: string; message?: string; href?: string }[]} [results]
 */
/**
 * One API request a proposal makes when confirmed.
 * @typedef {{ method: "POST" | "PATCH" | "PUT"; path: string; body?: unknown; label: string; dependsOn?: number }} ActionRequest
 */
