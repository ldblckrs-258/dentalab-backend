/*
  Warnings:

  - You are about to drop the column `appointment_id` on the `email_logs` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[resend_id]` on the table `email_logs` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `email_templates` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `from_address` to the `email_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subject` to the `email_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `email_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `body_mjml` to the `email_templates` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "email_logs" DROP CONSTRAINT "email_logs_appointment_id_fkey";

-- AlterTable
ALTER TABLE "email_logs" DROP COLUMN "appointment_id",
ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "bounced_at" TIMESTAMP(3),
ADD COLUMN     "complained_at" TIMESTAMP(3),
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "entity_id" UUID,
ADD COLUMN     "entity_type" TEXT,
ADD COLUMN     "from_address" TEXT NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "resend_id" TEXT,
ADD COLUMN     "subject" TEXT NOT NULL,
ADD COLUMN     "tags" JSONB,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "variables" JSONB,
ADD COLUMN     "webhook_events" JSONB;

-- AlterTable
ALTER TABLE "email_templates" ADD COLUMN     "body_mjml" TEXT NOT NULL,
ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "variables" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "email_logs_resend_id_key" ON "email_logs"("resend_id");

-- CreateIndex
CREATE INDEX "email_logs_resend_id_idx" ON "email_logs"("resend_id");

-- CreateIndex
CREATE INDEX "email_logs_recipient_email_idx" ON "email_logs"("recipient_email");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE INDEX "email_logs_template_id_idx" ON "email_logs"("template_id");

-- CreateIndex
CREATE INDEX "email_logs_entity_type_entity_id_idx" ON "email_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "email_logs_batch_id_idx" ON "email_logs"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_name_key" ON "email_templates"("name");
