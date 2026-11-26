-- Multi-tenancy, phase (b): the database enforces the tenant. See docs/multi-tenancy-plan.md and DECISIONS.md.
--
--   1. A role, pulse_app, that can't bypass row-level security and can't sign in. The Worker's connection
--      switches to it (SET LOCAL ROLE) inside every query's transaction, together with the request's
--      organisation and workspace (app.org_id, app.workspace_id). worker/pg.js does this.
--   2. Row-level security on every tenant table: workspace tables show and accept only the current
--      workspace's rows; organisation tables only the current organisation's. With no tenant set,
--      nothing is visible and nothing can be written: forgetting the scope fails closed.
--   3. organization_id / workspace_id default to the request's tenant, so inserts don't repeat them.
--   4. The phase (a) triggers (which placed rows in Omnicontact's "Projects") are removed. What remains
--      derives a row's organisation from its own user (sign-in tables), and keeps organisation-wide events
--      in the activity log out of any workspace.
--   5. Configuration ids are unique per organisation (statuses, workflows, moves, security levels) or per
--      workspace (request types, their questions and choices, automation rules and actions), so every
--      tenant can have its own "TODO" or "service-desk", which the code names.
--   6. Keys that were global become per tenant (notification schemes, holidays, GitHub secret, service
--      desk set-up, workspace boards and workflows, custom field names, notification de-duplication,
--      direct messages, status and workflow names).
--   7. settings splits into org_settings and workspace_settings. The old table stays, unused, for the
--      reverse migration; pulse_app can't read it.
--   8. The features view runs with the reader's rights, so row-level security applies through it.
--   9. tenancy_seed_organization / tenancy_seed_workspace copy configuration into a new tenant.
-- Reverse: migrations/down/0014_tenancy_enforcement.down.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. The application role
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    CREATE ROLE pulse_app NOLOGIN NOBYPASSRLS;
  END IF;
  -- The connection's own role may switch to it, without inheriting from it.
  EXECUTE format('GRANT pulse_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Settings by level
-- ---------------------------------------------------------------------------------------------
CREATE TABLE org_settings (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '') REFERENCES organizations (id),
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  PRIMARY KEY (organization_id, key)
);
CREATE TABLE workspace_settings (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
INSERT INTO org_settings (organization_id, key, value)
SELECT l.organization_id, s.key, s.value FROM settings s CROSS JOIN tenancy_legacy l
WHERE s.key IN ('role_permissions', 'mfa_policy', 'signin_rules', 'delivery', 'delivery_error');
-- Workload limits applied to every workspace; each now keeps its own copy.
INSERT INTO workspace_settings (organization_id, workspace_id, key, value)
SELECT w.organization_id, w.id, s.key, s.value FROM settings s JOIN workspaces w ON w.organization_id = (SELECT organization_id FROM tenancy_legacy)
WHERE s.key = 'workload_limits';
-- The last Monday Briefing covered everything; it stays with "Projects" until each workspace has its own.
INSERT INTO workspace_settings (organization_id, workspace_id, key, value)
SELECT l.organization_id, l.default_workspace_id, s.key, s.value FROM settings s CROSS JOIN tenancy_legacy l
WHERE s.key = 'latest_briefing';

-- ---------------------------------------------------------------------------------------------
-- 3. Phase (a)'s triggers go; defaults come from the request's tenant
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
           WHERE t.tgname IN ('tenancy_fill', 'tenancy_guard', 'tenancy_new_user') AND NOT t.tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', r.tgname, r.relname);
  END LOOP;
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name IN ('organization_id', 'workspace_id')
             AND table_name NOT LIKE 'tenancy\_%' AND table_name NOT IN ('features') LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT NULLIF(current_setting(%L, true), %L)',
      r.table_name, r.column_name, CASE r.column_name WHEN 'organization_id' THEN 'app.org_id' ELSE 'app.workspace_id' END, '');
  END LOOP;
END $$;

-- Organisation-wide events (sign-in, people, organisation settings) belong to no workspace.
CREATE FUNCTION tenancy_org_action(act TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT act IN ('login', 'login_failed', 'logout', 'logout_all', 'account_locked', 'account_unlocked', 'signin_ip_blocked',
                 'signin_rules_updated', 'password_changed', 'password_reset_requested', 'password_reset_by_email',
                 'user_created', 'user_updated', 'user_deleted', 'user_password_reset', 'profile_updated', 'roles_updated',
                 'mfa_enabled', 'mfa_disabled', 'mfa_reset', 'mfa_app_removed', 'mfa_recovery_regenerated', 'mfa_policy_updated',
                 'mfa_help_requested', 'mfa_help_dismissed', 'passkey_added', 'passkey_removed', 'delivery_updated',
                 'workspaces_updated', 'notification_optouts_updated', 'holidays_updated', 'template_created', 'template_deleted',
                 'status_created', 'status_updated', 'status_deleted', 'workflow_created', 'workflow_updated', 'workflow_deleted',
                 'notification_scheme_updated', 'security_level_created', 'security_level_updated', 'security_level_deleted',
                 'workspace_switched', 'workspace_created', 'workspace_updated', 'member_added', 'member_removed', 'member_role_changed')
$$;

-- Rows written before a tenant is known (signing in, resetting a password) take the organisation of their
-- own person. A session with no workspace opens its person's first one. Organisation-wide events have no workspace.
CREATE FUNCTION tenancy_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r   JSONB := to_jsonb(NEW);
  org TEXT := r ->> 'organization_id';
  ws  TEXT := r ->> 'workspace_id';
BEGIN
  IF org IS NULL AND r ->> 'user_id' IS NOT NULL THEN
    SELECT organization_id INTO org FROM users WHERE id = r ->> 'user_id';
  END IF;
  IF TG_TABLE_NAME = 'activity' AND tenancy_org_action(r ->> 'action') THEN
    ws := NULL;
  ELSIF TG_TABLE_NAME = 'sessions' AND ws IS NULL THEN
    SELECT m.workspace_id INTO ws FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = r ->> 'user_id' AND w.status = 'active' ORDER BY w.position, w.name LIMIT 1;
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object('organization_id', org, 'workspace_id', ws));
  RETURN NEW;
END $$;
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity', 'sessions', 'passkeys', 'mfa_challenges', 'mfa_recovery', 'mfa_help_requests', 'password_history',
                           'password_resets', 'webauthn_challenges', 'login_failures', 'notification_optouts'] LOOP
    EXECUTE format('CREATE TRIGGER tenancy_derive BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_derive()', t);
  END LOOP;
