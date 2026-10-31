-- Notifications: what each person sees under the bell. Alerts ("you were assigned this"), the
-- developer's daily digest and the Monday Briefing (their full text is kept in `digest` as JSON).
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- assigned | update_requested | signature | daily_digest | monday_briefing
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,                       -- "#/projects/<id>" or "view:<page>"
  digest     TEXT,
  dedupe     TEXT,                       -- at most one per person, e.g. "daily:2026-11-02"
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_once ON notifications (user_id, dedupe);
