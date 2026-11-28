-- Ask AI, phase (c) (docs/assistant-plan.md): the organisation's own skills. A saved prompt and the tools it may
-- use, shown as a starter in the Ask AI panel where it belongs (src/data/skills.js has the contexts and the built-in
-- ones). Added by the organisation's administrators, per workspace; everyone in the workspace sees them.
-- Reverse: migrations/down/0030_ai_skills.down.sql.
CREATE TABLE ai_skills (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  context         TEXT NOT NULL CHECK (context IN ('project', 'document', 'item', 'request', 'portfolio', 'service_desk')),
  prompt          TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  tools           TEXT NOT NULL DEFAULT '[]' CHECK (left(tools, 1) = '[' AND length(tools) <= 2000),
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ai_skills_workspace ON ai_skills (workspace_id, context);
ALTER TABLE ai_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ai_skills TO pulse_app USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_skills TO pulse_app;
