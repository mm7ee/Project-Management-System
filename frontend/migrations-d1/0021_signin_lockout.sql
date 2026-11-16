-- Sign-in lockout (upgrade Phase 0). Every failed password (and wrong two-step code) is one row
-- here, so the limits hold across every copy of the Worker. Rows are removed after 24 hours.
CREATE TABLE login_failures (
  id       TEXT PRIMARY KEY,
  at       INTEGER NOT NULL,             -- milliseconds since 1970
  username TEXT NOT NULL,                -- as typed, lower-cased (may not be a real account)
  user_id  TEXT,                         -- the account, when the username exists
  ip       TEXT,                         -- cf-connecting-ip
  reason   TEXT NOT NULL DEFAULT 'password' -- password | two_step | locked | address
);
CREATE INDEX login_failures_user ON login_failures (user_id, at);
CREATE INDEX login_failures_ip ON login_failures (ip, at);
CREATE INDEX login_failures_at ON login_failures (at);

-- A locked account: refused until locked_until (milliseconds) has passed, or an administrator unlocks it.
ALTER TABLE users ADD COLUMN locked_until INTEGER;
ALTER TABLE users ADD COLUMN locked_at TEXT;
