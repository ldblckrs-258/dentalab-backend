-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "scope_patient_id" UUID,
ADD COLUMN     "scope_rag_document_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scope_type" TEXT;
