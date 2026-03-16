/*
  Warnings:

  - A unique constraint covering the columns `[resource,action,scope]` on the table `permissions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "permissions_resource_action_key";

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "scope" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_scope_key" ON "permissions"("resource", "action", "scope");
