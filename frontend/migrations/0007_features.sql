-- Feature requests from clients, on any project (in progress or already delivered).
CREATE TABLE features (
  id           TEXT PRIMARY KEY,
  system_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL,
  client       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL,
  priority     TEXT NOT NULL,
  assignee     TEXT,          -- a developer's user id
  notes        TEXT,          -- the developer's notes: blockers, what's needed
  due_at       TEXT,          -- expected delivery date
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX features_system ON features (system_id);
CREATE INDEX features_assignee ON features (assignee);

-- Managers may log and assign feature requests by default, like a fresh database.
UPDATE settings
SET value = json_insert(value, '$.manager[#]', 'manage_features')
WHERE key = 'role_permissions'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.manager') WHERE value = 'manage_features');
