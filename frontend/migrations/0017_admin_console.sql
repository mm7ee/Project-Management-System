-- Administrator module, phase 1: roles, and organisation and workspace administration.
--   1. A read-only role, `reader` (shown as "Viewer"), alongside the six roles a workspace member can have.
--   2. An organisation profile (logo, colour, time zone, working days and hours, contact email) that its
--      administrators may change, and nothing else about the organisation.
--   3. Workspace icon, colour, description and visibility ("organisation": anyone in the organisation may open it,
--      read-only).
--   4. Deactivating an account: it keeps its history and memberships but can't sign in.
--   5. audit_log: who changed what in administration, with the values before and after. Append-only: the app can
--      add and read entries, never change or remove them; only deleting the whole organisation removes them.
--   6. Deleting an organisation: only an archived one, 30 days after a Platform Administrator asks
--      (organizations.delete_after), by tenancy_purge_organization, run by the cron as the owner.
-- Reverse: migrations/down/0017_admin_console.down.sql.

-- 1. The Viewer role.
ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_role_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('admin', 'manager', 'team_lead', 'assistant', 'developer', 'viewer', 'reader'));

-- 2. The organisation profile.
ALTER TABLE organizations
  ADD COLUMN logo          TEXT CHECK (logo IS NULL OR (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' AND length(logo) <= 200000)),
  ADD COLUMN colour        TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN time_zone     TEXT NOT NULL DEFAULT 'Africa/Harare' CHECK (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  ADD COLUMN work_days     TEXT NOT NULL DEFAULT '1,2,3,4,5' CHECK (work_days ~ '^[1-7](,[1-7]){0,6}$'),   -- ISO weekdays
  ADD COLUMN work_start    TEXT NOT NULL DEFAULT '08:00' CHECK (work_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN work_end      TEXT NOT NULL DEFAULT '17:00' CHECK (work_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN contact_email TEXT CHECK (contact_email IS NULL OR length(contact_email) <= 120),
  ADD COLUMN delete_after  TEXT;   -- set by a Platform Administrator on an archived organisation
-- Its administrators change the profile, through the app's role, and no other column (name, code and status stay
-- with the Platform Administrators).
GRANT UPDATE (logo, colour, time_zone, work_days, work_start, work_end, contact_email, updated_at) ON organizations TO pulse_app;
CREATE POLICY tenant_profile ON organizations FOR UPDATE TO pulse_app
  USING (id = current_setting('app.org_id', true)) WITH CHECK (id = current_setting('app.org_id', true));

-- 3. Workspace profile.
ALTER TABLE workspaces
  ADD COLUMN icon        TEXT NOT NULL DEFAULT 'layers' CHECK (icon ~ '^[a-z-]{1,30}$'),
  ADD COLUMN colour      TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  ADD COLUMN visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'organization'));

-- 4. Deactivated accounts. The `users` view gains the column (added last, so the view can be replaced in place).
ALTER TABLE accounts ADD COLUMN deactivated_at TEXT;
CREATE OR REPLACE VIEW users WITH (security_invoker = true) AS
SELECT a.id, a.username, a.name, a.title, a.email, a.phone, COALESCE(m.role, a.role) AS role, a.project_id, a.password_hash, a.prefs,
       a.must_change_password, a.mfa_secret, a.mfa_pending, a.mfa_last_step, a.mfa_enabled_at, a.locked_until, a.locked_at,
       a.organization_id, a.org_admin, a.deactivated_at
FROM accounts a
LEFT JOIN workspace_members m ON m.user_id = a.id AND m.workspace_id = NULLIF(current_setting('app.workspace_id', true), '');

-- 5. The administration audit log.
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '') REFERENCES organizations (id),
  workspace_id    TEXT,              -- the workspace the change was in; NULL for organisation-wide changes
  at              TEXT NOT NULL,
  actor_id        TEXT,
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_type     TEXT NOT NULL,     -- organization | workspace | person | membership | roles | setting | invite
  target_id       TEXT,
  before          TEXT,              -- JSON, or NULL when something was made
  after           TEXT,              -- JSON, or NULL when something was removed
  ip              TEXT
);
CREATE INDEX audit_log_org ON audit_log (organization_id, id DESC);
CREATE INDEX audit_log_ws ON audit_log (organization_id, workspace_id, id DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON audit_log TO pulse_app
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM pulse_app;
GRANT SELECT, INSERT ON audit_log TO pulse_app;
-- Not even the owner changes an entry. The only exception is deleting a whole organisation, which sets
-- app.purge_org to that organisation for its own transaction.
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.organization_id = current_setting('app.purge_org', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE FUNCTION audit_log_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();

-- 6. Deleting an organisation, for good. Only an archived organisation whose delete_after has passed. Every row that
--    carries its organization_id goes, table by table; a table that still has rows another table points at is
--    retried on the next pass, until nothing is left. Raises (and so removes nothing) if rows remain.
CREATE FUNCTION tenancy_purge_organization(target TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  o       RECORD;
  t       TEXT;
  n       INTEGER;
  total   INTEGER := 0;
  pending TEXT[];
  passes  INTEGER := 0;
BEGIN
  SELECT id, status, delete_after INTO o FROM organizations WHERE id = target;
  IF o.id IS NULL THEN RAISE EXCEPTION 'No organisation %', target; END IF;
  IF o.id = 'pulse-template' THEN RAISE EXCEPTION 'The template organisation is never deleted'; END IF;
  IF o.status <> 'archived' OR o.delete_after IS NULL OR o.delete_after > to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
    RAISE EXCEPTION 'Organisation % is not due for deletion', target;
  END IF;
  PERFORM set_config('app.purge_org', target, true);
  SELECT array_agg(c.table_name::TEXT) INTO pending
  FROM information_schema.columns c JOIN information_schema.tables tb USING (table_schema, table_name)
  WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND tb.table_type = 'BASE TABLE' AND c.table_name <> 'organizations';
  WHILE array_length(pending, 1) > 0 AND passes < 20 LOOP
    passes := passes + 1;
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE organization_id = $1', t) USING target;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
        pending := array_remove(pending, t);
      EXCEPTION WHEN foreign_key_violation THEN
        NULL; -- something still points at it; the next pass tries again
      END;
    END LOOP;
  END LOOP;
  IF array_length(pending, 1) > 0 THEN
    RAISE EXCEPTION 'Could not delete organisation %: rows remain in %', target, pending;
  END IF;
  DELETE FROM organizations WHERE id = target;
  RETURN total;
END $$;
REVOKE EXECUTE ON FUNCTION tenancy_purge_organization(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION tenancy_purge_organization(TEXT) FROM pulse_app;
