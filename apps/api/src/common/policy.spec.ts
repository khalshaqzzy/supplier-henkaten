import { describe, expect, it } from 'vitest';

import { capabilitiesForPrincipal } from './policy.js';

describe('purpose-aware Supplier capabilities', () => {
  it('keeps normal operational capabilities and restricts Hosted Preparation', () => {
    const normal = capabilitiesForPrincipal({
      role: 'SUPPLIER_ADMIN',
      purpose: 'NORMAL',
    });
    expect(normal.has('SUPPLIER_DASHBOARD_READ')).toBe(true);
    expect(normal.has('SUPPLIER_MASTER_DATA_MANAGE')).toBe(true);

    const preparation = capabilitiesForPrincipal({
      role: 'SUPPLIER_ADMIN',
      purpose: 'HOSTED_PREPARATION',
    });
    expect(preparation.has('SUPPLIER_MASTER_DATA_MANAGE')).toBe(true);
    expect(preparation.has('SUPPLIER_SELF_SERVICE')).toBe(true);
    expect(preparation.has('SUPPLIER_DASHBOARD_READ')).toBe(false);
    expect(preparation.has('SUPPLIER_BOARD_READ')).toBe(false);
    expect(preparation.has('SUPPLIER_SHIFT_OVERRIDE')).toBe(false);
  });

  it('grants PRD audit visibility to normal scoped supplier roles', () => {
    for (const role of ['SUPERVISOR', 'LINE_LEADER', 'QC'] as const) {
      expect(capabilitiesForPrincipal({ role, purpose: 'NORMAL' }).has('SUPPLIER_AUDIT_READ')).toBe(
        true,
      );
    }
  });
});
