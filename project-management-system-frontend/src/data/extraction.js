// Ask AI, phase (c) (docs/assistant-plan.md): structured extraction from documents. Shared by the Worker
// (src/extract.js) and the tests.
//   - EXTRACTIONS: what can be extracted (requirements, risks, action items, milestones, acceptance criteria,
//     defects), each with its columns and the JSON schema every row must pass.
//   - parseExtraction: the model's JSON → rows that pass the schema (the rest are counted, not shown).
//   - groundRows: keeps only rows whose main text is in the document, so nothing invented reaches the table.
//   - kitRequirements: a BRS or BSS written in PMS gives its requirements from its own data, exactly.
//   - toCsv: a table as CSV, for copying or downloading.
import { validateArgs } from "./assistant.js";
import { docId } from "./documentKits.js";

const DATE = "^\\d{4}-\\d{2}-\\d{2}$";
/**
 * @type {Record<ExtractionKind, Extraction>}
 */
export const EXTRACTIONS = {
  requirements: {
    label: "Requirements",
    columns: [
      { key: "id", label: "ID" },
      { key: "description", label: "Requirement" },
      { key: "priority", label: "Priority" },
      { key: "owner", label: "Owner" },
    ],
    schema: { type: "object", properties: { id: { type: "string", maxLength: 40 }, description: { type: "string", maxLength: 1500 }, priority: { type: "string", maxLength: 30 }, owner: { type: "string", maxLength: 120 } }, required: ["description"] },
    ground: "description",
    instructions: "Every requirement the document states. id: its number as written (FRN-01, REQ-3), or empty. description: the requirement, in the document's words. priority: as written (Must, Should, M, S, High…), or empty. owner: the person or team named as responsible, or empty.",
  },
  risks: {
    label: "Risks",
    columns: [
      { key: "risk", label: "Risk" },
      { key: "likelihood", label: "Likelihood (1-5)" },
      { key: "impact", label: "Impact (1-5)" },
      { key: "mitigation", label: "Mitigation" },
      { key: "owner", label: "Owner" },
    ],
    schema: { type: "object", properties: { risk: { type: "string", maxLength: 1000 }, likelihood: { type: "integer", minimum: 1, maximum: 5 }, impact: { type: "integer", minimum: 1, maximum: 5 }, mitigation: { type: "string", maxLength: 1500 }, owner: { type: "string", maxLength: 120 } }, required: ["risk"] },
    ground: "risk",
    instructions: "Every risk the document names. risk: the risk, in the document's words. likelihood and impact: 1 (very low) to 5 (very high) when the document rates them (words map: very low 1, low 2, medium 3, high 4, very high 5), otherwise leave them out. mitigation and owner: as written, or empty.",
  },
  actions: {
    label: "Action items",
    columns: [
      { key: "action", label: "Action" },
      { key: "owner", label: "Owner" },
      { key: "due", label: "Due" },
    ],
    schema: { type: "object", properties: { action: { type: "string", maxLength: 1000 }, owner: { type: "string", maxLength: 120 }, due: { type: "string", pattern: DATE } }, required: ["action"] },
    ground: "action",
    instructions: "Every action item or follow-up the notes agree on. action: what is to be done, in the notes' words. owner: who will do it, as written, or empty. due: the date as YYYY-MM-DD only when the notes give one, otherwise leave it out.",
  },
  milestones: {
    label: "Dates and milestones",
    columns: [
      { key: "milestone", label: "Milestone" },
      { key: "date", label: "Date" },
    ],
    schema: { type: "object", properties: { milestone: { type: "string", maxLength: 500 }, date: { type: "string", pattern: DATE } }, required: ["milestone"] },
    ground: "milestone",
    instructions: "Every milestone, deadline or dated event. milestone: what happens, in the document's words. date: as YYYY-MM-DD only when the document gives a full date, otherwise leave it out.",
  },
  acceptance_criteria: {
    label: "Acceptance criteria",
    columns: [
      { key: "feature", label: "Feature" },
      { key: "criterion", label: "Acceptance criterion" },
    ],
    schema: { type: "object", properties: { feature: { type: "string", maxLength: 300 }, criterion: { type: "string", maxLength: 1500 } }, required: ["criterion"] },
    ground: "criterion",
    instructions: "Every acceptance criterion (what must be true for a feature to be accepted). feature: the feature or requirement it belongs to, or empty. criterion: the criterion, in the document's words.",
  },
  defects: {
    label: "Defects",
    columns: [
      { key: "title", label: "Defect" },
      { key: "severity", label: "Severity" },
      { key: "steps", label: "Steps" },
      { key: "expected", label: "Expected" },
      { key: "actual", label: "Actual" },
    ],
    schema: { type: "object", properties: { title: { type: "string", maxLength: 300 }, severity: { type: "string", maxLength: 30 }, steps: { type: "string", maxLength: 2000 }, expected: { type: "string", maxLength: 1000 }, actual: { type: "string", maxLength: 1000 } }, required: ["title"] },
    ground: "title",
    instructions: "Every defect or failed test the feedback reports. title: a short name for it in the feedback's words. severity: as written, or empty. steps, expected and actual: as written, or empty.",
  },
};
export const EXTRACTION_KINDS = /** @type {ExtractionKind[]} */ (Object.keys(EXTRACTIONS));
/** At most this many rows a table. */
export const MAX_ROWS = 150;

/**
 * Rows from the model's answer: a JSON object `{ "rows": [...] }` or an array, perhaps inside a ``` block or with
 * text around it. Each row must pass the kind's schema (unknown keys dropped); the others are counted as rejected.
 * @param {ExtractionKind} kind
 * @param {string} text
 * @returns {{ rows: Record<string, unknown>[]; rejected: number; unreadable: boolean }}
 */
