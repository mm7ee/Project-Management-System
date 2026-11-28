// Project documents written in PMS (migration 0027; kits in src/data/documentKits.js): the BRS, the BSS and release
// notes. A draft is saved as people write; submitting freezes it as a version and adds it to the project's documents
// as the lifecycle deliverable (BRS, BSS, release notes), so the stage's sign-off, segregation of duties and locking
// apply to it exactly as to an uploaded file.
//   GET  /api/systems/:id/docs                       every kit: its draft and versions
//   GET  /api/systems/:id/docs/:kind[?version=n]     a draft (a new one is prefilled, not saved) or a version, with its sign-offs
//   PUT  /api/systems/:id/docs/:kind                 save the draft { data }
//   POST /api/systems/:id/docs/:kind/submit          freeze the draft as a version (refused with what's missing)
//   GET  /api/systems/:id/docs/release_notes/changelog  the changelog built from the submitted release notes
/** @import { System } from '../../project-management-system-frontend/src/data/systems' */
import { HttpError, body, json } from "./http";
import { newToken } from "./auth";
import { indexLater } from "./docIndex";
import { KITS, changelog, cleanDoc, docMissing, newDoc } from "../../project-management-system-frontend/src/data/documentKits";

/** @typedef {import("./workitems").ItemContext} ItemContext */
/** @typedef {{ id: string; kind: string; version: number; status: "draft" | "submitted"; data: string; document_id: string | null; created_at: string; updated_at: string; submitted_at: string | null; submitted_by: string | null; submitted_name?: string | null; locked_at?: string | null; doc_version?: number | null }} DocRow */

const id16 = () => newToken().slice(0, 16);

/** @param {ItemContext} c @param {string} systemId */
async function project(c, systemId) {
  const row = /** @type {{ data: string; key: string } | null} */ (await c.db.prepare("SELECT data, key FROM systems WHERE id = ?").bind(systemId).first());
  if (!row) throw new HttpError(404, "Not found");
  return /** @type {System & { key: string }} */ ({ ...JSON.parse(row.data), key: row.key });
}
/** The same people who may add the project's documents (index.js mayContribute). @param {ItemContext} c @param {System} sys */
async function mayEdit(c, sys) {
  if (c.guest) return false;
  if (c.can("edit_any") || c.can("manage_systems") || sys.lead === c.me.id) return true;
  return !!(await c.db.prepare("SELECT 1 FROM assignments WHERE user_id = ? AND system_id = ?").bind(c.me.id, sys.id).first());
}
/** Every version and the draft of a kind, newest first. @param {ItemContext} c @param {string} systemId @param {string} kind */
async function rows(c, systemId, kind) {
  return /** @type {DocRow[]} */ (
    (
      await c.db
        .prepare(
          `SELECT p.*, a.name AS submitted_name, d.locked_at, d.version AS doc_version FROM project_documents p
           LEFT JOIN accounts a ON a.id = p.submitted_by LEFT JOIN documents d ON d.id = p.document_id
           WHERE p.system_id = ? AND p.kind = ? ORDER BY p.version DESC`,
        )
        .bind(systemId, kind)
        .all()
    ).results
  );
}
/** @param {DocRow} r */
const version = (r) => ({ version: Number(r.version), status: r.status, submittedAt: r.submitted_at, submittedBy: r.submitted_name ?? null, documentId: r.document_id, documentVersion: r.doc_version == null ? null : Number(r.doc_version), locked: !!r.locked_at, updatedAt: r.updated_at });

/**
 * What PMS already knows, to prefill a new draft.
 * @param {ItemContext} c @param {System & { key: string }} sys @param {string} kind @param {DocRow[]} existing
 */
