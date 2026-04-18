-- Drop old unique index that treats NULL as distinct
DROP INDEX IF EXISTS "permissions_resource_action_scope_key";

-- Recreate with NULLS NOT DISTINCT so (resource, action, NULL) is treated as a single unique value
CREATE UNIQUE INDEX "permissions_resource_action_scope_key"
  ON "permissions" ("resource", "action", "scope") NULLS NOT DISTINCT;
