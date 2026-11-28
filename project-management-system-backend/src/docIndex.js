// Ask AI, phase (b) (docs/assistant-plan.md): documents searchable by meaning.
//   - indexDocument: a document's text (an upload read by Workers AI's toMarkdown, or a document written in PMS from
//     its own data) → passages (src/data/passages.js) → embeddings (@cf/baai/bge-m3) → doc_passages. Run after an
//     upload or a submit, in the background; doc_index records the outcome.
//   - searchPassages / documentText: what the assistant's search_documents and get_document tools read, through the
//     same rule as downloading the document (row-level security for the workspace; an attachment only for whoever
//     may see its work item).
//   - GET  /api/assistant/documents         how many documents are searchable, waiting, skipped or failed
//     POST /api/assistant/documents/index   reads the next few waiting documents (the backfill; Administrators, Managers, Team Leaders)
/** @typedef {import("./workitems").ItemContext} ItemContext */
import { HttpError, json } from "./http";
import { itemAccess } from "./access";
import { KITS } from "../../project-management-system-frontend/src/data/documentKits";
import { kitText, splitPassages } from "../../project-management-system-frontend/src/data/passages";

export const EMBED_MODEL = "@cf/baai/bge-m3";
export const EMBED_DIMS = 1024;
/** Larger files aren't read (their passages would pass the cap anyway). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Read as they are. */
const PLAIN = /^(text\/(plain|markdown|csv|x-markdown)|application\/json)$/i;
const PLAIN_NAME = /\.(txt|md|markdown|csv|json)$/i;
/** Converted to Markdown by Workers AI (toMarkdown). Images are left out: describing them is another model's job. */
const CONVERTIBLE = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml)\.[a-z.]+|vnd\.ms-excel(\.[a-z.]+)?|vnd\.oasis\.opendocument\.(text|spreadsheet)|xml)|text\/(html|xml))$/i;
const CONVERTIBLE_NAME = /\.(pdf|docx|xlsx|xlsm|xls|ods|odt|html?|xml)$/i;
const EMBED_BATCH = 16;
/** Tries before a failing document is left alone (an administrator can start again). */
export const MAX_ATTEMPTS = 3;

/**
 * Embeddings for texts, in order.
 * @param {Ai} ai
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embed(ai, texts) {
  /** @type {number[][]} */ const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const r = /** @type {any} */ (await ai.run(EMBED_MODEL, { text: batch }));
    const data = r?.data ?? r?.response;
    if (!Array.isArray(data) || data.length !== batch.length || data.some((v) => !Array.isArray(v) || v.length !== EMBED_DIMS)) throw new Error("The embedding model answered in an unexpected shape");
    out.push(...data);
  }
  return out;
}
/** A vector as pgvector reads it. @param {number[]} v */
export const vectorLiteral = (v) => `[${v.map((x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0)).join(",")}]`;

/**
 * A document's text, or why it has none.
 * @param {ItemContext} c
 * @param {Ai} ai
 * @param {DocRow} doc
 * @returns {Promise<{ text: string } | { skip: string }>}
 */
