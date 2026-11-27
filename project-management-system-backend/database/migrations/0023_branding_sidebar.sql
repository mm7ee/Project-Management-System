-- An organisation's own sidebar (optional): its colour and its highlight (the active page's edge, glow and icons).
-- Without them the sidebar is the neutral graphite with the organisation's accent, as before. The app makes every
-- choice safe (src/data/branding.js sidebarTheme): the sidebar dark enough for its text, the highlight clear on it.
-- Omnicontact gets its colours from before the rename: Penn blue with a sky-blue highlight.
-- Reverse: migrations/down/0023_branding_sidebar.down.sql.
ALTER TABLE organization_branding
  ADD COLUMN sidebar   TEXT CHECK (sidebar IS NULL OR sidebar ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN highlight TEXT CHECK (highlight IS NULL OR highlight ~ '^#[0-9a-f]{6}$');

UPDATE organization_branding b
SET sidebar = '#011f5b', highlight = '#1ba9e1', version = b.version + 1
FROM organizations o
WHERE o.id = b.organization_id AND o.code = 'omnicontact';
