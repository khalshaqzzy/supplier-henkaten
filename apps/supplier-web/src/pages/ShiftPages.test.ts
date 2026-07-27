import { describe, expect, it } from 'vitest';

import { openAssignmentIssues } from './ShiftPages';

describe('Shift assignment resolution', () => {
  it('keeps only open issues actionable for the resolution wizard', () => {
    const issues = [
      { id: 'open-issue', status: 'OPEN' },
      { id: 'resolved-issue', status: 'RESOLVED' },
      { id: 'ended-issue', status: 'CLOSED_SHIFT_ENDED' },
    ];

    expect(openAssignmentIssues(issues)).toEqual([{ id: 'open-issue', status: 'OPEN' }]);
  });
});
