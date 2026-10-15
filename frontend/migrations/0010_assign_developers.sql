-- Managers may add and remove developers on projects by default (to rebalance workload),
-- like a fresh database. Administrators always have every permission.
UPDATE settings
SET value = json_insert(value, '$.manager[#]', 'assign_developers')
WHERE key = 'role_permissions'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.manager') WHERE value = 'assign_developers');
