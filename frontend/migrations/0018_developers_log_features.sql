-- Developers may log feature requests (new "log_features" permission). Saved role settings
-- replace a role's whole list, so add it to the developer role where settings were saved.
UPDATE settings
SET value = json_insert(value, '$.developer[#]', 'log_features')
WHERE key = 'role_permissions'
  AND json_type(value, '$.developer') = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.developer') WHERE json_each.value = 'log_features');
