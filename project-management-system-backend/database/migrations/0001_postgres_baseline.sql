-- Pulse on Postgres: the starting point, matching the D1 database after its 20 migrations
-- (migrations-d1/0001 to 0020). Later changes go in new numbered files after this one; apply them
-- with `npm run db:migrate` (live) or `npm run db:migrate:dev` (the Neon dev branch).
--
-- Kept as in D1 so the Worker's queries behave the same:
--   * dates and times are ISO-8601 text ("2026-11-16T09:00:00.000Z"), which sorts and compares correctly;
--   * expiry times are milliseconds since 1970, as BIGINT;
--   * yes/no flags are 0/1 integers;
--   * `rowid` on systems and password_history keeps the order rows were added, as SQLite's rowid did.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  title                TEXT NOT NULL DEFAULT '',
  email                TEXT,
  phone                TEXT,
  role                 TEXT NOT NULL,
  project_id           TEXT,                       -- unused since developers can be on several projects (assignments)
  password_hash        TEXT NOT NULL,
  prefs                TEXT NOT NULL DEFAULT '{}',
  must_change_password INTEGER NOT NULL DEFAULT 0, -- 1 reset by an admin, 2 no longer meets the password policy
  mfa_secret           TEXT,
  mfa_pending          TEXT,
  mfa_last_step        BIGINT NOT NULL DEFAULT 0,
  mfa_enabled_at       TEXT
);
-- Usernames are unique whatever their case, as COLLATE NOCASE made them in D1.
CREATE UNIQUE INDEX users_username ON users (lower(username));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE systems (
  rowid BIGSERIAL NOT NULL,
  id    TEXT PRIMARY KEY,
  sort  INTEGER NOT NULL DEFAULT 0,
  data  TEXT NOT NULL                              -- the project as JSON (see src/data/systems.ts)
);
CREATE INDEX systems_order ON systems (sort, rowid);

CREATE TABLE assignments (
  user_id   TEXT NOT NULL,
  system_id TEXT NOT NULL,
  PRIMARY KEY (user_id, system_id)
);
CREATE INDEX assignments_system ON assignments (system_id);

CREATE TABLE requests (
  id           TEXT PRIMARY KEY,
  system_id    TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  message      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE TABLE activity (
  id      BIGSERIAL PRIMARY KEY,
  at      TEXT NOT NULL,
  user_id TEXT,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  detail  TEXT NOT NULL DEFAULT '{}',
  ip      TEXT,
  agent   TEXT
);
CREATE INDEX activity_at ON activity (at);
CREATE INDEX activity_user_action ON activity (user_id, action);

CREATE TABLE features (
  id           TEXT PRIMARY KEY,
  system_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL,
  client       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL,
  priority     TEXT NOT NULL,
  assignee     TEXT,
  notes        TEXT,
  due_at       TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX features_assignee ON features (assignee);
CREATE INDEX features_system ON features (system_id);

CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  system_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  url         TEXT,
  mime        TEXT,
  size        BIGINT,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX documents_system ON documents (system_id);

CREATE TABLE document_chunks (
  doc_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  data   BYTEA NOT NULL,
  PRIMARY KEY (doc_id, seq)
);

CREATE TABLE blockers (
  id          TEXT PRIMARY KEY,
  system_id   TEXT NOT NULL,
  text        TEXT NOT NULL,
  raised_by   TEXT NOT NULL,
  raised_at   TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution  TEXT
);
CREATE INDEX blockers_system ON blockers (system_id);

CREATE TABLE mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mfa_recovery (
  user_id   TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used_at   TEXT,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE mfa_help_requests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  ip         TEXT,
  status     TEXT NOT NULL DEFAULT 'OPEN',       -- OPEN | RESOLVED | DISMISSED
  handled_by TEXT,
  handled_at TEXT
);
CREATE INDEX mfa_help_open ON mfa_help_requests (status, created_at);

CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,                 -- credential id, base64url
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  public_key   TEXT NOT NULL,                    -- SubjectPublicKeyInfo, base64url
  alg          INTEGER NOT NULL,                 -- COSE algorithm: -7 ES256, -257 RS256
  sign_count   BIGINT NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys (user_id);

CREATE TABLE webauthn_challenges (
  challenge   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  purpose     TEXT NOT NULL,                     -- 'register' | 'login'
  ticket_hash TEXT,
  expires_at  BIGINT NOT NULL
);

CREATE TABLE password_history (
  rowid      BIGSERIAL NOT NULL,
  user_id    TEXT NOT NULL,
  hash       TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX password_history_user ON password_history (user_id, changed_at);

CREATE TABLE templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL,
  created_by TEXT,                               -- NULL for the built-in templates
  created_at TEXT NOT NULL
);

CREATE TABLE share_links (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_used_at TEXT,
  views        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  digest     TEXT,
  dedupe     TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_once ON notifications (user_id, dedupe);
