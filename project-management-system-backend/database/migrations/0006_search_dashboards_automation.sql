-- Search, dashboards and automation (upgrade Phase 4). Saved PQL filters (private or shared), their
-- favourites and email subscriptions; configurable dashboards whose gadgets each read a saved filter;
-- and automation rules with their actions and a run log.

-- ---------- saved filters ----------
CREATE TABLE saved_filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pql         TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  share_scope TEXT NOT NULL DEFAULT 'private' CHECK (share_scope IN ('private', 'role', 'workspace', 'everyone')),
  share_value TEXT,                                  -- the role or workspace it's shared with
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX saved_filters_owner ON saved_filters (owner_id);
CREATE INDEX saved_filters_share ON saved_filters (share_scope, share_value);

CREATE TABLE filter_favourites (
  filter_id  TEXT NOT NULL REFERENCES saved_filters (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (filter_id, user_id)
);
CREATE INDEX filter_favourites_user ON filter_favourites (user_id);

-- Emailed results: daily, or weekly on a weekday (1 Monday … 7 Sunday), at an hour of Harare time.
CREATE TABLE filter_subscriptions (
  id           TEXT PRIMARY KEY,
  filter_id    TEXT NOT NULL REFERENCES saved_filters (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  frequency    TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  weekday      INTEGER CHECK (weekday BETWEEN 1 AND 7),
  hour         INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  last_sent_at TEXT,
  created_at   TEXT NOT NULL,
  CHECK ((frequency = 'weekly') = (weekday IS NOT NULL))
);
CREATE INDEX filter_subscriptions_hour ON filter_subscriptions (hour, frequency);
CREATE INDEX filter_subscriptions_user ON filter_subscriptions (user_id);

-- ---------- dashboards ----------
CREATE TABLE dashboards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  share_scope TEXT NOT NULL DEFAULT 'private' CHECK (share_scope IN ('private', 'role', 'workspace', 'everyone')),
  share_value TEXT,
  layout      TEXT NOT NULL DEFAULT 'two' CHECK (layout IN ('one', 'two', 'three')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX dashboards_owner ON dashboards (owner_id);
CREATE INDEX dashboards_share ON dashboards (share_scope, share_value);

CREATE TABLE dashboard_gadgets (
  id           TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('filter_results', 'pie', 'created_resolved', 'sprint_health', 'workload', 'overdue', 'two_d', 'activity')),
  filter_id    TEXT REFERENCES saved_filters (id) ON DELETE SET NULL,
  title        TEXT NOT NULL DEFAULT '',
  column_index INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0,
  field        TEXT,                                 -- pie: the field to group by; two_d: the rows
  field2       TEXT,                                 -- two_d: the columns
  max_rows     INTEGER NOT NULL DEFAULT 10 CHECK (max_rows BETWEEN 1 AND 50)
);
CREATE INDEX dashboard_gadgets_dashboard ON dashboard_gadgets (dashboard_id, column_index, position);
CREATE INDEX dashboard_gadgets_filter ON dashboard_gadgets (filter_id);

-- ---------- automation ----------
CREATE TABLE automation_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  enabled         INTEGER NOT NULL DEFAULT 0,
  scope           TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'workspace', 'project')),
  scope_value     TEXT,                              -- the workspace name or project id
  trigger         TEXT NOT NULL CHECK (trigger IN ('item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule')),
  trigger_value   TEXT,                              -- transitioned: the status moved to; field changed: the field
  schedule_weekday INTEGER CHECK (schedule_weekday BETWEEN 1 AND 7), -- schedule: NULL every day
  schedule_hour   INTEGER CHECK (schedule_hour BETWEEN 0 AND 23),   -- schedule: Harare time
  condition_pql   TEXT NOT NULL DEFAULT '',
  max_per_minute  INTEGER NOT NULL DEFAULT 10 CHECK (max_per_minute BETWEEN 1 AND 100),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_run_at     TEXT
);
CREATE INDEX automation_rules_trigger ON automation_rules (trigger, enabled);

