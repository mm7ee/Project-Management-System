-- Project lifecycles (docs/lifecycle-plan.md): stage templates per organisation, and each project's place in one.
--   1. lifecycle_templates: one row per version of a template (draft, published, archived); its definition (phases,
--      stages, gates, sign-offs, automation) is JSON validated by src/data/lifecycle.js cleanTemplate. A workspace may
--      have its own; otherwise the organisation's default applies. lifecycle_stages repeats the stages as rows, so
--      reports can join on them.
--   2. Per project: project_lifecycle (where it is), project_stage_history (every change; the app's role can't change
--      or delete it), stage_checklist_items, stage_signoffs, stage_requests (skips, deferrals, risk acceptance).
--   3. Registers the gates read: risk_register, security_findings, test_cases and test_runs, project_environments,
--      stage_records (deployment plan, closure report …).
--   4. documents gain a stage, a deliverable key, a version and a lock; work_items remember the stage that made them.
--   5. Automation: the trigger "stage changed".
-- Reverse: migrations/down/0025_project_lifecycle.down.sql.

-- 1. Templates.
CREATE TABLE lifecycle_templates (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '') REFERENCES organizations (id) ON DELETE CASCADE,
  workspace_id    TEXT,                      -- NULL: the organisation's; else only that workspace's projects
  family_id       TEXT NOT NULL,             -- the versions of one template share it
  version         INTEGER NOT NULL CHECK (version > 0),
  status          TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  definition      TEXT NOT NULL CHECK (left(definition, 1) = '{' AND length(definition) <= 200000),
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  published_at    TEXT,
  published_by    TEXT,
  UNIQUE (family_id, version),
  CONSTRAINT lifecycle_templates_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX lifecycle_templates_one_draft ON lifecycle_templates (family_id) WHERE status = 'draft';
CREATE UNIQUE INDEX lifecycle_templates_one_published ON lifecycle_templates (family_id) WHERE status = 'published';
CREATE INDEX lifecycle_templates_org ON lifecycle_templates (organization_id, workspace_id, status);

CREATE TABLE lifecycle_stages (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  template_id     TEXT NOT NULL REFERENCES lifecycle_templates (id) ON DELETE CASCADE,
  code            TEXT NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,29}$'),
  name            TEXT NOT NULL,
  phase_code      TEXT NOT NULL,
  phase_name      TEXT NOT NULL,
  position        INTEGER NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('work', 'draft', 'approval', 'assessment', 'testing', 'deployment', 'closure')),
  target_days     INTEGER,
  weight          NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, code)
);

-- 2. Per project. Workspace rows, like approvals (0020): a project never changes workspace.
CREATE TABLE project_lifecycle (
  organization_id  TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id     TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  system_id        TEXT PRIMARY KEY REFERENCES systems (id) ON DELETE CASCADE,
  template_id      TEXT NOT NULL REFERENCES lifecycle_templates (id),
  stage_code       TEXT NOT NULL,
  stage_entered_at TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'closed')),
  sla_warned_at    TEXT,
  sla_breached_at  TEXT,
  migrated         INTEGER NOT NULL DEFAULT 0 CHECK (migrated IN (0, 1)),
  CONSTRAINT project_lifecycle_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX project_lifecycle_stage ON project_lifecycle (workspace_id, stage_code);

CREATE TABLE project_stage_history (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              BIGSERIAL PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  from_code       TEXT,
  to_code         TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('start', 'advance', 'send_back', 'skip', 'decline', 'migrate', 'close', 'reopen', 'template')),
  reason          TEXT,
  evidence        TEXT NOT NULL DEFAULT '{}',   -- JSON: what the gate saw when it was passed
  by_id           TEXT,
  by_name         TEXT NOT NULL,
  at              TEXT NOT NULL
);
CREATE INDEX project_stage_history_system ON project_stage_history (system_id, id);

