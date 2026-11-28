// Ask AI as an assistant (src/assistant.js), through the real Worker on PGlite (or the Neon dev branch with
// PMS_DB=dev), with a scripted stand-in for the model: tools run as the person asking (a restricted item never
// reaches the model for a Manager), another organisation's project can't be read, the tool-call cap holds,
// citations are checked, a figure nothing looked up contains is flagged, every request is logged, and the limit
// is counted in the database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";
import { ASSISTANT_LIMIT, MAX_TOOL_CALLS } from "../../project-management-system-frontend/src/data/assistant.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Assistant-Test-Pass-47!";

/** The events a response streamed. @param {unknown} text @returns {any[]} */
const events = (text) =>
  String(text ?? "")
    .split("\n\n")
    .map((b) => b.replace(/^data:\s*/, "").trim())
    .filter(Boolean)
    .map((b) => JSON.parse(b));

describe("the assistant", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const orgs = { a: { id: `zzaa${tag}`, code: `zz-aa-${tag}` }, b: { id: `zzab${tag}`, code: `zz-ab-${tag}` } };
  const people = {
    ada: { org: orgs.a.id, orgAdmin: 1, role: "admin" },
    mia: { org: orgs.a.id, orgAdmin: 0, role: "manager" },
    tom: { org: orgs.a.id, orgAdmin: 0, role: "developer" },
    bob: { org: orgs.b.id, orgAdmin: 1, role: "admin" },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let systemId = "";
  let otherId = "";
  /**
   * The model's replies in turn; the inputs it was sent are in api.aiInputs.
   * @param {(input: any, n: number) => unknown} reply
   */
  const model = (reply) => {
    let n = 0;
    api.aiInputs.length = 0;
    api.env.AI.run = async (/** @type {string} */ _m, /** @type {any} */ input) => {
      api.aiInputs.push(input);
      return reply(input, n++);
    };
  };
  const call = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ args) => ({ tool_calls: [{ id: `c-${name}`, type: "function", function: { name, arguments: args } }] });
  /** What the tools returned to the model, last request. */
  const toolResults = () => /** @type {any[]} */ (api.aiInputs.at(-1)?.messages ?? []).filter((m) => m.role === "tool").map((m) => String(m.content));
  const ask = async (/** @type {string} */ who, /** @type {Record<string, unknown>} */ body) => {
    const r = await as(who, "/api/assistant", { method: "POST", body });
    return { status: r.status, data: r.data, events: r.status === 200 ? events(r.data) : [] };
  };

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
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);

    const p = await as("ada", "/api/systems", { method: "POST", body: { name: `Payroll ${tag}`, key: "AST", lead: id("tom"), status: "WIP", startedAt: "2026-09-01", dueAt: "2027-03-01" } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    systemId = p.data.id;
    const level = await as("ada", "/api/security-levels", { method: "POST", body: { name: `Board ${tag}`, roles: [], people: [] } });
    expect(level.status, JSON.stringify(level.data)).toBe(201);
    for (const [i, summary] of ["Payslip layout", "Tax tables", "Bank export"].entries()) {
      expect((await as("ada", "/api/items", { method: "POST", body: { systemId, type: "TASK", summary, priority: i ? "MEDIUM" : "HIGH" } })).status).toBe(201);
    }
    expect((await as("ada", "/api/items", { method: "POST", body: { systemId, type: "TASK", summary: "Board salary review", priority: "HIGH", securityLevel: level.data.id } })).status).toBe(201);
    const other = await as("bob", "/api/systems", { method: "POST", body: { name: `Rival secret ${tag}`, key: "RIV", status: "WIP", startedAt: "2026-09-01", dueAt: "2027-03-01" } });
    expect(other.status, JSON.stringify(other.data)).toBe(201);
    otherId = other.data.id;
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${orgs.a.id}, ${orgs.b.id})`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("tools run as the person asking: the restricted item reaches the model for the Administrator only", async () => {
    const script = (/** @type {string} */ answer) => model((_input, n) => (n === 0 ? call("search_items", { pql: "project = AST ORDER BY priority DESC" }) : { response: answer }));
    script("There are 3 open items in Payroll [S1], made up [S9].");
    const r = await ask("mia", { question: "What's open on payroll?", context: { projectId: systemId, section: "work" } });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const step = r.events.find((e) => e.type === "step");
    expect(step).toMatchObject({ tool: "search_items" });
    const answer = r.events.find((e) => e.type === "answer");
    // The citation that names no source is dropped; the real one is kept, with its link.
    expect(answer.text).toBe("There are 3 open items in Payroll [S1], made up.");
    expect(answer.sources[0]).toMatchObject({ id: "S1", href: expect.stringMatching(new RegExp(`^#/projects/${systemId}/items/AST-\\d+$`)) });
    expect(answer.unverified).toEqual([]);
    expect(toolResults().join("")).toContain("Payslip layout");
    expect(toolResults().join("")).not.toContain("Board salary review");
    // The page they were on is in the instructions; the tools are offered to the model.
    const first = api.aiInputs[0];
    expect(first.messages[0].content).toContain(`Payroll ${tag}`);
    expect(first.tools.map((/** @type {any} */ t) => t.function.name)).toContain("get_project_overview");

    script("There are 4 open items.");
    await ask("ada", { question: "What's open on payroll?" });
    expect(toolResults().join("")).toContain("Board salary review");
  }, SLOW);

  it("a figure nothing looked up contains is flagged", async () => {
    model((_input, n) => (n === 0 ? call("get_risks", { projectId: "AST" }) : { response: "Payroll has 17 critical risks." }));
    const answer = (await ask("mia", { question: "How risky is payroll?" })).events.find((e) => e.type === "answer");
    expect(answer.unverified).toEqual(["17"]);
  }, SLOW);

  it("another organisation's project can't be read, by id or by key", async () => {
    model((_input, n) => (n === 0 ? { tool_calls: [{ id: "x1", function: { name: "get_project_overview", arguments: JSON.stringify({ projectId: otherId }) } }, { id: "x2", function: { name: "get_risks", arguments: { projectId: "RIV" } } }] } : { response: "I couldn't find that project." }));
    const r = await ask("mia", { question: "How is the rival project doing?" });
    expect(r.events.find((e) => e.type === "answer").text).toBe("I couldn't find that project.");
    const told = toolResults();
    expect(told).toHaveLength(2);
    for (const t of told) {
      expect(t).toContain("No project");
      expect(t).not.toContain("Rival secret");
    }
  }, SLOW);

  it("bad arguments and unknown tools go back to the model as errors, not run", async () => {
    model((_input, n) => (n === 0 ? { tool_calls: [{ id: "b1", function: { name: "get_report", arguments: { kind: "salaries" } } }, { id: "b2", function: { name: "delete_project", arguments: { projectId: "AST" } } }] } : { response: "Sorry." }));
    await ask("mia", { question: "Delete payroll" });
    const [bad, unknown] = toolResults();
    expect(bad).toContain("must be one of");
    expect(unknown).toContain("no tool called delete_project");
  }, SLOW);

  it(`stops at ${MAX_TOOL_CALLS} tool calls and answers with what it has`, async () => {
    model((input) => (input.tools ? call("find_projects", {}) : { response: "Here's what I found." }));
    const r = await ask("mia", { question: "Tell me everything" });
    expect(r.events.filter((e) => e.type === "step")).toHaveLength(MAX_TOOL_CALLS);
    expect(r.events.find((e) => e.type === "answer").text).toBe("Here's what I found.");
    // The last turn was offered no tools.
    expect(api.aiInputs.at(-1).tools).toBeUndefined();
    expect(api.aiInputs.filter((/** @type {any} */ i) => i.tools)).toHaveLength(MAX_TOOL_CALLS);
  }, SLOW);

  it("every request is logged with the model, the tools and the outcome, not the question", async () => {
    const rows = await db`SELECT detail, target FROM activity WHERE action = 'assistant_asked' AND user_id = ${id("mia")} ORDER BY id`;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const first = typeof rows[0].detail === "string" ? JSON.parse(rows[0].detail) : rows[0].detail;
    expect(rows[0].target).toBe(systemId);
    expect(first).toMatchObject({ model: expect.stringContaining("@cf/"), tools: ["search_items"], calls: 1, outcome: "answered", unverified: 0 });
    expect(JSON.stringify(rows)).not.toContain("What's open on payroll");
  }, SLOW);

  it("a model failure is an error event (the panel then answers the earlier way)", async () => {
    model(() => {
      throw new Error("model down");
    });
    const r = await ask("tom", { question: "What should I work on?" });
    expect(r.events.at(-1)).toMatchObject({ type: "error", code: "agent_failed" });
    const [row] = await db`SELECT detail FROM activity WHERE action = 'assistant_asked' AND user_id = ${id("tom")} ORDER BY id DESC LIMIT 1`;
    expect(JSON.parse(typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail)).outcome).toBe("failed");
  }, SLOW);

  it(`the limit (${ASSISTANT_LIMIT} in 10 minutes) is counted in the database, per person`, async () => {
    const recent = await db`SELECT COUNT(*)::int AS n FROM activity WHERE action = 'assistant_asked' AND user_id = ${id("tom")}`;
    await db`INSERT INTO activity (at, user_id, actor, action, target, detail, organization_id)
             SELECT ${new Date().toISOString()}, ${id("tom")}, 'tom', 'assistant_asked', NULL, '{}', ${orgs.a.id} FROM generate_series(1, ${ASSISTANT_LIMIT - recent[0].n})`;
    model(() => ({ response: "ok" }));
    const r = await ask("tom", { question: "One more?" });
    expect(r.status).toBe(429);
    expect(r.data.code).toBe("assistant_limit");
    // Someone else isn't held up by it.
    expect((await ask("ada", { question: "One more?" })).status).toBe(200);
  }, SLOW);

  it("off without the AI binding, and a question is required", async () => {
    expect((await ask("ada", { question: "" })).status).toBe(400);
    expect((await ask("ada", { question: "x".repeat(2001) })).status).toBe(400);
    const ai = api.env.AI;
    api.env.AI = undefined;
    try {
      const r = await ask("ada", { question: "Hello?" });
      expect(r.status).toBe(503);
      expect(r.data.code).toBe("assistant_off");
    } finally {
      api.env.AI = ai;
    }
  }, SLOW);
});
