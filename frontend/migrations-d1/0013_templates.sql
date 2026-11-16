-- Project templates for "Add system": a template prefills the form (see src/data/templates.ts).
-- Five starters below; people who can add systems can save their own and delete any.
CREATE TABLE templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL, -- {"description", "status", "progress", "durationWeeks"?}
  created_by  TEXT,          -- NULL for the built-in starters
  created_at  TEXT NOT NULL
);

INSERT INTO templates (id, name, summary, data, created_at) VALUES
('web-application', 'Web application',
 'A new system staff or clients use in the browser, built from scratch.',
 '{"description":"Purpose: \nWho uses it: \nKey features: \n- \n- \nOut of scope: ","status":"UPCOMING","progress":0,"durationWeeks":12}',
 '2026-10-15T00:00:00Z'),
('internal-tool', 'Internal tool or dashboard',
 'A smaller tool, report or dashboard for one team.',
 '{"description":"Team it serves: \nProblem it solves: \nData it uses: \nMust have: ","status":"UPCOMING","progress":0,"durationWeeks":6}',
 '2026-10-15T00:00:00Z'),
('integration', 'Integration or API',
 'Connecting two systems, or exposing data to another system.',
 '{"description":"Systems involved: \nData exchanged: \nDirection and frequency: \nOwner on the other side: ","status":"UPCOMING","progress":0,"durationWeeks":4}',
 '2026-10-15T00:00:00Z'),
('upgrade', 'Upgrade of an existing system',
 'A major new version or rebuild of a system already in use.',
 '{"description":"System being upgraded: \nWhat changes: \nDowntime or migration needed: \nRollback plan: ","status":"WIP","progress":0,"durationWeeks":8}',
 '2026-10-15T00:00:00Z'),
('idea', 'Idea or proposal',
 'Capture an idea before it is planned or scheduled.',
 '{"description":"The idea: \nWho asked for it: \nExpected benefit: ","status":"IDEA","progress":0}',
 '2026-10-15T00:00:00Z');
