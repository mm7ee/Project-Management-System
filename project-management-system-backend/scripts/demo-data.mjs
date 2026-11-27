// Demo data for presentations: realistic projects, people, client requests, blockers, documents
// and Concept Notes, spread over the last 18 months so the charts and reports fill out.
//
// Every record's id starts with "demo-", so it can all be removed again in one go:
//   node scripts/demo-data.mjs seed   > demo-seed.sql    (then: node scripts/db.mjs exec main demo-seed.sql)
//   node scripts/demo-data.mjs remove > demo-remove.sql
// or simply `npm run demo:seed` / `npm run demo:remove` (live database).
//
// Demo people cannot sign in (their password field holds no usable hash). The developers are the
// real DevOps team: their own accounts where they have one, a demo account where they don't.
// Nothing is written to the activity log: that is the security audit trail and only records real events.

const mode = process.argv[2];
if (mode !== "seed" && mode !== "remove") {
  console.error("Usage: node scripts/demo-data.mjs seed|remove");
  process.exit(1);
}

const REMOVE = `-- Removes every demo record (ids starting "demo-").
DELETE FROM assignments WHERE system_id LIKE 'demo-%' OR user_id LIKE 'demo-%';
DELETE FROM document_chunks WHERE doc_id IN (SELECT id FROM documents WHERE work_item_id LIKE 'demo-%');
DELETE FROM work_items WHERE id LIKE 'demo-%';
DELETE FROM boards WHERE id LIKE 'demo-%';
DELETE FROM sprints WHERE id LIKE 'demo-%';
DELETE FROM dashboards WHERE id LIKE 'demo-%';
DELETE FROM custom_fields WHERE id LIKE 'demo-%';
DELETE FROM portal_links WHERE id LIKE 'demo-%';
DELETE FROM api_tokens WHERE id LIKE 'demo-%';
DELETE FROM notification_optouts WHERE user_id LIKE 'demo-%';
DELETE FROM security_level_grants WHERE user_id LIKE 'demo-%';
DELETE FROM saved_filters WHERE id LIKE 'demo-%';
DELETE FROM blockers WHERE id LIKE 'demo-%';
DELETE FROM documents WHERE id LIKE 'demo-%';
DELETE FROM requests WHERE id LIKE 'demo-%';
DELETE FROM notifications WHERE link LIKE '%demo-%' OR digest LIKE '%demo-%';
DELETE FROM systems WHERE id LIKE 'demo-%';
DELETE FROM login_failures WHERE id LIKE 'demo-%';
DELETE FROM users WHERE id LIKE 'demo-%';
`;
if (mode === "remove") {
  process.stdout.write(REMOVE);
  process.exit(0);
}

// ---------- helpers ----------
let seed = 20261017;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days, hour = 9) => {
  const d = new Date(NOW - days * DAY);
  d.setUTCHours(hour, between(0, 59), 0, 0);
  return d.toISOString();
};
const dateAgo = (days) => new Date(NOW - days * DAY).toISOString().slice(0, 10);
const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const initials = (name) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const out = ["-- PMS demo data. Remove with scripts/demo-data.mjs remove.", REMOVE];

// ---------- people ----------
const PEOPLE = [
  ["Tarisai Shumba", "team_lead", "Team Leader"],
  ["Thamani", "assistant", "Projects Assistant"],
  ["Michael Mukwekezeke", "developer", "Developer"],
  ["Vunganayi Hellington", "developer", "Developer"],
];
const people = PEOPLE.map(([name, role, title]) => {
  const first = name.split(" ")[0].toLowerCase();
  return { id: `demo-${first}`, username: `demo.${first}`, name, role, title: `${title} (demo)` };
});
// The DevOps team's existing Pulse accounts (by id), with their full names for Concept Notes.
const TEAM = [
  ["anesu", "Anesu Mashonga"],
  ["ashell", "Ashell Gonese"],
  ["collins", "Collins Chimbganda"],
  ["donald", "Donald Gumbo"],
  ["kundai", "Kundai Muzhona"],
  ["mcdonald", "Macdonald Chiroro"],
  ["mutsa", "Mutsa Mwanza"],
  ["paul", "Paul Tshuma"],
  ["remedy", "Maguta Remedy"],
  ["tennyson", "Tennyson Zvaita"],
  ["tino", "Tinotenda Mukadzambo"],
];
const P = Object.fromEntries([
  ...people.map((p) => [p.name.split(" ")[0], p.id]),
  ...TEAM.map(([id, name]) => [id === "remedy" ? "Remedy" : name.split(" ")[0], id]),
  ["Waraidzo", "waraidzo"], // the real manager: signs every Concept Note
]);
const nameOf = Object.fromEntries([...people.map((p) => [p.id, p.name]), ...TEAM, ["waraidzo", "Waraidzo"]]);
for (const p of people) {
  out.push(
    `INSERT INTO users (id, username, name, title, role, password_hash, prefs) VALUES (${q(p.id)}, ${q(p.username)}, ${q(p.name)}, ${q(p.title)}, ${q(p.role)}, '!demo-account-no-sign-in', '{}');`,
  );
}

