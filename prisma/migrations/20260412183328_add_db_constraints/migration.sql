-- ════════════════════════════════════════════════════════════════
-- Extensions required for exclusion constraints
-- ════════════════════════════════════════════════════════════════

-- btree_gist allows combining btree operators (=) with gist operators (&&)
-- in exclusion constraints (e.g., provider_id WITH = alongside range WITH &&)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Custom time range type for schedule overlap checks
-- PostgreSQL has no built-in range type for `time`, only for timestamp/date/int
DO $$ BEGIN
  CREATE TYPE timerange AS RANGE (subtype = time);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Immutable wrapper: TEXT "HH:mm" → timerange
-- Required because text::time cast is STABLE (depends on DateStyle),
-- but exclusion constraint index expressions must be IMMUTABLE.
-- Safe here because our format is always fixed "HH:mm".
CREATE FUNCTION make_timerange(start_text TEXT, end_text TEXT)
RETURNS timerange AS $$
  SELECT timerange(start_text::time, end_text::time, '[)')
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;


-- ════════════════════════════════════════════════════════════════
-- EXCLUSION CONSTRAINTS — prevent overlapping time ranges
-- ERD: "Constraints not expressible in ERD (enforce via migration)"
-- ════════════════════════════════════════════════════════════════

-- 1. provider_schedules: no overlapping [start_time, end_time) for same (provider_id, day_of_week)
ALTER TABLE "provider_schedules"
ADD CONSTRAINT "provider_schedules_no_overlap"
EXCLUDE USING gist (
  provider_id WITH =,
  day_of_week WITH =,
  make_timerange(start_time, end_time) WITH &&
);

-- 2. provider_schedule_overrides: no overlapping time for same (provider_id, specific_date)
--    Only applies to overrides that have time ranges and are not cancelled/rejected
ALTER TABLE "provider_schedule_overrides"
ADD CONSTRAINT "provider_schedule_overrides_no_overlap"
EXCLUDE USING gist (
  provider_id WITH =,
  specific_date WITH =,
  make_timerange(start_time, end_time) WITH &&
) WHERE (start_time IS NOT NULL AND end_time IS NOT NULL AND status NOT IN ('cancelled', 'rejected'));

-- 3. appointments: no overlapping [start_time, end_time) for same provider_id
--    Scoped to non-cancelled appointments only
ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_no_overlap"
EXCLUDE USING gist (
  provider_id WITH =,
  tsrange(start_time, end_time, '[)') WITH &&
) WHERE (status != 'cancelled');


-- ════════════════════════════════════════════════════════════════
-- CHECK CONSTRAINTS — enforce valid enum values at DB level
-- ERD: "Enum definitions"
-- ════════════════════════════════════════════════════════════════

-- treatment_plans.status
ALTER TABLE "treatment_plans"
ADD CONSTRAINT "treatment_plans_status_check"
CHECK (status IN ('draft', 'proposed', 'accepted', 'in_progress', 'completed', 'cancelled'));

-- appointments.status
ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_status_check"
CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'));

-- provider_schedule_overrides.status
ALTER TABLE "provider_schedule_overrides"
ADD CONSTRAINT "provider_schedule_overrides_status_check"
CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- kiosk_sessions.status
ALTER TABLE "kiosk_sessions"
ADD CONSTRAINT "kiosk_sessions_status_check"
CHECK (status IN ('active', 'completed', 'expired', 'closed'));

-- inventory_transactions.type
ALTER TABLE "inventory_transactions"
ADD CONSTRAINT "inventory_transactions_type_check"
CHECK (type IN ('purchase', 'return', 'usage', 'adjustment', 'damage'));

-- email_templates.type
ALTER TABLE "email_templates"
ADD CONSTRAINT "email_templates_type_check"
CHECK (type IN ('password_reset', 'appointment_confirmation', 'appointment_reminder', 'appointment_cancellation', 'kiosk_invitation', 'clinic_notice', 'system_alert'));

-- email_logs.entity_type (nullable — NULL is allowed, but if set must be valid)
ALTER TABLE "email_logs"
ADD CONSTRAINT "email_logs_entity_type_check"
CHECK (entity_type IS NULL OR entity_type IN ('appointment', 'password_reset', 'kiosk_session', 'patient', 'system'));


-- ════════════════════════════════════════════════════════════════
-- PARTIAL UNIQUE INDEXES — conditional uniqueness
-- ERD: "Constraints not expressible in ERD"
-- ════════════════════════════════════════════════════════════════

-- user_permission_overrides: at most one is_active=true override per (user_id, permission_id)
-- Multiple revoked/expired overrides for the same pair are allowed
CREATE UNIQUE INDEX "user_permission_overrides_active_unique"
ON "user_permission_overrides" (user_id, permission_id)
WHERE is_active = true;

-- rag_documents: (source_type, source_id) logically unique for non-failed index entries
-- If a previous indexing failed, allow re-indexing the same source
CREATE UNIQUE INDEX "rag_documents_source_unique"
ON "rag_documents" (source_type, source_id)
WHERE status != 'failed';
