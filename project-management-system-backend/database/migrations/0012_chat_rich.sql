-- Chat: files, GIFs, stickers, reactions, replies and pins (2026-11-25).

-- What a message carries besides its words: a GIF ({"gif": {...}}) or a sticker ({"sticker": "<id>"}). JSON text.
ALTER TABLE chat_messages ADD COLUMN meta TEXT;
-- The message this one replies to (same conversation).
ALTER TABLE chat_messages ADD COLUMN reply_to BIGINT;
-- Pinned to the conversation, and by whom.
ALTER TABLE chat_messages ADD COLUMN pinned_at TEXT;
ALTER TABLE chat_messages ADD COLUMN pinned_by TEXT;
CREATE INDEX chat_messages_pinned ON chat_messages (conversation_id, pinned_at) WHERE pinned_at IS NOT NULL;

-- Files sent in chat. Uploaded first (message_id NULL), then attached when the message is sent.
-- Stored in 1 MB chunks, like project documents.
CREATE TABLE chat_files (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  message_id      BIGINT REFERENCES chat_messages (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size            BIGINT NOT NULL,
  uploaded_by     TEXT NOT NULL,
  uploaded_at     TEXT NOT NULL
);
CREATE INDEX chat_files_message ON chat_files (message_id);
CREATE INDEX chat_files_pending ON chat_files (uploaded_at) WHERE message_id IS NULL;

CREATE TABLE chat_file_chunks (
  file_id TEXT NOT NULL REFERENCES chat_files (id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  data    BYTEA NOT NULL,
  PRIMARY KEY (file_id, seq)
);

-- One row per person per emoji per message.
CREATE TABLE chat_reactions (
  message_id BIGINT NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
