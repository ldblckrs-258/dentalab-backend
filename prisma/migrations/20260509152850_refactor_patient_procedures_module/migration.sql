/*
  Warnings:

  - You are about to drop the column `treatment_plan_id` on the `appointments` table. All the data in the column will be lost.
  - You are about to drop the column `estimated_total_cost` on the `treatment_plans` table. All the data in the column will be lost.
  - You are about to drop the `appointment_procedures` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "appointment_procedures" DROP CONSTRAINT "appointment_procedures_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_procedures" DROP CONSTRAINT "appointment_procedures_procedure_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_treatment_plan_id_fkey";

-- AlterTable
ALTER TABLE "appointments" DROP COLUMN "treatment_plan_id",
ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "chief_complaint" TEXT,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "treatment_plans" DROP COLUMN "estimated_total_cost",
ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "consent_signed_at" TIMESTAMP(3),
ADD COLUMN     "consent_signed_by" TEXT;

-- DropTable
DROP TABLE "appointment_procedures";

-- CreateTable
CREATE TABLE "patient_procedures" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "procedure_id" UUID NOT NULL,
    "treatment_plan_id" UUID,
    "appointment_id" UUID,
    "planned_provider_id" UUID,
    "performed_by_provider_id" UUID,
    "tooth_number" VARCHAR(8),
    "surface" VARCHAR(8),
    "diagnosis" TEXT,
    "clinical_notes" TEXT,
    "estimated_fee" DECIMAL(10,2),
    "actual_fee" DECIMAL(10,2),
    "fee_finalized_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planned_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "sequence_in_plan" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_procedures_patient_id_status_deleted_at_idx" ON "patient_procedures"("patient_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "patient_procedures_treatment_plan_id_idx" ON "patient_procedures"("treatment_plan_id");

-- CreateIndex
CREATE INDEX "patient_procedures_appointment_id_idx" ON "patient_procedures"("appointment_id");

-- CreateIndex
CREATE INDEX "patient_procedures_status_scheduled_at_idx" ON "patient_procedures"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "treatment_plans_patient_id_status_idx" ON "treatment_plans"("patient_id", "status");

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_treatment_plan_id_fkey" FOREIGN KEY ("treatment_plan_id") REFERENCES "treatment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_planned_provider_id_fkey" FOREIGN KEY ("planned_provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_performed_by_provider_id_fkey" FOREIGN KEY ("performed_by_provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_procedures" ADD CONSTRAINT "patient_procedures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Spec §3.1 — CHECK constraints
-- Tooth number FDI notation validation
ALTER TABLE "patient_procedures"
ADD CONSTRAINT "patient_procedures_tooth_fdi_check"
CHECK (
  "tooth_number" IS NULL
  OR "tooth_number" ~ '^([1-4][1-8]|[5-8][1-5])$'
);

-- Surface notation validation (M, O, D, B, L, I and combinations)
ALTER TABLE "patient_procedures"
ADD CONSTRAINT "patient_procedures_surface_check"
CHECK (
  "surface" IS NULL
  OR "surface" ~ '^[MODBLI]{1,5}$'
);

-- Status validation
ALTER TABLE "patient_procedures"
ADD CONSTRAINT "patient_procedures_status_check"
CHECK ("status" IN ('planned', 'scheduled', 'in_progress', 'completed', 'cancelled', 'failed'));

-- Completed procedure must have actual_fee, performed_by_provider_id, and completed_at
ALTER TABLE "patient_procedures"
ADD CONSTRAINT "patient_procedures_completed_required_check"
CHECK (
  "status" != 'completed'
  OR ("actual_fee" IS NOT NULL AND "performed_by_provider_id" IS NOT NULL AND "completed_at" IS NOT NULL)
);

-- Appointment status validation (updated to include checked_in)
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_status_check";
ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_status_check"
CHECK ("status" IN ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'));

-- Spec §3.2 — Partial unique index (anti-duplicate active entries)
CREATE UNIQUE INDEX "patient_procedure_active_unique"
ON "patient_procedures" ("patient_id", "procedure_id", COALESCE("tooth_number", ''), COALESCE("surface", ''))
WHERE "status" IN ('planned', 'scheduled', 'in_progress')
  AND "deleted_at" IS NULL;

-- Spec §3.3 — Treatment plan cost summary view
CREATE OR REPLACE VIEW "treatment_plan_cost_summary" AS
SELECT
  tp.id AS treatment_plan_id,
  COALESCE(SUM(pp.estimated_fee) FILTER (
    WHERE pp.deleted_at IS NULL AND pp.status != 'cancelled'
  ), 0) AS estimated_total,
  COALESCE(SUM(pp.actual_fee) FILTER (
    WHERE pp.status = 'completed' AND pp.deleted_at IS NULL
  ), 0) AS actual_total,
  COUNT(*) FILTER (
    WHERE pp.status = 'completed' AND pp.deleted_at IS NULL
  ) AS completed_count,
  COUNT(*) FILTER (
    WHERE pp.deleted_at IS NULL AND pp.status != 'cancelled'
  ) AS active_count,
  COUNT(*) FILTER (
    WHERE pp.deleted_at IS NULL
  ) AS total_count
FROM "treatment_plans" tp
LEFT JOIN "patient_procedures" pp ON pp.treatment_plan_id = tp.id
GROUP BY tp.id;
