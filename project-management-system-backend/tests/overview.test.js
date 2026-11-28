// A project's page in one call (src/overview.js), through the real Worker on PGlite (or the Neon dev branch with
// PMS_DB=dev): its figures agree with Reports → Projects and with the work-item lists behind them, an item the viewer
// can't see is never counted, the lifecycle stage counts against health in both places, and another organisation's
// project is a 404.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";
import { categoryPql, personPql, weekPql } from "../../project-management-system-frontend/src/data/chartInsights.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Overview-Test-Pass-47!";
const DAY = 86_400_000;

/** One short stage with a 5-day target, so the test can put the project over it. */
const TINY = {
  settings: { selfSignoff: false, advanceBy: ["lead", "manager", "admin"], sendBackBy: ["lead", "manager", "admin"], skipApprovedBy: ["manager", "admin"], signoffReminderDays: 2, overdueEscalateTo: ["manager"], progress: { lifecycleWeight: 1 }, onClose: { status: "LIVE" } },
  phases: [{ code: "A", name: "Build" }, { code: "B", name: "Close" }],
  stages: [
    { code: "BUILD", name: "Dev Work", phase: "A", type: "work", responsible: ["lead"], targetDays: 5, weight: 60, exit: [{ kind: "checklist", key: "built", label: "Built" }], transitions: { sendBackTo: [], canSkip: false } },
    { code: "CLOSE", name: "Close Project", phase: "B", type: "closure", responsible: ["lead"], targetDays: 5, weight: 40, exit: [{ kind: "checklist", key: "handover", label: "Handed over" }], transitions: { sendBackTo: ["BUILD"], canSkip: false } },
  ],
};

