// Ask AI, phase (c): task skills and structured extraction (src/skills.js, src/extract.js, migration 0030), through
// the real Worker on PGlite with pgvector (or the Neon dev branch with PMS_DB=dev) and a stand-in Workers AI.
//   - The skills shown depend on where the person is (a project, its documents, a work item, a service request,
//     across projects); a skill sends only its id, its prompt is filled in by the server, and it narrows the tools.
//   - Organisation administrators add the workspace's own skills; nobody else can; a skill can't name unknown tools.
//   - Requirements from a BRS written in PMS come from its data, exactly, with no model call; action items from
//     uploaded notes are read by the model, and a row that's invented or in the wrong format is left out.
//   - The traceability check marks a BRS requirement the BSS covers, and one it doesn't as a gap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { EMBED_DIMS, EMBED_MODEL } from "../src/docIndex.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Skills-Test-Pass-47!";

/** Each word of 4 letters or more adds to one dimension: texts sharing words point the same way. */
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

describe("Ask AI skills and extraction", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = { id: `zzsa${tag}`, code: `zz-sa-${tag}` };
  const people = { ada: { orgAdmin: 1, role: "admin" }, mia: { orgAdmin: 0, role: "manager" }, tom: { orgAdmin: 0, role: "developer" } };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown; form?: FormData }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let systemId = "";
  /** @type {Record<string, string>} */ const docs = {};
  /** Chat-model requests (agent turns), and extraction requests, of the last question. */
  /** @type {any[]} */ let chats = [];
  /** @type {any[]} */ let extractions = [];
  /** @type {(input: any, n: number) => unknown} */ let reply = () => ({ response: "ok" });
  /** @type {(input: any) => unknown} */ let extractReply = () => ({ response: '{"rows":[]}' });
  let n = 0;
  const ask = async (/** @type {string} */ who, /** @type {Record<string, unknown>} */ body, /** @type {(input: any, n: number) => unknown} */ script) => {
    reply = script;
    n = 0;
    chats = [];
    extractions = [];
    const r = await as(who, "/api/assistant", { method: "POST", body });
    return { status: r.status, data: r.data, events: r.status === 200 ? events(r.data) : [] };
  };
  const call = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ args) => ({ tool_calls: [{ id: `c-${name}`, function: { name, arguments: args } }] });
  const skillsAt = async (/** @type {string} */ who, /** @type {Record<string, string>} */ q) => {
    const r = await as(who, `/api/assistant/skills?${new URLSearchParams(q)}`);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    return /** @type {{ contexts: string[]; skills: { id: string; label: string; context: string; custom: boolean; prompt: string }[] }} */ (r.data);
  };
  const upload = async (/** @type {string} */ name, /** @type {string} */ content) => {
    const form = new FormData();
    form.append("file", new File([content], name, { type: "text/markdown" }));
    const r = await as("ada", `/api/systems/${systemId}/documents`, { method: "POST", form });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    return /** @type {string} */ (r.data.id);
  };

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      await tx`INSERT INTO organizations (id, name, code, status, created_at, updated_at) VALUES (${org.id}, ${`Org ${org.code}`}, ${org.code}, 'active', ${now}, ${now})`;
      await tx`SELECT tenancy_seed_organization(${org.id}, ${source})`;
      await tx`INSERT INTO workspaces (id, organization_id, name, key, created_at, updated_at) VALUES (${`${org.id}-ws`}, ${org.id}, 'Projects', 'PRJ', ${now}, ${now})`;
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin, email)
                 VALUES (${id(p)}, ${id(p)}, ${p}, ${d.role}, ${hash}, ${org.id}, ${d.orgAdmin}, ${`${p}-${tag}@example.test`})`;
        await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${org.id}, ${`${org.id}-ws`}, ${id(p)}, ${d.role}, ${now})`;
      }
    });
    api = workerClient(backend);
    api.env.AI = {
      run: async (/** @type {string} */ model, /** @type {any} */ input) => {
        if (model === EMBED_MODEL) return { shape: [input.text.length, EMBED_DIMS], data: input.text.map(fakeEmbedding) };
        if (String(input.messages?.[0]?.content ?? "").startsWith("You extract")) {
          extractions.push(input);
          return extractReply(input);
        }
        chats.push(input);
        return reply(input, n++);
      },
    };
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
    const p = await as("ada", "/api/systems", { method: "POST", body: { name: `Payroll ${tag}`, key: "SKL", lead: id("tom"), status: "WIP", startedAt: "2026-09-01", dueAt: "2027-03-01" } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    systemId = p.data.id;
    // A BRS written in PMS, with two requirements.
    const brs = { control: { title: `Payroll ${tag}` }, introduction: "Payslips are printed by hand today.", functional: [{ title: "Payslips", items: [{ description: "Email payslips to staff as PDF", priority: "M" }, { description: "Pension contributions are reported to the regulator", priority: "S" }] }] };
    expect((await as("ada", `/api/systems/${systemId}/docs/brs`, { method: "PUT", body: { data: brs } })).status).toBe(200);
    const sub = await as("ada", `/api/systems/${systemId}/docs/brs/submit`, { method: "POST" });
    expect(sub.status, JSON.stringify(sub.data)).toBe(200);
    docs.brs = sub.data.documentId;
    docs.bss = await upload("bss.md", "## Payslips\n\nEmail payslips to staff as PDF every month.");
    docs.notes = await upload("notes.md", "# Steering meeting\n\n## Actions\n\nMia will send the revised plan to the client by 2026-12-05.\n\nTom will fix the export bug.");
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id = ${org.id}`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("the skills shown depend on where the person is", async () => {
    let s = await skillsAt("mia", { projectId: systemId, section: "overview" });
    expect(s.contexts).toEqual(["project"]);
    expect(s.skills.find((x) => x.id === "status")?.prompt).toBe(`Summarise where "Payroll ${tag}" stands now: its health and why, the stage and its clock, progress, the forecast finish, and what needs attention. At most six bullets.`);
    s = await skillsAt("mia", { projectId: systemId, section: "docs", document: "brs-1" });
    expect(s.contexts).toEqual(["document", "project"]);
    expect(s.skills[0].context).toBe("document");
    expect(s.skills.find((x) => x.id === "extract_requirements")?.prompt).toContain(`BRS v1 (written in PMS)`);
    const item = await as("ada", "/api/items", { method: "POST", body: { systemId, type: "STORY", summary: "Email payslips", priority: "HIGH" } });
    s = await skillsAt("mia", { projectId: systemId, itemKey: item.data.key });
    expect(s.contexts).toEqual(["item"]);
    expect(s.skills.find((x) => x.id === "test_cases")?.prompt).toBe(`Write test cases for ${item.data.key} "Email payslips": for each, the scenario, the steps and the expected result.`);
    expect((await skillsAt("mia", {})).contexts).toEqual(["portfolio"]);
    expect((await skillsAt("mia", { page: "service-desk" })).contexts).toEqual(["service_desk", "portfolio"]);
  }, SLOW);

  it("a skill sends only its id: the server fills its prompt and narrows its tools", async () => {
    const r = await ask("mia", { skill: "gate_check", context: { projectId: systemId } }, () => ({ response: "Not yet." }));
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.events.find((e) => e.type === "answer")).toMatchObject({ text: "Not yet.", skill: "Check readiness for the next stage gate" });
    const first = chats[0];
    expect(first.messages.at(-1).content).toBe(`Is "Payroll ${tag}" ready to move past its current lifecycle stage? Go through each gate criterion: met or not, what's missing and what to do about it, and whose sign-off is still needed.`);
    expect(first.tools.map((/** @type {any} */ t) => t.function.name).sort()).toEqual(["get_lifecycle_status", "get_project_overview", "get_test_results", "list_documents", "list_signoffs_pending"]);
    expect((await ask("mia", { skill: "no_such_skill" }, () => ({ response: "" }))).status).toBe(404);
    const [row] = await db`SELECT detail FROM activity WHERE action = 'assistant_asked' AND user_id = ${id("mia")} ORDER BY id LIMIT 1`;
    expect(JSON.parse(typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail)).skill).toBe("gate_check");
  }, SLOW);

  it("the workspace's own skills: added by organisation administrators only, shown where they belong", async () => {
    const body = { name: "Draft the client report", context: "project", prompt: "Draft the monthly report for {project}'s client.", tools: ["get_project_overview", "get_risks"] };
    expect((await as("mia", "/api/assistant/skills/custom", { method: "POST", body })).status).toBe(403);
    expect((await as("ada", "/api/assistant/skills/custom", { method: "POST", body: { ...body, tools: ["delete_everything"] } })).status).toBe(400);
    expect((await as("ada", "/api/assistant/skills/custom", { method: "POST", body: { ...body, context: "anywhere" } })).status).toBe(400);
    const made = await as("ada", "/api/assistant/skills/custom", { method: "POST", body });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    const mine = (await skillsAt("mia", { projectId: systemId })).skills.find((s) => s.custom);
    expect(mine).toMatchObject({ id: `custom:${made.data.id}`, label: "Draft the client report", prompt: `Draft the monthly report for "Payroll ${tag}"'s client.` });
    await ask("mia", { skill: mine?.id, context: { projectId: systemId } }, () => ({ response: "Draft." }));
    expect(chats[0].tools.map((/** @type {any} */ t) => t.function.name).sort()).toEqual(["get_project_overview", "get_risks"]);
    // Switched off: gone from the panel, and can't be asked.
    expect((await as("ada", `/api/assistant/skills/custom/${made.data.id}`, { method: "PATCH", body: { enabled: false } })).status).toBe(200);
    expect((await skillsAt("mia", { projectId: systemId })).skills.some((s) => s.custom)).toBe(false);
    expect((await ask("mia", { skill: mine?.id }, () => ({ response: "" }))).status).toBe(404);
    expect((await as("ada", `/api/assistant/skills/custom/${made.data.id}`, { method: "DELETE" })).status).toBe(200);
    const list = await as("ada", "/api/assistant/skills/custom");
    expect(list.data.skills).toEqual([]);
    expect(list.data.tools.map((/** @type {any} */ t) => t.name)).toContain("extract_from_document");
  }, SLOW);

  it("requirements from a BRS written in PMS come from its data: exact, no model needed", async () => {
    const r = await ask("mia", { question: "Extract the requirements" }, (_i, k) => (k === 0 ? call("extract_from_document", { documentId: docs.brs, kind: "requirements" }) : { response: "There are 2 requirements [S1]." }));
    const answer = r.events.find((e) => e.type === "answer");
    expect(extractions).toHaveLength(0);
    expect(answer.tables[0]).toMatchObject({ title: "Requirements: BRS v1 (written in PMS)", kind: "requirements", note: "From the document's own data in PMS: exact." });
    expect(answer.tables[0].rows).toEqual([
      { id: "FRN-01", description: "Payslips: Email payslips to staff as PDF", priority: "M", owner: "" },
      { id: "FRN-02", description: "Payslips: Pension contributions are reported to the regulator", priority: "S", owner: "" },
    ]);
    expect(answer.unverified).toEqual([]);
    expect(answer.sources[0].label).toBe("BRS v1 (written in PMS)");
  }, SLOW);

  it("action items from uploaded notes: read by the model, fenced; invented or malformed rows are left out", async () => {
    extractReply = () => ({
      response: JSON.stringify({
        rows: [
          { action: "Mia will send the revised plan to the client", owner: "Mia", due: "2026-12-05" },
          { action: "Tom will fix the export bug", owner: "Tom" },
          { action: "Book the launch party venue", owner: "Ada" },
          { action: "Write the minutes", due: "next week" },
        ],
      }),
    });
    const r = await ask("mia", { question: "What actions came out of the meeting?" }, (_i, k) => (k === 0 ? call("extract_from_document", { documentId: docs.notes, kind: "actions" }) : { response: "Two actions [S1]." }));
    expect(extractions).toHaveLength(1);
    expect(extractions[0].messages[1].content).toMatch(/<data id="[^"]+">\n## Steering meeting › Actions\n\nMia will send/);
    const t = r.events.find((e) => e.type === "answer").tables[0];
    expect(t.rows.map((/** @type {any} */ x) => x.action)).toEqual(["Mia will send the revised plan to the client", "Tom will fix the export bug"]);
    expect(t.note).toContain("Left out: 1 that didn't fit the format and 1 not found in the document.");
    // What the agent was told about it.
    const told = String(chats.at(-1).messages.find((/** @type {any} */ m) => m.role === "tool").content);
    expect(told).toContain('"leftOut":{"wrongFormat":1,"notInDocument":1}');
  }, SLOW);

  it("the traceability check: a requirement the BSS covers, and a gap", async () => {
    const r = await ask("mia", { skill: "traceability", context: { projectId: systemId, section: "docs" } }, (_i, k) => (k === 0 ? call("check_traceability", { brsDocumentId: docs.brs, bssDocumentId: docs.bss }) : { response: "One gap [S1]." }));
    const t = r.events.find((e) => e.type === "answer").tables[0];
    expect(t.rows.map((/** @type {any} */ x) => [x.id, x.coverage])).toEqual([
      ["FRN-01", "Covered"],
      ["FRN-02", "Gap"],
    ]);
    expect(t.rows[0].where).toBe("Payslips");
    // A document that isn't a BSS the person can see.
    const bad = await ask("mia", { question: "Trace" }, (_i, k) => (k === 0 ? call("check_traceability", { brsDocumentId: docs.brs, bssDocumentId: "0000000000000000" }) : { response: "Couldn't." }));
    expect(String(chats.at(-1).messages.find((/** @type {any} */ m) => m.role === "tool").content)).toContain("No document with that id");
    expect(bad.events.find((e) => e.type === "answer").tables).toEqual([]);
  }, SLOW);
});
