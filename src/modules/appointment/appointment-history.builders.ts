import type {
  AppointmentChange,
  EntityLabelMaps,
} from './appointment-history.types';

type FkField = 'provider' | 'operatory' | 'type';
type ScalarField =
  | 'status'
  | 'startTime'
  | 'endTime'
  | 'notes'
  | 'chiefComplaint';

const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

function fkChange(
  field: FkField,
  oldId: string | null,
  newId: string | null,
  labels: Map<string, string>,
): AppointmentChange | null {
  if ((oldId ?? null) === (newId ?? null)) return null;
  return {
    field,
    oldId: oldId ?? null,
    oldLabel: oldId ? (labels.get(oldId) ?? null) : null,
    newId: newId ?? null,
    newLabel: newId ? (labels.get(newId) ?? null) : null,
  };
}

function scalarChange(
  field: ScalarField,
  oldValue: string | null,
  newValue: string | null,
): AppointmentChange | null {
  if ((oldValue ?? null) === (newValue ?? null)) return null;
  return { field, oldValue: oldValue ?? null, newValue: newValue ?? null };
}

interface ApptSnapshot {
  providerId: string;
  typeId: string;
  operatoryId: string | null;
  startTime: Date;
  endTime: Date;
  status: string;
  notes: string | null;
  chiefComplaint: string | null;
}

export function buildCreatedChanges(
  appt: ApptSnapshot,
  labels: EntityLabelMaps,
): AppointmentChange[] {
  const changes: AppointmentChange[] = [];
  const push = (c: AppointmentChange | null) => {
    if (c) changes.push(c);
  };
  push(fkChange('provider', null, appt.providerId, labels.providers));
  push(fkChange('type', null, appt.typeId, labels.types));
  push(fkChange('operatory', null, appt.operatoryId, labels.operatories));
  push(scalarChange('startTime', null, iso(appt.startTime)));
  push(scalarChange('endTime', null, iso(appt.endTime)));
  push(scalarChange('status', null, appt.status));
  push(scalarChange('notes', null, appt.notes));
  push(scalarChange('chiefComplaint', null, appt.chiefComplaint));
  return changes;
}

export function buildUpdateChanges(
  before: ApptSnapshot,
  after: ApptSnapshot,
  labels: EntityLabelMaps,
  procedures: {
    added: { id: string; label: string }[];
    removed: { id: string; label: string }[];
  },
): AppointmentChange[] {
  const changes: AppointmentChange[] = [];
  const push = (c: AppointmentChange | null) => {
    if (c) changes.push(c);
  };

  push(fkChange('type', before.typeId, after.typeId, labels.types));
  push(
    fkChange('provider', before.providerId, after.providerId, labels.providers),
  );
  push(
    fkChange(
      'operatory',
      before.operatoryId,
      after.operatoryId,
      labels.operatories,
    ),
  );
  push(scalarChange('startTime', iso(before.startTime), iso(after.startTime)));
  push(scalarChange('endTime', iso(before.endTime), iso(after.endTime)));
  push(scalarChange('notes', before.notes, after.notes));
  push(
    scalarChange('chiefComplaint', before.chiefComplaint, after.chiefComplaint),
  );
  if (procedures.added.length || procedures.removed.length) {
    changes.push({
      field: 'procedures',
      added: procedures.added,
      removed: procedures.removed,
    });
  }
  return changes;
}

export function buildRescheduleChanges(
  before: ApptSnapshot,
  after: ApptSnapshot,
  labels: EntityLabelMaps,
): AppointmentChange[] {
  const changes: AppointmentChange[] = [];
  const push = (c: AppointmentChange | null) => {
    if (c) changes.push(c);
  };
  push(scalarChange('startTime', iso(before.startTime), iso(after.startTime)));
  push(scalarChange('endTime', iso(before.endTime), iso(after.endTime)));
  push(
    fkChange('provider', before.providerId, after.providerId, labels.providers),
  );
  push(
    fkChange(
      'operatory',
      before.operatoryId,
      after.operatoryId,
      labels.operatories,
    ),
  );
  return changes;
}

export function buildStatusChange(
  oldStatus: string,
  newStatus: string,
): AppointmentChange[] {
  const c = scalarChange('status', oldStatus, newStatus);
  return c ? [c] : [];
}