async function readText(c, ai, doc) {
  if (doc.kind === "link") {
    // A document written in PMS is a link to its own page; its text comes from its data.
    const pd = /** @type {{ kind: string; data: string } | null} */ (await c.db.prepare("SELECT kind, data FROM project_documents WHERE document_id = ?").bind(doc.id).first());
    const kit = pd ? /** @type {Record<string, import("../../project-management-system-frontend/src/data/documentKits").Kit>} */ (KITS)[pd.kind] : null;
    if (!pd || !kit) return { skip: "A link to another site: its text isn't in PMS" };
    return { text: kitText(kit, JSON.parse(pd.data), doc.name) };
  }
  const mime = String(doc.mime ?? "");
  if (/^image\//i.test(mime)) return { skip: "An image: there's no text to read" };
  const plain = PLAIN.test(mime) || PLAIN_NAME.test(doc.name);
  const convertible = CONVERTIBLE.test(mime) || CONVERTIBLE_NAME.test(doc.name);
  if (!plain && !convertible) return { skip: "A file type Ask AI can't read" };
  if (Number(doc.size ?? 0) > MAX_FILE_BYTES) return { skip: "Larger than 10 MB" };
  const chunks = /** @type {{ data: ArrayBuffer | Uint8Array }[]} */ ((await c.db.prepare("SELECT data FROM document_chunks WHERE doc_id = ? ORDER BY seq").bind(doc.id).all()).results);
  const parts = chunks.map((x) => new Uint8Array(/** @type {ArrayBuffer} */ (x.data)));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (bytes.set(p, at), at + p.length), 0);
  if (plain) return { text: new TextDecoder().decode(bytes) };
  if (!ai.toMarkdown) return { skip: "This server can't convert documents" };
  const res = await ai.toMarkdown([{ name: doc.name, blob: new Blob([bytes], { type: mime || "application/octet-stream" }) }]);
  const r = /** @type {any} */ (Array.isArray(res) ? res[0] : res);
  if (!r || r.format === "error") throw new Error(String(r?.error ?? "The document couldn't be converted").slice(0, 200));
  return { text: String(r.data ?? "") };
}

/**
 * Reads a document into passages and embeddings, replacing any it had. Never throws: the outcome is in doc_index.
 * @param {ItemContext} c
 * @param {Ai} ai
 * @param {string} documentId
 * @returns {Promise<"indexed" | "skipped" | "failed" | "gone">}
 */
export async function indexDocument(c, ai, documentId) {
  const doc = /** @type {DocRow | null} */ (await c.db.prepare("SELECT id, system_id, name, kind, url, mime, size FROM documents WHERE id = ?").bind(documentId).first());
  if (!doc) return "gone";
  /** @param {"indexed" | "skipped" | "failed"} status @param {number} passages @param {number} chars @param {string | null} note */
  const record = (status, passages, chars, note) =>
    c.db
      .prepare(
        `INSERT INTO doc_index (document_id, status, passages, chars, model, note, attempts, indexed_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (document_id) DO UPDATE SET status = excluded.status, passages = excluded.passages, chars = excluded.chars, model = excluded.model,
           note = excluded.note, indexed_at = excluded.indexed_at, attempts = CASE WHEN excluded.status = 'failed' THEN doc_index.attempts + 1 ELSE 1 END`,
      )
      .bind(doc.id, status, passages, chars, status === "indexed" ? EMBED_MODEL : null, note?.slice(0, 300) ?? null, new Date().toISOString());
  try {
    const got = await readText(c, ai, doc);
    if ("skip" in got) {
      await c.db.batch([c.db.prepare("DELETE FROM doc_passages WHERE document_id = ?").bind(doc.id), record("skipped", 0, 0, got.skip)]);
      return "skipped";
    }
    const passages = splitPassages(got.text);
    if (!passages.length) {
      await c.db.batch([c.db.prepare("DELETE FROM doc_passages WHERE document_id = ?").bind(doc.id), record("skipped", 0, 0, "No text found (a scan without text, or an empty file)")]);
      return "skipped";
    }
    // Each passage is embedded with its document and section, so "the BRS's integration requirements" finds it.
    const vectors = await embed(ai, passages.map((p) => `${doc.name}${p.section ? ` — ${p.section}` : ""}\n${p.text}`));
    await c.db.batch([
      c.db.prepare("DELETE FROM doc_passages WHERE document_id = ?").bind(doc.id),
      ...passages.map((p, i) =>
        c.db.prepare("INSERT INTO doc_passages (document_id, system_id, seq, section, page, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?::vector)").bind(doc.id, doc.system_id, i, p.section, p.page, p.text.slice(0, 6000), vectorLiteral(vectors[i])),
      ),
      record("indexed", passages.length, got.text.length, null),
    ]);
    return "indexed";
  } catch (e) {
    console.error("indexing a document failed", doc.id, e);
    await record("failed", 0, 0, e instanceof Error ? e.message : "Reading it failed")
      .run()
      .catch(() => undefined);
    return "failed";
  }
}

