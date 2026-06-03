import { subtractWindow, sliceWindow } from './interval-math';
import type { TimeWindow } from './interval-math';

const w = (
  start: string,
  end: string,
  source: 'schedule' | 'override' = 'schedule',
): TimeWindow => ({
  start,
  end,
  source,
});

describe('subtractWindow', () => {
  it('no overlap — subtracted range entirely before window', () => {
    const result = subtractWindow([w('09:00', '12:00')], '07:00', '08:00');
    expect(result).toEqual([w('09:00', '12:00')]);
  });

  it('no overlap — subtracted range entirely after window', () => {
    const result = subtractWindow([w('09:00', '12:00')], '13:00', '14:00');
    expect(result).toEqual([w('09:00', '12:00')]);
  });

  it('left partial — subtracted range overlaps start', () => {
    const result = subtractWindow([w('09:00', '12:00')], '08:00', '10:00');
    expect(result).toEqual([w('10:00', '12:00')]);
  });

  it('right partial — subtracted range overlaps end', () => {
    const result = subtractWindow([w('09:00', '12:00')], '11:00', '13:00');
    expect(result).toEqual([w('09:00', '11:00')]);
  });

  it('full consume — subtracted range covers entire window', () => {
    const result = subtractWindow([w('09:00', '12:00')], '08:00', '13:00');
    expect(result).toEqual([]);
  });

  it('mid-window split — subtracted range cuts interior', () => {
    const result = subtractWindow([w('09:00', '12:00')], '10:00', '11:00');
    expect(result).toEqual([w('09:00', '10:00'), w('11:00', '12:00')]);
  });

  it('multiple windows — only overlapping window is affected', () => {
    const windows = [w('08:00', '12:00'), w('13:00', '17:00')];
    const result = subtractWindow(windows, '10:00', '11:00');
    expect(result).toEqual([
      w('08:00', '10:00'),
      w('11:00', '12:00'),
      w('13:00', '17:00'),
    ]);
  });

  it('multiple booked intervals — both subtracted correctly', () => {
    const windows = [w('08:00', '17:00')];
    let result = subtractWindow(windows, '09:00', '10:00');
    result = subtractWindow(result, '14:00', '15:00');
    expect(result).toEqual([
      w('08:00', '09:00'),
      w('10:00', '14:00'),
      w('15:00', '17:00'),
    ]);
  });

  it('preserves source on split windows', () => {
    const result = subtractWindow(
      [w('09:00', '12:00', 'override')],
      '10:00',
      '11:00',
    );
    expect(result[0].source).toBe('override');
    expect(result[1].source).toBe('override');
  });
});

describe('sliceWindow', () => {
  it('exact fit — window exactly holds N slots', () => {
    const slots = sliceWindow(w('09:00', '10:00'), 30);
    expect(slots).toEqual(['09:00', '09:30']);
  });

  it('trailing partial dropped — 10-min remainder not emitted', () => {
    const slots = sliceWindow(w('09:00', '10:10'), 30);
    expect(slots).toEqual(['09:00', '09:30']);
  });

  it('zero-width window yields empty array', () => {
    const slots = sliceWindow(w('09:00', '09:00'), 30);
    expect(slots).toEqual([]);
  });

  it('window smaller than duration yields empty array', () => {
    const slots = sliceWindow(w('09:00', '09:20'), 30);
    expect(slots).toEqual([]);
  });

  it('50-min type in 09:00-10:00 window — one slot, 09:50 dropped', () => {
    const slots = sliceWindow(w('09:00', '10:00'), 50);
    expect(slots).toEqual(['09:00']);
  });

  it('single-minute duration produces dense slots', () => {
    const slots = sliceWindow(w('09:00', '09:03'), 1);
    expect(slots).toEqual(['09:00', '09:01', '09:02']);
  });
});