END $$;
-- A failed sign-in under an unknown name, or a reset asked for an unknown login, belongs to no organisation.
ALTER TABLE activity ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE password_resets ALTER COLUMN organization_id DROP NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 4. Configuration ids unique per tenant. Dropping each old primary key also drops the single-column
--    foreign keys on it; the composite ones added in 0013 already cover every one of them.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE work_statuses DROP CONSTRAINT work_statuses_pkey CASCADE;
ALTER TABLE work_statuses DROP CONSTRAINT work_statuses_name;
CREATE UNIQUE INDEX work_statuses_name ON work_statuses (organization_id, name);

ALTER TABLE workflows DROP CONSTRAINT workflows_pkey CASCADE;
ALTER TABLE workflows DROP CONSTRAINT workflows_name_key;
CREATE UNIQUE INDEX workflows_name ON workflows (organization_id, name);
DROP INDEX workflows_one_default;
CREATE UNIQUE INDEX workflows_one_default ON workflows (organization_id) WHERE is_default = 1;

ALTER TABLE workflow_statuses DROP CONSTRAINT workflow_statuses_pkey;
ALTER TABLE workflow_statuses ADD PRIMARY KEY (organization_id, workflow_id, status_id);
DROP INDEX workflow_statuses_one_initial;
CREATE UNIQUE INDEX workflow_statuses_one_initial ON workflow_statuses (organization_id, workflow_id) WHERE is_initial = 1;

