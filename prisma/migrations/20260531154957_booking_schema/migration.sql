-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_created_by_fkey";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "booking_source" TEXT NOT NULL DEFAULT 'staff',
ADD COLUMN     "reminder_sent_at" TIMESTAMP(3),
ALTER COLUMN "created_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "booking_verifications" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_appointment_types" (
    "provider_id" UUID NOT NULL,
    "appointment_type_id" UUID NOT NULL,

    CONSTRAINT "provider_appointment_types_pkey" PRIMARY KEY ("provider_id","appointment_type_id")
);

-- CreateIndex
CREATE INDEX "booking_verifications_email_created_at_idx" ON "booking_verifications"("email", "created_at" DESC);

-- CreateIndex
CREATE INDEX "provider_appointment_types_appointment_type_id_idx" ON "provider_appointment_types"("appointment_type_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_appointment_types" ADD CONSTRAINT "provider_appointment_types_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_appointment_types" ADD CONSTRAINT "provider_appointment_types_appointment_type_id_fkey" FOREIGN KEY ("appointment_type_id") REFERENCES "appointment_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate appointment overlap exclusion to also free no_show slots (so they are rebookable)
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_no_overlap";
ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_no_overlap"
EXCLUDE USING gist (
  provider_id WITH =,
  tsrange(start_time, end_time, '[)') WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show'));

-- Non-unique lookup index for returning-patient match (app-level dedup; clinics share family emails)
CREATE INDEX "patients_email_lower_idx" ON "patients" (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
