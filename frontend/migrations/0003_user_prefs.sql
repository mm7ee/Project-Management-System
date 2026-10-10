-- Per-user display preferences (theme, motion, density, start section) as JSON.
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
