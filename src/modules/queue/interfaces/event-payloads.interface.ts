export interface DocumentEventPayload {
  sourceType: string;
  sourceId: string;
  action: 'created' | 'updated' | 'deleted';
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
  variables: Record<string, string>;
  lang?: string;
}

export interface EmailSendResetPasswordPayload {
  userId: string;
  email: string;
  resetToken: string;
  expiresAt: string;
  lang?: string;
}

export interface EmailSendWelcomePayload {
  userId: string;
  email: string;
  fullName: string;
  temporaryPassword?: string;
  lang?: string;
}

export interface InventoryLowStockPayload {
  itemId: string;
  itemName: string;
  currentQuantity: number;
  minQuantity: number;
}

export type EventPayload =
  | DocumentEventPayload
  | ClinicalNoteCreatedPayload
  | ClinicalNoteUpdatedPayload
  | EmailSendReminderPayload
  | EmailSendResetPasswordPayload
  | EmailSendWelcomePayload
  | InventoryLowStockPayload;
