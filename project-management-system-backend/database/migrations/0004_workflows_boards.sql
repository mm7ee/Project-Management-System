-- Workflows and boards (upgrade Phase 2). Statuses are one shared list (work_statuses), each in a
-- category. A workflow uses some of them, with the transitions allowed between them; each transition's
-- conditions, validators and post-functions are rows in workflow_rules. Workspaces are given a workflow,
-- and a project can use a different one. Boards (one per project, one per workspace) have columns, each
-- showing one or more statuses, with an optional work-in-progress limit.

-- ---------- statuses ----------
ALTER TABLE work_statuses ADD COLUMN created_at TEXT;
UPDATE work_statuses SET created_at = '2026-11-17T00:00:00.000Z';
ALTER TABLE work_statuses ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE work_statuses ADD CONSTRAINT work_statuses_name UNIQUE (name);
INSERT INTO work_statuses (id, name, category, position, created_at) VALUES
  ('BACKLOG', 'Backlog', 'TODO', 10, '2026-11-17T00:00:00.000Z'),
  ('TESTING', 'Testing', 'IN_PROGRESS', 11, '2026-11-17T00:00:00.000Z'),
  ('CHANGE_APPROVAL', 'Change Approval', 'IN_PROGRESS', 12, '2026-11-17T00:00:00.000Z'),
  ('DEPLOYED', 'Deployed', 'DONE', 13, '2026-11-17T00:00:00.000Z'),
  ('CLOSED', 'Closed', 'DONE', 14, '2026-11-17T00:00:00.000Z');

-- ---------- workflows ----------
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_default  INTEGER NOT NULL DEFAULT 0,                 -- used wherever nothing else is chosen
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX workflows_one_default ON workflows (is_default) WHERE is_default = 1;

CREATE TABLE workflow_statuses (
  workflow_id TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  status_id   TEXT NOT NULL REFERENCES work_statuses (id),
  position    INTEGER NOT NULL,
  is_initial  INTEGER NOT NULL DEFAULT 0,                 -- where new work items start
  PRIMARY KEY (workflow_id, status_id)
);
CREATE UNIQUE INDEX workflow_statuses_one_initial ON workflow_statuses (workflow_id) WHERE is_initial = 1;
CREATE INDEX workflow_statuses_status ON workflow_statuses (status_id);

-- from_status NULL: the move can be made from any status.
CREATE TABLE workflow_transitions (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  from_status TEXT REFERENCES work_statuses (id),
  to_status   TEXT NOT NULL REFERENCES work_statuses (id),
  position    INTEGER NOT NULL,
  UNIQUE NULLS NOT DISTINCT (workflow_id, from_status, to_status)
);
CREATE INDEX workflow_transitions_workflow ON workflow_transitions (workflow_id, from_status);

-- kind 'condition': who may make the move (rule 'role' with a role, 'assignee_only', 'reporter_only').
-- kind 'validator': what must be true first ('comment_required', 'assignee_set', 'field_filled' with a field,
--   'subtasks_done').
-- kind 'post_function': what happens afterwards ('assign_user' with a user id, 'assign_role' with a role,
--   'assign_reporter', 'clear_assignee', 'set_resolution' with DONE or WONT_DO, 'notify' with watchers,
--   assignee, reporter or role:<role>).
CREATE TABLE workflow_rules (
  id            BIGSERIAL PRIMARY KEY,
  transition_id TEXT NOT NULL REFERENCES workflow_transitions (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('condition', 'validator', 'post_function')),
  rule          TEXT NOT NULL,
  value         TEXT
);
CREATE INDEX workflow_rules_transition ON workflow_rules (transition_id);

-- Which workflow each workspace uses (none listed: the default). A project may use its own.
CREATE TABLE workspace_workflows (
  workspace   TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows (id)
);
ALTER TABLE systems ADD COLUMN workflow_id TEXT REFERENCES workflows (id);
CREATE INDEX systems_workflow ON systems (workflow_id);

-- a) Default: To Do → In Progress → In Review → Done; any status can go back to To Do.
INSERT INTO workflows (id, name, description, is_default, created_at, updated_at) VALUES
  ('default', 'Default', 'To Do → In Progress → In Review → Done. Any status can go back to To Do.', 1, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z');
INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES
  ('default', 'TODO', 1, 1), ('default', 'IN_PROGRESS', 2, 0), ('default', 'IN_REVIEW', 3, 0), ('default', 'DONE', 4, 0);
INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES
  ('default-start', 'default', 'Start work', 'TODO', 'IN_PROGRESS', 1),
  ('default-review', 'default', 'Send for review', 'IN_PROGRESS', 'IN_REVIEW', 2),
  ('default-done', 'default', 'Done', 'IN_REVIEW', 'DONE', 3),
  ('default-reopen', 'default', 'Back to To Do', NULL, 'TODO', 4);

-- b) Infrastructure deployment: Backlog → In Progress → Testing → Change Approval → Deployed → Closed.
-- Only a Manager may deploy, with a comment; failed tests and rejected changes go back to In Progress.
INSERT INTO workflows (id, name, description, is_default, created_at, updated_at) VALUES
  ('infra-deploy', 'Infrastructure deployment', 'Backlog → In Progress → Testing → Change Approval → Deployed → Closed. Only a Manager deploys, with a comment.', 0, '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z');
