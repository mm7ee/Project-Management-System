-- Integrations, administration schemes and Service Desk lite (upgrade Phase 5).
-- GitHub development links and its sealed webhook secret; personal API tokens and their rate counters;
-- outbound webhooks and their deliveries; notification schemes and personal opt-outs; security levels on
-- work items; custom fields per workspace; and the service desk: request types with their form fields,
-- SLA targets in business hours, public holidays, intake portal links, and requests (work items with
-- source 'service_desk') with their answers, SLA pauses and alerts.

-- ---------- security levels ----------
CREATE TABLE security_levels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX security_levels_name ON security_levels (lower(name));

-- Who may see items at a level: a role, or a person. Administrators, and the item's assignee and
-- reporter, always may.
CREATE TABLE security_level_grants (
  id       BIGSERIAL PRIMARY KEY,
  level_id TEXT NOT NULL REFERENCES security_levels (id) ON DELETE CASCADE,
  role     TEXT,
  user_id  TEXT,
  CHECK ((role IS NULL) <> (user_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (level_id, role, user_id)
);
CREATE INDEX security_level_grants_role ON security_level_grants (role) WHERE role IS NOT NULL;
CREATE INDEX security_level_grants_user ON security_level_grants (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE work_items ADD COLUMN security_level TEXT REFERENCES security_levels (id);
CREATE INDEX work_items_security_level ON work_items (security_level) WHERE security_level IS NOT NULL;

INSERT INTO security_levels (id, name, description, position, created_at, updated_at) VALUES
  ('managers-only', 'Confidential – Managers only', 'Seen by Managers, administrators, and the item''s assignee and reporter.', 1, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'),
  ('hr-only', 'HR only', 'Seen by the people an administrator adds, administrators, and the item''s assignee and reporter.', 2, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z');
INSERT INTO security_level_grants (level_id, role) VALUES ('managers-only', 'manager');

-- Feature requests are work items too: the view carries the level, so the Worker can hide them.
CREATE OR REPLACE VIEW features AS
SELECT
  w.id,
  w.system_id,
  w.summary AS title,
  w.description,
  CASE
    WHEN EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label = 'new-module') THEN 'NEW_MODULE'
    WHEN EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label = 'enhancement') THEN 'ENHANCEMENT'
    WHEN EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label = 'bug-fix') THEN 'BUG_FIX'
    WHEN EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label = 'change') THEN 'CHANGE'
    WHEN w.type = 'BUG' THEN 'BUG_FIX'
    ELSE 'CHANGE'
  END AS kind,
  COALESCE(w.client, '') AS client,
  CASE
    WHEN st.category = 'DONE' AND w.resolution = 'WONT_DO' THEN 'CANCELLED'
    WHEN st.category = 'DONE' THEN 'COMPLETED'
    WHEN w.on_hold = 1 THEN 'ON_HOLD'
    WHEN st.category = 'IN_PROGRESS' AND (st.name ILIKE '%review%' OR st.name ILIKE '%test%' OR st.name ILIKE '%approval%') THEN 'TESTING'
    WHEN st.category = 'IN_PROGRESS' THEN 'IN_PROGRESS'
    ELSE 'NOT_STARTED'
  END AS status,
  CASE w.priority WHEN 'HIGHEST' THEN 'CRITICAL' WHEN 'LOWEST' THEN 'LOW' ELSE w.priority END AS priority,
  w.assignee,
  w.notes,
  w.due_date AS due_at,
  w.reporter AS created_by,
  w.created_at,
  w.updated_at,
  CASE WHEN st.category = 'DONE' AND COALESCE(w.resolution, 'DONE') <> 'WONT_DO' THEN w.resolved_at END AS completed_at,
  s.key || '-' || w.number AS item_key,
  w.security_level
FROM work_items w
JOIN work_statuses st ON st.id = w.status
JOIN systems s ON s.id = w.system_id
WHERE w.source = 'client_request';

-- ---------- custom fields ----------
CREATE TABLE custom_fields (
  id          TEXT PRIMARY KEY,
  workspace   TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('text', 'number', 'date', 'select', 'multiselect', 'user')),
  description TEXT NOT NULL DEFAULT '',
  required    INTEGER NOT NULL DEFAULT 0,
  on_create   INTEGER NOT NULL DEFAULT 1,   -- shown on the create form
  on_edit     INTEGER NOT NULL DEFAULT 1,   -- editable on the item page
  on_view     INTEGER NOT NULL DEFAULT 1,   -- shown on the item page
  on_board    INTEGER NOT NULL DEFAULT 0,   -- shown on board cards
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX custom_fields_name ON custom_fields (workspace, lower(name));

CREATE TABLE custom_field_options (
  id       TEXT PRIMARY KEY,
  field_id TEXT NOT NULL REFERENCES custom_fields (id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX custom_field_options_label ON custom_field_options (field_id, lower(label));

-- One row per value; a multi-select field has a row per chosen option.
CREATE TABLE custom_field_values (
  id           BIGSERIAL PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  field_id     TEXT NOT NULL REFERENCES custom_fields (id) ON DELETE CASCADE,
  value_text   TEXT,
  value_number NUMERIC(14, 2),
  value_date   TEXT,                       -- YYYY-MM-DD
  value_user   TEXT,
  option_id    TEXT REFERENCES custom_field_options (id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (item_id, field_id, option_id)
);
CREATE INDEX custom_field_values_item ON custom_field_values (item_id);
CREATE INDEX custom_field_values_field ON custom_field_values (field_id, option_id);
CREATE INDEX custom_field_values_user ON custom_field_values (field_id, value_user) WHERE value_user IS NOT NULL;

-- ---------- GitHub ----------
-- Secrets for integrations, sealed with MFA_KEY like the email and Teams keys. Never sent back.
CREATE TABLE integration_secrets (
  kind       TEXT PRIMARY KEY CHECK (kind IN ('github')),
  sealed     TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Commits, branches and pull requests that mention a work item's key.
CREATE TABLE dev_links (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('commit', 'branch', 'pull_request')),
  repo       TEXT NOT NULL,
  ref        TEXT NOT NULL,                -- commit SHA, branch name or pull request number
  title      TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  state      TEXT,                         -- pull requests: open, merged or closed
  at         TEXT NOT NULL,                -- when it happened on GitHub
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (item_id, kind, repo, ref)
);
CREATE INDEX dev_links_item ON dev_links (item_id, at);

-- GitHub's delivery ids, so a redelivered event isn't counted twice.
CREATE TABLE github_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event       TEXT NOT NULL,
  linked      INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX github_deliveries_received ON github_deliveries (received_at);

-- ---------- personal API tokens ----------
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,              -- the first characters, to tell tokens apart
  scope        TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  revoked_by   TEXT
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);

-- Requests per token per minute, for the rate limit.
CREATE TABLE api_token_usage (
  token_id TEXT NOT NULL REFERENCES api_tokens (id) ON DELETE CASCADE,
  minute   BIGINT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, minute)
);

-- ---------- outbound webhooks ----------
CREATE TABLE webhooks (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  secret_sealed   TEXT NOT NULL,           -- the signing secret, sealed with MFA_KEY
  system_id       TEXT REFERENCES systems (id) ON DELETE CASCADE, -- NULL: every project
  on_created      INTEGER NOT NULL DEFAULT 1,
  on_updated      INTEGER NOT NULL DEFAULT 1,
  on_transitioned INTEGER NOT NULL DEFAULT 1,
  on_commented    INTEGER NOT NULL DEFAULT 1,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE webhook_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  webhook_id      TEXT NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  item_key        TEXT,
  payload         TEXT NOT NULL,           -- the JSON body, as signed
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_status     INTEGER,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  delivered_at    TEXT
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries (webhook_id, id DESC);

-- ---------- notification schemes ----------
CREATE TABLE notification_schemes (
  event            TEXT PRIMARY KEY CHECK (event IN ('item_created', 'item_assigned', 'item_updated', 'item_transitioned', 'item_commented')),
  notify_assignee  INTEGER NOT NULL DEFAULT 0,
  notify_reporter  INTEGER NOT NULL DEFAULT 0,
  notify_watchers  INTEGER NOT NULL DEFAULT 0,
  notify_lead      INTEGER NOT NULL DEFAULT 0,   -- the project's lead
  notify_mentioned INTEGER NOT NULL DEFAULT 0,   -- people @mentioned in the comment or description
  notify_role      TEXT,                         -- everyone with this role
  by_bell          INTEGER NOT NULL DEFAULT 1,
  by_email         INTEGER NOT NULL DEFAULT 1,
  by_teams         INTEGER NOT NULL DEFAULT 0,   -- one post to the team's channel
  updated_by       TEXT,
  updated_at       TEXT NOT NULL
);
-- The defaults are what Pulse did before schemes.
INSERT INTO notification_schemes (event, notify_assignee, notify_reporter, notify_watchers, notify_lead, notify_mentioned, by_bell, by_email, by_teams, updated_at) VALUES
  ('item_created',      1, 0, 0, 0, 1, 1, 1, 0, '2026-11-17T00:00:00.000Z'),
  ('item_assigned',     1, 0, 0, 0, 0, 1, 1, 0, '2026-11-17T00:00:00.000Z'),
  ('item_updated',      0, 0, 1, 0, 0, 1, 1, 0, '2026-11-17T00:00:00.000Z'),
  ('item_transitioned', 0, 0, 1, 0, 0, 1, 1, 0, '2026-11-17T00:00:00.000Z'),
  ('item_commented',    0, 0, 1, 0, 1, 1, 1, 0, '2026-11-17T00:00:00.000Z');

-- A person who doesn't want to hear about an event (Settings → Notifications).
CREATE TABLE notification_optouts (
  user_id TEXT NOT NULL,
  event   TEXT NOT NULL,
  PRIMARY KEY (user_id, event)
);

-- ---------- service desk ----------
ALTER TABLE work_items DROP CONSTRAINT work_items_source_check;
ALTER TABLE work_items ADD CONSTRAINT work_items_source_check CHECK (source IN ('internal', 'client_request', 'service_desk'));

-- Replies the customer sees ("public"), and comments the customer wrote through the portal.
ALTER TABLE work_item_comments ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_item_comments ADD COLUMN customer_name TEXT;

INSERT INTO work_statuses (id, name, category, position, created_at) VALUES
  ('WAITING_CUSTOMER', 'Waiting for customer', 'IN_PROGRESS', 15, '2026-11-17T00:00:00.000Z'),
  ('RESOLVED', 'Resolved', 'DONE', 16, '2026-11-17T00:00:00.000Z');

-- The Service desk workflow. Changes go through Phase 2's Change Approval step, which only a Manager
-- approves, with a comment.
INSERT INTO workflows (id, name, description, is_default, created_at, updated_at) VALUES
  ('service-desk', 'Service desk', 'To Do → In Progress ⇄ Waiting for customer → Resolved → Closed. Changes go through Change Approval, which a Manager approves.', 0, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z');
INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES
  ('service-desk', 'TODO', 1, 1), ('service-desk', 'IN_PROGRESS', 2, 0), ('service-desk', 'WAITING_CUSTOMER', 3, 0),
  ('service-desk', 'CHANGE_APPROVAL', 4, 0), ('service-desk', 'RESOLVED', 5, 0), ('service-desk', 'CLOSED', 6, 0);
INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES
  ('sd-start', 'service-desk', 'Start work', 'TODO', 'IN_PROGRESS', 1),
  ('sd-wait', 'service-desk', 'Wait for customer', 'IN_PROGRESS', 'WAITING_CUSTOMER', 2),
  ('sd-resume', 'service-desk', 'Customer replied', 'WAITING_CUSTOMER', 'IN_PROGRESS', 3),
  ('sd-approval', 'service-desk', 'Request change approval', 'IN_PROGRESS', 'CHANGE_APPROVAL', 4),
  ('sd-reject', 'service-desk', 'Reject change', 'CHANGE_APPROVAL', 'IN_PROGRESS', 5),
  ('sd-approve', 'service-desk', 'Approve change', 'CHANGE_APPROVAL', 'RESOLVED', 6),
  ('sd-resolve', 'service-desk', 'Resolve', 'IN_PROGRESS', 'RESOLVED', 7),
  ('sd-reopen', 'service-desk', 'Reopen', 'RESOLVED', 'IN_PROGRESS', 8),
  ('sd-close', 'service-desk', 'Close', 'RESOLVED', 'CLOSED', 9);
INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES
  ('sd-reject', 'validator', 'comment_required', NULL),
  ('sd-approve', 'condition', 'role', 'manager'),
  ('sd-approve', 'validator', 'comment_required', NULL),
  ('sd-approve', 'post_function', 'set_resolution', 'DONE'),
  ('sd-resolve', 'post_function', 'set_resolution', 'DONE'),
  ('sd-close', 'post_function', 'set_resolution', 'DONE');

-- Which project requests land in. Choosing it gives that project the Service desk workflow.
CREATE TABLE service_desk_config (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  system_id  TEXT REFERENCES systems (id) ON DELETE SET NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO service_desk_config (id, system_id, updated_at) VALUES (1, NULL, '2026-11-17T00:00:00.000Z');

CREATE TABLE request_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('incident', 'service_request', 'change', 'question')),
  description TEXT NOT NULL DEFAULT '',
  item_type   TEXT NOT NULL DEFAULT 'TASK' CHECK (item_type IN ('TASK', 'BUG')),
  position    INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE request_type_fields (
  id              TEXT PRIMARY KEY,
  request_type_id TEXT NOT NULL REFERENCES request_types (id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('text', 'textarea', 'select', 'date')),
  help            TEXT NOT NULL DEFAULT '',
  required        INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX request_type_fields_type ON request_type_fields (request_type_id, position);

CREATE TABLE request_type_field_options (
  id       TEXT PRIMARY KEY,
  field_id TEXT NOT NULL REFERENCES request_type_fields (id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX request_type_field_options_field ON request_type_field_options (field_id, position);

-- First-response and resolution targets, in business minutes (Mon–Fri 08:00–17:00 Harare).
CREATE TABLE sla_targets (
  request_type_id        TEXT NOT NULL REFERENCES request_types (id) ON DELETE CASCADE,
  priority               TEXT NOT NULL CHECK (priority IN ('HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST')),
  first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes     INTEGER NOT NULL CHECK (resolution_minutes > 0),
  PRIMARY KEY (request_type_id, priority)
);

CREATE TABLE public_holidays (
  day  TEXT PRIMARY KEY,                   -- YYYY-MM-DD
  name TEXT NOT NULL
);

-- Intake portal links: like view-only links, they expire and can be revoked.
CREATE TABLE portal_links (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_used_at TEXT,
  requests     INTEGER NOT NULL DEFAULT 0
);

-- A service desk request: a work item, plus who asked and its SLA clock.
CREATE TABLE sd_requests (
  item_id                    TEXT PRIMARY KEY REFERENCES work_items (id) ON DELETE CASCADE,
  request_type_id            TEXT NOT NULL REFERENCES request_types (id),
  customer_name              TEXT NOT NULL,
  customer_email             TEXT,
  customer_user_id           TEXT,          -- raised by a signed-in member of staff
  portal_link_id             TEXT,          -- raised through a portal link
  requester_key_hash         TEXT,          -- lets that browser track its own requests
  first_response_at          TEXT,
  first_response_warned_at   TEXT,
  first_response_breached_at TEXT,
  resolution_warned_at       TEXT,
  resolution_breached_at     TEXT,
  created_at                 TEXT NOT NULL
);
CREATE INDEX sd_requests_type ON sd_requests (request_type_id, created_at);
CREATE INDEX sd_requests_customer ON sd_requests (customer_user_id) WHERE customer_user_id IS NOT NULL;
CREATE INDEX sd_requests_requester ON sd_requests (requester_key_hash) WHERE requester_key_hash IS NOT NULL;

CREATE TABLE sd_answers (
  item_id  TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  label    TEXT NOT NULL,                  -- the question as it was asked
  value    TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, field_id)
);

-- While a request waits for the customer, its SLA clock stops.
CREATE TABLE sd_pauses (
  id         BIGSERIAL PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at   TEXT
);
CREATE INDEX sd_pauses_item ON sd_pauses (item_id, started_at);

INSERT INTO request_types (id, name, kind, description, item_type, position, created_at, updated_at) VALUES
  ('incident', 'Incident', 'incident', 'Something is broken or not working as it should.', 'BUG', 1, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'),
  ('service-request', 'Service request', 'service_request', 'Ask for something: access, equipment, a new account or a report.', 'TASK', 2, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'),
  ('change', 'Change', 'change', 'A change to a live system. It needs a Manager''s approval.', 'TASK', 3, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z'),
  ('question', 'Question', 'question', 'Ask the team a question.', 'TASK', 4, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z');

INSERT INTO request_type_fields (id, request_type_id, label, kind, help, required, position) VALUES
  ('incident-system', 'incident', 'Which system is affected?', 'text', 'The application, site or service.', 1, 1),
  ('incident-impact', 'incident', 'How many people are affected?', 'select', '', 1, 2),
  ('incident-since', 'incident', 'When did it start?', 'date', '', 0, 3),
  ('sr-what', 'service-request', 'What do you need?', 'select', '', 1, 1),
  ('sr-needed-by', 'service-request', 'Needed by', 'date', '', 0, 2),
  ('change-system', 'change', 'System to change', 'text', '', 1, 1),
  ('change-window', 'change', 'Preferred change window', 'text', 'For example: Saturday 18:00–20:00.', 1, 2),
  ('change-rollback', 'change', 'How would it be rolled back?', 'textarea', '', 1, 3),
  ('change-risk', 'change', 'Risk', 'select', '', 1, 4),
  ('question-topic', 'question', 'Topic', 'text', '', 0, 1);
INSERT INTO request_type_field_options (id, field_id, label, position) VALUES
  ('impact-one', 'incident-impact', 'Just me', 1),
  ('impact-team', 'incident-impact', 'My team', 2),
  ('impact-site', 'incident-impact', 'A whole site or client', 3),
  ('impact-all', 'incident-impact', 'Everyone', 4),
  ('sr-access', 'sr-what', 'Access to a system', 1),
  ('sr-equipment', 'sr-what', 'Equipment', 2),
  ('sr-account', 'sr-what', 'A new account', 3),
  ('sr-report', 'sr-what', 'A report or data extract', 4),
  ('sr-other', 'sr-what', 'Something else', 5),
  ('risk-low', 'change-risk', 'Low', 1),
  ('risk-medium', 'change-risk', 'Medium', 2),
  ('risk-high', 'change-risk', 'High', 3);

-- Targets in business minutes: a business day is 9 hours (540 minutes).
INSERT INTO sla_targets (request_type_id, priority, first_response_minutes, resolution_minutes)
SELECT t.id, p.priority, p.fr, p.res FROM request_types t CROSS JOIN (VALUES
  ('HIGHEST', 30, 240), ('HIGH', 60, 540), ('MEDIUM', 240, 1620), ('LOW', 540, 2700), ('LOWEST', 540, 5400)
) AS p (priority, fr, res);

-- Zimbabwe's public holidays for 2026 and 2027 (a Sunday holiday is kept on the Monday). Edit them in
-- Settings → Administration → Service desk.
INSERT INTO public_holidays (day, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-21', 'Robert Gabriel Mugabe National Youth Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-04', 'Holy Saturday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-04-18', 'Independence Day'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-05-25', 'Africa Day'),
  ('2026-08-10', 'Heroes'' Day'),
  ('2026-08-11', 'Defence Forces Day'),
  ('2026-12-22', 'National Unity Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Boxing Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-22', 'Robert Gabriel Mugabe National Youth Day (observed)'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-27', 'Holy Saturday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-04-19', 'Independence Day (observed)'),
  ('2027-05-01', 'Workers'' Day'),
  ('2027-05-25', 'Africa Day'),
  ('2027-08-09', 'Heroes'' Day'),
  ('2027-08-10', 'Defence Forces Day'),
  ('2027-12-22', 'National Unity Day'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-27', 'Boxing Day (observed)');

-- ---------- permissions ----------
-- Saved role permissions get the new permissions' defaults (see src/data/roles.ts).
DO $$
DECLARE
  matrix JSONB;
  r TEXT;
BEGIN
  SELECT value::jsonb INTO matrix FROM settings WHERE key = 'role_permissions';
  IF matrix IS NULL THEN RETURN; END IF;
  FOREACH r IN ARRAY ARRAY['manager', 'team_lead', 'assistant', 'developer'] LOOP
    IF matrix ? r THEN matrix := jsonb_set(matrix, ARRAY[r], (matrix -> r) || '["use_api", "work_service_desk"]'::jsonb); END IF;
  END LOOP;
  IF matrix ? 'manager' THEN matrix := jsonb_set(matrix, ARRAY['manager'], (matrix -> 'manager') || '["manage_service_desk"]'::jsonb); END IF;
  UPDATE settings SET value = matrix::text WHERE key = 'role_permissions';
END $$;
