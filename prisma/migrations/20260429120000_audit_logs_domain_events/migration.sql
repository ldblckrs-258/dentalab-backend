-- Audit logs v2: domain events, RANGE partitioning by created_at.

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";

DROP TABLE IF EXISTS "audit_logs" CASCADE;

CREATE TABLE audit_logs (
  id UUID NOT NULL,
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
  hash_prev CHAR(64),
  hash_self CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_audit_logs_created_at_brin ON audit_logs USING brin (created_at);
CREATE INDEX idx_audit_logs_actor_time
  ON audit_logs (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_logs_resource_time
  ON audit_logs (resource, resource_id, created_at DESC) WHERE resource_id IS NOT NULL;
CREATE INDEX idx_audit_logs_event_code_time ON audit_logs (event_code, created_at DESC);
CREATE INDEX idx_audit_logs_phi_time ON audit_logs (created_at DESC) WHERE category = 'phi';
CREATE INDEX idx_audit_logs_metadata_gin ON audit_logs USING gin (metadata jsonb_path_ops);

-- Append-only enforcement: the application role may only SELECT and INSERT.
-- INSERT is granted to a dedicated writer role used exclusively by the audit worker.
-- Run this after confirming the role names for your deployment environment.
-- Example (substitute actual role names):
--   REVOKE UPDATE, DELETE ON audit_logs FROM dentalab_app;
--   CREATE ROLE dentalab_audit_writer NOLOGIN;
--   GRANT INSERT ON audit_logs TO dentalab_audit_writer;
--   GRANT SELECT ON audit_logs TO dentalab_app;
