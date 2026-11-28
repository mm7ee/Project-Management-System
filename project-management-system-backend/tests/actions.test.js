// Ask AI, phase (d): write tools that only propose, and the confirmation that runs them (src/actions.js, migration
// 0031), through the real Worker on PGlite (or the Neon dev branch with PMS_DB=dev) and a scripted stand-in model.
//   - A write tool changes nothing: it stores a proposal the panel shows as a card. Confirming runs it once, as the
//     person, through the ordinary API and its checks (a refused step says why); a second confirm is refused.
//   - Ids the model names must have come from a lookup in the conversation; another organisation's project can't be
//     named at all; Readers and view-only links get no write tools.
//   - A proposal is its proposer's alone, can be cancelled, and expires.
//   - The table button: extracted rows become work items in one confirmation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { tableToProposal } from "../../project-management-system-frontend/src/data/actions.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Actions-Test-Pass-47!";
/** A one-stage lifecycle whose gate is a checklist item, so the project has a risk register and an unmet gate. */
const TINY = {
  settings: { selfSignoff: false, advanceBy: ["lead", "manager", "admin"], sendBackBy: ["lead", "manager", "admin"], skipApprovedBy: ["manager", "admin"], signoffReminderDays: 2, overdueEscalateTo: ["manager"], progress: { lifecycleWeight: 1 }, onClose: { status: "LIVE" } },
  phases: [{ code: "A", name: "Build" }, { code: "B", name: "Close" }],
  stages: [
    { code: "BUILD", name: "Dev Work", phase: "A", type: "work", responsible: ["lead"], targetDays: 5, weight: 60, exit: [{ kind: "checklist", key: "built", label: "Built" }], transitions: { sendBackTo: [], canSkip: false } },
    { code: "CLOSE", name: "Close Project", phase: "B", type: "closure", responsible: ["lead"], targetDays: 5, weight: 40, exit: [{ kind: "checklist", key: "handover", label: "Handed over" }], transitions: { sendBackTo: ["BUILD"], canSkip: false } },
  ],
};
const events = (/** @type {unknown} */ text) =>
  String(text ?? "")
    .split("\n\n")
    .map((b) => b.replace(/^data:\s*/, "").trim())
    .filter(Boolean)
    .map((b) => JSON.parse(b));