-- kind: transition (value: a status, or category:DONE), assign (value: a user id, reporter, lead, role:<role>,
-- or nobody), set_field (field, value), comment (value), notify (field: watchers, assignee, reporter,
-- person:<id>, role:<role> or teams; value: the message; value2: channels, such as bell,email),
-- create_subtask (value: summary), link (field: link type; value: the other item's key).
CREATE TABLE automation_actions (
  id       TEXT PRIMARY KEY,
  rule_id  TEXT NOT NULL REFERENCES automation_rules (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('transition', 'assign', 'set_field', 'comment', 'notify', 'create_subtask', 'link')),
  field    TEXT,
  value    TEXT,
  value2   TEXT
);
CREATE INDEX automation_actions_rule ON automation_actions (rule_id, position);

CREATE TABLE automation_runs (
  id            BIGSERIAL PRIMARY KEY,
  rule_id       TEXT NOT NULL REFERENCES automation_rules (id) ON DELETE CASCADE,
  at            TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  item_key      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  message       TEXT NOT NULL DEFAULT '',
  touched       TEXT NOT NULL DEFAULT '',              -- keys of the items it changed, comma-separated
  depth         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX automation_runs_rule ON automation_runs (rule_id, at);
CREATE INDEX automation_runs_at ON automation_runs (at);

-- Three examples, switched off until someone turns them on.
INSERT INTO automation_rules (id, name, description, enabled, scope, trigger, condition_pql, created_by, created_at, updated_at) VALUES
  ('example-high-bug', 'High or Highest bug: give it to the team leader',
   'When a High or Highest bug is created, assign it to the project''s team leader and post it to Teams.',
   0, 'global', 'item_created', 'type = Bug AND priority IN (High, Highest)', 'admin', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'),
  ('example-subtasks-done', 'All sub-tasks done: finish the parent',
   'When the last sub-task of a story, task or bug is done, move the parent to Done.',
   0, 'global', 'subtasks_done', '', 'admin', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z');
INSERT INTO automation_rules (id, name, description, enabled, scope, trigger, schedule_weekday, schedule_hour, condition_pql, created_by, created_at, updated_at) VALUES
  ('example-overdue-monday', 'Monday 08:00: overdue work to each assignee',
   'Every Monday at 08:00 Harare time, email each assignee a list of their overdue work items.',
   0, 'global', 'schedule', 1, 8, 'due < now() AND resolution IS EMPTY AND assignee IS NOT EMPTY', 'admin', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z');
INSERT INTO automation_actions (id, rule_id, position, kind, field, value, value2) VALUES
  ('example-high-bug-1', 'example-high-bug', 1, 'assign', NULL, 'role:team_lead', NULL),
  ('example-high-bug-2', 'example-high-bug', 2, 'notify', 'teams', 'New {priority} bug {key}: {summary}. Assigned to {assignee}.', 'teams'),
  ('example-subtasks-done-1', 'example-subtasks-done', 1, 'transition', NULL, 'category:DONE', NULL),
  ('example-overdue-monday-1', 'example-overdue-monday', 1, 'notify', 'assignee', 'Your overdue work items', 'bell,email');

-- ---------- permissions ----------
-- "Share filters and dashboards" (share_searches): Admin, Manager, Team Leader, Projects Assistant.
-- "Manage automation" (manage_automation): Admin and Team Leader. Saved roles get the defaults added.
DO $$
DECLARE
  matrix JSONB;
  role TEXT;
BEGIN
  SELECT value::jsonb INTO matrix FROM settings WHERE key = 'role_permissions';
  IF matrix IS NULL THEN RETURN; END IF;
  FOREACH role IN ARRAY ARRAY['manager', 'team_lead', 'assistant'] LOOP
    IF matrix ? role THEN matrix := jsonb_set(matrix, ARRAY[role], (matrix -> role) || '["share_searches"]'::jsonb); END IF;
  END LOOP;
  IF matrix ? 'team_lead' THEN matrix := jsonb_set(matrix, ARRAY['team_lead'], (matrix -> 'team_lead') || '["manage_automation"]'::jsonb); END IF;
  UPDATE settings SET value = matrix::text WHERE key = 'role_permissions';
END $$;
