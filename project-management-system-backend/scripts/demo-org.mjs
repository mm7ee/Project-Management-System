// A demo organisation, "Demo Co", to show the administrator module: Development and Marketing workspaces made from the
// built-in templates, people with different roles, projects and work items, the preset automation rules, an SLA and
// an approval step. Everything goes through the real Worker (worker/index.js), the same code people use.
//
//   npm run demo:org -- dev                  the Neon dev branch (PG_DEV in .dev.vars)
//   npm run demo:org -- stage                a branch of production (PG_STAGE)
//   npm run demo:org -- main --live          the live database: only when asked for
//   … --reset                                deletes an earlier Demo Co first
//
// Run it with scripts/demo-org-cli.mjs (npm run demo:org). It prints the sign-in details once: organisation code demo-co, the usernames, and one password for them all.

export const DEMO_CODE = "demo-co";
const PEOPLE = /** @type {const} */ ([
  { username: "demo.admin", name: "Dana Admin", title: "Operations Director", orgAdmin: true, dev: "admin", mkt: "admin" },
  { username: "demo.dev1", name: "Tendai Moyo", title: "Developer", orgAdmin: false, dev: "developer", mkt: null },
  { username: "demo.dev2", name: "Rudo Ncube", title: "Developer", orgAdmin: false, dev: "developer", mkt: null },
  { username: "demo.lead", name: "Farai Dube", title: "Marketing Lead", orgAdmin: false, dev: null, mkt: "team_lead" },
  { username: "demo.writer", name: "Chipo Banda", title: "Content Writer", orgAdmin: false, dev: null, mkt: "developer" },
  { username: "demo.viewer", name: "Vimbai Shumba", title: "Board member", orgAdmin: false, dev: "reader", mkt: "reader" },
]);

/**
 * Builds Demo Co. `root` is the Worker's database adapter (worker/pg.js); `sql` a direct connection (postgres.js or
 * the test shim) for the first rows, which no API makes (an organisation is a Platform Administrator's to create).
 * @param {{ root: TenantDatabase; sql: any; env?: Record<string, unknown>; reset?: boolean; log?: (s: string) => void }} o
 * @returns {Promise<{ orgId: string; code: string; password: string; usernames: string[]; workspaces: Record<string, string> }>}
 */
