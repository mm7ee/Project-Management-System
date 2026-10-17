-- Other ways through two-step verification: passkeys / security keys as a second method, and
-- requests for an administrator's help when every method is lost.

-- A passkey or security key (WebAuthn). Its public key only: the private key never leaves the device.
CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,           -- credential id, base64url
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,              -- what the user called it ("Work laptop", "YubiKey")
  public_key   TEXT NOT NULL,              -- SubjectPublicKeyInfo, base64url
  alg          INTEGER NOT NULL,           -- COSE algorithm: -7 ES256, -257 RS256
  sign_count   INTEGER NOT NULL DEFAULT 0, -- last signature counter seen, to spot cloned keys
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- One-time WebAuthn challenges: adding a passkey (signed in) or using one at sign-in (tied to
-- the password step's ticket).
CREATE TABLE webauthn_challenges (
  challenge   TEXT PRIMARY KEY,            -- base64url
  user_id     TEXT NOT NULL,
  purpose     TEXT NOT NULL,               -- 'register' | 'login'
  ticket_hash TEXT,                        -- sign-in only
  expires_at  INTEGER NOT NULL
);

-- "I've lost every way to verify": raised from the sign-in screen after the right password, and
-- handled by an administrator, who checks who it is before resetting two-step verification.
CREATE TABLE mfa_help_requests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  ip         TEXT,
  status     TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | RESOLVED | DISMISSED
  handled_by TEXT,
  handled_at TEXT
);
CREATE INDEX mfa_help_open ON mfa_help_requests (status, created_at);
