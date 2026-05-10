-- AlterTable
ALTER TABLE "provider_schedule_overrides" ADD COLUMN     "target_schedule_id" UUID;

-- AddForeignKey
ALTER TABLE "provider_schedule_overrides" ADD CONSTRAINT "provider_schedule_overrides_target_schedule_id_fkey" FOREIGN KEY ("target_schedule_id") REFERENCES "provider_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
