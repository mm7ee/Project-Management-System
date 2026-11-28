-- The project page (DECISIONS.md, "Project page"):
--   1. project_summaries: the Overview's plain-English summary, kept per project and per viewer (what a summary says
--      depends on what its reader may see, so one written for an Administrator is never shown to anyone else).
--      Regenerated on request, or when the project's figures change.
--   2. stage_comments: comments on a lifecycle stage, in the stage drawer. A record: the app adds them, never changes
--      them; deleting the project deletes them.
-- Reverse: migrations/down/0028_project_page.down.sql.
CREATE TABLE project_summaries (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  viewer_key      TEXT NOT NULL CHECK (length(viewer_key) BETWEEN 1 AND 100),
  text            TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1500),
  source          TEXT NOT NULL CHECK (source IN ('ai', 'plain')),
  facts_hash      TEXT NOT NULL CHECK (length(facts_hash) <= 64),
  generated_at    TEXT NOT NULL,
  PRIMARY KEY (system_id, viewer_key)
);
CREATE TABLE stage_comments (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  system_id       TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  stage_code      TEXT NOT NULL CHECK (length(stage_code) BETWEEN 1 AND 40),
  author_id       TEXT NOT NULL,
  author_name     TEXT NOT NULL,
  body            TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at      TEXT NOT NULL
);
CREATE INDEX stage_comments_stage ON stage_comments (system_id, stage_code, created_at);
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_summaries', 'stage_comments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (workspace_id = current_setting(''app.workspace_id'', true))
      WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true) AND organization_id = current_setting(''app.org_id'', true))', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_summaries TO pulse_app;
GRANT SELECT, INSERT ON stage_comments TO pulse_app;
REVOKE UPDATE, DELETE, TRUNCATE ON stage_comments FROM pulse_app;
