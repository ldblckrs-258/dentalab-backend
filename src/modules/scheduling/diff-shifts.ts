export interface ExistingShift {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export interface IncomingShift {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable?: boolean;
}

export interface ShiftUpdate {
  id: string;
  data: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  };
}

export interface ShiftCreate {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export interface ShiftDiff {
  toCreate: ShiftCreate[];
  toUpdate: ShiftUpdate[];
  toDelete: string[];
}

function tupleKey(s: {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}) {
  return `${s.dayOfWeek}|${s.startTime}|${s.endTime}`;
}

/**
 * Pure diff between existing recurring shifts and incoming desired set.
 * Match priority: explicit id > exact (dayOfWeek, startTime, endTime) tuple.
 * Unmatched existing → toDelete. Unmatched incoming → toCreate.
 * Matched but field-changed → toUpdate. Matched and identical → no-op.
 */
export function diffShifts(
  existing: ExistingShift[],
  incoming: IncomingShift[],
): ShiftDiff {
  const existingById = new Map<string, ExistingShift>();
  const existingByTuple = new Map<string, ExistingShift>();
  for (const e of existing) {
    existingById.set(e.id, e);
    existingByTuple.set(tupleKey(e), e);
  }

  const matchedIds = new Set<string>();
  const toCreate: ShiftCreate[] = [];
  const toUpdate: ShiftUpdate[] = [];

  for (const inc of incoming) {
    const incAvailable = inc.isAvailable ?? true;
    let match: ExistingShift | undefined;
    if (inc.id) match = existingById.get(inc.id);
    if (!match) match = existingByTuple.get(tupleKey(inc));
    // Skip already-claimed match (prevents two incoming claiming same existing).
    if (match && matchedIds.has(match.id)) match = undefined;

    if (!match) {
      toCreate.push({
        dayOfWeek: inc.dayOfWeek,
        startTime: inc.startTime,
        endTime: inc.endTime,
        isAvailable: incAvailable,
      });
      continue;
    }

    matchedIds.add(match.id);
    const changed =
      match.dayOfWeek !== inc.dayOfWeek ||
      match.startTime !== inc.startTime ||
      match.endTime !== inc.endTime ||
      match.isAvailable !== incAvailable;
    if (changed) {
      toUpdate.push({
        id: match.id,
        data: {
          dayOfWeek: inc.dayOfWeek,
          startTime: inc.startTime,
          endTime: inc.endTime,
          isAvailable: incAvailable,
        },
      });
    }
  }

  const toDelete = existing
    .filter((e) => !matchedIds.has(e.id))
    .map((e) => e.id);

  return { toCreate, toUpdate, toDelete };
}

/**
 * Returns true if any two shifts in the same dayOfWeek overlap (strict overlap;
 * back-to-back [09:00, 12:00) + [12:00, 17:00) is allowed).
 */
export interface OverlapPair {
  dayOfWeek: number;
  indexA: number;
  indexB: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function findIntraPayloadOverlaps(
  shifts: IncomingShift[],
): OverlapPair[] {
  const byDow = new Map<
    number,
    Array<{ index: number; start: number; end: number }>
  >();
  shifts.forEach((s, i) => {
    const arr = byDow.get(s.dayOfWeek) ?? [];
    arr.push({
      index: i,
      start: toMinutes(s.startTime),
      end: toMinutes(s.endTime),
    });
    byDow.set(s.dayOfWeek, arr);
  });

  const overlaps: OverlapPair[] = [];
  for (const [dow, arr] of byDow) {
    arr.sort((a, b) => a.start - b.start);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].start < arr[i - 1].end) {
        overlaps.push({
          dayOfWeek: dow,
          indexA: arr[i - 1].index,
          indexB: arr[i].index,
        });
      }
    }
  }
  return overlaps;
}

export function findInvalidTimeRanges(shifts: IncomingShift[]): number[] {
  const bad: number[] = [];
  shifts.forEach((s, i) => {
    if (toMinutes(s.endTime) <= toMinutes(s.startTime)) bad.push(i);
  });
  return bad;
}
