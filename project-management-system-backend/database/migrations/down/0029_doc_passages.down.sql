-- Reverses 0029_doc_passages.sql: the passages and the index state (documents are read again when indexed anew).
-- The vector extension stays: dropping it would need every user of it gone, and it holds no data itself.
DROP TABLE doc_index;
DROP TABLE doc_passages;
