# Renamed strings: Pulse → Project Management System (PMS)

Every user-facing string that named the product, before and after (docs/branding-plan.md, part 1). The name now
lives in one place, `project-management-system-frontend/src/data/brand.js`. "Omnicontact" as the **organisation**
(its code, name and data) is unchanged.

"Ask Pulse" is now **Ask AI** (`BRAND.assistantName`).

## Replaced in the code

| File | Before | After |
| --- | --- | --- |
| frontend App.jsx | `<Sparkles size={17} /> <span>Ask Pulse</span>` | `<Sparkles size={17} /> <span>{BRAND.assistantName}</span>` |
| frontend App.jsx | `You're seeing Pulse live and can request` | `You're seeing this workspace live and can request` |
| frontend components/AddSystemModal.jsx | `OmniContact BPO's PCN for proposing a new project.` | `Your organisation's Project Concept Note (PCN) for proposing a new project.` |
| frontend components/AddSystemModal.jsx | `fill in the OmniContact PCN and track` | `fill in the Project Concept Note and track` |
| frontend components/AdminSettings.jsx | `sub="A work item with a level is seen only by administrators, its assignee and reporter, and the roles and people the level names: in lists, boards…` | `sub={'A work item with a level is seen only by administrators, its assignee and reporter, and the roles and people the level names: in lists, board…` |
| frontend components/AdminSettings.jsx | `For other systems that use Pulse's API.` | `For other systems that use the ${BRAND.shortName} API.` |
| frontend components/AdminSettings.jsx | `the secret tells Pulse which workspace a delivery is for.` | `the secret tells the system which workspace a delivery is for.` |
| frontend components/AdminSettings.jsx | `Save it here, below. Pulse seals it; it's never shown again.` | `Save it here, below. It's sealed and never shown again.` |
| frontend components/AdminSettings.jsx | `sub="Pulse posts work item events (created, updated, moved, commented) to other systems, signed with HMAC-SHA256 in X-Pulse-Signature. A failed del…` | `sub={'${BRAND.shortName} posts work item events (created, updated, moved, commented) to other systems, signed with HMAC-SHA256 in X-Pulse-Signature…` |
| frontend components/AdminSettings.jsx | `leave empty for Pulse's standard JSON` | `leave empty for the standard JSON` |
| frontend components/AskPanel.jsx | `"Couldn't reach Pulse. Check your connection."` | `"Couldn't reach the server. Check your connection."` |
| frontend components/AskPanel.jsx | `aria-label="Ask Pulse"` | `aria-label={BRAND.assistantName}` |
| frontend components/AskPanel.jsx | `<h2>Ask Pulse</h2>` | `<h2>{BRAND.assistantName}</h2>` |
| frontend components/AutomationSettings.jsx | `The assignee (their phone in Pulse)` | `The assignee (the phone in their profile)` |
| frontend components/AutomationSettings.jsx | `When you save, Pulse gives the rule a secret address` | `When you save, the rule gets a secret address` |
| frontend components/BacklogView.jsx | `Pulse keeps a snapshot of the sprint for` | `A snapshot of the sprint is kept for` |
| frontend components/ChatExtras.jsx | `by adding a GIPHY API key to Pulse.` | `by adding a GIPHY API key to the server.` |
| frontend components/ChatExtras.jsx | `<p className="chat-pop-label">Pulse stickers</p>` | `<p className="chat-pop-label">Stickers</p>` |
| frontend components/CustomDashboards.jsx | `team workload across Pulse, as of now.` | `team workload across this workspace, as of now.` |
| frontend components/CustomDashboards.jsx | `const overviewHead = <DashHead title="Pulse overview"` | `const overviewHead = <DashHead title="Workspace overview"` |
| frontend components/CustomDashboards.jsx | `<option value={OVERVIEW}>Pulse overview</option>` | `<option value={OVERVIEW}>Workspace overview</option>` |
| frontend components/CustomDashboards.jsx | `<DashHead title="Pulse overview" description={OVERVIEW_DESC} actions={actions} />` | `<DashHead title="Workspace overview" description={OVERVIEW_DESC} actions={actions} />` |
| frontend components/ExecutivePage.jsx | `Ask whoever runs Pulse in your organisation for one.` | `Ask whoever runs this system in your organisation for one.` |
| frontend components/ExecutivePage.jsx | `<span className="exec-eyebrow">Pulse · Executive overview</span>` | `<span className="exec-eyebrow">Executive overview</span>` |
| frontend components/ExecutivePage.jsx | `{data?.organization ? 'Pulse is where ${data.organization} plans, builds and runs its projects.' : "Pulse is where projects are planned, built and …` | `{data?.organization ? 'This is where ${data.organization} plans, builds and runs its projects.' : "This is where projects are planned, built and ru…` |
| frontend components/ExecutivePage.jsx | `© {year} {data?.organization ?? "Pulse"} · Pulse. Figures` | `© {year} {data?.organization ?? BRAND.productName} · {BRAND.poweredBy}. Figures` |
| frontend components/ExecutivePage.jsx | `<h3>How Pulse works</h3>` | `<h3>How it works</h3>` |
| frontend components/ForcePasswordChange.jsx | `"Pulse now follows a stronger password policy (ISO 27001 A.5.17).` | `"Passwords now follow a stronger policy (ISO 27001 A.5.17).` |
| frontend components/MfaSetup.jsx | `const text = 'Pulse recovery codes for ${username}` | `const text = '${BRAND.shortName} recovery codes for ${username}` |
| frontend components/NotificationBell.jsx | `The lists come straight from Pulse's data.` | `The lists come straight from the live data.` |
| frontend components/NotificationSettings.jsx | `title="Install Pulse" sub="Add Pulse to your home screen and it opens like an app, without the browser's bars."` | `title={'Install ${BRAND.shortName}'} sub="Add it to your home screen and it opens like an app, without the browser's bars."` |
| frontend components/NotificationSettings.jsx | `You're using Pulse from your home screen.` | `You're using {BRAND.shortName} from your home screen.` |
| frontend components/NotificationSettings.jsx | `<Download size={16} /> Install Pulse` | `<Download size={16} /> Install {BRAND.shortName}` |
| frontend components/NotificationSettings.jsx | `aria-label="QR code that opens Pulse on your phone"` | `aria-label="QR code that opens this site on your phone"` |
| frontend components/NotificationSettings.jsx | `<figcaption>Scan with your phone to open Pulse there.</figcaption>` | `<figcaption>Scan with your phone to open it there.</figcaption>` |
| frontend components/NotificationSettings.jsx | `Connect these to send it beyond Pulse too.` | `Connect these to send it further too.` |
| frontend components/NotificationSettings.jsx | `placeholder="Pulse <pulse@omnicontact.biz>"` | `placeholder={'${BRAND.shortName} <pms@your-company.com>'}` |
| frontend components/NotificationSettings.jsx | `(people without a Pulse account)` | `(people without an account)` |
| frontend components/PlatformPage.jsx | `document.title = "Pulse · Platform";` | `document.title = tabTitle("Platform");` |
| frontend components/PlatformPage.jsx | `For Pulse's Platform Administrators.` | `For the platform's administrators.` |
| frontend components/PlatformPage.jsx | `and Pulse's standard statuses, workflows` | `and the standard statuses, workflows` |
| frontend components/SearchPage.jsx | `Pulse sends the results under your bell,` | `The results arrive under your bell,` |
| frontend components/ServiceDeskSettings.jsx | `Send a link to people without a Pulse account` | `Send a link to people without an account` |
| frontend components/SettingsPage.jsx | `Administration changes Pulse for everyone.` | `Administration changes it for everyone.` |
| frontend components/SettingsPage.jsx | `<span>How much of the page shows through windows that open: forms, the Ask Pulse panel, menus and tooltips.</span>` | `<span>How much of the page shows through windows that open: forms, the {BRAND.assistantName} panel, menus and tooltips.</span>` |
| frontend components/SettingsPage.jsx | `"What Pulse opens on when you open this link."` | `"What opens first when you open this link."` |
| frontend components/SettingsPage.jsx | `including the IT helpdesk. Pulse staff will never ask for it.` | `including the IT helpdesk. Administrators will never ask for it.` |
| frontend components/SettingsPage.jsx | `sub="How long Pulse keeps each kind of record.` | `sub="How long each kind of record is kept.` |
| frontend components/SettingsPage.jsx | `You're browsing Pulse through a view-only link.` | `You're browsing this workspace through a view-only link.` |
| frontend components/SettingsPage.jsx | `<Check size={14} /> Ask Pulse questions about the work` | `<Check size={14} /> Ask {BRAND.assistantName} questions about the work` |
| frontend components/SettingsPage.jsx | `<Check size={14} /> Change how Pulse looks here` | `<Check size={14} /> Change how it looks here` |
| frontend components/ShareLinks.jsx | `"Let managers or leadership browse this workspace without an account: the dashboard, projects, feature requests, Concept Notes, reports and Ask Pul…` | `'Let managers or leadership browse this workspace without an account: the dashboard, projects, feature requests, Concept Notes, reports and ${BRAND…` |
| frontend components/ShareLinks.jsx | `documents can't be downloaded.",` | `documents can't be downloaded.',` |
| frontend components/ShareLinks.jsx | `The executive page shows how Pulse works and` | `The executive page shows how the system works and` |
| frontend components/SystemCard.jsx | `encodeURIComponent('Pulse: ${system.name}')` | `encodeURIComponent('${BRAND.shortName}: ${system.name}')` |
| frontend components/UpdateBanner.jsx | `<span>Pulse has been updated.</span>` | `<span>{BRAND.shortName} has been updated.</span>` |
| frontend components/UsersPage.jsx | `so Pulse can't be left without an administrator.` | `so the organisation can't be left without an administrator.` |
| frontend data/passkeys.js | `"Passkeys only work on the Pulse website address."` | `"Passkeys only work on this site's own address."` |
| frontend data/passkeys.js | `rp: { id: o.rpId, name: "Pulse" },` | `rp: { id: o.rpId, name: BRAND.productName },` |
| frontend data/passwordReset.js | `No email from Pulse? Your administrator` | `No email? Your administrator` |
| frontend data/people.js | `const subject = 'Pulse: ${about}';` | `const subject = '${BRAND.shortName}: ${about}';` |
| frontend data/retention.js | `"Until they stop watching, or are removed from Pulse"` | `"Until they stop watching, or are removed from the organisation"` |
| frontend data/retention.js | `"Until you change them, or are removed from Pulse"` | `"Until you change them, or are removed from the organisation"` |
| frontend data/updateRequests.js | `chat: "Pulse chat",` | `chat: '${BRAND.shortName} chat',` |
| backend admin.js | `"One of those people isn't in Pulse"` | `"One of those people isn't in this organisation"` |
| backend chat.js | `"One of those people isn't in Pulse"` | `"One of those people isn't in this organisation"` |
| backend customfields.js | `'${f.name}: choose someone in Pulse'` | `'${f.name}: choose someone in this workspace'` |
| backend ask.js | `const DEVELOPER_PROMPT = 'You are "Ask Pulse", the personal work assistant` | `const DEVELOPER_PROMPT = 'You are "${BRAND.assistantName}", the personal work assistant` |
| backend ask.js | `Speak as Pulse, to the developer as "you".` | `Speak as the assistant, to the developer as "you".` |
| backend ask.js | `that you can only help with their Pulse work and development questions.';` | `that you can only help with their work and development questions.';` |
| backend ask.js | `const SYSTEM_PROMPT = 'You are "Ask Pulse", the assistant inside Pulse, the project tracker of the organisation and workspace` | `const SYSTEM_PROMPT = 'You are "${BRAND.assistantName}", the assistant inside the project management system of the organisation and workspace` |
| backend ask.js | `(e.g. "Pulse has no one called X" or "No projects match that") and, if useful, suggest which Pulse page to check:` | `(e.g. "There is no one called X here" or "No projects match that") and, if useful, suggest which page to check:` |
| backend ask.js | `these rules. Speak as Pulse.` | `these rules. Speak as the assistant.` |
| backend ask.js | `- Only help with Pulse's projects, people,` | `- Only help with this workspace's projects, people,` |
| backend ask.js | `you can only answer questions about Pulse's projects and work.` | `you can only answer questions about this workspace's projects and work.` |
| backend digest.js | `a developer's daily digest in Pulse, their organisation's project tracker.` | `a developer's daily digest in their organisation's project management system.` |
| backend digest.js | `for an organisation's managers, from Pulse, their project tracker.` | `for an organisation's managers, from their project management system.` |
| backend index.js | `short_name: "Pulse",` | `short_name: BRAND.shortName,` |
| backend index.js | `description: "Pulse: the project tracker",` | `description: BRAND.tagline,` |
| backend index.js | `asked to reset the password for your Pulse account, ${row.username}.` | `asked to reset the password for your account, ${row.username}.` |
| backend index.js | `"they have no email address in Pulse"` | `"they have no email address on their account"` |
| backend index.js | `the password for your Pulse account, ${row.username}, was just changed` | `the password for your account, ${row.username}, was just changed` |
| backend index.js | `contact your Pulse administrator straight away.` | `contact your administrator straight away.` |
| backend index.js | `'Send from: an address, or a name and address like "Pulse <pulse@omnicontact.biz>"'` | `'Send from: an address, or a name and address like "${BRAND.shortName} <pms@your-company.com>"'` |
| backend index.js | `"Email from Pulse is working."` | `'Email from ${BRAND.shortName} is working.'` |
| backend index.js | `title: "Test message from Pulse"` | `title: 'Test message from ${BRAND.shortName}'` |
| backend index.js | `"Choose how to send it: Pulse chat, email or Teams"` | `'Choose how to send it: ${CHANNEL_LABEL.chat}, email or Teams'` |
| backend index.js | `"A view-only link can't post in Pulse chat. Choose email or Teams."` | `'A view-only link can't post in ${CHANNEL_LABEL.chat}. Choose email or Teams.'` |
| backend index.js | `throw new HttpError(503, "Ask Pulse isn't switched on for this server");` | `throw new HttpError(503, '${BRAND.assistantName} isn't switched on for this server');` |
| backend search.js | `throw new HttpError(503, "Ask Pulse isn't switched on for this server");` | `throw new HttpError(503, '${BRAND.assistantName} isn't switched on for this server');` |
| backend search.js | `into one Pulse Query Language (PQL) query.` | `into one Project Query Language (PQL) query.` |
| backend integrations.js | `message: "Pulse is listening"` | `message: '${BRAND.shortName} is listening'` |
| backend integrations.js | `"That isn't a Pulse API token"` | `'That isn't a ${BRAND.shortName} API token'` |
| backend integrations.js | `message: "A test from Pulse"` | `message: 'A test from ${BRAND.shortName}'` |
| backend notify.js | `font-weight:600">Open Pulse</a></p>` | `font-weight:600">Open ${esc(BRAND.shortName)}</a></p>` |
| backend notify.js | `color:#6b7a90">Sent by Pulse. You can turn these emails off in Settings.${digest?.aiWritten ? " The opening paragraph is AI-written; the lists come…` | `color:#6b7a90">${esc(BRAND.poweredBy)}. You can turn these emails off in Settings.${digest?.aiWritten ? " The opening paragraph is AI-written; the …` |
| backend notify.js | `'Open Pulse: ${fullLink(env, link)}'` | `'Open ${BRAND.shortName}: ${fullLink(env, link)}'` |
| backend notify.js | `Sent by Pulse about your account's security. Nobody from Pulse will ever ask for your password.</p>` | `Sent about your account's security. Nobody will ever ask you for your password. ${esc(BRAND.poweredBy)}.</p>` |
| backend notify.js | `title: "Open Pulse", url: fullLink(env, post.link)` | `title: 'Open ${BRAND.shortName}', url: fullLink(env, post.link)` |
| backend orgadmin.js | `'${tz} isn't a time zone Pulse knows'` | `'${tz} isn't a time zone this system knows'` |
| backend orgadmin.js | `'You're invited to ${org.name} on Pulse'` | `'You're invited to ${org.name} on ${BRAND.shortName}'` |
| backend orgadmin.js | `has invited you to ${org.name}'s Pulse.` | `has invited you to ${org.name}'s ${BRAND.productName}.` |
| backend platform.js | `VALUES (?, NULL, 'Pulse', 'organization_deleted', ?, ?, NULL)` | `VALUES (?, NULL, 'System', 'organization_deleted', ?, ?, NULL)` |
| backend projectReports.js | `"Reports need a Pulse account"` | `"Reports need an account"` |
| backend projectReports.js | `'${(await currentWorkspace(c.db)).name} · Pulse'` | `'${(await currentWorkspace(c.db)).name} · ${BRAND.shortName}'` |
| backend webauthn.js | `"This passkey uses a type of key Pulse doesn't support"` | `"This passkey uses a type of key this site doesn't support"` |
| backend notify.js | `subject: 'Pulse: ${title}'` | `subject: '${BRAND.shortName}: ${title}'` |
| backend index.js | `name: "Pulse",` | `name: BRAND.productName,` |

