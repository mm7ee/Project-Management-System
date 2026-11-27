-- Reverses migrations/0017_admin_console.sql. Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0017_admin_console.down.sql
-- Refused while anyone has the Viewer role (change their role first). The audit log entries, organisation and
-- workspace profiles, and deactivations made since are lost; deactivated people can sign in again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace_members WHERE role = 'reader') THEN
    RAISE EXCEPTION 'Some people have the Viewer role: give them another role before reversing 0017';
  END IF;
END $$;
DROP FUNCTION tenancy_purge_organization(TEXT);
DROP TABLE audit_log;
DROP FUNCTION audit_log_append_only();
DROP FUNCTION audit_log_no_truncate();
CREATE OR REPLACE VIEW users WITH (security_invoker = true) AS
SELECT a.id, a.username, a.name, a.title, a.email, a.phone, COALESCE(m.role, a.role) AS role, a.project_id, a.password_hash, a.prefs,
       a.must_change_password, a.mfa_secret, a.mfa_pending, a.mfa_last_step, a.mfa_enabled_at, a.locked_until, a.locked_at,
       a.organization_id, a.org_admin, NULL::TEXT AS deactivated_at
FROM accounts a
LEFT JOIN workspace_members m ON m.user_id = a.id AND m.workspace_id = NULLIF(current_setting('app.workspace_id', true), '');
ALTER TABLE accounts DROP COLUMN deactivated_at;
ALTER TABLE workspaces DROP COLUMN icon, DROP COLUMN colour, DROP COLUMN description, DROP COLUMN visibility;
DROP POLICY tenant_profile ON organizations;
REVOKE UPDATE (logo, colour, time_zone, work_days, work_start, work_end, contact_email, updated_at) ON organizations FROM pulse_app;
ALTER TABLE organizations DROP COLUMN logo, DROP COLUMN colour, DROP COLUMN time_zone, DROP COLUMN work_days,
  DROP COLUMN work_start, DROP COLUMN work_end, DROP COLUMN contact_email, DROP COLUMN delete_after;
ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_role_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('admin', 'manager', 'team_lead', 'assistant', 'developer', 'viewer'));
DELETE FROM schema_migrations WHERE name = '0017_admin_console.sql';
