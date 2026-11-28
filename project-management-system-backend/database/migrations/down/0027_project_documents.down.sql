-- Reverses 0027_project_documents.sql. Documents submitted from PMS stay in the project's documents (as links).
DELETE FROM test_runs WHERE result = 'waived';
ALTER TABLE test_runs DROP CONSTRAINT test_runs_result_check;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_result_check CHECK (result IN ('pass', 'fail', 'blocked'));
ALTER TABLE test_cases DROP COLUMN scenario, DROP COLUMN assignee_id;
DROP TABLE project_documents;
DROP FUNCTION project_documents_frozen();
ALTER TABLE stage_records DROP CONSTRAINT stage_records_data_check;
ALTER TABLE stage_records ADD CONSTRAINT stage_records_data_check CHECK (left(data, 1) = '{' AND length(data) <= 20000);
