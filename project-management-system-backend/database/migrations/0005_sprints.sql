-- Sprints (upgrade Phase 3). A project works in Kanban (the default) or Scrum. Scrum projects plan
-- sprints from a ranked backlog; sprint_items records when each item joined or left a sprint, and a
-- completed sprint keeps a snapshot of its numbers. The timeline and reports read these and Phase 1's
-- status_history; they add no tables of their own.

ALTER TABLE systems ADD COLUMN agile_mode TEXT NOT NULL DEFAULT 'kanban' CHECK (agile_mode IN ('kanban', 'scrum'));

CREATE TABLE sprints (
  id           TEXT PRIMARY KEY,
  system_id    TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  goal         TEXT NOT NULL DEFAULT '',
  start_date   TEXT NOT NULL,                              -- YYYY-MM-DD, the first day
  end_date     TEXT NOT NULL,                              -- YYYY-MM-DD, the last day
  length_weeks INTEGER NOT NULL CHECK (length_weeks BETWEEN 1 AND 4),
  state        TEXT NOT NULL DEFAULT 'FUTURE' CHECK (state IN ('FUTURE', 'ACTIVE', 'CLOSED')),
  started_at   TEXT,
  completed_at TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
-- Only one active sprint per project.
CREATE UNIQUE INDEX sprints_one_active ON sprints (system_id) WHERE state = 'ACTIVE';
CREATE INDEX sprints_system ON sprints (system_id, state, start_date);

ALTER TABLE work_items ADD COLUMN sprint_id TEXT REFERENCES sprints (id) ON DELETE SET NULL;
ALTER TABLE work_items ADD COLUMN backlog_rank DOUBLE PRECISION;   -- smaller is higher in the backlog
CREATE INDEX work_items_sprint ON work_items (sprint_id);
CREATE INDEX work_items_rank ON work_items (system_id, backlog_rank);
-- Existing items are ranked in the order they were created.
UPDATE work_items SET backlog_rank = r.n * 1024
FROM (SELECT id, row_number() OVER (PARTITION BY system_id ORDER BY created_at, id) AS n FROM work_items) r
WHERE r.id = work_items.id;

-- Every item that has been in a sprint: when it joined, whether that was after the sprint started, its
-- story points then, when it left (if it did before the end) and how it ended.
CREATE TABLE sprint_items (
  sprint_id         TEXT NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  item_id           TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  added_at          TEXT NOT NULL,
  added_after_start INTEGER NOT NULL DEFAULT 0,
  points            NUMERIC(6, 1),                           -- story points when added, or at the start
  removed_at        TEXT,
  outcome           TEXT CHECK (outcome IN ('completed', 'not_completed', 'removed')),
  PRIMARY KEY (sprint_id, item_id)
);
CREATE INDEX sprint_items_item ON sprint_items (item_id);

-- A completed sprint's numbers, kept as they were at the end.
CREATE TABLE sprint_snapshots (
  sprint_id            TEXT PRIMARY KEY REFERENCES sprints (id) ON DELETE CASCADE,
  committed_points     NUMERIC(8, 1) NOT NULL,
  completed_points     NUMERIC(8, 1) NOT NULL,
  added_points         NUMERIC(8, 1) NOT NULL,
  removed_points       NUMERIC(8, 1) NOT NULL,
  not_completed_points NUMERIC(8, 1) NOT NULL,
  committed_items      INTEGER NOT NULL,
  completed_items      INTEGER NOT NULL,
  added_items          INTEGER NOT NULL,
  removed_items        INTEGER NOT NULL,
  not_completed_items  INTEGER NOT NULL,
  created_at           TEXT NOT NULL
);

-- Reports replay status history per item and by date.
CREATE INDEX status_history_item_at ON status_history (item_id, changed_at, id);

-- "Plan and run sprints" (manage_sprints) defaults to Admin, Manager and Team Leader.
DO $$
DECLARE
  matrix JSONB;
  role TEXT;
BEGIN
  SELECT value::jsonb INTO matrix FROM settings WHERE key = 'role_permissions';
  IF matrix IS NULL THEN RETURN; END IF;
  FOREACH role IN ARRAY ARRAY['manager', 'team_lead'] LOOP
    IF matrix ? role THEN
      matrix := jsonb_set(matrix, ARRAY[role], (matrix -> role) || '["manage_sprints"]'::jsonb);
    END IF;
  END LOOP;
  UPDATE settings SET value = matrix::text WHERE key = 'role_permissions';
END $$;