/**
 * Indexes a new document after the response, when Workers AI is there.
 * @param {ItemContext} c
 * @param {string} documentId
 */
export function indexLater(c, documentId) {
  const ai = /** @type {Env | undefined} */ (c.env)?.AI;
  if (ai && c.defer) c.defer(indexDocument(c, ai, documentId));
}

/** The visibility rule for a passage's document: its project (row-level security) and, for an attachment, its item. */
const VISIBLE = (/** @type {ItemContext} */ c) => {
  const a = itemAccess(c.viewer, "w");
  return { sql: `(d.work_item_id IS NULL OR (${a.sql}))`, args: a.args };
};
/** Where a source opens. @param {{ system_id: string; url: string | null; kind: string; item_key: string | null }} r */
const hrefOf = (r) => (r.item_key ? `#/projects/${r.system_id}/items/${r.item_key}` : r.kind === "link" && r.url?.startsWith(`#/projects/${r.system_id}/docs/`) ? r.url : `#/projects/${r.system_id}/docs`);

/**
 * The passages most like a question, among the documents the person may see.
 * @param {ItemContext} c
 * @param {Ai} ai
 * @param {string} query
 * @param {{ systemId?: string; limit?: number }} [o]
 */
export async function searchPassages(c, ai, query, o = {}) {
  const [v] = await embed(ai, [query]);
  const vec = vectorLiteral(v);
  const vis = VISIBLE(c);
  const rows = /** @type {PassageRow[]} */ (
    (
      await c.db
        .prepare(
          `SELECT p.document_id, p.seq, p.section, p.page, p.text, d.name, d.version, d.system_id, d.url, d.kind, (s.data::json ->> 'name') AS project,
                  CASE WHEN w.id IS NULL THEN NULL ELSE ws.key || '-' || w.number END AS item_key, 1 - (p.embedding <=> ?::vector) AS score
           FROM doc_passages p JOIN documents d ON d.id = p.document_id JOIN systems s ON s.id = d.system_id
           LEFT JOIN work_items w ON w.id = d.work_item_id LEFT JOIN systems ws ON ws.id = w.system_id
           WHERE ${vis.sql}${o.systemId ? " AND p.system_id = ?" : ""}
           ORDER BY p.embedding <=> ?::vector LIMIT ?`,
        )
        .bind(vec, ...vis.args, ...(o.systemId ? [o.systemId] : []), vec, o.limit ?? 6)
        .all()
    ).results
  );
  return rows.map((r) => ({ ...r, score: Math.round(Number(r.score) * 1000) / 1000, href: hrefOf(r) }));
}

/**
 * One document's text from its passages (the overlap between passages taken out), if the person may see it.
 * @param {ItemContext} c
 * @param {string} documentId
 * @param {string} [section]  only passages whose section contains this
 */
export async function documentText(c, documentId, section) {
  const vis = VISIBLE(c);
  const rows = /** @type {PassageRow[]} */ (
    (
      await c.db
        .prepare(
          `SELECT p.document_id, p.seq, p.section, p.page, p.text, d.name, d.version, d.system_id, d.url, d.kind, (s.data::json ->> 'name') AS project,
                  CASE WHEN w.id IS NULL THEN NULL ELSE ws.key || '-' || w.number END AS item_key
           FROM doc_passages p JOIN documents d ON d.id = p.document_id JOIN systems s ON s.id = d.system_id
           LEFT JOIN work_items w ON w.id = d.work_item_id LEFT JOIN systems ws ON ws.id = w.system_id
           WHERE p.document_id = ? AND ${vis.sql}${section ? " AND p.section ILIKE ?" : ""} ORDER BY p.seq`,
        )
        .bind(documentId, ...vis.args, ...(section ? [`%${section.replace(/[%_\\]/g, (x) => `\\${x}`)}%`] : []))
        .all()
    ).results
  );
  if (!rows.length) return null;
  let last = "";
  /** @type {string[]} */ const parts = [];
  for (const r of rows) {
    if (r.section !== last && r.section) parts.push(`## ${r.section}`);
    last = r.section;
    // A passage carrying the end of the one before starts with "…" and that end: leave it out.
    parts.push(r.text.startsWith("…") && r.text.includes("\n\n") ? r.text.slice(r.text.indexOf("\n\n") + 2) : r.text);
  }
  const first = rows[0];
  return { name: first.name, version: first.version, project: first.project, systemId: first.system_id, href: hrefOf(first), text: parts.join("\n\n") };
}

