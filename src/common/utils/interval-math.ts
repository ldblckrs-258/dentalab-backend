export interface TimeWindow {
  start: string;
  end: string;
  source: 'schedule' | 'override';
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function subtractWindow(
  windows: TimeWindow[],
  subStart: string,
  subEnd: string,
): TimeWindow[] {
  const result: TimeWindow[] = [];

  for (const w of windows) {
    if (w.end <= subStart || w.start >= subEnd) {
      result.push(w);
      continue;
    }

    if (w.start < subStart) {
      result.push({ start: w.start, end: subStart, source: w.source });
    }

    if (w.end > subEnd) {
      result.push({ start: subEnd, end: w.end, source: w.source });
    }
  }

  return result;
}

export function sliceWindow(
  window: TimeWindow,
  durationMinutes: number,
): string[] {
  const startMin = toMinutes(window.start);
  const endMin = toMinutes(window.end);
  const slots: string[] = [];

  for (
    let cursor = startMin;
    cursor + durationMinutes <= endMin;
    cursor += durationMinutes
  ) {
    slots.push(fromMinutes(cursor));
  }

  return slots;
}
