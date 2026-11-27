-- Update requests: how the person asking chose to reach the team ("chat,email,teams", comma-separated).
-- Requests made before this have none recorded.
ALTER TABLE requests ADD COLUMN via TEXT;
