-- Reverses 0026_omnicontact_lifecycle.sql: Omnicontact's projects leave the lifecycle (their history with them), its
-- template goes, and the mapping function is dropped. The one status the migration corrected (Testing → Live, for a
-- project delivered at 100%) is put back.
UPDATE systems s SET data = jsonb_set(s.data::jsonb, '{status}', '"TESTING"')::text
FROM project_stage_history h
WHERE h.system_id = s.id AND h.kind = 'migrate' AND h.reason LIKE 'Marked Testing but delivered%';
DELETE FROM project_stage_history WHERE system_id IN (SELECT system_id FROM project_lifecycle WHERE template_id = '0a1fec7c1e000016');
DELETE FROM project_lifecycle WHERE template_id = '0a1fec7c1e000016';
DELETE FROM lifecycle_stages WHERE template_id = '0a1fec7c1e000016';
DELETE FROM lifecycle_templates WHERE id = '0a1fec7c1e000016';
DROP FUNCTION lifecycle_map_projects(TEXT, TEXT);
