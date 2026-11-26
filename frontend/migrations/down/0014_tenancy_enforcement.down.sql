-- Reverses migrations/0014_tenancy_enforcement.sql, back to the state after 0013 (phase (a)). Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0014_tenancy_enforcement.down.sql
-- Only with one organisation (ids become global again), and only after the Worker is back on phase (a) code.
-- Settings changed since go back into the old settings table. Request types copied into other workspaces are removed.

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations) > 1 THEN
    RAISE EXCEPTION 'More than one organisation exists; ids would collide. Restore the backup instead.';
  END IF;
END $$;

-- Row-level security and the role.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename);
  END LOOP;
  FOR r IN SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
ALTER VIEW features RESET (security_invoker);
-- People: the view goes, the table takes its name back.
DROP VIEW users;
DROP FUNCTION users_write();
ALTER TABLE accounts RENAME TO users;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM pulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM pulse_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pulse_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pulse_app;
REVOKE USAGE ON SCHEMA public FROM pulse_app;
-- The role itself is left in place (roles belong to the whole branch); DROP ROLE pulse_app by hand if wanted.

-- Settings back into the one table.
INSERT INTO settings (key, value) SELECT key, value FROM org_settings
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
INSERT INTO settings (key, value)
SELECT key, value FROM workspace_settings WHERE workspace_id = (SELECT default_workspace_id FROM tenancy_legacy)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
DELETE FROM settings WHERE key = 'delivery_error' AND NOT EXISTS (SELECT 1 FROM org_settings WHERE key = 'delivery_error');
DROP TABLE workspace_settings;
DROP TABLE org_settings;

