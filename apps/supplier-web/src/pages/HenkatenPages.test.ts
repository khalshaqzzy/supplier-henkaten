import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PcrListStatus, canDecideHenkaten } from './HenkatenPages';

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

describe('Henkaten PCR status labels', () => {
  it('shows a dash for unresolved states while keeping their accessible meaning', () => {
    for (const [value, label] of [
      ['PENDING', 'Menunggu penilaian PCR'],
      ['REVIEW', 'Penilaian PCR perlu ditinjau'],
      [undefined, 'Belum dinilai untuk PCR'],
    ] as const) {
      const html = renderToStaticMarkup(createElement(PcrListStatus, { value }));
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain('>-</span>');
      expect(html).not.toContain('No-PCR');
    }
  });
});