// ---------- projects ----------
// [name, status, description, lead, developers, started (days ago), length (days), progress, extras]
const CLIENTS = ["Zuva Insurance", "Mhepo Mobile", "Kopje Bank", "Savanna Health", "Baobab Retail", "Nyika Power", "Omni Contact (internal)"];
const PROJECTS = [
  // Live
  ["Contact Centre CRM", "LIVE", "Single customer view for agents: history, tickets and notes across every channel.", "Anesu", ["Anesu"], 520, 150, 100, { engagement: 2140 }],
  ["Agent Scorecard Dashboard", "LIVE", "Daily KPIs per agent: handle time, first-call resolution and QA scores.", "Ashell", ["Ashell"], 470, 95, 100, { engagement: 1580 }],
  ["IVR Call Routing Manager", "LIVE", "Lets supervisors change IVR menus and routing rules without a vendor ticket.", "Collins", ["Collins"], 430, 120, 100, { engagement: 640, health: "Maintenance", maintenanceNote: "Adding Shona and Ndebele menu prompts", maintenanceDays: 6 }],
  ["Payroll Self-Service Portal", "LIVE", "Staff view payslips, tax certificates and update banking details.", "Remedy", ["Remedy"], 400, 110, 100, { engagement: 1910 }],
  ["Client Billing & Invoicing", "LIVE", "Generates monthly client invoices from billable minutes and SLA credits.", "Anesu", ["Anesu"], 330, 130, 100, { engagement: 520 }],
  ["Workforce Scheduler", "LIVE", "Forecasts call volumes and builds agent rosters by skill and shift.", "Tennyson", ["Tennyson"], 300, 120, 100, { engagement: 1230, health: "Maintenance", maintenanceNote: "Re-tuning the forecast for the festive season peak", maintenanceDays: 3 }],
  ["Quality Assurance Call Review", "LIVE", "Random call sampling, scoring forms and coaching notes for QA analysts.", "Kundai", ["Kundai"], 250, 90, 100, { engagement: 870 }],
  ["Knowledge Base Portal", "LIVE", "Searchable product scripts and FAQs for agents, per client campaign.", "Michael", ["Michael"], 190, 75, 100, { engagement: 1460 }],
  // Completed
  ["Visitor Management System", "COMPLETED", "Front-desk visitor sign-in with badges and host notifications.", "Paul", ["Paul"], 540, 70, 100, {}],
  ["Asset Register", "COMPLETED", "Tracks laptops, headsets and desks issued to staff.", "Tinotenda", ["Donald"], 360, 60, 100, {}],
  ["Staff Pulse Survey", "COMPLETED", "Quarterly anonymous engagement survey with trend reports.", "Kundai", ["Kundai"], 215, 45, 100, {}],
  ["Leave Planner", "COMPLETED", "Team leave calendar with cover checks before approval.", "Remedy", ["Remedy"], 150, 55, 100, {}],
  // In progress
  ["WhatsApp Customer Channel", "WIP", "Two-way WhatsApp support for clients' customers, routed into the CRM.", "Collins", ["Collins", "Vunganayi"], 110, 150, 55, { stalled: 0 }],
  ["Recruitment & Onboarding Portal", "WIP", "Applicant tracking, assessments and first-week onboarding checklists.", "Remedy", ["Remedy", "Macdonald"], 95, 85, 72, { overdue: true }],
  ["Sales Commission Calculator", "WIP", "Calculates agent commission from sales campaigns and clawbacks.", "Anesu", ["Anesu", "Donald"], 80, 120, 35, { stalled: 23 }],
  ["Client SLA Reporting Hub", "WIP", "Live SLA dashboards each client can log in to see.", "Ashell", ["Ashell", "Kundai"], 70, 110, 48, {}],
  ["Training Academy LMS Integration", "WIP", "Links the learning platform to rosters so training is booked around shifts.", "Tennyson", ["Tennyson", "Mutsa"], 60, 66, 63, { atRisk: true }],
  ["Speech Analytics Pilot", "WIP", "Transcribes recorded calls and flags compliance phrases and sentiment.", "Collins", ["Collins", "Anesu"], 45, 140, 22, { stalled: 31 }],
  // Testing
  ["Fleet & Transport Booking", "TESTING", "Books staff transport for night shifts and tracks routes.", "Donald", ["Paul"], 120, 125, 88, {}],
  ["Procurement Requests", "TESTING", "Purchase requests with budget checks and approvals.", "Paul", ["Michael"], 100, 98, 91, { overdue: true }],
  ["Customer Feedback Kiosk", "TESTING", "Tablet survey at walk-in centres feeding the CSAT dashboard.", "Kundai", ["Vunganayi"], 85, 110, 84, {}],
  // To deploy
  ["Shift Swap Mobile App", "TO_DEPLOY", "Agents swap shifts from their phones; team leaders approve in one tap.", "Tennyson", ["Tinotenda"], 140, 145, 97, {}],
  ["Document E-Signature", "TO_DEPLOY", "Contracts and policies signed electronically with an audit trail.", "Remedy", ["Macdonald"], 130, 135, 95, {}],
  // Upcoming
  ["Debt Collections Workbench", "UPCOMING", "Promise-to-pay tracking and dialler lists for collections campaigns.", "Anesu", [], -12, 120, 0, { pcn: "APPROVED" }],
  ["AI Chat Assistant", "UPCOMING", "Website chatbot that answers routine questions and hands over to agents.", "Mutsa", [], -30, 150, 0, { pcn: "APPROVED" }],
  // Ideas
  ["Agent Wellness Tracker", "IDEA", "Break reminders and wellbeing check-ins to reduce burnout and attrition.", "Kundai", [], 0, 0, 0, { pcn: "PENDING" }],
  ["Predictive Staffing Model", "IDEA", "Machine-learning forecast of call volumes from campaigns, weather and holidays.", "Tennyson", [], 0, 0, 0, { pcn: "DRAFT" }],
];

// Which part of the business each demo project serves (the Projects page's workspace filter).
const WORKSPACE = {
  "Contact Centre CRM": "Projects",
  "Agent Scorecard Dashboard": "Projects",
  "IVR Call Routing Manager": "Projects",
  "Payroll Self-Service Portal": "HR",
  "Client Billing & Invoicing": "Projects",
  "Workforce Scheduler": "Projects",
  "Quality Assurance Call Review": "Projects",
  "Knowledge Base Portal": "Projects",
  "Visitor Management System": "Projects",
  "Asset Register": "Projects",
  "Staff Pulse Survey": "HR",
  "Leave Planner": "HR",
  "WhatsApp Customer Channel": "Projects",
  "Recruitment & Onboarding Portal": "HR",
  "Sales Commission Calculator": "Projects",
  "Client SLA Reporting Hub": "Projects",
  "Training Academy LMS Integration": "HR",
  "Speech Analytics Pilot": "Projects",
  "Fleet & Transport Booking": "Projects",
  "Procurement Requests": "Projects",
  "Customer Feedback Kiosk": "Projects",
  "Shift Swap Mobile App": "Projects",
  "Document E-Signature": "Projects",
  "Debt Collections Workbench": "Projects",
  "AI Chat Assistant": "Projects",
  "Agent Wellness Tracker": "HR",
  "Predictive Staffing Model": "Projects",
};

const systems = [];
PROJECTS.forEach(([name, status, description, leadKey, devKeys, startedDays, length, progress, x], i) => {
  const id = `demo-${slug(name)}`;
  const lead = P[leadKey];
  const s = {
    id,
    name,
    short: initials(name).slice(0, 3),
    description,
    url: "",
    status,
    owner: "Systems Team",
    ...(WORKSPACE[name] ? { workspace: WORKSPACE[name] } : {}),
    lead,
    engagement: x.engagement ?? (status === "COMPLETED" ? between(60, 300) : 0),
    progress,
    startedAt: dateAgo(Math.max(startedDays, 0)),
  };
  if (status === "UPCOMING") s.startedAt = dateAgo(startedDays); // a future start
  if (status === "IDEA") s.startedAt = dateAgo(-60); // no start yet: a placeholder in the future
  const finishedDays = startedDays - length;
  if (status === "LIVE" || status === "COMPLETED") {
    s.finishedAt = dateAgo(finishedDays);
    s.dueAt = dateAgo(finishedDays + between(-12, 10));
    s.health = x.health ?? "Stable";
    if (x.maintenanceNote) {
      s.maintenanceNote = x.maintenanceNote;
      s.maintenanceSince = ago(x.maintenanceDays);
    }
    s.updatedAt = ago(Math.max(finishedDays - between(0, 20), 1), 10);
  } else if (status === "UPCOMING" || status === "IDEA") {
    if (status === "UPCOMING") s.dueAt = dateAgo(startedDays - length);
    s.updatedAt = ago(between(3, 12), 11);
  } else {
    // Overdue: due 5–18 days ago. At risk: due within the week. Otherwise start + planned length.
    s.dueAt = dateAgo(x.overdue ? between(5, 18) : x.atRisk ? -between(3, 6) : startedDays - length);
    s.updatedAt = ago(x.stalled ? x.stalled : between(0, 6), between(8, 16));
  }
  s.updatedBy = initials(nameOf[lead] ?? "OT");
  if (x.pcn) {
    const sig = (who, primary, status, daysAgo, remarks = "") => ({
      userId: P[who],
      name: nameOf[P[who]],
      primary,
      remarks,
      status,
      ...(status !== "PENDING" ? { date: dateAgo(daysAgo) } : {}),
    });
    const signatories =
      x.pcn === "DRAFT"
        ? []
        : x.pcn === "APPROVED"
          ? [sig("Waraidzo", true, "APPROVED", 20, "Approved. Start after the festive peak.")]
          : [sig("Waraidzo", true, "PENDING", 0)];
    s.pcn = {
      title: name,
      originator: nameOf[lead],
      date: dateAgo(x.pcn === "DRAFT" ? 5 : x.pcn === "PENDING" ? 9 : 35),
      type: x.pcn === "DRAFT" ? "Process improvement" : "New system",
      background: `${description} Today this is handled manually with spreadsheets and email, which is slow and hard to report on.`,
      concept: `Build ${name} as a centrally managed system owned by the Systems Team, rolled out to one campaign first.`,
      mechanics: "Discovery workshops with operations, a two-week prototype, pilot on one campaign, then full rollout.",
      objectives: "Reduce manual effort by 40%, give managers live reporting, and improve client satisfaction scores.",
      mainPillar: x.pcn === "DRAFT" ? "Innovation" : "Customer",
      supportingPillars: ["Business Performance", "People"],
      proposedDates: [dateAgo(-30), dateAgo(-150)],
      signatories,
    };
    s.pcnBy = lead;
  }
  systems.push(s);
  // A temporary key; the block after the projects gives each a proper one that no real project uses.
  out.push(`INSERT INTO systems (id, sort, data, key) VALUES (${q(id)}, ${1000 + i}, ${q(JSON.stringify(s))}, ${q(`QQ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`)});`);
  // Completed projects keep their lead but no longer hold developers' project slots.
  if (status !== "COMPLETED") for (const d of devKeys) out.push(`INSERT INTO assignments (user_id, system_id) VALUES (${q(P[d])}, ${q(id)}) ON CONFLICT DO NOTHING;`);
});
// Anesu ends up on four projects: one over the limit, to show the overload flag and suggestions.

