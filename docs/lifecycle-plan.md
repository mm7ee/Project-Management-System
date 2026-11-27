# Project lifecycle workflows: plan (step 1, for approval)

Status: **approved and built** (2026-11-27; see UPGRADE-LOG). BSS is the Business Solution Specification; HR follows the lifecycle too; signatories are named, pending approval. With this plan:

- `docs/design/omnicontact-lifecycle.json`: Omnicontact's 16-stage template, as it would be stored
- `docs/design/lifecycle-mockups.html`: stage tracker, stage panel, sign-off and pipeline view (open in a browser)
- `docs/design/lifecycle-mapping-dry-run.md`: where each of Omnicontact's 40 existing projects would land

## 1. What exists today, and what this builds on

| Need | Reused | New |
|---|---|---|
| A project's stage | `systems.data.status` (Idea … Live) stays the headline status; the lifecycle **sets** it as stages change | the lifecycle position itself |
| PCN sign-off | the Concept Note's own signatories (`pcn.signatories`): PCN Sign Off reads and writes them, no copy | — |
| Other sign-offs (BRS, BSS, UAT, final) | the approvals rules from phase 4 (the person asking never approves; votes can't be changed; a 404 to non-approvers) | `stage_signoffs`, because work-item approvals hang off a work item move |
| Deliverables (PCN, BRS, BSS, notes, closure report) | the project's `documents` | 4 columns on `documents`: stage, deliverable key, version, locked |
| Checklist tasks, bugs from failed tests, deferred items | `work_items` (tasks and bugs, with the project's workflow) | a link from the item to the stage |
| Change request at Deployment | service desk **Change** (`sd_requests`, kind `change`, approved through Change Approval by a Manager) | a link from the project's stage to the change |
| Durations, SLAs, reminders | the organisation calendar (`workCalendar.js`: Africa/Harare, working days and hours, public holidays) and the 5-minute / hourly cron | stage SLA events (warned / breached once, like `item_sla_events`) |
| Notifications | `notify.js` (bell, email, Teams), notification schemes, the daily digest and Monday Briefing | new kinds: `stage`, `signoff` |
| Automation | the automation engine (phase 3) | trigger **Stage changed**; conditions **Stage is**, **Phase is**; action **Move to stage** |
| Ask PMS | its tools over project data | a lifecycle tool (stage, days in stage, overdue) |
| Activity log, audit | `activity` and `audit_log` | — |

The stack note in the brief: the app is **JavaScript with JSDoc types** (DECISIONS, 2026-11-25), checked by `tsc`, not
TypeScript files; this follows that. Migrations live in `project-management-system-backend/database/migrations/`.

## 2. Data model (migration 0025; every table has `organization_id` and row-level security)

```
lifecycle_templates         one row per version
  id, organization_id, workspace_id NULL (NULL = the organisation's), family_id (versions of one template),
  version, status draft|published|archived, is_default, name, settings JSON, created/published by/at
lifecycle_stages            the stages of one template version (rows, so reports can join on them)
  template_id, code, name, phase_code, phase_name, position, type, responsible TEXT[], owner_id NULL,
  target_days, weight, exit JSON, deliverables JSON, signoff JSON, testing JSON, deployment JSON,
  transitions JSON, automation JSON, checklist_as_items BOOL
project_lifecycle           one row per project
  system_id PK, template_id (the version it started on), stage_code, stage_entered_at, state active|closed,
  sla_warned_at, sla_breached_at, migrated BOOL
project_stage_history       every change, never updated or deleted by the app's role
  id, system_id, from_code, to_code, kind advance|send_back|skip|decline|migrate|close|reopen,
  reason, evidence JSON (what the gate saw), by, at
stage_checklist_items       ticks against a stage's checklist   (system_id, stage_code, key, done_by, done_at, note)
stage_signoffs              one per signatory per round
  id, system_id, stage_code, round, signer_id, label, status pending|approved|declined, comment,
  submitted_by, document_id + document_version (what was signed), decided_at
stage_requests              skip requests and deferrals needing a Manager/Admin   (kind, reason, status, decided_by/at)
risk_register               system_id, risk, likelihood 1–5, impact 1–5, rating (computed: Low…Critical),
                            owner_id, mitigation, status, reviewed_by/at
security_findings           system_id, title, severity Critical|High|Medium|Low|Info, status open|fixed|accepted,
                            accepted_by, accepted_reason, accepted_until
test_cases                  system_id, suite QAT|UAT|SMOKE, title, steps, expected
test_runs                   case_id, result pass|fail|blocked, notes, bug_item_id, run_by/at
project_environments        system_id, name Dev|QA|UAT|Prod|…, server, resources, access, verified_by/at
stage_records               system_id, stage_code, kind (deployment plan, closure report…), data JSON
documents (+)               stage_code, deliverable_key, version, locked_at, locked_by
work_items (+)              lifecycle_stage (the stage that created it: a checklist task or a failed test's bug)
```

**Versions:** templates are edited as drafts and published (like workflows). A project keeps the version it started on;
an administrator can migrate projects to a newer version (each project's current stage is matched by code; a stage
that no longer exists is asked about).

## 3. Rules (enforced in the Worker)

- **Gates:** each stage's exit criteria are checked by the server (`src/data/lifecycle.js`, shared with the app so the
  Advance button lists exactly what is missing). Criteria kinds: checklist, deliverable, linked deliverable,
  sign-offs, risk register, risks mitigated, work items done/deferred, environments, security clear, test pass rate,
  no open bugs, change approved, deployment recorded, Concept Note complete.
- **Advance:** the project lead, Managers and Administrators, and the stage's named owner.
- **Send back:** to an earlier stage the template allows, with a mandatory reason (lead, Manager, Admin).
- **Skip:** only where the template allows it, requested with a justification and approved by a Manager or Admin
  (not the person asking).
- **Sign:** only the stage's signatories. **Segregation of duties:** with `selfSignoff: false` (Omnicontact's
  default), whoever submitted the deliverable can't sign it.
