-- Remove legacy internal-document ACL rows whose permission is NOT a
-- documents:access scope. Before setAccess was constrained, a document could be
-- restricted to any permission (e.g. internal_documents:read, held by every
-- reader). Such rows silently un-restrict the document and would be forwarded
-- by the RAG permission-scope reduction. This purges them so no document is
-- left half-protected once the constraint takes effect.
--
-- PRE-AUDIT (run against the target DB and confirm before applying; remediate
-- any row you want to keep by re-pointing it to a documents:access scope):
--   SELECT da.source_id, p.resource, p.action, p.scope
--   FROM document_access da JOIN permissions p ON p.id = da.permission_id
--   WHERE da.source_type = 'internal_document'
--     AND NOT (p.resource = 'documents' AND p.action = 'access');

DELETE FROM "document_access" da
USING "permissions" p
WHERE da."permission_id" = p."id"
  AND da."source_type" = 'internal_document'
  AND NOT (p."resource" = 'documents' AND p."action" = 'access');
