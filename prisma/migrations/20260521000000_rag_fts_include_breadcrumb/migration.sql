-- Extend child_chunks FTS trigger to include the breadcrumb path stored in
-- metadata->>'breadcrumb'. Worker writes ancestor heading chain there so
-- both vector search (heading-prefixed embedding input) and BM25/FTS
-- (search_vector) share the same heading-aware semantics.

CREATE OR REPLACE FUNCTION child_chunks_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'simple',
    unaccent(
      COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.metadata->>'breadcrumb', '')
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS child_chunks_search_vector_trigger ON child_chunks;
CREATE TRIGGER child_chunks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content, metadata ON child_chunks
  FOR EACH ROW EXECUTE FUNCTION child_chunks_search_vector_update();
