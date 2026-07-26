import { describe, expect, it } from 'vitest';

import {
  externalHealthSchema,
  sourceCutoverRequestSchema,
  supplierListQuerySchema,
  tmminDashboardExtendedSchema,
  tmminHenkatenSummarySchema,
} from './index.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('TMMIN governance and monitoring contracts', () => {
  it('requires privacy acknowledgement for source cutover', () => {
    expect(
      sourceCutoverRequestSchema.safeParse({
        targetMode: 'EXTERNAL',
        expectedVersion: 1,
        reason: 'Approved operational source transition.',
        privacyAcknowledged: false,
      }).success,
    ).toBe(false);
  });

  it('keeps Hosted and External explorer summaries discriminated', () => {
    const common = {
      recordId: id,
      supplierId: id,
      supplierCode: 'SUP-01',
      supplierName: 'Supplier',
      sourceMode: 'EXTERNAL',
      sourceEpoch: 2,
      status: 'OPEN',
      category: 'MAN',
      lineName: 'Line 1',
      jobName: 'Job 1',
      partNumber: 'P-1',
      partName: 'Part 1',
      occurredAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      displayId: 'EXT-1',
    };
    expect(
      tmminHenkatenSummarySchema.parse({
        ...common,
        kind: 'EXTERNAL',
        sourceVersion: 3,
      }),
    ).not.toHaveProperty('supervisorStatus');
  });

  it('normalizes server list defaults and rejects raw diagnostic payload fields', () => {
    expect(supplierListQuerySchema.parse({})).toMatchObject({
      limit: 25,
      status: 'ALL',
      sort: 'NAME_ASC',
    });
    const health = {
      generatedAt: '2026-07-25T00:00:00.000Z',
      totals: { accepted: 1, duplicate: 0, rejected: 0, fresh: 1, warning: 0, stale: 0, noData: 0 },
      suppliers: [],
      events: [
        {
          id,
          supplierId: id,
          supplierName: 'Supplier',
          sourceEpoch: 1,
          outcome: 'ACCEPTED',
          eventId: 'evt-1',
          sourceHenkatenId: 'hen-1',
          projectionId: id,
          code: null,
          correlationId: 'corr-1',
          occurredAt: '2026-07-25T00:00:00.000Z',
          rawPayload: { forbidden: true },
        },
      ],
      pageInfo: { hasNextPage: false, nextCursor: null },
    };
    expect(externalHealthSchema.safeParse(health).success).toBe(false);
  });

  it('strictly parses additive dashboard projections', () => {
    const dashboard = {
      generatedAt: '2026-07-26T00:00:00.000Z',
      filterOptions: { suppliers: [] },
      suppliers: { active: 0, hosted: 0, external: 0, withWarnings: 0 },
      openHenkatens: 0,
      affectedParts: 0,
      emergencyOverrides: 0,
      externalIngestion: { accepted: 0, duplicate: 0, rejected: 0, recentRejected: 0 },
      aging: [],
      bySourceMode: [],
      byCategory: [],
      outcomes: [],
      rankings: { suppliers: [], lines: [], parts: [] },
      trend: [
        {
          bucketStart: '2026-07-26T00:00:00.000Z',
          hosted: 0,
          external: 0,
          total: 0,
          open: 0,
          approved: 0,
          rejected: 0,
          cancelled: 0,
        },
      ],
      freshnessSummary: { fresh: 0, warning: 0, stale: 0, noData: 0 },
      supplierOverview: [],
      freshness: [],
      recentOverrides: [],
    };

    expect(tmminDashboardExtendedSchema.parse(dashboard).trend).toHaveLength(1);
    expect(
      tmminDashboardExtendedSchema.safeParse({
        ...dashboard,
        trend: [{ ...dashboard.trend[0], inferredDelta: 12 }],
      }).success,
    ).toBe(false);
  });
});
