export type ClinicalNoteStatus = 'draft' | 'signed';

export const ALLOWED_TRANSITIONS: Record<
  ClinicalNoteStatus,
  ClinicalNoteStatus[]
> = {
  draft: ['signed'],
  signed: [],
};
