-- Operatory overlap exclusion: an operatory cannot host two active appointments
-- at overlapping times. NULL operatory rows (legacy / unassigned) never conflict.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_operatory_no_overlap";
ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_operatory_no_overlap"
EXCLUDE USING gist (
  operatory_id WITH =,
  tsrange(start_time, end_time, '[)') WITH &&
) WHERE (operatory_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show'));