// Project keys, the way Pulse suggests them (initials, or the first five letters of a one-word name),
// with a letter added where a real project already has that key.
out.push(`DO $$
DECLARE r RECORD; words TEXT[]; kept TEXT[]; w TEXT; base TEXT; cand TEXT; n INTEGER;
BEGIN
  FOR r IN SELECT id, data FROM systems WHERE id LIKE 'demo-%' ORDER BY sort LOOP
    words := ARRAY(SELECT x FROM regexp_split_to_table(upper(COALESCE(r.data::json ->> 'name', '')), '[^A-Z]+') AS x WHERE x <> '');
    kept := ARRAY(SELECT x FROM unnest(words) AS x WHERE x NOT IN ('A', 'AN', 'AND', 'FOR', 'IN', 'OF', 'ON', 'THE', 'TO', 'WITH'));
    IF COALESCE(array_length(kept, 1), 0) >= 2 THEN words := kept; END IF;
    IF COALESCE(array_length(words, 1), 0) >= 2 THEN
      base := ''; FOREACH w IN ARRAY words LOOP base := base || left(w, 1); END LOOP; base := left(base, 10);
    ELSIF COALESCE(array_length(words, 1), 0) = 1 THEN base := rpad(left(words[1], 5), 2, 'X');
    ELSE base := 'PRJ'; END IF;
    cand := base; n := 0;
    WHILE EXISTS (SELECT 1 FROM systems WHERE key = cand AND id <> r.id) LOOP
      n := n + 1;
      cand := CASE WHEN n <= 26 THEN left(base, 9) || chr(64 + n) ELSE left(base, 8) || chr(64 + (n - 1) / 26) || chr(65 + (n - 1) % 26) END;
    END LOOP;
    UPDATE systems SET key = cand WHERE id = r.id;
  END LOOP;
END $$;`);

// Work items, collected here and written out (numbered per project, oldest first) after the requests.
const items = [];
const KIND_LABEL = { NEW_MODULE: "new-module", CHANGE: "change", ENHANCEMENT: "enhancement", BUG_FIX: "bug-fix" };
const addDays = (iso, days) => new Date(Date.parse(iso) + days * DAY).toISOString();

// ---------- feature requests ----------
const REQUESTS = [
  ["Add callback scheduling", "NEW_MODULE", "Customers pick a callback slot; the dialler queues it."],
  ["Export report to Excel", "ENHANCEMENT", "Managers want the weekly view as an .xlsx file."],
  ["Fix duplicate customer records", "BUG_FIX", "Same caller appears twice after a number change."],
  ["Change SLA target from 80/20 to 85/15", "CHANGE", "New contract terms from the client."],
  ["Single sign-on with Microsoft 365", "ENHANCEMENT", "Staff should sign in with their work account."],
  ["Add Ndebele language option", "ENHANCEMENT", "Client is launching a Bulawayo campaign."],
  ["Dashboard loads slowly in the morning", "BUG_FIX", "Takes over 20 seconds between 07:30 and 08:30."],
  ["New disposition codes for campaign", "CHANGE", "Twelve new outcome codes for the renewals campaign."],
  ["Supervisor live-listen module", "NEW_MODULE", "Supervisors listen in and whisper-coach on live calls."],
  ["Bulk SMS after resolved tickets", "NEW_MODULE", "Send a satisfaction survey SMS when a ticket closes."],
  ["Mask card numbers in notes", "BUG_FIX", "PCI requirement: card numbers typed in notes must be hidden."],
  ["Show agent photo on scorecard", "ENHANCEMENT", "Requested by the floor managers for the TV wall."],
  ["Monthly PDF statement for client", "NEW_MODULE", "Auto-emailed SLA statement on the 1st of each month."],
  ["Change approval flow to two levels", "CHANGE", "Finance wants a second approver above $500."],
  ["Wrong totals on public holidays", "BUG_FIX", "Holiday rates are not applied to night shifts."],
  ["API for client's ticketing system", "NEW_MODULE", "Client wants tickets synced into their own ServiceDesk."],
  ["Dark mode for agents", "ENHANCEMENT", "Night-shift agents asked for a darker screen."],
  ["Add QR code check-in", "ENHANCEMENT", "Visitors scan a QR code instead of typing details."],
];
const active = systems.filter((s) => s.status !== "IDEA");
const reqCount = 64;
for (let i = 0; i < reqCount; i++) {
  const [title, kind, description] = REQUESTS[(i * 7) % REQUESTS.length];
  const createdDays = Math.round(395 - (i / reqCount) * 390 + between(-6, 6));
  // A request goes to a project that had started by then; recent ones favour work in flight.
  const started = active.filter((s) => Date.parse(s.startedAt) <= NOW - createdDays * DAY);
  const inFlight = started.filter((s) => !["LIVE", "COMPLETED"].includes(s.status));
  const sys = pick(createdDays < 60 && inFlight.length && rand() < 0.7 ? inFlight : started.length ? started : active);
  const age = createdDays;
  let status;
  if (age > 120) status = pick(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED"]);
  else if (age > 45) status = pick(["COMPLETED", "COMPLETED", "IN_PROGRESS", "TESTING", "ON_HOLD"]);
  else status = pick(["NOT_STARTED", "NOT_STARTED", "IN_PROGRESS", "IN_PROGRESS", "TESTING", "COMPLETED"]);
  const priority = pick(["CRITICAL", "HIGH", "HIGH", "MEDIUM", "MEDIUM", "MEDIUM", "LOW", "LOW"]);
  const devs = PROJECTS.find((p) => `demo-${slug(p[0])}` === sys.id)[4];
  const assignee = status === "NOT_STARTED" && rand() < 0.4 ? null : P[pick(devs.length ? devs : ["Anesu", "Ashell", "Remedy"])];
  const dueDays = createdDays - between(14, 45); // days ago (negative = in the future)
  const completedDays = status === "COMPLETED" ? Math.max(1, createdDays - between(7, 50)) : null;
  const late = status !== "COMPLETED" && status !== "CANCELLED" && dueDays > 0;
  const notes =
    status === "ON_HOLD"
      ? "Waiting for the client to confirm the requirements."
      : late
        ? "Needs test data from the client before we can finish."
        : status === "IN_PROGRESS" && rand() < 0.4
          ? "Back end done; working on the screens."
          : null;
  const created = ago(createdDays, between(8, 16));
  const updated = completedDays ? ago(completedDays, 15) : ago(Math.max(0, createdDays - between(1, 10)), 14);
  const work = { NOT_STARTED: "TODO", IN_PROGRESS: "IN_PROGRESS", ON_HOLD: "IN_PROGRESS", TESTING: "IN_REVIEW", COMPLETED: "DONE", CANCELLED: "DONE" }[status];
  // How it moved: To Do, then on through the statuses to where it is now.
  const path = { TODO: ["TODO"], IN_PROGRESS: ["TODO", "IN_PROGRESS"], IN_REVIEW: ["TODO", "IN_PROGRESS", "IN_REVIEW"], DONE: status === "CANCELLED" ? ["TODO", "DONE"] : ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] }[work];
  items.push({
    id: `demo-fr-${i + 1}`,
    systemId: sys.id,
    type: kind === "BUG_FIX" ? "BUG" : "STORY",
    summary: title,
    description,
    status: work,
    resolution: status === "COMPLETED" ? "DONE" : status === "CANCELLED" ? "WONT_DO" : null,
    onHold: status === "ON_HOLD",
    priority: priority === "CRITICAL" ? "HIGHEST" : priority,
    assignee,
    reporter: pick([P.Tarisai, P.Thamani]),
    due: dateAgo(dueDays),
    created,
    updated,
    resolved: work === "DONE" ? updated : null,
    source: "client_request",
    client: CLIENTS[(i * 3) % CLIENTS.length],
    notes,
    labels: [KIND_LABEL[kind]],
    path,
  });
}

