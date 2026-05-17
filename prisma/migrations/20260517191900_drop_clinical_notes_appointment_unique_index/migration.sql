-- Follow-up: prior migration dropped UNIQUE CONSTRAINT but left underlying unique INDEX
-- which prevented multiple notes (root + addendums) sharing same appointment_id.
DROP INDEX IF EXISTS clinical_notes_appointment_id_key;
