// Multi-tenancy: two organisations, each with two workspaces. Someone in one workspace must not be able to read,
// search, count, export, ask about, be told about, or change anything in another, whether it is in another
// organisation or another workspace of their own. Runs the real Worker against a real database: PGlite with every
// migration applied (npm test, and CI), or the Neon dev branch with PMS_DB=dev. It makes its own organisations
// and removes them afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { NO_TENANT } from "../src/pg.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
// (Not containing the tag: the tag is in every username, and a password may not contain your name.)
const PASSWORD = "Tenancy-Isolation-Pass-9!";
// In PGlite this takes seconds; against Neon from a laptop every query crosses to Singapore.
const SLOW = url === "pglite" ? 120_000 : 900_000;

/**
 * Removes test organisations and everything they hold, in one statement run by the database: every table with an
 * organisation column, retried until the foreign keys let each go. Only ids made by these tests (zz…) are accepted.
 * @param {any} db
 * @param {string[]} orgs
 */
async function removeOrganizations(db, orgs) {
  if (!orgs.length || !orgs.every((o) => /^zz[a-z0-9]+$/.test(o))) throw new Error("Only test organisations can be removed");
  const list = orgs.map((o) => `'${o}'`).join(", "); const quoted = orgs.map((o) => `''${o}''`).join(", ");
  await db.unsafe(`DO $$
DECLARE t TEXT; pass INT;
BEGIN
  FOR pass IN 1..6 LOOP
    FOR t IN SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables x USING (table_schema, table_name)
             WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND x.table_type = 'BASE TABLE'
               AND c.table_name NOT IN ('organizations', 'workspaces', 'accounts', 'workspace_members') LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE organization_id IN (${quoted})', t);
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
  DELETE FROM workspace_members WHERE organization_id IN (${list});
  DELETE FROM accounts WHERE organization_id IN (${list});
  DELETE FROM workspaces WHERE organization_id IN (${list});
  DELETE FROM organizations WHERE id IN (${list});
END $$`);
}

/** The direct connection, tried once more if the far-away connection drops (as the Worker's is in tests). */
const DROPPED = new Set(["ECONNRESET", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "EPIPE", "ETIMEDOUT"]);

