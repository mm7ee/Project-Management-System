-- Multi-tenancy, phase (e): the executive page (/executive) becomes a secret link per workspace, like the
-- view-only links: a token shown once and kept as a hash, expiring and revocable, made by people who manage users.
-- The page shows that workspace's totals only (no names of projects, people or blockers), as before. The old
-- public /executive address (Omnicontact's totals, with no link) stops working.
-- Reverse: migrations/down/0016_showcase_links.down.sql.

CREATE TABLE showcase_links (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  token_hash      TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  last_used_at    TEXT,
  views           INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT tn_showcase_links_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX showcase_links_ws ON showcase_links (workspace_id);
ALTER TABLE showcase_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON showcase_links TO pulse_app
  USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON showcase_links TO pulse_app;
