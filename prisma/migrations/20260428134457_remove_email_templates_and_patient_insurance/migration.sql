/*
  Warnings:

  - You are about to drop the column `template_id` on the `email_logs` table. All the data in the column will be lost.
  - You are about to drop the `email_templates` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `patient_insurances` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `template_name` to the `email_logs` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "email_logs" DROP CONSTRAINT "email_logs_template_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_insurances" DROP CONSTRAINT "patient_insurances_patient_id_fkey";

-- DropIndex
DROP INDEX "email_logs_template_id_idx";

-- AlterTable
ALTER TABLE "email_logs" DROP COLUMN "template_id",
ADD COLUMN     "template_name" TEXT NOT NULL;

-- DropTable
DROP TABLE "email_templates";

-- DropTable
DROP TABLE "patient_insurances";
