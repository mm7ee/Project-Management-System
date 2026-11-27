-- Logo-driven themes (docs/adaptive-theming-plan.md): each organisation's theme, as versions.
--   - spec is a ThemeSpec (src/data/logoTheme.js cleanThemeSpec): a small JSON object of numbers and names. The
--     Worker validates it before storing and again before using it; no CSS is ever stored.
--   - status: at most one draft and one published version per organisation; the rest are history (archived).
--     Rolling back publishes a copy of an old version, so history is never rewritten.
--   - Without a published theme an organisation keeps its accent (and sidebar colours, 0023), as before.
-- Row-level security keeps each organisation to its own rows. Reverse: migrations/down/0024_organization_themes.down.sql.
CREATE TABLE organization_themes (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '') REFERENCES organizations (id) ON DELETE CASCADE,
  version         INTEGER NOT NULL CHECK (version > 0),
  status          TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  spec            TEXT NOT NULL CHECK (length(spec) <= 2000 AND left(spec, 1) = '{'),
  note            TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  published_at    TEXT,
  published_by    TEXT,
  UNIQUE (organization_id, version)
);
CREATE UNIQUE INDEX organization_themes_one_draft ON organization_themes (organization_id) WHERE status = 'draft';
CREATE UNIQUE INDEX organization_themes_one_published ON organization_themes (organization_id) WHERE status = 'published';
ALTER TABLE organization_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON organization_themes TO pulse_app
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));
REVOKE DELETE, TRUNCATE ON organization_themes FROM pulse_app;
GRANT SELECT, INSERT, UPDATE ON organization_themes TO pulse_app;
