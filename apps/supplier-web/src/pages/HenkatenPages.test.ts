import { describe, expect, it } from 'vitest';

import { canDecideHenkaten } from './HenkatenPages';

describe('Henkaten approval action ownership', () => {
  it('offers a pending Supervisor decision only to its current owner and keeps QC shared', () => {
    const pending = {
      hasCapability: true,
      status: 'OPEN',
      routeStatus: 'PENDING',
      responsibleMemberId: 'new-supervisor',
    };
    expect(canDecideHenkaten({ ...pending, role: 'SUPERVISOR', memberId: 'old-supervisor' })).toBe(
      false,
    );
    expect(canDecideHenkaten({ ...pending, role: 'SUPERVISOR', memberId: 'new-supervisor' })).toBe(
      true,
    );
    expect(canDecideHenkaten({ ...pending, role: 'QC' })).toBe(true);
    expect(
      canDecideHenkaten({
        ...pending,
        status: 'REJECTED',
        role: 'SUPERVISOR',
        memberId: 'new-supervisor',
      }),
    ).toBe(false);
  });
});
