-- Reverses migrations/0015_platform_admin.sql. Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0015_platform_admin.down.sql
-- Organisations made since by Platform Administrators stay (with their data); only the template and the
-- Platform Administrators' own tables go.

DO $$
DECLARE
  t    TEXT;
  pass INT;
BEGIN
  -- The template's rows, retried until the foreign keys let each table go.
  FOR pass IN 1..6 LOOP
    FOR t IN SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables x USING (table_schema, table_name)
             WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND x.table_type = 'BASE TABLE'
               AND c.table_name NOT IN ('organizations', 'workspaces') LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE organization_id = %L', t, 'pulse-template');
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $$;
DELETE FROM workspaces WHERE organization_id = 'pulse-template';
DELETE FROM organizations WHERE id = 'pulse-template';
DROP TABLE platform_activity;
DROP TABLE platform_challenges;
DROP TABLE platform_sessions;
DROP TABLE platform_admins;
DELETE FROM schema_migrations WHERE name = '0015_platform_admin.sql';
