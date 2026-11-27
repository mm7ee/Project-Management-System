-- Reverses 0025_project_lifecycle.sql: no lifecycles, registers or stage-changed rules (those rules are removed).
DELETE FROM automation_rules WHERE trigger = 'stage_changed';
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_check CHECK (trigger IN (
  'item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule',
  'item_assigned', 'due_soon', 'due_passed', 'webhook', 'manual', 'sla_warning', 'sla_breached', 'approval_granted', 'approval_rejected'));
ALTER TABLE work_items DROP COLUMN lifecycle_stage;
DROP TRIGGER documents_locked_guard ON documents;
DROP FUNCTION documents_locked_guard();
DROP INDEX documents_deliverable;
ALTER TABLE documents DROP COLUMN stage_code, DROP COLUMN deliverable_key, DROP COLUMN version, DROP COLUMN locked_at, DROP COLUMN locked_by;
DROP TABLE stage_records, project_environments, test_runs, test_cases, security_findings, risk_register,
  stage_requests, stage_signoffs, stage_checklist_items, project_stage_history, project_lifecycle, lifecycle_stages, lifecycle_templates;
DROP FUNCTION lifecycle_decided_guard();
