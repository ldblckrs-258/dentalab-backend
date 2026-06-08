export type AppointmentHistoryAction =
  | 'created'
  | 'updated'
  | 'rescheduled'
  | 'status_changed'
  | 'cancelled';

export type AppointmentHistorySource = 'staff' | 'patient_portal' | 'system';

export type AppointmentChange =
  | {
      field: 'status' | 'startTime' | 'endTime' | 'notes' | 'chiefComplaint';
      oldValue: string | null;
      newValue: string | null;
    }
  | {
      field: 'provider' | 'operatory' | 'type';
      oldId: string | null;
      oldLabel: string | null;
      newId: string | null;
      newLabel: string | null;
    }
  | {
      field: 'procedures';
      added: { id: string; label: string }[];
      removed: { id: string; label: string }[];
    };

export interface RecordHistoryInput {
  appointmentId: string;
  action: AppointmentHistoryAction;
  changes: AppointmentChange[];
  reason?: string;
  source?: AppointmentHistorySource;
}

export interface EntityLabelMaps {
  providers: Map<string, string>;
  operatories: Map<string, string>;
  types: Map<string, string>;
  procedures: Map<string, string>;
}

export interface AppointmentHistoryEntry {
  id: string;
  action: string;
  changes: AppointmentChange[];
  reason: string | null;
  source: string;
  actor: { id: string | null; name: string } | null;
  createdAt: Date;
}
