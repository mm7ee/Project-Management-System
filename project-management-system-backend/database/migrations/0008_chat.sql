-- Chat: direct messages between two people, named group chats, and one channel per project.
-- Messages reach people by polling (every few seconds while a conversation is open), so there is
-- no new infrastructure. A message's id orders it; `updated_at` lets a poll pick up edits and deletions.

CREATE TABLE chat_conversations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'project')),
  name            TEXT NOT NULL DEFAULT '',          -- groups only; a project channel shows the project's name
  system_id       TEXT REFERENCES systems (id) ON DELETE CASCADE, -- project channels only
  direct_key      TEXT,                              -- direct messages only: the two user ids, sorted, joined by ":"
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  last_message_at TEXT,
  CHECK ((kind = 'project') = (system_id IS NOT NULL)),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL))
);
CREATE UNIQUE INDEX chat_conversations_system ON chat_conversations (system_id) WHERE system_id IS NOT NULL;
CREATE UNIQUE INDEX chat_conversations_direct ON chat_conversations (direct_key) WHERE direct_key IS NOT NULL;

-- Who is in a conversation, and how far each person has read. Leaving keeps the row (left_at), so a
-- project's lead or developer who leaves its channel isn't added back automatically.
CREATE TABLE chat_members (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  joined_at       TEXT NOT NULL,
  left_at         TEXT,
  last_read_id    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX chat_members_user ON chat_members (user_id) WHERE left_at IS NULL;

CREATE TABLE chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'event')), -- event: "Tariro added Farai"
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  edited_at       TEXT,
  deleted_at      TEXT,
  updated_at      TEXT NOT NULL
);
CREATE INDEX chat_messages_conversation ON chat_messages (conversation_id, id);
CREATE INDEX chat_messages_updated ON chat_messages (conversation_id, updated_at);