describe("Ask AI write tools", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const orgs = { a: { id: `zzxa${tag}`, code: `zz-xa-${tag}` }, b: { id: `zzxb${tag}`, code: `zz-xb-${tag}` } };
  const people = {
    ada: { org: orgs.a.id, orgAdmin: 1, role: "admin" },
    mia: { org: orgs.a.id, orgAdmin: 0, role: "manager" },
    tom: { org: orgs.a.id, orgAdmin: 0, role: "developer" },
    rex: { org: orgs.a.id, orgAdmin: 0, role: "reader" },
    bob: { org: orgs.b.id, orgAdmin: 1, role: "admin" },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let systemId = "";
  let otherId = "";
  /** @type {any[]} */ let chats = [];
  const call = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ args) => ({ tool_calls: [{ id: `c-${name}`, function: { name, arguments: args } }] });
  /** Asks with a script of tool calls, then "Done.". @param {string} who @param {Record<string, unknown>[]} steps @param {Record<string, unknown>} [extra] */
  const ask = async (who, steps, extra = {}) => {
    chats = [];
    let n = 0;
    api.env.AI.run = async (/** @type {string} */ _m, /** @type {any} */ input) => {
      chats.push(input);
      const s = steps[n++];
      return s ?? { response: "I've prepared that for you to confirm." };
    };
    const r = await as(who, "/api/assistant", { method: "POST", body: { question: "Please do it", ...extra } });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const answer = events(r.data).find((e) => e.type === "answer");
    const told = chats.at(-1)?.messages.filter((/** @type {any} */ m) => m.role === "tool").map((/** @type {any} */ m) => String(m.content)) ?? [];
    return { answer, told: told.join("\n") };
  };
  const confirm = (/** @type {string} */ who, /** @type {string} */ actionId) => as(who, `/api/assistant/actions/${actionId}/confirm`, { method: "POST" });
  const count = async (/** @type {string} */ sql, /** @type {unknown[]} */ ...args) => Number((await db.unsafe(sql, args))[0].n);

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
    const t = await as("ada", "/api/lifecycle/templates", { method: "POST", body: { name: "Tiny", definition: TINY } });
    expect(t.status, JSON.stringify(t.data)).toBe(201);
    expect((await as("ada", `/api/lifecycle/templates/${t.data.template.id}/publish`, { method: "POST", body: { default: true } })).status).toBe(200);
    const dates = { startedAt: "2026-09-01", dueAt: "2027-03-01", status: "WIP" };
    const p = await as("ada", "/api/systems", { method: "POST", body: { name: `Payroll ${tag}`, key: "ACT", lead: id("tom"), ...dates } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    systemId = p.data.id;
    expect((await as("ada", `/api/systems/${systemId}`, { method: "PATCH", body: { developers: [id("tom")] } })).status).toBeLessThan(300);
    const q = await as("bob", "/api/systems", { method: "POST", body: { name: `Rival ${tag}`, key: "RIV", ...dates } });
    otherId = q.data.id;
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${orgs.a.id}, ${orgs.b.id})`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("a write tool only proposes; confirming creates it, as the person, once", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM work_items WHERE system_id = $1", systemId);
    const { answer } = await ask("mia", [call("find_projects", {}), call("create_work_items", { projectId: "ACT", items: [{ type: "STORY", summary: "Email payslips", priority: "HIGH", assignee: "tom" }] })]);
    const card = answer.actions[0];
    expect(card).toMatchObject({ tool: "create_work_items", title: `Create 1 work item in Payroll ${tag}`, status: "proposed" });
    expect(card.preview.table.rows[0]).toMatchObject({ summary: "Email payslips", assignee: "tom", priority: "HIGH" });
    // Nothing yet.
    expect(await count("SELECT COUNT(*) AS n FROM work_items WHERE system_id = $1", systemId)).toBe(before);
    const r = await confirm("mia", card.id);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.status).toBe("done");
    expect(r.data.results[0]).toMatchObject({ ok: true, label: expect.stringMatching(/^Created ACT-\d+: Email payslips$/), href: expect.stringMatching(new RegExp(`^#/projects/${systemId}/items/ACT-\\d+$`)) });
    const [item] = await db`SELECT assignee, reporter, priority FROM work_items WHERE system_id = ${systemId} AND summary = 'Email payslips'`;
    expect(item).toMatchObject({ assignee: id("tom"), reporter: id("mia"), priority: "HIGH" });
    // Once only.
    expect((await confirm("mia", card.id)).status).toBe(409);
    const [log] = await db`SELECT detail FROM activity WHERE action = 'assistant_action' AND user_id = ${id("mia")} ORDER BY id DESC LIMIT 1`;
    expect(JSON.parse(typeof log.detail === "string" ? log.detail : JSON.stringify(log.detail))).toMatchObject({ tool: "create_work_items", outcome: "done", steps: 1, done: 1 });
  }, SLOW);

  it("ids must come from a lookup; another organisation's project can't be named", async () => {
    let r = await ask("mia", [call("create_work_items", { projectId: systemId, items: [{ summary: "Sneaky" }] })]);
    expect(r.told).toContain("didn't come from a lookup in this conversation");
    expect(r.answer.actions).toEqual([]);
    r = await ask("mia", [call("update_work_items", { keys: ["ACT-1"], changes: { priority: "LOW" } })]);
    expect(r.told).toContain("didn't come from a lookup");
    r = await ask("mia", [call("find_projects", {}), call("create_work_items", { projectId: otherId, items: [{ summary: "Into the rival" }] })]);
    expect(r.told).toContain("No project");
    expect(await count("SELECT COUNT(*) AS n FROM work_items WHERE summary = 'Into the rival'")).toBe(0);
    // The page the person is on counts as seen.
    r = await ask("mia", [call("create_work_items", { projectId: systemId, items: [{ summary: "From the page" }] })], { context: { projectId: systemId } });
    expect(r.answer.actions).toHaveLength(1);
  }, SLOW);

  it("the confirmation goes through the API's own checks: a refused step says why", async () => {
    const [{ key }] = await db`SELECT s.key || '-' || w.number AS key FROM work_items w JOIN systems s ON s.id = w.system_id WHERE w.summary = 'Email payslips'`;
    const tomorrow2 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const { answer } = await ask("mia", [call("search_items", { pql: "project = ACT" }), call("log_work", { key, minutes: 90, date: tomorrow2, note: "Ahead of time" })]);
    const card = answer.actions[0];
    expect(card.title).toBe(`Log 1h 30m on ${key}`);
    const r = await confirm("mia", card.id);
    expect(r.data.status).toBe("failed");
    expect(r.data.results[0]).toMatchObject({ ok: false, message: "You can't log time in the future" });
  }, SLOW);

  it("a report by email: the filter, then its subscription, in order", async () => {
    const { answer } = await ask("mia", [call("schedule_report", { name: `Open payroll ${tag}`, pql: "project = ACT AND statusCategory != Done", frequency: "weekly", weekday: 1, hour: 8 })]);
    const card = answer.actions[0];
    expect(card.preview.fields).toContainEqual(["When", "Every Monday at 08:00"]);
    const r = await confirm("mia", card.id);
    expect(r.data.status, JSON.stringify(r.data)).toBe("done");
    const [f] = await db`SELECT f.id, s.frequency, s.weekday, s.hour FROM saved_filters f JOIN filter_subscriptions s ON s.filter_id = f.id WHERE f.name = ${`Open payroll ${tag}`}`;
    expect(f).toMatchObject({ frequency: "weekly", weekday: 1, hour: 8 });
    // A PQL that doesn't parse is caught before anything is proposed.
    const bad = await ask("mia", [call("schedule_report", { name: "Broken", pql: "project = = ACT", frequency: "daily", hour: 8 })]);
    expect(bad.told).toContain("That PQL didn't work");
  }, SLOW);

  it("risks, a draft document and a notification; the API's own rule on who may change a register", async () => {
    // The project's lead: a risk and a draft section.
    const { answer } = await ask("tom", [
      call("find_projects", {}),
      call("create_risks", { projectId: "ACT", risks: [{ risk: "Bank file format changes", likelihood: 3, impact: 4, owner: "tom" }] }),
      call("draft_document", { projectId: "ACT", kind: "brs", sections: [{ section: "Executive summary", text: "Payslips by email, for every employee." }] }),
    ]);
    expect(answer.actions.map((/** @type {any} */ a) => a.tool)).toEqual(["create_risks", "draft_document"]);
    for (const a of answer.actions) {
      const done = await confirm("tom", a.id);
      expect(done.data.status, `${a.tool}: ${JSON.stringify(done.data.results)}`).toBe("done");
    }
    // A Manager who isn't on the project: the notification goes; the register refuses, as it would anywhere.
    const m = await ask("mia", [
      call("find_projects", {}),
      call("send_notification", { projectId: "ACT", title: "UAT starts Monday", message: "Please keep Monday free." }),
      call("create_risks", { projectId: "ACT", risks: [{ risk: "Manager's own risk", likelihood: 2, impact: 2 }] }),
    ]);
    const [note, risk] = m.answer.actions;
    expect((await confirm("mia", note.id)).data.status).toBe("done");
    const refused = await confirm("mia", risk.id);
    expect(refused.data).toMatchObject({ status: "failed", results: [{ ok: false, message: "Only people on this project can change that" }] });
    expect(await count("SELECT COUNT(*) AS n FROM risk_register WHERE system_id = $1 AND risk = 'Bank file format changes' AND owner_id = $2", systemId, id("tom"))).toBe(1);
    const [doc] = await db`SELECT status, data FROM project_documents WHERE system_id = ${systemId} AND kind = 'brs'`;
    expect(doc.status).toBe("draft");
    expect(JSON.parse(doc.data).summary).toBe("Payslips by email, for every employee.");
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND title LIKE $2", id("tom"), "%UAT starts Monday")).toBe(1);
    // The gate isn't met: no proposal, and what's missing.
    const adv = await ask("mia", [call("find_projects", {}), call("advance_stage", { projectId: "ACT" })]);
    expect(adv.told).toContain("The Dev Work gate isn't met yet. Still missing: Built.");
    expect(adv.answer.actions).toEqual([]);
  }, SLOW);

  it("a proposal is its proposer's alone, can be cancelled, and expires", async () => {
    const mk = async () => (await ask("mia", [call("find_projects", {}), call("create_work_items", { projectId: "ACT", items: [{ summary: `Later ${Math.random()}` }] })])).answer.actions[0];
    let card = await mk();
    expect((await confirm("ada", card.id)).status).toBe(404);
    const c = await as("mia", `/api/assistant/actions/${card.id}/cancel`, { method: "POST" });
    expect(c.data.status).toBe("cancelled");
    expect((await confirm("mia", card.id)).status).toBe(409);
    card = await mk();
    await db`UPDATE ai_actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ${card.id}`;
    const r = await confirm("mia", card.id);
    expect(r.status).toBe(410);
    expect(r.data.code).toBe("action_expired");
  }, SLOW);

  it("from an extracted table: all its rows become work items in one confirmation", async () => {
    const rows = [
      { id: "FRN-01", description: "Payslips: Email payslips to staff as PDF", priority: "M", owner: "" },
      { id: "FRN-02", description: "Payslips: Keep seven years of payslips", priority: "S", owner: "" },
    ];
    const offer = /** @type {NonNullable<ReturnType<typeof tableToProposal>>} */ (tableToProposal("requirements", rows, systemId));
    const p = await as("mia", "/api/assistant/actions", { method: "POST", body: { tool: offer.tool, args: offer.args } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    expect(p.data.title).toBe(`Create 2 work items in Payroll ${tag}`);
    const r = await confirm("mia", p.data.id);
    expect(r.data.status).toBe("done");
    const made = await db`SELECT w.summary, w.priority, w.type FROM work_items w WHERE w.system_id = ${systemId} AND w.summary LIKE 'FRN-%' ORDER BY w.number`;
    expect(made).toEqual([
      { summary: "FRN-01 Payslips: Email payslips to staff as PDF", priority: "HIGH", type: "STORY" },
      { summary: "FRN-02 Payslips: Keep seven years of payslips", priority: "MEDIUM", type: "STORY" },
    ]);
    // Only these two may be proposed from the panel; Readers can't propose at all.
    expect((await as("mia", "/api/assistant/actions", { method: "POST", body: { tool: "update_work_items", args: { keys: ["ACT-1"], changes: {} } } })).status).toBe(400);
    expect((await as("rex", "/api/assistant/actions", { method: "POST", body: { tool: offer.tool, args: offer.args } })).status).toBe(403);
  }, SLOW);

  it("Readers get no write tools", async () => {
    await ask("rex", []);
    const offered = chats[0].tools.map((/** @type {any} */ t) => t.function.name);
    expect(offered).toContain("search_items");
    expect(offered).not.toContain("create_work_items");
    expect(offered).not.toContain("add_comment");
  }, SLOW);
});
