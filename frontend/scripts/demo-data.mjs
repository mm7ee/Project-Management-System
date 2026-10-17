// Demo data for presentations: realistic projects, people, client requests, blockers, documents
// and Concept Notes, spread over the last 18 months so the charts and reports fill out.
//
// Every record's id starts with "demo-", so it can all be removed again in one go:
//   node scripts/demo-data.mjs seed   > demo-seed.sql    (then: wrangler d1 execute DB --remote --file demo-seed.sql)
//   node scripts/demo-data.mjs remove > demo-remove.sql
// or simply `npm run demo:seed` / `npm run demo:remove` (live database).
//
// Demo people cannot sign in (their password field holds no usable hash). Nothing is written to
// the activity log: that is the security audit trail and only records real events.

const mode = process.argv[2];
if (mode !== "seed" && mode !== "remove") {
  console.error("Usage: node scripts/demo-data.mjs seed|remove");
  process.exit(1);
}

const REMOVE = `-- Removes every demo record (ids starting "demo-").
DELETE FROM assignments WHERE system_id LIKE 'demo-%' OR user_id LIKE 'demo-%';
DELETE FROM features WHERE id LIKE 'demo-%';
DELETE FROM blockers WHERE id LIKE 'demo-%';
DELETE FROM documents WHERE id LIKE 'demo-%';
DELETE FROM requests WHERE id LIKE 'demo-%';
DELETE FROM systems WHERE id LIKE 'demo-%';
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

const out = ["-- OmniTrack demo data. Remove with scripts/demo-data.mjs remove.", REMOVE];

// ---------- people ----------
const PEOPLE = [
  ["Vimbai Mutasa", "manager", "Projects Manager"],
  ["Simbarashe Ndlovu", "team_lead", "Team Leader"],
  ["Chipo Mhlanga", "assistant", "Projects Assistant"],
  ["Farai Moyo", "developer", "Senior Developer"],
  ["Rudo Chikore", "developer", "Developer"],
  ["Tatenda Ncube", "developer", "Developer"],
  ["Nyasha Dube", "developer", "Full-stack Developer"],
  ["Kudakwashe Sibanda", "developer", "Developer"],
  ["Chiedza Mlambo", "developer", "Front-end Developer"],
  ["Tafadzwa Zhou", "developer", "Integrations Developer"],
  ["Blessing Phiri", "developer", "Developer"],
  ["Rumbidzai Banda", "developer", "QA Engineer"],
];
const people = PEOPLE.map(([name, role, title]) => {
  const first = name.split(" ")[0].toLowerCase();
  return { id: `demo-${first}`, username: `demo.${first}`, name, role, title: `${title} (demo)` };
});
const P = Object.fromEntries(people.map((p) => [p.name.split(" ")[0], p.id]));
const nameOf = Object.fromEntries(people.map((p) => [p.id, p.name]));
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
  ["Contact Centre CRM", "LIVE", "Single customer view for agents: history, tickets and notes across every channel.", "Farai", ["Farai"], 520, 150, 100, { engagement: 2140 }],
  ["Agent Scorecard Dashboard", "LIVE", "Daily KPIs per agent: handle time, first-call resolution and QA scores.", "Nyasha", ["Nyasha"], 470, 95, 100, { engagement: 1580 }],
  ["IVR Call Routing Manager", "LIVE", "Lets supervisors change IVR menus and routing rules without a vendor ticket.", "Tafadzwa", ["Tafadzwa"], 430, 120, 100, { engagement: 640, health: "Maintenance", maintenanceNote: "Adding Shona and Ndebele menu prompts", maintenanceDays: 6 }],
  ["Payroll Self-Service Portal", "LIVE", "Staff view payslips, tax certificates and update banking details.", "Rudo", ["Rudo"], 400, 110, 100, { engagement: 1910 }],
  ["Client Billing & Invoicing", "LIVE", "Generates monthly client invoices from billable minutes and SLA credits.", "Farai", ["Farai"], 330, 130, 100, { engagement: 520 }],
  ["Workforce Scheduler", "LIVE", "Forecasts call volumes and builds agent rosters by skill and shift.", "Tatenda", ["Tatenda"], 300, 120, 100, { engagement: 1230, health: "Maintenance", maintenanceNote: "Re-tuning the forecast for the festive season peak", maintenanceDays: 3 }],
  ["Quality Assurance Call Review", "LIVE", "Random call sampling, scoring forms and coaching notes for QA analysts.", "Chiedza", ["Chiedza"], 250, 90, 100, { engagement: 870 }],
  ["Knowledge Base Portal", "LIVE", "Searchable product scripts and FAQs for agents, per client campaign.", "Kudakwashe", ["Kudakwashe"], 190, 75, 100, { engagement: 1460 }],
  // Completed
  ["Visitor Management System", "COMPLETED", "Front-desk visitor sign-in with badges and host notifications.", "Blessing", ["Blessing"], 540, 70, 100, {}],
  ["Asset Register", "COMPLETED", "Tracks laptops, headsets and desks issued to staff.", "Kudakwashe", ["Kudakwashe"], 360, 60, 100, {}],
  ["Staff Pulse Survey", "COMPLETED", "Quarterly anonymous engagement survey with trend reports.", "Chiedza", ["Chiedza"], 215, 45, 100, {}],
  ["Leave Planner", "COMPLETED", "Team leave calendar with cover checks before approval.", "Rudo", ["Rudo"], 150, 55, 100, {}],
  // In progress
  ["WhatsApp Customer Channel", "WIP", "Two-way WhatsApp support for clients' customers, routed into the CRM.", "Tafadzwa", ["Tafadzwa", "Nyasha"], 110, 150, 55, { stalled: 0 }],
  ["Recruitment & Onboarding Portal", "WIP", "Applicant tracking, assessments and first-week onboarding checklists.", "Rudo", ["Rudo", "Blessing"], 95, 85, 72, { overdue: true }],
  ["Sales Commission Calculator", "WIP", "Calculates agent commission from sales campaigns and clawbacks.", "Farai", ["Farai", "Kudakwashe"], 80, 120, 35, { stalled: 23 }],
  ["Client SLA Reporting Hub", "WIP", "Live SLA dashboards each client can log in to see.", "Nyasha", ["Nyasha", "Chiedza"], 70, 110, 48, {}],
  ["Training Academy LMS Integration", "WIP", "Links the learning platform to rosters so training is booked around shifts.", "Tatenda", ["Tatenda"], 60, 66, 63, { atRisk: true }],
  ["Speech Analytics Pilot", "WIP", "Transcribes recorded calls and flags compliance phrases and sentiment.", "Tafadzwa", ["Tafadzwa", "Farai"], 45, 140, 22, { stalled: 31 }],
  // Testing
  ["Fleet & Transport Booking", "TESTING", "Books staff transport for night shifts and tracks routes.", "Kudakwashe", ["Blessing"], 120, 125, 88, {}],
  ["Procurement Requests", "TESTING", "Purchase requests with budget checks and approvals.", "Blessing", ["Rumbidzai"], 100, 98, 91, { overdue: true }],
  ["Customer Feedback Kiosk", "TESTING", "Tablet survey at walk-in centres feeding the CSAT dashboard.", "Chiedza", ["Rumbidzai"], 85, 110, 84, {}],
  // To deploy
  ["Shift Swap Mobile App", "TO_DEPLOY", "Agents swap shifts from their phones; team leaders approve in one tap.", "Tatenda", ["Rumbidzai"], 140, 145, 97, {}],
  ["Document E-Signature", "TO_DEPLOY", "Contracts and policies signed electronically with an audit trail.", "Rudo", ["Tatenda"], 130, 135, 95, {}],
  // Upcoming
  ["Debt Collections Workbench", "UPCOMING", "Promise-to-pay tracking and dialler lists for collections campaigns.", "Farai", [], -12, 120, 0, { pcn: "APPROVED" }],
  ["AI Chat Assistant", "UPCOMING", "Website chatbot that answers routine questions and hands over to agents.", "Nyasha", [], -30, 150, 0, { pcn: "APPROVED" }],
  // Ideas
  ["Agent Wellness Tracker", "IDEA", "Break reminders and wellbeing check-ins to reduce burnout and attrition.", "Chiedza", [], 0, 0, 0, { pcn: "PENDING" }],
  ["Predictive Staffing Model", "IDEA", "Machine-learning forecast of call volumes from campaigns, weather and holidays.", "Tatenda", [], 0, 0, 0, { pcn: "DRAFT" }],
];

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
          ? [sig("Vimbai", true, "APPROVED", 20, "Approved. Start after the festive peak."), sig("Simbarashe", false, "APPROVED", 18)]
          : [sig("Vimbai", true, "PENDING", 0), sig("Simbarashe", false, "APPROVED", 4, "Supported: helps with attrition targets.")];
    s.pcn = {
      title: name,
      originator: nameOf[lead],
      date: dateAgo(x.pcn === "DRAFT" ? 5 : x.pcn === "PENDING" ? 9 : 35),
      type: x.pcn === "DRAFT" ? "Process improvement" : "New system",
      background: `${description} Today this is handled manually with spreadsheets and email, which is slow and hard to report on.`,
      concept: `Build ${name} as an OmniTrack-managed system owned by the Systems Team, rolled out to one campaign first.`,
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
  out.push(`INSERT INTO systems (id, sort, data) VALUES (${q(id)}, ${1000 + i}, ${q(JSON.stringify(s))});`);
  // Completed projects keep their lead but no longer hold developers' project slots.
  if (status !== "COMPLETED") for (const d of devKeys) out.push(`INSERT OR IGNORE INTO assignments (user_id, system_id) VALUES (${q(P[d])}, ${q(id)});`);
});
// Farai ends up on four projects: one over the limit, to show the overload flag and suggestions.

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
  const sys = active[i % active.length];
  const [title, kind, description] = REQUESTS[(i * 7) % REQUESTS.length];
  const createdDays = Math.round(395 - (i / reqCount) * 390 + between(-6, 6));
  const age = createdDays;
  let status;
  if (age > 120) status = pick(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED"]);
  else if (age > 45) status = pick(["COMPLETED", "COMPLETED", "IN_PROGRESS", "TESTING", "ON_HOLD"]);
  else status = pick(["NOT_STARTED", "NOT_STARTED", "IN_PROGRESS", "IN_PROGRESS", "TESTING", "COMPLETED"]);
  const priority = pick(["CRITICAL", "HIGH", "HIGH", "MEDIUM", "MEDIUM", "MEDIUM", "LOW", "LOW"]);
  const devs = PROJECTS.find((p) => `demo-${slug(p[0])}` === sys.id)[4];
  const assignee = status === "NOT_STARTED" && rand() < 0.4 ? null : P[pick(devs.length ? devs : ["Farai", "Nyasha", "Rudo"])];
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
  out.push(
    `INSERT INTO features (id, system_id, title, description, kind, client, status, priority, assignee, notes, due_at, created_by, created_at, updated_at, completed_at) VALUES (${[
      q(`demo-fr-${i + 1}`),
      q(sys.id),
      q(title),
      q(description),
      q(kind),
      q(CLIENTS[(i * 3) % CLIENTS.length]),
      q(status),
      q(priority),
      q(assignee),
      q(notes),
      q(dateAgo(dueDays)),
      q(pick([P.Vimbai, P.Simbarashe, P.Chipo])),
      q(created),
      q(completedDays ? ago(completedDays, 15) : ago(Math.max(0, createdDays - between(1, 10)), 14)),
      q(completedDays ? ago(completedDays, 15) : null),
    ].join(", ")});`,
  );
}

// ---------- blockers ----------
const BLOCKERS = [
  ["demo-whatsapp-customer-channel", "Meta business verification still pending for the client's number", "Tafadzwa", 9, null],
  ["demo-sales-commission-calculator", "Finance hasn't signed off the clawback rules", "Farai", 26, null],
  ["demo-speech-analytics-pilot", "Waiting on GPU server procurement", "Tafadzwa", 34, null],
  ["demo-speech-analytics-pilot", "Call recordings for June are missing from the archive", "Farai", 20, null],
  ["demo-procurement-requests", "UAT testers unavailable until month-end close is done", "Rumbidzai", 7, null],
  ["demo-recruitment-onboarding-portal", "Psychometric test vendor API keys not issued", "Rudo", 12, null],
  ["demo-contact-centre-crm", "Telephony vendor API rate limits", "Farai", 410, [395, "Vendor raised our limit to 50 requests/second."]],
  ["demo-payroll-self-service-portal", "Bank file format changed", "Rudo", 330, [322, "Updated the export to the new format."]],
  ["demo-workforce-scheduler", "Historical volume data incomplete", "Tatenda", 250, [238, "Rebuilt 12 months of history from the dialler logs."]],
  ["demo-client-billing-invoicing", "Tax rate change mid-month", "Farai", 230, [226, "Pro-rated the change; finance approved."]],
  ["demo-knowledge-base-portal", "Content owners not assigned per client", "Kudakwashe", 150, [141, "Operations named an owner for each campaign."]],
  ["demo-fleet-transport-booking", "GPS trackers not yet installed in two buses", "Kudakwashe", 40, [28, "Installed; routes now live."]],
  ["demo-shift-swap-mobile-app", "App store review rejected the first build", "Tatenda", 25, [19, "Fixed the privacy notice; approved on resubmission."]],
  ["demo-client-sla-reporting-hub", "Client firewall blocks the dashboard URL", "Nyasha", 30, [16, "Client IT whitelisted the domain."]],
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
        q(`https://example.com/omnitrack-demo/${s.id}/${slug(DOCS[(i + k) % DOCS.length])}`),
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
    `INSERT INTO requests (id, system_id, requested_by, message, created_at) VALUES (${q(`demo-rq-${i + 1}`)}, ${q(sys)}, ${q(P.Vimbai)}, ${q(message)}, ${q(ago(days, 9))});`,
  );
});

process.stdout.write(out.join("\n") + "\n");
