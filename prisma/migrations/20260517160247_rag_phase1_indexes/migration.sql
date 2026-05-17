-- Phase 1 RAG indexes and full-text-search trigger.
-- HNSW for dense vector search, GIN for BM25/FTS, btree for permission-filter join,
-- and a trigger to populate child_chunks.search_vector on insert/update.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE INDEX IF NOT EXISTS "child_chunks_embedding_hnsw_idx"
  ON "child_chunks" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS "child_chunks_search_vector_idx"
  ON "child_chunks" USING gin (search_vector);

CREATE INDEX IF NOT EXISTS "child_chunks_parent_chunk_index_idx"
  ON "child_chunks" (parent_chunk_id, chunk_index);

CREATE OR REPLACE FUNCTION child_chunks_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', unaccent(COALESCE(NEW.content, '')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS child_chunks_search_vector_trigger ON child_chunks;
CREATE TRIGGER child_chunks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content ON child_chunks
  FOR EACH ROW EXECUTE FUNCTION child_chunks_search_vector_update();
