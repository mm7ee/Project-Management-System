-- New roles: Team Leader (team_lead) and Projects Assistant (assistant). The old CHECK on
-- users.role only allowed the first four, and SQLite can't alter a CHECK, so the table is
-- rebuilt without it. The Worker validates roles against ROLES in src/data/roles.ts.
CREATE TABLE users_new (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT NOT NULL,
  title                TEXT NOT NULL DEFAULT '',
  email                TEXT,
  phone                TEXT,
  role                 TEXT NOT NULL,
  project_id           TEXT, -- unused since 0006 (assignments table)
  password_hash        TEXT NOT NULL,
  prefs                TEXT NOT NULL DEFAULT '{}',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  mfa_secret           TEXT,
  mfa_pending          TEXT,
  mfa_last_step        INTEGER NOT NULL DEFAULT 0,
  mfa_enabled_at       TEXT
);

INSERT INTO users_new (id, username, name, title, email, phone, role, project_id, password_hash, prefs,
                       must_change_password, mfa_secret, mfa_pending, mfa_last_step, mfa_enabled_at)
SELECT id, username, name, title, email, phone, role, project_id, password_hash, prefs,
       must_change_password, mfa_secret, mfa_pending, mfa_last_step, mfa_enabled_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
