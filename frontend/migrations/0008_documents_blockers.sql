-- Project documents: uploaded files or links. A file's bytes are split into chunks of at most
-- 1 MB (D1 caps a row at 2 MB), reassembled in order on download.
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  system_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  url         TEXT,             -- links only
  mime        TEXT,             -- files only
  size        INTEGER,          -- files only, in bytes
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX documents_system ON documents (system_id);

CREATE TABLE document_chunks (
  doc_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  data   BLOB NOT NULL,
  PRIMARY KEY (doc_id, seq)
);

-- What is stopping a project from moving, until someone resolves it.
CREATE TABLE blockers (
  id          TEXT PRIMARY KEY,
  system_id   TEXT NOT NULL,
  text        TEXT NOT NULL,
  raised_by   TEXT NOT NULL,
  raised_at   TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution  TEXT
);
CREATE INDEX blockers_system ON blockers (system_id);
