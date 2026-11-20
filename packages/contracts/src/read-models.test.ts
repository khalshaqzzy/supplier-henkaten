import { describe, expect, it } from 'vitest';

import {
  assignmentBoardSchema,
  boardQuerySchema,
  notificationListQuerySchema,
  notificationReadRequestSchema,
  supplierDashboardActivitySchema,
} from './read-models.js';

describe('read-model contracts', () => {
  it('coerces bounded notification queries and rejects unknown mutation fields', () => {
    expect(notificationListQuerySchema.parse({ limit: '10', unreadOnly: 'true' })).toEqual({
      limit: 10,
      unreadOnly: true,
    });
    expect(
      notificationReadRequestSchema.safeParse({
        read: true,
        expectedVersion: 1,
        closesWarning: true,
      }).success,
    ).toBe(false);
  });

  it('requires accessible board state in addition to category color and keeps schedule fields rollout-compatible', () => {
    expect(boardQuerySchema.parse({ shiftStatus: 'ALL', includeSchedule: 'true' })).toEqual({
      shiftStatus: 'ALL',
      includeSchedule: true,
    });
    const baseLine = {
      shiftRunId: '00000000-0000-4000-8000-000000000001',
      lineId: '00000000-0000-4000-8000-000000000002',
      lineCode: 'L1',
      lineName: 'Assembly',
      shiftName: 'Shift 1',
      isCurrent: true,
      businessDate: '2026-07-23',
      supervisor: { memberId: null, name: null },
      lineLeaders: [],
      activeOverride: null,
      jobs: [
        {
          assignmentId: '00000000-0000-4000-8000-000000000003',
          jobId: '00000000-0000-4000-8000-000000000004',
          jobName: 'Torque',
          displayOrder: 1,
          state: 'VACANT' as const,
          mp: {
            memberId: null,
            name: null,
            registrationNumber: null,
            photoThumbnailUrl: null,
            initials: null,
          },
          indicators: [
            {
              henkatenId: '00000000-0000-4000-8000-000000000005',
              identifier: 'HEN-001',
              category: 'MACHINE' as const,
              status: 'OPEN' as const,
              approval: { supervisor: 'PENDING' as const, qc: 'PENDING' as const },
            },
          ],
        },
      ],
    };
    const legacy = assignmentBoardSchema.parse({
      version: 'stable-version',
      lastUpdatedAt: '2026-07-23T00:00:00.000Z',
      lines: [baseLine],
    });
    expect(legacy.lines[0]?.startTime).toBeUndefined();
    const expanded = assignmentBoardSchema.parse({
      version: 'stable-version',
      lastUpdatedAt: '2026-07-23T00:00:00.000Z',
      lines: [
        {
          ...baseLine,
          startTime: '07:00',
          endTime: '15:00',
          crossesMidnight: false,
          timezone: 'Asia/Jakarta',
        },
      ],
    });
    expect(expanded.lines[0]?.jobs[0]?.indicators[0]?.status).toBe('OPEN');
    expect(expanded.lines[0]?.timezone).toBe('Asia/Jakarta');
  });

  it('requires scoped actor and optional Henkaten evidence for dashboard activity', () => {
    const activity = {
      id: '00000000-0000-4000-8000-000000000001',
      action: 'HENKATEN_APPROVED',
      resourceType: 'Henkaten',
      resourceId: '00000000-0000-4000-8000-000000000002',
      occurredAt: '2026-07-28T00:00:00.000Z',
      actor: { kind: 'USER', displayName: 'Supervisor Test', role: 'SUPERVISOR' },
      henkaten: {
        id: '00000000-0000-4000-8000-000000000002',
        identifier: 'HEN-SUP-20260728-0001',
        category: 'MAN',
        status: 'APPROVED',
        line: { code: 'L1', name: 'Assembly' },
        jobName: 'Torque',
        part: { number: 'PART-1', name: 'Part One' },
      },
    };
    expect(supplierDashboardActivitySchema.parse(activity).henkaten?.identifier).toBe(
      'HEN-SUP-20260728-0001',
    );
    expect(
      supplierDashboardActivitySchema.parse({
        ...activity,
        actor: { kind: 'SYSTEM', displayName: null, role: null },
        henkaten: null,
      }).henkaten,
    ).toBeNull();
    expect(
      supplierDashboardActivitySchema.safeParse({ ...activity, narrative: 'must not leak' })
        .success,
    ).toBe(false);
  });
});
