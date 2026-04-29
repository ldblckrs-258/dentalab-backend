ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";

DROP TABLE IF EXISTS "audit_logs" CASCADE;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  event_code TEXT NOT NULL,
  event_version SMALLINT NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  actor_email TEXT,
  actor_role_codes TEXT[] NOT NULL DEFAULT '{}',
  session_id UUID,
  request_id UUID,
  resource TEXT,
  resource_id UUID,
  parent_resource TEXT,
  parent_id UUID,
  "before" JSONB,
  "after" JSONB,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  source TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_created_at_brin ON audit_logs USING brin (created_at);
CREATE INDEX idx_audit_logs_actor_time
  ON audit_logs (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_logs_resource_time
  ON audit_logs (resource, resource_id, created_at DESC) WHERE resource_id IS NOT NULL;
CREATE INDEX idx_audit_logs_event_code_time ON audit_logs (event_code, created_at DESC);
CREATE INDEX idx_audit_logs_phi_time ON audit_logs (created_at DESC) WHERE category = 'phi';
CREATE INDEX idx_audit_logs_metadata_gin ON audit_logs USING gin (metadata jsonb_path_ops);

-- Optional append-only hardening: revoke mutation rights from the app role so
-- audit history cannot be silently rewritten by a compromised app account.
-- Run after confirming the actual role name in your deployment.
--   REVOKE UPDATE, DELETE ON audit_logs FROM dentalab_app;