ALTER TABLE workflow_transitions DROP CONSTRAINT workflow_transitions_pkey CASCADE;
ALTER TABLE workflow_transitions DROP CONSTRAINT workflow_transitions_workflow_id_from_status_to_status_key;
ALTER TABLE workflow_transitions ADD CONSTRAINT workflow_transitions_move UNIQUE NULLS NOT DISTINCT (organization_id, workflow_id, from_status, to_status);

ALTER TABLE security_levels DROP CONSTRAINT security_levels_pkey CASCADE;
DROP INDEX security_levels_name;
CREATE UNIQUE INDEX security_levels_name ON security_levels (organization_id, lower(name));
ALTER TABLE security_level_grants DROP CONSTRAINT security_level_grants_level_id_role_user_id_key;
ALTER TABLE security_level_grants ADD CONSTRAINT security_level_grants_once UNIQUE NULLS NOT DISTINCT (organization_id, level_id, role, user_id);

ALTER TABLE notification_schemes DROP CONSTRAINT notification_schemes_pkey;
ALTER TABLE notification_schemes ADD PRIMARY KEY (organization_id, event);
ALTER TABLE public_holidays DROP CONSTRAINT public_holidays_pkey;
ALTER TABLE public_holidays ADD PRIMARY KEY (organization_id, day);

ALTER TABLE request_types DROP CONSTRAINT request_types_pkey CASCADE;
ALTER TABLE request_type_fields DROP CONSTRAINT request_type_fields_pkey CASCADE;
ALTER TABLE request_type_field_options DROP CONSTRAINT request_type_field_options_pkey;
ALTER TABLE request_type_field_options ADD PRIMARY KEY (workspace_id, id);
ALTER TABLE sla_targets DROP CONSTRAINT sla_targets_pkey;
ALTER TABLE sla_targets ADD PRIMARY KEY (workspace_id, request_type_id, priority);
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_pkey CASCADE;
ALTER TABLE automation_actions DROP CONSTRAINT automation_actions_pkey;
ALTER TABLE automation_actions ADD PRIMARY KEY (workspace_id, id);

-- ---------------------------------------------------------------------------------------------
-- 5. Keys that were global become per tenant
-- ---------------------------------------------------------------------------------------------
ALTER TABLE integration_secrets DROP CONSTRAINT integration_secrets_pkey;
ALTER TABLE integration_secrets ADD PRIMARY KEY (workspace_id, kind);
ALTER TABLE service_desk_config DROP CONSTRAINT service_desk_config_pkey;
ALTER TABLE service_desk_config ADD PRIMARY KEY (workspace_id, id);
ALTER TABLE boards DROP CONSTRAINT boards_workspace_key;
CREATE UNIQUE INDEX boards_workspace ON boards (workspace_id) WHERE system_id IS NULL;
ALTER TABLE workspace_workflows DROP CONSTRAINT workspace_workflows_pkey;
ALTER TABLE workspace_workflows ADD PRIMARY KEY (workspace_id);
DROP INDEX custom_fields_name;
CREATE UNIQUE INDEX custom_fields_name ON custom_fields (workspace_id, lower(name));
DROP INDEX notifications_once;
CREATE UNIQUE INDEX notifications_once ON notifications (workspace_id, user_id, dedupe);
DROP INDEX chat_conversations_direct;
CREATE UNIQUE INDEX chat_conversations_direct ON chat_conversations (workspace_id, direct_key) WHERE direct_key IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 6. Row-level security
-- ---------------------------------------------------------------------------------------------
ALTER VIEW features SET (security_invoker = true);
DO $$
DECLARE
  t   TEXT;
  ws  TEXT := 'workspace_id = current_setting(''app.workspace_id'', true)';
  org TEXT := 'organization_id = current_setting(''app.org_id'', true)';
