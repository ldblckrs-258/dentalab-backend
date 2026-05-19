-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "answer_model_id" UUID;

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "api_key_ciphertext" BYTEA NOT NULL,
    "api_key_iv" BYTEA NOT NULL,
    "api_key_tag" BYTEA NOT NULL,
    "api_key_last4" TEXT,
    "base_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "top_p" DOUBLE PRECISION,
    "max_tokens" INTEGER,
    "rag_top_k" INTEGER DEFAULT 5,
    "history_window" INTEGER DEFAULT 8,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_name_key" ON "ai_providers"("name");

-- CreateIndex
CREATE INDEX "ai_models_provider_id_idx" ON "ai_models"("provider_id");

-- CreateIndex
CREATE INDEX "chat_sessions_answer_model_id_idx" ON "chat_sessions"("answer_model_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_answer_model_id_fkey" FOREIGN KEY ("answer_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (partial unique — Prisma core lacks WHERE clause)
CREATE UNIQUE INDEX "ai_models_active_rewrite_unique"
  ON "ai_models"("role") WHERE role = 'rewrite' AND is_active = true;

CREATE UNIQUE INDEX "ai_models_default_answer_unique"
  ON "ai_models"("is_default") WHERE role = 'answer' AND is_default = true;
