// Project lifecycles end to end (migrations 0025–0026, src/lifecycle.js), through the real Worker on PGlite (or the
// Neon dev branch with PMS_DB=dev): templates and their isolation, a project from draft to closed through every
// kind of gate, sign-offs (decline, segregation of duties, locking), skip approval, send-back, the QAT threshold and
// security findings, history and audit, and the stage-mapping migration.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth.js";
import { purgeDueOrganizations } from "../src/platform.js";
import { mapExistingProject } from "../../project-management-system-frontend/src/data/lifecycle.js";
import { testBackend, testDatabase, workerClient } from "./helpers/worker.js";

const url = testDatabase();
const tag = Date.now().toString(36);
const SLOW = url === "pglite" ? 120_000 : 900_000;
const PASSWORD = "Lifecycle-Test-Pass-47!";

/** A small lifecycle exercising every kind of gate the engine has. */
const MINI = (/** @type {string} */ mia, /** @type {string} */ ada) => ({
  settings: { selfSignoff: false, advanceBy: ["lead", "manager", "admin"], sendBackBy: ["lead", "manager", "admin"], skipApprovedBy: ["manager", "admin"], signoffReminderDays: 2, overdueEscalateTo: ["manager"], progress: { lifecycleWeight: 1 }, onClose: { status: "LIVE" } },
  phases: [{ code: "A", name: "Plan" }, { code: "B", name: "Build" }, { code: "C", name: "Close" }],
  stages: [
    { code: "DRAFT", name: "BRS Draft", phase: "A", type: "draft", responsible: ["lead"], targetDays: 5, weight: 10, exit: [{ kind: "deliverable", key: "brs", label: "BRS attached" }], deliverables: [{ key: "brs", name: "BRS", source: "document", versioned: true }], transitions: { sendBackTo: [], canSkip: false } },
    {
      code: "SIGN", name: "BRS Sign Off", phase: "A", type: "approval", responsible: ["lead"], targetDays: 5, weight: 10,
      signoff: { signatories: [{ kind: "user", userId: mia, name: "Mia", label: "Business", alternate: { userId: ada, name: "Ada" } }, { kind: "role", role: "admin", label: "Systems" }], onDecline: "DRAFT", lockDeliverables: ["brs"] },
      exit: [{ kind: "signoffs", label: "Signed" }], transitions: { sendBackTo: ["DRAFT"], canSkip: false }, automation: { onEnter: ["request:signoffs"] },
    },
    { code: "BUILD", name: "Dev Work", phase: "B", type: "work", responsible: ["lead"], targetDays: 20, weight: 40, exit: [{ kind: "checklist", key: "built", label: "Built" }], transitions: { sendBackTo: ["DRAFT"], canSkip: true } },
    {
      code: "QA", name: "QATs", phase: "B", type: "testing", responsible: ["lead"], targetDays: 10, weight: 30, testing: { suite: "QAT", passThreshold: 0.95, failedCreatesBug: true },
      exit: [{ kind: "test_pass_rate", suite: "QAT", min: 0.95, label: "95% pass" }, { kind: "security_clear", blocking: ["Critical", "High"], label: "No open High findings" }],
      transitions: { sendBackTo: ["BUILD"], canSkip: false },
    },
    { code: "CLOSE", name: "Close Project", phase: "C", type: "closure", responsible: ["lead"], targetDays: 5, weight: 10, exit: [{ kind: "checklist", key: "handover", label: "Handed over" }], transitions: { sendBackTo: ["QA"], canSkip: false } },
  ],
});