// ---------- work items in flight ----------
// Each project being built gets epics broken into stories, tasks and bugs (some with sub-tasks), done
// in line with the project's progress, with estimates, logged time, comments and links.
const EPICS = [
  [
    "Discovery and design",
    [
      ["STORY", "Map the current process with operations", "Sit with two team leaders and write down every step, form and spreadsheet used today."],
      ["TASK", "Write the solution design", "Screens, data model, integrations and the go-live plan, for sign-off."],
      ["STORY", "Agree the reporting the client needs", "Which figures, how often, and who receives them."],
    ],
  ],
  [
    "Build the core screens",
    [
      ["STORY", "Agents can search and open a record", "Search by name, phone number or reference; open the full history in one click."],
      ["STORY", "Supervisors see the live queue", "Waiting items, oldest first, with who is working on each."],
      ["TASK", "Set up the API and database", "Tables, migrations and the first endpoints, with tests."],
      ["BUG", "Search times out on large result sets", "Searching a common surname takes over 30 seconds and then fails."],
    ],
  ],
  [
    "Testing and go-live",
    [
      ["TASK", "Write the UAT test scripts", "One script per user journey, with expected results."],
      ["STORY", "Pilot with one campaign", "Two weeks on one campaign before everyone moves across."],
      ["TASK", "Train team leaders", "A one-hour session per shift, and a one-page guide."],
      ["BUG", "Dates show in the wrong time zone", "Times on the history tab are two hours behind Harare time."],
    ],
  ],
];
const SUBTASKS = ["Front end", "Back end", "Tests"];
const COMMENTS = [
  "@demo.tarisai can you confirm the client signed off the design before we start?",
  "Done on my side. **Ready for review**; the test steps are in the description.",
  "Blocked until we get test data. @demo.tarisai please chase the client.",
  "Found the cause: the index on `customer_name` was missing. Fixed and re-tested.",
  "Moving this to next week: the pilot campaign starts on Monday.",
  "Looks good. One small change: show the date as *dd Mmm yyyy* to match the rest of the app.",
];
const inFlight = systems.filter((s) => ["WIP", "TESTING", "TO_DEPLOY"].includes(s.status));
let n = 0;
const comments = [];
const links = [];
const workLogs = [];
for (const sys of inFlight) {
  const project = PROJECTS.find((p) => `demo-${slug(p[0])}` === sys.id);
  const devs = project[4].length ? project[4].map((d) => P[d]) : [sys.lead];
  const startedDays = Math.max(5, Math.round((NOW - Date.parse(sys.startedAt)) / DAY));
  const leaves = EPICS.reduce((t, [, kids]) => t + kids.length, 0);
  let leaf = 0;
  EPICS.forEach(([epicName, kids], e) => {
    const epicCreated = ago(Math.max(1, startedDays - e * 5), 9);
    const epic = {
      id: `demo-wi-${++n}`,
      systemId: sys.id,
      type: "EPIC",
      summary: epicName,
      description: `Everything for **${epicName.toLowerCase()}** on ${sys.name}.`,
      priority: "HIGH",
      assignee: sys.lead,
      reporter: P.Tarisai,
      created: epicCreated,
      source: "internal",
      labels: [],
    };
    items.push(epic);
    const done = [];
    kids.forEach(([type, summary, description], k) => {
      // Done in order, in step with the project's progress; the next ones are under way.
      const share = leaf++ / leaves;
      const status = share < sys.progress / 100 ? "DONE" : share < sys.progress / 100 + 0.12 ? "IN_REVIEW" : share < sys.progress / 100 + 0.25 ? "IN_PROGRESS" : "TODO";
      const created = addDays(epicCreated, k + 1);
      const daysIn = Math.max(1, Math.round((NOW - Date.parse(created)) / DAY));
      const updated = status === "TODO" ? created : ago(between(0, Math.min(daysIn - 1, 20)), 13);
      const estimate = pick([240, 480, 960, 1440]);
      const assignee = devs[(e + k) % devs.length];
      const item = {
        id: `demo-wi-${++n}`,
        systemId: sys.id,
        type,
        parentId: epic.id,
        summary,
        description,
        status,
        resolution: status === "DONE" ? "DONE" : null,
        priority: type === "BUG" ? pick(["HIGHEST", "HIGH"]) : pick(["HIGH", "MEDIUM", "MEDIUM", "LOW"]),
        assignee,
        reporter: pick([P.Tarisai, sys.lead]),
        created,
        updated,
        resolved: status === "DONE" ? updated : null,
        start: created.slice(0, 10),
        due: dateAgo(Math.round(daysIn / 2) - between(5, 25)),
        estimate,
        remaining: status === "DONE" ? 0 : status === "TODO" ? estimate : Math.round(estimate / 2),
        points: type === "BUG" ? null : pick([1, 2, 3, 5, 8]),
        component: pick(["Front end", "Back end", "Reports", "Integrations"]),
        source: "internal",
        labels: type === "BUG" ? ["defect"] : k === 0 ? ["client-facing"] : [],
        path: { TODO: ["TODO"], IN_PROGRESS: ["TODO", "IN_PROGRESS"], IN_REVIEW: ["TODO", "IN_PROGRESS", "IN_REVIEW"], DONE: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] }[status],
      };
      items.push(item);
      if (status !== "TODO") {
        for (let w = 0; w < between(1, 3); w++) {
          workLogs.push({ itemId: item.id, userId: assignee, minutes: pick([60, 90, 120, 180, 240]), note: pick(["Build", "Fixes after review", "Testing", "Pairing with the lead", ""]), day: ago(between(0, Math.min(daysIn - 1, 25))).slice(0, 10) });
        }
      }
      // Stories get sub-tasks, done as the story is.
      if (type === "STORY" && k % 2 === 0) {
        SUBTASKS.forEach((st, j) => {
          const subDone = status === "DONE" || (status !== "TODO" && j === 0);
          items.push({
            id: `demo-wi-${++n}`,
            systemId: sys.id,
            type: "SUBTASK",
            parentId: item.id,
            summary: `${st}: ${summary.toLowerCase()}`,
            description: "",
            status: subDone ? "DONE" : status === "TODO" ? "TODO" : "IN_PROGRESS",
            resolution: subDone ? "DONE" : null,
            priority: item.priority,
            assignee,
            reporter: assignee,
            created: addDays(created, 1),
            updated: subDone ? updated : addDays(created, 1),
            resolved: subDone ? updated : null,
            source: "internal",
            labels: [],
            path: subDone ? ["TODO", "IN_PROGRESS", "DONE"] : status === "TODO" ? ["TODO"] : ["TODO", "IN_PROGRESS"],
          });
        });
      }
      if (rand() < 0.45) {
        for (let c = 0; c < between(1, 3); c++) {
          comments.push({ itemId: item.id, authorId: pick([assignee, P.Tarisai, sys.lead]), body: pick(COMMENTS), at: addDays(created, c + 1) });
        }
      }
      done.push(item);
    });
    // A bug that holds up a story, and work that relates across the epic.
    const bug = done.find((x) => x.type === "BUG");
    const story = done.find((x) => x.type === "STORY");
    if (bug && story) links.push({ from: bug.id, to: story.id, type: "BLOCKS", at: bug.created, by: bug.reporter });
    if (done.length > 2) links.push({ from: done[0].id, to: done[2].id, type: "RELATES", at: done[2].created, by: done[0].reporter });
  });
}

