/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `appointment_types` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `appointment_types` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "appointment_types"
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "text_color" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updated_by" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "appointment_types_name_key" ON "appointment_types"("name");
