-- The plain dark theme was retired; the futuristic theme is now the one called "Dark".
UPDATE users SET prefs = json_set(prefs, '$.theme', 'futuristic') WHERE json_valid(prefs) AND json_extract(prefs, '$.theme') = 'dark';