BEGIN
  -- Workspace tables: the current workspace only.
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables tb USING (table_schema, table_name)
           WHERE c.table_schema = 'public' AND c.column_name = 'workspace_id' AND tb.table_type = 'BASE TABLE'
             AND c.table_name NOT LIKE 'tenancy\_%' AND c.table_name NOT IN ('sessions', 'workspace_members', 'activity') LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (%s) WITH CHECK (%s AND %s)', t, ws, ws, org);
  END LOOP;
  -- Organisation tables: the current organisation only.
  FOREACH t IN ARRAY ARRAY['sessions', 'passkeys', 'mfa_challenges', 'mfa_recovery', 'mfa_help_requests', 'password_history', 'password_resets',
                           'webauthn_challenges', 'login_failures', 'work_statuses', 'workflows', 'workflow_statuses', 'workflow_transitions',
                           'workflow_rules', 'security_levels', 'security_level_grants', 'notification_schemes', 'notification_optouts',
                           'public_holidays', 'templates', 'workspaces', 'workspace_members', 'org_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (%s) WITH CHECK (%s)', t, org, org);
  END LOOP;
END $$;
-- The activity log: the current workspace's entries, and the organisation-wide ones (only people with the
-- audit permission reach them, checked by the code).
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON activity TO pulse_app
  USING (organization_id = current_setting('app.org_id', true) AND (workspace_id IS NULL OR workspace_id = current_setting('app.workspace_id', true)))
  WITH CHECK (organization_id = current_setting('app.org_id', true) AND (workspace_id IS NULL OR workspace_id = current_setting('app.workspace_id', true)));
-- People. The accounts table holds each person once per organisation; the `users` view (section 6b) shows them
-- with their role in the open workspace. Within a workspace only its members are visible (so nobody else can be
-- assigned, told or mentioned); organisation-wide (no workspace set), everyone in the organisation.
ALTER TABLE users RENAME TO accounts;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON accounts FOR SELECT TO pulse_app USING (
  organization_id = current_setting('app.org_id', true)
  AND (COALESCE(current_setting('app.workspace_id', true), '') = ''
       OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = accounts.id AND m.workspace_id = current_setting('app.workspace_id', true))));
CREATE POLICY tenant_add ON accounts FOR INSERT TO pulse_app WITH CHECK (organization_id = current_setting('app.org_id', true));
CREATE POLICY tenant_change ON accounts FOR UPDATE TO pulse_app USING (
  organization_id = current_setting('app.org_id', true)
  AND (COALESCE(current_setting('app.workspace_id', true), '') = ''
       OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = accounts.id AND m.workspace_id = current_setting('app.workspace_id', true))))
  WITH CHECK (organization_id = current_setting('app.org_id', true));
CREATE POLICY tenant_remove ON accounts FOR DELETE TO pulse_app USING (
  organization_id = current_setting('app.org_id', true)
  AND (COALESCE(current_setting('app.workspace_id', true), '') = ''
       OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = accounts.id AND m.workspace_id = current_setting('app.workspace_id', true))));
-- An organisation sees itself, and changes nothing about itself here (the platform screens do, as the owner).
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON organizations FOR SELECT TO pulse_app USING (id = current_setting('app.org_id', true));

-- ---------------------------------------------------------------------------------------------
-- 6b. `users`: people with their role in the open workspace
-- ---------------------------------------------------------------------------------------------
-- A person's role is per workspace (workspace_members.role). The code reads `users.role` in some thirty places
-- (permissions, who is told, who may be assigned); this view makes every one of them mean "their role here"
-- without changing them. Outside a workspace (signing in, organisation screens) it is the account's own role.
-- Writes through the view go where they belong: a role change to this workspace's membership; removing a person
-- to their membership here, and their account too once no workspace is left.
CREATE VIEW users WITH (security_invoker = true) AS
SELECT a.id, a.username, a.name, a.title, a.email, a.phone, COALESCE(m.role, a.role) AS role, a.project_id, a.password_hash, a.prefs,
       a.must_change_password, a.mfa_secret, a.mfa_pending, a.mfa_last_step, a.mfa_enabled_at, a.locked_until, a.locked_at,
       a.organization_id, a.org_admin