/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function docIndexApi(c, path, method) {
  if (path !== "/api/assistant/documents" && path !== "/api/assistant/documents/index") return null;
  if (c.guest || !(["admin", "manager", "team_lead"].includes(c.me.role) || c.can("manage_systems"))) throw new HttpError(403, "Only Administrators, Managers and Team Leaders can see this");
  const status = async () => {
    const counts = /** @type {{ status: string | null; n: number; passages: number }[]} */ (
      (
        await c.db
          .prepare(
            `SELECT CASE WHEN i.document_id IS NULL THEN 'waiting' WHEN i.status = 'failed' AND i.attempts < ? THEN 'waiting' ELSE i.status END AS status, COUNT(*) AS n, COALESCE(SUM(i.passages), 0) AS passages
             FROM documents d LEFT JOIN doc_index i ON i.document_id = d.id WHERE d.kind = 'file' OR d.url LIKE '#/projects/%/docs/%' GROUP BY 1`,
          )
          .bind(MAX_ATTEMPTS)
          .all()
      ).results
    );
    const by = Object.fromEntries(counts.map((r) => [r.status ?? "waiting", Number(r.n)]));
    const failures = /** @type {{ name: string; note: string | null; system_id: string }[]} */ ((await c.db.prepare("SELECT d.name, d.system_id, i.note FROM doc_index i JOIN documents d ON d.id = i.document_id WHERE i.status = 'failed' ORDER BY i.indexed_at DESC LIMIT 10").all()).results);
    return {
      indexed: by.indexed ?? 0,
      waiting: by.waiting ?? 0,
      skipped: by.skipped ?? 0,
      failed: by.failed ?? 0,
      passages: counts.reduce((n, r) => n + Number(r.passages), 0),
      failures: failures.map((f) => ({ name: f.name, projectId: f.system_id, note: f.note })),
      available: !!(/** @type {Env | undefined} */ (c.env)?.AI),
    };
  };
  if (path === "/api/assistant/documents" && method === "GET") return json(await status());
  if (path === "/api/assistant/documents/index" && method === "POST") {
    const ai = /** @type {Env | undefined} */ (c.env)?.AI;
    if (!ai) throw new HttpError(503, "Ask AI isn't switched on for this server", "assistant_off");
    // A few at a time, inside one request's time: the page asks again until none are waiting.
    const started = Date.now();
    const waiting = /** @type {{ id: string }[]} */ (
      (
        await c.db
          .prepare(
            `SELECT d.id FROM documents d LEFT JOIN doc_index i ON i.document_id = d.id
             WHERE (d.kind = 'file' OR d.url LIKE '#/projects/%/docs/%') AND (i.document_id IS NULL OR (i.status = 'failed' AND i.attempts < ?))
             ORDER BY d.uploaded_at DESC LIMIT 8`,
          )
          .bind(MAX_ATTEMPTS)
          .all()
      ).results
    );
    /** @type {Record<string, number>} */ const done = { indexed: 0, skipped: 0, failed: 0 };
    for (const d of waiting) {
      if (Date.now() - started > 20_000) break;
      const r = await indexDocument(c, ai, d.id);
      if (r !== "gone") done[r]++;
    }
    await c.audit("documents_indexed", null, done);
    return json({ ...(await status()), done });
  }
  throw new HttpError(405, "Method not allowed");
}

/**
 * @typedef {{ id: string; system_id: string; name: string; kind: "file" | "link"; url: string | null; mime: string | null; size: number | null }} DocRow
 * @typedef {{ document_id: string; seq: number; section: string; page: number | null; text: string; name: string; version: number | null; system_id: string; url: string | null; kind: string; project: string; item_key: string | null; score?: number }} PassageRow
 */
