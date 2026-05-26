-- Backfill existing rows that may have NULL for the array column
UPDATE "chat_sessions"
   SET "scope_rag_document_ids" = ARRAY[]::TEXT[]
 WHERE "scope_rag_document_ids" IS NULL;

-- Enforce NOT NULL on the array column after backfill
ALTER TABLE "chat_sessions"
    ALTER COLUMN "scope_rag_document_ids" SET NOT NULL,
    ALTER COLUMN "scope_rag_document_ids" SET DEFAULT ARRAY[]::TEXT[];

-- Index for patient-scope lookups (Prisma declares plain index in schema; WHERE clause skipped to avoid drift)
CREATE INDEX "chat_sessions_scope_patient_idx"
    ON "chat_sessions" ("scope_patient_id");

-- Mutual-exclusivity CHECK constraint on scope shape
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_scope_exclusive_chk"
    CHECK (
        ("scope_type" IS NULL
            AND "scope_patient_id" IS NULL
            AND "scope_rag_document_ids" = ARRAY[]::TEXT[])
     OR ("scope_type" = 'patient'
            AND "scope_patient_id" IS NOT NULL
            AND "scope_rag_document_ids" = ARRAY[]::TEXT[])
     OR ("scope_type" = 'documents'
            AND "scope_patient_id" IS NULL
            AND array_length("scope_rag_document_ids", 1) BETWEEN 1 AND 5)
    );
