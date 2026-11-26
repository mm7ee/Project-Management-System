# Administrator module: audit and plan

For: the Pulse owner, before building.

Status (2026-11-26):
- The recommendations were approved.
- **Phases 1, 2 and 3 are built:** committed locally and on the dev branch. Before they're pushed, migrations 0017,
  0018 and 0019 must be applied to live (0018 after a dry run on a production copy); see UPGRADE-LOG.
- Phase 4 is next.
- Two deviations from section 3, phase 2, recorded in DECISIONS:
  - item types build on the five built-in kinds rather than replacing them
  - work items don't carry a workflow version (status moves are settled at publish)

The brief asks for an admin module for organisations and workspaces, a workflow per workspace, and no-code automation.
Pulse already has a lot of it. This plan builds on what exists, follows DECISIONS.md, and never weakens the
tenancy rules already in place:
- row-level security on every tenant table
- 404 rather than 403
- no hint before sign-in about which organisations or usernames exist.

## 1. What already exists, and what's missing

| Brief section | Already in Pulse | Missing |
| --- | --- | --- |
| **1. Roles** | <ul><li>Platform Administrator (`/platform`, TOTP)</li><li>Organisation Administrator (`org_admin`)</li><li>Six roles per workspace (`workspace_members.role`), so someone can be Administrator in one workspace and Developer in another</li><li>22 permissions, editable per role, organisation-wide (`role_permissions`)</li><li>Checked in the Worker</li></ul> | <ul><li>A true read-only **Viewer**. Today's `viewer` key is labelled "Standard user" and can log features and time.</li><li>Permissions for workflow, field, automation and member administration *within a workspace*.</li><li>Deleting organisations (today they can only be archived).</li></ul> |
| **2. Organisations and workspaces** | <ul><li>Organisations: create, rename, suspend, archive</li><li>Workspaces: create, rename, archive, key</li><li>People: add with a temporary password, role per workspace, remove</li><li>Audit log: `activity`, `platform_activity`</li></ul> | <ul><li>Organisation logo, colour, time zone (Harare is hard-coded), working days and hours, contact email</li><li>Workspace icon, colour, description, visibility, created from a template</li><li>Invite by email, CSV import, deactivate (rather than remove)</li><li>Clone a workspace's configuration</li><li>Before and after values in the audit log, and the log made append-only</li></ul> |
| **3. Workflows** | <ul><li>A status catalogue with categories (To Do / In Progress / Done)</li><li>Workflows with statuses and transitions</li><li>Conditions (role, assignee, reporter), validators (comment, assignee, field, sub-tasks done) and post-functions</li><li>Status mapping when a status is removed</li><li>One workflow per workspace, or per project</li><li>Boards map columns to statuses and refuse invalid moves</li><li>Custom fields per workspace (6 kinds: required, shown on create/edit/view/board)</li></ul> | <ul><li>**Work item types per workspace.** Today there are five fixed types: Epic, Story, Task, Bug, Sub-task.</li><li>A workflow per item type.</li><li>Due-date and attachment validators, and the "clear a field", "set resolution" and "notify watchers" post-functions.</li><li>**Approvals.**</li><li>Field kinds: long text, currency, checkbox, URL, file. Field defaults, and fields per item type.</li><li>SLAs for work items (today only service desk requests have them).</li><li>**Draft, publish and versions with rollback.**</li><li>**A visual canvas.**</li><li>Workflows are organisation-wide today; a Workspace Administrator should own their workspace's.</li></ul> |
| **4. Templates** | <ul><li>A template organisation used to seed new organisations</li><li>Project templates (`templates`)</li></ul> | <ul><li>The Software Development, Marketing, HR and Projects workspace templates</li><li>Saving a workspace as an organisation template</li></ul> |
| **5. Automation** | <ul><li>When / If (PQL) / Then rules, per workspace, project or the whole organisation</li><li>8 triggers and 7 actions</li><li>Smart values</li><li>A depth cap of 3 and a per-minute rate limit</li><li>Run log (`automation_runs`)</li><li>Enable and disable</li><li>Hourly scheduled rules</li></ul> | <ul><li>Triggers: assigned, due date approaching or passed, SLA, approval, incoming webhook, manual button, minute-level schedules in the organisation's time zone</li><li>Visual AND/OR condition groups (today conditions are typed as PQL)</li><li>Actions: label, round-robin or least-loaded assignment, cross-workspace create, email, WhatsApp/SMS (stub), outgoing webhook with a template, recurring item, escalate</li><li>Several-workspace scope</li><li>**A dry run**</li><li>A queue with retries and backoff, idempotency keys, a per-item loop cap</li><li>Failure alerts to the owner</li><li>The presets</li></ul> |
| **6. Data model** | Every tenant table carries `organization_id` (and `workspace_id`), indexed and protected by row-level security. | The new tables in section 3. |
| **7. API** | REST, with consistent `{error, code}` replies. | Endpoints for the new parts. |
| **8. Admin UI** | <ul><li>Settings → Organisation</li><li>Settings → Workflows, Custom fields, Automation</li><li>`/platform`</li><li>The workspace switcher</li></ul> | <ul><li>One admin console with the left navigation</li><li>The canvas</li><li>The When / If / Then block builder</li><li>Templates and audit log pages</li></ul> |
| **9. Quality** | <ul><li>A PGlite test suite that proves isolation (44 tenancy checks, 161 tests in all)</li><li>Webhooks are HMAC-signed</li><li>Secrets are sealed with `MFA_KEY`</li></ul> | <ul><li>Unit tests for the transition engine and the evaluator</li><li>A Marketing ↔ Development isolation test</li><li>A demo organisation</li></ul> |