CREATE TABLE stage_checklist_items (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  stage_code      TEXT NOT NULL,
  key             TEXT NOT NULL,
  done_by         TEXT NOT NULL,
  done_at         TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  PRIMARY KEY (system_id, stage_code, key)
);

CREATE TABLE stage_signoffs (
  organization_id  TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id     TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id               TEXT PRIMARY KEY,
  system_id        TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  stage_code       TEXT NOT NULL,
  round            INTEGER NOT NULL CHECK (round > 0),
  signer_id        TEXT NOT NULL,
  signer_name      TEXT NOT NULL,
  label            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  comment          TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 1000),
  submitted_by     TEXT,
  document_id      TEXT,
  document_version INTEGER,
  requested_at     TEXT NOT NULL,
  reminded_at      TEXT,
  decided_at       TEXT
);
CREATE INDEX stage_signoffs_open ON stage_signoffs (system_id, stage_code, round);
CREATE INDEX stage_signoffs_signer ON stage_signoffs (signer_id, status);

CREATE TABLE stage_requests (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  stage_code      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('skip', 'defer_items')),
  target_code     TEXT,                      -- a skip's destination
  reason          TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by    TEXT NOT NULL,
  requested_at    TEXT NOT NULL,
  decided_by      TEXT,
  decided_at      TEXT,
  decision_note   TEXT
);
CREATE UNIQUE INDEX stage_requests_one_open ON stage_requests (system_id, kind) WHERE status = 'pending';

-- 3. Registers.
CREATE TABLE risk_register (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  risk            TEXT NOT NULL CHECK (length(trim(risk)) BETWEEN 1 AND 500),
  likelihood      INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact          INTEGER NOT NULL CHECK (impact BETWEEN 1 AND 5),
  owner_id        TEXT,
  mitigation      TEXT NOT NULL DEFAULT '' CHECK (length(mitigation) <= 1000),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX risk_register_system ON risk_register (system_id);

CREATE TABLE security_findings (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  severity        TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low', 'Info')),
  detail          TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'accepted')),
  accepted_by     TEXT,
  accepted_reason TEXT,
  accepted_until  TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (status <> 'accepted' OR (accepted_by IS NOT NULL AND length(trim(accepted_reason)) >= 3 AND accepted_until IS NOT NULL))
);
CREATE INDEX security_findings_system ON security_findings (system_id);

CREATE TABLE test_cases (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  suite           TEXT NOT NULL CHECK (suite ~ '^[A-Z]{2,12}$'),
  title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  steps           TEXT NOT NULL DEFAULT '' CHECK (length(steps) <= 4000),
  expected        TEXT NOT NULL DEFAULT '' CHECK (length(expected) <= 2000),
  position        INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX test_cases_system ON test_cases (system_id, suite);

CREATE TABLE test_runs (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  case_id         TEXT NOT NULL REFERENCES test_cases (id) ON DELETE CASCADE,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  result          TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'blocked')),
  notes           TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  bug_item_id     TEXT,
  run_by          TEXT NOT NULL,
  run_at          TEXT NOT NULL
);
CREATE INDEX test_runs_case ON test_runs (case_id, run_at);

CREATE TABLE project_environments (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  server          TEXT NOT NULL DEFAULT '' CHECK (length(server) <= 300),
  resources       TEXT NOT NULL DEFAULT '' CHECK (length(resources) <= 1000),
  access          TEXT NOT NULL DEFAULT '' CHECK (length(access) <= 1000),
  verified_by     TEXT,
  verified_at     TEXT,
  updated_at      TEXT NOT NULL,
  UNIQUE (system_id, name)
);

CREATE TABLE stage_records (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind ~ '^[a-z_]{2,30}$'),
  data            TEXT NOT NULL CHECK (left(data, 1) = '{' AND length(data) <= 20000),
  updated_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (system_id, kind)
);

