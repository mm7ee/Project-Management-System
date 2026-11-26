-- Multi-tenancy, phase (a): organisations and workspaces become rows, and every tenant table says
-- which one it belongs to. See docs/multi-tenancy-plan.md.
--
-- What this does:
--   1. New tables: organizations, workspaces, workspace_members. "Omnicontact" is the first
--      organisation; each name in settings.workspaces becomes a workspace ("Projects" is added if
--      missing). Every existing person joins every workspace with their current role, as today,
--      where everyone sees every workspace. Administrators become Organisation Administrators.
--   2. organization_id on every organisation-level table (people, sign-in, shared configuration).
--   3. organization_id + workspace_id on every workspace table, filled from the row's parent
--      (project → work item → comment …), then NOT NULL, indexed, with foreign keys.
--   4. Composite foreign keys, e.g. (workspace_id, item_id) → work_items (workspace_id, id), so the
--      database refuses a row whose workspace differs from its parent's, whatever the code does.
--   5. Usernames and project keys become unique per organisation instead of globally.
--   6. Insert triggers fill the new columns from the parent, so the code released before phase (b),
--      which doesn't know about them, keeps working. Phase (b) sets them itself.
--   7. While this phase is live without phase (b): renaming or removing a workspace, and moving a
--      project to another workspace, are refused with a message. Adding a workspace still works.
--
-- Nothing is silently dropped. Every placement that isn't obvious is written to tenancy_report;
-- every row that can't be kept (its parent is gone, or it links two workspaces) is copied whole into
-- tenancy_orphans before it is removed. scripts/tenancy-dry-run.mjs runs this file and rolls it back.
-- Reverse: migrations/down/0013_tenancy_schema.down.sql.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION tenancy_now() RETURNS TEXT LANGUAGE sql AS $$
  SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
-- Short random text ids, the same shape as the Worker's (16 hex characters).
CREATE FUNCTION tenancy_id() RETURNS TEXT LANGUAGE sql AS $$
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Organisations, workspaces, members
-- ---------------------------------------------------------------------------------------------
CREATE TABLE organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  code       TEXT NOT NULL CHECK (code ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'), -- typed at sign-in
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  settings   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX organizations_code ON organizations (code);

CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  key             TEXT NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CONSTRAINT workspaces_org_id UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX workspaces_name ON workspaces (organization_id, lower(name));
CREATE UNIQUE INDEX workspaces_key ON workspaces (organization_id, key);

CREATE TABLE workspace_members (
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'team_lead', 'assistant', 'developer', 'viewer')),
  joined_at       TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_workspace FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX workspace_members_user ON workspace_members (user_id);

-- Where rows from the single-organisation code go until phase (b): one row.
CREATE TABLE tenancy_legacy (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  organization_id      TEXT NOT NULL REFERENCES organizations (id),
  default_workspace_id TEXT NOT NULL REFERENCES workspaces (id), -- "Projects": rows with no workspace of their own
  first_workspace_id   TEXT NOT NULL REFERENCES workspaces (id)  -- first on the old list: projects with none, as the app showed them
);
-- Every placement that needs a human look, and every row moved aside.
CREATE TABLE tenancy_report (
  id           BIGSERIAL PRIMARY KEY,
  at           TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  row_id       TEXT,
  workspace_id TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('default_workspace', 'reference_cleared', 'moved_to_orphans', 'summary')),
  reason       TEXT NOT NULL,
  cleared      TEXT, -- reference_cleared: the column …
  old_value    TEXT  -- … and the value it had, so the down migration can put it back
);
CREATE TABLE tenancy_orphans (
  id         BIGSERIAL PRIMARY KEY,
  at         TEXT NOT NULL,
  table_name TEXT NOT NULL,
  reason     TEXT NOT NULL,
  row_data   JSONB NOT NULL
);

DO $$
DECLARE
  org   TEXT := tenancy_id();
  names JSONB;
  n     TEXT;
  i     INTEGER := 0;
  base  TEXT;
  k     TEXT;
  s     INTEGER;
  dflt  TEXT;
  first TEXT;
BEGIN
  INSERT INTO organizations (id, name, code, created_at, updated_at) VALUES (org, 'Omnicontact', 'omnicontact', tenancy_now(), tenancy_now());
  SELECT value::jsonb INTO names FROM settings WHERE key = 'workspaces';
  names := COALESCE(names, '["Projects", "HR"]'::jsonb); -- DEFAULT_WORKSPACES until someone edits the list
  FOR n IN SELECT trim(x) FROM jsonb_array_elements_text(names) WITH ORDINALITY AS e(x, ord) WHERE trim(x) <> '' ORDER BY ord LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM workspaces WHERE organization_id = org AND lower(name) = lower(n));
    base := regexp_replace(left(regexp_replace(upper(n), '[^A-Z0-9]', '', 'g'), 8), '^[0-9]+', '');
    IF length(base) < 2 THEN base := 'WS'; END IF;
    k := base;
    s := 1;
    WHILE EXISTS (SELECT 1 FROM workspaces WHERE organization_id = org AND key = k) LOOP
      s := s + 1;
      k := base || s;
    END LOOP;
    INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (tenancy_id(), org, n, k, i, tenancy_now(), tenancy_now());
    i := i + 1;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE organization_id = org AND lower(name) = 'projects') THEN
    k := 'PROJECTS';
    s := 1;
    WHILE EXISTS (SELECT 1 FROM workspaces WHERE organization_id = org AND key = k) LOOP
      s := s + 1;
      k := 'PROJECTS' || s;
    END LOOP;
    INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at) VALUES (tenancy_id(), org, 'Projects', k, i, tenancy_now(), tenancy_now());
    INSERT INTO tenancy_report (at, table_name, row_id, outcome, reason) VALUES (tenancy_now(), 'workspaces', 'Projects', 'summary', 'There was no "Projects" workspace; it was added to hold rows with no workspace of their own');
    -- The old code's list must name it too, or saving that list would look like removing it.
    UPDATE settings SET value = (value::jsonb || '["Projects"]'::jsonb)::text WHERE key = 'workspaces';
  END IF;
  SELECT id INTO dflt FROM workspaces WHERE organization_id = org AND lower(name) = 'projects';
  SELECT id INTO first FROM workspaces WHERE organization_id = org ORDER BY position LIMIT 1;
  INSERT INTO tenancy_legacy VALUES (1, org, dflt, first);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN organization_id TEXT REFERENCES organizations (id);
