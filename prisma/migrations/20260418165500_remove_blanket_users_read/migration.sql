-- Replace blanket `users:read` permission (scope = NULL) with the two scoped
-- variants `users:read:all` and `users:read:non_admin` seeded by the app.
-- Cascading FK on role_permissions.permission_id drops any stale role mapping.
DELETE FROM "permissions"
WHERE "resource" = 'users' AND "action" = 'read' AND "scope" IS NULL;