## 2. Decisions to make (my recommendation first)

1. **Roles:**
   - Keep the six role keys (existing data and permissions use them).
   - Relabel them per the brief: `admin` = Workspace Admin, `manager`/`team_lead`/`assistant`/`developer` = Member levels, and today's `viewer` stays "Standard user".
   - **Add a new `reader` role = Viewer** (strictly read-only, enforced in the Worker, not only by permissions).
   - Add granular permissions (`workflow.edit`, `field.edit`, `automation.create`, `item.transition`, `user.invite` …). The existing keys keep working as aliases.
   - Permissions are set per organisation, as today.
2. **Deleting organisations:**
   - Only an **archived** organisation can be deleted.
   - Deleting needs its code typed, and runs 30 days later (cancellable).
   - A record stays in `platform_activity`.
   - This changes the recorded "nothing is deleted" decision.
3. **Organisation logo and colour:**
   - Shown only **after** sign-in (sidebar, reports, emails, the executive page).
   - The sign-in page stays Pulse-branded. Showing a logo after someone types a code would reveal that the organisation exists, which the tenancy rules forbid.
   - This settles the white-labelling question left open in phase (e).
4. **Workspace visibility "organisation-wide":**
   - Every member of the organisation can open it as a **Viewer** without being added.
   - "Private" (the default) works as today.
5. **Who owns workflows, statuses and fields:**
   - Each moves to the **workspace** (`workspace_id`).
   - The organisation keeps the status *categories* for reporting, and **organisation templates**.
   - Existing organisation-wide workflows are copied into each workspace that uses them, by the migration.
6. **Item types:**
   - A per-workspace `item_types` table.
   - The five current types become rows in every existing workspace. Sub-task stays a built-in type.
   - `work_items.type` keeps its code (the CHECK constraint is replaced by a foreign key).
7. **Versioning:**
   - Editing happens on a draft (a JSON copy).
   - Publishing validates it, asks for status mappings, applies it to the live tables in one transaction, and stores the published snapshot in `workflow_versions`.
   - Rolling back republishes an old snapshot through the same mapping step.
   - Items don't carry a version id: after a publish, every item is on the current version.
8. **Canvas:** add **`@xyflow/react` (React Flow 12, MIT), pinned**, loaded only on the designer page. The table view stays as the accessible alternative.
9. **Job queue:**
   - A **Postgres job table** (`automation_jobs`): `ctx.waitUntil` runs jobs straight away, and a cron **every 5 minutes** (today it runs hourly) picks up retries with exponential backoff and due-date/SLA/schedule triggers.
   - No Cloudflare Queues, so there's no new paid service or infrastructure.
   - Idempotency: one job per (rule, item, event id).
10. **Email invites:**
    - An email with a one-time "set your password" link (reusing `password_resets`), valid 72 hours.
    - CSV import makes the same invites.
    - "Deactivate" keeps the account and history but blocks sign-in; "Remove" stays as today.
11. **WhatsApp/SMS:** a provider interface with a logging stub only. No provider is called and there are no secrets, until you choose one.
12. **Demo organisation:**
    - `scripts/demo-org.mjs dev|stage` creates "Demo Co" with Marketing and Development workspaces from the templates and presets.
    - It never runs on live unless you ask.
    - Tests seed the same data on PGlite.
13. **Release:** as before. Each phase's migration is applied **to live by `npm run db:migrate` immediately before that phase's push**, checked with `db:status` first and after (see the 2026-11-26 incident in UPGRADE-LOG).

## 3. Phases, files and migrations

Each phase ends with tests on PGlite, `tsc` clean, docs (API.md, Postman, UPGRADE-LOG, DECISIONS, the admin guide) and a
report to you.

### Phase 1: roles, and organisation and workspace administration
- **Migration `0017_admin_rbac.sql`:**
  - `reader` role
  - new permissions
  - organisation profile columns (`logo`, `colour`, `time_zone` default `Africa/Harare`, `work_days`, `work_hours`, `contact_email`)
  - workspace columns (`icon`, `colour`, `description`, `visibility`)
  - `accounts.deactivated_at`
  - `invites`
  - `audit_log` (append-only: pulse_app may insert and select, never update or delete; `before`/`after` JSON)
  - `organizations.delete_after`
