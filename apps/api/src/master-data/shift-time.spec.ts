import { describe, expect, it } from 'vitest';

import {
  assertIanaTimezone,
  businessDateForInstant,
  occurrenceHenkatenWindowWhere,
  timeToMinute,
} from './shift-time.js';

describe('shift time helpers', () => {
  it('validates local time and IANA timezone', () => {
    expect(timeToMinute('22:30')).toBe(1_350);
    expect(() => timeToMinute('24:00')).toThrow('InvalidLocalTime');
    expect(() => assertIanaTimezone('Asia/Jakarta')).not.toThrow();
    expect(() => assertIanaTimezone('Invalid/Timezone')).toThrow();
  });

  it('uses the shift start date for a cross-midnight shift', () => {
    expect(
      businessDateForInstant(new Date('2026-07-23T20:00:00.000Z'), 'Asia/Jakarta', 1_320, 360),
    ).toBe('2026-07-23');
    expect(
      businessDateForInstant(new Date('2026-07-23T16:00:00.000Z'), 'Asia/Jakarta', 1_320, 360),
    ).toBe('2026-07-23');
  });

  it('retains active overlapping Henkaten windows for current shifts and uses exact match for future shifts', () => {
    const start = new Date('2026-11-20T01:00:00.000Z');
    const end = new Date('2026-11-20T09:00:00.000Z');
    const now = new Date('2026-11-20T03:00:00.000Z');
    expect(occurrenceHenkatenWindowWhere({ start, end, current: true }, now)).toEqual({
      OR: [
        { effectiveStartAt: start, effectiveEndAt: end },
        { effectiveStartAt: { lte: now }, effectiveEndAt: { gt: now } },
      ],
    });
    expect(occurrenceHenkatenWindowWhere({ start, end, current: false }, now)).toEqual({
      effectiveStartAt: start,
      effectiveEndAt: end,
    });
  });
});
