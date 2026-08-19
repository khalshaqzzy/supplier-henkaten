// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardHenkatenIndicator, BoardRiskAction, boardOperationalRisks } from './BoardPage';

afterEach(cleanup);

describe('Assignment Board operational evidence', () => {
  it('surfaces an Open Man Henkaten as an active reservation without changing assignment state', () => {
    const lines = [
      {
        shiftRunId: '00000000-0000-4000-8000-000000000003',
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
    ] as unknown as Parameters<typeof boardOperationalRisks>[0];

    expect(boardOperationalRisks(lines)).toEqual([
      {
        key: 'reservation:00000000-0000-4000-8000-000000000002',
        kind: 'RESERVATION',
        jobName: 'Function Test',
        label: 'Reservation aktif · HEN-GKI-20260727-0004',
        henkatenId: '00000000-0000-4000-8000-000000000002',
        resolutionShiftRunId: null,
      },
    ]);
  });

  it('routes a vacant assignment directly to its Shift resolution wizard', () => {
    const lines = [
      {
        shiftRunId: '00000000-0000-4000-8000-000000000010',
        jobs: [
          {
            assignmentId: '00000000-0000-4000-8000-000000000011',
            jobName: 'Press Forming',
            state: 'VACANT',
            indicators: [],
          },
        ],
      },
    ] as unknown as Parameters<typeof boardOperationalRisks>[0];

    expect(boardOperationalRisks(lines)).toEqual([
      {
        key: 'assignment:00000000-0000-4000-8000-000000000011',
        kind: 'ISSUE',
        jobName: 'Press Forming',
        label: 'Assignment issue · Vacant',
        henkatenId: null,
        resolutionShiftRunId: '00000000-0000-4000-8000-000000000010',
      },
    ]);
  });

  it('does not create a duplicate dead-end row for a reserved assignment', () => {
    const lines = [
      {
        shiftRunId: '00000000-0000-4000-8000-000000000010',
        jobs: [
          {
            assignmentId: '00000000-0000-4000-8000-000000000011',
            jobName: 'Press Forming',
            state: 'RESERVED',
            indicators: [
              {
                henkatenId: '00000000-0000-4000-8000-000000000012',
                identifier: 'HEN-GKI-20260727-0005',
                category: 'MAN',
                status: 'OPEN',
              },
            ],
          },
        ],
      },
    ] as unknown as Parameters<typeof boardOperationalRisks>[0];

    expect(boardOperationalRisks(lines)).toHaveLength(1);
    expect(boardOperationalRisks(lines)[0]).toMatchObject({
      kind: 'RESERVATION',
      henkatenId: '00000000-0000-4000-8000-000000000012',
    });
  });

  it('renders polished accessible actions for issues and reservations', () => {
    const [issue] = boardOperationalRisks([
      {
        shiftRunId: '00000000-0000-4000-8000-000000000010',
        jobs: [
          {
            assignmentId: '00000000-0000-4000-8000-000000000011',
            jobName: 'Press Forming',
            state: 'VACANT',
            indicators: [],
          },
        ],
      },
    ] as unknown as Parameters<typeof boardOperationalRisks>[0]);

    const { rerender } = render(
      createElement(MemoryRouter, {}, createElement(BoardRiskAction, { risk: issue! })),
    );
    const resolution = screen.getByRole('link', { name: 'Buka resolusi' });
    expect(resolution.getAttribute('href')).toBe(
      '/shifts/00000000-0000-4000-8000-000000000010/resolve',
    );
    expect(resolution.classList.contains('hds-button--primary')).toBe(true);
    expect(resolution.classList.contains('board-risk-action')).toBe(true);

    const [reservation] = boardOperationalRisks([
      {
        shiftRunId: '00000000-0000-4000-8000-000000000010',
        jobs: [
          {
            assignmentId: '00000000-0000-4000-8000-000000000011',
            jobName: 'Press Forming',
            state: 'ASSIGNED',
            indicators: [
              {
                henkatenId: '00000000-0000-4000-8000-000000000012',
                identifier: 'HEN-GKI-20260727-0005',
                category: 'MAN',
                status: 'OPEN',
              },
            ],
          },
        ],
      },
    ] as unknown as Parameters<typeof boardOperationalRisks>[0]);
    rerender(
      createElement(MemoryRouter, {}, createElement(BoardRiskAction, { risk: reservation! })),
    );
    const henkaten = screen.getByRole('link', { name: 'Buka Henkaten' });
    expect(henkaten.getAttribute('href')).toBe('/henkatens/00000000-0000-4000-8000-000000000012');
    expect(henkaten.classList.contains('hds-button--secondary')).toBe(true);
    expect(henkaten.classList.contains('board-risk-action')).toBe(true);
  });

  it('renders an accessible Henkaten link with the shared category dot', () => {
    render(
      createElement(
        MemoryRouter,
        {},
        createElement(BoardHenkatenIndicator, {
          indicator: {
            henkatenId: '00000000-0000-4000-8000-000000000002',
            identifier: 'HEN-GKI-20260727-0004',
            category: 'METHOD',
            status: 'OPEN',
          },
        }),
      ),
    );

    const link = screen.getByRole('link', {
      name: 'METHOD OPEN: HEN-GKI-20260727-0004',
    });
    expect(link.getAttribute('href')).toBe('/henkatens/00000000-0000-4000-8000-000000000002');
    expect(link.querySelector('.hds-4m-dot')?.classList.contains('hds-4m-dot--method')).toBe(true);
  });
});
