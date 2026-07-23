import { describe, expect, it } from 'vitest';

import { healthResponseSchema, readinessResponseSchema } from './health.js';

describe('health contracts', () => {
  it('round-trips a safe health response', () => {
    const value = {
      status: 'ok',
      service: 'api',
      releaseSha: 'development',
      checkedAt: '2026-07-23T02:00:00.000Z',
    } as const;

    expect(healthResponseSchema.parse(value)).toEqual(value);
  });

  it('requires readiness summary to match individual checks', () => {
    expect(
      readinessResponseSchema.parse({
        status: 'ready',
        service: 'api',
        releaseSha: 'development',
        checkedAt: '2026-07-23T02:00:00.000Z',
        checks: [{ name: 'database', status: 'ready' }],
      }),
    ).toHaveProperty('status', 'ready');

    expect(() =>
      readinessResponseSchema.parse({
        status: 'ready',
        service: 'api',
        releaseSha: 'development',
        checkedAt: '2026-07-23T02:00:00.000Z',
        checks: [{ name: 'database', status: 'not_ready' }],
      }),
    ).toThrow();
  });
});
