-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "operatory_id" UUID;

-- CreateIndex
CREATE INDEX "appointments_operatory_id_start_time_idx" ON "appointments"("operatory_id", "start_time");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_operatory_id_fkey" FOREIGN KEY ("operatory_id") REFERENCES "operatories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
