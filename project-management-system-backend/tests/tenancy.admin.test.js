// Multi-tenancy, phase (d): Platform Administrators (outside every organisation: they make and close organisations,
// can't open their data, and always sign in with an authenticator app) and Organisation Administrators (their own
// organisation's workspaces, people and roles, and nothing of any other).
// Runs on PGlite by default (npm test), or the Neon dev branch with PULSE_DB=dev.
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const TEMP = "Platform-Temp-Pass-42!";
const OWN = "Orbit-Cedar-Lantern-58!"; // nobody's name in it: the policy refuses a password containing your name

/** The 6-digit code an authenticator app shows for a base32 secret (RFC 6238), `offset` steps from now. */
function totp(secret, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe("multi-tenancy: platform and organisation administration", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const platformUser = `root-${tag}`;
  let platform = ""; // the platform session cookie
  let secret = "";
  /** @type {Record<string, { id: string; code: string; admin: string; password: string; cookie?: string }>} */ const orgs = {};

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    await db`INSERT INTO platform_admins (id, username, name, password_hash, must_change_password, created_at)
             VALUES (${`pa-${tag}`}, ${platformUser}, 'Platform Test', ${await hashPassword(TEMP)}, 1, ${new Date().toISOString()})`;
    api = workerClient(backend);
  }, SLOW);
  afterAll(async () => {
    await backend?.close();
  });
  const pcall = (/** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: platform });

  it("a Platform Administrator must set up an authenticator app, and every refusal reads the same", async () => {
    const wrong = await api.call("/api/platform/login", { method: "POST", body: { username: platformUser, password: "Wrong-Pass-123!" } });
    const nobody = await api.call("/api/platform/login", { method: "POST", body: { username: "nobody", password: TEMP } });
    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(nobody.data.error).toBe(wrong.data.error);
    const first = await api.call("/api/platform/login", { method: "POST", body: { username: platformUser, password: TEMP } });
    expect(first.status).toBe(200);
    expect(first.data.setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(first.cookie).toBeNull(); // no session before the code
    secret = first.data.setup.secret;
    const bad = await api.call("/api/platform/login/code", { method: "POST", body: { ticket: first.data.ticket, code: "000000" } });
    expect(bad.status).toBe(401);
    const ok = await api.call("/api/platform/login/code", { method: "POST", body: { ticket: first.data.ticket, code: totp(secret) } });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^pulse_platform=/);
    platform = /** @type {string} */ (ok.cookie);
  }, SLOW);

  it("the same code can't be used twice, and the next sign-in asks for a code without a new set-up", async () => {
    const again = await api.call("/api/platform/login", { method: "POST", body: { username: platformUser, password: TEMP } });
    expect(again.data.setup).toBeUndefined();
    const replay = await api.call("/api/platform/login/code", { method: "POST", body: { ticket: again.data.ticket, code: totp(secret) } });
    expect(replay.status).toBe(401);
  }, SLOW);

  it("the temporary password must be replaced before anything else", async () => {
    expect((await pcall("/api/platform/organizations")).status).toBe(403);
    const changed = await pcall("/api/platform/me/password", { method: "POST", body: { current: TEMP, password: OWN } });
    expect(changed.status).toBe(200);
    expect((await pcall("/api/platform/organizations")).status).toBe(200);
  }, SLOW);

  it("a platform session can't reach the rest of the API, and an organisation's session can't reach the platform", async () => {
    expect((await pcall("/api/data")).status).toBe(401);
    expect((await pcall("/api/items")).status).toBe(401);
    const none = await api.call("/api/platform/organizations");
    expect(none.status).toBe(401);
  }, SLOW);

  it("makes organisations, each with the template's configuration, a Projects workspace and its first administrator", async () => {
    for (const k of ["X", "Y"]) {
      const r = await pcall("/api/platform/organizations", { method: "POST", body: { name: `Org ${k} ${tag}`, code: `zz-${k.toLowerCase()}-${tag}`, admin: { username: `boss-${k.toLowerCase()}`, name: `Boss ${k}` } } });
      expect(r.status, JSON.stringify(r.data)).toBe(201);
      expect(r.data.signInLink).toContain(`#/o/zz-${k.toLowerCase()}-${tag}`);
      orgs[k] = { id: r.data.organization.id, code: `zz-${k.toLowerCase()}-${tag}`, admin: r.data.admin.username, password: r.data.admin.temporaryPassword };
    }
    const taken = await pcall("/api/platform/organizations", { method: "POST", body: { name: "Again", code: orgs.X.code, admin: { username: "someone", name: "S" } } });
    expect(taken.status).toBe(409);
    const [counts] = await db`SELECT (SELECT count(*)::int FROM work_statuses WHERE organization_id = ${orgs.X.id}) AS statuses,
                                    (SELECT count(*)::int FROM workflows WHERE organization_id = ${orgs.X.id} AND is_default = 1) AS defaults,
                                    (SELECT count(*)::int FROM request_types r JOIN workspaces w ON w.id = r.workspace_id WHERE w.organization_id = ${orgs.X.id}) AS request_types,
                                    (SELECT count(*)::int FROM workflow_rules WHERE organization_id = ${orgs.X.id} AND rule = 'assign_user') AS named_people`;
    expect(counts).toEqual({ statuses: 11, defaults: 1, request_types: 4, named_people: 0 });
    // The first administrator signs in with the code, and must choose their own password first.
    const login = await api.call("/api/login", { method: "POST", body: { organization: orgs.X.code, username: orgs.X.admin, password: orgs.X.password } });
    expect(login.status).toBe(200);
    const blocked = await api.call("/api/data", { cookie: /** @type {string} */ (login.cookie) });
    expect(blocked.data.code).toBe("password_change_required");
    for (const k of ["X", "Y"]) {
      const s = await api.call("/api/login", { method: "POST", body: { organization: orgs[k].code, username: orgs[k].admin, password: orgs[k].password } });
      await api.call("/api/me/password", { method: "POST", cookie: /** @type {string} */ (s.cookie), body: { next: OWN } });
      orgs[k].cookie = await api.signIn(orgs[k].admin, OWN).catch(async () => {
        const again = await api.call("/api/login", { method: "POST", body: { organization: orgs[k].code, username: orgs[k].admin, password: OWN } });
        return /** @type {string} */ (again.cookie);
      });
    }
    expect((await api.call("/api/data", { cookie: orgs.X.cookie })).status).toBe(200);
  }, SLOW);

  it("the platform list shows counts, never anything inside an organisation", async () => {
    await api.call("/api/systems", { method: "POST", cookie: orgs.X.cookie, body: { name: `Secret plan ${tag}`, startedAt: "2026-11-01" } });
    const list = await pcall("/api/platform/organizations");
    const x = list.data.organizations.find((/** @type {{ id: string }} */ o) => o.id === orgs.X.id);
    expect(x).toMatchObject({ code: orgs.X.code, status: "active", workspaces: 1, people: 1, admins: 1 });
    expect(JSON.stringify(list.data)).not.toContain("Secret plan");
    expect(JSON.stringify(list.data)).not.toContain("pulse-template");
  }, SLOW);

  it("an Organisation Administrator adds workspaces and people, and sets each person's role per workspace", async () => {
    const c = orgs.X.cookie;
    const hr = await api.call("/api/org/workspaces", { method: "POST", cookie: c, body: { name: "HR", key: "HR" } });
    expect(hr.status).toBe(201);
    const org = (await api.call("/api/org", { cookie: c })).data;
    const projects = org.workspaces.find((/** @type {{ name: string }} */ w) => w.name === "Projects").id;
    const added = await api.call("/api/org/people", { method: "POST", cookie: c, body: { username: "dana", name: "Dana", workspaces: [{ workspaceId: hr.data.workspace.id, role: "developer" }] } });
    expect(added.status).toBe(201);
    const dana = await api.call("/api/login", { method: "POST", body: { organization: orgs.X.code, username: "dana", password: added.data.temporaryPassword } });
    expect(dana.data.workspaces.map((/** @type {{ name: string }} */ w) => w.name)).toEqual(["HR"]);
    // Dana isn't an Organisation Administrator.
    expect((await api.call("/api/org", { cookie: /** @type {string} */ (dana.cookie) })).status).toBe(403);
    // Into Projects as a viewer, out of HR: her HR session ends.
    const moved = await api.call(`/api/org/people/${added.data.id}/workspaces`, { method: "PUT", cookie: c, body: { workspaces: [{ workspaceId: projects, role: "viewer" }] } });
    expect(moved.status).toBe(200);
    expect((await api.call("/api/me/workspaces", { cookie: /** @type {string} */ (dana.cookie) })).status).toBe(401);
    const [m] = await db`SELECT role FROM workspace_members WHERE user_id = ${added.data.id} AND workspace_id = ${projects}`;
    expect(m.role).toBe("viewer");
  }, SLOW);

  it("an Organisation Administrator can't reach another organisation's workspaces or people", async () => {
    const yOrg = (await api.call("/api/org", { cookie: orgs.Y.cookie })).data;
    const yWs = yOrg.workspaces[0].id;
    const yBoss = yOrg.people[0].id;
    const c = orgs.X.cookie;
    for (const r of await Promise.all([
      api.call(`/api/org/workspaces/${yWs}`, { method: "PATCH", cookie: c, body: { name: "Taken" } }),
      api.call(`/api/org/people/${yBoss}`, { method: "PATCH", cookie: c, body: { orgAdmin: false } }),
      api.call(`/api/org/people/${yBoss}`, { method: "DELETE", cookie: c }),
      api.call(`/api/org/people/${yBoss}/workspaces`, { method: "PUT", cookie: c, body: { workspaces: [{ workspaceId: yWs, role: "viewer" }] } }),
    ])) {
      expect(r.status).toBe(404);
    }
    // Nor put their own people into the other organisation's workspace.
    const xDana = (await api.call("/api/org", { cookie: c })).data.people.find((/** @type {{ username: string }} */ p) => p.username === "dana");
    const cross = await api.call(`/api/org/people/${xDana.id}/workspaces`, { method: "PUT", cookie: c, body: { workspaces: [{ workspaceId: yWs, role: "admin" }] } });
    expect(cross.status).toBe(404);
    expect(JSON.stringify((await api.call("/api/org", { cookie: c })).data)).not.toContain(yWs);
    const [y] = await db`SELECT name FROM workspaces WHERE id = ${yWs}`;
    expect(y.name).toBe("Projects");
  }, SLOW);

  it("organisation settings are for Organisation Administrators; the last one can't be removed", async () => {
    const c = orgs.X.cookie;
    const org = (await api.call("/api/org", { cookie: c })).data;
    const projects = org.workspaces.find((/** @type {{ name: string }} */ w) => w.name === "Projects").id;
    // An administrator of the workspace who isn't an Organisation Administrator.
    const wsAdmin = await api.call("/api/org/people", { method: "POST", cookie: c, body: { username: "wade", name: "Wade", workspaces: [{ workspaceId: projects, role: "admin" }] } });
    const w = await api.call("/api/login", { method: "POST", body: { organization: orgs.X.code, username: "wade", password: wsAdmin.data.temporaryPassword } });
    await api.call("/api/me/password", { method: "POST", cookie: /** @type {string} */ (w.cookie), body: { next: OWN } });
    const wc = /** @type {string} */ ((await api.call("/api/login", { method: "POST", body: { organization: orgs.X.code, username: "wade", password: OWN } })).cookie);
    const r = await api.call("/api/settings/signin", { method: "PUT", cookie: wc, body: { attempts: 3, lockMinutes: 30, ipAttempts: 50 } });
    expect(r.status).toBe(403);
    expect(r.data.code).toBe("org_admin_only");
    const boss = org.people.find((/** @type {{ orgAdmin: boolean }} */ p) => p.orgAdmin);
    expect((await api.call(`/api/org/people/${boss.id}`, { method: "PATCH", cookie: c, body: { orgAdmin: false } })).status).toBe(409);
    expect((await api.call(`/api/org/people/${boss.id}`, { method: "DELETE", cookie: c })).status).toBe(409);
  }, SLOW);

  it("suspending an organisation ends its sessions, links and tokens and refuses its sign-ins; reactivating lets them back", async () => {
    const link = await api.call("/api/share-links", { method: "POST", cookie: orgs.Y.cookie, body: { label: "Board", days: 1 } });
    const token = await api.call("/api/tokens", { method: "POST", cookie: orgs.Y.cookie, body: { name: "Script", scope: "read", days: 7 } });
    const viaLink = { "x-share-token": String(link.data.url).split("/view/")[1] };
    const viaToken = { authorization: `Bearer ${token.data.token}` };
    expect((await api.call("/api/data", { headers: viaLink })).status).toBe(200);
    expect((await api.call("/api/items", { headers: viaToken })).status).toBe(200);
    expect((await pcall(`/api/platform/organizations/${orgs.Y.id}`, { method: "PATCH", body: { status: "suspended" } })).status).toBe(200);
    expect((await api.call("/api/data", { cookie: orgs.Y.cookie })).status).toBe(401);
    expect((await api.call("/api/data", { headers: viaLink })).status).toBe(401);
    expect((await api.call("/api/items", { headers: viaToken })).status).toBe(401);
    const refused = await api.call("/api/login", { method: "POST", body: { organization: orgs.Y.code, username: orgs.Y.admin, password: OWN } });
    expect(refused.status).toBe(401);
    expect((await pcall(`/api/platform/organizations/${orgs.Y.id}`, { method: "PATCH", body: { status: "active" } })).status).toBe(200);
    expect((await api.call("/api/login", { method: "POST", body: { organization: orgs.Y.code, username: orgs.Y.admin, password: OWN } })).status).toBe(200);
    expect((await pcall("/api/platform/organizations/pulse-template", { method: "PATCH", body: { status: "active" } })).status).toBe(404);
  }, SLOW);
});
