// Administrator module, phase 3: the automation engine. Conditions, round-robin and least-loaded assignment, the
// test run (which changes nothing), loop protection, retries with back-off, signed webhooks, time-based triggers
// (due dates, schedules), the webhook and manual triggers, creating items in another workspace, organisation rules,
// and presets. The real Worker on PGlite (npm test), or the Neon dev branch with PULSE_DB=dev.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../worker/auth.js";
import { retryAutomationJobs, runTimeTriggers } from "../worker/automation.js";
import { purgeDueOrganizations } from "../worker/platform.js";
import { devVar, testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Engine-Phase-Three-47!";

describe("administrator module, phase 3: the automation engine", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = `zza${tag}`;
  const ws = { DEV: `zzadev${tag}`, MKT: `zzamkt${tag}` };
  // owen: Organisation Administrator, admin in both. dan, dina: developers in Development. mia: admin in Marketing only.
  const people = {
    owen: { orgAdmin: 1, spaces: { DEV: "admin", MKT: "admin" } },
    dan: { orgAdmin: 0, spaces: { DEV: "developer" } },
    dina: { orgAdmin: 0, spaces: { DEV: "developer" } },
    mia: { orgAdmin: 0, spaces: { MKT: "admin" } },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let project = "";
  let mktProject = "";
  const env = (/** @type {string} */ w) => /** @type {any} */ ({ ROOT: backend.root, DB: backend.root.withScope({ orgId: org, workspaceId: w }), PUBLIC_URL: "http://localhost", MFA_KEY: devVar("MFA_KEY") ?? "test-only-key" });
  /** Makes a rule in Development as owen; returns the reply. @param {Record<string, unknown>} rule */
  const rule = async (rule) => {
    const r = await as("owen", "/api/automation/rules", { method: "POST", body: { enabled: true, ...rule } });
    if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const item = async (/** @type {Record<string, unknown>} */ b) => {
    const r = await as("owen", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "x", ...b } });
    if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const runs = async (/** @type {string} */ ruleId) => (await as("owen", `/api/automation/rules/${ruleId}/runs`)).data;
  const off = async (/** @type {string} */ ruleId) => db`UPDATE automation_rules SET enabled = 0 WHERE id = ${ruleId}`;

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      await tx`INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (${org}, ${`Org ${tag}`}, ${`zz-a-${tag}`}, ${now}, ${now})`;
      await tx`SELECT tenancy_seed_organization(${org}, ${source})`;
      for (const [key, w] of Object.entries(ws)) {
        await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (${w}, ${org}, ${key === "DEV" ? "Development" : "Marketing"}, ${key}, ${key === "DEV" ? 0 : 1}, ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin, email) VALUES (${id(p)}, ${id(p)}, ${`${p} person`}, 'admin', ${hash}, ${org}, ${d.orgAdmin}, ${`${p}-${tag}@example.test`})`;
        for (const [s, role] of Object.entries(d.spaces)) {
          await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${org}, ${ws[/** @type {"DEV" | "MKT"} */ (s)]}, ${id(p)}, ${role}, ${now})`;
        }
      }
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
    await as("mia", "/api/systems", { method: "POST", body: { name: `Brand ${tag}`, startedAt: "2026-11-01", key: "BRAND" } });
    mktProject = (await db`SELECT id FROM systems WHERE workspace_id = ${ws.MKT}`)[0].id;
    await as("owen", "/api/systems", { method: "POST", body: { name: `Core ${tag}`, startedAt: "2026-11-01", key: "CORE" } });
    project = (await db`SELECT id FROM systems WHERE workspace_id = ${ws.DEV}`)[0].id;
  }, SLOW);
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id = ${org}`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("WHEN created IF (bug AND high) THEN label it; the run log shows each condition", async () => {
    const r = await rule({ name: "Triage", trigger: "item_created", conditions: { op: "and", items: [{ field: "type", op: "is", value: "BUG" }, { field: "priority", op: "is", value: "HIGH" }] }, actions: [{ kind: "add_label", value: "triage" }] });
    const bug = await item({ type: "BUG", priority: "HIGH", summary: "Broken" });
    const task = await item({ type: "TASK", priority: "HIGH", summary: "Fine" });
    expect((await as("owen", `/api/items/${bug.key}`)).data.labels).toEqual(["triage"]);
    expect((await as("owen", `/api/items/${task.key}`)).data.labels).toEqual([]);
    const [last] = await runs(r.id);
    expect(last.itemKey).toBe(bug.key);
    expect(last.detail.conditions).toEqual([
      { label: "Item type is BUG", result: true },
      { label: "Priority is HIGH", result: true },
    ]);
    await off(r.id);
  }, SLOW);

  it("assigns round-robin between the developers, and to the least loaded", async () => {
    const rr = await rule({ name: "Share bugs", trigger: "item_created", conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "share-me" }] }, actions: [{ kind: "assign", value: "round_robin:role:developer" }] });
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await as("owen", `/api/items/${(await item({ summary: `share-me ${i}` })).key}`)).data.assignee);
    expect(new Set(got)).toEqual(new Set([id("dan"), id("dina")]));
    expect(got[0]).not.toBe(got[1]);
    expect(got[0]).toBe(got[2]);
    await off(rr.id);
    // dan now has more open items: least loaded picks dina.
    await item({ summary: "extra", assignee: id("dan") });
    const ll = await rule({ name: "Least loaded", trigger: "item_created", conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "balance-me" }] }, actions: [{ kind: "assign", value: "least_loaded:role:developer" }] });
    expect((await as("owen", `/api/items/${(await item({ summary: "balance-me" })).key}`)).data.assignee).toBe(id("dina"));
    await off(ll.id);
  }, SLOW);

  it("the test run says what would happen and changes nothing", async () => {
    const target = await item({ summary: "Test subject", priority: "LOW" });
    const r = await rule({ name: "Would label", trigger: "manual", enabled: false, conditions: { op: "and", items: [{ field: "priority", op: "is", value: "LOW" }] }, actions: [{ kind: "add_label", value: "looked-at" }, { kind: "comment", value: "Checked {{item.key}}" }, { kind: "set_field", field: "priority", value: "HIGH" }] });
    const before = await db`SELECT count(*)::int AS n FROM automation_runs WHERE rule_id = ${r.id}`;
    const t = await as("owen", `/api/automation/rules/${r.id}/test`, { method: "POST", body: { itemKey: target.key } });
    expect(t.status, JSON.stringify(t.data)).toBe(200);
    expect(t.data.wouldRun).toBe(true);
    expect(t.data.actions).toEqual([`Would add the label looked-at on ${target.key}`, `Would comment on ${target.key}: "Checked ${target.key}"`, `Would set priority to "HIGH" on ${target.key}`]);
    const after = (await as("owen", `/api/items/${target.key}`)).data;
    expect(after.labels).toEqual([]);
    expect(after.priority).toBe("LOW");
    expect(after.commentCount).toBe(0);
    expect((await db`SELECT count(*)::int AS n FROM automation_runs WHERE rule_id = ${r.id}`)[0].n).toBe(before[0].n);
    // An unsaved rule can be tried too.
    const draft = await as("owen", "/api/automation/test", { method: "POST", body: { itemKey: target.key, rule: { name: "Draft", trigger: "item_created", conditions: { op: "and", items: [{ field: "priority", op: "is", value: "HIGHEST" }] }, actions: [{ kind: "add_label", value: "x" }] } } });
    expect(draft.data.wouldRun).toBe(false);
    expect(draft.data.checks.at(-1)).toEqual({ label: "Priority is HIGHEST", result: false });
  }, SLOW);

  it("loop protection: a rule that sets itself off stops at the depth limit", async () => {
    const r = await rule({ name: "Echo", trigger: "comment_added", conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "echo-me" }] }, actions: [{ kind: "comment", value: "again" }] });
    const it = await item({ summary: "echo-me" });
    await as("owen", `/api/items/${it.key}/comments`, { method: "POST", body: { body: "start" } });
    const log = await runs(r.id);
    expect(log.filter((x) => x.status === "success")).toHaveLength(5);
    expect(log.some((x) => x.status === "skipped" && /levels deep/.test(x.message))).toBe(true);
    await off(r.id);
  }, SLOW);

  it("a webhook action is signed, and a failure is tried again later with back-off", async () => {
    /** @type {{ body: string; sig: string | null }[]} */ const calls = [];
    let answer = 503;
    vi.stubGlobal("fetch", async (/** @type {string} */ u, /** @type {RequestInit} */ init) => {
      calls.push({ body: String(init.body), sig: new Headers(init.headers).get("x-pulse-signature") });
      void u;
      return new Response("", { status: answer });
    });
    const r = await rule({ name: "Tell CI", trigger: "item_created", conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "hook-me" }] }, actions: [{ kind: "webhook", value: JSON.stringify({ url: "https://hooks.example.test/pulse", payload: '{"key": "{{item.key}}", "title": "{{item.title}}"}' }) }] });
    expect(r.secrets).toHaveLength(1);
    const it = await item({ summary: 'hook-me "quoted"' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body)).toEqual({ key: it.key, title: 'hook-me "quoted"' });
    expect(calls[0].sig).toBe(`sha256=${createHmac("sha256", r.secrets[0].secret).update(calls[0].body).digest("hex")}`);
    const [job] = await db`SELECT status, attempts, run_after, last_error FROM automation_jobs WHERE rule_id = ${r.id}`;
    expect(job).toMatchObject({ status: "waiting", attempts: 1, last_error: "The webhook answered 503" });
    expect(Date.parse(job.run_after) - Date.now()).toBeGreaterThan(50_000);
    // Not yet due: nothing happens. Due, and the other end is back: done.
    expect(await retryAutomationJobs(env(ws.DEV))).toBe(0);
    await db`UPDATE automation_jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE rule_id = ${r.id}`;
    answer = 200;
    expect(await retryAutomationJobs(env(ws.DEV))).toBe(1);
    const job2 = (await db`SELECT status, attempts, last_error FROM automation_jobs WHERE rule_id = ${r.id}`)[0];
    expect(job2, JSON.stringify(job2)).toMatchObject({ status: "done", attempts: 2 });
    expect(calls).toHaveLength(2);
    // Saving again keeps the secret (the same address).
    const again = await as("owen", `/api/automation/rules/${r.id}`, { method: "PUT", body: { ...r, actions: r.actions.map((/** @type {any} */ a) => ({ kind: a.kind, value: a.value })) } });
    expect(again.data.secrets).toEqual([]);
    await off(r.id);
  }, SLOW);

  it("a job that keeps failing stops after the last try and tells the rule's owner", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    const r = await rule({ name: "Always fails", trigger: "item_created", ownerId: id("owen"), conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "fail-me" }] }, actions: [{ kind: "webhook", value: JSON.stringify({ url: "https://hooks.example.test/down", payload: "{}" }) }] });
    await item({ summary: "fail-me" });
    for (let i = 0; i < 5; i++) {
      await db`UPDATE automation_jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE rule_id = ${r.id} AND status = 'waiting'`;
      await retryAutomationJobs(env(ws.DEV));
    }
    expect((await db`SELECT status, attempts FROM automation_jobs WHERE rule_id = ${r.id}`)[0]).toMatchObject({ status: "failed", attempts: 5 });
    const told = await db`SELECT title FROM notifications WHERE user_id = ${id("owen")} AND title LIKE '%Always fails%'`;
    expect(told).toHaveLength(1);
    await off(r.id);
  }, SLOW);

  it("due soon and due passed fire once per item and due date; a schedule once per occasion", async () => {
    const tomorrow = new Date(Date.now() + 20 * 3_600_000).toISOString().slice(0, 10);
    const soon = await rule({ name: "Due soon", trigger: "due_soon", triggerConfig: { hours: 48 }, conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "dated" }] }, actions: [{ kind: "add_label", value: "due-soon" }] });
    const late = await rule({ name: "Overdue", trigger: "due_passed", conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "dated" }] }, actions: [{ kind: "add_label", value: "overdue" }] });
    const a = await item({ summary: "dated soon", dueDate: tomorrow });
    const b = await item({ summary: "dated late", dueDate: "2026-01-05" });
    await runTimeTriggers(env(ws.DEV));
    await runTimeTriggers(env(ws.DEV));
    expect((await as("owen", `/api/items/${a.key}`)).data.labels).toEqual(["due-soon"]);
    expect((await as("owen", `/api/items/${b.key}`)).data.labels).toEqual(["overdue"]);
    expect((await runs(soon.id)).filter((x) => x.status === "success")).toHaveLength(1);
    expect((await runs(late.id)).filter((x) => x.status === "success")).toHaveLength(1);
    await off(soon.id);
    await off(late.id);
    // Every day at 00:00 (always due today): it creates one item, once.
    const daily = await rule({ name: "Daily plan", trigger: "schedule", triggerConfig: { every: "day", time: "00:00" }, conditionPql: `summary ~ "nothing-matches-${tag}"`, actions: [{ kind: "create_item", value: JSON.stringify({ systemId: project, itemType: "TASK", summary: "Plan for {{today}}" }) }] });
    await runTimeTriggers(env(ws.DEV));
    await runTimeTriggers(env(ws.DEV));
    expect((await db`SELECT count(*)::int AS n FROM work_items WHERE workspace_id = ${ws.DEV} AND summary LIKE 'Plan for %'`)[0].n).toBe(1);
    await off(daily.id);
  }, SLOW);

  it("the webhook trigger: another system calls the rule's secret address", async () => {
    const r = await rule({ name: "From CRM", trigger: "webhook", actions: [{ kind: "comment", value: "CRM says {{webhook.stage}}" }] });
    expect(r.webhookUrl).toMatch(/\/api\/hooks\/automation\/[a-f0-9]{64}$/);
    const path = new URL(r.webhookUrl).pathname;
    const target = await item({ summary: "Deal" });
    const hit = await api.call(path, { method: "POST", body: { itemKey: target.key, stage: "won" } });
    expect(hit.status).toBe(202);
    const comments = await as("owen", `/api/items/${target.key}/comments`);
    expect(JSON.stringify(comments.data)).toContain("CRM says won");
    // A wrong address, or a switched-off rule, is the same 404.
    expect((await api.call(`/api/hooks/automation/${"0".repeat(64)}`, { method: "POST", body: {} })).status).toBe(404);
    await off(r.id);
    expect((await api.call(path, { method: "POST", body: { itemKey: target.key } })).status).toBe(404);
  }, SLOW);

  it("the manual trigger: a button on the item, for people who work on it", async () => {
    const r = await rule({ name: "Escalate now", trigger: "manual", actions: [{ kind: "add_label", value: "escalated" }] });
    const target = await item({ summary: "Stuck", assignee: id("dan") });
    const offered = await as("dan", `/api/automation/manual?item=${target.key}`);
    expect(offered.status, JSON.stringify(offered.data)).toBe(200);
    expect(offered.data.map((/** @type {any} */ x) => x.name)).toContain("Escalate now");
    const pressed = await as("dan", `/api/automation/manual/${r.id}`, { method: "POST", body: { itemKey: target.key } });
    expect(pressed.data.ran).toBe(true);
    expect((await as("dan", `/api/items/${target.key}`)).data.labels).toEqual(["escalated"]);
    // Managing rules stays with those allowed to.
    expect((await as("dan", "/api/automation/rules")).status).toBe(403);
    await off(r.id);
  }, SLOW);

  it("creates an item in another workspace only if the rule's owner could", async () => {
    // owen is in Marketing too: allowed.
    const ok = await rule({ name: "Ask Marketing", trigger: "item_created", conditions: { op: "and", items: [{ field: "summary", op: "contains", value: "landing page" }] }, actions: [{ kind: "create_item", value: JSON.stringify({ workspaceId: ws.MKT, systemId: mktProject, summary: "Copy for {{item.key}}: {{item.title}}" }) }] });
    const src = await item({ summary: "New landing page" });
    const made = await db`SELECT w.summary, w.workspace_id FROM work_items w WHERE w.workspace_id = ${ws.MKT} AND w.summary LIKE 'Copy for %'`;
    expect(made).toEqual([{ summary: `Copy for ${src.key}: New landing page`, workspace_id: ws.MKT }]);
    await off(ok.id);
    // A rule owned by dan (not in Marketing) can't be saved.
    const refused = await as("owen", "/api/automation/rules", { method: "POST", body: { name: "No", trigger: "item_created", ownerId: id("dan"), actions: [{ kind: "create_item", value: JSON.stringify({ workspaceId: ws.MKT, systemId: mktProject, summary: "x" }) }] } });
    expect(refused.status).toBe(403);
    // Another organisation's workspace doesn't exist here.
    const elsewhere = await as("owen", "/api/automation/rules", { method: "POST", body: { name: "No", trigger: "item_created", actions: [{ kind: "create_item", value: JSON.stringify({ workspaceId: "pulse-template-ws", systemId: "x", summary: "x" }) }] } });
    expect(elsewhere.status).toBe(404);
  }, SLOW);

  it("an organisation rule is in every workspace, changed only by its administrators, and joins new workspaces", async () => {
    const made = await as("owen", "/api/automation/rules", { method: "POST", body: { name: `Org-wide ${tag}`, enabled: false, sharedScope: "organization", trigger: "item_created", actions: [{ kind: "add_label", value: "seen" }] } });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    expect(made.data.workspaces).toBe(2);
    const copies = await db`SELECT workspace_id FROM automation_rules WHERE name = ${`Org-wide ${tag}`} ORDER BY workspace_id`;
    expect(copies.map((/** @type {any} */ x) => x.workspace_id).sort()).toEqual([ws.DEV, ws.MKT].sort());
    // mia administers Marketing, not the organisation: she sees it there but can't change it.
    const mine = (await as("mia", "/api/automation/rules")).data.find((/** @type {any} */ x) => x.name === `Org-wide ${tag}`);
    expect(mine.sharedScope).toBe("organization");
    expect((await as("mia", `/api/automation/rules/${mine.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as("mia", "/api/automation/rules", { method: "POST", body: { name: "x", sharedScope: "organization", trigger: "item_created", actions: [{ kind: "add_label", value: "x" }] } })).status).toBe(403);
    const third = await as("owen", "/api/org/workspaces", { method: "POST", body: { name: "Ops", key: "OPS" } });
    expect((await db`SELECT count(*)::int AS n FROM automation_rules WHERE name = ${`Org-wide ${tag}`} AND workspace_id = ${third.data.workspace.id}`)[0].n).toBe(1);
    // Changing it changes every copy.
    const here = (await as("owen", "/api/automation/rules")).data.find((/** @type {any} */ x) => x.name === `Org-wide ${tag}`);
    await as("owen", `/api/automation/rules/${here.id}`, { method: "PUT", body: { name: `Org-wide ${tag} v2`, trigger: "item_created", actions: [{ kind: "add_label", value: "seen" }] } });
    expect((await db`SELECT count(*)::int AS n FROM automation_rules WHERE name = ${`Org-wide ${tag} v2`}`)[0].n).toBe(3);
  }, SLOW);

  it("presets are added switched off, matched to this workspace, with what to fix listed", async () => {
    await as("owen", "/api/custom-fields", { method: "POST", body: { workspace: "Development", name: "Severity", kind: "select", options: ["Critical", "High", "Low"] } });
    const p = await as("owen", "/api/automation/presets/critical-bug", { method: "POST" });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    expect(p.data.rule.enabled).toBe(false);
    const sev = p.data.rule.conditions.items.find((/** @type {any} */ x) => x.field === "custom");
    expect(sev.fieldId).toMatch(/^[a-f0-9]{16}$/);
    expect(p.data.warnings).toEqual([]);
    const review = await as("owen", "/api/automation/presets/subtasks-done-review", { method: "POST" });
    expect(review.data.warnings).toEqual(['This workspace has no status called "Code Review": choose where it moves']);
  }, SLOW);
});