ALTER TABLE users ADD COLUMN org_admin INTEGER NOT NULL DEFAULT 0; -- 1: Organisation Administrator
UPDATE users SET organization_id = (SELECT organization_id FROM tenancy_legacy), org_admin = CASE WHEN role = 'admin' THEN 1 ELSE 0 END;
ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_org_id UNIQUE (organization_id, id);
DROP INDEX users_username;
CREATE UNIQUE INDEX users_username ON users (organization_id, lower(username));
CREATE INDEX users_username_lookup ON users (lower(username)); -- the sign-in lookup, until phase (c) adds the organisation to it

INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at)
SELECT w.organization_id, w.id, u.id, u.role, tenancy_now()
FROM users u JOIN workspaces w ON w.organization_id = u.organization_id;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_user FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 3. Placement rules, shared by the backfill below and by the insert triggers
-- ---------------------------------------------------------------------------------------------
-- A workspace of the legacy organisation by name (any capitals), or NULL.
CREATE FUNCTION tenancy_workspace_named(n TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT w.id FROM workspaces w JOIN tenancy_legacy l ON l.organization_id = w.organization_id
  WHERE lower(w.name) = lower(trim(n))
$$;

-- A project's workspace from its JSON, as the app placed it: a name on the list, else the first workspace.
CREATE FUNCTION tenancy_system_workspace(data TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(tenancy_workspace_named(data::jsonb ->> 'workspace'), (SELECT first_workspace_id FROM tenancy_legacy))
$$;

-- Activity: events about people, sign-in and shared configuration belong to the organisation (no
-- workspace). Events about a project or a work item belong to its workspace. Anything else: "Projects".
-- (PL/pgSQL, not SQL: it reads systems.workspace_id, which is only added further down.)
CREATE FUNCTION tenancy_activity_workspace(act TEXT, tgt TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN CASE
    WHEN act IN ('login', 'login_failed', 'logout', 'logout_all', 'account_locked', 'account_unlocked', 'signin_ip_blocked',
                 'signin_rules_updated', 'password_changed', 'password_reset_requested', 'password_reset_by_email',
                 'user_created', 'user_updated', 'user_deleted', 'user_password_reset', 'profile_updated', 'roles_updated',
                 'mfa_enabled', 'mfa_disabled', 'mfa_reset', 'mfa_app_removed', 'mfa_recovery_regenerated', 'mfa_policy_updated',
                 'mfa_help_requested', 'mfa_help_dismissed', 'passkey_added', 'passkey_removed', 'delivery_updated',
                 'workspaces_updated', 'notification_optouts_updated', 'holidays_updated', 'template_created', 'template_deleted',
                 'status_created', 'status_updated', 'status_deleted', 'workflow_created', 'workflow_updated', 'workflow_deleted',
                 'notification_scheme_updated', 'security_level_created', 'security_level_updated', 'security_level_deleted')
      THEN NULL
    ELSE COALESCE(
      (SELECT s.workspace_id FROM systems s WHERE s.id = tgt),
      (SELECT s.workspace_id FROM systems s WHERE tgt ~ '^[A-Z]{2,10}-[0-9]+$' AND s.key = split_part(tgt, '-', 1)
         AND s.organization_id = (SELECT organization_id FROM tenancy_legacy)),
      (SELECT default_workspace_id FROM tenancy_legacy))
  END;
END $$;

-- A bell notification's workspace, from what it links to.
CREATE FUNCTION tenancy_link_workspace(link TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE(
    (SELECT s.workspace_id FROM systems s WHERE s.id = substring(link FROM '^#/projects/([^/?#]+)')),
    (SELECT c.workspace_id FROM chat_conversations c WHERE c.id = substring(link FROM '^#/chat/([^/?#]+)')),
    (SELECT default_workspace_id FROM tenancy_legacy));
END $$;

-- Fills organization_id / workspace_id on insert when the code didn't (the code before phase (b)).
-- TG_ARGV[0] is how; [1] and [2] are its column and parent table where it needs them.
CREATE FUNCTION tenancy_fill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r     JSONB := to_jsonb(NEW);
  how   TEXT := TG_ARGV[0];
  org   TEXT := r ->> 'organization_id';
  ws    TEXT := r ->> 'workspace_id';
  l     tenancy_legacy%ROWTYPE;
BEGIN
  SELECT * INTO l FROM tenancy_legacy;
  IF how = 'org' THEN
    org := COALESCE(org, l.organization_id);
  ELSIF how = 'org_if_user' THEN
    IF org IS NULL AND r ->> 'user_id' IS NOT NULL THEN
      SELECT organization_id INTO org FROM users WHERE id = r ->> 'user_id';
    END IF;
  ELSIF ws IS NULL THEN
    IF how = 'parent' THEN
      IF r ->> TG_ARGV[1] IS NOT NULL THEN
        -- Compared in the parent's own type, so its primary key index is used.
        EXECUTE format('SELECT workspace_id FROM %I WHERE id = $1::%s', TG_ARGV[2], CASE WHEN TG_ARGV[2] = 'chat_messages' THEN 'bigint' ELSE 'text' END)
          INTO ws USING r ->> TG_ARGV[1];
      END IF;
      ws := COALESCE(ws, l.default_workspace_id);
    ELSIF how = 'systems' THEN
      ws := tenancy_system_workspace(r ->> 'data');
    ELSIF how = 'workspace_name' THEN
      ws := COALESCE(tenancy_workspace_named(r ->> TG_ARGV[1]), l.default_workspace_id);
    ELSIF how = 'board' THEN
      SELECT workspace_id INTO ws FROM systems WHERE id = r ->> 'system_id';
      ws := COALESCE(ws, tenancy_workspace_named(r ->> 'workspace'), l.default_workspace_id);
    ELSIF how = 'shared' THEN
      ws := CASE WHEN r ->> 'share_scope' = 'workspace' THEN tenancy_workspace_named(r ->> 'share_value') END;
      ws := COALESCE(ws, l.default_workspace_id);
    ELSIF how = 'automation' THEN
      ws := CASE r ->> 'scope'
              WHEN 'workspace' THEN tenancy_workspace_named(r ->> 'scope_value')
              WHEN 'project' THEN (SELECT workspace_id FROM systems WHERE id = r ->> 'scope_value')
            END;
      ws := COALESCE(ws, l.default_workspace_id);
    ELSIF how = 'service_desk' THEN
      SELECT workspace_id INTO ws FROM service_desk_config WHERE id = 1;
      ws := COALESCE(ws, l.default_workspace_id);
    ELSIF how = 'session' THEN
      SELECT m.workspace_id INTO ws FROM workspace_members m WHERE m.user_id = r ->> 'user_id'
      ORDER BY (m.workspace_id = l.default_workspace_id) DESC, m.workspace_id LIMIT 1;
      ws := COALESCE(ws, l.default_workspace_id);
    ELSIF how = 'activity' THEN
      ws := tenancy_activity_workspace(r ->> 'action', r ->> 'target');
    ELSIF how = 'notification' THEN
      ws := tenancy_link_workspace(r ->> 'link');
    ELSE -- 'default'
      ws := l.default_workspace_id;
    END IF;
  END IF;
  IF org IS NULL AND ws IS NOT NULL THEN
    SELECT organization_id INTO org FROM workspaces WHERE id = ws;
  END IF;
  IF how NOT IN ('org', 'org_if_user') OR org IS NOT NULL THEN
    org := COALESCE(org, l.organization_id);
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object('organization_id', org, 'workspace_id', ws));
  RETURN NEW;
END $$;

-- Records a placement or a move.
CREATE FUNCTION tenancy_note(tbl TEXT, rid TEXT, ws TEXT, outcome TEXT, why TEXT) RETURNS void LANGUAGE sql AS $$
  INSERT INTO tenancy_report (at, table_name, row_id, workspace_id, outcome, reason) VALUES (tenancy_now(), tbl, rid, ws, outcome, why)
$$;

-- A readable id for a row of any table (its id, else its key columns without big data).
CREATE FUNCTION tenancy_row_id(j JSONB) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(j ->> 'id', left((j - 'data' - 'detail' - 'payload' - 'body')::text, 300))
$$;

-- Copies the rows of `tbl` matching `cond` into tenancy_orphans, notes each one, then removes them.
CREATE FUNCTION tenancy_set_aside(tbl TEXT, cond TEXT, why TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
BEGIN
  EXECUTE format(
    'WITH gone AS (SELECT to_jsonb(t) AS j FROM %I t WHERE %s), kept AS (INSERT INTO tenancy_orphans (at, table_name, reason, row_data) SELECT tenancy_now(), %L, %L, j FROM gone RETURNING row_data) '
    'INSERT INTO tenancy_report (at, table_name, row_id, workspace_id, outcome, reason) SELECT tenancy_now(), %L, tenancy_row_id(row_data), row_data ->> ''workspace_id'', ''moved_to_orphans'', %L FROM kept',
    tbl, cond, tbl, why, tbl, why);
  EXECUTE format('DELETE FROM %I t WHERE %s', tbl, cond);
END $$;

-- Adds a composite foreign key. Rows that break it are dealt with first, and reported:
-- a reference that may be empty is cleared (`clear` names the column); otherwise the row is set aside.
CREATE FUNCTION tenancy_fk(child TEXT, cols TEXT[], parent TEXT, pcols TEXT[], on_delete TEXT, clear TEXT, why TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  bad TEXT;
  i   INTEGER;
  m   TEXT := '';
  nn  TEXT := '';
BEGIN
  FOR i IN 1 .. array_length(cols, 1) LOOP
    m := m || CASE WHEN i > 1 THEN ' AND ' ELSE '' END || format('p.%I = t.%I', pcols[i], cols[i]);
    nn := nn || CASE WHEN i > 1 THEN ' AND ' ELSE '' END || format('t.%I IS NOT NULL', cols[i]);
  END LOOP;
  bad := format('%s AND NOT EXISTS (SELECT 1 FROM %I p WHERE %s)', nn, parent, m);
  IF clear IS NOT NULL THEN
    EXECUTE format('INSERT INTO tenancy_report (at, table_name, row_id, workspace_id, outcome, reason, cleared, old_value) SELECT tenancy_now(), %L, tenancy_row_id(to_jsonb(t)), t.workspace_id, ''reference_cleared'', %L, %L, t.%I::text FROM %I t WHERE %s',
      child, why || ' (' || clear || ' cleared)', clear, clear, child, bad);
    EXECUTE format('UPDATE %I t SET %I = NULL WHERE %s', child, clear, bad);
  ELSE
    PERFORM tenancy_set_aside(child, bad, why);
  END IF;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I (%s) %s',
    child, left('tn_' || child || '_' || array_to_string(cols[2:], '_'), 63),
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(cols) c), parent,
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(pcols) c), on_delete);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Organisation-level tables
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t   TEXT;
  org TEXT := (SELECT organization_id FROM tenancy_legacy);
BEGIN
  FOREACH t IN ARRAY ARRAY['passkeys', 'mfa_challenges', 'mfa_recovery', 'mfa_help_requests', 'password_history', 'password_resets',
                           'webauthn_challenges', 'work_statuses', 'workflows', 'workflow_statuses', 'workflow_transitions', 'workflow_rules',
                           'security_levels', 'security_level_grants', 'notification_schemes', 'notification_optouts', 'public_holidays', 'templates'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id TEXT', t);
    EXECUTE format('UPDATE %I SET organization_id = %L', t, org);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations (id)', t, 'tn_' || t || '_org');
    EXECUTE format('CREATE INDEX %I ON %I (organization_id)', t || '_org', t);
    EXECUTE format('CREATE TRIGGER tenancy_fill BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_fill(''org'')', t);
  END LOOP;
END $$;
-- Failed sign-ins are counted per address across every organisation, and per account within one.
ALTER TABLE login_failures ADD COLUMN organization_id TEXT REFERENCES organizations (id);
UPDATE login_failures f SET organization_id = u.organization_id FROM users u WHERE u.id = f.user_id;
CREATE INDEX login_failures_org ON login_failures (organization_id, at);
CREATE TRIGGER tenancy_fill BEFORE INSERT ON login_failures FOR EACH ROW EXECUTE FUNCTION tenancy_fill('org_if_user');
-- Shared configuration that workspace rows point at.
ALTER TABLE work_statuses ADD CONSTRAINT work_statuses_org_id UNIQUE (organization_id, id);
ALTER TABLE workflows ADD CONSTRAINT workflows_org_id UNIQUE (organization_id, id);
ALTER TABLE workflow_transitions ADD CONSTRAINT workflow_transitions_org_id UNIQUE (organization_id, id);
ALTER TABLE security_levels ADD CONSTRAINT security_levels_org_id UNIQUE (organization_id, id);

-- ---------------------------------------------------------------------------------------------
-- 5. Workspace tables: the columns
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions', 'systems', 'assignments', 'requests', 'blockers', 'documents', 'document_chunks', 'activity', 'notifications',
                           'share_links', 'work_items', 'work_item_labels', 'status_history', 'work_item_comments', 'work_item_watchers',
                           'work_item_links', 'work_logs', 'workspace_workflows', 'boards', 'board_columns', 'board_column_statuses', 'sprints',
                           'sprint_items', 'sprint_snapshots', 'saved_filters', 'filter_favourites', 'filter_subscriptions', 'dashboards',
                           'dashboard_gadgets', 'automation_rules', 'automation_actions', 'automation_runs', 'custom_fields', 'custom_field_options',
                           'custom_field_values', 'integration_secrets', 'dev_links', 'github_deliveries', 'api_tokens', 'api_token_usage', 'webhooks',
                           'webhook_deliveries', 'service_desk_config', 'request_types', 'request_type_fields', 'request_type_field_options',
                           'sla_targets', 'portal_links', 'sd_requests', 'sd_answers', 'sd_pauses', 'chat_conversations', 'chat_members',
                           'chat_messages', 'chat_files', 'chat_file_chunks', 'chat_reactions'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id TEXT, ADD COLUMN workspace_id TEXT', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Workspace tables: where each row goes (parents before children)
-- ---------------------------------------------------------------------------------------------
-- Projects, from their JSON, as the app showed them.
UPDATE systems SET workspace_id = tenancy_system_workspace(data);
SELECT tenancy_note('systems', id, workspace_id, 'default_workspace',
  CASE WHEN COALESCE(trim(data::jsonb ->> 'workspace'), '') = '' THEN 'No workspace set; the app showed it in the first workspace, so it goes there'
       ELSE 'Workspace "' || (data::jsonb ->> 'workspace') || '" is not on the list; the app showed it in the first workspace, so it goes there' END)
FROM systems WHERE tenancy_workspace_named(data::jsonb ->> 'workspace') IS NULL;

-- Rows that hang off a project.
UPDATE assignments t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE requests t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE blockers t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE documents t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE sprints t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE work_items t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE document_chunks t SET workspace_id = d.workspace_id FROM documents d WHERE d.id = t.doc_id;

-- Rows that hang off a work item or a sprint.
UPDATE work_item_labels t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE status_history t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE work_item_comments t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE work_item_watchers t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE work_item_links t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.from_id;
UPDATE work_logs t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE custom_field_values t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE dev_links t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE sd_requests t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE sd_answers t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE sd_pauses t SET workspace_id = w.workspace_id FROM work_items w WHERE w.id = t.item_id;
UPDATE sprint_items t SET workspace_id = s.workspace_id FROM sprints s WHERE s.id = t.sprint_id;
UPDATE sprint_snapshots t SET workspace_id = s.workspace_id FROM sprints s WHERE s.id = t.sprint_id;

-- Things named by workspace. A board, workflow choice or custom field of a workspace that is no longer
-- on the list can't be placed anywhere sensible: it is set aside (with a board's columns, and a field's
-- options and values) rather than appearing in another workspace.
UPDATE boards t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE boards SET workspace_id = tenancy_workspace_named(workspace) WHERE workspace_id IS NULL AND workspace IS NOT NULL;
SELECT tenancy_set_aside('board_column_statuses', 'board_id IN (SELECT id FROM boards WHERE workspace_id IS NULL AND system_id IS NULL)', 'Its board belongs to a workspace that is no longer on the list');
SELECT tenancy_set_aside('board_columns', 'board_id IN (SELECT id FROM boards WHERE workspace_id IS NULL AND system_id IS NULL)', 'Its board belongs to a workspace that is no longer on the list');
SELECT tenancy_set_aside('boards', 'workspace_id IS NULL AND system_id IS NULL', 'A board for a workspace that is no longer on the list');
UPDATE board_columns t SET workspace_id = b.workspace_id FROM boards b WHERE b.id = t.board_id;
UPDATE board_column_statuses t SET workspace_id = b.workspace_id FROM boards b WHERE b.id = t.board_id;

UPDATE workspace_workflows SET workspace_id = tenancy_workspace_named(workspace);
SELECT tenancy_set_aside('workspace_workflows', 'workspace_id IS NULL', 'The workflow choice of a workspace that is no longer on the list');

UPDATE custom_fields SET workspace_id = tenancy_workspace_named(workspace);
SELECT tenancy_set_aside('custom_field_values', 'field_id IN (SELECT id FROM custom_fields WHERE workspace_id IS NULL)', 'A value of a custom field whose workspace is no longer on the list');
SELECT tenancy_set_aside('custom_field_options', 'field_id IN (SELECT id FROM custom_fields WHERE workspace_id IS NULL)', 'An option of a custom field whose workspace is no longer on the list');
SELECT tenancy_set_aside('custom_fields', 'workspace_id IS NULL', 'A custom field of a workspace that is no longer on the list');
UPDATE custom_field_options t SET workspace_id = f.workspace_id FROM custom_fields f WHERE f.id = t.field_id;

-- Filters and dashboards: shared with a workspace → that workspace. Private, role and everyone → "Projects".
UPDATE saved_filters SET workspace_id = tenancy_workspace_named(share_value) WHERE share_scope = 'workspace';
SELECT tenancy_note('saved_filters', id, NULL, 'default_workspace',
  CASE WHEN share_scope = 'workspace' THEN 'Shared with workspace "' || COALESCE(share_value, '') || '", which is not on the list'
       ELSE CASE share_scope WHEN 'private' THEN 'A private filter' WHEN 'role' THEN 'A filter shared with a role' ELSE 'A filter shared with everyone' END
            || ' ("' || name || '", owner ' || owner_id || '); it searched every workspace, now it searches "Projects"' END)
FROM saved_filters WHERE workspace_id IS NULL;
UPDATE dashboards SET workspace_id = tenancy_workspace_named(share_value) WHERE share_scope = 'workspace';
SELECT tenancy_note('dashboards', id, NULL, 'default_workspace',
  CASE WHEN share_scope = 'workspace' THEN 'Shared with workspace "' || COALESCE(share_value, '') || '", which is not on the list'
       ELSE CASE share_scope WHEN 'private' THEN 'A private dashboard' WHEN 'role' THEN 'A dashboard shared with a role' ELSE 'A dashboard shared with everyone' END
            || ' ("' || name || '", owner ' || owner_id || ')' END)
FROM dashboards WHERE workspace_id IS NULL;

-- Automation: a workspace's or a project's rule goes there. Rules for "every project" go to "Projects".
UPDATE automation_rules SET workspace_id = tenancy_workspace_named(scope_value) WHERE scope = 'workspace';
UPDATE automation_rules t SET workspace_id = s.workspace_id FROM systems s WHERE t.scope = 'project' AND s.id = t.scope_value;
SELECT tenancy_note('automation_rules', id, NULL, 'default_workspace',
  CASE WHEN scope = 'global' THEN 'Rule "' || name || '" ran on every project; it now runs on the "Projects" workspace only (enabled: ' || enabled || ')'
       ELSE 'Rule "' || name || '" is scoped to ' || scope || ' "' || COALESCE(scope_value, '') || '", which no longer exists' END)
FROM automation_rules WHERE workspace_id IS NULL;

-- Integrations and links that belonged to all of Pulse go to "Projects".
UPDATE webhooks t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
SELECT tenancy_note('webhooks', id, NULL, 'default_workspace', 'Webhook "' || name || '" sent events for every project; it now sends those of "Projects" only')
FROM webhooks WHERE workspace_id IS NULL;
SELECT tenancy_note('api_tokens', id, NULL, 'default_workspace', 'Token "' || name || '" (' || prefix || '…, owner ' || user_id || ') reached every workspace; it now reaches "Projects" only')
FROM api_tokens WHERE revoked_at IS NULL AND expires_at > tenancy_now();
SELECT tenancy_note('share_links', id, NULL, 'default_workspace', 'View-only link "' || label || '" showed every workspace; it now shows "Projects" only')
FROM share_links WHERE revoked_at IS NULL AND expires_at > tenancy_now();
SELECT tenancy_note('integration_secrets', kind, NULL, 'default_workspace', 'The GitHub connection now links commits to items in "Projects" only')
FROM integration_secrets;

-- The service desk lives in the workspace of the project that receives its requests.
UPDATE service_desk_config t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
UPDATE request_types SET workspace_id = (SELECT workspace_id FROM service_desk_config WHERE id = 1);
UPDATE portal_links SET workspace_id = (SELECT workspace_id FROM service_desk_config WHERE id = 1);
SELECT tenancy_note('request_types', NULL, NULL, 'summary', 'No service desk project is chosen, so the request types go to "Projects"')
WHERE NOT EXISTS (SELECT 1 FROM service_desk_config WHERE workspace_id IS NOT NULL) AND EXISTS (SELECT 1 FROM request_types);

-- Chat: a project's channel goes with the project. Direct messages and groups go to "Projects".
UPDATE chat_conversations t SET workspace_id = s.workspace_id FROM systems s WHERE s.id = t.system_id;
SELECT tenancy_note('chat_conversations', NULL, NULL, 'summary',
  count(*) || ' ' || kind || ' conversation(s) were visible in every workspace; they are now in "Projects"')
FROM chat_conversations WHERE workspace_id IS NULL GROUP BY kind;

-- Sessions open the user's "Projects" workspace (everyone is a member of it), so nobody is signed out.
UPDATE sessions t SET organization_id = u.organization_id FROM users u WHERE u.id = t.user_id;
UPDATE sessions SET workspace_id = (SELECT default_workspace_id FROM tenancy_legacy);

-- The bell and the activity log, by what each entry is about.
UPDATE notifications SET workspace_id = tenancy_link_workspace(link);
UPDATE activity SET workspace_id = tenancy_activity_workspace(action, target);
SELECT tenancy_note('activity', NULL, workspace_id, 'summary', count(*) || ' activity entries' || CASE WHEN workspace_id IS NULL THEN ' are organisation-wide (sign-in, people, settings)' ELSE '' END)
FROM activity GROUP BY workspace_id;

-- Everything else that is still unplaced has no parent of its own (or its parent is gone): "Projects".
-- Rows whose parent is gone are set aside when their foreign key is added below.
DO $$
DECLARE
  t    TEXT;
  n    INTEGER;
  dflt TEXT := (SELECT default_workspace_id FROM tenancy_legacy);
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions', 'systems', 'assignments', 'requests', 'blockers', 'documents', 'document_chunks', 'notifications', 'share_links',
                           'work_items', 'work_item_labels', 'status_history', 'work_item_comments', 'work_item_watchers', 'work_item_links', 'work_logs',
                           'boards', 'board_columns', 'board_column_statuses', 'sprints', 'sprint_items', 'sprint_snapshots', 'saved_filters',
                           'filter_favourites', 'filter_subscriptions', 'dashboards', 'automation_rules', 'custom_field_options', 'custom_field_values',
                           'integration_secrets', 'dev_links', 'github_deliveries', 'api_tokens', 'webhooks', 'service_desk_config', 'request_types',
                           'request_type_fields', 'request_type_field_options', 'sla_targets', 'portal_links', 'sd_requests', 'sd_answers', 'sd_pauses',
                           'chat_conversations'] LOOP
    EXECUTE format('UPDATE %I SET workspace_id = %L WHERE workspace_id IS NULL', t, dflt);
  END LOOP;
END $$;
-- Children of the rows just placed.
UPDATE filter_favourites t SET workspace_id = f.workspace_id FROM saved_filters f WHERE f.id = t.filter_id;
UPDATE filter_subscriptions t SET workspace_id = f.workspace_id FROM saved_filters f WHERE f.id = t.filter_id;
UPDATE request_type_fields t SET workspace_id = r.workspace_id FROM request_types r WHERE r.id = t.request_type_id;
UPDATE request_type_field_options t SET workspace_id = f.workspace_id FROM request_type_fields f WHERE f.id = t.field_id;
UPDATE sla_targets t SET workspace_id = r.workspace_id FROM request_types r WHERE r.id = t.request_type_id;
UPDATE dashboard_gadgets t SET workspace_id = d.workspace_id FROM dashboards d WHERE d.id = t.dashboard_id;
UPDATE automation_actions t SET workspace_id = r.workspace_id FROM automation_rules r WHERE r.id = t.rule_id;
UPDATE automation_runs t SET workspace_id = r.workspace_id FROM automation_rules r WHERE r.id = t.rule_id;
UPDATE api_token_usage t SET workspace_id = k.workspace_id FROM api_tokens k WHERE k.id = t.token_id;
UPDATE webhook_deliveries t SET workspace_id = h.workspace_id FROM webhooks h WHERE h.id = t.webhook_id;
UPDATE chat_members t SET workspace_id = c.workspace_id FROM chat_conversations c WHERE c.id = t.conversation_id;
UPDATE chat_messages t SET workspace_id = c.workspace_id FROM chat_conversations c WHERE c.id = t.conversation_id;
UPDATE chat_files t SET workspace_id = c.workspace_id FROM chat_conversations c WHERE c.id = t.conversation_id;
UPDATE chat_file_chunks t SET workspace_id = f.workspace_id FROM chat_files f WHERE f.id = t.file_id;
UPDATE chat_reactions t SET workspace_id = m.workspace_id FROM chat_messages m WHERE m.id = t.message_id;

-- ---------------------------------------------------------------------------------------------
-- 7. Workspace tables: NOT NULL, organisation from the workspace, foreign key, index, insert trigger
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t     TEXT;
  how   TEXT;
  spec  TEXT[];
  dflt  TEXT := (SELECT default_workspace_id FROM tenancy_legacy);
  org   TEXT := (SELECT organization_id FROM tenancy_legacy);
  n     INTEGER;
BEGIN
  -- table, then how its insert trigger places a new row (see tenancy_fill)
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['sessions', 'session', '', ''],
    ['systems', 'systems', '', ''],
    ['assignments', 'parent', 'system_id', 'systems'],
    ['requests', 'parent', 'system_id', 'systems'],
    ['blockers', 'parent', 'system_id', 'systems'],
    ['documents', 'parent', 'system_id', 'systems'],
    ['document_chunks', 'parent', 'doc_id', 'documents'],
    ['activity', 'activity', '', ''],
    ['notifications', 'notification', '', ''],
    ['share_links', 'default', '', ''],
    ['work_items', 'parent', 'system_id', 'systems'],
    ['work_item_labels', 'parent', 'item_id', 'work_items'],
    ['status_history', 'parent', 'item_id', 'work_items'],
    ['work_item_comments', 'parent', 'item_id', 'work_items'],
    ['work_item_watchers', 'parent', 'item_id', 'work_items'],
    ['work_item_links', 'parent', 'from_id', 'work_items'],
    ['work_logs', 'parent', 'item_id', 'work_items'],
    ['workspace_workflows', 'workspace_name', 'workspace', ''],
    ['boards', 'board', '', ''],
    ['board_columns', 'parent', 'board_id', 'boards'],
    ['board_column_statuses', 'parent', 'board_id', 'boards'],
    ['sprints', 'parent', 'system_id', 'systems'],
    ['sprint_items', 'parent', 'sprint_id', 'sprints'],
    ['sprint_snapshots', 'parent', 'sprint_id', 'sprints'],
    ['saved_filters', 'shared', '', ''],
    ['filter_favourites', 'parent', 'filter_id', 'saved_filters'],
    ['filter_subscriptions', 'parent', 'filter_id', 'saved_filters'],
    ['dashboards', 'shared', '', ''],
    ['dashboard_gadgets', 'parent', 'dashboard_id', 'dashboards'],
    ['automation_rules', 'automation', '', ''],
    ['automation_actions', 'parent', 'rule_id', 'automation_rules'],
    ['automation_runs', 'parent', 'rule_id', 'automation_rules'],
    ['custom_fields', 'workspace_name', 'workspace', ''],
    ['custom_field_options', 'parent', 'field_id', 'custom_fields'],
    ['custom_field_values', 'parent', 'item_id', 'work_items'],
    ['integration_secrets', 'default', '', ''],
    ['dev_links', 'parent', 'item_id', 'work_items'],
    ['github_deliveries', 'default', '', ''],
    ['api_tokens', 'default', '', ''],
    ['api_token_usage', 'parent', 'token_id', 'api_tokens'],
    ['webhooks', 'parent', 'system_id', 'systems'],
    ['webhook_deliveries', 'parent', 'webhook_id', 'webhooks'],
    ['service_desk_config', 'parent', 'system_id', 'systems'],
    ['request_types', 'service_desk', '', ''],
    ['request_type_fields', 'parent', 'request_type_id', 'request_types'],
    ['request_type_field_options', 'parent', 'field_id', 'request_type_fields'],
    ['sla_targets', 'parent', 'request_type_id', 'request_types'],
    ['portal_links', 'service_desk', '', ''],
    ['sd_requests', 'parent', 'item_id', 'work_items'],
    ['sd_answers', 'parent', 'item_id', 'work_items'],
    ['sd_pauses', 'parent', 'item_id', 'work_items'],
    ['chat_conversations', 'parent', 'system_id', 'systems'],
    ['chat_members', 'parent', 'conversation_id', 'chat_conversations'],
    ['chat_messages', 'parent', 'conversation_id', 'chat_conversations'],
    ['chat_files', 'parent', 'conversation_id', 'chat_conversations'],
    ['chat_file_chunks', 'parent', 'file_id', 'chat_files'],
    ['chat_reactions', 'parent', 'message_id', 'chat_messages']
  ] LOOP
    t := spec[1];
    -- Anything a child of a row placed by default (its parent was gone) is set aside by its foreign key below.
    IF t <> 'activity' THEN
      EXECUTE format('UPDATE %I SET workspace_id = %L WHERE workspace_id IS NULL', t, dflt);
    END IF;
    EXECUTE format('UPDATE %I t SET organization_id = COALESCE((SELECT w.organization_id FROM workspaces w WHERE w.id = t.workspace_id), %L) WHERE organization_id IS NULL', t, org);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    IF t <> 'activity' THEN -- organisation-wide entries have no workspace
      EXECUTE format('ALTER TABLE %I ALTER COLUMN workspace_id SET NOT NULL', t);
    END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id)', t, left('tn_' || t || '_ws', 63));
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations (id)', t, left('tn_' || t || '_org', 63));
    EXECUTE format('CREATE INDEX %I ON %I (workspace_id)', left(t || '_ws', 63), t);
    IF spec[3] <> '' THEN
      EXECUTE format('CREATE TRIGGER tenancy_fill BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_fill(%L, %L, %L)', t, spec[2], spec[3], spec[4]);
    ELSE
      EXECUTE format('CREATE TRIGGER tenancy_fill BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenancy_fill(%L)', t, spec[2]);
    END IF;
  END LOOP;
