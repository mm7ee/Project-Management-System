-- Password policy (ISO 27001 A.5.17): a new password can't reuse a recent one. Earlier hashes
-- are kept here (salted PBKDF2, like users.password_hash), the four most recent per person.
CREATE TABLE password_history (
  user_id    TEXT NOT NULL,
  hash       TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX password_history_user ON password_history (user_id, changed_at);