- **Worker:**
  - `worker/access.js`: the permission checks, plus `can(viewer, perm, workspaceId)`
  - new `worker/orgadmin.js`: moves `/api/org/*` out of `index.js` and adds profile, invites, CSV import, deactivate and clone
  - `worker/platform.js`: delete flow
  - `worker/audit.js`: one helper, used by every admin write
  - `worker/search.js`: `harare()` becomes the organisation's time zone
- **UI:**
  - new `AdminConsole.jsx` with the left navigation (Organisations*, Workspaces, Members & Roles, Workflows, Fields, Automations, Templates, Audit Log, Settings). \*The Organisations item is shown to Platform Administrators only, at `/platform`.
  - `OrgAdmin.jsx` is split into `admin/Workspaces.jsx`, `admin/Members.jsx` and `admin/AuditLog.jsx`
  - a toast and confirm-dialog helper
- **Tests:** `admin.rbac.test.js`: the Viewer can't write; a Workspace Admin can't touch another workspace; invites and CSV; deactivate; audit before/after; the delete flow.

### Phase 2: workflow designer, versions and templates
- **Migration `0018_workflow_designer.sql`:**
  - `item_types`
  - `workflows.workspace_id`, plus copies per workspace
  - `type_workflows` (workspace, type → workflow)
  - `workflow_drafts`, `workflow_versions`
  - new rule kinds and field kinds
  - `custom_fields.default_value`, `custom_field_types`
  - `workspace_templates` (built-in and organisation-level), with the four built-in templates seeded
- **Worker:**
  - `worker/workflows.js`: draft, validate, publish, versions, rollback
  - new `worker/transitionEngine.js`, a pure function shared with the UI through `src/data/workflows.js`
  - `worker/templates.js`: create a workspace from a template, save as template, clone
  - `worker/customfields.js`: the new kinds, with files reusing the chat file store
- **UI:**
  - `WorkflowDesigner.jsx` (React Flow canvas and table tabs)
  - `ItemTypes.jsx`
  - `TemplatesPage.jsx`
  - updates to `WorkflowsSettings.jsx` and the custom fields screens
  - the item form shows the fields for its type
- **Tests:**
  - `transitionEngine.test.js` (unit: conditions, validators, post-functions)
  - `workflow.versions.test.js` (publish with mapping, rollback)
  - templates create the right statuses, types and fields

### Phase 3: automation engine and logs
- **Migration `0019_automation_engine.sql`:**
  - `automation_rules`: `conditions` (JSON AND/OR groups; PQL stays as a condition type), `owner_id`, `scope` (`workspace`, `workspaces`, `organization`)
  - `rule_workspaces`
  - `automation_jobs` (queue, attempts, `run_after`, idempotency key)
  - `automation_runs` gains `conditions_result` and `actions`
  - `item_rule_counts` (loop cap)
  - the new trigger and action kinds
  - the organisation rate limit
  - `wrangler.jsonc`: cron every 5 minutes
- **Worker:**
  - new `worker/automationEval.js` (a pure evaluator: conditions and smart values with HTML escaping)
  - `worker/automation.js`: the queue, retries with backoff, the depth cap raised to 5, the per-item cap, dry run, failure alerts
  - cross-workspace create through the target workspace's own scoped handle, allowed only when the rule's owner may create items there
  - the presets
- **UI:** `RuleBuilder.jsx` (When / If / Then blocks, dropdowns only), `RuleRuns.jsx` (log), a "Test rule" dialog, a manual-trigger button on items.
- **Tests:**
  - `automationEval.test.js` (unit)
  - `automation.engine.test.js` (retries, idempotency, loop and depth caps, dry run changes nothing, cross-workspace create respects the owner's rights)
  - Marketing ↔ Development isolation

### Phase 4: SLAs, approvals and webhooks
- **Migration `0020_sla_approvals_webhooks.sql`:**
  - `sla_policies` (workspace, type/priority → targets in working hours), `item_sla`
  - `approvals`, `approval_votes` (named user, role, N of M; reject reason required)
  - `incoming_hooks` (a token per rule, stored as a hash)
  - `webhooks.payload_template`
- **Worker:**
  - `worker/sla.js` (working-hours clock, reusing the service desk's calendar code)
  - `worker/approvals.js` (pending state, approve and reject)
  - the incoming webhook route
  - outgoing webhook templating, still HMAC-signed
- **UI:**
  - an approval panel on the item
  - SLA badges and breach warnings
  - SLA policy settings
  - incoming webhook URLs on rules
- **Tests:** SLA clock over weekends and holidays; approvals (N of M, a reason required, the wrong person gets a 404); incoming hook tokens; template escaping.

**Finally:** `scripts/demo-org.mjs`, README sections on admin set-up, creating a workflow and creating an automation, and the full test run.

## 4. Size and risk

- Each phase is about as large as a multi-tenancy phase.
- The riskiest change is decision 5: workflows and statuses move to the workspace, with data migrated on live. It gets the same treatment as 0013: a dry-run script on a copy of production, a reverse script, and a backup before.
- Release: each phase is pushed only after its migration is on live, checked with `db:status`.