END $$;
CREATE INDEX activity_org_at ON activity (organization_id, at);

-- ---------------------------------------------------------------------------------------------
-- 8. Parents a child can point at, by workspace
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['systems', 'documents', 'work_items', 'sprints', 'boards', 'board_columns', 'saved_filters', 'dashboards', 'automation_rules',
                           'custom_fields', 'custom_field_options', 'api_tokens', 'webhooks', 'request_types', 'request_type_fields',
                           'chat_conversations', 'chat_messages', 'chat_files'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (workspace_id, id)', t, left(t || '_ws_id', 63));
  END LOOP;
END $$;
-- Sessions may only open a workspace their person belongs to (removing a membership ends those sessions).
SELECT tenancy_fk('sessions', ARRAY['workspace_id', 'user_id'], 'workspace_members', ARRAY['workspace_id', 'user_id'], 'ON DELETE CASCADE', NULL, 'A session of someone who no longer has an account');

-- ---------------------------------------------------------------------------------------------
-- 9. Composite foreign keys: a child is always in its parent's workspace (parents first)
-- ---------------------------------------------------------------------------------------------
SELECT tenancy_fk('assignments', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Assignment to a project that no longer exists');
SELECT tenancy_fk('requests', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Update request for a project that no longer exists');
SELECT tenancy_fk('blockers', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Blocker of a project that no longer exists');
SELECT tenancy_fk('documents', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Document of a project that no longer exists');
SELECT tenancy_fk('document_chunks', ARRAY['workspace_id', 'doc_id'], 'documents', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Part of a document that no longer exists');
SELECT tenancy_fk('sprints', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Sprint of a project in another workspace');
SELECT tenancy_fk('work_items', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Work item of a project in another workspace');
SELECT tenancy_fk('work_items', ARRAY['workspace_id', 'parent_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE SET NULL (parent_id)', 'parent_id', 'Its parent is in another workspace');
SELECT tenancy_fk('work_items', ARRAY['workspace_id', 'sprint_id'], 'sprints', ARRAY['workspace_id', 'id'], 'ON DELETE SET NULL (sprint_id)', 'sprint_id', 'Its sprint is in another workspace');
SELECT tenancy_fk('documents', ARRAY['workspace_id', 'work_item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Attachment of a work item in another workspace');
SELECT tenancy_fk('work_item_labels', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Label of a work item in another workspace');
SELECT tenancy_fk('status_history', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'History of a work item in another workspace');
SELECT tenancy_fk('work_item_comments', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Comment on a work item in another workspace');
SELECT tenancy_fk('work_item_watchers', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Watcher of a work item in another workspace');
SELECT tenancy_fk('work_item_links', ARRAY['workspace_id', 'from_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Link from a work item in another workspace');
SELECT tenancy_fk('work_item_links', ARRAY['workspace_id', 'to_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'A link between work items in two different workspaces');
SELECT tenancy_fk('work_logs', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Time logged on a work item in another workspace');
SELECT tenancy_fk('sprint_items', ARRAY['workspace_id', 'sprint_id'], 'sprints', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Sprint record of a sprint in another workspace');
SELECT tenancy_fk('sprint_items', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Sprint record of a work item in another workspace');
SELECT tenancy_fk('sprint_snapshots', ARRAY['workspace_id', 'sprint_id'], 'sprints', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Snapshot of a sprint in another workspace');
SELECT tenancy_fk('boards', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Board of a project in another workspace');
SELECT tenancy_fk('board_columns', ARRAY['workspace_id', 'board_id'], 'boards', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Column of a board in another workspace');
SELECT tenancy_fk('board_column_statuses', ARRAY['workspace_id', 'board_id'], 'boards', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Column status of a board in another workspace');
SELECT tenancy_fk('board_column_statuses', ARRAY['workspace_id', 'column_id'], 'board_columns', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Column status of a column in another workspace');
SELECT tenancy_fk('filter_favourites', ARRAY['workspace_id', 'filter_id'], 'saved_filters', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Star on a filter in another workspace');
SELECT tenancy_fk('filter_subscriptions', ARRAY['workspace_id', 'filter_id'], 'saved_filters', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Subscription to a filter in another workspace');
SELECT tenancy_fk('dashboard_gadgets', ARRAY['workspace_id', 'dashboard_id'], 'dashboards', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Gadget of a dashboard in another workspace');
SELECT tenancy_fk('dashboard_gadgets', ARRAY['workspace_id', 'filter_id'], 'saved_filters', ARRAY['workspace_id', 'id'], 'ON DELETE SET NULL (filter_id)', 'filter_id', 'The gadget''s filter is in another workspace; the gadget now says its filter is gone');
SELECT tenancy_fk('automation_actions', ARRAY['workspace_id', 'rule_id'], 'automation_rules', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Action of a rule in another workspace');
SELECT tenancy_fk('automation_runs', ARRAY['workspace_id', 'rule_id'], 'automation_rules', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Run of a rule in another workspace');
SELECT tenancy_fk('custom_field_options', ARRAY['workspace_id', 'field_id'], 'custom_fields', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Option of a custom field in another workspace');
SELECT tenancy_fk('custom_field_values', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Value on a work item in another workspace');
SELECT tenancy_fk('custom_field_values', ARRAY['workspace_id', 'field_id'], 'custom_fields', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'A custom field value from another workspace (the project moved workspace after it was set)');
SELECT tenancy_fk('custom_field_values', ARRAY['workspace_id', 'option_id'], 'custom_field_options', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'A custom field choice from another workspace');
SELECT tenancy_fk('dev_links', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'GitHub link on a work item in another workspace');
SELECT tenancy_fk('api_token_usage', ARRAY['workspace_id', 'token_id'], 'api_tokens', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Usage of a token in another workspace');
SELECT tenancy_fk('webhooks', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Webhook of a project in another workspace');
SELECT tenancy_fk('webhook_deliveries', ARRAY['workspace_id', 'webhook_id'], 'webhooks', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Delivery of a webhook in another workspace');
SELECT tenancy_fk('service_desk_config', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE SET NULL (system_id)', 'system_id', 'The service desk project is in another workspace');
SELECT tenancy_fk('request_type_fields', ARRAY['workspace_id', 'request_type_id'], 'request_types', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Question of a request type in another workspace');
SELECT tenancy_fk('request_type_field_options', ARRAY['workspace_id', 'field_id'], 'request_type_fields', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Choice of a question in another workspace');
SELECT tenancy_fk('sla_targets', ARRAY['workspace_id', 'request_type_id'], 'request_types', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'SLA target of a request type in another workspace');
SELECT tenancy_fk('sd_requests', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Service desk record of a work item in another workspace');
SELECT tenancy_fk('sd_requests', ARRAY['workspace_id', 'request_type_id'], 'request_types', ARRAY['workspace_id', 'id'], '', NULL, 'A service desk request whose request type is in another workspace');
SELECT tenancy_fk('sd_answers', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Answer on a work item in another workspace');
SELECT tenancy_fk('sd_pauses', ARRAY['workspace_id', 'item_id'], 'work_items', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'SLA pause on a work item in another workspace');
SELECT tenancy_fk('chat_conversations', ARRAY['workspace_id', 'system_id'], 'systems', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Channel of a project in another workspace');
SELECT tenancy_fk('chat_members', ARRAY['workspace_id', 'conversation_id'], 'chat_conversations', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Member of a conversation in another workspace');
SELECT tenancy_fk('chat_messages', ARRAY['workspace_id', 'conversation_id'], 'chat_conversations', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Message in a conversation in another workspace');
SELECT tenancy_fk('chat_files', ARRAY['workspace_id', 'conversation_id'], 'chat_conversations', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'File in a conversation in another workspace');
SELECT tenancy_fk('chat_files', ARRAY['workspace_id', 'message_id'], 'chat_messages', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'File of a message in another workspace');
SELECT tenancy_fk('chat_file_chunks', ARRAY['workspace_id', 'file_id'], 'chat_files', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Part of a chat file that no longer exists');
SELECT tenancy_fk('chat_reactions', ARRAY['workspace_id', 'message_id'], 'chat_messages', ARRAY['workspace_id', 'id'], 'ON DELETE CASCADE', NULL, 'Reaction to a message in another workspace');

-- Shared configuration must be the same organisation's.
SELECT tenancy_fk('work_items', ARRAY['organization_id', 'status'], 'work_statuses', ARRAY['organization_id', 'id'], '', NULL, 'Work item in another organisation''s status');
SELECT tenancy_fk('work_items', ARRAY['organization_id', 'security_level'], 'security_levels', ARRAY['organization_id', 'id'], '', 'security_level', 'Security level of another organisation');
SELECT tenancy_fk('systems', ARRAY['organization_id', 'workflow_id'], 'workflows', ARRAY['organization_id', 'id'], '', 'workflow_id', 'Workflow of another organisation');
SELECT tenancy_fk('workspace_workflows', ARRAY['organization_id', 'workflow_id'], 'workflows', ARRAY['organization_id', 'id'], '', NULL, 'Workflow of another organisation');
SELECT tenancy_fk('board_column_statuses', ARRAY['organization_id', 'status_id'], 'work_statuses', ARRAY['organization_id', 'id'], 'ON DELETE CASCADE', NULL, 'Status of another organisation');
SELECT tenancy_fk('workflow_statuses', ARRAY['organization_id', 'workflow_id'], 'workflows', ARRAY['organization_id', 'id'], 'ON DELETE CASCADE', NULL, 'Workflow of another organisation');
SELECT tenancy_fk('workflow_statuses', ARRAY['organization_id', 'status_id'], 'work_statuses', ARRAY['organization_id', 'id'], '', NULL, 'Status of another organisation');
SELECT tenancy_fk('workflow_transitions', ARRAY['organization_id', 'workflow_id'], 'workflows', ARRAY['organization_id', 'id'], 'ON DELETE CASCADE', NULL, 'Workflow of another organisation');
SELECT tenancy_fk('workflow_transitions', ARRAY['organization_id', 'from_status'], 'work_statuses', ARRAY['organization_id', 'id'], '', NULL, 'Status of another organisation');
SELECT tenancy_fk('workflow_transitions', ARRAY['organization_id', 'to_status'], 'work_statuses', ARRAY['organization_id', 'id'], '', NULL, 'Status of another organisation');
SELECT tenancy_fk('workflow_rules', ARRAY['organization_id', 'transition_id'], 'workflow_transitions', ARRAY['organization_id', 'id'], 'ON DELETE CASCADE', NULL, 'Rule of another organisation''s move');
SELECT tenancy_fk('security_level_grants', ARRAY['organization_id', 'level_id'], 'security_levels', ARRAY['organization_id', 'id'], 'ON DELETE CASCADE', NULL, 'Grant of another organisation''s level');

-- ---------------------------------------------------------------------------------------------
-- 10. Unique per organisation, not globally
-- ---------------------------------------------------------------------------------------------
DROP INDEX systems_key;
CREATE UNIQUE INDEX systems_key ON systems (organization_id, key);
CREATE INDEX systems_key_lookup ON systems (key); -- the item-key lookups, until phase (b) adds the organisation to them

-- ---------------------------------------------------------------------------------------------
-- 11. Until phase (b): keep the old code's workspace changes safe
-- ---------------------------------------------------------------------------------------------
-- A new person joins every workspace of the organisation with their role, as everyone sees every
-- workspace today. (Phase (b) manages memberships itself and drops this.)
CREATE FUNCTION tenancy_new_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at)
  SELECT w.organization_id, w.id, NEW.id, NEW.role, tenancy_now() FROM workspaces w WHERE w.organization_id = NEW.organization_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER tenancy_fill BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION tenancy_fill('org');
CREATE TRIGGER tenancy_new_user AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION tenancy_new_user();

-- Moving a project to another workspace would have to move everything under it. Refused until phase (b).
CREATE FUNCTION tenancy_guard_system() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id = OLD.workspace_id AND tenancy_system_workspace(NEW.data) <> OLD.workspace_id THEN
    RAISE EXCEPTION 'Moving a project to another workspace is paused while Pulse moves to organisations and workspaces.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenancy_guard BEFORE UPDATE OF data ON systems FOR EACH ROW EXECUTE FUNCTION tenancy_guard_system();

-- The old workspace list: new names become workspaces (everyone joins them); renaming or removing one is refused.
CREATE FUNCTION tenancy_guard_workspaces() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  l       tenancy_legacy%ROWTYPE;
  names   TEXT[];
  missing TEXT;
  n       TEXT;
  base    TEXT;
  k       TEXT;
  s       INTEGER;
BEGIN
  IF NEW.key <> 'workspaces' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO l FROM tenancy_legacy;
  SELECT array_agg(lower(trim(x))) INTO names FROM jsonb_array_elements_text(NEW.value::jsonb) x;
  SELECT string_agg(w.name, ', ') INTO missing FROM workspaces w WHERE w.organization_id = l.organization_id AND w.status = 'active' AND NOT (lower(w.name) = ANY (names));
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Renaming or removing workspaces (%) is paused while Pulse moves to organisations and workspaces. Adding one still works.', missing USING ERRCODE = 'check_violation';
  END IF;
  FOR n IN SELECT trim(x) FROM jsonb_array_elements_text(NEW.value::jsonb) x WHERE trim(x) <> '' LOOP
    CONTINUE WHEN tenancy_workspace_named(n) IS NOT NULL;
    base := regexp_replace(left(regexp_replace(upper(n), '[^A-Z0-9]', '', 'g'), 8), '^[0-9]+', '');
    IF length(base) < 2 THEN base := 'WS'; END IF;
    k := base;
    s := 1;
    WHILE EXISTS (SELECT 1 FROM workspaces WHERE organization_id = l.organization_id AND key = k) LOOP
      s := s + 1;
      k := base || s;
    END LOOP;
    INSERT INTO workspaces (id, organization_id, name, key, position, created_at, updated_at)
    VALUES (tenancy_id(), l.organization_id, n, k, (SELECT COALESCE(max(position), -1) + 1 FROM workspaces WHERE organization_id = l.organization_id), tenancy_now(), tenancy_now());
    INSERT INTO workspace_members (organization_id, workspace_id, user_id, role, joined_at)
    SELECT l.organization_id, tenancy_workspace_named(n), u.id, u.role, tenancy_now() FROM users u WHERE u.organization_id = l.organization_id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER tenancy_guard BEFORE INSERT OR UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION tenancy_guard_workspaces();

-- ---------------------------------------------------------------------------------------------
-- 12. Totals for the report
-- ---------------------------------------------------------------------------------------------
SELECT tenancy_note('tenancy_orphans', NULL, NULL, 'summary', count(*) || ' row(s) set aside in tenancy_orphans') FROM tenancy_orphans HAVING count(*) > 0;
