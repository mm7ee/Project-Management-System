-- Reverses migrations/0016_showcase_links.sql. Run by hand:
--   node scripts/db.mjs exec dev migrations/down/0016_showcase_links.down.sql
-- The links made since stop working.
DROP TABLE showcase_links;
DELETE FROM schema_migrations WHERE name = '0016_showcase_links.sql';