async function prefill(c, sys, kind, existing) {
  const last = existing.find((r) => r.status === "submitted");
  const me = /** @type {{ name: string; title: string | null } | null} */ (await c.db.prepare("SELECT name, title FROM accounts WHERE id = ?").bind(c.me.id).first());
  /** @type {{ key: string; summary: string; type: string; component: string | null }[]} */ let doneItems = [];
  if (kind === "release_notes") {
    // Work resolved since the last release (or ever).
    const since = last?.submitted_at ?? "0000";
    doneItems = /** @type {any[]} */ (
      (
        await c.db
          .prepare("SELECT w.number, w.summary, w.type, w.component FROM work_items w JOIN work_statuses s ON s.id = w.status WHERE w.system_id = ? AND s.category = 'DONE' AND COALESCE(w.resolved_at, w.updated_at) > ? ORDER BY w.number LIMIT 200")
          .bind(sys.id, since)
          .all()
      ).results
    ).map((w) => ({ key: `${sys.key}-${w.number}`, summary: w.summary, type: w.type, component: w.component }));
  }
  return newDoc(KITS[kind], {
    project: sys.name,
    today: c.now.slice(0, 10),
    me: { name: me?.name ?? c.me.name, title: me?.title ?? undefined },
    pcn: sys.pcn ? { background: sys.pcn.background, concept: sys.pcn.concept, objectives: sys.pcn.objectives } : null,
    doneItems,
    previous: last ? JSON.parse(last.data) : null,
  });
}