export async function buildDemo(o) {
  const log = o.log ?? (() => undefined);
  const { default: worker } = await import("../src/index.js");
  const { hashPassword, newToken } = await import("../src/auth.js");
  const { applyBlueprint } = await import("../src/blueprints.js");
  const { BUILT_IN_TEMPLATES } = await import("../../project-management-system-frontend/src/data/workspaceTemplates.js");
  const { purgeDueOrganizations } = await import("../src/platform.js");
  const sql = o.sql;
  const existing = await sql`SELECT id FROM organizations WHERE code = ${DEMO_CODE}`;
  if (existing.length) {
    if (!o.reset) throw new Error(`Demo Co (${DEMO_CODE}) already exists. Run with --reset to replace it.`);
    await sql`UPDATE organizations SET status = 'archived', delete_after = '2000-01-01T00:00:00.000Z' WHERE id = ${existing[0].id}`;
    await purgeDueOrganizations(o.root);
    log("Deleted the earlier Demo Co.");
  }
  const now = new Date().toISOString();
  const orgId = `demo-${newToken().slice(0, 10)}`;
  const dev = `${orgId}-dev`;
  const password = `Demo-${newToken().slice(0, 6)}-${newToken().slice(0, 6)}!`;
  const hash = await hashPassword(password);
  // The organisation (from the system's template organisation), its Development workspace and its people.
  await sql.begin(async (/** @type {any} */ tx) => {
    await tx`INSERT INTO organizations (id, name, code, status, contact_email, created_at, updated_at) VALUES (${orgId}, 'Demo Co', ${DEMO_CODE}, 'active', 'it@demo-co.example', ${now}, ${now})`;
    await tx`SELECT tenancy_seed_organization(${orgId}, 'pulse-template')`;
    await tx`INSERT INTO workspaces (id, organization_id, name, key, position, icon, colour, description, created_at, updated_at)
             VALUES (${dev}, ${orgId}, 'Development', 'DEV', 0, 'code', '#1f6feb', 'The product team: epics, stories, bugs and sprints.', ${now}, ${now})`;
    await tx`SELECT tenancy_seed_workspace(${dev}, 'pulse-template-ws')`;
    for (const p of PEOPLE) {
      const id = `${orgId}-${p.username.replace(/\W/g, "-")}`;
      await tx`INSERT INTO accounts (id, username, name, title, email, role, password_hash, must_change_password, organization_id, org_admin)
               VALUES (${id}, ${p.username}, ${p.name}, ${p.title}, ${`${p.username}@demo-co.example`}, 'admin', ${hash}, 0, ${orgId}, ${p.orgAdmin ? 1 : 0})`;
      if (p.dev) await tx`INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (${orgId}, ${dev}, ${id}, ${p.dev}, ${now})`;
    }
  });
  const idOf = (/** @type {string} */ username) => `${orgId}-${username.replace(/\W/g, "-")}`;
  // Development set up from the Software Development template.
  const software = /** @type {import("../../project-management-system-frontend/src/data/workspaceTemplates.js").BuiltInTemplate} */ (BUILT_IN_TEMPLATES.find((t) => t.id === "software"));
  await applyBlueprint(o.root.withScope({ orgId, workspaceId: dev }), dev, "Development", software.blueprint);
  log("Development: made from the Software Development template.");

  // From here, through the Worker, as the people themselves.
  /** @type {Promise<unknown>[]} */ const pending = [];
  const env = /** @type {any} */ ({ PG_ROOT: o.root, DATABASE: "postgres", PUBLIC_URL: "http://localhost", ASSETS: { fetch: async () => new Response("", { status: 404 }) }, ...(o.env ?? {}) });
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => pending.push(p), passThroughOnException() {} };
  /** @param {string} path @param {{ method?: string; body?: unknown; cookie?: string }} [r] */
  const call = async (path, r = {}) => {
    const res = await worker.fetch(new Request(`http://localhost${path}`, { method: r.method ?? "GET", headers: { "content-type": "application/json", ...(r.cookie ? { cookie: r.cookie } : {}) }, body: r.body === undefined ? undefined : JSON.stringify(r.body) }), env, /** @type {any} */ (ctx));
    await Promise.allSettled(pending.splice(0));
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${r.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(data)}`);
    return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  /** @param {string} username */
  const signIn = async (username) => (await call("/api/login", { method: "POST", body: { organization: DEMO_CODE, username, password } })).cookie;
  const admin = await signIn("demo.admin");
  const as = (/** @type {string} */ cookie) => (/** @type {string} */ path, /** @type {{ method?: string; body?: unknown }} */ r = {}) => call(path, { ...r, cookie });
  const adm = as(admin);

  // Marketing from its template, and its people.
  const made = await adm("/api/org/workspaces", { method: "POST", body: { name: "Marketing", key: "MKT", icon: "megaphone", colour: "#c2410c", description: "Campaigns, content and events.", template: "builtin:marketing" } });
  const mkt = made.data.workspace.id;
  for (const p of PEOPLE.filter((x) => x.mkt)) {
    const memberships = [...(p.dev ? [{ workspaceId: dev, role: p.dev }] : []), { workspaceId: mkt, role: p.mkt }];
    await adm(`/api/org/people/${idOf(p.username)}/workspaces`, { method: "PUT", body: { workspaces: memberships } });
  }
  log("Marketing: made from the Marketing template.");

  // ---- Development: a project, work, an SLA and the presets.
  const devApi = adm;
  await devApi("/api/me/workspace", { method: "POST", body: { workspaceId: dev } });
  await devApi("/api/systems", { method: "POST", body: { name: "Customer Portal", startedAt: now.slice(0, 10), key: "PORTAL", lead: idOf("demo.admin") } });
  const portal = (await sql`SELECT id FROM systems WHERE workspace_id = ${dev}`)[0].id;
  const fields = /** @type {{ id: string; name: string; options: { id: string; label: string }[] }[]} */ ((await devApi("/api/custom-fields")).data);
  const severity = fields.find((f) => f.name === "Severity");
  const sev = (/** @type {string} */ label) => (severity ? { [severity.id]: severity.options.find((x) => x.label === label)?.id } : {});
  const epic = (await devApi("/api/items", { method: "POST", body: { systemId: portal, itemType: "EPIC", summary: "Self-service account management" } })).data;
  for (const [summary, who, points] of [
    ["Customers can reset their own password", "demo.dev1", 3],
    ["Customers can update their contact details", "demo.dev2", 5],
    ["Download invoices as PDF", "demo.dev1", 8],
  ]) {
    await devApi("/api/items", { method: "POST", body: { systemId: portal, itemType: "STORY", summary, parent: epic.key, assignee: idOf(String(who)), storyPoints: points } });
  }
  await devApi("/api/sla-policies", { method: "POST", body: { name: "Urgent bugs", itemTypes: ["BUG"], priorities: ["HIGHEST", "HIGH"], firstResponseMinutes: 120, resolutionMinutes: 960, warnPercent: 75 } });
  /** @type {string[]} */ const notes = [];
  for (const preset of ["critical-bug", "subtasks-done-review", "due-tomorrow", "overdue-admin"]) {
    const r = (await devApi(`/api/automation/presets/${preset}`, { method: "POST" })).data;
    if (!r.warnings.length) await devApi(`/api/automation/rules/${r.rule.id}`, { method: "PUT", body: { ...r.rule, enabled: true } });
    else notes.push(`Development, "${r.rule.name}": ${r.warnings.join("; ")} (left off)`);
  }
  // Made after the rules are on, so the critical-bug rule assigns it.
  await devApi("/api/items", { method: "POST", body: { systemId: portal, itemType: "BUG", summary: "Login page times out on mobile", priority: "HIGH", customFields: sev("Critical") } });
  await devApi("/api/items", { method: "POST", body: { systemId: portal, itemType: "BUG", summary: "Typo on the pricing page", priority: "LOW", customFields: sev("Low") } });
  log("Development: the Customer Portal project, work items, an SLA for urgent bugs and four rules.");

  // ---- Marketing: a project, a campaign with content, an approval step and the presets.
  await devApi("/api/me/workspace", { method: "POST", body: { workspaceId: mkt } });
  await devApi("/api/systems", { method: "POST", body: { name: "Summer Campaign", startedAt: now.slice(0, 10), key: "SUMMER", lead: idOf("demo.lead") } });
  const summer = (await sql`SELECT id FROM systems WHERE workspace_id = ${mkt}`)[0].id;
  const campaign = (await devApi("/api/items", { method: "POST", body: { systemId: summer, itemType: "CAMPAIGN", summary: "Summer savings 2026" } })).data;
  for (const [type, summary, who] of [
    ["CONTENT", "Landing page copy", "demo.writer"],
    ["CONTENT", "Launch email", "demo.writer"],
    ["SOCIAL_POST", "Instagram teaser", "demo.writer"],
    ["EVENT", "Launch webinar", "demo.lead"],
  ]) {
    await devApi("/api/items", { method: "POST", body: { systemId: summer, itemType: type, summary, parent: campaign.key, assignee: idOf(String(who)) } });
  }
  // Moving out of "Client/Manager Approval" needs the Marketing Lead's approval.
  const wfs = (await devApi("/api/workflows")).data;
  const wf = wfs.workflows.find((/** @type {any} */ w) => w.id === wfs.workspace);
  const statusId = (/** @type {string} */ name) => wfs.statuses.find((/** @type {any} */ s) => s.name === name)?.id;
  const approval = statusId("Client/Manager Approval");
  await devApi(`/api/workflows/${wf.id}`, {
    method: "PUT",
    body: {
      ...wf,
      note: "Client approval needs the Marketing Lead",
      transitions: wf.transitions.map((/** @type {any} */ t) => (t.from === approval && t.to === statusId("Scheduled") ? { ...t, name: "Approve", rules: [...t.rules, { kind: "validator", rule: "approval", value: JSON.stringify({ who: "role:team_lead", needed: 1 }) }] } : t)),
    },
  });
  for (const preset of ["content-review", "weekly-social", "approved-scheduled", "due-tomorrow"]) {
    const r = (await devApi(`/api/automation/presets/${preset}`, { method: "POST" })).data;
    if (preset === "weekly-social") {
      // The weekly plan goes in the Summer Campaign project.
      const action = r.rule.actions[0];
      const cfg = { ...JSON.parse(action.value), systemId: summer };
      await devApi(`/api/automation/rules/${r.rule.id}`, { method: "PUT", body: { ...r.rule, enabled: true, actions: [{ kind: action.kind, value: JSON.stringify(cfg) }] } });
    } else if (!r.warnings.length) await devApi(`/api/automation/rules/${r.rule.id}`, { method: "PUT", body: { ...r.rule, enabled: true } });
    else notes.push(`Marketing, "${r.rule.name}": ${r.warnings.join("; ")} (left off)`);
  }
  log("Marketing: the Summer Campaign project, a campaign with content, an approval step and four rules.");
  for (const n of notes) log(`Note: ${n}`);
  return { orgId, code: DEMO_CODE, password, usernames: PEOPLE.map((p) => p.username), workspaces: { Development: dev, Marketing: mkt } };
}
