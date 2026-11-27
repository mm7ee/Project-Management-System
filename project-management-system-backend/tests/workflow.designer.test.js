// Administrator module, phase 2: a workflow per workspace and per item type, drafts, versions and rollback,
// workspace templates, item types, and the new custom field kinds. One organisation with Development (DEV) and
// Marketing (MKT); the real Worker on PGlite (npm test) or the Neon dev branch with PMS_DB=dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Designer-Phase-Two-81!";

describe("administrator module, phase 2: workflows, item types, templates and fields", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = `zzw${tag}`;
  const ws = { DEV: `zzwdev${tag}`, MKT: `zzwmkt${tag}` };
  // olga: Organisation Administrator, admin in both. tim: Team Leader in Development only (may edit workflows).
  const people = { olga: { orgAdmin: 1, spaces: { DEV: "admin", MKT: "admin" } }, tim: { orgAdmin: 0, spaces: { DEV: "team_lead" } } };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  /** The workflow a workspace uses. @param {string} who */
  const ownWorkflow = async (who) => {
    const r = await as(who, "/api/workflows");
    return r.data.workflows.find((/** @type {any} */ w) => w.id === r.data.workspace);
  };
  let project = "";

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      await tx`INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (${org}, ${`Org ${tag}`}, ${`zz-w-${tag}`}, ${now}, ${now})`;
      await tx`SELECT tenancy_seed_organization(${org}, ${source})`;
      for (const [key, w] of Object.entries(ws)) {
        await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (${w}, ${org}, ${key === "DEV" ? "Development" : "Marketing"}, ${key}, ${key === "DEV" ? 0 : 1}, ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin) VALUES (${id(p)}, ${id(p)}, ${`${p} person`}, 'admin', ${hash}, ${org}, ${d.orgAdmin})`;
        for (const [s, role] of Object.entries(d.spaces)) {
          await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${org}, ${ws[/** @type {"DEV" | "MKT"} */ (s)]}, ${id(p)}, ${role}, ${now})`;
        }
      }
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
    const sys = await as("olga", "/api/systems", { method: "POST", body: { name: `Platform ${tag}`, startedAt: "2026-11-01", key: "PLAT" } });
    if (sys.status >= 300) throw new Error(JSON.stringify(sys.data));
    project = (await db`SELECT id FROM systems WHERE workspace_id = ${ws.DEV}`)[0].id;
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id = ${org}`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("each workspace has its own workflow; another workspace's is invisible and can't be used", async () => {
    const dev = await ownWorkflow("olga");
    expect(dev.workspaceId).toBe(ws.DEV);
    expect(dev.template).toBe(false);
    await as("olga", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.MKT } });
    const mkt = await ownWorkflow("olga");
    expect(mkt.workspaceId).toBe(ws.MKT);
    expect(mkt.id).not.toBe(dev.id);
    const seen = (await as("olga", "/api/workflows")).data.workflows.map((/** @type {any} */ w) => w.id);
    expect(seen).not.toContain(dev.id);
    // From Marketing, Development's workflow doesn't exist: not to edit, not to use.
    expect((await as("olga", `/api/workflows/${dev.id}/draft`)).status).toBe(404);
    expect((await as("olga", `/api/workflows/${dev.id}`, { method: "PUT", body: { name: "Hijacked" } })).status).toBe(404);
    expect((await as("olga", "/api/workflow-assignments", { method: "PUT", body: { workspace: dev.id } })).status).toBe(400);
    // Even directly, the database refuses one workspace using another's workflow.
    await expect(db`UPDATE workspace_workflows SET workflow_id = ${dev.id} WHERE workspace_id = ${ws.MKT}`).rejects.toThrow(/its own workflows/);
    await as("olga", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } });
  }, SLOW);

  it("templates are the organisation's: workspaces read and copy them, only its administrators change them", async () => {
    const all = (await as("tim", "/api/workflows")).data.workflows;
    const template = all.find((/** @type {any} */ w) => w.template);
    expect(template).toBeTruthy();
    expect((await as("tim", `/api/workflows/${template.id}/draft`, { method: "PUT", body: { name: "Mine" } })).data.code).toBe("template_read_only");
    const copy = await as("tim", "/api/workflows", { method: "POST", body: { name: "Dev copy", copyFrom: template.id } });
    expect(copy.status).toBe(201);
    expect(copy.data.workspaceId).toBe(ws.DEV);
    expect((await as("tim", "/api/workflows", { method: "POST", body: { name: "Org-wide", template: true } })).status).toBe(403);
    const made = await as("olga", "/api/workflows", { method: "POST", body: { name: `Org template ${tag}`, template: true, copyFrom: template.id } });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    expect(made.data.workspaceId).toBeNull();
  }, SLOW);

  it("a draft is saved, published as a version (moving items out of removed statuses) and can be rolled back", async () => {
    const wf = await ownWorkflow("tim");
    const statuses = (await as("tim", "/api/statuses")).data;
    const inReview = statuses.find((/** @type {any} */ s) => s.name === "In Review");
    expect(wf.statuses.map((/** @type {any} */ s) => s.id)).toContain(inReview.id);
    // An item in In Review.
    const item = await as("tim", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "Review me" } });
    expect(item.status, JSON.stringify(item.data)).toBe(201);
    await db`UPDATE work_items SET status = ${inReview.id} WHERE id = ${item.data.id}`;
    // The draft drops In Review. Saving it changes nothing yet.
    const draft = { name: wf.name, description: wf.description, statuses: wf.statuses.filter((/** @type {any} */ s) => s.id !== inReview.id), transitions: wf.transitions.filter((/** @type {any} */ t) => t.to !== inReview.id && t.from !== inReview.id) };
    expect((await as("tim", `/api/workflows/${wf.id}/draft`, { method: "PUT", body: draft })).status).toBe(200);
    expect((await ownWorkflow("tim")).statuses.map((/** @type {any} */ s) => s.id)).toContain(inReview.id);
    expect((await as("tim", `/api/workflows/${wf.id}/draft`)).data.draft.statuses).toHaveLength(draft.statuses.length);
    // Publishing asks where its items go, then moves them.
    const ask = await as("tim", `/api/workflows/${wf.id}/publish`, { method: "POST", body: {} });
    expect(ask.status).toBe(409);
    expect(ask.data.code).toBe("needs_moves");
    const inProgress = statuses.find((/** @type {any} */ s) => s.name === "In Progress");
    const pub = await as("tim", `/api/workflows/${wf.id}/publish`, { method: "POST", body: { moves: { [inReview.id]: inProgress.id }, note: "No review step" } });
    expect(pub.status, JSON.stringify(pub.data)).toBe(200);
    expect(pub.data.version).toBe(2);
    expect((await db`SELECT status FROM work_items WHERE id = ${item.data.id}`)[0].status).toBe(inProgress.id);
    expect((await as("tim", `/api/workflows/${wf.id}/draft`)).data.draft).toBeNull();
    const versions = (await as("tim", `/api/workflows/${wf.id}/versions`)).data.versions;
    expect(versions.map((/** @type {any} */ v) => [v.version, v.note])).toEqual([
      [2, "No review step"],
      [1, "As it was before versions were kept"],
    ]);
    // Rolling back publishes version 1 again, as version 3.
    const back = await as("tim", `/api/workflows/${wf.id}/versions/1/restore`, { method: "POST", body: {} });
    expect(back.status, JSON.stringify(back.data)).toBe(200);
    expect(back.data.version).toBe(3);
    expect(back.data.statuses.map((/** @type {any} */ s) => s.id)).toContain(inReview.id);
    // Versions are history: the app can't rewrite them.
    expect((await as("tim", `/api/workflows/${wf.id}/versions/2`)).data.workflow.statuses).toHaveLength(draft.statuses.length);
  }, SLOW);

  it("item types: the workspace's own, each a built-in kind, optionally with its own workflow", async () => {
    const made = await as("tim", "/api/item-types", { method: "POST", body: { name: "Incident", base: "BUG" } });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    expect(made.data).toMatchObject({ id: "INCIDENT", base: "BUG", builtIn: false });
    const item = await as("tim", "/api/items", { method: "POST", body: { systemId: project, itemType: "INCIDENT", summary: "Server down" } });
    expect(item.status).toBe(201);
    expect(item.data).toMatchObject({ type: "BUG", itemType: "INCIDENT", itemTypeName: "Incident" });
    // Its own workflow: a copy whose first status is different; the item moves to the nearest status there.
    const wf = await ownWorkflow("tim");
    const own = await as("tim", "/api/workflows", { method: "POST", body: { name: "Incidents", copyFrom: wf.id } });
    const assign = await as("tim", "/api/workflow-assignments", { method: "PUT", body: { itemTypes: { INCIDENT: own.data.id } } });
    expect(assign.status, JSON.stringify(assign.data)).toBe(200);
    expect((await as("tim", "/api/item-types")).data.find((/** @type {any} */ t) => t.id === "INCIDENT").workflowId).toBe(own.data.id);
    // Not another workspace's types.
    await as("olga", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.MKT } });
    expect((await as("olga", "/api/item-types")).data.map((/** @type {any} */ t) => t.id)).not.toContain("INCIDENT");
    expect((await as("olga", "/api/items", { method: "POST", body: { systemId: project, itemType: "INCIDENT", summary: "x" } })).status).toBe(404);
    await as("olga", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } });
    // In use: it can be switched off, not deleted; switched off, it isn't offered for new items.
    expect((await as("tim", "/api/item-types/INCIDENT", { method: "DELETE" })).status).toBe(409);
    expect((await as("tim", "/api/item-types/INCIDENT", { method: "PATCH", body: { active: false } })).status).toBe(200);
    expect((await as("tim", "/api/items", { method: "POST", body: { systemId: project, itemType: "INCIDENT", summary: "Again" } })).status).toBe(400);
    expect((await as("tim", "/api/item-types/BUG", { method: "DELETE" })).status).toBe(400);
  }, SLOW);

  it("custom fields: new kinds, defaults, and fields for some item types only", async () => {
    const budget = await as("olga", "/api/custom-fields", { method: "POST", body: { workspace: "Development", name: "Budget", kind: "currency", currency: "USD", defaultValue: "250", itemTypes: ["STORY"] } });
    expect(budget.status, JSON.stringify(budget.data)).toBe(201);
    const link = await as("olga", "/api/custom-fields", { method: "POST", body: { workspace: "Development", name: "Spec", kind: "url" } });
    const done = await as("olga", "/api/custom-fields", { method: "POST", body: { workspace: "Development", name: "Signed off", kind: "checkbox", defaultValue: "no" } });
    expect((await as("olga", "/api/custom-fields", { method: "POST", body: { workspace: "Development", name: "Bad", kind: "currency", currency: "XYZ" } })).status).toBe(400);
    const story = await as("olga", "/api/items", { method: "POST", body: { systemId: project, type: "STORY", summary: "With defaults" } });
    const values = (await as("olga", `/api/items/${story.data.key}`)).data.fieldValues;
    expect(values.find((/** @type {any} */ v) => v.name === "Budget")).toMatchObject({ value: 250, display: "USD 250.00" });
    expect(values.find((/** @type {any} */ v) => v.name === "Signed off")).toMatchObject({ value: false, display: "No" });
    // A task doesn't have the story-only field, and can't be given it.
    const task = await as("olga", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "No budget" } });
    expect((await as("olga", `/api/items/${task.data.key}`)).data.fieldValues.some((/** @type {any} */ v) => v.name === "Budget")).toBe(false);
    expect((await as("olga", `/api/items/${task.data.key}`, { method: "PATCH", body: { customFields: { [budget.data.id]: 5 } } })).status).toBe(400);
    // Links are web addresses only.
    expect((await as("olga", `/api/items/${story.data.key}`, { method: "PATCH", body: { customFields: { [link.data.id]: "javascript:alert(1)" } } })).status).toBe(400);
    expect((await as("olga", `/api/items/${story.data.key}`, { method: "PATCH", body: { customFields: { [link.data.id]: "https://example.test/spec", [done.data.id]: true } } })).status).toBe(200);
    // Searchable: a checkbox is yes or no.
    const found = await as("olga", "/api/search", { method: "POST", body: { pql: '"Signed off" = yes' } });
    expect(JSON.stringify(found.data)).toContain(story.data.key);
    expect(JSON.stringify(found.data)).not.toContain(task.data.key);
  }, SLOW);

  it("a new workspace from a built-in template gets the template's workflow, types and fields as its own", async () => {
    const list = (await as("olga", "/api/org/templates")).data;
    expect(list.builtIn.map((/** @type {any} */ t) => t.name)).toEqual(["Software Development", "Marketing", "HR", "Projects (general)"]);
    expect((await as("tim", "/api/org/templates")).status).toBe(403);
    const r = await as("olga", "/api/org/workspaces", { method: "POST", body: { name: "Brand", key: "BRAND", template: "builtin:marketing" } });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.copied).toMatchObject({ workflows: 1, itemTypes: 9, fields: 6 });
    const id2 = r.data.workspace.id;
    await as("olga", "/api/me/workspace", { method: "POST", body: { workspaceId: id2 } });
    const wf = await ownWorkflow("olga");
    expect(wf.workspaceId).toBe(id2);
    const statuses = new Map((await as("olga", "/api/statuses")).data.map((/** @type {any} */ s) => [s.id, s.name]));
    expect(wf.statuses.map((/** @type {any} */ s) => statuses.get(s.id))).toEqual(["Idea", "Brief", "In Production", "Internal Review", "Client/Manager Approval", "Scheduled", "Published", "Reporting"]);
    const types = (await as("olga", "/api/item-types")).data;
    expect(types.filter((/** @type {any} */ t) => t.active).map((/** @type {any} */ t) => t.name)).toEqual(["Sub-task", "Campaign", "Content Piece", "Social Post", "Event"]);
    const fields = (await as("olga", "/api/custom-fields")).data;
    expect(fields.find((/** @type {any} */ f) => f.name === "Budget")).toMatchObject({ kind: "currency", currency: "USD", itemTypes: ["CAMPAIGN", "EVENT"] });
    // It's usable: a campaign in a project there starts in Idea.
    await as("olga", "/api/systems", { method: "POST", body: { name: `Launch ${tag}`, startedAt: "2026-11-01", key: "LAUNCH" } });
    const sys = (await db`SELECT id FROM systems WHERE workspace_id = ${id2}`)[0].id;
    const campaign = await as("olga", "/api/items", { method: "POST", body: { systemId: sys, itemType: "CAMPAIGN", summary: "Summer" } });
    expect(campaign.data).toMatchObject({ type: "EPIC", itemTypeName: "Campaign", statusName: "Idea" });
    // Saved as the organisation's own template, it sets up the next workspace the same way.
    const saved = await as("olga", "/api/org/templates", { method: "POST", body: { workspaceId: id2, name: "Our marketing" } });
    expect(saved.status, JSON.stringify(saved.data)).toBe(201);
    const again = await as("olga", "/api/org/workspaces", { method: "POST", body: { name: "Brand two", key: "BRANDT", template: saved.data.template.id } });
    expect(again.status, JSON.stringify(again.data)).toBe(201);
    expect(again.data.copied).toMatchObject({ workflows: 1, itemTypes: 9, fields: 6, statusesAdded: 0 });
    await as("olga", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } });
  }, SLOW);

  it("a 'clear a field' post-function empties it on the move", async () => {
    const wf = await ownWorkflow("tim");
    const first = wf.transitions.find((/** @type {any} */ t) => t.from === wf.statuses[0].id);
    const draft = { ...wf, transitions: wf.transitions.map((/** @type {any} */ t) => (t === first ? { ...t, rules: [...t.rules, { kind: "post_function", rule: "clear_field", value: "dueDate" }] } : t)) };
    expect((await as("tim", `/api/workflows/${wf.id}`, { method: "PUT", body: draft })).status).toBe(200);
    const item = await as("tim", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "Dated", dueDate: "2026-12-24" } });
    const moved = await as("tim", `/api/items/${item.data.key}/transitions`, { method: "POST", body: { to: first.to } });
    expect(moved.status, JSON.stringify(moved.data)).toBe(200);
    expect((await as("tim", `/api/items/${item.data.key}`)).data.dueDate).toBeUndefined();
  }, SLOW);
});
