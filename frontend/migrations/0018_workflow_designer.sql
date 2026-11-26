-- Administrator module, phase 2: a workflow per workspace (and per item type), drafts and versions, workspace
-- templates, and more custom field kinds.
--   1. Workflows belong to a workspace (workflows.workspace_id). The organisation's own workflows (workspace_id NULL)
--      become its templates. Every workspace gets its own copy of each workflow it uses today, and its projects and
--      its workspace setting point at the copies, so nothing a workspace does to its workflow reaches another.
--      Row-level security: a workspace sees its own workflows and the templates and changes only its own; the
--      organisation's handle (its administrators) changes the templates.
--   2. Work item types per workspace (item_types). Each is one of the five built-in kinds (Epic, Story, Task, Bug,
--      Sub-task), which decides where it sits in the hierarchy and on boards; its name and its workflow are the
--      workspace's own. Every workspace starts with the five built-in types. work_items.item_type says which type
--      an item is; work_items.type stays its kind, kept in step by a trigger.
--   3. workflow_drafts and workflow_versions: a workflow is edited as a draft, then published; each publish keeps
--      the version, to look back at or restore.
--   4. Organisation templates for new workspaces (workspace_templates). The built-in ones live in the code.
--   5. Custom fields: long text, currency, checkbox and link kinds; a default value; and which item types show them.
-- Reverse: migrations/down/0018_workflow_designer.down.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. Workflows per workspace
-- ---------------------------------------------------------------------------------------------
ALTER TABLE workflows ADD COLUMN workspace_id TEXT;
ALTER TABLE workflows ADD CONSTRAINT workflows_workspace FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE;
-- Only a template is the organisation's default (what a new workspace starts with).
ALTER TABLE workflows ADD CONSTRAINT workflows_default_is_template CHECK (is_default = 0 OR workspace_id IS NULL);
DROP INDEX workflows_name;
CREATE UNIQUE INDEX workflows_name ON workflows (organization_id, COALESCE(workspace_id, ''), lower(name));
CREATE INDEX workflows_ws ON workflows (workspace_id);

