# Omnicontact projects → lifecycle stages: dry-run mapping (for approval)

> **Decided 2026-11-27** (the migration follows these): BSS is the Business Solution Specification; HR follows the
> lifecycle too. The three flagged projects: **Prometric Contracts Signing** and **Secondments System** (Upcoming, no
> Concept Note) start at **1 PCN Draft**; **Inventory Management System** (Testing, but delivered at 100%) is
> **closed**, with its status corrected to Live. Nothing is left flagged. Re-run against live before applying:
> `node scripts/lifecycle-report.mjs main` after a dry run on a copy.

Read from the local backup of live taken 2026-11-27 (`backup-before-themes.sql`): no database was touched. The migration
will apply exactly these rules, re-read on the day; anything they can't place is **flagged**, never guessed, and stays
without a lifecycle until you decide.

## Rules

| Today | Becomes | Confidence |
|---|---|---|
| Idea, no Concept Note, or one with no signatories | 1 PCN Draft | high |
| Idea, Concept Note waiting for signatures | 3 PCN Sign Off (the signatures carry over) | high |
| Idea, Concept Note declined | 1 PCN Draft | high |
| Upcoming, Concept Note fully signed | 4 Technical Discovery | medium |
| Upcoming, no Concept Note | **flag** | |
| In progress | 9 Dev Work | medium |
| Testing, not finished | 12 QATs | medium |
| Testing, but finished at 100% | **flag** | |
| To deploy | 14 Deployment | high |
| Live, Completed | 16 Close Project, already closed | high |

- **Stages before the mapped one** are recorded in the history as *migrated* ("gate evidence not on record"); they are
  not re-checked, and no BRS/BSS is required retrospectively. From the mapped stage on, every gate applies.
- **The project's status is unchanged** by the migration. From then on the lifecycle sets it (e.g. entering 12 QATs sets
  Testing; closing sets Live).
- **Dates:** the mapped stage is entered on the day of the migration, so no SLA is breached on day one.

## Summary: 40 projects

| Stage | Projects |
|---|---|
| 16 Close Project (closed) | 17 |
| 14 Deployment | 2 |
| 9 Dev Work | 10 |
| 4 Technical Discovery | 2 |
| **Flagged** | 3 |
| 1 PCN Draft | 2 |
| 3 PCN Sign Off | 1 |
| 12 QATs | 3 |

High confidence 22, medium 15, flagged 3.

## Every project

| Workspace | Project | Status today | Concept Note | Progress | → Stage | Why |
|---|---|---|---|---|---|---|
| HR | Prometric Contracts Signing | UPCOMING | none | 0% | **FLAG** | Upcoming with no Concept Note on record: was it approved outside PMS (→ 4 Technical Discovery) or does it still need one (→ 1 PCN Draft)? |
| HR | Secondments System | UPCOMING | none | 5% | **FLAG** | Upcoming with no Concept Note on record: was it approved outside PMS (→ 4 Technical Discovery) or does it still need one (→ 1 PCN Draft)? |
| Projects | Inventory Management System | TESTING | none | 100% | **FLAG** | Status Testing but marked finished at 100%: is it live (→ closed) or still in QAT (→ 12)? |
| HR | Agent Wellness Tracker | IDEA | yes, signed 0/1 | 0% | 3 PCN Sign Off | Concept Note waiting for signatures (0/1) |
| HR | Employee Management System | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| HR | Learning Management System | WIP | none | 65% | 9 Dev Work | In progress (65%); BRS/BSS not on record, recorded as "migrated" |
| HR | Leave Planner | WIP | none | 0% | 9 Dev Work | In progress (0%); BRS/BSS not on record, recorded as "migrated" |
| HR | Leave Planner | COMPLETED | none | 100% | 16 Close Project (closed) | Completed; lifecycle recorded as closed, no SLAs |
| HR | Omni-Health | IDEA | none | 0% | 1 PCN Draft | Idea, no Concept Note yet |
| HR | Payroll Self-Service Portal | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| HR | Payslip | WIP | none | 10% | 9 Dev Work | In progress (10%); BRS/BSS not on record, recorded as "migrated" |
| HR | Policies | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| HR | Recruitment & Onboarding Portal | WIP | none | 72% | 9 Dev Work | In progress (72%); BRS/BSS not on record, recorded as "migrated" |
| HR | S.H.E Management Platform | WIP | none | 60% | 9 Dev Work | In progress (60%); BRS/BSS not on record, recorded as "migrated" |
| HR | Staff Pulse Survey | COMPLETED | none | 100% | 16 Close Project (closed) | Completed; lifecycle recorded as closed, no SLAs |
| HR | Training Academy LMS Integration | WIP | none | 63% | 9 Dev Work | In progress (63%); BRS/BSS not on record, recorded as "migrated" |
| Projects | Agent Scorecard Dashboard | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | AI Chat Assistant | UPCOMING | yes, signed 1/1 | 0% | 4 Technical Discovery | Concept Note signed (1/1); not started |
| Projects | Asset Register | COMPLETED | none | 100% | 16 Close Project (closed) | Completed; lifecycle recorded as closed, no SLAs |
| Projects | Booking System | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | Client Billing & Invoicing | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | Client SLA Reporting Hub | WIP | none | 48% | 9 Dev Work | In progress (48%); BRS/BSS not on record, recorded as "migrated" |
| Projects | Contact Centre CRM | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | Customer Feedback Kiosk | TESTING | none | 84% | 12 QATs | Testing (84%); QAT vs UAT not on record, starts at QAT |
| Projects | Debt Collections Workbench | UPCOMING | yes, signed 1/1 | 0% | 4 Technical Discovery | Concept Note signed (1/1); not started |
| Projects | Document E-Signature | TO_DEPLOY | none | 95% | 14 Deployment | Ready to deploy (95%) |
| Projects | Fleet & Transport Booking | TESTING | none | 88% | 12 QATs | Testing (88%); QAT vs UAT not on record, starts at QAT |
| Projects | IVR Call Routing Manager | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | Knowledge Base Portal | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | MyCEO | COMPLETED | none | 100% | 16 Close Project (closed) | Completed; lifecycle recorded as closed, no SLAs |
| Projects | Omni-Rush | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | Predictive Staffing Model | IDEA | yes, signed - | 0% | 1 PCN Draft | Concept Note started, no signatories yet |
| Projects | Procurement Requests | TESTING | none | 91% | 12 QATs | Testing (91%); QAT vs UAT not on record, starts at QAT |
| Projects | Quality Assurance Call Review | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
| Projects | Sales Commission Calculator | WIP | none | 35% | 9 Dev Work | In progress (35%); BRS/BSS not on record, recorded as "migrated" |
| Projects | Shift Swap Mobile App | TO_DEPLOY | none | 97% | 14 Deployment | Ready to deploy (97%) |
| Projects | Speech Analytics Pilot | WIP | none | 22% | 9 Dev Work | In progress (22%); BRS/BSS not on record, recorded as "migrated" |
| Projects | Visitor Management System | COMPLETED | none | 100% | 16 Close Project (closed) | Completed; lifecycle recorded as closed, no SLAs |
| Projects | WhatsApp Customer Channel | WIP | none | 55% | 9 Dev Work | In progress (55%); BRS/BSS not on record, recorded as "migrated" |
| Projects | Workforce Scheduler | LIVE | none | 100% | 16 Close Project (closed) | Live; lifecycle recorded as closed, no SLAs |
