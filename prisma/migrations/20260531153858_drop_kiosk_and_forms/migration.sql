/*
  Warnings:

  - You are about to drop the `form_submissions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `forms` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `kiosk_session_forms` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `kiosk_sessions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_form_id_fkey";

-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_kiosk_session_id_fkey";

-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "forms" DROP CONSTRAINT "forms_created_by_fkey";

-- DropForeignKey
ALTER TABLE "kiosk_session_forms" DROP CONSTRAINT "kiosk_session_forms_form_id_fkey";

-- DropForeignKey
ALTER TABLE "kiosk_session_forms" DROP CONSTRAINT "kiosk_session_forms_session_id_fkey";

-- DropForeignKey
ALTER TABLE "kiosk_sessions" DROP CONSTRAINT "kiosk_sessions_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "kiosk_sessions" DROP CONSTRAINT "kiosk_sessions_closed_by_fkey";

-- DropForeignKey
ALTER TABLE "kiosk_sessions" DROP CONSTRAINT "kiosk_sessions_created_by_fkey";

-- DropForeignKey
ALTER TABLE "kiosk_sessions" DROP CONSTRAINT "kiosk_sessions_patient_id_fkey";

-- DropTable
DROP TABLE "form_submissions";

-- DropTable
DROP TABLE "forms";

-- DropTable
DROP TABLE "kiosk_session_forms";

-- DropTable
DROP TABLE "kiosk_sessions";

-- Drop stale 'kiosk_session' value from email_logs entity_type CHECK constraint
ALTER TABLE "email_logs" DROP CONSTRAINT IF EXISTS "email_logs_entity_type_check";
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_entity_type_check"
  CHECK (entity_type IS NULL OR entity_type IN ('appointment', 'password_reset', 'patient', 'system'));
