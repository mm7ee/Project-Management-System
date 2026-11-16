-- Audit trail: sign-ins (including failed ones), sign-outs and every change made through the API.
CREATE TABLE activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,           -- ISO time
  user_id TEXT,                    -- who did it (null for an unknown username at sign-in)
  actor   TEXT NOT NULL,           -- their name at the time, or the username that was tried
  action  TEXT NOT NULL,           -- e.g. login, login_failed, system_progress, user_password_reset
  target  TEXT,                    -- the system or user acted on
  detail  TEXT NOT NULL DEFAULT '{}', -- JSON: names and before/after values, kept even if the target is deleted
  ip      TEXT,
  agent   TEXT                     -- browser user-agent
);
CREATE INDEX activity_at ON activity (at);
CREATE INDEX activity_user_action ON activity (user_id, action);
