// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardHenkatenIndicator, BoardRiskAction, boardOperationalRisks } from './BoardPage';

afterEach(cleanup);

describe('Assignment Board operational evidence', () => {
  it('does not model an Open Man Henkaten as a reservation', () => {
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

    expect(boardOperationalRisks(lines)).toEqual([]);
  });

  it('routes a vacant assignment to Line Setup', () => {
    const lines = [
      {
        lineId: '00000000-0000-4000-8000-000000000009',
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
        lineId: '00000000-0000-4000-8000-000000000009',
      },
    ]);
  });

  it('does not surface legacy reserved assignment state as a blocking risk', () => {
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

    expect(boardOperationalRisks(lines)).toEqual([]);
  });

  it('renders an accessible Line Setup action for assignment issues', () => {
    const [issue] = boardOperationalRisks([
      {
        lineId: '00000000-0000-4000-8000-000000000009',
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

    render(createElement(MemoryRouter, {}, createElement(BoardRiskAction, { risk: issue! })));
    const lineSetup = screen.getByRole('link', { name: 'Line Setup' });
    expect(lineSetup.getAttribute('href')).toBe(
      '/master-data/line-setup?lineId=00000000-0000-4000-8000-000000000009',
    );
    expect(lineSetup.classList.contains('hds-button--primary')).toBe(true);
    expect(lineSetup.classList.contains('board-risk-action')).toBe(true);
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