## Replaced by hand

| Where | Before | After |
| --- | --- | --- |
| frontend index.html | <title>Pulse</title>, apple-mobile-web-app-title "Pulse", favicon.png | %BRAND_NAME% / %BRAND_SHORT% from brand.js at build time; the PMS SVG favicon |
| frontend public/offline.html | <title>Pulse</title>, "Pulse shows live data, so it needs a connection." | "Offline", "This page shows live data, so it needs a connection." |
| frontend public/*.png | the Pulse heartbeat icons | the PMS monogram icons (scripts/make-icons.mjs) |
| frontend public/omni-logo.png, omni-logo-white.png | Omni Contact's logos, served to everyone | deleted: they are in Omnicontact's branding row (migration 0021) |
| frontend src/brand.js | COMPANY_URL = "https://omnicontact.biz/" | deleted |
| frontend components/PulseMark.jsx | the "Pulse" wordmark with its heartbeat line | deleted: the PMS wordmark (platform) and OrgMark (an organisation) |
| frontend components/Login.jsx | "Every project has a pulse.", "The live heartbeat of Omni Contact's projects…", "Pulse AI", "Sign in to Pulse", "Ask your Pulse administrator", "© Omni Contact · omnicontact.biz", the Omni logo | State A (PMS wordmark, tagline) and State B ("Sign in to {organisation}", "Ask your administrator", "Powered by Project Management System") |
| frontend components/Login.jsx | "Nobody from Pulse will ever ask for your password." | "Nobody will ever ask you for your password." |
| frontend components/Sidebar.jsx | the Omni logo (linking to omnicontact.biz) and the Pulse wordmark | the organisation's logo or monogram, and the workspace |
| frontend components/ExecutivePage.jsx | the Omni logo and the Pulse wordmark | the organisation's logo |
| frontend components/PortalPage.jsx | the Pulse wordmark | the organisation's logo, and "Powered by Project Management System" |
| frontend components/PlatformPage.jsx | the Pulse wordmark | "PMS Platform" |
| frontend components/reports/BiDashboard.jsx | the Omni logo and the Pulse wordmark on the printed letterhead | the organisation's logo and name |
| frontend components/reports/ReportsPage.jsx | cover "Pulse · {organisation}", the Omni logo; page footer "Omni Contact · Pulse · Projects report" | the organisation's logo and name; "{organisation} · Projects report · Powered by Project Management System" |
| frontend components/Pcn.jsx | the Omni logo, "OmniContact BPO" | the open organisation's logo and name |
| frontend App.jsx | the loading splash's Pulse wordmark | "PMS" |
| frontend NotificationSettings, SettingsPage, UsersPage | placeholder name.surname@omnicontact.biz | name.surname@your-company.com |
| frontend tests/updateRequests.test.js | "Pulse chat" | BRAND.shortName + " chat" |
| backend notify.js | email header "PULSE" (red), Omni indigo buttons | the organisation's logo or monogram and name, its accent; neutral "PMS" without one |
| backend notify.js | Teams button "Open Pulse" | "Open in {organisation}" |
| backend servicedesk.js | customer email header "OMNI CONTACT SERVICE DESK" (sent for every organisation) | the organisation's header, "SERVICE DESK" |
| backend projectReports.js | Excel heading "{workspace} · Pulse" | "{organisation} · {workspace}", then "Powered by Project Management System" |
| backend index.js | manifest colours #101553 | #18202b |
| backend scripts/db.mjs, demo-data.mjs, dev-all.mjs, dev-api.mjs | "Pulse backup", "Pulse demo data", "Pulse: the backend…", "Pulse API" | "PMS …" |
| docs | README, admin guide, API reference, folder READMEs, running-pulse.html | Project Management System (PMS); running-pms.html. UPGRADE-LOG, DECISIONS and the plans keep their history. |

## Internal names (renamed 2026-11-27)

| Before | After | How the change is made safe |
| --- | --- | --- |
| address `pulse.utsa--wanza--ortfolio.workers.dev` (the `pulse` gateway) | `pms.utsa--wanza--ortfolio.workers.dev` (a `pms` gateway); `PUBLIC_URL` | `pulse.…` redirects pages to `pms.…` and still passes `/api/` calls on. Passkeys are tied to the address: people add theirs again once. Browser storage and sign-in belong to the address: everyone signs in again once, and installed apps need reinstalling |
| cookies `omni_session`, `pulse_platform` | `pms_session`, `pms_platform` | the old names are still read |
| API token prefix `pulse_` | `pms_` | old tokens keep working |
| headers `X-Pulse-Signature`, `X-Pulse-Event`, `X-Pulse-Delivery`, `X-Pulse-Rule` | `X-PMS-…` | both names are sent |
| user agents `Pulse-Webhooks/1`, `Pulse-Automation` | `PMS-Webhooks/1`, `PMS-Automation` | |
| authenticator app label "Pulse" | "PMS" | new set-ups only; existing entries keep working |
| browser storage `pulse:*`, `pulse.settingsPage`, `omnitrack:*` | `pms:*` | the new address starts fresh anyway |
| download names `pulse-….csv`, `pulse-projects-report-….xlsx` | `pms-…` | |
| the offline cache `pulse-offline-3` | `pms-offline-1` | |
| `PULSE_DB`, `PULSE_API` | `PMS_DB`, `PMS_API` | the old names are still read |
| packages `pulse`, `pulse-frontend`, `pulse-backend`; `Pulse.postman_collection.json` | `pms`, `pms-frontend`, `pms-backend`; `PMS.postman_collection.json` | |
| comments and test descriptions | PMS | |

## Kept, and why

| Identifier | What it is | Why it stays |
| --- | --- | --- |
| `omni-tracker` | the app Worker (and the old D1 database) | its MFA_KEY secret can't be read back or moved |
| `pulse_app` | the database role that row-level security is written for | renaming it means a window where the live code and database disagree, for a name nobody sees |
| `pulse-template`, `pulse-template-ws` | the template organisation's and workspace's ids | primary keys referenced across the schema; never shown |
| `pulse-db` | the Hyperdrive configuration's name in Cloudflare | never shown; renamed only in the Cloudflare dashboard |
| `X-Pulse-…` (alongside `X-PMS-…`) | the old webhook header names | sent as well, so existing receivers keep working |
| migrations, UPGRADE-LOG, DECISIONS, the plans, the PDFs | history | they record what it was called then |
| "Project Query Language (PQL)" | was "Pulse Query Language" | the acronym stays |
