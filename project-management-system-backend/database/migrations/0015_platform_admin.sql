-- Multi-tenancy, phase (d): Platform Administrators, and the template new organisations start from.
--
--   1. Platform Administrators are their own accounts, outside every organisation: they create, rename, suspend
--      and archive organisations and give each its first administrator, and can't open any organisation's data.
--      They sign in at /platform with a password and, always, an authenticator app. pulse_app can't read any of
--      these tables; only the Worker's owner connection uses them. The first one is made from the command line
--      (scripts/platform-admin.mjs).
--   2. The template: an archived organisation (nobody can sign in to it) holding the configuration Pulse ships
--      with, the rows the earlier migrations seeded, by their fixed ids, as Omnicontact has them now:
--      statuses, the Default, Infrastructure deployment and Service desk workflows with their moves and rules,
--      the two security levels (role grants only), the notification schemes and the public holidays; and in its
--      workspace the four service desk request types with their questions, choices and SLA targets. Anything
--      Omnicontact added itself is not copied. A new organisation and each new workspace start from a copy.
-- Reverse: migrations/down/0015_platform_admin.down.sql.

CREATE TABLE platform_admins (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1, -- 1 until they replace the password they were given
  mfa_secret           TEXT,                       -- sealed with MFA_KEY; set up at the first sign-in
  mfa_last_step        BIGINT NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  last_login_at        TEXT
);
CREATE UNIQUE INDEX platform_admins_username ON platform_admins (lower(username));
CREATE TABLE platform_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL REFERENCES platform_admins (id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
-- Between the password and the code: a short-lived ticket, and while setting up the app, the secret being set up.
CREATE TABLE platform_challenges (
  token_hash     TEXT PRIMARY KEY,
  admin_id       TEXT NOT NULL REFERENCES platform_admins (id) ON DELETE CASCADE,
  pending_secret TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  expires_at     BIGINT NOT NULL
);
CREATE TABLE platform_activity (
  id       BIGSERIAL PRIMARY KEY,
  at       TEXT NOT NULL,
  admin_id TEXT,
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  target   TEXT,
  detail   TEXT NOT NULL DEFAULT '{}',
  ip       TEXT
);
CREATE INDEX platform_activity_at ON platform_activity (at);
-- 0014's default privileges would let pulse_app reach new tables; these are the owner's only.
REVOKE ALL ON platform_admins, platform_sessions, platform_challenges, platform_activity FROM pulse_app;
REVOKE ALL ON SEQUENCE platform_activity_id_seq FROM pulse_app;

-- ---------------------------------------------------------------------------------------------
-- The template
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  src    TEXT := (SELECT organization_id FROM tenancy_legacy);
  src_ws TEXT := COALESCE(
    (SELECT workspace_id FROM request_types GROUP BY workspace_id ORDER BY bool_or(workspace_id = (SELECT workspace_id FROM service_desk_config WHERE system_id IS NOT NULL LIMIT 1)) DESC, count(*) DESC LIMIT 1),
    (SELECT default_workspace_id FROM tenancy_legacy));
  t      TEXT := 'pulse-template';
  tws    TEXT := 'pulse-template-ws';
  now    TEXT := tenancy_now();
  st     TEXT[] := ARRAY['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BACKLOG', 'TESTING', 'CHANGE_APPROVAL', 'DEPLOYED', 'CLOSED', 'WAITING_CUSTOMER', 'RESOLVED'];
  wf     TEXT[] := ARRAY['default', 'infra-deploy', 'service-desk'];
  lv     TEXT[] := ARRAY['managers-only', 'hr-only'];
  rt     TEXT[] := ARRAY['incident', 'service-request', 'change', 'question'];
BEGIN
  INSERT INTO organizations (id, name, code, status, created_at, updated_at)
  VALUES (t, 'Template for new organisations', 'pulse-template', 'archived', now, now);
  INSERT INTO workspaces (id, organization_id, name, key, status, position, created_at, updated_at)
  VALUES (tws, t, 'Template workspace', 'TEMPLATE', 'archived', 0, now, now);

  INSERT INTO work_statuses (organization_id, id, name, category, position, created_at)
    SELECT t, id, name, category, position, now FROM work_statuses WHERE organization_id = src AND id = ANY (st);
  INSERT INTO workflows (organization_id, id, name, description, is_default, created_at, updated_at)
    SELECT t, id, name, description, CASE WHEN id = 'default' THEN 1 ELSE 0 END, now, now FROM workflows WHERE organization_id = src AND id = ANY (wf);
  INSERT INTO workflow_statuses (organization_id, workflow_id, status_id, position, is_initial)
    SELECT t, workflow_id, status_id, position, is_initial FROM workflow_statuses WHERE organization_id = src AND workflow_id = ANY (wf) AND status_id = ANY (st);
  INSERT INTO workflow_transitions (organization_id, id, workflow_id, name, from_status, to_status, position)
    SELECT t, id, workflow_id, name, from_status, to_status, position FROM workflow_transitions
    WHERE organization_id = src AND workflow_id = ANY (wf) AND (from_status IS NULL OR from_status = ANY (st)) AND to_status = ANY (st);
  INSERT INTO workflow_rules (organization_id, transition_id, kind, rule, value)
    SELECT t, r.transition_id, r.kind, r.rule, r.value FROM workflow_rules r
    WHERE r.organization_id = src AND r.transition_id IN (SELECT id FROM workflow_transitions WHERE organization_id = t)
      AND r.rule NOT IN ('assign_user'); -- a rule naming a person of Omnicontact's isn't copied
  INSERT INTO security_levels (organization_id, id, name, description, position, created_at, updated_at)
    SELECT t, id, name, description, position, now, now FROM security_levels WHERE organization_id = src AND id = ANY (lv);
  INSERT INTO security_level_grants (organization_id, level_id, role, user_id)
    SELECT t, level_id, role, NULL FROM security_level_grants WHERE organization_id = src AND level_id = ANY (lv) AND role IS NOT NULL;
  INSERT INTO notification_schemes (organization_id, event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, updated_at)
    SELECT t, event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, notify_role, by_bell, by_email, by_teams, now FROM notification_schemes WHERE organization_id = src;
  INSERT INTO public_holidays (organization_id, day, name)
    SELECT t, day, name FROM public_holidays WHERE organization_id = src;

  INSERT INTO request_types (organization_id, workspace_id, id, name, kind, description, item_type, position, enabled, created_at, updated_at)
    SELECT t, tws, id, name, kind, description, item_type, position, 1, now, now FROM request_types WHERE workspace_id = src_ws AND id = ANY (rt);
  INSERT INTO request_type_fields (organization_id, workspace_id, id, request_type_id, label, kind, help, required, position)
    SELECT t, tws, id, request_type_id, label, kind, help, required, position FROM request_type_fields WHERE workspace_id = src_ws AND request_type_id = ANY (rt);
  INSERT INTO request_type_field_options (organization_id, workspace_id, id, field_id, label, position)
    SELECT t, tws, o.id, o.field_id, o.label, o.position FROM request_type_field_options o
    WHERE o.workspace_id = src_ws AND o.field_id IN (SELECT id FROM request_type_fields WHERE workspace_id = tws);
  INSERT INTO sla_targets (organization_id, workspace_id, request_type_id, priority, first_response_minutes, resolution_minutes)
    SELECT t, tws, request_type_id, priority, first_response_minutes, resolution_minutes FROM sla_targets WHERE workspace_id = src_ws AND request_type_id = ANY (rt);
END $$;