describe("multi-tenancy: nothing crosses between organisations or workspaces", () => {
  /** @type {ReturnType<typeof workerClient>} */ let api;
  /** @type {any} */ let db;
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @param {TemplateStringsArray} strings @param {...any} values */
  const q = async (strings, ...values) => {
    try {
      return await db(strings, ...values);
    } catch (e) {
      if (!DROPPED.has(/** @type {any} */ (e)?.code)) throw e;
      return db(strings, ...values);
    }
  };
  const org = { A: `zza${tag}`, B: `zzb${tag}` };
  const ws = { A1: `zza1${tag}`, A2: `zza2${tag}`, B1: `zzb1${tag}`, B2: `zzb2${tag}` };
  // Five people: alice in A1; arthur in A1 and A2; amy in A2; bob in B1; bea in B2.
  const people = {
    alice: { org: "A", spaces: ["A1"] },
    arthur: { org: "A", spaces: ["A1", "A2"] },
    amy: { org: "A", spaces: ["A2"] },
    bob: { org: "B", spaces: ["B1"] },
    bea: { org: "B", spaces: ["B2"] },
  };
  /** @type {Record<string, string>} */ const cookie = {};
  /** What each workspace made: its project, the project's key, its item's key and a word only it uses. */
  /** @type {Record<string, { project: string; key: string; item: string; word: string; filter?: string; dashboard?: string; gadget?: string }>} */
  const made = {};
  const id = (/** @type {keyof typeof people} */ p) => `${p}-${tag}`;

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const applied = await q`SELECT name FROM schema_migrations WHERE name IN ('0013_tenancy_schema.sql', '0014_tenancy_enforcement.sql')`;
    if (applied.length !== 2) throw new Error("Apply migrations 0013 and 0014 to this database first");
    const [{ organization_id: source }] = await q`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (tx) => {
      for (const [k, o] of Object.entries(org)) {
        await tx`INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (${o}, ${`Test org ${k} ${tag}`}, ${`zz-${k.toLowerCase()}-${tag}`}, ${now}, ${now})`;
        await tx`SELECT tenancy_seed_organization(${o}, ${source})`;
      }
      for (const [k, w] of Object.entries(ws)) {
        await tx`INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at)
                 VALUES (${w}, ${org[/** @type {"A" | "B"} */ (k[0])]}, ${`Space ${k}`}, ${`WS${k}`}, ${Number(k[1])}, ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin)
                 VALUES (${id(/** @type {keyof typeof people} */ (p))}, ${id(/** @type {keyof typeof people} */ (p))}, ${`${p[0].toUpperCase()}${p.slice(1)} ${tag}`}, 'admin', ${hash}, ${org[/** @type {"A" | "B"} */ (d.org)]}, 1)`;
        for (const s of d.spaces) {
          await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at)
                   VALUES (${org[/** @type {"A" | "B"} */ (d.org)]}, ${ws[/** @type {keyof typeof ws} */ (s)]}, ${id(/** @type {keyof typeof people} */ (p))}, 'admin', ${now})`;
        }
      }
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(/** @type {keyof typeof people} */ (p)), PASSWORD);
    // arthur signs in to A1 (his first workspace); switch him to A2 to make A2's data, then back.
    const author = { A1: "alice", A2: "amy", B1: "bob", B2: "bea" };
    for (const [space, who] of Object.entries(author)) {
      const c = cookie[who];
      const word = `zzword${space.toLowerCase()}${tag}`;
      // Every project is keyed SAME: keys are unique per organisation, so that must work in both, and a search
      // for SAME must only ever find the searcher's own.
      const key = space === "A1" || space === "B1" ? "SAME" : { A2: "ATWO", B2: "BTWO" }[space];
      const sys = await api.call("/api/systems", { method: "POST", cookie: c, body: { name: `Project ${space} ${tag}`, startedAt: "2026-11-01", key } });
      if (sys.status >= 300) throw new Error(`Project in ${space}: ${sys.status} ${JSON.stringify(sys.data)}`);
      const [{ id: project }] = await q`SELECT id FROM systems WHERE workspace_id = ${ws[/** @type {keyof typeof ws} */ (space)]}`;
      const item = await api.call("/api/items", { method: "POST", cookie: c, body: { systemId: project, type: "TASK", summary: `Task ${word}`, description: `About ${word}` } });
      if (item.status !== 201) throw new Error(`Item in ${space}: ${item.status} ${JSON.stringify(item.data)}`);
      made[space] = { project, key, item: item.data.key, word };
      await api.call(`/api/items/${item.data.key}/comments`, { method: "POST", cookie: c, body: { body: `Comment ${word}` } });
      const f = await api.call("/api/filters", { method: "POST", cookie: c, body: { name: `Filter ${word}`, pql: `text ~ "${word}"`, shareScope: "everyone" } });
      made[space].filter = f.data?.id ?? f.data?.filter?.id;
      const d = await api.call("/api/dashboards", { method: "POST", cookie: c, body: { name: `Dash ${word}`, layout: "one", shareScope: "everyone", gadgets: [{ kind: "filter_results", filterId: made[space].filter, title: "All", column: 0 }] } });
      const dash = d.data?.id ?? d.data?.dashboard?.id;
      made[space].dashboard = dash;
      if (dash) made[space].gadget = (await q`SELECT id FROM dashboard_gadgets WHERE dashboard_id = ${dash}`)[0]?.id;
    }
  }, SLOW * 2);

  afterAll(async () => {
    if (!db) return;
    await removeOrganizations(db, Object.values(org));
    await backend.close();
  }, SLOW);

  /** Everything `who` can see in their open workspace, as one string, to look for other workspaces' words. */
  const everythingSeenBy = async (/** @type {string} */ who) => {
    const parts = await Promise.all(
      ["/api/data", "/api/items?limit=100", "/api/filters", "/api/dashboards", "/api/notifications", "/api/chat", "/api/reports/projects/summary", "/api/activity?limit=200"].map((p) => api.call(p, { cookie: cookie[who] })),
    );
    return JSON.stringify(parts.map((p) => p.data));
  };
  const others = (/** @type {string} */ space) => Object.keys(made).filter((s) => s !== space);

  it("the same project key can exist in two organisations", () => {
    expect(made.A1.key).toBe("SAME");
    expect(made.B1.key).toBe("SAME");
    expect(made.A1.item).toBe("SAME-1");
    expect(made.B1.item).toBe("SAME-1");
  });

  it("lists, the bell, chat, reports and the activity log show only the open workspace", async () => {
    for (const [who, space] of [["alice", "A1"], ["amy", "A2"], ["bob", "B1"], ["bea", "B2"]]) {
      const seen = await everythingSeenBy(who);
      expect(seen, `${who} sees their own`).toContain(made[space].word);
      for (const o of others(space)) expect(seen, `${who} (${space}) must not see ${o}`).not.toContain(made[o].word);
    }
  }, SLOW);

  it("people from other workspaces and organisations aren't listed, and can't be assigned", async () => {
    const data = (await api.call("/api/data", { cookie: cookie.alice })).data;
    const ids = data.users.map((/** @type {{ id: string }} */ u) => u.id).sort();
    expect(ids).toEqual([id("alice"), id("arthur")].sort());
    const r = await api.call(`/api/items/${made.A1.item}`, { method: "PATCH", cookie: cookie.alice, body: { assignee: id("bob") } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const r2 = await api.call(`/api/items/${made.A1.item}`, { method: "PATCH", cookie: cookie.alice, body: { assignee: id("amy") } });
    expect(r2.status).toBeGreaterThanOrEqual(400);
  }, SLOW);

  it("another workspace's item, project, filter or dashboard is 404, read or changed", async () => {
    // SAME-1 means alice's own item to alice and bob's to bob: by key, nobody reaches the other's.
    const mine = await api.call("/api/items/SAME-1", { cookie: cookie.alice });
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.data)).toContain(made.A1.word);
    for (const [who, space] of [["alice", "A2"], ["alice", "B2"], ["bob", "A2"], ["amy", "B2"]]) {
      const c = cookie[who];
      const m = made[space];
      const calls = [
        api.call(`/api/items/${m.item}`, { cookie: c }),
        api.call(`/api/items/${m.item}`, { method: "PATCH", cookie: c, body: { summary: "taken over" } }),
        api.call(`/api/items/${m.item}/comments`, { method: "POST", cookie: c, body: { body: "hello" } }),
        api.call(`/api/items/${m.item}`, { method: "DELETE", cookie: c }),
        api.call(`/api/systems/${m.project}`, { method: "PATCH", cookie: c, body: { progress: 99 } }),
        api.call(`/api/systems/${m.project}/history`, { cookie: c }),
        api.call(`/api/filters/${m.filter}`, { method: "DELETE", cookie: c }),
        api.call(`/api/dashboards/${m.dashboard}/gadgets/${m.gadget}`, { cookie: c }),
        api.call(`/api/requests`, { method: "POST", cookie: c, body: { systemId: m.project, message: "status?" } }),
      ];
      for (const r of await Promise.all(calls)) expect([403, 404], `${who} → ${space}: ${JSON.stringify(r.data)}`).toContain(r.status);
    }
    // Nothing changed.
    const [row] = await q`SELECT summary FROM work_items WHERE workspace_id = ${ws.A2}`;
    expect(row.summary).toContain(made.A2.word);
    const [sys] = await q`SELECT data::jsonb ->> 'progress' AS p FROM systems WHERE id = ${made.B2.project}`;
    expect(sys.p).not.toBe("99");
  }, SLOW);

  it("PQL finds and counts only the open workspace's items", async () => {
    for (const [who, space] of [["alice", "A1"], ["bob", "B1"]]) {
      const all = await api.call("/api/search", { method: "POST", cookie: cookie[who], body: { pql: "project = SAME" } });
      expect(all.status).toBe(200);
      expect(all.data.total).toBe(1);
      expect(JSON.stringify(all.data.items)).toContain(made[space].word);
      for (const o of others(space)) {
        const r = await api.call("/api/search", { method: "POST", cookie: cookie[who], body: { pql: `text ~ "${made[o].word}"` } });
        expect(r.data?.total ?? 0, `${who} searching for ${o}`).toBe(0);
      }
      const everything = await api.call("/api/search", { method: "POST", cookie: cookie[who], body: { pql: "", limit: 100 } });
      for (const o of others(space)) expect(JSON.stringify(everything.data)).not.toContain(made[o].word);
    }
  }, SLOW);

  it("a shared dashboard's gadget shows only the viewer's workspace", async () => {
    const g = await api.call(`/api/dashboards/${made.A1.dashboard}/gadgets/${made.A1.gadget}`, { cookie: cookie.arthur });
    expect(g.status).toBe(200);
    expect(JSON.stringify(g.data)).toContain(made.A1.word);
  }, SLOW);

  it("Ask AI is only told about the open workspace", async () => {
    api.aiInputs.length = 0;
    const r = await api.call("/api/ask", { method: "POST", cookie: cookie.alice, body: { question: "What is everyone working on?" } });
    expect(r.status).toBeLessThan(300);
    const told = JSON.stringify(api.aiInputs);
    expect(told).toContain(`Project A1 ${tag}`);
    for (const o of others("A1")) {
      expect(told).not.toContain(made[o].word);
      expect(told).not.toContain(`Project ${o} ${tag}`);
    }
    expect(told).not.toContain(id("bob"));
    expect(told).not.toContain(id("amy"));
  }, SLOW);

  it("an @mention of someone outside the workspace tells nobody", async () => {
    await api.call(`/api/items/${made.A1.item}/comments`, { method: "POST", cookie: cookie.alice, body: { body: `Hey @${id("bob")} and @${id("amy")}, look` } });
    const told = await q`SELECT user_id FROM notifications WHERE user_id IN (${id("bob")}, ${id("amy")})`;
    expect(told).toEqual([]);
  }, SLOW);

  it("a view-only link shows only the workspace it was made in", async () => {
    const link = await api.call("/api/share-links", { method: "POST", cookie: cookie.alice, body: { label: "Board", days: 1 } });
    expect(link.status).toBe(201);
    const token = String(link.data.url).split("/view/")[1];
    const headers = { "x-share-token": token };
    const data = await api.call("/api/data", { headers });
    expect(data.status).toBe(200);
    const seen = JSON.stringify(data.data);
    expect(seen).toContain(`Project A1 ${tag}`);
    for (const o of others("A1")) expect(seen).not.toContain(`Project ${o} ${tag}`);
    expect((await api.call(`/api/items/${made.A2.item}`, { headers })).status).toBe(404);
    expect((await api.call(`/api/items/${made.A1.item}`, { headers })).status).toBe(200);
  }, SLOW);

  it("an API token reaches only the workspace it was made in, even when its owner belongs to others", async () => {
    const t = await api.call("/api/tokens", { method: "POST", cookie: cookie.arthur, body: { name: "Script", scope: "read", days: 7 } });
    expect(t.status).toBe(201);
    const headers = { authorization: `Bearer ${t.data.token}` };
    const items = await api.call("/api/items?limit=100", { headers });
    expect(items.status).toBe(200);
    expect(JSON.stringify(items.data)).toContain(made.A1.word);
    expect(JSON.stringify(items.data)).not.toContain(made.A2.word);
    expect((await api.call(`/api/items/${made.A2.item}`, { headers })).status).toBe(404);
    expect((await api.call(`/api/items/BTWO-1`, { headers })).status).toBe(404);
  }, SLOW);

  it("switching workspace is refused without membership, in your organisation or another", async () => {
    const before = await api.call("/api/me/workspaces", { cookie: cookie.alice });
    expect(before.data.workspace.id).toBe(ws.A1);
    for (const target of [ws.A2, ws.B1, ws.B2, "no-such-workspace"]) {
      const r = await api.call("/api/me/workspace", { method: "POST", cookie: cookie.alice, body: { workspaceId: target } });
      expect(r.status, target).toBe(404);
    }
    const after = await api.call("/api/me/workspaces", { cookie: cookie.alice });
    expect(after.data.workspace.id).toBe(ws.A1);
    expect(after.data.workspaces.map((/** @type {{ id: string }} */ w) => w.id)).toEqual([ws.A1]);
  }, SLOW);

  it("switching works with membership, and then shows only the new workspace", async () => {
    const r = await api.call("/api/me/workspace", { method: "POST", cookie: cookie.arthur, body: { workspaceId: ws.A2 } });
    expect(r.status).toBe(200);
    const seen = await everythingSeenBy("arthur");
    expect(seen).toContain(made.A2.word);
    expect(seen).not.toContain(made.A1.word);
    expect((await api.call(`/api/items/${made.A1.item}`, { cookie: cookie.arthur })).status).toBe(404);
    await api.call("/api/me/workspace", { method: "POST", cookie: cookie.arthur, body: { workspaceId: ws.A1 } });
  }, SLOW);

  it("the database itself refuses: no tenant sees nothing, and a row can't be written into another workspace", async () => {
    const a1 = api.root.withScope({ orgId: org.A, workspaceId: ws.A1 });
    const count = /** @type {{ n: number }} */ (await a1.prepare("SELECT COUNT(*) AS n FROM work_items").first()).n;
    expect(count).toBe(Number((await q`SELECT count(*)::int AS n FROM work_items WHERE workspace_id = ${ws.A1}`)[0].n));
    const people = /** @type {D1Result<{ id: string }>} */ (await a1.prepare("SELECT id FROM users").all()).results.map((u) => u.id).sort();
    expect(people).toEqual([id("alice"), id("arthur")].sort());
    const none = api.root.withScope(NO_TENANT);
    for (const t of ["work_items", "systems", "users", "notifications", "chat_messages", "api_tokens", "share_links", "activity", "org_settings"]) {
      expect(/** @type {{ n: number }} */ (await none.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n, t).toBe(0);
    }
    await expect(a1.prepare("INSERT INTO blockers (id, system_id, text, raised_by, raised_at, workspace_id, organization_id) VALUES ('x', ?, 'x', 'x', 'x', ?, ?)").bind(made.B1.project, ws.B1, org.B).run()).rejects.toThrow();
    await expect(a1.prepare("UPDATE work_items SET summary = 'moved' WHERE id IN (SELECT id FROM work_items)").run()).resolves.toBeTruthy();
    expect((await q`SELECT summary FROM work_items WHERE workspace_id = ${ws.B1}`)[0].summary).toContain(made.B1.word);
    await expect(none.prepare("INSERT INTO systems (id, data, key) VALUES ('x', '{}', 'XX')").run()).rejects.toThrow();
  }, SLOW);
});
