-- This is an empty migration.

-- Enable btree_gist extension (required for non-btree EXCLUDE operators)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop old constraints to replace with more specific ones
ALTER TABLE provider_schedules DROP CONSTRAINT IF EXISTS provider_schedules_no_overlap;
ALTER TABLE provider_schedule_overrides DROP CONSTRAINT IF EXISTS provider_schedule_overrides_no_overlap;

-- Constraint 1: No overlapping available schedule blocks per provider/day
-- We use make_timerange (which is IMMUTABLE) instead of manual casting to timestamp
ALTER TABLE provider_schedules
  ADD CONSTRAINT provider_schedules_no_overlap
  EXCLUDE USING gist (
    provider_id WITH =,
    day_of_week WITH =,
    make_timerange(start_time, end_time) WITH &&
  ) WHERE (is_available = true);

-- Constraint 2: No overlapping approved custom_hours overrides per provider/date
ALTER TABLE provider_schedule_overrides
  ADD CONSTRAINT overrides_no_overlap
  EXCLUDE USING gist (
    provider_id WITH =,
    specific_date WITH =,
    make_timerange(start_time, end_time) WITH &&
  ) WHERE (status = 'approved' AND override_type = 'custom_hours');

-- Constraint 3: At most one approved day_off override per provider/date
CREATE UNIQUE INDEX overrides_day_off_unique
  ON provider_schedule_overrides (provider_id, specific_date)
  WHERE status = 'approved' AND override_type = 'day_off';

-- Constraint 4: Only one active permission override per user+permission pair
CREATE UNIQUE INDEX IF NOT EXISTS user_permission_overrides_active_unique
  ON user_permission_overrides (user_id, permission_id)
  WHERE is_active = true;