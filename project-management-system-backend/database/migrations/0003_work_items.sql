-- Work items (upgrade Phase 1): project keys, Jira-style numbered work items with a hierarchy,
-- statuses kept in categories, labels, status history, comments, watchers, links, attachments
-- and time tracking. Feature requests become work items (source 'client_request'); the old
-- `features` table is replaced by a view of the same name and shape, so everything that reads
-- feature requests keeps working.

-- ---------- statuses ----------
-- Phase 2 makes these configurable; every status belongs to one of three categories from the start.
CREATE TABLE work_statuses (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('TODO', 'IN_PROGRESS', 'DONE')),
  position INTEGER NOT NULL
);
INSERT INTO work_statuses (id, name, category, position) VALUES
  ('TODO', 'To Do', 'TODO', 1),
  ('IN_PROGRESS', 'In Progress', 'IN_PROGRESS', 2),
  ('IN_REVIEW', 'In Review', 'IN_PROGRESS', 3),
  ('DONE', 'Done', 'DONE', 4);

-- ---------- project keys ----------
ALTER TABLE systems ADD COLUMN key TEXT;
ALTER TABLE systems ADD COLUMN item_seq INTEGER NOT NULL DEFAULT 0;           -- the last work item number used
ALTER TABLE systems ADD COLUMN progress_from_items INTEGER NOT NULL DEFAULT 0; -- 1: progress = share of work items done

-- A key for every existing project, the same way the app suggests one (src/data/workitems.ts,
-- suggestKey): the initials of a name of several words, or the first five letters of a one-word
-- name; a letter is added when the key is already taken.
DO $$
DECLARE
  r     RECORD;
  words TEXT[];
  kept  TEXT[];
  w     TEXT;
  base  TEXT;
  cand  TEXT;
  n     INTEGER;
BEGIN
  FOR r IN SELECT id, data FROM systems ORDER BY sort, rowid LOOP
    words := ARRAY(SELECT x FROM regexp_split_to_table(upper(COALESCE(r.data::json ->> 'name', '')), '[^A-Z]+') AS x WHERE x <> '');
    kept := ARRAY(SELECT x FROM unnest(words) AS x WHERE x NOT IN ('A', 'AN', 'AND', 'FOR', 'IN', 'OF', 'ON', 'THE', 'TO', 'WITH'));
    IF COALESCE(array_length(kept, 1), 0) >= 2 THEN words := kept; END IF;
    IF COALESCE(array_length(words, 1), 0) >= 2 THEN
      base := '';
      FOREACH w IN ARRAY words LOOP base := base || left(w, 1); END LOOP;
      base := left(base, 10);
    ELSIF COALESCE(array_length(words, 1), 0) = 1 THEN
      base := left(words[1], 5);
      IF length(base) < 2 THEN base := rpad(base, 2, 'X'); END IF;
    ELSE
      base := 'PRJ';
    END IF;
    cand := base;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM systems WHERE key = cand) LOOP
      n := n + 1;
      cand := CASE WHEN n <= 26 THEN left(base, 9) || chr(64 + n)
                   ELSE left(base, 8) || chr(64 + (n - 1) / 26) || chr(65 + (n - 1) % 26) END;
    END LOOP;
    UPDATE systems SET key = cand WHERE id = r.id;
  END LOOP;
END $$;
ALTER TABLE systems ALTER COLUMN key SET NOT NULL;
ALTER TABLE systems ADD CONSTRAINT systems_key_format CHECK (key ~ '^[A-Z]{2,10}$');
CREATE UNIQUE INDEX systems_key ON systems (key);

