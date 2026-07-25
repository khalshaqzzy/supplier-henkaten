import { describe, expect, it } from 'vitest';

import {
  passwordChangeRequestSchema,
  sessionPrincipalSchema,
  sessionResponseSchema,
  supplierLoginRequestSchema,
  tmminLoginRequestSchema,
} from './auth.js';

const userId = '00000000-0000-4000-8000-000000000001';
const supplierId = '00000000-0000-4000-8000-000000000002';

describe('authentication contracts', () => {
  it('keeps supplier and TMMIN login shapes separate', () => {
    expect(
      supplierLoginRequestSchema.parse({
        supplierCode: 'SUP-001',
        username: 'admin',
        password: 'input-only',
      }),
    ).toHaveProperty('supplierCode', 'SUP-001');

    expect(
      tmminLoginRequestSchema.parse({
        username: 'quality',
        password: 'input-only',
      }),
    ).not.toHaveProperty('supplierCode');
  });

  it('enforces realm, role, and supplier-scope consistency', () => {
    expect(
      sessionPrincipalSchema.parse({
        userId,
        displayName: 'Line Leader Test',
        realm: 'SUPPLIER',
        role: 'LINE_LEADER',
        supplierId,
        purpose: 'NORMAL',
        mustChangePassword: false,
      }),
    ).toHaveProperty('supplierId', supplierId);

    expect(() =>
      sessionPrincipalSchema.parse({
        userId,
        displayName: 'Invalid Principal',
        realm: 'TMMIN',
        role: 'LINE_LEADER',
        supplierId,
        purpose: 'NORMAL',
        mustChangePassword: false,
      }),
    ).toThrow();
  });

  it('requires a new password with policy length and a changed value', () => {
    expect(
      passwordChangeRequestSchema.parse({
        currentPassword: 'old-password-value',
        newPassword: 'new-password-value',
      }),
    ).toHaveProperty('newPassword', 'new-password-value');

    expect(() =>
      passwordChangeRequestSchema.parse({
        currentPassword: 'same-password',
        newPassword: 'same-password',
      }),
    ).toThrow();
  });

  it('does not permit password fields in session responses', () => {
    const value = {
      principal: {
        userId,
        displayName: 'TMMIN Quality Test',
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        purpose: 'NORMAL',
        mustChangePassword: false,
      },
      capabilities: ['TMMIN_DASHBOARD_READ'],
      idleExpiresAt: '2026-07-23T03:00:00.000Z',
      absoluteExpiresAt: '2026-07-23T14:00:00.000Z',
      csrfToken: 'csrf-token-value-with-more-than-32-characters',
    };

    expect(sessionResponseSchema.parse(value)).toEqual(value);
    expect(() => sessionResponseSchema.parse({ ...value, password: 'forbidden' })).toThrow();
  });
});