export function parseExtraction(kind, text) {
  const spec = EXTRACTIONS[kind];
  const body = text.replace(/```(?:json)?/gi, "");
  /** @type {unknown[] | null} */ let list = null;
  // Whichever shape gives a list of rows: { "rows": [...] } or [...].
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const a = body.indexOf(open);
    const b = body.lastIndexOf(close);
    if (a < 0 || b <= a) continue;
    try {
      const parsed = /** @type {any} */ (JSON.parse(body.slice(a, b + 1)));
      list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.rows) ? parsed.rows : null;
      if (list) break;
    } catch {
      // try the other shape
    }
  }
  if (!list) return { rows: [], rejected: 0, unreadable: true };
  /** @type {Record<string, unknown>[]} */ const rows = [];
  let rejected = 0;
  for (const raw of list.slice(0, MAX_ROWS * 2)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      rejected++;
      continue;
    }
    // An empty optional value means "not given".
    const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== null && v !== undefined));
    const v = validateArgs(spec.schema, clean);
    if (v.ok) rows.push(v.value);
    else rejected++;
  }
  return { rows: rows.slice(0, MAX_ROWS), rejected, unreadable: false };
}

/** Lower-case words of 3 letters or more, for comparing text loosely. @param {string} t */
const words = (t) => t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [];
/**
 * Keeps the rows whose main text is in the document: at least 70% of its words appear there, so a row the model
 * made up (or rewrote into something else) is dropped. Duplicates are dropped too.
 * @param {ExtractionKind} kind
 * @param {Record<string, unknown>[]} rows
 * @param {string} documentText
 * @returns {{ rows: Record<string, unknown>[]; ungrounded: number }}
 */
export function groundRows(kind, rows, documentText) {
  const field = EXTRACTIONS[kind].ground;
  const vocab = new Set(words(documentText));
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {Record<string, unknown>[]} */ const kept = [];
  let ungrounded = 0;
  for (const r of rows) {
    const w = words(String(r[field] ?? ""));
    const found = w.filter((x) => vocab.has(x)).length;
    const sig = w.join(" ");
    if (!w.length || found / w.length < 0.7) {
      ungrounded++;
      continue;
    }
    if (seen.has(sig)) continue;
    seen.add(sig);
    kept.push(r);
  }
  return { rows: kept, ungrounded };
}

/**
 * The requirements of a BRS or BSS written in PMS, from its own data: each requirement module's items and each
 * numbered table (integration requirements…), with the ids the printed document shows.
 * @param {import("./documentKits.js").Kit} kit
 * @param {import("./documentKits.js").DocData} data
 * @returns {Record<string, string>[]}
 */
export function kitRequirements(kit, data) {
  /** @type {Record<string, string>[]} */ const out = [];
  const s = (/** @type {unknown} */ v) => String(v ?? "").trim();
  for (const sec of kit.sections) {
    const v = /** @type {any} */ (data[sec.key]);
    if (sec.kind === "modules") {
      let n = 0;
      for (const m of Array.isArray(v) ? v : []) {
        for (const it of m.items ?? []) {
          const text = s(it.description) || s(it.requirement);
          const label = s(it.requirement) && s(it.description) ? `${s(it.requirement)}: ${s(it.description)}` : text;
          if (text) out.push({ id: s(it.id) || docId(sec.prefix, n, sec.idPad), description: m.title ? `${s(m.title)}: ${label}` : label, priority: s(it.priority), owner: "" });
          n++;
        }
      }
    } else if (sec.kind === "table" && (sec.idPrefix || sec.columns.some((c) => c.key === "id"))) {
      // Numbered tables: an id from the kit's numbering (IRN-001) or the row's own "Req No".
      (Array.isArray(v) ? v : []).forEach((/** @type {Record<string, string>} */ row, /** @type {number} */ i) => {
        const text = sec.columns
          .filter((c) => c.key !== "priority" && c.key !== "id" && s(row[c.key]))
          .map((c) => s(row[c.key]))
          .join(": ");
        if (text) out.push({ id: s(row.id) || (sec.idPrefix ? docId(sec.idPrefix, i, sec.idPad ?? 2) : ""), description: `${sec.title.replace(/^[\d.]+\s*/, "")}: ${text}`, priority: s(row.priority), owner: "" });
      });
    }
  }
  return out.slice(0, MAX_ROWS);
}

/**
 * A table as CSV (RFC 4180: quoted where needed, CRLF between rows). A cell starting with = + - @ is prefixed with
 * an apostrophe so a spreadsheet doesn't run it as a formula.
 * @param {{ key: string; label: string }[]} columns
 * @param {Record<string, unknown>[]} rows
 */
export function toCsv(columns, rows) {
  const cell = (/** @type {unknown} */ v) => {
    let t = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(","))].join("\r\n");
}

/**
 * @typedef {"requirements" | "risks" | "actions" | "milestones" | "acceptance_criteria" | "defects"} ExtractionKind
 * @typedef {Object} Extraction
 * @property {string} label
 * @property {{ key: string; label: string }[]} columns
 * @property {import("./assistant.js").ToolSchema} schema
 * @property {string} ground  the field that must be found in the document
 * @property {string} instructions  what the model is asked for
 */
/**
 * A table an answer carries (an extraction, a traceability check).
 * @typedef {Object} AnswerTable
 * @property {string} title
 * @property {{ key: string; label: string }[]} columns
 * @property {Record<string, unknown>[]} rows
 * @property {string} [note]  how it was made and what was left out
 * @property {string} [kind]
 * @property {string} [documentId]
 * @property {string} [projectId]  the document's project, for turning the rows into work items or risks
 */
