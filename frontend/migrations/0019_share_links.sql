-- View-only share links: an administrator creates a link (with an expiry) that lets someone
-- without an account browse OmniTrack read-only. Only a hash of the link's secret is stored.
CREATE TABLE share_links (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,              -- who or what it's for ("Board meeting", "Exco")
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_used_at TEXT,
  views        INTEGER NOT NULL DEFAULT 0
);
