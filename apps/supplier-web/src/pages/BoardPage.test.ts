import { describe, expect, it } from 'vitest';

import { boardCategoryLabel, boardOperationalRisks } from './BoardPage';

describe('Assignment Board operational evidence', () => {
  it('surfaces an Open Man Henkaten as an active reservation without changing assignment state', () => {
    const lines = [
      {
        jobs: [
          {
            assignmentId: '00000000-0000-4000-8000-000000000001',
            jobName: 'Function Test',
            state: 'ASSIGNED',
            indicators: [
              {
                henkatenId: '00000000-0000-4000-8000-000000000002',
                identifier: 'HEN-GKI-20260727-0004',
                category: 'MAN',
                status: 'OPEN',
              },
            ],
          },
        ],
      },
    ] as Parameters<typeof boardOperationalRisks>[0];

    expect(boardOperationalRisks(lines)).toEqual([
      {
        key: 'reservation:00000000-0000-4000-8000-000000000002',
        jobName: 'Function Test',
        label: 'Reservation aktif · HEN-GKI-20260727-0004',
        henkatenId: '00000000-0000-4000-8000-000000000002',
      },
    ]);
  });

  it('uses distinct visible labels for every 4M category', () => {
    expect(
      ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'].map((category) =>
        boardCategoryLabel(category as 'MAN' | 'MACHINE' | 'MATERIAL' | 'METHOD'),
      ),
    ).toEqual(['Man', 'Mac', 'Mat', 'Met']);
  });
});
