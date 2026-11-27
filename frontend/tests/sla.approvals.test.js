// Administrator module, phase 4: SLAs for work items, approvals on workflow moves, and webhook payload templates.
// The real Worker on PGlite (npm test), or the Neon dev branch with PULSE_DB=dev.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../worker/auth.js";
import { runEvent } from "../worker/automation.js";
import { runWorkItemSla } from "../worker/sla.js";
import { purgeDueOrganizations } from "../worker/platform.js";
import { devVar, testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Phase-Four-Approve-58!";

describe("administrator module, phase 4: SLAs, approvals and webhook payloads", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = `zzs${tag}`;
  const ws = `zzsws${tag}`;
  const other = `zzsot${tag}`;
  // owen: administrator. dev: a developer. mo, mia: managers. ola: administrator of another workspace only.
  const people = { owen: { ws, role: "admin" }, dev: { ws, role: "developer" }, mo: { ws, role: "manager" }, mia: { ws, role: "manager" }, ola: { ws: other, role: "admin" } };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let project = "";
  const tenv = () => /** @type {any} */ ({ ROOT: backend.root, DB: backend.root.withScope({ orgId: org, workspaceId: ws }), PUBLIC_URL: "http://localhost", MFA_KEY: devVar("MFA_KEY") ?? "test-only-key" });

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      await tx`INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (${org}, ${`Org ${tag}`}, ${`zz-s-${tag}`}, ${now}, ${now})`;
      await tx`SELECT tenancy_seed_organization(${org}, ${source})`;
      await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (${ws}, ${org}, 'Support', 'SUP', 0, ${now}, ${now})`;
      await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (${other}, ${org}, 'Other', 'OTH', 1, ${now}, ${now})`;
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin) VALUES (${id(p)}, ${id(p)}, ${`${p} person`}, 'admin', ${hash}, ${org}, ${p === "owen" ? 1 : 0})`;
        await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${org}, ${d.ws}, ${id(p)}, ${d.role}, ${now})`;
      }
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
    await as("owen", "/api/systems", { method: "POST", body: { name: `Desk ${tag}`, startedAt: "2026-11-01", key: "DESK" } });
    project = (await db`SELECT id FROM systems WHERE workspace_id = ${ws}`)[0].id;
  }, SLOW);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id = ${org}`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("an SLA: the first response by someone else stops its clock; resolution keeps running", async () => {
    const made = await as("owen", "/api/sla-policies", { method: "POST", body: { name: "Bugs", itemTypes: ["BUG"], firstResponseMinutes: 60, resolutionMinutes: 480, warnPercent: 75 } });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    expect((await as("dev", "/api/sla-policies", { method: "POST", body: { name: "x", resolutionMinutes: 10 } })).status).toBe(403);
    const bug = await as("dev", "/api/items", { method: "POST", body: { systemId: project, type: "BUG", summary: "Login broken" } });
    let item = (await as("dev", `/api/items/${bug.data.key}`)).data;
    expect(item.sla.policy.name).toBe("Bugs");
    expect(item.sla.response).toMatchObject({ target: "response", targetMinutes: 60 });
    expect(["running", "warning", "breached"]).toContain(item.sla.response.state);
    // The reporter's own comment isn't a response; someone else's is.
    await as("dev", `/api/items/${bug.data.key}/comments`, { method: "POST", body: { body: "More detail" } });
    expect((await as("dev", `/api/items/${bug.data.key}`)).data.sla.response.state).not.toMatch(/met|missed/);
    await as("owen", `/api/items/${bug.data.key}/comments`, { method: "POST", body: { body: "Looking" } });
    item = (await as("dev", `/api/items/${bug.data.key}`)).data;
    expect(["met", "missed"]).toContain(item.sla.response.state);
    expect(item.sla.resolution.state).not.toMatch(/met|missed/);
    // A task has no SLA.
    const task = await as("dev", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "No SLA" } });
    expect((await as("dev", `/api/items/${task.data.key}`)).data.sla).toBeUndefined();
  }, SLOW);

  it("a breach is told once, to the assignee and the administrators, and sets off automation", async () => {
    const rule = await as("owen", "/api/automation/rules", { method: "POST", body: { name: "On breach", enabled: true, trigger: "sla_breached", triggerValue: "resolution", actions: [{ kind: "add_label", value: "breached" }] } });
    expect(rule.status, JSON.stringify(rule.data)).toBe(201);
    const bug = await as("dev", "/api/items", { method: "POST", body: { systemId: project, type: "BUG", summary: "Old bug", assignee: id("dev") } });
    // Made weeks ago: both targets long breached.
    await db`UPDATE work_items SET created_at = '2026-10-01T06:00:00.000Z' WHERE id = ${bug.data.id}`;
    const env = tenv();
    const first = await runWorkItemSla(env, (e) => runEvent(env, e));
    expect(first).toBeGreaterThanOrEqual(2);
    expect(await runWorkItemSla(env, (e) => runEvent(env, e))).toBe(0);
    const told = await db`SELECT user_id, title FROM notifications WHERE title LIKE ${`SLA breached: ${bug.data.key}%`} ORDER BY user_id, title`;
    expect(told.map((/** @type {any} */ t) => t.user_id).sort()).toEqual([id("dev"), id("dev"), id("owen"), id("owen")].sort());
    expect((await as("dev", `/api/items/${bug.data.key}`)).data.labels).toEqual(["breached"]);
    await db`UPDATE automation_rules SET enabled = 0 WHERE id = ${rule.data.id}`;
  }, SLOW);

  it("a move needing a manager's approval waits; the wrong person can't see it; a rejection needs a reason", async () => {
    const wfs = (await as("owen", "/api/workflows")).data;
    const wf = wfs.workflows.find((/** @type {any} */ w) => w.id === wfs.workspace);
    const start = wf.statuses.find((/** @type {any} */ s) => s.initial).id;
    const move = wf.transitions.find((/** @type {any} */ t) => t.from === start);
    const draft = { ...wf, transitions: wf.transitions.map((/** @type {any} */ t) => (t === move ? { ...t, rules: [...t.rules, { kind: "validator", rule: "approval", value: JSON.stringify({ who: "role:manager", needed: 1 }) }] } : t)) };
    const pub = await as("owen", `/api/workflows/${wf.id}`, { method: "PUT", body: draft });
    expect(pub.status, JSON.stringify(pub.data)).toBe(200);
    const it1 = await as("dev", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "Needs sign-off" } });
    const asked = await as("dev", `/api/items/${it1.data.key}/transitions`, { method: "POST", body: { transitionId: pub.data.transitions.find((/** @type {any} */ t) => t.from === start && t.to === move.to).id, comment: "Please" } });
    expect(asked.status, JSON.stringify(asked.data)).toBe(200);
    expect(asked.data.status).toBe(start);
    expect(asked.data.approval).toMatchObject({ status: "pending", needed: 1, requestedBy: "dev person" });
    expect(asked.data.approval.approvers.map((/** @type {any} */ a) => a.id).sort()).toEqual([id("mia"), id("mo")].sort());
    // While it waits, no other move.
    const otherMove = pub.data.transitions.find((/** @type {any} */ t) => t.from === null || (t.from === start && t.to !== move.to));
    if (otherMove) expect((await as("dev", `/api/items/${it1.data.key}/transitions`, { method: "POST", body: { transitionId: otherMove.id } })).data.code).toBe("approval_pending");
    const approvalId = asked.data.approval.id;
    // The requester, someone who isn't an approver, and another workspace's administrator: it doesn't exist.
    expect((await as("dev", `/api/approvals/${approvalId}/approve`, { method: "POST" })).status).toBe(404);
    expect((await as("owen", `/api/approvals/${approvalId}/approve`, { method: "POST" })).status).toBe(404);
    expect((await as("ola", `/api/approvals/${approvalId}/approve`, { method: "POST" })).status).toBe(404);
    // Waiting for mo.
    expect((await as("mo", "/api/approvals")).data.map((/** @type {any} */ a) => a.itemKey)).toContain(it1.data.key);
    expect((await as("mo", `/api/approvals/${approvalId}/reject`, { method: "POST", body: {} })).data.code).toBe("reason_required");
    const rejected = await as("mo", `/api/approvals/${approvalId}/reject`, { method: "POST", body: { reason: "Not this sprint" } });
    expect(rejected.data).toMatchObject({ status: "rejected", reason: "Not this sprint" });
    const after = (await as("dev", `/api/items/${it1.data.key}`)).data;
    expect(after.status).toBe(start);
    expect(after.approval).toBeUndefined();
    expect(JSON.stringify((await as("dev", `/api/items/${it1.data.key}/comments`)).data)).toContain("Not this sprint");
    // Decisions can't be rewritten.
    await expect(backend.root.withScope({ orgId: org, workspaceId: ws }).prepare("UPDATE approval_votes SET decision = 'approve'").run()).rejects.toThrow();
  }, SLOW);

  it("two of these people: the move happens on the second approval, and automation hears of it", async () => {
    const rule = await as("owen", "/api/automation/rules", { method: "POST", body: { name: "On approval", enabled: true, trigger: "approval_granted", actions: [{ kind: "add_label", value: "approved" }] } });
    const wfs = (await as("owen", "/api/workflows")).data;
    const wf = wfs.workflows.find((/** @type {any} */ w) => w.id === wfs.workspace);
    const start = wf.statuses.find((/** @type {any} */ s) => s.initial).id;
    const move = wf.transitions.find((/** @type {any} */ t) => t.from === start && t.rules.some((/** @type {any} */ r) => r.rule === "approval"));
    const draft = { ...wf, transitions: wf.transitions.map((/** @type {any} */ t) => (t === move ? { ...t, rules: [{ kind: "validator", rule: "approval", value: JSON.stringify({ who: `users:${id("mo")},${id("mia")},${id("owen")}`, needed: 2 }) }] } : t)) };
    const pub = await as("owen", `/api/workflows/${wf.id}`, { method: "PUT", body: draft });
    expect(pub.status, JSON.stringify(pub.data)).toBe(200);
    const it2 = await as("dev", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "Two signatures" } });
    const asked = await as("dev", `/api/items/${it2.data.key}/transitions`, { method: "POST", body: { to: move.to } });
    const approvalId = asked.data.approval.id;
    expect(asked.data.approval.needed).toBe(2);
    const one = await as("mo", `/api/approvals/${approvalId}/approve`, { method: "POST", body: { comment: "Fine by me" } });
    expect(one.data).toMatchObject({ status: "pending", approvals: 1 });
    expect((await as("dev", `/api/items/${it2.data.key}`)).data.status).toBe(start);
    const two = await as("mia", `/api/approvals/${approvalId}/approve`, { method: "POST" });
    expect(two.data.status).toBe("approved");
    const done = (await as("dev", `/api/items/${it2.data.key}`)).data;
    expect(done.status).toBe(move.to);
    expect(done.labels).toEqual(["approved"]);
    // The history shows both approvals.
    const hist = (await as("dev", `/api/items/${it2.data.key}/approvals`)).data;
    expect(hist[0].votes.map((/** @type {any} */ v) => v.by)).toEqual(["mo person", "mia person"]);
    await db`UPDATE automation_rules SET enabled = 0 WHERE id = ${rule.data.id}`;
  }, SLOW);

  it("an approval rule is checked when the workflow is saved", async () => {
    const wfs = (await as("owen", "/api/workflows")).data;
    const wf = wfs.workflows.find((/** @type {any} */ w) => w.id === wfs.workspace);
    const bad = { ...wf, transitions: wf.transitions.map((/** @type {any} */ t, /** @type {number} */ i) => (i === 0 ? { ...t, rules: [{ kind: "validator", rule: "approval", value: JSON.stringify({ who: "users:a,b", needed: 3 }) }] } : t)) };
    expect((await as("owen", `/api/workflows/${wf.id}`, { method: "PUT", body: bad })).status).toBe(400);
  }, SLOW);

  it("a webhook's own payload: smart values filled in, escaped for JSON", async () => {
    /** @type {string[]} */ const bodies = [];
    vi.stubGlobal("fetch", async (/** @type {string} */ _u, /** @type {RequestInit} */ init) => {
      bodies.push(String(init.body));
      return new Response("", { status: 200 });
    });
    const bad = await as("owen", "/api/webhooks", { method: "POST", body: { name: "Bad", url: "https://hooks.example.test/x", events: ["created"], payloadTemplate: "{not json" } });
    expect(bad.status).toBe(400);
    const hook = await as("owen", "/api/webhooks", { method: "POST", body: { name: "Chat", url: "https://hooks.example.test/chat", events: ["created"], payloadTemplate: '{"text": "New {{item.type}} {{item.key}}: {{item.title}}", "who": "{{item.reporter.name}}"}' } });
    expect(hook.status, JSON.stringify(hook.data)).toBe(201);
    const made = await as("owen", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: 'Say "hi" \\ there' } });
    const sent = bodies.map((b) => JSON.parse(b)).find((b) => b.text);
    expect(sent).toEqual({ text: `New Task ${made.data.key}: Say "hi" \\ there`, who: "owen person" });
  }, SLOW);
});
