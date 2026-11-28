// Documents searchable by Ask AI (src/docIndex.js, migration 0029), through the real Worker on PGlite with pgvector
// (or the Neon dev branch with PMS_DB=dev), and a stand-in Workers AI: embeddings from the words of a text (so texts
// sharing words are close), toMarkdown returning the file's text. An upload is read after the response; a document
// written in PMS is read from its data; search finds by meaning but only what the person may see (not a restricted
// item's attachment, not another organisation's documents); deleting a document deletes its passages; the backfill
// reads what's waiting, and failures are kept with their reason.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { EMBED_DIMS, EMBED_MODEL } from "../src/docIndex.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "DocIndex-Test-Pass-47!";

/** A stand-in embedding: each word adds to a few dimensions, normalised. Texts sharing words point the same way. */
function fakeEmbedding(/** @type {string} */ text) {
  const v = new Array(EMBED_DIMS).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[Math.abs(h) % EMBED_DIMS] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const events = (/** @type {unknown} */ text) =>
  String(text ?? "")
    .split("\n\n")
    .map((b) => b.replace(/^data:\s*/, "").trim())
    .filter(Boolean)
    .map((b) => JSON.parse(b));

describe("documents for Ask AI", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const orgs = { a: { id: `zzda${tag}`, code: `zz-da-${tag}` }, b: { id: `zzdb${tag}`, code: `zz-db-${tag}` } };
  const people = {
    ada: { org: orgs.a.id, orgAdmin: 1, role: "admin" },
    mia: { org: orgs.a.id, orgAdmin: 0, role: "manager" },
    tom: { org: orgs.a.id, orgAdmin: 0, role: "developer" },
    bob: { org: orgs.b.id, orgAdmin: 1, role: "admin" },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown; form?: FormData }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let systemId = "";
  let otherId = "";
  /** @type {Record<string, string>} */ const docs = {};
  /** What toMarkdown was given; set `convertFails` to make it fail. */
  const converted = /** @type {string[]} */ ([]);
  let convertFails = false;
  /** The chat model's replies (the embedding model always answers). @type {(input: any, n: number) => unknown} */
  let reply = () => ({ response: "ok" });
  let n = 0;
  /** What the chat model was sent, last request. */
  /** @type {any[]} */ let chats = [];

  const upload = async (/** @type {string} */ who, /** @type {string} */ project, /** @type {string} */ name, /** @type {string} */ type, /** @type {string} */ content) => {
    const form = new FormData();
    form.append("file", new File([content], name, { type }));
    const r = await as(who, `/api/systems/${project}/documents`, { method: "POST", form });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    return /** @type {string} */ (r.data.id);
  };
  const indexOf = async (/** @type {string} */ docId) => (await db`SELECT status, passages, note, attempts FROM doc_index WHERE document_id = ${docId}`)[0];
  const ask = async (/** @type {string} */ who, /** @type {(input: any, n: number) => unknown} */ script) => {
    reply = script;
    n = 0;
    chats = [];
    const r = await as(who, "/api/assistant", { method: "POST", body: { question: "What do the documents say?" } });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const told = chats.at(-1)?.messages.filter((/** @type {any} */ m) => m.role === "tool").map((/** @type {any} */ m) => String(m.content)) ?? [];
    return { events: events(r.data), told: told.join("\n") };
  };
  const call = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ args) => ({ tool_calls: [{ id: `c-${name}`, function: { name, arguments: args } }] });

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      for (const o of Object.values(orgs)) {
        await tx`INSERT INTO organizations (id, name, code, status, created_at, updated_at) VALUES (${o.id}, ${`Org ${o.code}`}, ${o.code}, 'active', ${now}, ${now})`;
        await tx`SELECT tenancy_seed_organization(${o.id}, ${source})`;
        await tx`INSERT INTO workspaces (id, organization_id, name, key, created_at, updated_at) VALUES (${`${o.id}-ws`}, ${o.id}, 'Projects', 'PRJ', ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin, email)
                 VALUES (${id(p)}, ${id(p)}, ${p}, ${d.role}, ${hash}, ${d.org}, ${d.orgAdmin}, ${`${p}-${tag}@example.test`})`;
        await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${d.org}, ${`${d.org}-ws`}, ${id(p)}, ${d.role}, ${now})`;
      }
    });
    api = workerClient(backend);
    api.env.AI = {
      run: async (/** @type {string} */ model, /** @type {any} */ input) => {
        if (model === EMBED_MODEL) return { shape: [input.text.length, EMBED_DIMS], data: input.text.map(fakeEmbedding) };
        chats.push(input);
        return reply(input, n++);
      },
      toMarkdown: async (/** @type {{ name: string; blob: Blob }[]} */ files) => {
        converted.push(files[0].name);
        if (convertFails) return [{ name: files[0].name, format: "error", error: "Conversion failed: damaged file" }];
        return [{ name: files[0].name, format: "markdown", data: await files[0].blob.text() }];
      },
    };
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
    const dates = { startedAt: "2026-09-01", dueAt: "2027-03-01", status: "WIP" };
    const p = await as("ada", "/api/systems", { method: "POST", body: { name: `Payroll ${tag}`, key: "DOC", lead: id("tom"), ...dates } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    systemId = p.data.id;
    expect((await as("ada", `/api/systems/${systemId}`, { method: "PATCH", body: { developers: [id("tom")] } })).status).toBeLessThan(300);
    const q = await as("bob", "/api/systems", { method: "POST", body: { name: `Rival ${tag}`, key: "RIV", ...dates } });
    expect(q.status, JSON.stringify(q.data)).toBe(201);
    otherId = q.data.id;
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${orgs.a.id}, ${orgs.b.id})`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("an upload is read after the response: plain text as it is, a PDF converted, an image skipped", async () => {
    docs.scope = await upload("tom", systemId, "scope.md", "text/markdown", "# Scope\n\n## Integration\n\nThe payroll system sends the employee list to the CRM every night.\n\n## Out of scope\n\nPensions stay in the old system.");
    docs.pdf = await upload("ada", systemId, "security.pdf", "application/pdf", "# Security requirements\n\n## Passwords\n\nPasswords must be rotated every ninety days.");
    docs.logo = await upload("ada", systemId, "logo.png", "image/png", "not really a png");
    expect(await indexOf(docs.scope)).toMatchObject({ status: "indexed", passages: 2 });
    expect(await indexOf(docs.pdf)).toMatchObject({ status: "indexed", passages: 1 });
    expect(await indexOf(docs.logo)).toMatchObject({ status: "skipped", note: "An image: there's no text to read" });
    expect(converted).toEqual(["security.pdf"]);
    const [p] = await db`SELECT section, text, system_id FROM doc_passages WHERE document_id = ${docs.scope} ORDER BY seq LIMIT 1`;
    expect(p).toMatchObject({ section: "Scope › Integration", system_id: systemId });
  }, SLOW);

  it("a document written in PMS is read from its own data when submitted", async () => {
    const data = { control: { title: `Payroll ${tag}` }, introduction: "Payslips are printed by hand today.", functional: [{ title: "Payslips", items: [{ description: "Email payslips to staff as PDF", priority: "M" }] }] };
    const put = await as("tom", `/api/systems/${systemId}/docs/brs`, { method: "PUT", body: { data } });
    expect(put.status, JSON.stringify(put.data)).toBe(200);
    const sub = await as("tom", `/api/systems/${systemId}/docs/brs/submit`, { method: "POST" });
    expect(sub.status, JSON.stringify(sub.data)).toBe(200);
    docs.brs = sub.data.documentId;
    expect(await indexOf(docs.brs)).toMatchObject({ status: "indexed" });
    const texts = (await db`SELECT text FROM doc_passages WHERE document_id = ${docs.brs}`).map((/** @type {any} */ r) => r.text).join("\n");
    expect(texts).toContain("FRN-01 Email payslips to staff as PDF");
  }, SLOW);

  it("search finds by meaning and cites the document; a restricted item's attachment and another organisation's documents stay out", async () => {
    // An attachment on a restricted item, and a document in another organisation, both about salary bands.
    const level = await as("ada", "/api/security-levels", { method: "POST", body: { name: `Board ${tag}`, roles: [], people: [] } });
    const item = await as("ada", "/api/items", { method: "POST", body: { systemId, type: "TASK", summary: "Board pay review", priority: "HIGH", securityLevel: level.data.id } });
    expect(item.status, JSON.stringify(item.data)).toBe(201);
    const form = new FormData();
    form.append("file", new File(["Salary bands for the board directors: confidential salary bands review."], "bands.txt", { type: "text/plain" }));
    const att = await as("ada", `/api/items/${item.data.key}/attachments`, { method: "POST", form });
    expect(att.status, JSON.stringify(att.data)).toBe(201);
    docs.bands = att.data.id;
    docs.rival = await upload("bob", otherId, "rival.md", "text/markdown", "Rival salary bands and confidential salary review for directors.");
    expect(await indexOf(docs.bands)).toMatchObject({ status: "indexed" });

    const search = (/** @type {string} */ query) => (/** @type {any} */ _i, /** @type {number} */ k) => (k === 0 ? call("search_documents", { query }) : { response: "The CRM gets the employee list nightly [S1]." });
    const mia = await ask("mia", search("salary bands for directors"));
    expect(mia.told).not.toContain("Salary bands for the board");
    expect(mia.told).not.toContain("Rival");
    const ada = await ask("ada", search("salary bands for directors"));
    expect(ada.told).toContain("Salary bands for the board");
    expect(ada.told).not.toContain("Rival");

    const r = await ask("mia", search("which employee list goes to the CRM"));
    const top = JSON.parse(r.told.replace(/^<data[^>]*>\n|\n<\/data[^>]*>$/g, "")).passages[0];
    expect(top).toMatchObject({ document: "scope.md", section: "Scope › Integration" });
    const answer = r.events.find((e) => e.type === "answer");
    expect(answer.sources[0]).toMatchObject({ label: "scope.md · Scope › Integration", href: `#/projects/${systemId}/docs` });
  }, SLOW);

  it("a whole document, only if the person may see it", async () => {
    const read = (/** @type {string} */ documentId) => (/** @type {any} */ _i, /** @type {number} */ k) => (k === 0 ? call("get_document", { documentId }) : { response: "Done." });
    expect((await ask("mia", read(docs.brs))).told).toContain("Email payslips to staff as PDF");
    expect((await ask("mia", read(docs.rival))).told).toContain("No readable document");
    expect((await ask("mia", read(docs.bands))).told).toContain("No readable document");
    // The written document's source opens its own page.
    const r = await ask("mia", read(docs.brs));
    expect(r.told).toMatch(/"sources":\[\{"id":"S1"/);
  }, SLOW);

  it("deleting a document deletes its passages", async () => {
    expect(Number((await db`SELECT COUNT(*) AS n FROM doc_passages WHERE document_id = ${docs.pdf}`)[0].n)).toBe(1);
    expect((await as("ada", `/api/documents/${docs.pdf}`, { method: "DELETE" })).status).toBe(200);
    expect(Number((await db`SELECT COUNT(*) AS n FROM doc_passages WHERE document_id = ${docs.pdf}`)[0].n)).toBe(0);
    expect(await indexOf(docs.pdf)).toBeUndefined();
  }, SLOW);

  it("the backfill reads what's waiting; a failure is kept with its reason and tried at most 3 times", async () => {
    // A document from before indexing existed: no passages, no index row.
    await db`DELETE FROM doc_index WHERE document_id = ${docs.scope}`;
    await db`DELETE FROM doc_passages WHERE document_id = ${docs.scope}`;
    convertFails = true;
    docs.broken = await upload("ada", systemId, "broken.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "garbage");
    expect(await indexOf(docs.broken)).toMatchObject({ status: "failed", note: "Conversion failed: damaged file", attempts: 1 });

    expect((await as("tom", "/api/assistant/documents")).status).toBe(403);
    let s = await as("mia", "/api/assistant/documents");
    expect(s.status, JSON.stringify(s.data)).toBe(200);
    expect(s.data).toMatchObject({ waiting: 2, skipped: 1, available: true });
    expect(s.data.failures).toEqual([{ name: "broken.docx", projectId: systemId, note: "Conversion failed: damaged file" }]);

    s = await as("mia", "/api/assistant/documents/index", { method: "POST" });
    expect(s.status, JSON.stringify(s.data)).toBe(200);
    expect(s.data.done).toEqual({ indexed: 1, skipped: 0, failed: 1 });
    expect(await indexOf(docs.scope)).toMatchObject({ status: "indexed", passages: 2 });
    s = await as("mia", "/api/assistant/documents/index", { method: "POST" });
    expect(await indexOf(docs.broken)).toMatchObject({ status: "failed", attempts: 3 });
    // Three tries: no longer waiting, still listed as failed.
    expect(s.data).toMatchObject({ waiting: 0, failed: 1 });
    convertFails = false;
  }, SLOW);
});
