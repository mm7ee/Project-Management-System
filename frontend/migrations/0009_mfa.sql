-- Two-step verification with an authenticator app (TOTP). Secrets are AES-GCM encrypted with
-- the Worker's MFA_KEY secret before they reach this table.
ALTER TABLE users ADD COLUMN mfa_secret TEXT;      -- set once two-step verification is on
ALTER TABLE users ADD COLUMN mfa_pending TEXT;     -- secret shown during setup, until confirmed
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT 0; -- last code used, so it can't be replayed
ALTER TABLE users ADD COLUMN mfa_enabled_at TEXT;

-- Single-use recovery codes (SHA-256 hashes), for a lost phone.
CREATE TABLE mfa_recovery (
  user_id   TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used_at   TEXT,
  PRIMARY KEY (user_id, code_hash)
);

-- A password that checked out, waiting for its code. Short-lived, a few attempts only.
CREATE TABLE mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
