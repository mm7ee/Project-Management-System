// Multi-tenancy, phase (c): signing in to an organisation. The organisation code decides whose account a username
// is; nothing before a correct sign-in says whether an organisation, a username or a workspace exists.
// Runs on PGlite by default (npm test), or the Neon dev branch with PMS_DB=dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASS_A = "Signin-Check-Alpha-7!";
const PASS_B = "Signin-Check-Bravo-7!";

describe("multi-tenancy: signing in to an organisation", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const org = { A: `zza${tag}`, B: `zzb${tag}`, S: `zzs${tag}` };
  const code = { A: `zz-a-${tag}`, B: `zz-b-${tag}`, S: `zz-s-${tag}` };
  const ws = { A1: `zza1${tag}`, A2: `zza2${tag}`, B1: `zzb1${tag}`, S1: `zzs1${tag}` };
  const sam = `sam-${tag}`; // the same username in organisations A, B and S
  /** The refusal for a wrong password: every other refusal must read exactly the same. */
  let refusal = "";

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const now = new Date().toISOString();
    const [hashA, hashB] = await Promise.all([hashPassword(PASS_A), hashPassword(PASS_B)]);
    await db.begin(async (/** @type {any} */ tx) => {
      for (const [k, o] of Object.entries(org)) {
        await tx`INSERT INTO organizations (id, name, code, status, created_at, updated_at)
                 VALUES (${o}, ${`Sign-in org ${k}`}, ${code[/** @type {keyof typeof code} */ (k)]}, ${k === "S" ? "suspended" : "active"}, ${now}, ${now})`;
      }
      for (const [k, w] of Object.entries(ws)) {
        await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at)
                 VALUES (${w}, ${org[/** @type {"A" | "B" | "S"} */ (k[0])]}, ${`Space ${k}`}, ${`WS${k}`}, ${Number(k[1])}, ${now}, ${now})`;
      }
      // sam: in A (two workspaces, password A), in B (one, password B) and in the suspended S (password A).
      for (const [o, hash, spaces] of /** @type {const} */ ([
        ["A", hashA, ["A1", "A2"]],
        ["B", hashB, ["B1"]],
        ["S", hashA, ["S1"]],
      ])) {
        const id = `${sam}-${o.toLowerCase()}`;
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id) VALUES (${id}, ${sam}, ${`Sam ${o}`}, 'admin', ${hash}, ${org[o]})`;
        for (const s of spaces) await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${org[o]}, ${ws[s]}, ${id}, 'admin', ${now})`;
      }
      // nell: in A, but in no workspace.
      await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id) VALUES (${`nell-${tag}`}, ${`nell-${tag}`}, 'Nell', 'viewer', ${hashA}, ${org.A})`;
    });
    api = workerClient(backend);
    const wrong = await api.call("/api/login", { method: "POST", body: { organization: code.A, username: sam, password: "Not-The-Password-1!" } });
    expect(wrong.status).toBe(401);
    refusal = wrong.data.error;
  }, SLOW);

  afterAll(async () => {
    await backend?.close();
  });

  const login = (/** @type {Record<string, string>} */ b) => api.call("/api/login", { method: "POST", body: b });

  it("the organisation code decides whose account a username is", async () => {
    const a = await login({ organization: code.A, username: sam, password: PASS_A });
    expect(a.status).toBe(200);
    expect(a.cookie).toBeTruthy();
    const b = await login({ organization: code.B, username: sam, password: PASS_B });
    expect(b.status).toBe(200);
    const asA = await api.call("/api/me/workspaces", { cookie: /** @type {string} */ (a.cookie) });
    const asB = await api.call("/api/me/workspaces", { cookie: /** @type {string} */ (b.cookie) });
    expect(asA.data.organization.id).toBe(org.A);
    expect(asB.data.organization.id).toBe(org.B);
  }, SLOW);

  it("codes are matched whatever their capitals and spaces", async () => {
    expect((await login({ organization: `  ${code.B.toUpperCase()} `, username: sam, password: PASS_B })).status).toBe(200);
  }, SLOW);

  it("every refusal reads the same: wrong organisation, unknown or suspended organisation, shared username without a code", async () => {
    for (const body of [
      { organization: code.B, username: sam, password: PASS_A }, // A's password, B's organisation
      { organization: "no-such-org", username: sam, password: PASS_A },
      { organization: code.S, username: sam, password: PASS_A }, // suspended
      { username: sam, password: PASS_A }, // no code: sam is in two active organisations
      { organization: "Not a code!", username: sam, password: PASS_A },
      { organization: code.A, username: "nobody-here", password: PASS_A },
    ]) {
      const r = await login(body);
      expect(r.status, JSON.stringify(body)).toBe(401);
      expect(r.data.error, JSON.stringify(body)).toBe(refusal);
      expect(r.cookie).toBeNull();
      expect(JSON.stringify(r.data)).not.toMatch(/workspace|Space A|Sign-in org/i);
    }
  }, SLOW);

  it("the workspaces are only shown after a correct sign-in, and only your own", async () => {
    const r = await login({ organization: code.A, username: sam, password: PASS_A });
    expect(r.data.workspaces.map((/** @type {{ id: string }} */ w) => w.id)).toEqual([ws.A1, ws.A2]);
    expect(JSON.stringify(r.data)).not.toContain(ws.B1);
  }, SLOW);

  it("someone in no workspace is told so, after the right password only", async () => {
    const right = await login({ organization: code.A, username: `nell-${tag}`, password: PASS_A });
    expect(right.status).toBe(403);
    expect(right.data.code).toBe("no_workspace");
    expect(right.cookie).toBeNull();
    const wrong = await login({ organization: code.A, username: `nell-${tag}`, password: PASS_B });
    expect(wrong.status).toBe(401);
    expect(wrong.data.error).toBe(refusal);
  }, SLOW);

  it("forgot password replies the same whatever the organisation or name", async () => {
    const replies = [];
    for (const body of [
      { organization: code.A, login: sam },
      { organization: "no-such-org", login: sam },
      { organization: code.S, login: sam },
      { login: sam },
      { organization: code.B, login: "nobody-here" },
    ]) {
      const r = await api.call("/api/password/forgot", { method: "POST", body });
      expect(r.status).toBe(200);
      replies.push(JSON.stringify(r.data));
    }
    expect(new Set(replies).size).toBe(1);
  }, SLOW);

  it("a session in a suspended organisation stops working", async () => {
    const r = await login({ organization: code.B, username: sam, password: PASS_B });
    await db`UPDATE organizations SET status = 'suspended' WHERE id = ${org.B}`;
    const after = await api.call("/api/data", { cookie: /** @type {string} */ (r.cookie) });
    expect(after.status).toBe(401);
    await db`UPDATE organizations SET status = 'active' WHERE id = ${org.B}`;
  }, SLOW);
});