/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function projectDocsApi(c, path, method) {
  const m = path.match(/^\/api\/systems\/([a-z0-9-]+)\/docs(?:\/([a-z_]{2,30}))?(\/submit|\/changelog)?$/);
  if (!m) return null;
  const sys = await project(c, m[1]);
  if (!m[2] && method === "GET") {
    const all = /** @type {DocRow[]} */ ((await c.db.prepare("SELECT p.kind, p.version, p.status, p.submitted_at, p.updated_at, p.document_id, d.locked_at, d.version AS doc_version FROM project_documents p LEFT JOIN documents d ON d.id = p.document_id WHERE p.system_id = ? ORDER BY p.version DESC").bind(sys.id).all()).results);
    return json({
      canEdit: await mayEdit(c, sys),
      kits: Object.values(KITS).map((k) => {
        const mine = all.filter((r) => r.kind === k.kind);
        return { kind: k.kind, name: k.name, short: k.short, deliverable: k.deliverable, draft: mine.find((r) => r.status === "draft") ? version(/** @type {DocRow} */ (mine.find((r) => r.status === "draft"))) : null, versions: mine.filter((r) => r.status === "submitted").map(version) };
      }),
    });
  }
  const kit = m[2] ? KITS[m[2]] : null;
  if (!kit) throw new HttpError(404, "Not found");
  const existing = await rows(c, sys.id, kit.kind);
  if (m[3] === "/changelog" && method === "GET") {
    if (kit.kind !== "release_notes") throw new HttpError(404, "Not found");
    return json({ project: sys.name, entries: changelog(existing.map((r) => ({ version: Number(r.version), data: JSON.parse(r.data), submittedAt: r.submitted_at }))) });
  }
  if (!m[3] && method === "GET") {
    const want = new URL(c.req.url).searchParams.get("version");
    const draft = existing.find((r) => r.status === "draft");
    const row = want ? existing.find((r) => r.status === "submitted" && String(r.version) === want) : draft;
    if (want && !row) throw new HttpError(404, "Not found");
    // Who signed this version (the lifecycle's sign-offs on its documents row), for the printed Approvals table.
    const signoffs = row?.document_id
      ? (await c.db.prepare("SELECT signer_name, label, status, decided_at, comment FROM stage_signoffs WHERE document_id = ? AND status <> 'cancelled' ORDER BY requested_at").bind(row.document_id).all()).results
      : [];
    return json({
      kind: kit.kind,
      project: sys.name,
      canEdit: await mayEdit(c, sys),
      saved: !!row,
      version: row ? version(row) : { version: (existing[0] ? Number(existing[0].version) : 0) + 1, status: "draft" },
      data: row ? cleanDoc(kit, JSON.parse(row.data)) : await prefill(c, sys, kit.kind, existing),
      versions: existing.filter((r) => r.status === "submitted").map(version),
      signoffs,
    });
  }
  if (!(await mayEdit(c, sys))) throw new HttpError(403, "Only people on this project can write its documents");
  if (!m[3] && method === "PUT") {
    const b = /** @type {{ data?: unknown }} */ (await body(c.req));
    const data = JSON.stringify(cleanDoc(kit, b.data));
    const draft = existing.find((r) => r.status === "draft");
    if (draft) await c.db.prepare("UPDATE project_documents SET data = ?, updated_at = ? WHERE id = ?").bind(data, c.now, draft.id).run();
    else {
      await c.db
        .prepare("INSERT INTO project_documents (id, system_id, kind, version, status, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)")
        .bind(id16(), sys.id, kit.kind, (existing[0] ? Number(existing[0].version) : 0) + 1, data, c.me.id, c.now, c.now)
        .run();
    }
    return json({ ok: true, savedAt: c.now });
  }
  if (m[3] === "/submit" && method === "POST") {
    const draft = existing.find((r) => r.status === "draft");
    if (!draft) throw new HttpError(409, "There's no draft to submit: write it first");
    const data = cleanDoc(kit, JSON.parse(draft.data));
    const missing = docMissing(kit, data);
    if (missing.length) throw new HttpError(409, "The document isn't complete yet", "doc_incomplete", { missing });
    // It becomes the next version of that deliverable among the project's documents (after any uploaded ones).
    const v = /** @type {{ v: number | null }} */ (await c.db.prepare("SELECT MAX(version) AS v FROM documents WHERE system_id = ? AND deliverable_key = ?").bind(sys.id, kit.deliverable).first());
    const docVersion = Number(v?.v ?? 0) + 1;
    const life = /** @type {{ stage_code: string } | null} */ (await c.db.prepare("SELECT stage_code FROM project_lifecycle WHERE system_id = ?").bind(sys.id).first());
    const docId = id16();
    const label = kit.kind === "release_notes" ? `Release notes ${/** @type {any} */ (data.release)?.version || `v${draft.version}`}` : `${kit.short} v${docVersion} (written in PMS)`;
    await c.db.batch([
      c.db
        .prepare("INSERT INTO documents (id, system_id, name, kind, url, uploaded_by, uploaded_at, stage_code, deliverable_key, version) VALUES (?, ?, ?, 'link', ?, ?, ?, ?, ?, ?)")
        .bind(docId, sys.id, label, `#/projects/${sys.id}/docs/${kit.kind}-${draft.version}`, c.me.id, c.now, life?.stage_code ?? null, kit.deliverable, docVersion),
      c.db.prepare("UPDATE project_documents SET status = 'submitted', submitted_by = ?, submitted_at = ?, document_id = ?, data = ? WHERE id = ?").bind(c.me.id, c.now, docId, JSON.stringify(data), draft.id),
    ]);
    // A BSS is linked to the signed BRS (the BSS Draft gate asks for it).
    if (kit.kind === "bss" && (await c.db.prepare("SELECT 1 FROM documents WHERE system_id = ? AND deliverable_key = 'brs' AND locked_at IS NOT NULL").bind(sys.id).first())) {
      const links = /** @type {{ data: string } | null} */ (await c.db.prepare("SELECT data FROM stage_records WHERE system_id = ? AND kind = 'links'").bind(sys.id).first());
      await c.db
        .prepare("INSERT INTO stage_records (system_id, kind, data, updated_by, updated_at) VALUES (?, 'links', ?, ?, ?) ON CONFLICT (system_id, kind) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
        .bind(sys.id, JSON.stringify({ ...(links ? JSON.parse(links.data) : {}), bss: "brs" }), c.me.id, c.now)
        .run();
    }
    indexLater(c, docId);
    await c.audit("project_document_submitted", sys.id, { name: sys.name, document: kit.name, version: Number(draft.version), deliverableVersion: docVersion });
    return json({ ok: true, version: Number(draft.version), documentId: docId, documentVersion: docVersion });
  }
  throw new HttpError(405, "Method not allowed");
}