-- 4. Documents and work items.
ALTER TABLE documents
  ADD COLUMN stage_code      TEXT,
  ADD COLUMN deliverable_key TEXT CHECK (deliverable_key IS NULL OR deliverable_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  ADD COLUMN version         INTEGER CHECK (version IS NULL OR version > 0),
  ADD COLUMN locked_at       TEXT,
  ADD COLUMN locked_by       TEXT;
CREATE INDEX documents_deliverable ON documents (system_id, deliverable_key, version) WHERE deliverable_key IS NOT NULL;
-- A locked (signed) document is never changed or removed, by anyone but the owner.
CREATE FUNCTION documents_locked_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND current_user = 'pulse_app' THEN
    RAISE EXCEPTION 'This document was signed off and is locked: upload a new version instead.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER documents_locked_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION documents_locked_guard();
ALTER TABLE work_items ADD COLUMN lifecycle_stage TEXT;

-- Row-level security. Templates: like workflows (0018), a workspace reads the organisation's and its own; only the
-- organisation's handle (its administrators) changes them. Everything else: the workspace's own rows.
ALTER TABLE lifecycle_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON lifecycle_templates FOR SELECT TO pulse_app USING (
  organization_id = current_setting('app.org_id', true)
  AND (workspace_id IS NULL OR COALESCE(current_setting('app.workspace_id', true), '') = '' OR workspace_id = current_setting('app.workspace_id', true)));
CREATE POLICY tenant_write ON lifecycle_templates FOR ALL TO pulse_app
  USING (organization_id = current_setting('app.org_id', true) AND COALESCE(current_setting('app.workspace_id', true), '') = '')
  WITH CHECK (organization_id = current_setting('app.org_id', true) AND COALESCE(current_setting('app.workspace_id', true), '') = '');
ALTER TABLE lifecycle_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON lifecycle_stages FOR SELECT TO pulse_app USING (organization_id = current_setting('app.org_id', true));
CREATE POLICY tenant_write ON lifecycle_stages FOR ALL TO pulse_app
  USING (organization_id = current_setting('app.org_id', true) AND COALESCE(current_setting('app.workspace_id', true), '') = '')
  WITH CHECK (organization_id = current_setting('app.org_id', true) AND COALESCE(current_setting('app.workspace_id', true), '') = '');
REVOKE DELETE, TRUNCATE ON lifecycle_templates, lifecycle_stages FROM pulse_app;
GRANT SELECT, INSERT, UPDATE ON lifecycle_templates TO pulse_app;
GRANT SELECT, INSERT ON lifecycle_stages TO pulse_app;
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_lifecycle', 'project_stage_history', 'stage_checklist_items', 'stage_signoffs', 'stage_requests',
                           'risk_register', 'security_findings', 'test_cases', 'test_runs', 'project_environments', 'stage_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (workspace_id = current_setting(''app.workspace_id'', true))
      WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true) AND organization_id = current_setting(''app.org_id'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pulse_app', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE project_stage_history_id_seq TO pulse_app;
-- History is never rewritten; a decision on a sign-off or a request is made once (the app updates the row once,
-- from pending, and the guard below refuses anything else).
REVOKE UPDATE, DELETE ON project_stage_history FROM pulse_app;
REVOKE DELETE ON stage_signoffs, stage_requests FROM pulse_app;
CREATE FUNCTION lifecycle_decided_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' AND current_user = 'pulse_app' THEN
    RAISE EXCEPTION 'That decision has already been made.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_decided_guard BEFORE UPDATE ON stage_signoffs FOR EACH ROW EXECUTE FUNCTION lifecycle_decided_guard();
CREATE TRIGGER lifecycle_decided_guard BEFORE UPDATE ON stage_requests FOR EACH ROW EXECUTE FUNCTION lifecycle_decided_guard();

-- 5. Automation: "stage changed" (its detail carries the stages, so conditions can match "stage is …").
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_check CHECK (trigger IN (
  'item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule',
  'item_assigned', 'due_soon', 'due_passed', 'webhook', 'manual', 'sla_warning', 'sla_breached', 'approval_granted', 'approval_rejected',
  'stage_changed'));
