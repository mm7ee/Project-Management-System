-- Reverses migrations/0018_workflow_designer.sql. Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0018_workflow_designer.down.sql
-- Refused while a workspace has item types of its own or a custom field of a kind 0018 added (change or delete them
-- first). Workflow drafts, versions and organisation templates are lost. Each workspace keeps the workflows it has,
-- as organisation-wide ones again (renamed "<name> (<workspace>)" where names would clash).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM item_types WHERE id NOT IN ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK')) THEN
    RAISE EXCEPTION 'Some workspaces have item types of their own: delete them (or change their items'' type) before reversing 0018';
  END IF;
  IF EXISTS (SELECT 1 FROM custom_fields WHERE kind IN ('textarea', 'currency', 'checkbox', 'url')) THEN
    RAISE EXCEPTION 'Some custom fields are long text, money, checkbox or link fields: delete them before reversing 0018';
  END IF;
END $$;

-- 6. Seeding a new organisation, as 0014 had it.
CREATE OR REPLACE FUNCTION tenancy_seed_organization(target TEXT, source TEXT) RETURNS void LANGUAGE plpgsql AS $$
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

-- 5. Custom fields.
ALTER TABLE custom_fields DROP COLUMN default_value, DROP COLUMN item_types, DROP COLUMN currency;
ALTER TABLE custom_fields DROP CONSTRAINT custom_fields_kind_check;
ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_kind_check CHECK (kind IN ('text', 'number', 'date', 'select', 'multiselect', 'user'));

-- 4, 3. Templates, drafts and versions.
DROP TABLE workspace_templates;
DROP TABLE workflow_drafts;
DROP TABLE workflow_versions;

-- 2. Item types.
DROP TRIGGER work_items_item_type ON work_items;
DROP FUNCTION work_items_item_type();
ALTER TABLE work_items DROP CONSTRAINT work_items_item_type;
DROP INDEX work_items_item_type;
ALTER TABLE work_items DROP COLUMN item_type;
DROP TRIGGER tenancy_workspace_defaults ON workspaces;
DROP FUNCTION tenancy_workspace_defaults();
DROP TABLE item_types;

-- 1. Workflows back to organisation-wide, with names unique in the organisation again.
DROP TRIGGER tenancy_workflow_owner ON systems;
DROP TRIGGER tenancy_workflow_owner ON workspace_workflows;
DROP FUNCTION tenancy_workflow_owner();
DROP POLICY tenant_read ON workflow_rules;
DROP POLICY tenant_write ON workflow_rules;
CREATE POLICY tenant ON workflow_rules TO pulse_app USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflows', 'workflow_statuses', 'workflow_transitions'] LOOP
    EXECUTE format('DROP POLICY tenant_read ON %I', t);
    EXECUTE format('DROP POLICY tenant_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))', t);
  END LOOP;
END $$;
UPDATE workflows f SET name = left(f.name || ' (' || w.name || ')', 60)
FROM workspaces w
WHERE w.organization_id = f.organization_id AND w.id = f.workspace_id
  AND EXISTS (SELECT 1 FROM workflows o WHERE o.organization_id = f.organization_id AND o.id <> f.id AND lower(o.name) = lower(f.name));
DROP INDEX workflows_name;
DROP INDEX workflows_ws;
ALTER TABLE workflows DROP CONSTRAINT workflows_default_is_template;
ALTER TABLE workflows DROP CONSTRAINT workflows_workspace;
ALTER TABLE workflows DROP COLUMN workspace_id;
CREATE UNIQUE INDEX workflows_name ON workflows (organization_id, name);
DROP FUNCTION tenancy_copy_workflow(TEXT, TEXT, TEXT, TEXT);
DELETE FROM schema_migrations WHERE name = '0018_workflow_designer.sql';