describe("project lifecycles", () => {
  /** @type {Awaited<ReturnType<typeof testBackend>>} */ let backend;
  /** @type {any} */ let db;
  /** @type {ReturnType<typeof workerClient>} */ let api;
  const orgs = { a: { id: `zzla${tag}`, code: `zz-la-${tag}` }, b: { id: `zzlb${tag}`, code: `zz-lb-${tag}` } };
  // ada: Administrator (and Organisation Administrator); mia: Manager; tom: Developer who leads the project;
  // dev: another Developer; bob: B's administrator.
  const people = {
    ada: { org: orgs.a.id, orgAdmin: 1, role: "admin" },
    mia: { org: orgs.a.id, orgAdmin: 0, role: "manager" },
    tom: { org: orgs.a.id, orgAdmin: 0, role: "developer" },
    dev: { org: orgs.a.id, orgAdmin: 0, role: "developer" },
    bob: { org: orgs.b.id, orgAdmin: 1, role: "admin" },
  };
  const id = (/** @type {string} */ p) => `${p}-${tag}`;
  /** @type {Record<string, string>} */ const cookie = {};
  const as = (/** @type {string} */ who, /** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ o = {}) => api.call(path, { ...o, cookie: cookie[who] });
  let systemId = "";
  const lc = (/** @type {string} */ who, sub = "", /** @type {{ method?: string; body?: unknown }} */ o = {}) => as(who, `/api/systems/${systemId}/lifecycle${sub}`, o);
  const stageOf = async () => (await lc("tom")).data.lifecycle;

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
  }, SLOW);

  afterAll(async () => {
    if (!db) return;
    await db`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id IN (${orgs.a.id}, ${orgs.b.id})`;
    await purgeDueOrganizations(backend.root);
    await backend.close();
  }, SLOW);

  it("templates: only the organisation's administrators make and publish them; another organisation never sees them", async () => {
    expect((await as("mia", "/api/lifecycle/templates", { method: "POST", body: { name: "Nope" } })).status).toBe(403);
    expect((await as("ada", "/api/lifecycle/templates", { method: "POST", body: { name: "Broken", definition: { phases: [], stages: [] } } })).status).toBe(400);
    const made = await as("ada", "/api/lifecycle/templates", { method: "POST", body: { name: "Mini", definition: MINI(id("mia"), id("ada")) } });
    expect(made.status, JSON.stringify(made.data)).toBe(201);
    const t = made.data.template;
    expect(t).toMatchObject({ status: "draft", version: 1 });
    const pub = await as("ada", `/api/lifecycle/templates/${t.id}/publish`, { method: "POST", body: { default: true } });
    expect(pub.data.template).toMatchObject({ status: "published", isDefault: true });
    // A published version doesn't change; a new draft is version 2.
    expect((await as("ada", `/api/lifecycle/templates/${t.id}`, { method: "PUT", body: { name: "Changed" } })).status).toBe(409);
    expect((await as("ada", `/api/lifecycle/templates/${t.id}/draft`, { method: "POST" })).data.template.version).toBe(2);
    // The standard 16 stages, for anyone to start from.
    expect((await as("ada", "/api/lifecycle/templates", { method: "POST", body: { name: "Standard" } })).data.template.definition.stages).toHaveLength(16);
    // Members see the published ones; B sees none of A's, and A's template is a 404 to B.
    expect((await as("tom", "/api/lifecycle/templates")).data.templates.map((/** @type {any} */ x) => x.name)).toEqual(["Mini"]);
    expect((await as("bob", "/api/lifecycle/templates")).data.templates).toEqual([]);
    expect((await as("bob", `/api/lifecycle/templates/${t.id}/default`, { method: "POST" })).status).toBe(404);
    const rows = await db.begin(async (/** @type {any} */ tx) => {
      await tx`SET LOCAL ROLE pulse_app`;
      await tx`SELECT set_config('app.org_id', ${orgs.b.id}, true), set_config('app.workspace_id', '', true)`;
      return tx`SELECT id FROM lifecycle_templates`;
    });
    expect(rows).toEqual([]);
  }, SLOW);

  it("a new project starts on the default lifecycle, and can't advance until its gate is met", async () => {
    const p = await as("ada", "/api/systems", { method: "POST", body: { name: `Billing ${tag}`, startedAt: "2026-11-01", key: "BILL", lead: id("tom"), status: "WIP" } });
    expect(p.status, JSON.stringify(p.data)).toBe(201);
    systemId = p.data.id;
    const l = await stageOf();
    expect(l).toMatchObject({ stage: "DRAFT", state: "active", ready: false, template: { name: "Mini" } });
    expect(l.gate).toEqual([{ label: "BRS attached", ok: false, missing: "Attach the BRS" }]);
    const refused = await lc("tom", "/advance", { method: "POST" });
    expect(refused.status).toBe(409);
    expect(refused.data).toMatchObject({ code: "gate_not_met", missing: ["Attach the BRS"] });
    // Someone who isn't the lead, a Manager or an Administrator can't advance at all.
    expect((await lc("dev", "/advance", { method: "POST" })).status).toBe(403);
    // Another organisation: a 404.
    expect((await as("bob", `/api/systems/${systemId}/lifecycle`)).status).toBe(404);
  }, SLOW);

  /** Adds a link document as tom and marks it as the BRS; returns its id. */
  const brs = async (/** @type {string} */ who, /** @type {string} */ name) => {
    const d = await as(who, `/api/systems/${systemId}/documents`, { method: "POST", body: { name, url: `https://example.test/${name}` } });
    expect(d.status, JSON.stringify(d.data)).toBe(201);
    const m = await lc(who, "/deliverables", { method: "POST", body: { documentId: d.data.id, key: "brs" } });
    expect(m.status, JSON.stringify(m.data)).toBe(200);
    return /** @type {string} */ (d.data.id);
  };

  it("sign-off: a decline (with a reason) sends it back; the approved version is locked", async () => {
    await brs("tom", "brs-v1");
    const moved = await lc("tom", "/advance", { method: "POST" });
    expect(moved.status, JSON.stringify(moved.data)).toBe(200);
    let l = moved.data.lifecycle;
    expect(l.stage).toBe("SIGN");
    // Sign-offs were requested on entering: Mia by name, and an Administrator.
    let round = l.signoffs.filter((/** @type {any} */ s) => s.stage_code === "SIGN");
    expect(round.map((/** @type {any} */ s) => [s.signer_id, s.status, s.document_version]).sort()).toEqual([[id("ada"), "pending", 1], [id("mia"), "pending", 1]]);
    const mine = round.find((/** @type {any} */ s) => s.signer_id === id("mia"));
    // Only the signatory: anyone else gets a 404.
    expect((await lc("tom", `/signoffs/${mine.id}`, { method: "POST", body: { decision: "approve" } })).status).toBe(404);
    expect((await lc("mia", `/signoffs/${mine.id}`, { method: "POST", body: { decision: "decline" } })).status).toBe(400);
    l = (await lc("mia", `/signoffs/${mine.id}`, { method: "POST", body: { decision: "decline", comment: "Missing the opt-out flow" } })).data.lifecycle;
    expect(l.stage).toBe("DRAFT");
    expect(l.history[0]).toMatchObject({ from_code: "SIGN", to_code: "DRAFT", kind: "decline", reason: "Declined: Missing the opt-out flow" });
    expect(l.sentBackFrom).toContain("SIGN");
    // A decided sign-off can't be changed, even directly in the database by the app.
    const again = await lc("mia", `/signoffs/${mine.id}`, { method: "POST", body: { decision: "approve" } });
    expect(again.status).toBe(409);

    // Version 2, uploaded by Mia herself (she joins the project to do it): segregation of duties means she isn't
    // asked; her alternate (Ada) is.
    await db`INSERT INTO assignments (organization_id, workspace_id, user_id, system_id) VALUES (${orgs.a.id}, ${`${orgs.a.id}-ws`}, ${id("mia")}, ${systemId})`;
    const v2 = await brs("mia", "brs-v2");
    l = (await lc("tom", "/advance", { method: "POST" })).data.lifecycle;
    round = l.signoffs.filter((/** @type {any} */ s) => s.stage_code === "SIGN" && s.round === 2);
    expect(round.map((/** @type {any} */ s) => [s.signer_id, s.document_version])).toEqual([[id("ada"), 2]]);
    l = (await lc("ada", `/signoffs/${round[0].id}`, { method: "POST", body: { decision: "approve", comment: "Good" } })).data.lifecycle;
    expect(l.stage).toBe("BUILD");
    const doc = l.documents.find((/** @type {any} */ d) => d.id === v2);
    expect(doc).toMatchObject({ deliverable_key: "brs", version: 2 });
    expect(doc.locked_at).toBeTruthy();
    // Locked: not removed, not re-marked, and the database refuses it too.
    expect((await as("ada", `/api/documents/${v2}`, { method: "DELETE" })).status).toBe(409);
    await expect(
      db.begin(async (/** @type {any} */ tx) => {
        await tx`SET LOCAL ROLE pulse_app`;
        await tx`SELECT set_config('app.org_id', ${orgs.a.id}, true), set_config('app.workspace_id', ${`${orgs.a.id}-ws`}, true)`;
        await tx`UPDATE documents SET name = 'changed' WHERE id = ${v2}`;
      }),
    ).rejects.toThrow(/locked/);
  }, SLOW);

  it("a skip needs a Manager's or Administrator's approval, never the requester's", async () => {
    expect((await lc("tom", "/skip", { method: "POST", body: { reason: "" } })).status).toBe(400);
    let l = (await lc("tom", "/skip", { method: "POST", body: { reason: "Reusing the existing module" } })).data.lifecycle;
    expect(l.stage).toBe("BUILD");
    const req = l.requests.find((/** @type {any} */ r) => r.kind === "skip" && r.status === "pending");
    expect((await lc("tom", `/requests/${req.id}`, { method: "POST", body: { decision: "approve" } })).status).toBe(403);
    l = (await lc("mia", `/requests/${req.id}`, { method: "POST", body: { decision: "approve", note: "Fine" } })).data.lifecycle;
    expect(l.stage).toBe("QA");
    expect(l.history[0]).toMatchObject({ from_code: "BUILD", to_code: "QA", kind: "skip" });
  }, SLOW);

  it("QAT: the 95% threshold, failed tests raise bugs, and open High security findings block it until a Manager accepts them", async () => {
    let l;
    for (let i = 0; i < 20; i++) l = (await lc("tom", "/tests", { method: "POST", body: { title: `Case ${i}` } })).data.lifecycle;
    const cases = l.tests;
    for (let i = 0; i < 20; i++) await lc("tom", `/tests/${cases[i].id}/runs`, { method: "POST", body: { result: i < 18 ? "pass" : "fail", notes: i < 18 ? "" : "Wrong total" } });
    l = await stageOf();
    expect(l.testSummary.QAT).toEqual({ total: 20, pass: 18, fail: 2, blocked: 0, notRun: 0 });
    const bugs = await db`SELECT summary, lifecycle_stage FROM work_items WHERE system_id = ${systemId} AND type = 'BUG'`;
    expect(bugs.map((/** @type {any} */ b) => b.lifecycle_stage)).toEqual(["QA", "QA"]);
    expect((await lc("tom", "/advance", { method: "POST" })).data.missing).toEqual(["QAT pass rate is 90%: at least 95% is needed"]);
    await lc("tom", `/tests/${cases[18].id}/runs`, { method: "POST", body: { result: "pass" } });
    l = (await lc("tom", "/findings", { method: "POST", body: { title: "SQL injection on search", severity: "High" } })).data.lifecycle;
    expect((await lc("tom", "/advance", { method: "POST" })).data.missing).toEqual(["1 open Critical/High security finding (fix, or have a Manager accept the risk)"]);
    const f = l.findings[0];
    expect((await lc("tom", `/findings/${f.id}/accept`, { method: "POST", body: { reason: "Behind the WAF", until: "2099-01-01" } })).status).toBe(403);
    expect((await lc("mia", `/findings/${f.id}/accept`, { method: "POST", body: { reason: "Behind the WAF", until: "2000-01-01" } })).status).toBe(400);
    expect((await lc("mia", `/findings/${f.id}/accept`, { method: "POST", body: { reason: "Behind the WAF", until: "2099-01-01" } })).status).toBe(200);
    // Send back first (a reason is required), then come forward again.
    expect((await lc("tom", "/send-back", { method: "POST", body: { to: "BUILD", reason: "" } })).status).toBe(400);
    expect((await lc("tom", "/send-back", { method: "POST", body: { to: "DRAFT", reason: "Rethink" } })).status).toBe(400);
    l = (await lc("tom", "/send-back", { method: "POST", body: { to: "BUILD", reason: "Totals wrong in Firefox" } })).data.lifecycle;
    expect(l.stage).toBe("BUILD");
    await lc("tom", "/checklist/built", { method: "PUT", body: { done: true } });
    expect((await lc("tom", "/advance", { method: "POST" })).data.lifecycle.stage).toBe("QA");
    expect((await lc("tom", "/advance", { method: "POST" })).data.lifecycle.stage).toBe("CLOSE");
  }, SLOW);

  it("closing: Live, delivered, deliverables locked, SLAs stopped; the history and activity log record every step", async () => {
    await lc("tom", "/checklist/handover", { method: "PUT", body: { done: true } });
    const l = (await lc("tom", "/advance", { method: "POST" })).data.lifecycle;
    expect(l).toMatchObject({ state: "closed", sla: null, progress: 100 });
    const [{ data }] = await db`SELECT data FROM systems WHERE id = ${systemId}`;
    expect(JSON.parse(data)).toMatchObject({ status: "LIVE", progress: 100 });
    expect(JSON.parse(data).finishedAt).toBeTruthy();
    expect(l.documents.filter((/** @type {any} */ d) => d.deliverable_key).every((/** @type {any} */ d) => d.locked_at)).toBe(true);
    expect((await lc("tom", "/advance", { method: "POST" })).status).toBe(409);
    expect((await as("ada", `/api/systems/${systemId}`, { method: "DELETE" })).status).toBe(409);
    expect(
      l.history
        .map((/** @type {any} */ h) => `${h.kind}:${h.from_code ?? ""}>${h.to_code}`)
        .reverse(),
    ).toEqual(["start:>DRAFT", "advance:DRAFT>SIGN", "decline:SIGN>DRAFT", "advance:DRAFT>SIGN", "advance:SIGN>BUILD", "skip:BUILD>QA", "send_back:QA>BUILD", "advance:BUILD>QA", "advance:QA>CLOSE", "close:CLOSE>CLOSE"]);
    const acts = await db`SELECT action FROM activity WHERE target = ${systemId} AND action IN ('stage_changed', 'signoff_approved', 'signoff_declined', 'security_risk_accepted', 'stage_skip_requested')`;
    expect(acts.filter((/** @type {any} */ a) => a.action === "stage_changed")).toHaveLength(9);
    expect(acts.map((/** @type {any} */ a) => a.action)).toEqual(expect.arrayContaining(["signoff_declined", "signoff_approved", "security_risk_accepted", "stage_skip_requested"]));
    // The history is never rewritten by the app.
    await expect(
      db.begin(async (/** @type {any} */ tx) => {
        await tx`SET LOCAL ROLE pulse_app`;
        await tx`SELECT set_config('app.org_id', ${orgs.a.id}, true), set_config('app.workspace_id', ${`${orgs.a.id}-ws`}, true)`;
        await tx`DELETE FROM project_stage_history WHERE system_id = ${systemId}`;
      }),
    ).rejects.toThrow(/permission/);
  }, SLOW);

  it("the pipeline and the report", async () => {
    const pipe = (await as("mia", "/api/lifecycle/pipeline")).data;
    expect(pipe.projects.find((/** @type {any} */ p) => p.id === systemId)).toMatchObject({ stage: "CLOSE", state: "closed", sentBack: true });
    const rep = (await as("mia", "/api/lifecycle/report")).data;
    expect(rep.totals.closed).toBeGreaterThanOrEqual(1);
    expect(rep.stages.find((/** @type {any} */ s) => s.code === "SIGN")).toMatchObject({ sendBacks: 1 });
    expect(rep.stages.find((/** @type {any} */ s) => s.code === "QA")).toMatchObject({ sendBacks: 1 });
    expect(rep.passRates.QAT).toMatchObject({ total: 20, pass: 19, rate: 95 });
    expect(rep.findings.High).toEqual({ open: 0, total: 1 });
    expect(rep.signoffTurnaroundDays).not.toBeNull();
    expect((await as("bob", "/api/lifecycle/pipeline")).data.projects).toEqual([]);
  }, SLOW);

  it("the stage-mapping migration places each project by the same rules as the code, and flags what it can't", async () => {
    const [{ id: tid }] = await db`SELECT id FROM lifecycle_templates WHERE organization_id = ${orgs.a.id} AND status = 'published' AND name = 'Mini'`;
    const cases = [
      { status: "IDEA", progress: 0 },
      { status: "IDEA", progress: 0, pcn: { signatories: [{ status: "PENDING" }] } },
      { status: "IDEA", progress: 0, pcn: { signatories: [{ status: "DECLINED" }] } },
      { status: "UPCOMING", progress: 0, pcn: { signatories: [{ status: "APPROVED" }] } },
      { status: "UPCOMING", progress: 5 },
      { status: "WIP", progress: 40 },
      { status: "TESTING", progress: 88 },
      { status: "TESTING", progress: 100, finishedAt: "2026-10-01" },
      { status: "TO_DEPLOY", progress: 97 },
      { status: "LIVE", progress: 100, finishedAt: "2026-01-01" },
      { status: "ON_HOLD", progress: 0 },
    ];
    const now = new Date().toISOString();
    await db.begin(async (/** @type {any} */ tx) => {
      for (const [i, c] of cases.entries()) {
        await tx`INSERT INTO systems (id, sort, data, key, organization_id, workspace_id) VALUES (${`map-${i}-${tag}`}, ${100 + i}, ${JSON.stringify({ name: `Map ${i}`, ...c })}, ${`MAP${"ABCDEFGHIJK"[i]}`}, ${orgs.b.id}, ${`${orgs.b.id}-ws`})`;
      }
    });
    // B gets a template of its own to map onto (the function takes any organisation and template).
    await db`INSERT INTO lifecycle_templates (id, organization_id, family_id, version, status, is_default, name, definition, created_at) SELECT ${`b${tid.slice(1)}`}, ${orgs.b.id}, ${`b${tid.slice(1)}`}, 1, 'published', 1, 'Mapped', definition, ${now} FROM lifecycle_templates WHERE id = ${tid}`;
    const out = await db`SELECT * FROM lifecycle_map_projects(${orgs.b.id}, ${`b${tid.slice(1)}`})`;
    for (const [i, c] of cases.entries()) {
      const row = out.find((/** @type {any} */ r) => r.system_id === `map-${i}-${tag}`);
      expect([row.stage, c.status]).toEqual([mapExistingProject(c).stage, c.status]);
    }
    const lives = await db`SELECT system_id, stage_code, state, migrated FROM project_lifecycle WHERE organization_id = ${orgs.b.id} ORDER BY system_id`;
    expect(lives).toHaveLength(10); // ON_HOLD is flagged, not mapped
    expect(lives.find((/** @type {any} */ r) => r.system_id === `map-9-${tag}`)).toMatchObject({ stage_code: "CLOSE", state: "closed", migrated: 1 });
    const [{ data }] = await db`SELECT data FROM systems WHERE id = ${`map-7-${tag}`}`;
    expect(JSON.parse(data).status).toBe("LIVE");
    const hist = await db`SELECT kind, by_name FROM project_stage_history WHERE system_id = ${`map-5-${tag}`}`;
    expect(hist).toEqual([{ kind: "migrate", by_name: "Migration 0026" }]);
    // Running it again changes nothing: already-mapped projects are left alone.
    expect((await db`SELECT * FROM lifecycle_map_projects(${orgs.b.id}, ${`b${tid.slice(1)}`})`).map((/** @type {any} */ r) => r.system_id)).toEqual([`map-10-${tag}`]);
  }, SLOW);
});
