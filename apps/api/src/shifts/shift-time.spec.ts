import { describe, expect, it } from 'vitest';

import { shiftBoundaries } from './shift-time.js';

describe('Shift Run boundaries', () => {
  it('uses the selected business date and crosses midnight in the selected IANA zone', () => {
    const boundaries = shiftBoundaries('2026-07-23', 22 * 60, 6 * 60, 'Asia/Jakarta');
    expect(boundaries.start.toISOString()).toBe('2026-07-23T15:00:00.000Z');
    expect(boundaries.end.toISOString()).toBe('2026-07-23T23:00:00.000Z');
  });

  it('preserves local wall-clock boundaries across a DST transition', () => {
    const boundaries = shiftBoundaries('2026-11-01', 30, 3 * 60 + 30, 'America/New_York');
    expect(boundaries.start.toISOString()).toBe('2026-11-01T04:30:00.000Z');
    expect(boundaries.end.toISOString()).toBe('2026-11-01T08:30:00.000Z');
    expect(boundaries.end.getTime() - boundaries.start.getTime()).toBe(4 * 60 * 60 * 1_000);
  });
});
