// Multi-tenancy, phase (e): what reaches outside PMS stays in one workspace. The executive page is a secret
// link per workspace; GitHub deliveries belong to the workspace whose secret signed them; Ask AI and the Monday
// Briefing name the right organisation and workspace.
// Runs on PGlite by default (npm test), or the Neon dev branch with PMS_DB=dev.
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { hashPassword } from "../src/auth.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASS = "Integration-Check-Pass-5!";

describe("multi-tenancy: links, GitHub, Ask AI and the briefing", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = { A: `zza${tag}`, B: `zzb${tag}` };
  const ws = { A1: `zza1${tag}`, A2: `zza2${tag}`, B1: `zzb1${tag}` };
  /** @type {Record<string, string>} */ const cookie = {};

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASS);
    await db.begin(async (/** @type {any} */ tx) => {
      for (const [k, o] of Object.entries(org)) {
        await tx`INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (${o}, ${`Org ${k} ${tag}`}, ${`zz-${k.toLowerCase()}-${tag}`}, ${now}, ${now})`;
        await tx`SELECT tenancy_seed_organization(${o}, 'pulse-template')`;
      }
      for (const [k, w] of Object.entries(ws)) {
        await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (${w}, ${org[/** @type {"A" | "B"} */ (k[0])]}, ${`Space ${k} ${tag}`}, ${`WS${k}`}, ${Number(k[1])}, ${now}, ${now})`;
      }
      for (const [who, o, spaces] of /** @type {const} */ ([
        ["ann", "A", ["A1", "A2"]],
        ["ben", "B", ["B1"]],
      ])) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin) VALUES (${`${who}-${tag}`}, ${`${who}-${tag}`}, ${`${who} ${tag}`}, 'admin', ${hash}, ${org[o]}, 1)`;
        for (const s of spaces) await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${org[o]}, ${ws[s]}, ${`${who}-${tag}`}, 'admin', ${now})`;
      }
    });
    api = workerClient(backend);
    cookie.ann = await api.signIn(`ann-${tag}`, PASS); // opens A1
    cookie.ben = await api.signIn(`ben-${tag}`, PASS);
    // A1: two projects, one keyed SAME. B1: a project keyed SAME too. A2: one project.
    for (const [c, name, key] of [
      [cookie.ann, `Alpha ${tag}`, "SAME"],
      [cookie.ann, `Beta ${tag}`, "BETA"],
      [cookie.ben, `Bravo ${tag}`, "SAME"],
    ]) {
      const r = await api.call("/api/systems", { method: "POST", cookie: c, body: { name, startedAt: "2026-11-01", key } });
      if (r.status >= 300) throw new Error(JSON.stringify(r.data));
    }
    for (const [c, w] of [
      [cookie.ann, ws.A1],
      [cookie.ben, ws.B1],
    ]) {
      const [{ id }] = await db`SELECT id FROM systems WHERE workspace_id = ${w} AND key = 'SAME'`;
      await api.call("/api/items", { method: "POST", cookie: c, body: { systemId: id, type: "TASK", summary: `Task in ${w}` } });
    }
    await api.call("/api/me/workspace", { method: "POST", cookie: cookie.ann, body: { workspaceId: ws.A2 } });
    await api.call("/api/systems", { method: "POST", cookie: cookie.ann, body: { name: `Gamma ${tag}`, startedAt: "2026-11-01", key: "GAMMA" } });
    await api.call("/api/me/workspace", { method: "POST", cookie: cookie.ann, body: { workspaceId: ws.A1 } });
  }, SLOW);
  afterAll(async () => {
    await backend?.close();
  });

  it("an executive page link shows its own workspace's totals only, and no names", async () => {
    const made = await api.call("/api/showcase-links", { method: "POST", cookie: cookie.ann, body: { label: "Exco", days: 30 } });
    expect(made.status).toBe(201);
    const token = String(made.data.url).split("/executive/")[1];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const page = await api.call("/api/showcase", { headers: { "x-showcase-token": token } });
    expect(page.status).toBe(200);
    expect(page.data.workspace).toBe(`Space A1 ${tag}`);
    expect(page.data.organization).toBe(`Org A ${tag}`);
    expect(JSON.stringify(page.data)).not.toMatch(/Alpha|Beta|Gamma|Bravo/);
    // The totals are A1's: two projects. (A2's and B1's aren't counted.)
    expect(JSON.stringify(page.data)).toMatch(/"total":2\b|"projects":2\b|"systems":2\b/);
    const list = await api.call("/api/showcase-links", { cookie: cookie.ben });
    expect(list.data).toEqual([]);
  }, SLOW);

  it("no link, a wrong one, a revoked one or a suspended organisation's all get the same 404", async () => {
    const made = await api.call("/api/showcase-links", { method: "POST", cookie: cookie.ann, body: { label: "Board", days: 7 } });
    const token = String(made.data.url).split("/executive/")[1];
    const replies = [];
    replies.push(await api.call("/api/showcase"));
    replies.push(await api.call("/api/showcase", { headers: { "x-showcase-token": "f".repeat(64) } }));
    await api.call(`/api/showcase-links/${made.data.id}`, { method: "DELETE", cookie: cookie.ann });
    replies.push(await api.call("/api/showcase", { headers: { "x-showcase-token": token } }));
    const other = await api.call("/api/showcase-links", { method: "POST", cookie: cookie.ben, body: { label: "B", days: 7 } });
    await db`UPDATE organizations SET status = 'suspended' WHERE id = ${org.B}`;
    replies.push(await api.call("/api/showcase", { headers: { "x-showcase-token": String(other.data.url).split("/executive/")[1] } }));
    await db`UPDATE organizations SET status = 'active' WHERE id = ${org.B}`;
    for (const r of replies) expect(r.status).toBe(404);
    expect(new Set(replies.map((r) => r.data.error)).size).toBe(1);
    // Another workspace's link can't be revoked from here.
    expect((await api.call(`/api/showcase-links/${other.data.id}`, { method: "DELETE", cookie: cookie.ann })).status).toBe(404);
  }, SLOW);

  it("Ask AI is told the organisation and workspace, and never another organisation's name", async () => {
    api.aiInputs.length = 0;
    await api.call("/api/ask", { method: "POST", cookie: cookie.ann, body: { question: "What's going on?" } });
    const told = JSON.stringify(api.aiInputs);
    expect(told).toContain(`ORGANISATION: Org A ${tag} · WORKSPACE: Space A1 ${tag}`);
    expect(told).not.toContain("Omni Contact");
    expect(told).not.toContain(`Org B ${tag}`);
  }, SLOW);

  it("GitHub: each workspace needs its own secret, and a delivery links only to the signing workspace's items", async () => {
    const secret = `github-secret-${tag}-abcdefghij`;
    expect((await api.call("/api/integrations/github", { method: "PUT", cookie: cookie.ann, body: { secret } })).status).toBe(200);
    const same = await api.call("/api/integrations/github", { method: "PUT", cookie: cookie.ben, body: { secret } });
    expect(same.status).toBe(409);
    expect((await api.call("/api/integrations/github", { method: "PUT", cookie: cookie.ben, body: { secret: `${secret}-b` } })).status).toBe(200);
    // A push mentioning SAME-1 (an item key in both organisations), signed with A1's secret.
    const payload = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/app", html_url: "https://github.com/acme/app" }, commits: [{ id: "a".repeat(40), message: "SAME-1 fix the login", url: "https://github.com/acme/app/commit/a", author: { name: "Dev" } }] });
    const sign = (/** @type {string} */ s) => `sha256=${createHmac("sha256", s).update(payload).digest("hex")}`;
    const send = (/** @type {string} */ sig, /** @type {string} */ id) => api.call("/api/integrations/github/webhook", { method: "POST", body: JSON.parse(payload), headers: { "x-hub-signature-256": sig, "x-github-event": "push", "x-github-delivery": id } });
    expect((await send(sign(secret), `d1-${tag}`)).status).toBe(200);
    const links = await db`SELECT workspace_id FROM dev_links WHERE ref = ${"a".repeat(40)}`;
    expect(links.map((/** @type {{ workspace_id: string }} */ l) => l.workspace_id)).toEqual([ws.A1]);
    expect((await send(sign("not-anyones-secret-at-all"), `d2-${tag}`)).status).toBe(401);
  }, SLOW);

  it("the Monday Briefing goes out per workspace, named for it, from the hourly cron", async () => {
    // Monday 08:00 in Harare (06:00 UTC).
    const monday = new Date("2026-11-30T06:00:00Z").getTime();
    const env = /** @type {any} */ ({ PG_ROOT: api.root, DATABASE: "postgres", AI: { run: async () => ({ response: "" }) }, MFA_KEY: "test-only-key", PUBLIC_URL: "http://localhost" });
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: monday }, env);
    const titles = await db`SELECT n.title, n.workspace_id FROM notifications n WHERE n.kind = 'monday_briefing' AND n.user_id = ${`ann-${tag}`} ORDER BY n.title`;
    expect(titles.map((/** @type {{ title: string }} */ t) => t.title.split(":")[0])).toEqual([`Monday Briefing for Space A1 ${tag}`, `Monday Briefing for Space A2 ${tag}`]);
    for (const t of titles) expect(t.title).toContain(t.workspace_id === ws.A1 ? "Space A1" : "Space A2");
    const bens = await db`SELECT title FROM notifications WHERE kind = 'monday_briefing' AND user_id = ${`ben-${tag}`}`;
    expect(bens.map((/** @type {{ title: string }} */ t) => t.title)).toEqual([expect.stringContaining(`Space B1 ${tag}`)]);
  }, SLOW);
});
