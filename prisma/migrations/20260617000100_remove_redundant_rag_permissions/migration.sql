-- Remove redundant RAG knowledge permissions. rag_patient_notes:read and
-- rag_internal_docs:read are enforced by nothing (no @RequirePermissions guard,
-- no imperative check, no RAG worker filter); the real gates are
-- internal_documents:read and clinical_notes:read. Cascade clears the
-- role_permissions / user_permission_overrides rows referencing them.
--
-- PRE-AUDIT (confirm zero before applying — a referenced document_access row
-- would cascade and silently un-restrict that document):
--   SELECT count(*) FROM document_access da JOIN permissions p ON p.id = da.permission_id
--   WHERE p.resource IN ('rag_patient_notes', 'rag_internal_docs');

DELETE FROM "permissions"
WHERE "resource" IN ('rag_patient_notes', 'rag_internal_docs');
