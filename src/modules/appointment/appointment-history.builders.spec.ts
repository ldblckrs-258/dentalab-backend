import {
  buildCreatedChanges,
  buildRescheduleChanges,
  buildStatusChange,
  buildUpdateChanges,
} from './appointment-history.builders';
import type { EntityLabelMaps } from './appointment-history.types';

const T0 = new Date('2026-06-04T02:00:00.000Z');
const T1 = new Date('2026-06-04T02:30:00.000Z');
const T2 = new Date('2026-06-05T08:00:00.000Z');
const T3 = new Date('2026-06-05T08:30:00.000Z');

function labels(
  over: Partial<Record<keyof EntityLabelMaps, Map<string, string>>> = {},
): EntityLabelMaps {
  return {
    providers: over.providers ?? new Map(),
    operatories: over.operatories ?? new Map(),
    types: over.types ?? new Map(),
    procedures: over.procedures ?? new Map(),
  };
}

function snapshot(
  over: Partial<Parameters<typeof buildCreatedChanges>[0]> = {},
) {
  return {
    providerId: 'prov-1',
    typeId: 'type-1',
    operatoryId: 'op-1' as string | null,
    startTime: T0,
    endTime: T1,
    status: 'scheduled',
    notes: null as string | null,
    chiefComplaint: null as string | null,
    ...over,
  };
}

describe('appointment-history.builders', () => {
  describe('buildStatusChange', () => {
    it('emits a status change when values differ', () => {
      expect(buildStatusChange('scheduled', 'confirmed')).toEqual([
        { field: 'status', oldValue: 'scheduled', newValue: 'confirmed' },
      ]);
    });

    it('emits nothing when status is unchanged', () => {
      expect(buildStatusChange('scheduled', 'scheduled')).toEqual([]);
    });
  });

  describe('buildCreatedChanges', () => {
    it('captures provider/type/operatory (with labels), time and status', () => {
      const changes = buildCreatedChanges(
        snapshot(),
        labels({
          providers: new Map([['prov-1', 'Dr. A']]),
          types: new Map([['type-1', 'Cleaning']]),
          operatories: new Map([['op-1', 'Room 1']]),
        }),
      );
      expect(changes).toContainEqual({
        field: 'provider',
        oldId: null,
        oldLabel: null,
        newId: 'prov-1',
        newLabel: 'Dr. A',
      });
      expect(changes).toContainEqual({
        field: 'operatory',
        oldId: null,
        oldLabel: null,
        newId: 'op-1',
        newLabel: 'Room 1',
      });
      expect(changes).toContainEqual({
        field: 'status',
        oldValue: null,
        newValue: 'scheduled',
      });
    });

    it('omits operatory when none, and omits empty notes/chiefComplaint', () => {
      const changes = buildCreatedChanges(
        snapshot({ operatoryId: null, notes: null, chiefComplaint: null }),
        labels(),
      );
      expect(changes.find((c) => c.field === 'operatory')).toBeUndefined();
      expect(changes.find((c) => c.field === 'notes')).toBeUndefined();
      expect(changes.find((c) => c.field === 'chiefComplaint')).toBeUndefined();
    });

    it('captures initial notes/chiefComplaint when provided', () => {
      const changes = buildCreatedChanges(
        snapshot({ notes: 'bring x-rays', chiefComplaint: 'toothache' }),
        labels(),
      );
      expect(changes).toContainEqual({
        field: 'notes',
        oldValue: null,
        newValue: 'bring x-rays',
      });
      expect(changes).toContainEqual({
        field: 'chiefComplaint',
        oldValue: null,
        newValue: 'toothache',
      });
    });
  });

  describe('buildUpdateChanges', () => {
    it('emits only the fields that actually changed', () => {
      const before = snapshot();
      const after = snapshot({ providerId: 'prov-2', notes: 'new note' });
      const changes = buildUpdateChanges(
        before,
        after,
        labels({
          providers: new Map([
            ['prov-1', 'Dr. A'],
            ['prov-2', 'Dr. B'],
          ]),
        }),
        { added: [], removed: [] },
      );
      expect(changes).toContainEqual({
        field: 'provider',
        oldId: 'prov-1',
        oldLabel: 'Dr. A',
        newId: 'prov-2',
        newLabel: 'Dr. B',
      });
      expect(changes).toContainEqual({
        field: 'notes',
        oldValue: null,
        newValue: 'new note',
      });
      // Unchanged fields are absent.
      expect(changes.find((c) => c.field === 'type')).toBeUndefined();
      expect(changes.find((c) => c.field === 'status')).toBeUndefined();
    });

    it('emits a procedures change only when something was added/removed', () => {
      const same = snapshot();
      const none = buildUpdateChanges(same, same, labels(), {
        added: [],
        removed: [],
      });
      expect(none).toEqual([]);

      const withProcs = buildUpdateChanges(same, same, labels(), {
        added: [{ id: 'pp-1', label: 'Filling' }],
        removed: [{ id: 'pp-2', label: 'Extraction' }],
      });
      expect(withProcs).toContainEqual({
        field: 'procedures',
        added: [{ id: 'pp-1', label: 'Filling' }],
        removed: [{ id: 'pp-2', label: 'Extraction' }],
      });
    });
  });

  describe('buildRescheduleChanges', () => {
    it('captures time changes and a provider change when reassigned', () => {
      const before = snapshot();
      const after = snapshot({
        startTime: T2,
        endTime: T3,
        providerId: 'prov-2',
      });
      const changes = buildRescheduleChanges(
        before,
        after,
        labels({
          providers: new Map([
            ['prov-1', 'Dr. A'],
            ['prov-2', 'Dr. B'],
          ]),
        }),
      );
      expect(changes).toContainEqual({
        field: 'startTime',
        oldValue: T0.toISOString(),
        newValue: T2.toISOString(),
      });
      expect(changes).toContainEqual(
        expect.objectContaining({ field: 'provider', newLabel: 'Dr. B' }),
      );
    });

    it('omits provider/operatory when unchanged', () => {
      const before = snapshot();
      const after = snapshot({ startTime: T2, endTime: T3 });
      const changes = buildRescheduleChanges(before, after, labels());
      expect(changes.find((c) => c.field === 'provider')).toBeUndefined();
      expect(changes.find((c) => c.field === 'operatory')).toBeUndefined();
    });
  });
});
