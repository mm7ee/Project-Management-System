-- Self-service password reset. Every "Forgot your password?" request is one row, kept 24 hours, so
-- the per-address and per-account limits hold across every copy of the Worker. A row with a
-- token_hash is an emailed link: only its SHA-256 is stored, it works once, and only until expires_at.
CREATE TABLE password_resets (
  id         TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,          -- milliseconds since 1970
  login      TEXT NOT NULL,            -- as typed, lower-cased (may not be a real account)
  user_id    TEXT,                     -- the account, when it matched one
  ip         TEXT,                     -- cf-connecting-ip
  outcome    TEXT NOT NULL,            -- emailed | admins_told | limited | unknown
  token_hash TEXT UNIQUE,              -- emailed links only
  expires_at BIGINT,
  used_at    BIGINT
);
CREATE INDEX password_resets_ip ON password_resets (ip, created_at);
CREATE INDEX password_resets_user ON password_resets (user_id, created_at);
CREATE INDEX password_resets_created ON password_resets (created_at);
