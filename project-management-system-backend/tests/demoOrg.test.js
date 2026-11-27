// The demo organisation (scripts/demo-org.mjs): Demo Co with Development and Marketing workspaces made from the
// templates, people, work, presets, an SLA and an approval step; built through the real Worker on PGlite, then
// checked as its people would see it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_CODE, buildDemo } from "../scripts/demo-org.mjs";
import { devVar, testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const SLOW = url === "pglite" ? 180_000 : 1_200_000;

describe.runIf(url === "pglite")("the demo organisation", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  /** @type {Awaited<ReturnType<typeof buildDemo>>} */ let demo;
  /** @type {string[]} */ const said = [];
  const signIn = async (/** @type {string} */ username) => {
    const r = await api.call("/api/login", { method: "POST", body: { organization: DEMO_CODE, username, password: demo.password } });
    if (r.status !== 200) throw new Error(JSON.stringify(r.data));
    return /** @type {string} */ (r.cookie);
  };

  beforeAll(async () => {
    backend = await testBackend(url);
    demo = await buildDemo({ root: backend.root, sql: backend.sql, env: { MFA_KEY: devVar("MFA_KEY") ?? "test-only-key" }, log: (s) => said.push(s) });
    api = workerClient(backend);
  }, SLOW);
  afterAll(async () => {
    await backend?.close();
  });

  it("makes Development and Marketing from the templates, each with its own workflow and types", async () => {
    const admin = await signIn("demo.admin");
    const spaces = (await api.call("/api/me/workspaces", { cookie: admin })).data.workspaces.map((/** @type {any} */ w) => w.name);
    expect(spaces).toEqual(["Development", "Marketing"]);
    await api.call("/api/me/workspace", { method: "POST", cookie: admin, body: { workspaceId: demo.workspaces.Marketing } });
    const types = (await api.call("/api/item-types", { cookie: admin })).data.filter((/** @type {any} */ t) => t.active).map((/** @type {any} */ t) => t.name);
    expect(types).toEqual(["Sub-task", "Campaign", "Content Piece", "Social Post", "Event"]);
    const rules = (await api.call("/api/automation/rules", { cookie: admin })).data;
    expect(rules.filter((/** @type {any} */ r) => r.enabled).map((/** @type {any} */ r) => r.name).sort()).toEqual(
      ["24 hours before the due date: remind the assignee", "Content in Internal Review: Marketing Lead, due in 2 working days", "Every Monday at 08:00: the weekly social media plan"].sort(),
    );
    // The approval preset expects a status the Marketing template doesn't have, so it was left off and said so.
    expect(said.some((s) => /Approved: schedule it.*no status called "Approved"/.test(s))).toBe(true);
  }, SLOW);

  it("the critical-bug rule assigned the critical bug to a developer, at the highest priority", async () => {
    const dev = await signIn("demo.dev1");
    const items = (await api.call("/api/items?limit=50", { cookie: dev })).data.items;
    const bug = items.find((/** @type {any} */ i) => i.summary === "Login page times out on mobile");
    // dev1 sees it if it's theirs; else dev2 has it. Either way: a developer, highest priority.
    const admin = await signIn("demo.admin");
    const full = (await api.call(`/api/items/${bug?.key ?? "PORTAL-6"}`, { cookie: admin })).data;
    expect(full.priority).toBe("HIGHEST");
    expect(full.assignee).toMatch(/demo-dev[12]$/);
    expect(full.sla.policy.name).toBe("Urgent bugs");
  }, SLOW);

  it("people see only their workspaces, and the Viewer can only read", async () => {
    const dev = await signIn("demo.dev1");
    expect((await api.call("/api/items/SUMMER-1", { cookie: dev })).status).toBe(404);
    const viewer = await signIn("demo.viewer");
    expect((await api.call("/api/data", { cookie: viewer })).status).toBe(200);
    expect((await api.call("/api/items", { method: "POST", cookie: viewer, body: { systemId: "x", summary: "No" } })).data.code).toBe("read_only");
  }, SLOW);

  it("leaving a content piece's approval step needs the Marketing Lead", async () => {
    const lead = await signIn("demo.lead");
    await api.call("/api/me/workspace", { method: "POST", cookie: lead, body: { workspaceId: demo.workspaces.Marketing } });
    const wfs = (await api.call("/api/workflows", { cookie: lead })).data;
    const wf = wfs.workflows.find((/** @type {any} */ w) => w.id === wfs.workspace);
    expect(wf.transitions.some((/** @type {any} */ t) => t.name === "Approve" && t.rules.some((/** @type {any} */ r) => r.rule === "approval"))).toBe(true);
  }, SLOW);

  it("refuses to make a second Demo Co, and --reset replaces it", async () => {
    await expect(buildDemo({ root: backend.root, sql: backend.sql })).rejects.toThrow(/already exists/);
    const again = await buildDemo({ root: backend.root, sql: backend.sql, env: { MFA_KEY: devVar("MFA_KEY") ?? "test-only-key" }, reset: true });
    expect(again.orgId).not.toBe(demo.orgId);
    expect((await backend.sql`SELECT count(*)::int AS n FROM organizations WHERE code = ${DEMO_CODE}`)[0].n).toBe(1);
  }, SLOW);
});
