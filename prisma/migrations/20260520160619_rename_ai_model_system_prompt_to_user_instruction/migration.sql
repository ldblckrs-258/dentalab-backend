-- AlterTable: preserve data by RENAME instead of DROP + ADD
ALTER TABLE "ai_models" RENAME COLUMN "system_prompt" TO "user_instruction";
ALTER TABLE "ai_models" ALTER COLUMN "user_instruction" DROP NOT NULL;
