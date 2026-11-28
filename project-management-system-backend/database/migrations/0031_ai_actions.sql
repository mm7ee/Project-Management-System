-- Ask AI, phase (d) (docs/assistant-plan.md): changes the assistant proposes, waiting for the person to confirm.
-- A write tool only stores a proposal here: what it would do (the preview the card shows) and the API requests it
-- would send. Confirming runs those requests once, with the person's own session, through the same handlers and
-- checks as the rest of PMS; a proposal is the proposer's alone and expires after 30 minutes.
-- Reverse: migrations/down/0031_ai_actions.down.sql.
CREATE TABLE ai_actions (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  tool            TEXT NOT NULL CHECK (tool ~ '^[a-z_]{3,40}$'),
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  preview         TEXT NOT NULL CHECK (left(preview, 1) = '{' AND length(preview) <= 200000),
  requests        TEXT NOT NULL CHECK (left(requests, 1) = '[' AND length(requests) <= 400000),
  status          TEXT NOT NULL CHECK (status IN ('proposed', 'running', 'done', 'partly_done', 'failed', 'cancelled')),
  result          TEXT CHECK (result IS NULL OR left(result, 1) = '['),
  project_id      TEXT,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  decided_at      TEXT
);
CREATE INDEX ai_actions_user ON ai_actions (workspace_id, user_id, created_at);
ALTER TABLE ai_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ai_actions TO pulse_app USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));
GRANT SELECT, INSERT, UPDATE ON ai_actions TO pulse_app;
REVOKE DELETE, TRUNCATE ON ai_actions FROM pulse_app;
