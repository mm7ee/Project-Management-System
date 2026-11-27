-- Reverses migrations/0020_sla_approvals_webhooks.sql. Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0020_sla_approvals_webhooks.down.sql
-- Work item SLAs, approvals (pending ones are dropped: those moves can be made again) and webhook payload templates
-- go. Approval rules are taken out of workflows, and automation rules on SLA or approval triggers are deleted.
DELETE FROM workflow_rules WHERE rule = 'approval';
DELETE FROM automation_rules WHERE trigger IN ('sla_warning', 'sla_breached', 'approval_granted', 'approval_rejected');
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_check CHECK (trigger IN (
  'item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule',
  'item_assigned', 'due_soon', 'due_passed', 'webhook', 'manual'));
ALTER TABLE webhooks DROP COLUMN payload_template;
DROP TABLE approval_votes;
DROP TABLE approvals;
DROP TABLE item_sla_events;
DROP TABLE sla_policies;
DELETE FROM schema_migrations WHERE name = '0020_sla_approvals_webhooks.sql';