-- ---------- work items ----------
CREATE TABLE work_items (
  id                 TEXT PRIMARY KEY,
  system_id          TEXT NOT NULL REFERENCES systems (id) ON DELETE CASCADE,
  number             INTEGER NOT NULL,                       -- KEY-number
  type               TEXT NOT NULL CHECK (type IN ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK')),
  parent_id          TEXT REFERENCES work_items (id) ON DELETE SET NULL,
  summary            TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',               -- Markdown
  status             TEXT NOT NULL REFERENCES work_statuses (id),
  resolution         TEXT CHECK (resolution IN ('DONE', 'WONT_DO')), -- set while the status is in the Done category
  on_hold            INTEGER NOT NULL DEFAULT 0,             -- flagged: work is paused
  priority           TEXT NOT NULL CHECK (priority IN ('HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST')),
  assignee           TEXT,
  reporter           TEXT NOT NULL,
  component          TEXT,
  story_points       NUMERIC(6, 1),
  original_estimate  INTEGER,                                -- minutes
  remaining_estimate INTEGER,                                -- minutes
  start_date         TEXT,                                   -- YYYY-MM-DD
  due_date           TEXT,                                   -- YYYY-MM-DD
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  resolved_at        TEXT,
  source             TEXT NOT NULL DEFAULT 'internal' CHECK (source IN ('internal', 'client_request')),
  client             TEXT,                                   -- client requests: who asked
  notes              TEXT,                                   -- client requests: the developer's notes
  UNIQUE (system_id, number)
);
CREATE INDEX work_items_system_status ON work_items (system_id, status);
CREATE INDEX work_items_assignee ON work_items (assignee, status);
CREATE INDEX work_items_reporter ON work_items (reporter);
CREATE INDEX work_items_parent ON work_items (parent_id);
CREATE INDEX work_items_updated ON work_items (updated_at);
CREATE INDEX work_items_source ON work_items (source, created_at);
CREATE INDEX work_items_due ON work_items (due_date);

CREATE TABLE work_item_labels (
  item_id TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  label   TEXT NOT NULL,
  PRIMARY KEY (item_id, label)
);
CREATE INDEX work_item_labels_label ON work_item_labels (label);

-- One row for every status change. Phases 3 and 4 read this.
CREATE TABLE status_history (
  id          BIGSERIAL PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  from_status TEXT,                                          -- NULL when the item was created
  to_status   TEXT NOT NULL,
  changed_by  TEXT,
  changed_at  TEXT NOT NULL
);
CREATE INDEX status_history_item ON status_history (item_id, changed_at);
CREATE INDEX status_history_at ON status_history (changed_at);

CREATE TABLE work_item_comments (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL,
  body       TEXT NOT NULL,                                  -- Markdown
  created_at TEXT NOT NULL,
  updated_at TEXT                                            -- set when edited
);
CREATE INDEX work_item_comments_item ON work_item_comments (item_id, created_at);

CREATE TABLE work_item_watchers (
  item_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX work_item_watchers_user ON work_item_watchers (user_id);

-- from blocks to; from relates to to; from duplicates to; from clones to (from is the copy).
CREATE TABLE work_item_links (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  link_type  TEXT NOT NULL CHECK (link_type IN ('BLOCKS', 'RELATES', 'DUPLICATES', 'CLONES')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (from_id, to_id, link_type),
  CHECK (from_id <> to_id)
);
CREATE INDEX work_item_links_to ON work_item_links (to_id);

CREATE TABLE work_logs (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  minutes    INTEGER NOT NULL CHECK (minutes > 0),
  note       TEXT NOT NULL DEFAULT '',
  work_date  TEXT NOT NULL,                                  -- YYYY-MM-DD the work was done
  created_at TEXT NOT NULL
);
CREATE INDEX work_logs_item ON work_logs (item_id, work_date);
CREATE INDEX work_logs_user ON work_logs (user_id, work_date);

-- Attachments are documents that belong to a work item; the project's Documents list leaves them out.
ALTER TABLE documents ADD COLUMN work_item_id TEXT REFERENCES work_items (id) ON DELETE CASCADE;
CREATE INDEX documents_work_item ON documents (work_item_id);

-- ---------- feature requests become work items ----------
-- Nothing may be lost: a request on a project that no longer exists stops the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM features f WHERE NOT EXISTS (SELECT 1 FROM systems s WHERE s.id = f.system_id)) THEN
    RAISE EXCEPTION 'Some feature requests belong to projects that no longer exist; fix them before migrating';
  END IF;
END $$;

INSERT INTO work_items (
  id, system_id, number, type, parent_id, summary, description, status, resolution, on_hold, priority,
  assignee, reporter, due_date, created_at, updated_at, resolved_at, source, client, notes
)
SELECT
  f.id,
  f.system_id,
  row_number() OVER (PARTITION BY f.system_id ORDER BY f.created_at, f.id),
  CASE WHEN f.kind = 'BUG_FIX' THEN 'BUG' ELSE 'STORY' END,
  NULL,
  f.title,
  COALESCE(f.description, ''),
  CASE f.status
    WHEN 'NOT_STARTED' THEN 'TODO'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'ON_HOLD' THEN 'IN_PROGRESS'
    WHEN 'TESTING' THEN 'IN_REVIEW'
    ELSE 'DONE'
  END,
  CASE f.status WHEN 'COMPLETED' THEN 'DONE' WHEN 'CANCELLED' THEN 'WONT_DO' END,
  CASE WHEN f.status = 'ON_HOLD' THEN 1 ELSE 0 END,
  CASE f.priority WHEN 'CRITICAL' THEN 'HIGHEST' ELSE f.priority END,
  f.assignee,
  f.created_by,
  f.due_at,
  f.created_at,
  f.updated_at,
  CASE f.status WHEN 'COMPLETED' THEN COALESCE(f.completed_at, f.updated_at) WHEN 'CANCELLED' THEN f.updated_at END,
  'client_request',
  NULLIF(f.client, ''),
  f.notes
FROM features f;

-- Each keeps its original kind as a label.
INSERT INTO work_item_labels (item_id, label)
SELECT id, CASE kind WHEN 'NEW_MODULE' THEN 'new-module' WHEN 'CHANGE' THEN 'change' WHEN 'ENHANCEMENT' THEN 'enhancement' ELSE 'bug-fix' END
FROM features;

-- The reporter and the assignee watch their items.
INSERT INTO work_item_watchers (item_id, user_id, created_at)
SELECT id, reporter, created_at FROM work_items WHERE source = 'client_request'
UNION
SELECT id, assignee, created_at FROM work_items WHERE source = 'client_request' AND assignee IS NOT NULL;

-- Status history, rebuilt from the activity log where it can be: a feature_updated entry names the
-- project (target) and the request's title at the time, with the status before and after.
CREATE TEMPORARY TABLE feature_status_map (old TEXT PRIMARY KEY, new TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO feature_status_map VALUES
  ('NOT_STARTED', 'TODO'), ('IN_PROGRESS', 'IN_PROGRESS'), ('ON_HOLD', 'IN_PROGRESS'),
  ('TESTING', 'IN_REVIEW'), ('COMPLETED', 'DONE'), ('CANCELLED', 'DONE');

CREATE TEMPORARY TABLE feature_moves ON COMMIT DROP AS
SELECT w.id AS item_id, a.id AS activity_id, a.user_id, a.at,
       fm.new AS from_status, tm.new AS to_status
FROM activity a
JOIN work_items w ON w.source = 'client_request'
  AND a.target = w.system_id
  AND (a.detail::jsonb ->> 'title') = w.summary
JOIN feature_status_map fm ON fm.old = a.detail::jsonb -> 'status' ->> 'from'
JOIN feature_status_map tm ON tm.old = a.detail::jsonb -> 'status' ->> 'to'
WHERE a.action = 'feature_updated' AND a.detail::jsonb -> 'status' IS NOT NULL AND a.at >= w.created_at;

-- Where it was created: the status before the first recorded change, else the status it has now.
INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at)
SELECT w.id, NULL,
       COALESCE((SELECT m.from_status FROM feature_moves m WHERE m.item_id = w.id ORDER BY m.activity_id LIMIT 1), w.status),
       w.reporter, w.created_at
FROM work_items w WHERE w.source = 'client_request';

INSERT INTO status_history (item_id, from_status, to_status, changed_by, changed_at)
SELECT item_id, from_status, to_status, user_id, at FROM feature_moves
WHERE from_status <> to_status
ORDER BY activity_id;

UPDATE systems SET item_seq = COALESCE((SELECT MAX(number) FROM work_items w WHERE w.system_id = systems.id), 0);

DROP TABLE features;

-- Feature requests, as the app has always read them: client requests, in the old columns and values.
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
    WHEN w.status = 'IN_REVIEW' THEN 'TESTING'
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
-- Roles saved in Settings → Roles & permissions keep their choices; the new permissions are added
-- with their defaults (src/data/roles.ts). Roles never saved use the defaults already.
DO $$
DECLARE
  matrix JSONB;
  defaults JSONB := '{
    "manager": ["create_work_items", "edit_work_items", "delete_work_items", "log_time"],
    "team_lead": ["create_work_items", "edit_work_items", "delete_work_items", "log_time"],
    "assistant": ["create_work_items"],
    "developer": ["create_work_items", "log_time"]
  }';
  role TEXT;
BEGIN
  SELECT value::jsonb INTO matrix FROM settings WHERE key = 'role_permissions';
  IF matrix IS NULL THEN RETURN; END IF;
  FOR role IN SELECT jsonb_object_keys(defaults) LOOP
    IF matrix ? role THEN
      matrix := jsonb_set(matrix, ARRAY[role], (matrix -> role) || (defaults -> role));
    END IF;
  END LOOP;
  UPDATE settings SET value = matrix::text WHERE key = 'role_permissions';
END $$;
