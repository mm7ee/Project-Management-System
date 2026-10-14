-- Developers can now work on several projects. Each row assigns one developer to one project,
-- replacing users.project_id (kept, unused, so an older Worker still runs during a deploy).
CREATE TABLE assignments (
  user_id   TEXT NOT NULL,
  system_id TEXT NOT NULL,
  PRIMARY KEY (user_id, system_id)
);
CREATE INDEX assignments_system ON assignments (system_id);

INSERT INTO assignments (user_id, system_id)
SELECT id, project_id FROM users WHERE role = 'developer' AND project_id IS NOT NULL;