FROM accounts a
LEFT JOIN workspace_members m ON m.user_id = a.id AND m.workspace_id = NULLIF(current_setting('app.workspace_id', true), '');
ALTER VIEW users ALTER COLUMN title SET DEFAULT '';
ALTER VIEW users ALTER COLUMN prefs SET DEFAULT '{}';
ALTER VIEW users ALTER COLUMN must_change_password SET DEFAULT 0;
ALTER VIEW users ALTER COLUMN mfa_last_step SET DEFAULT 0;
ALTER VIEW users ALTER COLUMN org_admin SET DEFAULT 0;
ALTER VIEW users ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting('app.org_id', true), '');

CREATE FUNCTION users_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ws  TEXT := NULLIF(current_setting('app.workspace_id', true), '');
  org TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    org := COALESCE(NEW.organization_id, NULLIF(current_setting('app.org_id', true), ''));
    INSERT INTO accounts (id, username, name, title, email, phone, role, project_id, password_hash, prefs, must_change_password, mfa_secret,
                          mfa_pending, mfa_last_step, mfa_enabled_at, locked_until, locked_at, organization_id, org_admin)
    VALUES (NEW.id, NEW.username, NEW.name, NEW.title, NEW.email, NEW.phone, NEW.role, NEW.project_id, NEW.password_hash, NEW.prefs,
            NEW.must_change_password, NEW.mfa_secret, NEW.mfa_pending, NEW.mfa_last_step, NEW.mfa_enabled_at, NEW.locked_until, NEW.locked_at,
            org, NEW.org_admin);
    IF ws IS NOT NULL THEN
      INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at) VALUES (org, ws, NEW.id, NEW.role, tenancy_now());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE accounts SET username = NEW.username, name = NEW.name, title = NEW.title, email = NEW.email, phone = NEW.phone,
      role = CASE WHEN ws IS NULL THEN NEW.role ELSE role END, project_id = NEW.project_id, password_hash = NEW.password_hash, prefs = NEW.prefs,
      must_change_password = NEW.must_change_password, mfa_secret = NEW.mfa_secret, mfa_pending = NEW.mfa_pending, mfa_last_step = NEW.mfa_last_step,
      mfa_enabled_at = NEW.mfa_enabled_at, locked_until = NEW.locked_until, locked_at = NEW.locked_at, org_admin = NEW.org_admin
    WHERE id = OLD.id;
    IF ws IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
      UPDATE workspace_members SET role = NEW.role WHERE workspace_id = ws AND user_id = OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  IF ws IS NOT NULL THEN
    DELETE FROM workspace_members WHERE workspace_id = ws AND user_id = OLD.id;
    IF EXISTS (SELECT 1 FROM workspace_members WHERE user_id = OLD.id) THEN
      RETURN OLD;
    END IF;
  END IF;
  DELETE FROM accounts WHERE id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER users_write INSTEAD OF INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION users_write();

-- ---------------------------------------------------------------------------------------------
-- 7. What pulse_app may touch
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO pulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pulse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pulse_app;
REVOKE ALL ON settings, schema_migrations, tenancy_legacy, tenancy_report, tenancy_orphans FROM pulse_app;
REVOKE INSERT, UPDATE, DELETE ON organizations FROM pulse_app;
-- Tables made by later migrations are reachable too (each still needs its own policy).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pulse_app;