INSERT INTO workflow_statuses (workflow_id, status_id, position, is_initial) VALUES
  ('infra-deploy', 'BACKLOG', 1, 1), ('infra-deploy', 'IN_PROGRESS', 2, 0), ('infra-deploy', 'TESTING', 3, 0),
  ('infra-deploy', 'CHANGE_APPROVAL', 4, 0), ('infra-deploy', 'DEPLOYED', 5, 0), ('infra-deploy', 'CLOSED', 6, 0);
INSERT INTO workflow_transitions (id, workflow_id, name, from_status, to_status, position) VALUES
  ('infra-start', 'infra-deploy', 'Start work', 'BACKLOG', 'IN_PROGRESS', 1),
  ('infra-test', 'infra-deploy', 'Ready for testing', 'IN_PROGRESS', 'TESTING', 2),
  ('infra-fail', 'infra-deploy', 'Failed testing', 'TESTING', 'IN_PROGRESS', 3),
  ('infra-approval', 'infra-deploy', 'Request change approval', 'TESTING', 'CHANGE_APPROVAL', 4),
  ('infra-reject', 'infra-deploy', 'Reject change', 'CHANGE_APPROVAL', 'IN_PROGRESS', 5),
  ('infra-deploy', 'infra-deploy', 'Deploy', 'CHANGE_APPROVAL', 'DEPLOYED', 6),
  ('infra-close', 'infra-deploy', 'Close', 'DEPLOYED', 'CLOSED', 7);
INSERT INTO workflow_rules (transition_id, kind, rule, value) VALUES
  ('infra-reject', 'validator', 'comment_required', NULL),
  ('infra-deploy', 'condition', 'role', 'manager'),
  ('infra-deploy', 'validator', 'comment_required', NULL),
  ('infra-deploy', 'post_function', 'notify', 'watchers'),
  ('infra-close', 'post_function', 'set_resolution', 'DONE');

-- ---------- boards ----------
CREATE TABLE boards (
  id         TEXT PRIMARY KEY,
  system_id  TEXT UNIQUE REFERENCES systems (id) ON DELETE CASCADE, -- a project's board
  workspace  TEXT UNIQUE,                                             -- or a workspace's, across its projects
  name       TEXT NOT NULL,
  swimlanes  TEXT NOT NULL DEFAULT 'none' CHECK (swimlanes IN ('none', 'assignee', 'epic', 'priority')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((system_id IS NULL) <> (workspace IS NULL))
);

CREATE TABLE board_columns (
  id        TEXT PRIMARY KEY,
  board_id  TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL,
  wip_limit INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0)
);
CREATE INDEX board_columns_board ON board_columns (board_id, position);

-- A status shows in at most one column of a board.
CREATE TABLE board_column_statuses (
  board_id  TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES board_columns (id) ON DELETE CASCADE,
  status_id TEXT NOT NULL REFERENCES work_statuses (id) ON DELETE CASCADE,
  PRIMARY KEY (board_id, status_id)
);
CREATE INDEX board_column_statuses_column ON board_column_statuses (column_id);

-- Boards look for blocked items: links pointing at an item.
CREATE INDEX work_item_links_to_type ON work_item_links (to_id, link_type);

-- ---------- feature requests: "Testing" is any in-progress status named for review or testing ----------
DROP VIEW features;
CREATE VIEW features AS
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
  s.key || '-' || w.number AS item_key
FROM work_items w
JOIN work_statuses st ON st.id = w.status
JOIN systems s ON s.id = w.system_id
WHERE w.source = 'client_request';

-- ---------- permissions ----------
-- "Edit workflows" (manage_workflows) defaults to Admin and Team Leader; saved roles get the default added.
DO $$
DECLARE
  matrix JSONB;
BEGIN
  SELECT value::jsonb INTO matrix FROM settings WHERE key = 'role_permissions';
  IF matrix IS NULL THEN RETURN; END IF;
  IF matrix ? 'team_lead' THEN
    matrix := jsonb_set(matrix, ARRAY['team_lead'], (matrix -> 'team_lead') || '["manage_workflows"]'::jsonb);
  END IF;
  UPDATE settings SET value = matrix::text WHERE key = 'role_permissions';
END $$;
