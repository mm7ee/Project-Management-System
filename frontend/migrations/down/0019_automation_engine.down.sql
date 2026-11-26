-- Reverses migrations/0019_automation_engine.sql. Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0019_automation_engine.down.sql
-- Rules using a trigger or action 0019 added are deleted (with their run logs); organisation rules become ordinary
-- rules in each workspace; condition groups, owners, webhook addresses and signing secrets go; the retry ledger goes.
-- Schedules made since keep running at their hour (the time is rounded down) every day or every week.
UPDATE automation_rules SET
  schedule_hour = COALESCE(schedule_hour, substr(trigger_config::jsonb ->> 'time', 1, 2)::int),
  schedule_weekday = CASE WHEN trigger_config::jsonb ->> 'every' = 'week' THEN (trigger_config::jsonb ->> 'weekday')::int ELSE schedule_weekday END
WHERE trigger = 'schedule' AND trigger_config IS NOT NULL;
DELETE FROM automation_rules WHERE trigger IN ('item_assigned', 'due_soon', 'due_passed', 'webhook', 'manual');
DELETE FROM automation_rules WHERE id IN (SELECT rule_id FROM automation_actions WHERE kind IN ('add_label', 'clear_field', 'create_item', 'email', 'message', 'webhook', 'escalate'));
DROP TABLE automation_fired;
DROP TABLE automation_jobs;
ALTER TABLE automation_runs DROP COLUMN detail;
ALTER TABLE automation_actions DROP COLUMN secret_sealed;
ALTER TABLE automation_actions DROP CONSTRAINT automation_actions_kind_check;
ALTER TABLE automation_actions ADD CONSTRAINT automation_actions_kind_check CHECK (kind IN ('transition', 'assign', 'set_field', 'comment', 'notify', 'create_subtask', 'link'));
DROP INDEX automation_rules_shared;
ALTER TABLE automation_rules DROP COLUMN trigger_config, DROP COLUMN webhook_token_hash, DROP COLUMN conditions, DROP COLUMN owner_id,
  DROP COLUMN rr_cursor, DROP COLUMN shared_id, DROP COLUMN shared_scope, DROP COLUMN failure_alerted_at;
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_check CHECK (trigger IN ('item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule'));
DELETE FROM schema_migrations WHERE name = '0019_automation_engine.sql';