-- ---------------------------------------------------------------------------------------------
-- 8. Configuration for a new tenant: a copy of another tenant's, with the same ids
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION tenancy_seed_organization(target TEXT, source TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO work_statuses (organization_id, id, name, category, position, created_at)
    SELECT target, id, name, category, position, tenancy_now() FROM work_statuses WHERE organization_id = source;
  INSERT INTO workflows (organization_id, id, name, description, is_default, created_at, updated_at)
    SELECT target, id, name, description, is_default, tenancy_now(), tenancy_now() FROM workflows WHERE organization_id = source;
  INSERT INTO workflow_statuses (organization_id, workflow_id, status_id, position, is_initial)
    SELECT target, workflow_id, status_id, position, is_initial FROM workflow_statuses WHERE organization_id = source;
  INSERT INTO workflow_transitions (organization_id, id, workflow_id, name, from_status, to_status, position)
    SELECT target, id, workflow_id, name, from_status, to_status, position FROM workflow_transitions WHERE organization_id = source;
  INSERT INTO workflow_rules (organization_id, transition_id, kind, rule, value)
    SELECT target, transition_id, kind, rule, value FROM workflow_rules WHERE organization_id = source;
  INSERT INTO security_levels (organization_id, id, name, description, position, created_at, updated_at)
    SELECT target, id, name, description, position, tenancy_now(), tenancy_now() FROM security_levels WHERE organization_id = source;
  INSERT INTO security_level_grants (organization_id, level_id, role, user_id)
    SELECT target, level_id, role, NULL FROM security_level_grants WHERE organization_id = source AND role IS NOT NULL;
  INSERT INTO notification_schemes (organization_id, event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, updated_at)
    SELECT target, event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, tenancy_now() FROM notification_schemes WHERE organization_id = source;
  INSERT INTO public_holidays (organization_id, day, name)
    SELECT target, day, name FROM public_holidays WHERE organization_id = source;
END $$;
CREATE FUNCTION tenancy_seed_workspace(target TEXT, source TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  org TEXT := (SELECT organization_id FROM workspaces WHERE id = target);
BEGIN
  INSERT INTO request_types (organization_id, workspace_id, id, name, kind, description, item_type, position, enabled, created_at, updated_at)
    SELECT org, target, id, name, kind, description, item_type, position, enabled, tenancy_now(), tenancy_now() FROM request_types WHERE workspace_id = source;
  INSERT INTO request_type_fields (organization_id, workspace_id, id, request_type_id, label, kind, help, required, position)
    SELECT org, target, id, request_type_id, label, kind, help, required, position FROM request_type_fields WHERE workspace_id = source;
  INSERT INTO request_type_field_options (organization_id, workspace_id, id, field_id, label, position)
    SELECT org, target, id, field_id, label, position FROM request_type_field_options WHERE workspace_id = source;
  INSERT INTO sla_targets (organization_id, workspace_id, request_type_id, priority, first_response_minutes, resolution_minutes)
    SELECT org, target, request_type_id, priority, first_response_minutes, resolution_minutes FROM sla_targets WHERE workspace_id = source;
END $$;
REVOKE EXECUTE ON FUNCTION tenancy_seed_organization(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION tenancy_seed_workspace(TEXT, TEXT) FROM PUBLIC;

-- Every workspace can now run its own service desk: those without request types get a copy of the
-- service desk workspace's (types, questions, choices and SLA targets; no requests).
DO $$
DECLARE
  src TEXT;
  w   RECORD;
BEGIN
  SELECT workspace_id INTO src FROM request_types GROUP BY workspace_id ORDER BY count(*) DESC LIMIT 1;
  IF src IS NULL THEN
    RETURN;
  END IF;
  FOR w IN SELECT id FROM workspaces x WHERE x.id <> src AND x.organization_id = (SELECT organization_id FROM workspaces WHERE id = src)
             AND NOT EXISTS (SELECT 1 FROM request_types r WHERE r.workspace_id = x.id) LOOP
    PERFORM tenancy_seed_workspace(w.id, src);
  END LOOP;
END $$;
