import { describe, expect, it } from 'vitest';

import { assertIanaTimezone, businessDateForInstant, timeToMinute } from './shift-time.js';

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
});
