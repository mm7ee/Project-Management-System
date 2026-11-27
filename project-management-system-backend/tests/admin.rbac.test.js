// Administrator module, phase 1: the read-only Viewer role, Workspace and Organisation Administrators, the
// organisation profile, invitations and CSV import, deactivating, copying a workspace's configuration, workspaces
// open to the whole organisation, the append-only audit log, and deleting an organisation.
// One organisation with Marketing (MKT) and Development (DEV), and a second organisation to prove nothing crosses.
// Runs the real Worker on PGlite (npm test), or the Neon dev branch with PULSE_DB=dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Admin-Module-Pass-73!";
const NEW_PASSWORD = "Copper-Harbour-Violet-64!";
// A 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("administrator module, phase 1: roles, organisation and workspace administration", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = `zzo${tag}`;
  const other = `zzp${tag}`;
  const ws = { MKT: `zzmkt${tag}`, DEV: `zzdev${tag}`, OTHER: `zzoth${tag}` };
  // owen: Organisation Administrator, admin in both. wanda: Workspace Admin of Marketing, developer in Development.
  // vic: Viewer in Marketing only. pat: Organisation Administrator of the other organisation.
  const people = {
    owen: { org, orgAdmin: 1, spaces: { MKT: "admin", DEV: "admin" } },
    wanda: { org, orgAdmin: 0, spaces: { MKT: "admin", DEV: "developer" } },
    vic: { org, orgAdmin: 0, spaces: { MKT: "reader" } },
    pat: { org: other, orgAdmin: 1, spaces: { OTHER: "admin" } },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      for (const [o, code] of [[org, `zz-o-${tag}`], [other, `zz-p-${tag}`]]) {
        await tx`INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (${o}, ${`Org ${code}`}, ${code}, ${now}, ${now})`;
        await tx`SELECT tenancy_seed_organization(${o}, ${source})`;
      }
      for (const [key, w] of Object.entries(ws)) {
        await tx`INSERT INTO workspaces (id, organization_id, name, key, created_at, updated_at)
                 VALUES (${w}, ${key === "OTHER" ? other : org}, ${{ MKT: "Marketing", DEV: "Development", OTHER: "Other" }[key]}, ${key}, ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin, email)
                 VALUES (${id(p)}, ${id(p)}, ${`${p} person`}, 'admin', ${hash}, ${d.org}, ${d.orgAdmin}, ${`${p}-${tag}@example.test`})`;
        for (const [s, role] of Object.entries(d.spaces)) {
          await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at)
                   VALUES (${d.org}, ${ws[/** @type {keyof typeof ws} */ (s)]}, ${id(p)}, ${role}, ${now})`;
        }
      }
      // Marketing's configuration, to copy: a custom field with options and an automation rule.
      await tx`INSERT INTO custom_fields (id, organization_id, workspace_id, workspace, name, kind, created_at, updated_at)
               VALUES (${`zzcf${tag}`}, ${org}, ${ws.MKT}, 'Marketing', 'Channel', 'select', ${now}, ${now})`;
      await tx`INSERT INTO custom_field_options (id, organization_id, workspace_id, field_id, label, position)
               VALUES (${`zzop${tag}`}, ${org}, ${ws.MKT}, ${`zzcf${tag}`}, 'Email', 0)`;
      await tx`INSERT INTO automation_rules (id, organization_id, workspace_id, name, enabled, scope, scope_value, trigger, created_by, created_at, updated_at)
               VALUES (${`zzru${tag}`}, ${org}, ${ws.MKT}, 'Tag new items', 1, 'workspace', 'Marketing', 'item_created', ${id("owen")}, ${now}, ${now})`;
      await tx`INSERT INTO automation_actions (id, organization_id, workspace_id, rule_id, position, kind, field, value)
               VALUES (${`zzac${tag}`}, ${org}, ${ws.MKT}, ${`zzru${tag}`}, 0, 'set_field', 'labels', 'new')`;
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);
    // Sign-in opens the first workspace by name (Development); wanda and owen work in Marketing.
    for (const p of ["wanda", "owen"]) await as(p, "/api/me/workspace", { method: "POST", body: { workspaceId: ws.MKT } });
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    // Deleting the test organisations is itself the deletion path (tenancy_purge_organization).
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${org}, ${other})`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("a Viewer reads but changes nothing except their own account", async () => {
    const data = await as("vic", "/api/data");
    expect(data.status).toBe(200);
    expect(data.data.permissions).toEqual([]);
    const project = await as("vic", "/api/systems", { method: "POST", body: { name: "Not allowed", startedAt: "2026-11-01", key: "NOPE" } });
    expect(project.status).toBe(403);
    expect(project.data.code).toBe("read_only");
    const req = await as("vic", "/api/requests", { method: "POST", body: { systemId: "x", message: "hello" } });
    expect(req.data.code).toBe("read_only");
    // Reads sent as POST, and their own account, still work.
    expect((await as("vic", "/api/search", { method: "POST", body: { pql: "" } })).data?.code).not.toBe("read_only");
    expect((await as("vic", "/api/me/prefs", { method: "PUT", body: { theme: "light" } })).status).toBe(200);
  }, SLOW);

  it("a Viewer can't be assigned work, and the role-permission matrix can't give them anything", async () => {
    const sys = await as("wanda", "/api/systems", { method: "POST", body: { name: `Campaigns ${tag}`, startedAt: "2026-11-01", key: "CAMP" } });
    expect(sys.status, JSON.stringify(sys.data)).toBeLessThan(300);
    const [{ id: project }] = await db`SELECT id FROM systems WHERE workspace_id = ${ws.MKT}`;
    const item = await as("wanda", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: "Launch post", assignee: id("vic") } });
    expect(item.status).toBe(400);
    const roles = await as("owen", "/api/roles", { method: "PUT", body: { reader: ["create_work_items"], developer: ["create_work_items", "log_time"] } });
    expect(roles.status).toBe(200);
    expect(roles.data.reader).toEqual([]);
    const [entry] = await db`SELECT before, after, workspace_id FROM audit_log WHERE organization_id = ${org} AND action = 'role_permissions_updated'`;
    expect(entry.workspace_id).toBeNull();
    expect(JSON.parse(entry.after).developer).toEqual(["create_work_items", "log_time"]);
    expect(JSON.parse(entry.before).developer).toContain("edit_assigned");
  }, SLOW);

  it("Marketing and Development don't see each other's work, even for someone in both", async () => {
    const [{ id: project }] = await db`SELECT id FROM systems WHERE workspace_id = ${ws.MKT}`;
    const item = await as("wanda", "/api/items", { method: "POST", body: { systemId: project, type: "TASK", summary: `Marketing only ${tag}` } });
    expect(item.status).toBe(201);
    // owen opens Development: Marketing's item is not there, by key or in lists, and can't be changed.
    expect((await as("owen", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } })).status).toBe(200);
    expect((await as("owen", `/api/items/${item.data.key}`)).status).toBe(404);
    expect((await as("owen", `/api/items/${item.data.key}`, { method: "PATCH", body: { summary: "Hijacked" } })).status).toBe(404);
    expect(JSON.stringify((await as("owen", "/api/items?limit=100")).data)).not.toContain(`Marketing only ${tag}`);
    expect((await as("owen", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.MKT } })).status).toBe(200);
  }, SLOW);

  it("only Organisation Administrators reach organisation administration, and only their own organisation", async () => {
    for (const who of ["wanda", "vic"]) {
      expect((await as(who, "/api/org/profile")).status).toBe(403);
      expect((await as(who, "/api/org/invites", { method: "POST", body: {} })).status).toBe(403);
      expect((await as(who, "/api/org/audit")).status).toBe(403);
    }
    // The other organisation's administrator can't touch this one's people or workspaces: they don't exist for them.
    expect((await as("pat", `/api/org/people/${id("wanda")}/deactivate`, { method: "POST" })).status).toBe(404);
    expect((await as("pat", `/api/org/workspaces/${ws.MKT}`, { method: "PATCH", body: { name: "Mine now" } })).status).toBe(404);
    expect((await as("pat", "/api/org/workspaces", { method: "POST", body: { name: "Copy", key: "COPY", cloneFrom: ws.MKT } })).status).toBe(404);
  }, SLOW);

  it("the organisation profile: colour, time zone, working hours and a logo, recorded with before and after", async () => {
    expect((await as("owen", "/api/org/profile", { method: "PUT", body: { timeZone: "Mars/Olympus" } })).status).toBe(400);
    expect((await as("owen", "/api/org/profile", { method: "PUT", body: { logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } })).status).toBe(400);
    expect((await as("owen", "/api/org/profile", { method: "PUT", body: { workStart: "17:00", workEnd: "08:00" } })).status).toBe(400);
    const saved = await as("owen", "/api/org/profile", { method: "PUT", body: { colour: "#1F6FEB", timeZone: "Europe/London", workDays: [1, 2, 3, 4], workStart: "09:00", workEnd: "17:30", contactEmail: "ops@example.test", logo: PNG } });
    expect(saved.status, JSON.stringify(saved.data)).toBe(200);
    expect(saved.data.profile).toMatchObject({ colour: "#1f6feb", timeZone: "Europe/London", workDays: [1, 2, 3, 4], workStart: "09:00", workEnd: "17:30" });
    // Anyone signed in to the organisation sees the logo and colour (a Viewer too); nobody else does.
    const tenant = await as("vic", "/api/me/workspaces");
    expect(tenant.data.organization.colour).toBe("#1f6feb");
    const logo = await api.call(tenant.data.organization.logo, { cookie: cookie.vic });
    expect(logo.status).toBe(200);
    expect((await api.call("/api/org/logo")).status).toBe(401);
    expect((await as("pat", "/api/org/logo")).status).toBe(404);
    const [entry] = await db`SELECT before, after, actor_id FROM audit_log WHERE organization_id = ${org} AND action = 'organization_profile_updated'`;
    expect(entry.actor_id).toBe(id("owen"));
    expect(JSON.parse(entry.before)).toMatchObject({ timeZone: "Africa/Harare", workStart: "08:00", logo: "none" });
    expect(JSON.parse(entry.after)).toMatchObject({ timeZone: "Europe/London", workStart: "09:00", logo: "replaced" });
    expect(entry.after).not.toContain("base64");
  }, SLOW);

  it("invites someone by email: they choose a password with the link, then sign in", async () => {
    const email = `nia-${tag}@example.test`;
    const r = await as("owen", "/api/org/invites", { method: "POST", body: { email, name: "Nia Invited", workspaces: [{ workspaceId: ws.DEV, role: "Developer" }] } });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    // Email isn't set up in tests, so the link comes back for the administrator to pass on.
    expect(r.data.emailed).toBe(false);
    expect(r.data.username).toBe(`nia-${tag}`);
    const token = r.data.link.split("/reset-password/")[1];
    expect((await as("owen", "/api/org/invites", { method: "POST", body: { email, name: "Again", workspaces: [{ workspaceId: ws.DEV, role: "developer" }] } })).status).toBe(409);
    const listed = (await as("owen", "/api/org")).data.people.find((/** @type {any} */ p) => p.id === r.data.id);
    expect(listed.invited).toBe("pending");
    expect((await api.call("/api/password/reset/check", { method: "POST", body: { token } })).data.username).toBe(r.data.username);
    expect((await api.call("/api/password/reset", { method: "POST", body: { token, password: NEW_PASSWORD } })).status).toBe(200);
    expect((await api.call("/api/password/reset", { method: "POST", body: { token, password: NEW_PASSWORD } })).status).toBe(400);
    const login = await api.call("/api/login", { method: "POST", body: { organization: `zz-o-${tag}`, username: r.data.username, password: NEW_PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.data.workspace.id).toBe(ws.DEV);
  }, SLOW);

  it("imports people from CSV: every row is checked first, and nobody is invited if any row is wrong", async () => {
    const bad = ["email,name,workspace,role", `ann-${tag}@example.test,Ann,MKT,Developer`, `bo-${tag}@example.test,Bo,Nowhere,Developer`, `cy-${tag}@example.test,Cy,DEV,Chief`].join("\n");
    const refused = await as("owen", "/api/org/people/import", { method: "POST", body: { csv: bad } });
    expect(refused.status).toBe(400);
    expect(refused.data.problems.map((/** @type {any} */ p) => p.line)).toEqual([3, 4]);
    expect((await db`SELECT 1 FROM accounts WHERE email = ${`ann-${tag}@example.test`}`).length).toBe(0);
    const good = ["Email,Name,Title,Workspace,Role,OrgAdmin", `ann-${tag}@example.test,Ann Ade,Designer,MKT,Viewer,no`, `ann-${tag}@example.test,Ann Ade,Designer,Development,Team Leader,no`, `"bo-${tag}@example.test","Bo, the Second",,DEV;MKT,developer,`].join("\r\n");
    const check = await as("owen", "/api/org/people/import", { method: "POST", body: { csv: good, check: true } });
    expect(check.status).toBe(200);
    expect(check.data.people).toHaveLength(2);
    expect((await db`SELECT 1 FROM accounts WHERE email = ${`ann-${tag}@example.test`}`).length).toBe(0);
    const made = await as("owen", "/api/org/people/import", { method: "POST", body: { csv: good } });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    const roles = await db`SELECT a.name, m.workspace_id, m.role FROM accounts a JOIN workspace_members m ON m.user_id = a.id WHERE a.email IN (${`ann-${tag}@example.test`}, ${`bo-${tag}@example.test`}) ORDER BY a.name, m.workspace_id`;
    expect(roles.map((/** @type {any} */ r) => `${r.name}:${r.workspace_id === ws.MKT ? "MKT" : "DEV"}:${r.role}`).sort()).toEqual(
      ["Ann Ade:DEV:team_lead", "Ann Ade:MKT:reader", "Bo, the Second:DEV:developer", "Bo, the Second:MKT:developer"].sort(),
    );
  }, SLOW);

  it("deactivating ends their sessions and sign-in looks like a wrong password; reactivating lets them back", async () => {
    expect((await as("owen", `/api/org/people/${id("owen")}/deactivate`, { method: "POST" })).status).toBe(409);
    expect((await as("owen", `/api/org/people/${id("wanda")}/deactivate`, { method: "POST" })).status).toBe(200);
    expect((await as("wanda", "/api/data")).status).toBe(401);
    const off = await api.call("/api/login", { method: "POST", body: { organization: `zz-o-${tag}`, username: id("wanda"), password: PASSWORD } });
    const wrong = await api.call("/api/login", { method: "POST", body: { organization: `zz-o-${tag}`, username: id("vic"), password: "Wrong-Password-99!" } });
    expect(off.status).toBe(401);
    expect(off.data.error).toBe(wrong.data.error);
    expect((await as("owen", "/api/org")).data.people.find((/** @type {any} */ p) => p.id === id("wanda")).deactivated).toBe(true);
    // Their memberships and history stay.
    expect((await db`SELECT 1 FROM workspace_members WHERE user_id = ${id("wanda")}`).length).toBe(2);
    expect((await as("owen", `/api/org/people/${id("wanda")}/reactivate`, { method: "POST" })).status).toBe(200);
    cookie.wanda = await api.signIn(id("wanda"), PASSWORD);
    const actions = (await db`SELECT action FROM audit_log WHERE organization_id = ${org} AND target_id = ${id("wanda")} ORDER BY id`).map((/** @type {any} */ r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["person_deactivated", "person_reactivated"]));
  }, SLOW);

  it("a new workspace can copy another's configuration, without any of its work", async () => {
    const r = await as("owen", "/api/org/workspaces", { method: "POST", body: { name: "Events", key: "EVT", icon: "megaphone", colour: "#AA3366", description: "Conferences", cloneFrom: ws.MKT } });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.copied).toEqual({ workflows: 1, itemTypes: 5, fields: 1, rules: 1 });
    const id2 = r.data.workspace.id;
    // Its workflow is its own copy, not Marketing's.
    const [own] = await db`SELECT f.workspace_id FROM workspace_workflows ww JOIN workflows f ON f.organization_id = ww.organization_id AND f.id = ww.workflow_id WHERE ww.workspace_id = ${id2}`;
    expect(own.workspace_id).toBe(id2);
    const [field] = await db`SELECT f.name, (SELECT count(*)::int FROM custom_field_options o WHERE o.field_id = f.id) AS options FROM custom_fields f WHERE f.workspace_id = ${id2}`;
    expect(field).toEqual({ name: "Channel", options: 1 });
    const [rule] = await db`SELECT name, enabled, scope_value, (SELECT count(*)::int FROM automation_actions a WHERE a.rule_id = r.id) AS actions FROM automation_rules r WHERE r.workspace_id = ${id2}`;
    expect(rule).toEqual({ name: "Tag new items", enabled: 0, scope_value: "Events", actions: 1 });
    expect((await db`SELECT count(*)::int AS n FROM systems WHERE workspace_id = ${id2}`)[0].n).toBe(0);
    expect((await db`SELECT count(*)::int AS n FROM work_items WHERE workspace_id = ${id2}`)[0].n).toBe(0);
    const patched = await as("owen", `/api/org/workspaces/${id2}`, { method: "PATCH", body: { description: "Conferences and webinars" } });
    expect(patched.data.workspace).toMatchObject({ icon: "megaphone", colour: "#aa3366", description: "Conferences and webinars" });
    const [entry] = await db`SELECT before, after FROM audit_log WHERE action = 'workspace_updated' AND target_id = ${id2}`;
    expect(JSON.parse(entry.before)).toEqual({ description: "Conferences" });
    expect(JSON.parse(entry.after)).toEqual({ description: "Conferences and webinars" });
  }, SLOW);

  it("a workspace open to the organisation: anyone in it may open it, read-only", async () => {
    let list = (await as("vic", "/api/me/workspaces")).data.workspaces;
    expect(list.map((/** @type {any} */ w) => w.id)).toEqual([ws.MKT]);
    expect((await as("vic", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } })).status).toBe(404);
    await as("owen", `/api/org/workspaces/${ws.DEV}`, { method: "PATCH", body: { visibility: "organization" } });
    list = (await as("vic", "/api/me/workspaces")).data.workspaces;
    expect(list.find((/** @type {any} */ w) => w.id === ws.DEV)).toMatchObject({ role: "reader", open: true });
    // Not to the other organisation.
    expect((await as("pat", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } })).status).toBe(404);
    expect((await as("vic", "/api/me/workspace", { method: "POST", body: { workspaceId: ws.DEV } })).status).toBe(200);
    expect((await as("vic", "/api/data")).status).toBe(200);
    const [m] = await db`SELECT role FROM workspace_members WHERE workspace_id = ${ws.DEV} AND user_id = ${id("vic")}`;
    expect(m.role).toBe("reader");
    expect((await as("vic", "/api/systems", { method: "POST", body: { name: "No", startedAt: "2026-11-01", key: "NOPE" } })).data.code).toBe("read_only");
  }, SLOW);

  it("the audit log can be read but never changed, even by the database owner", async () => {
    const all = await as("owen", "/api/org/audit");
    expect(all.status).toBe(200);
    expect(all.data.entries.length).toBeGreaterThan(5);
    expect(all.data.entries.every((/** @type {any} */ e, /** @type {number} */ i, /** @type {any[]} */ a) => i === 0 || a[i - 1].id > e.id)).toBe(true);
    const mkt = await as("owen", `/api/org/audit?workspace=${ws.MKT}`);
    expect(mkt.data.entries.every((/** @type {any} */ e) => e.workspace === "Marketing")).toBe(true);
    // The other organisation sees none of these.
    expect((await as("pat", "/api/org/audit")).data.entries.some((/** @type {any} */ e) => e.actorId === id("owen"))).toBe(false);
    // A workspace's own log, for people with the audit permission there (owen is its administrator).
    expect((await as("owen", "/api/audit-log")).status).toBe(200);
    expect((await as("vic", "/api/audit-log")).status).toBe(403);
    await expect(db`UPDATE audit_log SET actor = 'someone else' WHERE organization_id = ${org}`).rejects.toThrow(/append-only/);
    await expect(db`DELETE FROM audit_log WHERE organization_id = ${org}`).rejects.toThrow(/append-only/);
  }, SLOW);

  it("deleting an organisation: only when archived and due, and it removes that organisation alone", async () => {
    const gone = `zzq${tag}`;
    const now = new Date().toISOString();
    await db`INSERT INTO organizations (id, name, code, status, created_at, updated_at) VALUES (${gone}, 'Leaving', ${`zz-q-${tag}`}, 'active', ${now}, ${now})`;
    await db`INSERT INTO workspaces (id, organization_id, name, key, created_at, updated_at) VALUES (${`${gone}w`}, ${gone}, 'Only', 'ONLY', ${now}, ${now})`;
    await db`INSERT INTO accounts (id, username, name, role, password_hash, organization_id) VALUES (${`${gone}u`}, 'leaver', 'Leaver', 'admin', 'x', ${gone})`;
    await db`INSERT INTO audit_log (organization_id, at, actor, action, target_type) VALUES (${gone}, ${now}, 'x', 'test', 'organization')`;
    await expect(db`SELECT tenancy_purge_organization(${gone})`).rejects.toThrow(/not due/);
    await db`UPDATE organizations SET status = 'archived', delete_after = '2099-01-01T00:00:00.000Z' WHERE id = ${gone}`;
    expect(await purgeDueOrganizations(backend.root)).toBe(0);
    await db`UPDATE organizations SET delete_after = '2000-01-01T00:00:00.000Z' WHERE id = ${gone}`;
    expect(await purgeDueOrganizations(backend.root)).toBe(1);
    for (const t of ["organizations", "workspaces", "accounts", "audit_log"]) {
      const col = t === "organizations" ? "id" : "organization_id";
      expect((await db.unsafe(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = '${gone}'`))[0].n, t).toBe(0);
    }
    expect((await db`SELECT count(*)::int AS n FROM platform_activity WHERE action = 'organization_deleted' AND target = ${gone}`)[0].n).toBe(1);
    // The others are untouched.
    expect((await db`SELECT count(*)::int AS n FROM accounts WHERE organization_id = ${org}`)[0].n).toBeGreaterThan(3);
    expect((await db`SELECT count(*)::int AS n FROM audit_log WHERE organization_id = ${org}`)[0].n).toBeGreaterThan(5);
  }, SLOW);
});