-- A copy of a workflow (statuses, moves and their rules) for a workspace of the same organisation. Returns its id.
CREATE FUNCTION tenancy_copy_workflow(src_org TEXT, src TEXT, target_ws TEXT, new_name TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  org TEXT := (SELECT organization_id FROM workspaces WHERE id = target_ws);
  nid TEXT := substr(md5(random()::text || clock_timestamp()::text || src), 1, 16);
  t   RECORD;
  tid TEXT;
BEGIN
  IF org IS DISTINCT FROM src_org THEN
    RAISE EXCEPTION 'A workflow is copied within its own organisation';
  END IF;
  INSERT INTO workflows (organization_id, id, workspace_id, name, description, is_default, created_at, updated_at)
    SELECT org, nid, target_ws, COALESCE(new_name, name), description, 0, tenancy_now(), tenancy_now() FROM workflows WHERE organization_id = src_org AND id = src;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No workflow % to copy', src;
  END IF;
  INSERT INTO workflow_statuses (organization_id, workflow_id, status_id, position, is_initial)
    SELECT org, nid, status_id, position, is_initial FROM workflow_statuses WHERE organization_id = src_org AND workflow_id = src;
  FOR t IN SELECT * FROM workflow_transitions WHERE organization_id = src_org AND workflow_id = src ORDER BY position LOOP
    tid := substr(md5(random()::text || clock_timestamp()::text || t.id), 1, 16);
    INSERT INTO workflow_transitions (organization_id, id, workflow_id, name, from_status, to_status, position)
      VALUES (org, tid, nid, t.name, t.from_status, t.to_status, t.position);
    INSERT INTO workflow_rules (organization_id, transition_id, kind, rule, value)
      SELECT org, tid, kind, rule, value FROM workflow_rules WHERE organization_id = src_org AND transition_id = t.id ORDER BY id;
  END LOOP;
  RETURN nid;
END $$;
REVOKE EXECUTE ON FUNCTION tenancy_copy_workflow(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

-- Each workspace takes its own copy of every workflow it uses: its workspace setting (or the default) and any its
-- projects chose. The template organisation keeps templates only.
DO $$
DECLARE
  w    RECORD;
  u    RECORD;
  c    TEXT;
  wsw  TEXT;
BEGIN
  FOR w IN SELECT x.id, x.organization_id, x.name FROM workspaces x WHERE x.organization_id <> 'pulse-template' ORDER BY x.organization_id, x.position LOOP
    wsw := COALESCE((SELECT ww.workflow_id FROM workspace_workflows ww WHERE ww.workspace_id = w.id),
                    (SELECT d.id FROM workflows d WHERE d.organization_id = w.organization_id AND d.is_default = 1));
    FOR u IN
      SELECT DISTINCT q.wf FROM (
        SELECT wsw AS wf
        UNION SELECT s.workflow_id FROM systems s WHERE s.workspace_id = w.id AND s.workflow_id IS NOT NULL
      ) q WHERE q.wf IS NOT NULL
    LOOP
      c := tenancy_copy_workflow(w.organization_id, u.wf, w.id);
      UPDATE systems SET workflow_id = c WHERE workspace_id = w.id AND workflow_id = u.wf;
      IF u.wf = wsw THEN
        INSERT INTO workspace_workflows (organization_id, workspace_id, workspace, workflow_id) VALUES (w.organization_id, w.id, w.name, c)
          ON CONFLICT (workspace_id) DO UPDATE SET workflow_id = excluded.workflow_id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- A workspace, its projects and its item types may use their own workspace's workflows or the organisation's
-- templates, never another workspace's. Checked as the owner, so the check itself reveals nothing.
CREATE FUNCTION tenancy_workflow_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_ws TEXT;
BEGIN
  IF NEW.workflow_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT workspace_id INTO owner_ws FROM workflows WHERE organization_id = NEW.organization_id AND id = NEW.workflow_id;
  IF owner_ws IS NOT NULL AND owner_ws IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'A workspace can only use its own workflows' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION tenancy_workflow_owner() FROM PUBLIC;
CREATE TRIGGER tenancy_workflow_owner BEFORE INSERT OR UPDATE OF workflow_id ON systems FOR EACH ROW EXECUTE FUNCTION tenancy_workflow_owner();
CREATE TRIGGER tenancy_workflow_owner BEFORE INSERT OR UPDATE OF workflow_id ON workspace_workflows FOR EACH ROW EXECUTE FUNCTION tenancy_workflow_owner();

-- Row-level security: a workspace reads its own workflows and the organisation's templates, and changes only its
-- own. The organisation's handle (no workspace) reads and changes them all. Statuses, moves and rules follow their
-- workflow.
DROP POLICY tenant ON workflows;
CREATE POLICY tenant_read ON workflows FOR SELECT TO pulse_app USING (
  organization_id = current_setting('app.org_id', true)
  AND (workspace_id IS NULL OR COALESCE(current_setting('app.workspace_id', true), '') = '' OR workspace_id = current_setting('app.workspace_id', true)));
CREATE POLICY tenant_write ON workflows FOR ALL TO pulse_app
  USING (organization_id = current_setting('app.org_id', true)
         AND (COALESCE(current_setting('app.workspace_id', true), '') = '' OR workspace_id = current_setting('app.workspace_id', true)))
  WITH CHECK (organization_id = current_setting('app.org_id', true)
         AND (COALESCE(current_setting('app.workspace_id', true), '') = '' OR workspace_id = current_setting('app.workspace_id', true)));
DO $$
DECLARE
  t    TEXT;
  mine TEXT := '(COALESCE(current_setting(''app.workspace_id'', true), '''') = '''' OR w.workspace_id = current_setting(''app.workspace_id'', true))';
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_statuses', 'workflow_transitions'] LOOP
    EXECUTE format('DROP POLICY tenant ON %I', t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO pulse_app USING (organization_id = current_setting(''app.org_id'', true)
      AND EXISTS (SELECT 1 FROM workflows w WHERE w.organization_id = %I.organization_id AND w.id = %I.workflow_id))', t, t, t);
    EXECUTE format('CREATE POLICY tenant_write ON %I FOR ALL TO pulse_app
      USING (organization_id = current_setting(''app.org_id'', true)
        AND EXISTS (SELECT 1 FROM workflows w WHERE w.organization_id = %I.organization_id AND w.id = %I.workflow_id AND %s))
      WITH CHECK (organization_id = current_setting(''app.org_id'', true)
        AND EXISTS (SELECT 1 FROM workflows w WHERE w.organization_id = %I.organization_id AND w.id = %I.workflow_id AND %s))', t, t, t, mine, t, t, mine);
  END LOOP;
  DROP POLICY tenant ON workflow_rules;
  CREATE POLICY tenant_read ON workflow_rules FOR SELECT TO pulse_app USING (organization_id = current_setting('app.org_id', true)
    AND EXISTS (SELECT 1 FROM workflow_transitions tr WHERE tr.organization_id = workflow_rules.organization_id AND tr.id = workflow_rules.transition_id));
  EXECUTE format('CREATE POLICY tenant_write ON workflow_rules FOR ALL TO pulse_app
    USING (organization_id = current_setting(''app.org_id'', true) AND EXISTS (SELECT 1 FROM workflow_transitions tr JOIN workflows w ON w.organization_id = tr.organization_id AND w.id = tr.workflow_id
      WHERE tr.organization_id = workflow_rules.organization_id AND tr.id = workflow_rules.transition_id AND %s))
    WITH CHECK (organization_id = current_setting(''app.org_id'', true) AND EXISTS (SELECT 1 FROM workflow_transitions tr JOIN workflows w ON w.organization_id = tr.organization_id AND w.id = tr.workflow_id
      WHERE tr.organization_id = workflow_rules.organization_id AND tr.id = workflow_rules.transition_id AND %s))', mine, mine);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Work item types
-- ---------------------------------------------------------------------------------------------
CREATE TABLE item_types (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT NOT NULL CHECK (id ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  base            TEXT NOT NULL CHECK (base IN ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK')),
  description     TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  position        INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),   -- 0: not offered for new items
  workflow_id     TEXT,                                                  -- NULL: the project's (or workspace's)
  created_at      TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  -- A built-in kind's code names only its own built-in type.
  CHECK (id NOT IN ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK') OR id = base),
  CONSTRAINT item_types_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT item_types_workflow FOREIGN KEY (organization_id, workflow_id) REFERENCES workflows (organization_id, id)
);
CREATE UNIQUE INDEX item_types_name ON item_types (workspace_id, lower(name));
CREATE INDEX item_types_workflow ON item_types (organization_id, workflow_id);
CREATE TRIGGER tenancy_workflow_owner BEFORE INSERT OR UPDATE OF workflow_id ON item_types FOR EACH ROW EXECUTE FUNCTION tenancy_workflow_owner();
ALTER TABLE item_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_types TO pulse_app
  USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));

-- The five built-in types, and the workspace's own copy of its organisation's default workflow: what every new
-- workspace starts with, however it is made.
CREATE FUNCTION tenancy_workspace_defaults() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  def TEXT;
  c   TEXT;
BEGIN
  INSERT INTO item_types (organization_id, workspace_id, id, name, base, position, created_at)
    SELECT NEW.organization_id, NEW.id, v.id, v.name, v.id, v.pos, tenancy_now()
    FROM (VALUES ('EPIC', 'Epic', 0), ('STORY', 'Story', 1), ('TASK', 'Task', 2), ('BUG', 'Bug', 3), ('SUBTASK', 'Sub-task', 4)) AS v (id, name, pos)
    ON CONFLICT DO NOTHING;
  IF NEW.organization_id <> 'pulse-template' THEN
    SELECT id INTO def FROM workflows WHERE organization_id = NEW.organization_id AND is_default = 1;
    IF def IS NOT NULL THEN
      c := tenancy_copy_workflow(NEW.organization_id, def, NEW.id);
      INSERT INTO workspace_workflows (organization_id, workspace_id, workspace, workflow_id) VALUES (NEW.organization_id, NEW.id, NEW.name, c)
        ON CONFLICT (workspace_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION tenancy_workspace_defaults() FROM PUBLIC;
CREATE TRIGGER tenancy_workspace_defaults AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION tenancy_workspace_defaults();
INSERT INTO item_types (organization_id, workspace_id, id, name, base, position, created_at)
  SELECT w.organization_id, w.id, v.id, v.name, v.id, v.pos, tenancy_now()
  FROM workspaces w CROSS JOIN (VALUES ('EPIC', 'Epic', 0), ('STORY', 'Story', 1), ('TASK', 'Task', 2), ('BUG', 'Bug', 3), ('SUBTASK', 'Sub-task', 4)) AS v (id, name, pos);

-- Which type each item is. Its kind (work_items.type) follows its type; changing only the kind picks that kind's
-- built-in type.
ALTER TABLE work_items ADD COLUMN item_type TEXT;
UPDATE work_items SET item_type = type;
ALTER TABLE work_items ALTER COLUMN item_type SET NOT NULL;
ALTER TABLE work_items ADD CONSTRAINT work_items_item_type FOREIGN KEY (workspace_id, item_type) REFERENCES item_types (workspace_id, id);
CREATE INDEX work_items_item_type ON work_items (workspace_id, item_type);
CREATE FUNCTION work_items_item_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.type IS DISTINCT FROM OLD.type AND NEW.item_type IS NOT DISTINCT FROM OLD.item_type THEN
    NEW.item_type := NEW.type;
  END IF;
  IF NEW.item_type IS NULL THEN
    NEW.item_type := NEW.type;
  END IF;
  SELECT base INTO b FROM item_types WHERE workspace_id = NEW.workspace_id AND id = NEW.item_type;
  IF b IS NOT NULL AND b IS DISTINCT FROM NEW.type THEN
    NEW.type := b;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_items_item_type BEFORE INSERT OR UPDATE OF type, item_type ON work_items FOR EACH ROW EXECUTE FUNCTION work_items_item_type();

-- ---------------------------------------------------------------------------------------------
-- 3. Drafts and versions
-- ---------------------------------------------------------------------------------------------
CREATE TABLE workflow_drafts (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workflow_id     TEXT NOT NULL,
  data            TEXT NOT NULL,           -- JSON: { name, description, statuses, transitions }
  base_version    INTEGER NOT NULL,        -- the version the draft started from
  updated_by      TEXT,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, workflow_id),
  CONSTRAINT workflow_drafts_workflow FOREIGN KEY (organization_id, workflow_id) REFERENCES workflows (organization_id, id) ON DELETE CASCADE
);
CREATE TABLE workflow_versions (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workflow_id     TEXT NOT NULL,
  version         INTEGER NOT NULL CHECK (version > 0),
  data            TEXT NOT NULL,           -- JSON, as published
  note            TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  published_by    TEXT,
  published_name  TEXT NOT NULL DEFAULT '',
  published_at    TEXT NOT NULL,
  PRIMARY KEY (organization_id, workflow_id, version),
  CONSTRAINT workflow_versions_workflow FOREIGN KEY (organization_id, workflow_id) REFERENCES workflows (organization_id, id) ON DELETE CASCADE
);
DO $$
DECLARE
  t    TEXT;
  mine TEXT := '(COALESCE(current_setting(''app.workspace_id'', true), '''') = '''' OR w.workspace_id = current_setting(''app.workspace_id'', true))';
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_drafts', 'workflow_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO pulse_app USING (organization_id = current_setting(''app.org_id'', true)
      AND EXISTS (SELECT 1 FROM workflows w WHERE w.organization_id = %I.organization_id AND w.id = %I.workflow_id))', t, t, t);
    EXECUTE format('CREATE POLICY tenant_write ON %I FOR ALL TO pulse_app
      USING (organization_id = current_setting(''app.org_id'', true)
        AND EXISTS (SELECT 1 FROM workflows w WHERE w.organization_id = %I.organization_id AND w.id = %I.workflow_id AND %s))
      WITH CHECK (organization_id = current_setting(''app.org_id'', true)
        AND EXISTS (SELECT 1 FROM workflows w WHERE w.organization_id = %I.organization_id AND w.id = %I.workflow_id AND %s))', t, t, t, mine, t, t, mine);
  END LOOP;
END $$;
-- Published versions are history: kept, never edited.
REVOKE UPDATE ON workflow_versions FROM pulse_app;

-- ---------------------------------------------------------------------------------------------
-- 4. Organisation templates for new workspaces
-- ---------------------------------------------------------------------------------------------
CREATE TABLE workspace_templates (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '') REFERENCES organizations (id),
  id              TEXT NOT NULL,
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  description     TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  data            TEXT NOT NULL,           -- JSON: statuses, workflows, item types, fields (src/data/templates.js)
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX workspace_templates_name ON workspace_templates (organization_id, lower(name));
ALTER TABLE workspace_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspace_templates TO pulse_app
  USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));

-- ---------------------------------------------------------------------------------------------
-- 5. Custom fields
-- ---------------------------------------------------------------------------------------------
ALTER TABLE custom_fields DROP CONSTRAINT custom_fields_kind_check;
ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_kind_check
  CHECK (kind IN ('text', 'textarea', 'number', 'currency', 'date', 'select', 'multiselect', 'user', 'checkbox', 'url'));
ALTER TABLE custom_fields
  ADD COLUMN default_value TEXT CHECK (default_value IS NULL OR length(default_value) <= 500),
  ADD COLUMN item_types    TEXT,             -- JSON list of item type ids; NULL: every type
  ADD COLUMN currency      TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------------------------
-- 6. Seeding a new organisation copies only the template's templates (never a workspace's workflows).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenancy_seed_organization(target TEXT, source TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO work_statuses (organization_id, id, name, category, position, created_at)
    SELECT target, id, name, category, position, tenancy_now() FROM work_statuses WHERE organization_id = source;
  INSERT INTO workflows (organization_id, id, name, description, is_default, created_at, updated_at)
    SELECT target, id, name, description, is_default, tenancy_now(), tenancy_now() FROM workflows WHERE organization_id = source AND workspace_id IS NULL;
  INSERT INTO workflow_statuses (organization_id, workflow_id, status_id, position, is_initial)
    SELECT target, s.workflow_id, s.status_id, s.position, s.is_initial FROM workflow_statuses s
    JOIN workflows w ON w.organization_id = s.organization_id AND w.id = s.workflow_id AND w.workspace_id IS NULL WHERE s.organization_id = source;
  INSERT INTO workflow_transitions (organization_id, id, workflow_id, name, from_status, to_status, position)
    SELECT target, t.id, t.workflow_id, t.name, t.from_status, t.to_status, t.position FROM workflow_transitions t
    JOIN workflows w ON w.organization_id = t.organization_id AND w.id = t.workflow_id AND w.workspace_id IS NULL WHERE t.organization_id = source;
  INSERT INTO workflow_rules (organization_id, transition_id, kind, rule, value)
    SELECT target, r.transition_id, r.kind, r.rule, r.value FROM workflow_rules r
    JOIN workflow_transitions t ON t.organization_id = r.organization_id AND t.id = r.transition_id
    JOIN workflows w ON w.organization_id = t.organization_id AND w.id = t.workflow_id AND w.workspace_id IS NULL WHERE r.organization_id = source;
  INSERT INTO security_levels (organization_id, id, name, description, position, created_at, updated_at)
    SELECT target, id, name, description, position, tenancy_now(), tenancy_now() FROM security_levels WHERE organization_id = source;
  INSERT INTO security_level_grants (organization_id, level_id, role, user_id)
    SELECT target, level_id, role, NULL FROM security_level_grants WHERE organization_id = source AND role IS NOT NULL;
  INSERT INTO notification_schemes (organization_id, event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, updated_at)
    SELECT target, event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, tenancy_now() FROM notification_schemes WHERE organization_id = source;
  INSERT INTO public_holidays (organization_id, day, name)
    SELECT target, day, name FROM public_holidays WHERE organization_id = source;
END $$;
