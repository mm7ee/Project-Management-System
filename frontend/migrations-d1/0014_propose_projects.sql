-- Anyone with an idea (managers, team leaders, assistants, developers) may propose a project
-- with a Project Concept Note by default, like a fresh database. Standard users may not.
-- Roles missing from the saved matrix already fall back to these defaults.
UPDATE settings SET value = json_insert(value, '$.manager[#]', 'propose_projects')
WHERE key = 'role_permissions' AND json_type(value, '$.manager') = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.manager') WHERE value = 'propose_projects');

UPDATE settings SET value = json_insert(value, '$.developer[#]', 'propose_projects')
WHERE key = 'role_permissions' AND json_type(value, '$.developer') = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.developer') WHERE value = 'propose_projects');

UPDATE settings SET value = json_insert(value, '$.team_lead[#]', 'propose_projects')
WHERE key = 'role_permissions' AND json_type(value, '$.team_lead') = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.team_lead') WHERE value = 'propose_projects');

UPDATE settings SET value = json_insert(value, '$.assistant[#]', 'propose_projects')
WHERE key = 'role_permissions' AND json_type(value, '$.assistant') = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.assistant') WHERE value = 'propose_projects');
