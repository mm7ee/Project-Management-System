-- Reverses migrations/0013_tenancy_schema.sql. Run by hand, never by `db.mjs migrate` (this folder isn't read):
--   node scripts/db.mjs exec dev migrations/down/0013_tenancy_schema.down.sql
-- Only valid while the Worker is still the single-organisation code: rows of any organisation other than
-- Omnicontact would be mixed back together, so it refuses when there is more than one.
--
-- Puts back: the rows set aside in tenancy_orphans, the references it cleared, the global unique
-- indexes on usernames and project keys. Removes: the tenant columns, triggers, functions and tables.
-- Not undone: "Projects" added to the old workspace list, if the migration had to create it.

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations) > 1 THEN
    RAISE EXCEPTION 'More than one organisation exists; undoing tenancy would mix their data. Restore the backup instead.';
  END IF;
END $$;

-- Triggers and the functions behind them.
DROP FUNCTION tenancy_fill() CASCADE;
DROP FUNCTION tenancy_new_user() CASCADE;
DROP FUNCTION tenancy_guard_system() CASCADE;
DROP FUNCTION tenancy_guard_workspaces() CASCADE;

-- The columns (their indexes and constraints go with them, including the per-organisation unique indexes).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'login_failures', 'passkeys', 'mfa_challenges', 'mfa_recovery', 'mfa_help_requests', 'password_history', 'password_resets',
                           'webauthn_challenges', 'work_statuses', 'workflows', 'workflow_statuses', 'workflow_transitions', 'workflow_rules',
                           'security_levels', 'security_level_grants', 'notification_schemes', 'notification_optouts', 'public_holidays', 'templates',
                           'sessions', 'systems', 'assignments', 'requests', 'blockers', 'documents', 'document_chunks', 'activity', 'notifications',
                           'share_links', 'work_items', 'work_item_labels', 'status_history', 'work_item_comments', 'work_item_watchers',
                           'work_item_links', 'work_logs', 'workspace_workflows', 'boards', 'board_columns', 'board_column_statuses', 'sprints',
                           'sprint_items', 'sprint_snapshots', 'saved_filters', 'filter_favourites', 'filter_subscriptions', 'dashboards',
                           'dashboard_gadgets', 'automation_rules', 'automation_actions', 'automation_runs', 'custom_fields', 'custom_field_options',
                           'custom_field_values', 'integration_secrets', 'dev_links', 'github_deliveries', 'api_tokens', 'api_token_usage', 'webhooks',
                           'webhook_deliveries', 'service_desk_config', 'request_types', 'request_type_fields', 'request_type_field_options',
                           'sla_targets', 'portal_links', 'sd_requests', 'sd_answers', 'sd_pauses', 'chat_conversations', 'chat_members',
                           'chat_messages', 'chat_files', 'chat_file_chunks', 'chat_reactions'] LOOP
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS workspace_id CASCADE', t);
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS organization_id CASCADE', t);
  END LOOP;
END $$;
ALTER TABLE users DROP COLUMN org_admin;
DROP INDEX IF EXISTS users_username_lookup;
DROP INDEX IF EXISTS systems_key_lookup;
CREATE UNIQUE INDEX users_username ON users (lower(username));
CREATE UNIQUE INDEX systems_key ON systems (key);

-- Rows set aside, newest first, so a parent (set aside after its children) comes back before them.
DO $$
DECLARE
  o RECORD;
BEGIN
  FOR o IN SELECT * FROM tenancy_orphans ORDER BY id DESC LOOP
    EXECUTE format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, $1)', o.table_name, o.table_name) USING o.row_data;
  END LOOP;
END $$;

-- References that were cleared.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM tenancy_report WHERE outcome = 'reference_cleared' AND cleared IS NOT NULL LOOP
    EXECUTE format('UPDATE %I SET %I = $1 WHERE id::text = $2', r.table_name, r.cleared) USING r.old_value, r.row_id;
  END LOOP;
END $$;

DROP TABLE tenancy_orphans;
DROP TABLE tenancy_report;
DROP TABLE tenancy_legacy;
DROP TABLE workspace_members;
DROP TABLE workspaces;
DROP TABLE organizations;
DROP FUNCTION tenancy_fk(TEXT, TEXT[], TEXT, TEXT[], TEXT, TEXT, TEXT);
DROP FUNCTION tenancy_set_aside(TEXT, TEXT, TEXT);
DROP FUNCTION tenancy_row_id(JSONB);
DROP FUNCTION tenancy_note(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION tenancy_link_workspace(TEXT);
DROP FUNCTION tenancy_activity_workspace(TEXT, TEXT);
DROP FUNCTION tenancy_system_workspace(TEXT);
DROP FUNCTION tenancy_workspace_named(TEXT);
DROP FUNCTION tenancy_id();
DROP FUNCTION tenancy_now();

DELETE FROM schema_migrations WHERE name = '0013_tenancy_schema.sql';
