import { describe, expect, it } from 'vitest';

import { dashboardTrend, type DashboardRecord } from './read-model.service.js';

function record(
  occurredAt: string,
  sourceMode: 'HOSTED' | 'EXTERNAL',
  status: DashboardRecord['status'],
): DashboardRecord {
  return {
    supplierId: `${sourceMode}-${occurredAt}`,
    supplierName: sourceMode,
    sourceMode,
    status,
    category: 'MAN',
    line: 'Line 1',
    part: 'P-001',
    occurredAt: new Date(occurredAt),
  };
}

describe('dashboardTrend', () => {
  it('zero-fills daily buckets and separates source and outcome counters', () => {
    const result = dashboardTrend(
      [
        record('2026-07-01T08:00:00.000Z', 'HOSTED', 'OPEN'),
        record('2026-07-03T09:00:00.000Z', 'EXTERNAL', 'APPROVED'),
      ],
      'DAY',
      '2026-07-01T00:00:00.000Z',
      '2026-07-03T23:59:59.999Z',
    );

    expect(result).toEqual([
      {
        bucketStart: '2026-07-01T00:00:00.000Z',
        hosted: 1,
        external: 0,
        total: 1,
        open: 1,
        approved: 0,
        rejected: 0,
        cancelled: 0,
      },
      {
        bucketStart: '2026-07-02T00:00:00.000Z',
        hosted: 0,
        external: 0,
        total: 0,
        open: 0,
        approved: 0,
        rejected: 0,
        cancelled: 0,
      },
      {
        bucketStart: '2026-07-03T00:00:00.000Z',
        hosted: 0,
        external: 1,
        total: 1,
        open: 0,
        approved: 1,
        rejected: 0,
        cancelled: 0,
      },
    ]);
  });

  it('uses Monday and month boundaries for wider granularities', () => {
    expect(
      dashboardTrend(
        [record('2026-07-26T09:00:00.000Z', 'HOSTED', 'REJECTED')],
        'WEEK',
        '2026-07-20T00:00:00.000Z',
        '2026-07-26T23:59:59.999Z',
      ),
    ).toHaveLength(1);
    expect(
      dashboardTrend(
        [record('2026-07-26T09:00:00.000Z', 'EXTERNAL', 'CANCELLED')],
        'MONTH',
        '2026-06-01T00:00:00.000Z',
        '2026-07-31T23:59:59.999Z',
      ),
    ).toEqual([
      expect.objectContaining({ bucketStart: '2026-06-01T00:00:00.000Z', total: 0 }),
      expect.objectContaining({
        bucketStart: '2026-07-01T00:00:00.000Z',
        external: 1,
        cancelled: 1,
      }),
    ]);
  });
});
