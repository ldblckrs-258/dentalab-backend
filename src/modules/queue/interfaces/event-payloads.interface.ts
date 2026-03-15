export interface DocumentCreatedPayload {
  documentId: string;
  sourceType: string;
  title: string;
  contentHash: string;
}

export interface DocumentUpdatedPayload {
  documentId: string;
  sourceType: string;
  title: string;
  contentHash: string;
  previousHash: string;
}

export interface DocumentDeletedPayload {
  documentId: string;
  sourceType: string;
}

export interface ClinicalNoteCreatedPayload {
  clinicalNoteId: string;
  patientId: string;
  providerId: string;
  appointmentId: string;
}

export interface ClinicalNoteUpdatedPayload {
  clinicalNoteId: string;
  patientId: string;
  providerId: string;
  appointmentId: string;
}

export interface EmailSendReminderPayload {
  appointmentId: string;
  patientEmail: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface EmailSendResetPasswordPayload {
  userId: string;
  email: string;
  resetToken: string;
  expiresAt: string;
}

export interface InventoryLowStockPayload {
  itemId: string;
  itemName: string;
  currentQuantity: number;
  minQuantity: number;
}

export type EventPayload =
  | DocumentCreatedPayload
  | DocumentUpdatedPayload
  | DocumentDeletedPayload
  | ClinicalNoteCreatedPayload
  | ClinicalNoteUpdatedPayload
  | EmailSendReminderPayload
  | EmailSendResetPasswordPayload
  | InventoryLowStockPayload;