// One project runs on the Infrastructure deployment workflow: its items in that workflow's statuses.
const INFRA = systems.find((s) => s.name === "Fleet & Transport Booking");
const INFRA_STATUS = { TODO: "BACKLOG", IN_PROGRESS: "IN_PROGRESS", IN_REVIEW: "TESTING", DONE: "CLOSED" };
let infraSeen = 0;
for (const it of items.filter((x) => INFRA && x.systemId === INFRA.id && x.type !== "EPIC")) {
  const to = (st) => INFRA_STATUS[st] ?? st;
  it.status = to(it.status);
  it.path = (it.path ?? ["TODO"]).map(to);
  // Some testing items wait for change approval; some closed ones are only deployed so far.
  if (it.status === "TESTING" && infraSeen++ % 2 === 0) {
    it.status = "CHANGE_APPROVAL";
    it.path = [...it.path, "CHANGE_APPROVAL"];
  } else if (it.status === "CLOSED" && infraSeen++ % 3 === 0) {
    it.path = [...it.path.slice(0, -1), "CHANGE_APPROVAL", "DEPLOYED"];
    it.status = "DEPLOYED";
  } else if (it.status === "CLOSED") {
    it.path = [...it.path.slice(0, -1), "CHANGE_APPROVAL", "DEPLOYED", "CLOSED"];
  }
}

// Numbered per project, oldest first, as Pulse would have numbered them.
items.sort((a, b) => a.created.localeCompare(b.created));
const counters = {};
for (const it of items) it.number = counters[it.systemId] = (counters[it.systemId] ?? 0) + 1;
for (const it of items) {
  it.updated ??= it.created;
  // An epic is done when everything in it is.
  if (it.type === "EPIC") {
    const kids = items.filter((x) => x.parentId === it.id);
    const allDone = kids.length && kids.every((x) => ["DONE", "CLOSED", "DEPLOYED"].includes(x.status));
    const infra = INFRA && it.systemId === INFRA.id;
    it.status = allDone ? (infra ? "CLOSED" : "DONE") : kids.some((x) => !["TODO", "BACKLOG"].includes(x.status)) ? "IN_PROGRESS" : infra ? "BACKLOG" : "TODO";
    it.resolution = allDone ? "DONE" : null;
    it.updated = kids.reduce((m, x) => (x.updated > m ? x.updated : m), it.created);
    it.resolved = allDone ? it.updated : null;
    const first = infra ? "BACKLOG" : "TODO";
    it.path = allDone ? [first, "IN_PROGRESS", it.status] : it.status === "IN_PROGRESS" ? [first, "IN_PROGRESS"] : [first];
  }
  out.push(
    `INSERT INTO work_items (id, system_id, number, type, parent_id, summary, description, status, resolution, on_hold, priority, assignee, reporter, component, story_points, original_estimate, remaining_estimate, start_date, due_date, created_at, updated_at, resolved_at, source, client, notes) VALUES (${[
      q(it.id),
      q(it.systemId),
      it.number,
      q(it.type),
      q(it.parentId ?? null),
      q(it.summary),
      q(it.description ?? ""),
      q(it.status),
      q(it.resolution ?? null),
      it.onHold ? 1 : 0,
      q(it.priority),
      q(it.assignee ?? null),
      q(it.reporter),
      q(it.component ?? null),
      it.points ?? "NULL",
      it.estimate ?? "NULL",
      it.remaining ?? "NULL",
      q(it.start ?? null),
      q(it.due ?? null),
      q(it.created),
      q(it.updated),
      q(it.resolved ?? null),
      q(it.source),
      q(it.client ?? null),
      q(it.notes ?? null),
    ].join(", ")});`,
  );
  for (const l of it.labels) out.push(`INSERT INTO work_item_labels (item_id, label) VALUES (${q(it.id)}, ${q(l)});`);
  for (const u of new Set([it.reporter, it.assignee].filter(Boolean))) {
    out.push(`INSERT INTO work_item_watchers (item_id, user_id, created_at) VALUES (${q(it.id)}, ${q(u)}, ${q(it.created)}) ON CONFLICT DO NOTHING;`);
  }
  // Its status history: created in To Do, then each move spread between creation and the last update.
  const steps = it.path ?? ["TODO"];
  steps.forEach((to, i) => {
    const at = i === 0 ? it.created : new Date(Date.parse(it.created) + ((Date.parse(it.updated) - Date.parse(it.created)) * i) / (steps.length - 1)).toISOString();
    out.push(
      `INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) VALUES (${q(it.id)}, ${i ? q(steps[i - 1]) : "NULL"}, ${q(to)}, ${q(i ? (it.assignee ?? it.reporter) : it.reporter)}, ${q(at)});`,
    );
  });
}
comments.forEach((c, i) =>
  out.push(`INSERT INTO work_item_comments (id, item_id, author_id, body, created_at) VALUES (${q(`demo-c-${i + 1}`)}, ${q(c.itemId)}, ${q(c.authorId)}, ${q(c.body)}, ${q(c.at)});`),
);
links.forEach((l, i) =>
  out.push(`INSERT INTO work_item_links (id, from_id, to_id, link_type, created_by, created_at) VALUES (${q(`demo-l-${i + 1}`)}, ${q(l.from)}, ${q(l.to)}, ${q(l.type)}, ${q(l.by)}, ${q(l.at)});`),
);
workLogs.forEach((w, i) =>
  out.push(`INSERT INTO work_logs (id, item_id, user_id, minutes, note, work_date, created_at) VALUES (${q(`demo-wl-${i + 1}`)}, ${q(w.itemId)}, ${q(w.userId)}, ${w.minutes}, ${q(w.note)}, ${q(w.day)}, ${q(`${w.day}T16:00:00.000Z`)});`),
);
// ---------- Phase 5: security levels, custom fields, GitHub links, service desk ----------
// Two open bugs are "Confidential – Managers only"; the demo manager is also given "HR only".
items
  .filter((it) => it.type === "BUG" && it.status !== "DONE")
  .slice(0, 2)
  .forEach((it) => out.push(`UPDATE work_items SET security_level = 'managers-only' WHERE id = ${q(it.id)};`));
out.push(`INSERT INTO security_level_grants (level_id, user_id) VALUES ('hr-only', ${q(P.Tarisai)}) ON CONFLICT DO NOTHING;`);

// A "Client tier" select and an "Estimated value" number in the Projects workspace, on some items.
out.push(
  `INSERT INTO custom_fields (id, workspace, name, kind, description, required, on_create, on_edit, on_view, on_board, position, created_at, updated_at) VALUES ('demo-cf-tier', 'Projects', 'Client tier (demo)', 'select', 'How important the client is', 0, 1, 1, 1, 1, 90, ${q(ago(30))}, ${q(ago(30))}) ON CONFLICT DO NOTHING;`,
  `INSERT INTO custom_fields (id, workspace, name, kind, description, required, on_create, on_edit, on_view, on_board, position, created_at, updated_at) VALUES ('demo-cf-value', 'Projects', 'Estimated value (demo)', 'number', 'US$', 0, 1, 1, 1, 0, 91, ${q(ago(30))}, ${q(ago(30))}) ON CONFLICT DO NOTHING;`,
  `INSERT INTO custom_field_options (id, field_id, label, position) VALUES ('demo-cfo-gold', 'demo-cf-tier', 'Gold', 1), ('demo-cfo-silver', 'demo-cf-tier', 'Silver', 2), ('demo-cfo-bronze', 'demo-cf-tier', 'Bronze', 3) ON CONFLICT DO NOTHING;`,
);
const projectsItems = items.filter((it) => WORKSPACE[systems.find((s) => s.id === it.systemId)?.name] !== "HR" && it.type !== "SUBTASK");
projectsItems.slice(0, 40).forEach((it, i) => {
  out.push(`INSERT INTO custom_field_values (item_id, field_id, option_id) VALUES (${q(it.id)}, 'demo-cf-tier', ${q(["demo-cfo-gold", "demo-cfo-silver", "demo-cfo-bronze"][i % 3])});`);
  if (i % 2 === 0) out.push(`INSERT INTO custom_field_values (item_id, field_id, value_number) VALUES (${q(it.id)}, 'demo-cf-value', ${(i + 1) * 750});`);
});

