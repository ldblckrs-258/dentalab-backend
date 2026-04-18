-- Add `code` column to roles (nullable for custom roles, unique when set)
ALTER TABLE "roles" ADD COLUMN "code" VARCHAR(32);

-- Backfill existing system roles using their current English `name` as the source.
-- Seed rename to Vietnamese display names happens in the seed script after migration.
UPDATE "roles" SET "code" = 'ADMIN'        WHERE "is_system" = true AND "name" = 'Admin';
UPDATE "roles" SET "code" = 'DOCTOR'       WHERE "is_system" = true AND "name" = 'Doctor';
UPDATE "roles" SET "code" = 'RECEPTIONIST' WHERE "is_system" = true AND "name" = 'Receptionist';
UPDATE "roles" SET "code" = 'MANAGER'      WHERE "is_system" = true AND "name" = 'Manager';

-- Case-sensitive unique constraint on code (non-null values only)
CREATE UNIQUE INDEX "roles_code_key" ON "roles" ("code");

-- Guard: system roles must carry a code; custom roles must not.
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_code_system_consistency"
  CHECK (("is_system" = true AND "code" IS NOT NULL) OR ("is_system" = false AND "code" IS NULL));
