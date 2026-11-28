// Sample data for the project page (docs/design/project-cockpit-mockups.html), so every tab has something to show:
// risks across the heat map, security findings (one fixed, one accepted), QAT and UAT test cases with results (a
// failure raises its bug), on one project. It goes through the real API of a local Worker (npm run dev:api, on the
// Neon dev branch), signed in as a QA account, so every rule and the activity log apply as for a person.
//
//   node scripts/demo-cockpit.mjs [--project demo-whatsapp-customer-channel] [--org omnicontact] [--user qa-admin]
//
// The password comes from QA_PASSWORD in .dev.vars (or PMS_PASSWORD). It only talks to a Worker on this machine
// (127.0.0.1 or localhost): never the live site. Titles start "Demo:", and anything already there is left alone, so
// running it twice adds nothing.
import { existsSync, readFileSync } from "node:fs";

const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const base = arg("url", "http://127.0.0.1:8787");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error(`Refusing ${base}: this script only talks to a Worker on this machine (npm run dev:api).`);
  process.exit(1);
}
const projectId = arg("project", "demo-whatsapp-customer-channel");
const org = arg("org", "omnicontact");
const user = arg("user", "qa-admin");
const vars = existsSync(new URL("../.dev.vars", import.meta.url)) ? readFileSync(new URL("../.dev.vars", import.meta.url), "utf8") : "";
const password = process.env.PMS_PASSWORD ?? vars.match(/^QA_PASSWORD=["']?([^"'\r\n]+)/m)?.[1];
if (!password) {
  console.error("No password: set QA_PASSWORD in .dev.vars or PMS_PASSWORD.");
  process.exit(1);
}

let cookie = "";
/** @param {string} path @param {string} [method] @param {unknown} [body] */
async function call(path, method = "GET", body) {
  // From a laptop the dev database drops connections now and then: a read is tried again (a write isn't; run the
  // script again instead, it skips what's there).
  for (let attempt = 1; method === "GET" && attempt < 3; attempt++) {
    const r = await fetch(`${base}/api${path}`, { headers: cookie ? { cookie } : {} });
    if (r.status < 500) return /** @type {any} */ (await r.json().catch(() => null));
  }
  const res = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return /** @type {any} */ (data);
}

await call("/login", "POST", { organization: org, username: user, password });
let data = await call("/data");
if (!data.systems.some((/** @type {any} */ s) => s.id === projectId)) {
  // The project may be in another of this person's workspaces.
  for (const w of data.tenant?.workspaces ?? []) {
    await call("/me/workspace", "POST", { workspaceId: w.id });
    data = await call("/data");
    if (data.systems.some((/** @type {any} */ s) => s.id === projectId)) break;
  }
}
if (!data.systems.some((/** @type {any} */ s) => s.id === projectId)) throw new Error(`No project ${projectId} in ${user}'s workspaces`);
const people = /** @type {{ id: string; name: string; role: string }[]} */ (data.users);
const pick = (/** @type {number} */ i) => people[i % people.length]?.id ?? null;
const lc = `/systems/${projectId}/lifecycle`;
let view = (await call(lc)).lifecycle;
if (!view) throw new Error(`${projectId} has no lifecycle`);
const has = (/** @type {any[]} */ list, /** @type {string} */ field, /** @type {string} */ title) => list.some((x) => x[field] === title);
let added = 0;

const RISKS = [
  ["Demo: Meta business verification is delayed past the pilot date", 4, 5, "Escalate through the client's account manager; prepare SMS fallback for the pilot", 0],
  ["Demo: Message template approvals take longer than planned", 3, 4, "Submit templates a week early; keep two approved fallbacks", 1],
  ["Demo: Customer data leaves the agreed hosting region", 2, 5, "Data residency review with the client's security team", 2],
  ["Demo: Agents need more training than scheduled", 3, 2, "Short videos and a sandbox number for practice", 3],
  ["Demo: CRM API rate limits under peak load", 2, 3, "", 4],
];
for (const [risk, l, i, mitigation, who] of RISKS) {
  if (has(view.risks, "risk", /** @type {string} */ (risk))) continue;
  await call(`${lc}/risks`, "POST", { risk, likelihood: l, impact: i, mitigation, ownerId: mitigation ? pick(/** @type {number} */ (who)) : null });
  added++;
}

const FINDINGS = [
  ["Demo: Webhook endpoint accepts unsigned requests", "High", "The callback from Meta isn't checked against its signature.", "open"],
  ["Demo: Session cookie missing SameSite", "Medium", "Set SameSite=Lax on the agent console's cookie.", "fixed"],
  ["Demo: Verbose errors show stack traces", "Low", "Turn off debug output in production.", "accepted"],
  ["Demo: TLS 1.0 still enabled on the test host", "Info", "Only on the test host; production is TLS 1.2+.", "open"],
];
for (const [title, severity, detail, status] of FINDINGS) {
  if (has(view.findings, "title", title)) continue;
  await call(`${lc}/findings`, "POST", { title, severity, detail });
  const f = (await call(lc)).lifecycle.findings.find((/** @type {any} */ x) => x.title === title);
  if (status === "fixed") await call(`${lc}/findings/${f.id}`, "PATCH", { status: "fixed" });
  if (status === "accepted") await call(`${lc}/findings/${f.id}/accept`, "POST", { reason: "Test host only; fixed with the production hardening.", until: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) });
  added++;
}

/** [suite, title, scenario, expected, results in order] */
const TESTS = [
  ["QAT", "Demo: A customer message reaches the agent queue", "", "It appears within 5 seconds", ["fail", "pass"]],
  ["QAT", "Demo: Delivery receipts update the conversation", "", "Sent, delivered and read ticks show", ["pass"]],
  ["QAT", "Demo: Opt-out stops further messages", "", "No message is sent after STOP", ["pass"]],
  ["QAT", "Demo: Template messages use the approved wording", "", "The text matches the approved template", ["pass"]],
  ["QAT", "Demo: Dates show in the customer's time zone", "", "Times are local to the customer", ["fail"]],
  ["QAT", "Demo: Attachments up to 16 MB are accepted", "", "Images and PDFs arrive intact", ["blocked", "pass"]],
  ["UAT", "Demo: An agent answers a new enquiry", "Customer service", "The reply reaches the customer's phone", ["pass"]],
  ["UAT", "Demo: A supervisor reassigns a conversation", "Supervision", "The new agent sees the history", ["pass"]],
  ["UAT", "Demo: Reports show the day's conversations", "Reporting", "Counts match the CRM", ["blocked"]],
  ["UAT", "Demo: Out-of-hours auto-reply", "Customer service", "The out-of-hours message is sent", ["waived"]],
];
for (const [i, [suite, title, scenario, expected, results]] of TESTS.entries()) {
  if (has(view.tests, "title", /** @type {string} */ (title))) continue;
  await call(`${lc}/tests`, "POST", { suite, title, scenario, expected, steps: "1. Sign in as the tester.\n2. Follow the scenario.\n3. Compare with the expected result.", assigneeId: pick(i) });
  const t = (await call(lc)).lifecycle.tests.find((/** @type {any} */ x) => x.title === title);
  for (const result of /** @type {string[]} */ (results)) await call(`${lc}/tests/${t.id}/runs`, "POST", { result, notes: result === "fail" ? "Seen on the test number." : "" });
  added++;
}
view = (await call(lc)).lifecycle;
console.log(`Added ${added} records to ${projectId}: ${view.risks.length} risks, ${view.findings.length} findings, ${view.tests.length} test cases in all.`);
