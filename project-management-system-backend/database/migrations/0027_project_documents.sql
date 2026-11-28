-- Project documents written in PMS (docs/project-documents.md; kits in src/data/documentKits.js): the BRS, the BSS and
-- release notes, from the organisation's own templates.
--   1. project_documents: one row per version of a project's document. At most one draft per project and kind;
--      submitting freezes it as a version (never changed again) and adds it to the project's documents as that
--      lifecycle deliverable, so sign-off and locking work exactly as for an uploaded file.
--   2. The UAT script: test cases gain a scenario and the tester assigned; a run can be "waived".
--   3. A stage record may be larger (the Deployment stage's record is the whole Change Request form).
-- Reverse: migrations/down/0027_project_documents.down.sql.
CREATE TABLE project_documents (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind ~ '^[a-z][a-z_]{1,29}$'),
  version         INTEGER NOT NULL CHECK (version > 0),
  status          TEXT NOT NULL CHECK (status IN ('draft', 'submitted')),
  data            TEXT NOT NULL CHECK (left(data, 1) = '{' AND length(data) <= 400000),
  document_id     TEXT,                      -- the documents row a submitted version became
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  submitted_by    TEXT,
  submitted_at    TEXT,
  UNIQUE (system_id, kind, version)
);
CREATE UNIQUE INDEX project_documents_one_draft ON project_documents (system_id, kind) WHERE status = 'draft';
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON project_documents TO pulse_app USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));
GRANT SELECT, INSERT, UPDATE ON project_documents TO pulse_app;
REVOKE DELETE, TRUNCATE ON project_documents FROM pulse_app;
-- A submitted version is a record: the app can't change it.
CREATE FUNCTION project_documents_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'submitted' AND current_user = 'pulse_app' THEN
    RAISE EXCEPTION 'A submitted version is never changed: edit the draft of the next version.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_documents_frozen BEFORE UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION project_documents_frozen();

-- 2. The UAT script.
ALTER TABLE test_cases ADD COLUMN scenario TEXT NOT NULL DEFAULT '' CHECK (length(scenario) <= 200), ADD COLUMN assignee_id TEXT;
ALTER TABLE test_runs DROP CONSTRAINT test_runs_result_check;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_result_check CHECK (result IN ('pass', 'fail', 'blocked', 'waived'));

-- 3. The Change Request form is the Deployment stage's record.
ALTER TABLE stage_records DROP CONSTRAINT stage_records_data_check;
ALTER TABLE stage_records ADD CONSTRAINT stage_records_data_check CHECK (left(data, 1) = '{' AND length(data) <= 100000);
