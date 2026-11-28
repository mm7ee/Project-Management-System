// Ask AI, phase (b) (docs/assistant-plan.md): a document's text in passages the assistant can search by meaning.
// Shared by the Worker (src/docIndex.js) and the tests.
//   - kitText: a document written in PMS (BRS, BSS, release notes) as plain Markdown, section by section.
//   - splitPassages: Markdown (from a PMS document, or from Workers AI's toMarkdown for an upload) into passages of
//     about 800 tokens, split at headings first, then paragraphs, with a little overlap, each keeping its section
//     (and its page, when the text marks pages).
import { docId } from "./documentKits.js";

/** About 800 tokens. */
export const PASSAGE_CHARS = 3200;
/** Carried into the next passage of the same section, so a sentence cut in two is still found. */
export const OVERLAP_CHARS = 400;
/** At most this many passages a document (about 160 pages of text); the rest isn't searched. */
export const MAX_PASSAGES = 200;

const clean = (/** @type {unknown} */ v) => String(v ?? "").trim();
/** A row says something when more than its id and priority are filled in. @param {{ key: string }[]} cols @param {Record<string, string>} row */
const said = (cols, row) => cols.some((c) => c.key !== "id" && c.key !== "priority" && clean(row?.[c.key]));

/**
 * A document written in PMS as Markdown: each section a heading, fields as "Label: value", tables and requirements as
 * lines with their ids (FRN-01…), as in the printed document. Automatic sections (approvals, history) are left out:
 * they come from the project, not the document.
 * @param {import("./documentKits.js").Kit} kit
 * @param {import("./documentKits.js").DocData} data
 * @param {string} title
 */
export function kitText(kit, data, title) {
  /** @type {string[]} */ const out = [`# ${title}`];
  for (const sec of kit.sections) {
    const v = /** @type {any} */ (data[sec.key]);
    /** @type {string[]} */ const lines = [];
    if (sec.kind === "fields") for (const f of sec.fields) clean(v?.[f.key]) && lines.push(`${f.label}: ${clean(v[f.key])}`);
    else if (sec.kind === "text") clean(v) && lines.push(clean(v));
    else if (sec.kind === "list") for (const x of Array.isArray(v) ? v : []) clean(x) && lines.push(`- ${clean(x)}`);
    else if (sec.kind === "table") {
      (Array.isArray(v) ? v : []).forEach((/** @type {Record<string, string>} */ row, /** @type {number} */ i) => {
        const cells = sec.columns.filter((c) => clean(row[c.key])).map((c) => `${c.label}: ${clean(row[c.key])}`);
        if (said(sec.columns, row)) lines.push(`- ${sec.idPrefix ? `${docId(sec.idPrefix, i, sec.idPad ?? 2)} ` : ""}${cells.join("; ")}`);
      });
    } else if (sec.kind === "modules") {
      let n = 0;
      for (const m of Array.isArray(v) ? v : []) {
        /** @type {string[]} */ const items = [];
        for (const it of m.items ?? []) {
          const cells = sec.itemColumns.filter((c) => c.key !== "id" && clean(it[c.key])).map((c) => (c.key === "description" ? clean(it[c.key]) : `${c.label}: ${clean(it[c.key])}`));
          if (said(sec.itemColumns, it)) items.push(`- ${clean(it.id) || docId(sec.prefix, n, sec.idPad)} ${cells.join("; ")}`);
          n++;
        }
        for (const f of m.features ?? []) {
          const cells = (sec.featureFields ?? []).filter((c) => clean(f[c.key])).map((c) => `${c.label}: ${clean(f[c.key])}`);
          if (cells.length) items.push(`- ${cells.join("; ")}`);
        }
        if (clean(m.title) || items.length) lines.push(`### ${clean(m.title) || "Requirements"}`, ...items);
      }
    }
    if (lines.length) out.push("", `## ${sec.title}`, ...lines);
  }
  return out.join("\n");
}

/**
 * Passages of a Markdown text. Headings start a new section; paragraphs are packed into passages of about
 * PASSAGE_CHARS; a paragraph longer than that is cut at sentence ends. A form feed, `<!-- page N -->` or a "Page N"
 * heading sets the page.
 * @param {string} markdown
 * @returns {{ section: string; page: number | null; text: string }[]}
 */
export function splitPassages(markdown) {
  /** @type {{ section: string; page: number | null; paras: string[] }[]} */ const sections = [];
  /** @type {string[]} */ const heads = [];
  let page = /** @type {number | null} */ (null);
  let para = /** @type {string[]} */ ([]);
  const current = () => {
    const name = heads.filter(Boolean).slice(-2).join(" › ").slice(0, 300);
    let s = sections[sections.length - 1];
    if (!s || s.section !== name || s.page !== page) sections.push((s = { section: name, page, paras: [] }));
    return s;
  };
  const endPara = () => {
    const t = para.join("\n").trim();
    if (t) current().paras.push(t);
    para = [];
  };
  // A form feed (a page break, as PDF text has) is a line of its own.
  for (const line of markdown.replace(/\r\n?/g, "\n").replace(/\f/g, "\n\f\n").split("\n")) {
    if (line === "\f") {
      endPara();
      page = (page ?? 1) + 1;
      continue;
    }
    const marker = line.match(/^\s*<!--\s*page\s*(\d+)\s*-->\s*$/i) ?? line.match(/^#{1,6}\s*page\s+(\d+)\s*$/i);
    if (marker) {
      endPara();
      page = Number(marker[1]);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      endPara();
      const level = h[1].length;
      heads.length = Math.min(heads.length, level - 1);
      while (heads.length < level - 1) heads.push("");
      heads.push(h[2].replace(/[*_`]/g, "").trim());
      continue;
    }
    if (!line.trim()) endPara();
    else para.push(line);
  }
  endPara();

  /** @type {{ section: string; page: number | null; text: string }[]} */ const out = [];
  for (const s of sections) {
    // Long paragraphs cut at sentence ends (or anywhere, if one sentence is longer than a passage).
    const pieces = s.paras.flatMap((p) => (p.length <= PASSAGE_CHARS ? [p] : cut(p)));
    let buf = "";
    for (const p of pieces) {
      if (buf && buf.length + p.length + 2 > PASSAGE_CHARS) {
        out.push({ section: s.section, page: s.page, text: buf });
        buf = tail(buf);
      }
      buf = buf ? `${buf}\n\n${p}` : p;
    }
    // A section's heading alone still says something (a title page, a list of contents).
    if (buf.trim() || (!s.paras.length && s.section)) out.push({ section: s.section, page: s.page, text: buf.trim() || s.section });
    if (out.length >= MAX_PASSAGES) break;
  }
  return out.filter((p) => p.text.trim()).slice(0, MAX_PASSAGES);
}

/** @param {string} p */
function cut(p) {
  /** @type {string[]} */ const parts = [];
  let rest = p;
  while (rest.length > PASSAGE_CHARS) {
    const window = rest.slice(0, PASSAGE_CHARS);
    const end = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = end > PASSAGE_CHARS / 2 ? end + 1 : window.lastIndexOf(" ") > PASSAGE_CHARS / 2 ? window.lastIndexOf(" ") : PASSAGE_CHARS;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
/** The end of a passage, from a word start, to begin the next one with. @param {string} text */
function tail(text) {
  if (text.length <= OVERLAP_CHARS) return "";
  const t = text.slice(-OVERLAP_CHARS);
  const sp = t.search(/\s/);
  return `…${(sp >= 0 ? t.slice(sp) : t).trim()}`;
}
