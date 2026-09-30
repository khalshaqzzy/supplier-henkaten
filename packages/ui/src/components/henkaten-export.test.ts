import { describe, expect, it } from 'vitest';

import { defaultExportPeriod } from './henkaten-export';

describe('defaultExportPeriod', () => {
  it('uses the supplier business date and clamps a missing day in the prior month', () => {
    const now = new Date('2026-03-31T18:30:00.000Z');
    expect(defaultExportPeriod('Asia/Jakarta', now)).toEqual({
      from: '2026-03-01',
      to: '2026-04-01',
    });
    expect(defaultExportPeriod('America/Los_Angeles', now)).toEqual({
      from: '2026-02-28',
      to: '2026-03-31',
    });
  });
});
