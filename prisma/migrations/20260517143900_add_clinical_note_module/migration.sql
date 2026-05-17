ALTER TABLE clinical_notes DROP CONSTRAINT IF EXISTS clinical_notes_appointment_id_key;
ALTER TABLE clinical_notes ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE clinical_notes
  ADD COLUMN parent_note_id UUID,
  ADD COLUMN version INT NOT NULL DEFAULT 1,
  ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'draft',
  ADD COLUMN signed_at TIMESTAMP(3),
  ADD COLUMN signed_by UUID,
  ADD COLUMN created_by UUID;
UPDATE clinical_notes cn
  SET created_by = p.user_id
  FROM providers p WHERE p.id = cn.provider_id AND cn.created_by IS NULL;
ALTER TABLE clinical_notes ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE clinical_notes
  ADD CONSTRAINT clinical_notes_status_check
    CHECK (status IN ('draft','signed')),
  ADD CONSTRAINT clinical_notes_version_check
    CHECK (version >= 1),
  ADD CONSTRAINT clinical_notes_sign_integrity
    CHECK (signed_at IS NULL OR (status = 'signed' AND signed_by IS NOT NULL)),
  ADD CONSTRAINT clinical_notes_parent_fk
    FOREIGN KEY (parent_note_id) REFERENCES clinical_notes(id),
  ADD CONSTRAINT clinical_notes_signer_fk
    FOREIGN KEY (signed_by) REFERENCES users(id),
  ADD CONSTRAINT clinical_notes_creator_fk
    FOREIGN KEY (created_by) REFERENCES users(id);
CREATE INDEX clinical_notes_parent_note_id_idx ON clinical_notes(parent_note_id);
CREATE INDEX clinical_notes_provider_status_idx ON clinical_notes(provider_id, status);
