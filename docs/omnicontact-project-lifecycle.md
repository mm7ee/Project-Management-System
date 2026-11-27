# Omnicontact Project Lifecycle: a guide for staff

Every Omnicontact project now moves through the same 16 stages in PMS. Open a project and choose the **Lifecycle** tab to
see where it is, what the current stage still needs, and who signs what. **Pipeline** in the sidebar shows every
project by stage.

## The 16 stages

| Phase | Stage | Done when | Target |
|---|---|---|---|
| **A. Initiation** | 1. PCN Draft | The Project Concept Note is complete | 5 days |
| | 2. Risk Assessment | The risk register has entries, a Manager has reviewed it, and every High or Critical risk has an owner and a mitigation | 3 days |
| | 3. PCN Sign Off | Every Concept Note signatory approves (a decline sends it back to PCN Draft) | 5 days |
| **B. Requirements and Design** | 4. Technical Discovery | Discovery notes attached; current state, integrations, constraints and feasibility ticked off | 10 days |
| | 5. BRS Draft | The Business Requirements Specification (BRS) is attached | 10 days |
| | 6. BRS Sign Off | Waraidzo (business) and Mutsa (systems) approve that BRS version; it is then locked | 5 days |
| | 7. BSS Draft | The Business Solution Specification (BSS) is attached and linked to the signed BRS | 10 days |
| | 8. BSS Sign Off | Mutsa (technical) and Waraidzo (business) approve that BSS version; it is then locked | 5 days |
| **C. Build** | 9. Dev Work | Every in-scope work item is Done (or deferred with a Manager's approval) | 40 days |
| | 10. Server Allocation and Provisioning | Dev, QA, UAT and Prod are recorded and verified | 5 days |
| **D. Assurance** | 11. Security Assessment | No open Critical or High findings (or a Manager formally accepts the risk, with a reason and an end date) | 5 days |
| | 12. QATs | At least 95% of QAT tests pass, and no open Critical or High bugs | 10 days |
| | 13. UATs | The business owner (Waraidzo) signs off UAT; a decline sends the project back to Dev Work | 10 days |
| **E. Release** | 14. Deployment | The service desk change request is approved; the deployment plan, rollback plan, date and approver are recorded | 3 days |
| | 15. Post Deployment Testing | Every production smoke check passes | 2 days |
| **F. Closure** | 16. Close Project | Closure report, lessons learned, handover to support, and the final sign-off (Waraidzo) | 5 days |

Targets are in **business days** (Monday to Friday, 08:00–17:00 Harare time, public holidays excluded).

## What you do

- **Move the project on:** in its Lifecycle tab, **Advance** works once everything for the stage is done. Until then
  it lists exactly what is missing. The project lead, Managers and Administrators can advance.
- **Attach a document** (BRS, BSS, notes, closure report): use **Upload** in the stage panel. Each upload is a new
  version (v1, v2…).
- **Sign off:** when your sign-off is needed you get a notification (bell and email). Open it, read the document
  version shown, then **Approve** or **Decline**. A decline needs a comment and sends the project back to the right
  stage.
- **Send back:** if a stage needs rework, **Send back** to an earlier stage, with a reason.
- **Skip a stage** (only where allowed: Risk Assessment, Technical Discovery, Server Allocation): **Ask to skip** with a
  justification. A Manager or Administrator, not you, approves it.
- **Tests:** add QAT, UAT and smoke test cases, then record Pass, Fail or Blocked. A failed test raises a bug
  automatically.

## Rules worth knowing

- **Signed documents are locked.** A change after sign-off means a new version and a new sign-off round.
- **You can't sign off your own submission.** If you uploaded the version being signed, your alternate signs
  instead (Mutsa for Waraidzo, Admin for Mutsa).
- **Reminders:** signatories are reminded after 2 business days. A stage running over its target is escalated to the
  Managers.
- **Every move is recorded:** who, when, why, and what the gate showed. You can see it in the stage's History.
- **Existing projects** were placed at the stage that matches where they were. Earlier stages show as "migrated"; no
  BRS or BSS is asked for after the fact.

Questions: ask an Administrator. They can change the stages, targets and signatories in Settings → Project Lifecycle.
