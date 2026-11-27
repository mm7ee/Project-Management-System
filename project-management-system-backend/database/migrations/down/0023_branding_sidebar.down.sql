-- Reverses 0023_branding_sidebar.sql: every organisation's sidebar is the neutral one again.
ALTER TABLE organization_branding DROP COLUMN sidebar, DROP COLUMN highlight;