-- Copies of the request types in other workspaces.
-- (0013 put them with the service desk's project, else in "Projects"; that copy stays.)
DELETE FROM request_types WHERE workspace_id <> COALESCE(
  (SELECT workspace_id FROM service_desk_config WHERE system_id IS NOT NULL LIMIT 1),
  (SELECT default_workspace_id FROM tenancy_legacy));

-- Keys back to global.
DROP INDEX chat_conversations_direct;
CREATE UNIQUE INDEX chat_conversations_direct ON chat_conversations (direct_key) WHERE direct_key IS NOT NULL;
DROP INDEX notifications_once;
CREATE UNIQUE INDEX notifications_once ON notifications (user_id, dedupe);
DROP INDEX custom_fields_name;
CREATE UNIQUE INDEX custom_fields_name ON custom_fields (workspace, lower(name));
ALTER TABLE workspace_workflows DROP CONSTRAINT workspace_workflows_pkey;
ALTER TABLE workspace_workflows ADD PRIMARY KEY (workspace);
DROP INDEX boards_workspace;
ALTER TABLE boards ADD CONSTRAINT boards_workspace_key UNIQUE (workspace);
ALTER TABLE service_desk_config DROP CONSTRAINT service_desk_config_pkey;
ALTER TABLE service_desk_config ADD PRIMARY KEY (id);
ALTER TABLE integration_secrets DROP CONSTRAINT integration_secrets_pkey;
ALTER TABLE integration_secrets ADD PRIMARY KEY (kind);

-- Configuration ids back to global, with their single-column foreign keys.
ALTER TABLE automation_actions DROP CONSTRAINT automation_actions_pkey;
ALTER TABLE automation_actions ADD PRIMARY KEY (id);
ALTER TABLE automation_rules ADD PRIMARY KEY (id);
ALTER TABLE automation_actions ADD FOREIGN KEY (rule_id) REFERENCES automation_rules (id) ON DELETE CASCADE;
ALTER TABLE automation_runs ADD FOREIGN KEY (rule_id) REFERENCES automation_rules (id) ON DELETE CASCADE;
ALTER TABLE sla_targets DROP CONSTRAINT sla_targets_pkey;
ALTER TABLE sla_targets ADD PRIMARY KEY (request_type_id, priority);
ALTER TABLE request_type_field_options DROP CONSTRAINT request_type_field_options_pkey;
ALTER TABLE request_type_field_options ADD PRIMARY KEY (id);
ALTER TABLE request_type_fields ADD PRIMARY KEY (id);
ALTER TABLE request_types ADD PRIMARY KEY (id);
ALTER TABLE request_type_fields ADD FOREIGN KEY (request_type_id) REFERENCES request_types (id) ON DELETE CASCADE;
ALTER TABLE request_type_field_options ADD FOREIGN KEY (field_id) REFERENCES request_type_fields (id) ON DELETE CASCADE;
ALTER TABLE sla_targets ADD FOREIGN KEY (request_type_id) REFERENCES request_types (id) ON DELETE CASCADE;
ALTER TABLE sd_requests ADD FOREIGN KEY (request_type_id) REFERENCES request_types (id);
ALTER TABLE public_holidays DROP CONSTRAINT public_holidays_pkey;
ALTER TABLE public_holidays ADD PRIMARY KEY (day);
ALTER TABLE notification_schemes DROP CONSTRAINT notification_schemes_pkey;
ALTER TABLE notification_schemes ADD PRIMARY KEY (event);
ALTER TABLE security_level_grants DROP CONSTRAINT security_level_grants_once;
ALTER TABLE security_level_grants ADD CONSTRAINT security_level_grants_level_id_role_user_id_key UNIQUE NULLS NOT DISTINCT (level_id, role, user_id);
ALTER TABLE security_levels ADD PRIMARY KEY (id);
DROP INDEX security_levels_name;
CREATE UNIQUE INDEX security_levels_name ON security_levels (lower(name));
ALTER TABLE security_level_grants ADD FOREIGN KEY (level_id) REFERENCES security_levels (id) ON DELETE CASCADE;
ALTER TABLE work_items ADD FOREIGN KEY (security_level) REFERENCES security_levels (id);
ALTER TABLE workflow_transitions DROP CONSTRAINT workflow_transitions_move;
ALTER TABLE workflow_transitions ADD CONSTRAINT workflow_transitions_workflow_id_from_status_to_status_key UNIQUE NULLS NOT DISTINCT (workflow_id, from_status, to_status);
ALTER TABLE workflow_transitions ADD PRIMARY KEY (id);
ALTER TABLE workflow_rules ADD FOREIGN KEY (transition_id) REFERENCES workflow_transitions (id) ON DELETE CASCADE;
DROP INDEX workflow_statuses_one_initial;
CREATE UNIQUE INDEX workflow_statuses_one_initial ON workflow_statuses (workflow_id) WHERE is_initial = 1;
ALTER TABLE workflow_statuses DROP CONSTRAINT workflow_statuses_pkey;
ALTER TABLE workflow_statuses ADD PRIMARY KEY (workflow_id, status_id);
DROP INDEX workflows_one_default;
CREATE UNIQUE INDEX workflows_one_default ON workflows (is_default) WHERE is_default = 1;
DROP INDEX workflows_name;
ALTER TABLE workflows ADD CONSTRAINT workflows_name_key UNIQUE (name);
ALTER TABLE workflows ADD PRIMARY KEY (id);
ALTER TABLE workflow_statuses ADD FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE;
ALTER TABLE workflow_transitions ADD FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE;
ALTER TABLE workspace_workflows ADD FOREIGN KEY (workflow_id) REFERENCES workflows (id);
ALTER TABLE systems ADD FOREIGN KEY (workflow_id) REFERENCES workflows (id);
DROP INDEX work_statuses_name;
ALTER TABLE work_statuses ADD CONSTRAINT work_statuses_name UNIQUE (name);
ALTER TABLE work_statuses ADD PRIMARY KEY (id);
ALTER TABLE work_items ADD FOREIGN KEY (status) REFERENCES work_statuses (id);
ALTER TABLE workflow_statuses ADD FOREIGN KEY (status_id) REFERENCES work_statuses (id);
ALTER TABLE workflow_transitions ADD FOREIGN KEY (from_status) REFERENCES work_statuses (id);
ALTER TABLE workflow_transitions ADD FOREIGN KEY (to_status) REFERENCES work_statuses (id);
ALTER TABLE board_column_statuses ADD FOREIGN KEY (status_id) REFERENCES work_statuses (id) ON DELETE CASCADE;

-- Phase (b)'s triggers and defaults out, phase (a)'s triggers back.
UPDATE activity SET organization_id = (SELECT organization_id FROM tenancy_legacy) WHERE organization_id IS NULL;
ALTER TABLE activity ALTER COLUMN organization_id SET NOT NULL;
UPDATE password_resets SET organization_id = (SELECT organization_id FROM tenancy_legacy) WHERE organization_id IS NULL;
ALTER TABLE password_resets ALTER COLUMN organization_id SET NOT NULL;
DROP FUNCTION tenancy_derive() CASCADE;
DROP FUNCTION tenancy_org_action(TEXT);
DROP FUNCTION tenancy_seed_organization(TEXT, TEXT);
DROP FUNCTION tenancy_seed_workspace(TEXT, TEXT);
DO $$
DECLARE
  r    RECORD;
  t    TEXT;
  spec TEXT[];
BEGIN
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name IN ('organization_id', 'workspace_id')
             AND table_name NOT LIKE 'tenancy\_%' AND table_name NOT IN ('features') LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', r.table_name, r.column_name);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['passkeys', 'mfa_challenges', 'mfa_recovery', 'mfa_help_requests', 'password_history', 'password_resets',
                                      'webauthn_challenges', 'work_statuses', 'workflows', 'workflow_statuses', 'workflow_transitions', 'workflow_rules',
                                      'security_levels', 'security_level_grants', 'notification_schemes', 'notification_optouts', 'public_holidays', 'templates', 'users'] LOOP
    EXECUTE format('CREATE TRIGGER tenancy_fill BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_fill(''org'')', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER tenancy_fill BEFORE INSERT ON login_failures FOR EACH ROW EXECUTE FUNCTION tenancy_fill(''org_if_user'')';
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['sessions', 'session', '', ''], ['systems', 'systems', '', ''], ['assignments', 'parent', 'system_id', 'systems'],
    ['requests', 'parent', 'system_id', 'systems'], ['blockers', 'parent', 'system_id', 'systems'], ['documents', 'parent', 'system_id', 'systems'],
    ['document_chunks', 'parent', 'doc_id', 'documents'], ['activity', 'activity', '', ''], ['notifications', 'notification', '', ''],
    ['share_links', 'default', '', ''], ['work_items', 'parent', 'system_id', 'systems'], ['work_item_labels', 'parent', 'item_id', 'work_items'],
    ['status_history', 'parent', 'item_id', 'work_items'], ['work_item_comments', 'parent', 'item_id', 'work_items'],
    ['work_item_watchers', 'parent', 'item_id', 'work_items'], ['work_item_links', 'parent', 'from_id', 'work_items'],
    ['work_logs', 'parent', 'item_id', 'work_items'], ['workspace_workflows', 'workspace_name', 'workspace', ''], ['boards', 'board', '', ''],
    ['board_columns', 'parent', 'board_id', 'boards'], ['board_column_statuses', 'parent', 'board_id', 'boards'],
    ['sprints', 'parent', 'system_id', 'systems'], ['sprint_items', 'parent', 'sprint_id', 'sprints'], ['sprint_snapshots', 'parent', 'sprint_id', 'sprints'],
    ['saved_filters', 'shared', '', ''], ['filter_favourites', 'parent', 'filter_id', 'saved_filters'],
    ['filter_subscriptions', 'parent', 'filter_id', 'saved_filters'], ['dashboards', 'shared', '', ''],
    ['dashboard_gadgets', 'parent', 'dashboard_id', 'dashboards'], ['automation_rules', 'automation', '', ''],
    ['automation_actions', 'parent', 'rule_id', 'automation_rules'], ['automation_runs', 'parent', 'rule_id', 'automation_rules'],
    ['custom_fields', 'workspace_name', 'workspace', ''], ['custom_field_options', 'parent', 'field_id', 'custom_fields'],
    ['custom_field_values', 'parent', 'item_id', 'work_items'], ['integration_secrets', 'default', '', ''], ['dev_links', 'parent', 'item_id', 'work_items'],
    ['github_deliveries', 'default', '', ''], ['api_tokens', 'default', '', ''], ['api_token_usage', 'parent', 'token_id', 'api_tokens'],
    ['webhooks', 'parent', 'system_id', 'systems'], ['webhook_deliveries', 'parent', 'webhook_id', 'webhooks'],
    ['service_desk_config', 'parent', 'system_id', 'systems'], ['request_types', 'service_desk', '', ''],
    ['request_type_fields', 'parent', 'request_type_id', 'request_types'], ['request_type_field_options', 'parent', 'field_id', 'request_type_fields'],
    ['sla_targets', 'parent', 'request_type_id', 'request_types'], ['portal_links', 'service_desk', '', ''], ['sd_requests', 'parent', 'item_id', 'work_items'],
    ['sd_answers', 'parent', 'item_id', 'work_items'], ['sd_pauses', 'parent', 'item_id', 'work_items'],
    ['chat_conversations', 'parent', 'system_id', 'systems'], ['chat_members', 'parent', 'conversation_id', 'chat_conversations'],
    ['chat_messages', 'parent', 'conversation_id', 'chat_conversations'], ['chat_files', 'parent', 'conversation_id', 'chat_conversations'],
    ['chat_file_chunks', 'parent', 'file_id', 'chat_files'], ['chat_reactions', 'parent', 'message_id', 'chat_messages']
  ] LOOP
    IF spec[3] <> '' THEN
      EXECUTE format('CREATE TRIGGER tenancy_fill BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_fill(%L, %L, %L)', spec[1], spec[2], spec[3], spec[4]);
    ELSE
      EXECUTE format('CREATE TRIGGER tenancy_fill BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_fill(%L)', spec[1], spec[2]);
    END IF;
  END LOOP;
END $$;
CREATE TRIGGER tenancy_new_user AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION tenancy_new_user();
CREATE TRIGGER tenancy_guard BEFORE UPDATE OF data ON systems FOR EACH ROW EXECUTE FUNCTION tenancy_guard_system();
CREATE TRIGGER tenancy_guard BEFORE INSERT OR UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION tenancy_guard_workspaces();

DELETE FROM schema_migrations WHERE name = '0014_tenancy_enforcement.sql';
