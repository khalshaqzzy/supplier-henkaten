import { describe, expect, it } from 'vitest';

import { openAssignmentIssues, resolutionIssueAction } from './ShiftPages';

describe('Shift assignment resolution', () => {
  it('keeps only open issues actionable for the resolution wizard', () => {
    const issues = [
      { id: 'open-issue', status: 'OPEN' },
      { id: 'resolved-issue', status: 'RESOLVED' },
      { id: 'ended-issue', status: 'CLOSED_SHIFT_ENDED' },
    ];

    expect(openAssignmentIssues(issues)).toEqual([{ id: 'open-issue', status: 'OPEN' }]);
  });

  it('derives a capability-aware next action without bypassing issue state', () => {
    expect(resolutionIssueAction({ status: 'OPEN', resolutionHenkatenId: null }, true)).toBe(
      'CREATE_HENKATEN',
    );
    expect(resolutionIssueAction({ status: 'OPEN', resolutionHenkatenId: null }, false)).toBe(
      'WAIT',
    );
    expect(
      resolutionIssueAction(
        {
          status: 'RESOLVED',
          resolutionHenkatenId: '10000000-0000-4000-8000-000000000001',
        },
        false,
      ),
    ).toBe('VIEW_HENKATEN');
    expect(
      resolutionIssueAction({ status: 'CLOSED_SHIFT_ENDED', resolutionHenkatenId: null }, true),
    ).toBe('CLOSED');
  });
});
