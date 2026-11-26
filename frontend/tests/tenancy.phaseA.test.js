// Multi-tenancy phase (a): the code released before phase (b) must keep working on the migrated schema,
// and every row it writes must land in the right workspace (the insert triggers of 0013_tenancy_schema.sql).
// Runs against a real database only: PULSE_DB=dev npx vitest run tests/tenancy.phaseA.test.js
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database, devVar, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = `zz-tenancy-${Date.now().toString(36)}`;

describe.skipIf(!url)("tenancy phase (a): the current code on the migrated schema", () => {
  /** @type {ReturnType<typeof workerClient>} */ let api;
  /** @type {ReturnType<typeof database>} */ let db;
  /** @type {string} */ let admin;
  /** @type {Record<string, string>} */ const ws = {};
  /** @type {string} */ let projectId = "";
  /** @type {string} */ let itemKey = "";
  const extraWorkspace = `Zz ${tag}`.slice(0, 40);

  beforeAll(async () => {
    db = database(/** @type {string} */ (url));
    const applied = await db`SELECT 1 FROM schema_migrations WHERE name = '0013_tenancy_schema.sql'`;
    if (!applied.length) throw new Error("Apply migrations/0013_tenancy_schema.sql to this database first");
    for (const w of await db`SELECT id, name FROM workspaces`) ws[w.name] = w.id;
    api = workerClient(/** @type {string} */ (url));
    admin = await api.signIn("qa-admin", /** @type {string} */ (devVar("QA_PASSWORD")));
  }, 240_000);

  afterAll(async () => {
    if (!db) return;
    if (projectId) await db`DELETE FROM systems WHERE id = ${projectId}`;
    await db`DELETE FROM users WHERE username LIKE ${tag + "%"}`;
    await db`DELETE FROM chat_conversations WHERE name LIKE ${tag + "%"}`;
    await db`DELETE FROM saved_filters WHERE name LIKE ${tag + "%"}`;
    // The workspace added through the old list: remove it, then take it off the list (the guard allows
    // that once the workspace is gone).
    const extra = await db`SELECT id FROM workspaces WHERE name = ${extraWorkspace}`;
    if (extra.length) {
      await db.begin(async (tx) => {
        await tx`DELETE FROM sessions WHERE workspace_id = ${extra[0].id}`;
        await tx`DELETE FROM workspace_members WHERE workspace_id = ${extra[0].id}`;
        await tx`DELETE FROM workspaces WHERE id = ${extra[0].id}`;
        await tx`UPDATE settings SET value = (SELECT jsonb_agg(x)::text FROM jsonb_array_elements_text(value::jsonb) x WHERE x <> ${extraWorkspace}) WHERE key = 'workspaces'`;
      });
    }
    await db.end();
  }, 240_000);

  it("signing in opens the Projects workspace", async () => {
    const token = admin.split("=")[1];
    const hash = createHash("sha256").update(token).digest("hex");
    const [s] = await db`SELECT organization_id, workspace_id FROM sessions WHERE token_hash = ${hash}`;
    expect(s.workspace_id).toBe(ws.Projects);
    expect(s.organization_id).toBeTruthy();
  });

  it("a project made in HR, and everything under it, lands in HR", async () => {
    const created = await api.call("/api/systems", { method: "POST", cookie: admin, body: { name: `${tag} HR project`, startedAt: "2026-11-01", workspace: "HR", developers: ["qa-dev"] } });
    expect(created.status).toBeLessThan(300);
    [{ id: projectId }] = await db`SELECT id FROM systems WHERE data::jsonb ->> 'name' = ${`${tag} HR project`}`;
    const [sys] = await db`SELECT workspace_id FROM systems WHERE id = ${projectId}`;
    expect(sys.workspace_id).toBe(ws.HR);

    const item = await api.call("/api/items", { method: "POST", cookie: admin, body: { systemId: projectId, type: "TASK", summary: `${tag} task`, labels: ["tenancy"] } });
    expect(item.status).toBe(201);
    itemKey = item.data.key;
    const comment = await api.call(`/api/items/${itemKey}/comments`, { method: "POST", cookie: admin, body: { body: "Checking where this lands. @qa-dev" } });
    expect(comment.status).toBeLessThan(300);

    const [{ id: itemId }] = await db`SELECT id FROM work_items WHERE system_id = ${projectId}`;
    for (const [table, column] of [
      ["work_items", "id"],
      ["work_item_comments", "item_id"],
      ["work_item_watchers", "item_id"],
      ["work_item_labels", "item_id"],
      ["status_history", "item_id"],
    ]) {
      const rows = await db.unsafe(`SELECT DISTINCT workspace_id FROM ${table} WHERE ${column} = $1`, [itemId]);
      expect(rows.map((r) => r.workspace_id), table).toEqual([ws.HR]);
    }
    const assigned = await db`SELECT workspace_id FROM assignments WHERE system_id = ${projectId}`;
    expect(assigned.map((r) => r.workspace_id)).toEqual([ws.HR]);
    const logged = await db`SELECT DISTINCT workspace_id FROM activity WHERE target = ${projectId}`;
    expect(logged.map((r) => r.workspace_id)).toEqual([ws.HR]);
  }, 240_000);

  it("an update request's bell notification goes to the project's workspace", async () => {
    const r = await api.call("/api/requests", { method: "POST", cookie: admin, body: { systemId: projectId, message: "How is it going?" } });
    expect(r.status).toBeLessThan(300);
    const rows = await db`SELECT workspace_id FROM notifications WHERE link LIKE ${`#/projects/${projectId}%`}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((x) => x.workspace_id))).toEqual(new Set([ws.HR]));
    const [req] = await db`SELECT workspace_id FROM requests WHERE system_id = ${projectId}`;
    expect(req.workspace_id).toBe(ws.HR);
  }, 240_000);

  it("moving the project to another workspace is refused, and nothing moves", async () => {
    const r = await api.call(`/api/systems/${projectId}`, { method: "PATCH", cookie: admin, body: { workspace: "Projects" } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const [sys] = await db`SELECT workspace_id, data::jsonb ->> 'workspace' AS name FROM systems WHERE id = ${projectId}`;
    expect(sys).toEqual({ workspace_id: ws.HR, name: "HR" });
  }, 240_000);

  it("a filter shared with HR lands in HR; a private one in Projects", async () => {
    const shared = await api.call("/api/filters", { method: "POST", cookie: admin, body: { name: `${tag} shared`, pql: "", shareScope: "workspace", shareValue: "HR" } });
    const mine = await api.call("/api/filters", { method: "POST", cookie: admin, body: { name: `${tag} mine`, pql: "" } });
    expect(shared.status).toBeLessThan(300);
    expect(mine.status).toBeLessThan(300);
    const rows = await db`SELECT name, workspace_id FROM saved_filters WHERE name LIKE ${tag + "%"} ORDER BY name`;
    expect(rows).toEqual([
      { name: `${tag} mine`, workspace_id: ws.Projects },
      { name: `${tag} shared`, workspace_id: ws.HR },
    ]);
  }, 240_000);

  it("a group chat and its messages go to Projects", async () => {
    const g = await api.call("/api/chat/groups", { method: "POST", cookie: admin, body: { name: `${tag} group`, people: ["qa-dev"] } });
    expect(g.status).toBeLessThan(300);
    const [conv] = await db`SELECT id, workspace_id FROM chat_conversations WHERE name = ${`${tag} group`}`;
    expect(conv.workspace_id).toBe(ws.Projects);
    const m = await api.call(`/api/chat/${conv.id}/messages`, { method: "POST", cookie: admin, body: { body: "hello" } });
    expect(m.status).toBeLessThan(300);
    const msgs = await db`SELECT DISTINCT workspace_id FROM chat_messages WHERE conversation_id = ${conv.id}`;
    expect(msgs.map((x) => x.workspace_id)).toEqual([ws.Projects]);
  }, 240_000);

  it("adding a workspace through the old list works, and everyone joins it", async () => {
    const [row] = await db`SELECT value FROM settings WHERE key = 'workspaces'`;
    const names = /** @type {string[]} */ (JSON.parse(row.value));
    const r = await api.call("/api/settings/workspaces", { method: "PUT", cookie: admin, body: { workspaces: [...names.map((n) => ({ name: n, was: n })), { name: extraWorkspace }] } });
    expect(r.status).toBe(200);
    const [w] = await db`SELECT id FROM workspaces WHERE name = ${extraWorkspace}`;
    const [{ n: members }] = await db`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${w.id}`;
    const [{ n: people }] = await db`SELECT count(*)::int AS n FROM users`;
    expect(members).toBe(people);
  }, 240_000);

  it("renaming a workspace is refused, and the list stays as it was", async () => {
    const [before] = await db`SELECT value FROM settings WHERE key = 'workspaces'`;
    const names = /** @type {string[]} */ (JSON.parse(before.value));
    const r = await api.call("/api/settings/workspaces", { method: "PUT", cookie: admin, body: { workspaces: names.map((n) => (n === "HR" ? { name: "People", was: "HR" } : { name: n, was: n })) } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const [after] = await db`SELECT value FROM settings WHERE key = 'workspaces'`;
    expect(after.value).toBe(before.value);
    const [sys] = await db`SELECT data::jsonb ->> 'workspace' AS name FROM systems WHERE id = ${projectId}`;
    expect(sys.name).toBe("HR");
  }, 240_000);

  it("a new person joins every workspace; removing them removes the memberships", async () => {
    const r = await api.call("/api/users", { method: "POST", cookie: admin, body: { username: `${tag}-u`, name: "Tenancy Check", password: "Temp-Pass-123-Long!" } });
    expect(r.status).toBeLessThan(300);
    const [u] = await db`SELECT id, organization_id FROM users WHERE username = ${`${tag}-u`}`;
    expect(u.organization_id).toBeTruthy();
    const [{ n }] = await db`SELECT count(*)::int AS n FROM workspace_members WHERE user_id = ${u.id}`;
    const [{ total }] = await db`SELECT count(*)::int AS total FROM workspaces`;
    expect(n).toBe(total);
    const gone = await api.call(`/api/users/${u.id}`, { method: "DELETE", cookie: admin });
    expect(gone.status).toBeLessThan(300);
    const [{ left }] = await db`SELECT count(*)::int AS left FROM workspace_members WHERE user_id = ${u.id}`;
    expect(left).toBe(0);
  }, 240_000);

  it("the main pages still load", async () => {
    for (const path of ["/api/data", "/api/items?limit=5", "/api/notifications", "/api/filters", "/api/dashboards", "/api/chat", "/api/reports/projects/summary"]) {
      const r = await api.call(path, { cookie: admin });
      expect(r.status, path).toBe(200);
    }
    const s = await api.call("/api/search", { method: "POST", cookie: admin, body: { pql: `project = ${(await db`SELECT key FROM systems WHERE id = ${projectId}`)[0].key}` } });
    expect(s.status).toBe(200);
    expect(s.data.total).toBe(1);
  }, 240_000);
});
