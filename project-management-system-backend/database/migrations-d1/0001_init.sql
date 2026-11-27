-- OmniTrack schema. Systems are stored as JSON (the System type in src/data/systems.ts).

CREATE TABLE systems (
  id   TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  email         TEXT,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'developer', 'viewer')),
  project_id    TEXT, -- developers only: the one project they work on
  password_hash TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE requests (
  id           TEXT PRIMARY KEY,
  system_id    TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  message      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
