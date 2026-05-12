import {
  diffShifts,
  findInvalidTimeRanges,
  findIntraPayloadOverlaps,
  type ExistingShift,
  type IncomingShift,
} from './diff-shifts';

const existing = (
  id: string,
  dow: number,
  start: string,
  end: string,
  isAvailable = true,
): ExistingShift => ({
  id,
  dayOfWeek: dow,
  startTime: start,
  endTime: end,
  isAvailable,
});

const incoming = (
  dow: number,
  start: string,
  end: string,
  opts: { id?: string; isAvailable?: boolean } = {},
): IncomingShift => ({
  ...(opts.id !== undefined && { id: opts.id }),
  dayOfWeek: dow,
  startTime: start,
  endTime: end,
  ...(opts.isAvailable !== undefined && { isAvailable: opts.isAvailable }),
});

describe('diffShifts', () => {
  it('empty incoming → delete all existing', () => {
    const result = diffShifts(
      [existing('a', 1, '08:00', '12:00'), existing('b', 2, '09:00', '17:00')],
      [],
    );
    expect(result.toCreate).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.toDelete).toEqual(['a', 'b']);
  });

  it('empty existing → create all incoming', () => {
    const result = diffShifts([], [incoming(1, '08:00', '12:00')]);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0]).toEqual({
      dayOfWeek: 1,
      startTime: '08:00',
      endTime: '12:00',
      isAvailable: true,
    });
    expect(result.toUpdate).toEqual([]);
    expect(result.toDelete).toEqual([]);
  });

  it('identical tuple, no id → match (no-op)', () => {
    const result = diffShifts(
      [existing('a', 1, '08:00', '12:00')],
      [incoming(1, '08:00', '12:00')],
    );
    expect(result.toCreate).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.toDelete).toEqual([]);
  });

  it('id match with time change → update', () => {
    const result = diffShifts(
      [existing('a', 1, '08:00', '12:00')],
      [incoming(1, '09:00', '12:00', { id: 'a' })],
    );
    expect(result.toCreate).toEqual([]);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]).toEqual({
      id: 'a',
      data: {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '12:00',
        isAvailable: true,
      },
    });
    expect(result.toDelete).toEqual([]);
  });

  it('tuple match without id → no-op (same shift)', () => {
    const result = diffShifts(
      [existing('a', 1, '08:00', '12:00')],
      [incoming(1, '08:00', '12:00')],
    );
    expect(result.toUpdate).toEqual([]);
    expect(result.toCreate).toEqual([]);
    expect(result.toDelete).toEqual([]);
  });

  it('isAvailable change → update', () => {
    const result = diffShifts(
      [existing('a', 1, '08:00', '12:00', true)],
      [incoming(1, '08:00', '12:00', { id: 'a', isAvailable: false })],
    );
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].data.isAvailable).toBe(false);
  });

  it('mixed: keep one, update one, create one, delete one', () => {
    const result = diffShifts(
      [
        existing('a', 1, '08:00', '12:00'), // kept (tuple match)
        existing('b', 2, '08:00', '12:00'), // updated
        existing('c', 3, '08:00', '12:00'), // deleted (no match)
      ],
      [
        incoming(1, '08:00', '12:00'),
        incoming(2, '09:00', '13:00', { id: 'b' }),
        incoming(4, '08:00', '12:00'),
      ],
    );
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0].dayOfWeek).toBe(4);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].id).toBe('b');
    expect(result.toDelete).toEqual(['c']);
  });

  it('two incoming claiming same id → second falls back to create', () => {
    const result = diffShifts(
      [existing('a', 1, '08:00', '12:00')],
      [
        incoming(1, '09:00', '13:00', { id: 'a' }),
        incoming(2, '08:00', '12:00', { id: 'a' }),
      ],
    );
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0].dayOfWeek).toBe(2);
  });
});

describe('findIntraPayloadOverlaps', () => {
  it('no overlap → empty', () => {
    expect(
      findIntraPayloadOverlaps([
        incoming(1, '08:00', '12:00'),
        incoming(1, '13:00', '17:00'),
      ]),
    ).toEqual([]);
  });

  it('back-to-back → not overlap', () => {
    expect(
      findIntraPayloadOverlaps([
        incoming(1, '08:00', '12:00'),
        incoming(1, '12:00', '17:00'),
      ]),
    ).toEqual([]);
  });

  it('same start → overlap', () => {
    const result = findIntraPayloadOverlaps([
      incoming(1, '08:00', '12:00'),
      incoming(1, '08:00', '10:00'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].dayOfWeek).toBe(1);
  });

  it('nested overlap', () => {
    const result = findIntraPayloadOverlaps([
      incoming(1, '08:00', '17:00'),
      incoming(1, '10:00', '12:00'),
    ]);
    expect(result).toHaveLength(1);
  });

  it('different days → not overlap', () => {
    expect(
      findIntraPayloadOverlaps([
        incoming(1, '08:00', '12:00'),
        incoming(2, '08:00', '12:00'),
      ]),
    ).toEqual([]);
  });

  it('three-way overlap → reports multiple pairs', () => {
    const result = findIntraPayloadOverlaps([
      incoming(1, '08:00', '12:00'),
      incoming(1, '10:00', '14:00'),
      incoming(1, '13:00', '15:00'),
    ]);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe('findInvalidTimeRanges', () => {
  it('end after start → no errors', () => {
    expect(findInvalidTimeRanges([incoming(1, '08:00', '12:00')])).toEqual([]);
  });

  it('end equals start → invalid', () => {
    expect(findInvalidTimeRanges([incoming(1, '08:00', '08:00')])).toEqual([0]);
  });

  it('end before start → invalid', () => {
    expect(findInvalidTimeRanges([incoming(1, '12:00', '08:00')])).toEqual([0]);
  });
});