// Commits, branches and pull requests from GitHub on a few items in progress.
items
  .filter((it) => it.status === "IN_PROGRESS" && it.type !== "EPIC")
  .slice(0, 6)
  .forEach((it, i) => {
    const sys = systems.find((s) => s.id === it.systemId);
    const idx = systems.indexOf(sys);
    const key = `QQ${String.fromCharCode(65 + Math.floor(idx / 26))}${String.fromCharCode(65 + (idx % 26))}-${it.number}`;
    const repo = `omnicontact/${slug(sys.name)}`;
    const sha = (i + 1).toString(16).padStart(2, "0").repeat(20);
    const at = ago(between(0, 6), 14);
    out.push(
      `INSERT INTO dev_links (id, item_id, kind, repo, ref, title, url, author, state, at, created_at, updated_at) VALUES (${q(`demo-dl-${i}-b`)}, ${q(it.id)}, 'branch', ${q(repo)}, ${q(`feature/${key.toLowerCase()}`)}, ${q(`feature/${key.toLowerCase()}`)}, ${q(`https://github.com/${repo}/tree/feature/${key.toLowerCase()}`)}, 'demo', NULL, ${q(at)}, ${q(at)}, ${q(at)});`,
      `INSERT INTO dev_links (id, item_id, kind, repo, ref, title, url, author, state, at, created_at, updated_at) VALUES (${q(`demo-dl-${i}-c`)}, ${q(it.id)}, 'commit', ${q(repo)}, ${q(sha)}, ${q(`${key}: ${it.summary}`.slice(0, 200))}, ${q(`https://github.com/${repo}/commit/${sha}`)}, ${q(nameOf[it.assignee] ?? "Demo developer")}, NULL, ${q(at)}, ${q(at)}, ${q(at)});`,
    );
    if (i % 2 === 0) {
      out.push(
        `INSERT INTO dev_links (id, item_id, kind, repo, ref, title, url, author, state, at, created_at, updated_at) VALUES (${q(`demo-dl-${i}-p`)}, ${q(it.id)}, 'pull_request', ${q(repo)}, ${q(String(40 + i))}, ${q(`${key} ${it.summary}`.slice(0, 200))}, ${q(`https://github.com/${repo}/pull/${40 + i}`)}, 'demo', ${q(i === 0 ? "merged" : "open")}, ${q(at)}, ${q(at)}, ${q(at)});`,
      );
    }
  });

// Service desk requests in the first live demo project (the real service desk project is left as it is).
const SD = systems.find((s) => s.status === "LIVE") ?? systems[0];
let sdNumber = Math.max(0, ...items.filter((it) => it.systemId === SD.id).map((it) => it.number));
const REQUESTS_SD = [
  ["incident", "BUG", "Agents can't log in to the softphone", "HIGHEST", "IN_PROGRESS", 0.2, "Rudo Moyo", "rudo.moyo@example.com", [["Which system is affected?", "Softphone"], ["How many people are affected?", "A whole site or client"]], true],
  ["incident", "BUG", "Wallboard shows yesterday's figures", "HIGH", "TODO", 1.5, "Farai Ncube", "farai.ncube@example.com", [["Which system is affected?", "Wallboard"], ["How many people are affected?", "My team"]], false],
  ["service-request", "TASK", "New CRM accounts for five agents", "MEDIUM", "TODO", 0.5, "Tendai Chikwanha", "tendai@example.com", [["What do you need?", "A new account"]], false],
  ["service-request", "TASK", "Headset for the Bulawayo team lead", "LOW", "DONE", 6, "Nyasha Dube", "nyasha.dube@example.com", [["What do you need?", "Equipment"]], true],
  ["change", "TASK", "Move the IVR prompts to the new voice", "MEDIUM", "IN_PROGRESS", 3, "Tarisai Shumba", null, [["System to change", "IVR"], ["Preferred change window", "Saturday 18:00–20:00"], ["How would it be rolled back?", "Switch back to the old prompt set"], ["Risk", "Low"]], true],
  ["question", "TASK", "Can we export call notes to Excel?", "LOW", "DONE", 4, "Kuda Sibanda", "kuda.sibanda@example.com", [], true],
];
REQUESTS_SD.forEach(([typeId, type, summary, priority, status, daysAgo, customer, email, answers, replied], i) => {
  sdNumber++;
  const id = `demo-sd-${i + 1}`;
  const created = new Date(NOW - daysAgo * DAY).toISOString();
  const done = status === "DONE";
  const resolved = done ? new Date(Date.parse(created) + 0.6 * daysAgo * DAY).toISOString() : null;
  const assignee = status === "TODO" ? null : P.Michael;
  out.push(
    `INSERT INTO work_items (id, system_id, number, type, summary, description, status, resolution, priority, assignee, reporter, created_at, updated_at, resolved_at, source) VALUES (${[
      q(id), q(SD.id), sdNumber, q(type), q(summary), q("Raised on the service desk portal."), q(status), q(done ? "DONE" : null), q(priority), q(assignee), q(P.Tarisai), q(created), q(resolved ?? created), q(resolved), "'service_desk'",
    ].join(", ")});`,
    `INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at) VALUES (${q(id)}, NULL, 'TODO', ${q(P.Tarisai)}, ${q(created)});`,
    `INSERT INTO sd_requests (item_id, request_type_id, customer_name, customer_email, customer_user_id, portal_link_id, first_response_at, created_at) VALUES (${[
      q(id), q(typeId), q(customer), q(email), q(email ? null : P.Tarisai), q(email ? "demo-pl-1" : null), q(replied ? new Date(Date.parse(created) + 0.05 * DAY).toISOString() : null), q(created),
    ].join(", ")});`,
    ...answers.map(([label, value], k) => `INSERT INTO sd_answers (item_id, field_id, label, value, position) VALUES (${q(id)}, ${q(`demo-q-${k}`)}, ${q(label)}, ${q(value)}, ${k + 1});`),
  );
  if (replied) {
    out.push(
      `INSERT INTO work_item_comments (id, item_id, author_id, body, created_at, public) VALUES (${q(`demo-sdc-${i + 1}`)}, ${q(id)}, ${q(P.Michael)}, ${q("Thanks, we're on it. We'll update you here.")}, ${q(new Date(Date.parse(created) + 0.05 * DAY).toISOString())}, 1);`,
    );
  }
});
// A portal link for the demo client (its secret is unknown, so it can't be used) and a revoked API token.
out.push(
  `INSERT INTO portal_links (id, token_hash, label, created_by, created_at, expires_at, requests) VALUES ('demo-pl-1', ${q(`demo-${slug("unused portal secret")}`)}, 'Demo client operations (demo)', ${q(P.Tarisai)}, ${q(ago(10))}, ${q(new Date(NOW + 80 * DAY).toISOString())}, 5);`,
  `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scope, created_at, expires_at, revoked_at, revoked_by) VALUES ('demo-tok-1', ${q(P.Tarisai)}, 'Reporting script (demo)', ${q(`demo-${slug("unused token")}`)}, 'pms_demo00', 'read', ${q(ago(20))}, ${q(new Date(NOW + 10 * DAY).toISOString())}, ${q(ago(2))}, ${q(P.Tarisai)});`,
  `INSERT INTO notification_optouts (user_id, event) VALUES (${q(P.Michael)}, 'item_updated') ON CONFLICT DO NOTHING;`,
);

out.push(`UPDATE systems SET item_seq = COALESCE((SELECT MAX(number) FROM work_items w WHERE w.system_id = systems.id), 0) WHERE id LIKE 'demo-%';`);
if (INFRA) out.push(`UPDATE systems SET workflow_id = 'infra-deploy' WHERE id = ${q(INFRA.id)};`);

