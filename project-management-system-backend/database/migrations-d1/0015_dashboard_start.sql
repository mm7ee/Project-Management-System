-- The new analytical Dashboard becomes everyone's landing page. "All projects" was the old
-- default start, so people still on it move to the Dashboard; any other choice is kept.
UPDATE users SET prefs = json_set(prefs, '$.start', 'DASHBOARD')
WHERE json_valid(prefs) AND json_extract(prefs, '$.start') = 'ALL';
