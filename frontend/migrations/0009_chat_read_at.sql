-- Chat: when each person last read a conversation, so someone reading it as messages arrive isn't also
-- notified under the bell.
ALTER TABLE chat_members ADD COLUMN read_at TEXT;