// A board with work-in-progress limits, one column over its limit.
{
  const sys = inFlight[0];
  out.push(`INSERT INTO boards (id, system_id, name, swimlanes, created_at, updated_at) VALUES ('demo-b-1', ${q(sys.id)}, ${q(`${sys.name} board`)}, 'epic', ${q(ago(30))}, ${q(ago(2))});`);
  [
    ["To Do", null, ["TODO"]],
    ["Doing", 1, ["IN_PROGRESS", "IN_REVIEW"]],
    ["Done", null, ["DONE"]],
  ].forEach(([name, limit, statuses], i) => {
    out.push(`INSERT INTO board_columns (id, board_id, name, position, wip_limit) VALUES ('demo-bc-${i + 1}', 'demo-b-1', ${q(name)}, ${i + 1}, ${limit ?? "NULL"});`);
    for (const st of statuses) out.push(`INSERT INTO board_column_statuses (board_id, column_id, status_id) VALUES ('demo-b-1', 'demo-bc-${i + 1}', ${q(st)});`);
  });
}

// Sprints: the board project plans in Scrum. Six finished sprints (each with its snapshot), the running
// one and the next, so velocity, burndown and the sprint report have something to show.
{
  const sys = inFlight[0];
  const LEN = 14;
  const activeStart = Date.parse(dateAgo(5));
  const mine = items.filter((x) => x.systemId === sys.id && x.type !== "EPIC" && x.type !== "SUBTASK");
  out.push(`UPDATE systems SET agile_mode = 'scrum' WHERE id = ${q(sys.id)};`);
  // Its bugs are estimated too, as a Scrum team would.
  for (const x of mine.filter((i) => i.points == null)) {
    x.points = 2;
    out.push(`UPDATE work_items SET story_points = 2 WHERE id = ${q(x.id)};`);
  }
  const key = initials(sys.name).slice(0, 3);
  const sprintsOut = [];
  for (let k = 6; k >= 1; k--) {
    const start = activeStart - k * LEN * DAY;
    sprintsOut.push({ id: `demo-sp-${7 - k}`, name: `${sys.name.split(" ")[0]} Sprint ${7 - k}`, start, state: "CLOSED" });
  }
  sprintsOut.push({ id: "demo-sp-7", name: `${sys.name.split(" ")[0]} Sprint 7`, start: activeStart, state: "ACTIVE", goal: "Customers can start a WhatsApp chat from the website and reach an agent" });
  sprintsOut.push({ id: "demo-sp-8", name: `${sys.name.split(" ")[0]} Sprint 8`, start: activeStart + LEN * DAY, state: "FUTURE", goal: "Supervisors see live WhatsApp queues" });
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  for (const sp of sprintsOut) {
    const end = sp.start + (LEN - 1) * DAY;
    out.push(
      `INSERT INTO sprints (id, system_id, name, goal, start_date, end_date, length_weeks, state, started_at, completed_at, created_by, created_at) VALUES (${[
        q(sp.id),
        q(sys.id),
        q(sp.name),
        q(sp.goal ?? ""),
        q(day(sp.start)),
        q(day(end)),
        2,
        q(sp.state),
        q(sp.state !== "FUTURE" ? new Date(sp.start + 9 * 3_600_000).toISOString() : null),
        q(sp.state === "CLOSED" ? new Date(end + 16 * 3_600_000).toISOString() : null),
        q(P.Tarisai),
        q(new Date(sp.start - 2 * DAY).toISOString()),
      ].join(", ")});`,
    );
    sp.end = end;
  }
  const inSprint = (sp, item) => {
    out.push(`UPDATE work_items SET sprint_id = ${q(sp.id)} WHERE id = ${q(item.id)};`);
    out.push(
      `INSERT INTO sprint_items (sprint_id, item_id, added_at, added_after_start, points, outcome) VALUES (${q(sp.id)}, ${q(item.id)}, ${q(new Date(sp.start + 8 * 3_600_000).toISOString())}, 0, ${item.points ?? "NULL"}, ${q(sp.state === "CLOSED" ? "completed" : null)});`,
    );
  };
  // Finished items belong to the sprint they were finished in.
  // The finished items are shared out over the six sprints in the order they were finished.
  const finished = mine.filter((x) => x.status === "DONE" && x.resolved && Date.parse(x.resolved) < activeStart).sort((a, b) => a.resolved.localeCompare(b.resolved));
  const closedSprints = sprintsOut.filter((x) => x.state === "CLOSED");
  const share = (k) => finished.filter((_, i) => Math.floor((i * closedSprints.length) / Math.max(1, finished.length)) === k);
  for (const [k, sp] of closedSprints.entries()) {
    const done = share(k);
    done.forEach((x) => inSprint(sp, x));
    const completed = done.reduce((n, x) => n + (x.points ?? 0), 0);
    // A little was always committed and not finished, as in real sprints.
    const missed = between(0, 5);
    out.push(
      `INSERT INTO sprint_snapshots (sprint_id, committed_points, completed_points, added_points, removed_points, not_completed_points, committed_items, completed_items, added_items, removed_items, not_completed_items, created_at) VALUES (${[
        q(sp.id),
        completed + missed,
        completed,
        between(0, 3),
        0,
        missed,
        done.length + (missed ? 1 : 0),
        done.length,
        0,
        0,
        missed ? 1 : 0,
        q(new Date(sp.end + 16 * 3_600_000).toISOString()),
      ].join(", ")});`,
    );
  }
  // The running sprint holds the work in progress and the next few to do; the next sprint a few more.
  const open = mine.filter((x) => x.status !== "DONE");
  const doing = open.filter((x) => x.status !== "TODO");
  const todo = open.filter((x) => x.status === "TODO");
  [...doing, ...todo.slice(0, 2)].forEach((x) => inSprint(sprintsOut[6], x));
  todo.slice(2, 5).forEach((x) => inSprint(sprintsOut[7], x));
  // Its done items finished in this sprint count too.
  mine.filter((x) => x.status === "DONE" && x.resolved && Date.parse(x.resolved) >= activeStart).forEach((x) => inSprint(sprintsOut[6], x));
  void key;
}

// One project takes its progress from its work items, to show how that reads.
{
  const sys = inFlight[0];
  const leavesOf = items.filter((x) => x.systemId === sys.id && ["STORY", "TASK", "BUG"].includes(x.type) && x.resolution !== "WONT_DO");
  const pct = leavesOf.length ? Math.round((leavesOf.filter((x) => x.status === "DONE").length / leavesOf.length) * 100) : 0;
  out.push(`UPDATE systems SET progress_from_items = 1, data = jsonb_set(data::jsonb, '{progress}', '${pct}')::text WHERE id = ${q(sys.id)};`);
}

