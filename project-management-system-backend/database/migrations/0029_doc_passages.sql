-- Ask AI, phase (b) (docs/assistant-plan.md): documents become searchable by meaning.
--   1. pgvector.
--   2. doc_passages: a document's text in passages of about 800 tokens, each with its section and an embedding
--      (@cf/baai/bge-m3, 1,024 dimensions). One set per documents row (a version is its own row), removed with it.
--   3. doc_index: whether each document has been read, so the backfill knows what's left and the failures show.
-- Both are a workspace's own rows (row-level security as every table) and go with their document (cascade) and with
-- their organisation (tenancy_purge_organization deletes every table with organization_id).
-- Reverse: migrations/down/0029_doc_passages.down.sql.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE doc_passages (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              BIGSERIAL PRIMARY KEY,
  document_id     TEXT NOT NULL,
  system_id       TEXT NOT NULL,
  seq             INTEGER NOT NULL CHECK (seq >= 0),
  section         TEXT NOT NULL DEFAULT '' CHECK (length(section) <= 300),
  page            INTEGER CHECK (page IS NULL OR page > 0),
  text            TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 6000),
  embedding       vector(1024) NOT NULL,
  UNIQUE (document_id, seq),
  FOREIGN KEY (workspace_id, document_id) REFERENCES documents (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX doc_passages_document ON doc_passages (document_id);
CREATE INDEX doc_passages_system ON doc_passages (workspace_id, system_id);
CREATE INDEX doc_passages_embedding ON doc_passages USING hnsw (embedding vector_cosine_ops);
ALTER TABLE doc_passages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON doc_passages TO pulse_app USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));
GRANT SELECT, INSERT, DELETE ON doc_passages TO pulse_app;
GRANT USAGE ON SEQUENCE doc_passages_id_seq TO pulse_app;

CREATE TABLE doc_index (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  document_id     TEXT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('indexed', 'skipped', 'failed')),
  passages        INTEGER NOT NULL DEFAULT 0,
  chars           INTEGER NOT NULL DEFAULT 0,
  model           TEXT,
  note            TEXT CHECK (note IS NULL OR length(note) <= 300),
  attempts        INTEGER NOT NULL DEFAULT 1,
  indexed_at      TEXT NOT NULL,
  FOREIGN KEY (workspace_id, document_id) REFERENCES documents (workspace_id, id) ON DELETE CASCADE
);
ALTER TABLE doc_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON doc_index TO pulse_app USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true) AND organization_id = current_setting('app.org_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_index TO pulse_app;