describe("the project overview", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const orgs = { a: { id: `zzoa${tag}`, code: `zz-oa-${tag}` }, b: { id: `zzob${tag}`, code: `zz-ob-${tag}` } };
  const people = {
    ada: { org: orgs.a.id, orgAdmin: 1, role: "admin" },
    mia: { org: orgs.a.id, orgAdmin: 0, role: "manager" },
    tom: { org: orgs.a.id, orgAdmin: 0, role: "developer" },
    bob: { org: orgs.b.id, orgAdmin: 1, role: "admin" },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let systemId = "";
  const overview = async (/** @type {string} */ who) => {
    const r = await as(who, `/api/systems/${systemId}/overview`);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    return r.data;
  };

  beforeAll(async () => {
    backend = await testBackend(url);
    db = backend.sql;
    const [{ organization_id: source }] = await db`SELECT organization_id FROM tenancy_legacy`;
    const now = new Date().toISOString();
    const hash = await hashPassword(PASSWORD);
    await db.begin(async (/** @type {any} */ tx) => {
      for (const o of Object.values(orgs)) {
        await tx`INSERT INTO organizations (id, name, code, status, created_at, updated_at) VALUES (${o.id}, ${`Org ${o.code}`}, ${o.code}, 'active', ${now}, ${now})`;
        await tx`SELECT tenancy_seed_organization(${o.id}, ${source})`;
        await tx`INSERT INTO workspaces (id, organization_id, name, key, created_at, updated_at) VALUES (${`${o.id}-ws`}, ${o.id}, 'Projects', 'PRJ', ${now}, ${now})`;
      }
      for (const [p, d] of Object.entries(people)) {
        await tx`INSERT INTO accounts (id, username, name, role, password_hash, organization_id, org_admin, email)
                 VALUES (${id(p)}, ${id(p)}, ${p}, ${d.role}, ${hash}, ${d.org}, ${d.orgAdmin}, ${`${p}-${tag}@example.test`})`;
        await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${d.org}, ${`${d.org}-ws`}, ${id(p)}, ${d.role}, ${now})`;
      }
    });
    api = workerClient(backend);
    for (const p of Object.keys(people)) cookie[p] = await api.signIn(id(p), PASSWORD);

    // A default lifecycle, so the new project starts on it.
    const t = await as("ada", "/api/lifecycle/templates", { method: "POST", body: { name: "Tiny", definition: TINY } });
    expect(t.status, JSON.stringify(t.data)).toBe(201);
    expect((await as("ada", `/api/lifecycle/templates/${t.data.template.id}/publish`, { method: "POST", body: { default: true } })).status).toBe(200);

    const started = new Date(Date.now() - 70 * DAY).toISOString().slice(0, 10);
    const due = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
    const p = await as("ada", "/api/systems", { method: "POST", body: { name: `Payroll ${tag}`, startedAt: started, dueAt: due, key: "OVW", lead: id("tom"), status: "WIP" } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    systemId = p.data.id;
    expect((await as("ada", `/api/systems/${systemId}`, { method: "PATCH", body: { developers: [id("tom")] } })).status).toBeLessThan(300);

    // 16 work items: 12 done over the last 8 weeks, 4 open (2 of them overdue), plus a restricted overdue one.
    const level = await as("ada", "/api/security-levels", { method: "POST", body: { name: `Board ${tag}`, roles: [], people: [] } });
    expect(level.status, JSON.stringify(level.data)).toBe(201);
    const past = (/** @type {number} */ d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
    /** @type {string[]} */ const keys = [];
    for (let i = 0; i < 16; i++) {
      const r = await as("ada", "/api/items", { method: "POST", body: { systemId, type: "TASK", summary: `Item ${i}`, priority: "MEDIUM", ...(i === 12 || i === 13 ? { dueDate: past(3 + i) } : {}), ...(i === 15 ? { dueDate: past(2), securityLevel: level.data.id } : {}) } });
      expect(r.status, JSON.stringify(r.data)).toBe(201);
      keys.push(r.data.key);
    }
    const [{ id: doneStatus }] = await db`SELECT id FROM work_statuses WHERE organization_id = ${orgs.a.id} AND category = 'DONE' ORDER BY position LIMIT 1`;
    for (let i = 0; i < 16; i++) {
      const created = new Date(Date.now() - 65 * DAY).toISOString();
      if (i < 12) {
        // Resolved at about 1.5 a week over the last 8 complete weeks.
        const resolved = new Date(Date.now() - (7 + Math.floor(i * 4.5)) * DAY).toISOString();
        await db`UPDATE work_items SET status = ${doneStatus}, resolution = 'DONE', resolved_at = ${resolved}, created_at = ${created} WHERE system_id = ${systemId} AND number = ${i + 1}`;
      } else {
        await db`UPDATE work_items SET created_at = ${created} WHERE system_id = ${systemId} AND number = ${i + 1}`;
      }
    }
    expect((await as("tom", `/api/systems/${systemId}/blockers`, { method: "POST", body: { text: "Waiting for the API keys" } })).status).toBeLessThan(300);
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${orgs.a.id}, ${orgs.b.id})`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("counts only what the viewer can see: the restricted item is left out for a Manager", async () => {
    const admin = await overview("ada");
    const manager = await overview("mia");
    expect(admin.kpis.openItems.value).toBe(4);
    expect(admin.kpis.overdueItems.value).toBe(3);
    expect(manager.kpis.openItems.value).toBe(3);
    expect(manager.kpis.overdueItems.value).toBe(2);
    expect(manager.kpis.doneItems.value).toBe(12);
    // Nor in the charts or the attention list.
    expect(manager.series.weeks.at(-1).scope).toBe(15);
    expect(admin.series.weeks.at(-1).scope).toBe(16);
    expect(JSON.stringify(manager.attention)).not.toContain("Item 15");
    expect(JSON.stringify(admin.attention)).toContain("Item 15");
  }, SLOW);

  it("the figures match Reports → Projects, and the work-item lists behind the tiles", async () => {
    const o = await overview("mia");
    const report = await as("mia", "/api/reports/projects/summary");
    expect(report.status, JSON.stringify(report.data)).toBe(200);
    const row = report.data.rows.find((/** @type {any} */ r) => r.id === systemId);
    expect(row).toMatchObject({ openItems: o.kpis.openItems.value, overdueItems: o.kpis.overdueItems.value, doneItems: o.kpis.doneItems.value, openBlockers: o.kpis.blockers.value, rag: o.health.rag });
    expect(row.reasons).toEqual(o.health.reasons);
    for (const [k, pql] of [["openItems", o.pql.open], ["overdueItems", o.pql.overdue], ["doneItems", o.pql.done]]) {
      const found = await as("mia", "/api/search", { method: "POST", body: { pql } });
      expect(found.status, JSON.stringify(found.data)).toBe(200);
      expect(found.data.total, `${k}: ${pql}`).toBe(o.kpis[k].value);
    }
  }, SLOW);

  it("header, stepper, attention, forecast and series", async () => {
    const o = await overview("mia");
    expect(o.project).toMatchObject({ id: systemId, key: "OVW", workspace: "Projects", lead: { id: id("tom"), name: "tom" } });
    expect(o.lifecycle.stage).toMatchObject({ code: "BUILD", n: 1, total: 2 });
    expect(o.lifecycle.stages.map((/** @type {any} */ s) => s.state)).toEqual(["current", "upcoming"]);
    expect(o.lifecycle.missing).toEqual(['Tick "Built"']);
    // The blocker first, then the overdue items, oldest first.
    expect(o.attention.entries.map((/** @type {any} */ e) => e.kind)).toEqual(["blocker", "overdue_item", "overdue_item"]);
    expect(o.attention.entries[1].title).toBe("OVW-14 Item 13");
    // 12 resolved over 8+ weeks of history: a forecast, with both dates, after today.
    expect(o.kpis.forecast.items.status).toBe("ok");
    expect(o.kpis.forecast.items.p85.weeks).toBeGreaterThanOrEqual(o.kpis.forecast.items.p50.weeks);
    expect(o.kpis.forecast.lifecycle.businessDays).toBeGreaterThan(0);
    expect(o.series.weeks).toHaveLength(12);
    expect(o.series.days).toHaveLength(30);
    expect(o.series.days.at(-1)).toMatchObject({ open: 3, overdue: 2, blockers: 1 });
    expect(o.series.workload.people.map((/** @type {any} */ p) => p.id)).toEqual([id("tom")]);
    expect(o.series.workload.capacityHours).toBe(30);
  }, SLOW);

  it("every chart part opens a list with the same count", async () => {
    const o = await overview("mia");
    const count = async (/** @type {string} */ pql) => {
      const r = await as("mia", "/api/search", { method: "POST", body: { pql } });
      expect(r.status, JSON.stringify(r.data) + pql).toBe(200);
      return r.data.total;
    };
    const busy = o.series.weeks.filter((/** @type {any} */ w) => w.resolved);
    expect(busy.length).toBeGreaterThan(0);
    for (const w of busy) expect(await count(weekPql("OVW", "resolved", w.week)), w.week).toBe(w.resolved);
    expect(await count(categoryPql("OVW", "done"))).toBe(o.kpis.doneItems.value);
    expect(await count(categoryPql("OVW", "todo")) + (await count(categoryPql("OVW", "inProgress")))).toBe(o.kpis.openItems.value);
    expect(await count(personPql("OVW", id("tom")))).toBe(o.series.workload.people[0].openItemsHere);
  }, SLOW);

  it("a stage over its target counts against health here and in the report alike", async () => {
    await db`UPDATE project_lifecycle SET stage_entered_at = ${new Date(Date.now() - 21 * DAY).toISOString()} WHERE system_id = ${systemId}`;
    const o = await overview("mia");
    expect(o.lifecycle.stages[0].state).toBe("overdue");
    expect(o.health.rag).toBe("RED");
    expect(o.health.reasons.some((/** @type {string} */ r) => /^Dev Work is [\d.]+ business days over its 5-day target$/.test(r))).toBe(true);
    expect(o.attention.entries.map((/** @type {any} */ e) => e.kind)).toContain("stage_overdue");
    const row = (await as("mia", "/api/reports/projects/summary")).data.rows.find((/** @type {any} */ r) => r.id === systemId);
    expect(row.rag).toBe("RED");
    expect(row.reasons).toEqual(o.health.reasons);
  }, SLOW);

  it("the summary: written from what the viewer may see, kept per viewer, the plain one when the AI strays", async () => {
    const reply = (/** @type {string} */ text) => (api.env.AI.run = async (/** @type {string} */ _m, /** @type {any} */ input) => {
      api.aiInputs.push(input);
      return { response: text };
    });
    const factsSent = () => String(/** @type {any} */ (api.aiInputs.at(-1)).messages[1].content);
    // A sentence quoting a number the facts don't have is thrown away.
    reply("The project is at Dev Work and is off track. It has 99 open blockers waiting on the team. It should finish soon.");
    let r = await as("mia", `/api/systems/${systemId}/summary`);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.source).toBe("plain");
    expect(r.data.text).toContain(`Payroll ${tag}`);
    expect(r.data.upToDate).toBe(true);
    // The facts were the Manager's: the restricted item isn't in them.
    expect(factsSent()).toContain("Overdue work items: 2");
    expect(factsSent()).not.toContain("Item 15");
    // Kept: asking again doesn't call the AI.
    const calls = api.aiInputs.length;
    expect((await as("mia", `/api/systems/${systemId}/summary`)).data.text).toBe(r.data.text);
    expect(api.aiInputs.length).toBe(calls);
    // Regenerate within 30 seconds returns the one just written.
    expect((await as("mia", `/api/systems/${systemId}/summary`, { method: "POST" })).data.generatedAt).toBe(r.data.generatedAt);
    // The Administrator's is their own, from their own figures.
    reply("The project is at Dev Work and is off track. It has 3 overdue work items and an open blocker. It should finish when the work is done.");
    r = await as("ada", `/api/systems/${systemId}/summary`);
    expect(factsSent()).toContain("Overdue work items: 3");
    expect(r.data).toMatchObject({ source: "ai", text: "The project is at Dev Work and is off track. It has 3 overdue work items and an open blocker. It should finish when the work is done." });
    // A number in words can't be checked: plain again.
    await db`DELETE FROM project_summaries WHERE system_id = ${systemId}`;
    reply("The project is at Dev Work and is off track. It has three overdue work items and an open blocker. It should finish when the work is done.");
    expect((await as("ada", `/api/systems/${systemId}/summary`)).data.source).toBe("plain");
    const rows = await db`SELECT viewer_key FROM project_summaries WHERE system_id = ${systemId} ORDER BY viewer_key`;
    expect(rows.map((/** @type {any} */ x) => x.viewer_key)).toEqual([`u:${id("ada")}`]);
    expect((await as("bob", `/api/systems/${systemId}/summary`)).status).toBe(404);
  }, SLOW);

  it("stage comments: added by people in the workspace, shown oldest first; another organisation gets a 404", async () => {
    const add = await as("tom", `/api/systems/${systemId}/stage-comments`, { method: "POST", body: { stage: "BUILD", body: "Waiting for the API keys from the client." } });
    expect(add.status, JSON.stringify(add.data)).toBe(201);
    expect((await as("mia", `/api/systems/${systemId}/stage-comments`, { method: "POST", body: { stage: "BUILD", body: "Chasing them today." } })).status).toBe(201);
    const list = await as("ada", `/api/systems/${systemId}/stage-comments?stage=BUILD`);
    expect(list.data.comments.map((/** @type {any} */ c) => [c.author_name, c.body])).toEqual([["tom", "Waiting for the API keys from the client."], ["mia", "Chasing them today."]]);
    expect((await as("ada", `/api/systems/${systemId}/stage-comments?stage=CLOSE`)).data.comments).toEqual([]);
    expect((await as("tom", `/api/systems/${systemId}/stage-comments`, { method: "POST", body: { stage: "NOPE", body: "x" } })).status).toBe(400);
    expect((await as("tom", `/api/systems/${systemId}/stage-comments`, { method: "POST", body: { stage: "BUILD", body: "   " } })).status).toBe(400);
    expect((await as("bob", `/api/systems/${systemId}/stage-comments?stage=BUILD`)).status).toBe(404);
    expect((await as("bob", `/api/systems/${systemId}/stage-comments`, { method: "POST", body: { stage: "BUILD", body: "Hello" } })).status).toBe(404);
    // A record: the app can't change one.
    const changed = await db.begin(async (/** @type {any} */ tx) => {
      await tx`SET LOCAL ROLE pulse_app`;
      await tx`SELECT set_config('app.org_id', ${orgs.a.id}, true), set_config('app.workspace_id', ${`${orgs.a.id}-ws`}, true)`;
      await tx`UPDATE stage_comments SET body = 'changed' WHERE system_id = ${systemId}`;
      return "updated";
    }).catch((/** @type {any} */ e) => e.code);
    expect(changed).toBe("42501");
  }, SLOW);

  it("the team: hours logged and open work here, through the visibility rule", async () => {
    // Tom gets OVW-13 (open) and the restricted OVW-16, and logs an hour and a half on OVW-13.
    for (const k of ["OVW-13", "OVW-16"]) expect((await as("ada", `/api/items/${k}`, { method: "PATCH", body: { assignee: id("tom") } })).status).toBe(200);
    expect((await as("tom", "/api/items/OVW-13/worklogs", { method: "POST", body: { minutes: 90 } })).status).toBeLessThan(300);
    const mine = await as("mia", `/api/systems/${systemId}/team`);
    expect(mine.status, JSON.stringify(mine.data)).toBe(200);
    const tom = mine.data.people.find((/** @type {any} */ x) => x.id === id("tom"));
    expect(tom).toMatchObject({ name: "tom", lead: true, role: "developer", hoursRecent: 1.5, hoursAll: 1.5, openHere: 1, openAll: 1, share: 100 });
    // The Administrator also sees the restricted item; the Manager doesn't.
    const all = (await as("ada", `/api/systems/${systemId}/team`)).data.people.find((/** @type {any} */ x) => x.id === id("tom"));
    expect(all.openHere).toBe(2);
    expect((await as("bob", `/api/systems/${systemId}/team`)).status).toBe(404);
  }, SLOW);

  it("saved views, remembered filters and last tabs: cleaned, and each person's own", async () => {
    const put = await as("tom", "/api/me/prefs", {
      method: "PUT",
      body: {
        theme: "light",
        workViews: [{ id: "abc123def", systemId, name: "My bugs", filters: { type: "BUG", assignee: "me", state: "open", injected: "x" } }, { id: "!!", systemId, name: "bad" }],
        workFilters: { [systemId]: { state: "done", q: "login" } },
        lastTabs: { [systemId]: "risks", other: "nowhere" },
        secret: "kept?",
      },
    });
    expect(put.status, JSON.stringify(put.data)).toBe(200);
    expect(put.data.workViews).toEqual([{ id: "abc123def", systemId, name: "My bugs", filters: { state: "open", type: "BUG", status: "", priority: "", assignee: "me", label: "", q: "", sort: "key", dir: "desc" } }]);
    expect(put.data.lastTabs).toEqual({ [systemId]: "risks" });
    expect(put.data.secret).toBeUndefined();
    const tom = (await as("tom", "/api/data")).data.prefs;
    expect(tom.workViews.map((/** @type {any} */ v) => v.name)).toEqual(["My bugs"]);
    expect(tom.workFilters[systemId]).toMatchObject({ state: "done", q: "login" });
    // Mia's are her own.
    expect((await as("mia", "/api/data")).data.prefs.workViews).toEqual([]);
  }, SLOW);

  it("another organisation's project is a 404; nothing but GET", async () => {
    expect((await as("bob", `/api/systems/${systemId}/overview`)).status).toBe(404);
    expect((await as("ada", `/api/systems/${systemId}/overview`, { method: "POST" })).status).toBe(405);
  }, SLOW);
});