// ---------- blockers ----------
const BLOCKERS = [
  ["demo-whatsapp-customer-channel", "Meta business verification still pending for the client's number", "Collins", 9, null],
  ["demo-sales-commission-calculator", "Finance hasn't signed off the clawback rules", "Anesu", 26, null],
  ["demo-speech-analytics-pilot", "Waiting on GPU server procurement", "Collins", 34, null],
  ["demo-speech-analytics-pilot", "Call recordings for June are missing from the archive", "Anesu", 20, null],
  ["demo-procurement-requests", "UAT testers unavailable until month-end close is done", "Tinotenda", 7, null],
  ["demo-recruitment-onboarding-portal", "Psychometric test vendor API keys not issued", "Remedy", 12, null],
  ["demo-contact-centre-crm", "Telephony vendor API rate limits", "Anesu", 410, [395, "Vendor raised our limit to 50 requests/second."]],
  ["demo-payroll-self-service-portal", "Bank file format changed", "Remedy", 330, [322, "Updated the export to the new format."]],
  ["demo-workforce-scheduler", "Historical volume data incomplete", "Tennyson", 250, [238, "Rebuilt 12 months of history from the dialler logs."]],
  ["demo-client-billing-invoicing", "Tax rate change mid-month", "Anesu", 230, [226, "Pro-rated the change; finance approved."]],
  ["demo-knowledge-base-portal", "Content owners not assigned per client", "Donald", 150, [141, "Operations named an owner for each campaign."]],
  ["demo-fleet-transport-booking", "GPS trackers not yet installed in two buses", "Donald", 40, [28, "Installed; routes now live."]],
  ["demo-shift-swap-mobile-app", "App store review rejected the first build", "Tennyson", 25, [19, "Fixed the privacy notice; approved on resubmission."]],
  ["demo-client-sla-reporting-hub", "Client firewall blocks the dashboard URL", "Ashell", 30, [16, "Client IT whitelisted the domain."]],
];
BLOCKERS.forEach(([sys, text, by, raised, resolved], i) => {
  out.push(
    `INSERT INTO blockers (id, system_id, text, raised_by, raised_at, resolved_by, resolved_at, resolution) VALUES (${[
      q(`demo-bl-${i + 1}`),
      q(sys),
      q(text),
      q(P[by]),
      q(ago(raised, 10)),
      q(resolved ? P[by] : null),
      q(resolved ? ago(resolved[0], 15) : null),
      q(resolved ? resolved[1] : null),
    ].join(", ")});`,
  );
});

// ---------- documents (links only) ----------
const DOCS = ["Requirements specification", "Solution design", "UAT sign-off", "User guide", "Project plan"];
systems.forEach((s, i) => {
  if (s.status === "IDEA") return;
  const n = s.status === "UPCOMING" ? 1 : between(1, 3);
  for (let k = 0; k < n; k++) {
    out.push(
      `INSERT INTO documents (id, system_id, name, kind, url, uploaded_by, uploaded_at) VALUES (${[
        q(`demo-doc-${i + 1}-${k + 1}`),
        q(s.id),
        q(`${DOCS[(i + k) % DOCS.length]} – ${s.name}`),
        "'link'",
        q(`https://example.com/pms-demo/${s.id}/${slug(DOCS[(i + k) % DOCS.length])}`),
        q(s.lead),
        q(ago(between(5, 120), 11)),
      ].join(", ")});`,
    );
  }
});

// ---------- update requests ----------
[
  ["demo-sales-commission-calculator", "Finance is asking when commission will be ready for the March run.", 3],
  ["demo-speech-analytics-pilot", "Please share an update before the client QBR on Friday.", 2],
  ["demo-recruitment-onboarding-portal", "HR needs a go-live date for the new intake.", 1],
].forEach(([sys, message, days], i) => {
  out.push(
    `INSERT INTO requests (id, system_id, requested_by, message, created_at) VALUES (${q(`demo-rq-${i + 1}`)}, ${q(sys)}, ${q(P.Tarisai)}, ${q(message)}, ${q(ago(days, 9))});`,
  );
});

// ---------- sign-in lockout ----------
// Two wrong passwords on one demo account (not enough to lock it), and one demo account locked for
// a few minutes from when the demo data is loaded, so Settings → People shows the Unlock button.
// The addresses are from 203.0.113.0/24, which is set aside for examples.
[
  ["demo.michael", P.Michael, 7, "203.0.113.10"],
  ["demo.michael", P.Michael, 4, "203.0.113.10"],
  ["demo.vunganayi", P.Vunganayi, 9, "203.0.113.24"],
  ["demo.vunganayi", P.Vunganayi, 8, "203.0.113.24"],
  ["demo.vunganayi", P.Vunganayi, 6, "203.0.113.24"],
  ["demo.vunganayi", P.Vunganayi, 4, "203.0.113.24"],
  ["demo.vunganayi", P.Vunganayi, 2, "203.0.113.24"],
].forEach(([username, userId, minsAgo, ip], i) => {
  out.push(
    `INSERT INTO login_failures (id, at, username, user_id, ip, reason) VALUES (${q(`demo-lf-${i + 1}`)}, ${NOW - minsAgo * 60_000}, ${q(username)}, ${q(userId)}, ${q(ip)}, 'password');`,
  );
});
out.push(
  `UPDATE users SET locked_until = ${NOW + 13 * 60_000}, locked_at = ${q(new Date(NOW - 2 * 60_000).toISOString())} WHERE id = ${q(P.Vunganayi)};`,
);

// ---------- saved filters and a dashboard (Phase 4) ----------
// Filters by the demo manager and team leader, shared so the dashboard works for everyone; each
// viewer still sees only the work items they're allowed to see.
const FILTERS = [
  ["demo-flt-open-bugs", "Open bugs (demo)", "type = Bug AND statusCategory != Done ORDER BY priority DESC", P.Tarisai, "everyone", null],
  ["demo-flt-urgent", "Urgent and open (demo)", "priority in (Highest, High) AND statusCategory != Done ORDER BY due ASC", P.Tarisai, "everyone", null],
  ["demo-flt-sprint", "In running sprints (demo)", "sprint in openSprints() ORDER BY status", P.Tarisai, "role", "developer"],
  ["demo-flt-all-open", "All open work (demo)", "statusCategory != Done", P.Tarisai, "everyone", null],
  ["demo-flt-mine", "My open work (demo)", "assignee = currentUser() AND statusCategory != Done ORDER BY due ASC", P.Tarisai, "private", null],
];
for (const [id, name, pql, owner, scope, value] of FILTERS) {
  const at = ago(between(3, 20), 10);
  out.push(`INSERT INTO saved_filters (id, name, description, pql, owner_id, share_scope, share_value, created_at, updated_at) VALUES (${[q(id), q(name), "'Demo filter'", q(pql), q(owner), q(scope), q(value), q(at), q(at)].join(", ")});`);
}
out.push(`INSERT INTO filter_favourites (filter_id, user_id, created_at) VALUES ('demo-flt-urgent', ${q(P.Tarisai)}, ${q(ago(2))}), ('demo-flt-open-bugs', ${q(P.Tarisai)}, ${q(ago(2))});`);
out.push(`INSERT INTO filter_subscriptions (id, filter_id, user_id, frequency, weekday, hour, created_at) VALUES ('demo-sub-1', 'demo-flt-urgent', ${q(P.Tarisai)}, 'weekly', 1, 8, ${q(ago(2))});`);
out.push(`INSERT INTO dashboards (id, name, owner_id, share_scope, share_value, layout, created_at, updated_at) VALUES ('demo-dash-delivery', 'Delivery (demo)', ${q(P.Tarisai)}, 'everyone', NULL, 'two', ${q(ago(2))}, ${q(ago(2))});`);
[
  ["urgent", "filter_results", "demo-flt-urgent", "Urgent and open", 0, null, null, 8],
  ["pie", "pie", "demo-flt-all-open", "Open work by status", 0, "status", null, 10],
  ["load", "workload", "demo-flt-all-open", "Who has what", 0, null, null, 10],
  ["crvr", "created_resolved", "demo-flt-open-bugs", "Bugs: created vs resolved", 1, null, null, 10],
  ["sprint", "sprint_health", "demo-flt-sprint", "Running sprints", 1, null, null, 10],
  ["late", "overdue", "demo-flt-all-open", "Overdue", 1, null, null, 8],
  ["twod", "two_d", "demo-flt-all-open", "Status by priority", 1, "status", "priority", 10],
  ["act", "activity", "demo-flt-urgent", "Latest changes to urgent items", 0, null, null, 10],
].forEach(([key, kind, filter, title, col, field, field2, rows], i) => {
  out.push(
    `INSERT INTO dashboard_gadgets (id, dashboard_id, kind, filter_id, title, column_index, position, field, field2, max_rows) VALUES (${[q(`demo-g-${key}`), "'demo-dash-delivery'", q(kind), q(filter), q(title), col, i, q(field), q(field2), rows].join(", ")});`,
  );
});

process.stdout.write(out.join("\n") + "\n");
