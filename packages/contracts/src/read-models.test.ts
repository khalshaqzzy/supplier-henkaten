import { describe, expect, it } from 'vitest';

import {
  assignmentBoardSchema,
  notificationListQuerySchema,
  notificationReadRequestSchema,
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

  it('requires accessible board state in addition to category color', () => {
    const parsed = assignmentBoardSchema.parse({
      version: 'stable-version',
      lastUpdatedAt: '2026-07-23T00:00:00.000Z',
      lines: [
        {
          shiftRunId: '00000000-0000-4000-8000-000000000001',
          lineId: '00000000-0000-4000-8000-000000000002',
          lineCode: 'L1',
          lineName: 'Assembly',
          shiftName: 'Shift 1',
          businessDate: '2026-07-23',
          supervisor: { memberId: null, name: null },
          lineLeader: { memberId: null, name: null },
          jobs: [
            {
              assignmentId: '00000000-0000-4000-8000-000000000003',
              jobId: '00000000-0000-4000-8000-000000000004',
              jobName: 'Torque',
              displayOrder: 1,
              state: 'VACANT',
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
                  category: 'MACHINE',
                  status: 'OPEN',
                  approval: { supervisor: 'PENDING', qc: 'PENDING' },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.lines[0]?.jobs[0]?.indicators[0]?.status).toBe('OPEN');
  });
});
