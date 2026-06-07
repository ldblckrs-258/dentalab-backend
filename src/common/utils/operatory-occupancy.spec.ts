import { operatoryOccupancyWhere } from './operatory-occupancy';

describe('operatoryOccupancyWhere', () => {
  const start = new Date('2026-06-07T02:00:00.000Z');
  const end = new Date('2026-06-07T02:30:00.000Z');

  it('builds the gist-mirroring overlap predicate without an exclude', () => {
    const where = operatoryOccupancyWhere(start, end);

    expect(where).toEqual({
      operatoryId: { not: null },
      status: { notIn: ['cancelled', 'no_show'] },
      startTime: { lt: end },
      endTime: { gt: start },
    });
    expect('id' in where).toBe(false);
  });

  it('adds an id-not filter when excludeAppointmentId is given', () => {
    const where = operatoryOccupancyWhere(start, end, 'appt-self');

    expect(where.id).toEqual({ not: 'appt-self' });
    expect(where.operatoryId).toEqual({ not: null });
    expect(where.status).toEqual({ notIn: ['cancelled', 'no_show'] });
    expect(where.startTime).toEqual({ lt: end });
    expect(where.endTime).toEqual({ gt: start });
  });
});