- **Locked documents:** on approval the signed version is locked (can't be replaced or deleted); a change is a new
  version and a new sign-off round. Closing locks all deliverables.
- **Templates:** Organisation Administrators only (Settings → Project Lifecycle).
- **Not yours:** another organisation's template, project or sign-off is a 404, as everywhere else.

## 4. Questions for you before building

1. **BSS:** is it "Business Solution Specification"? (Other common meanings: "Business System Specification",
   "Solution Design".) The name is editable either way.
2. **Workspaces:** should the lifecycle apply to the **HR** workspace's projects too, or only **Projects**? (The
   template can be per workspace; the mapping report covers both.)
3. **The three flagged projects** in the mapping report: Prometric Contracts Signing and Secondments System
   (Upcoming, no Concept Note) and Inventory Management System (Testing, but marked finished at 100%).
4. **Signatories:** BRS/UAT use "the project's business owner" (the project's Owner field) plus a Manager; BSS a
   Team Leader and the business owner; final sign-off a Manager. Named people can replace any of these.

## 5. Phases after approval (each tested and releasable)

1. Engine and data model: migration 0025, `src/data/lifecycle.js` (gates, transitions, SLA timing), the API.
2. Omnicontact's template and the stage-mapping migration (0026), applied to dev; the dry run against a copy of live
   for your approval before live.
3. Project UI: the stage tracker and stage panel; the pipeline view.
4. Sign-offs and gates: the sign-off panel, approving from the bell and email link, locked versions, skip requests.
5. Automation and notifications: on enter/exit/overdue, reminders, escalation, automation trigger, digest, Monday
   Briefing, Teams, Ask PMS.
6. Reporting: the lifecycle section of Reports → Projects, in PDF and Excel.
7. The template editor (drag to reorder, gates, versions), the staff guide, Postman, docs.
