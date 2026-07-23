import { describe, expect, it } from 'vitest';

import {
  FIXED_NOW,
  buildAssignment,
  buildAssignmentIssue,
  buildChecklistVersion,
  buildExternalEvent,
  buildExternalSupplier,
  buildHealthResponse,
  buildHenkaten,
  buildHostedSupplier,
  buildJob,
  buildLine,
  buildMember,
  buildPart,
  buildReservation,
  buildShift,
  buildUser,
  deterministicUuid,
} from './builders.js';

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectKeys(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
  }

  return [];
}

describe('deterministic fixture builders', () => {
  it('returns stable UUIDs and rejects invalid sequences', () => {
    expect(deterministicUuid(1)).toBe('00000000-0000-4000-8000-000000000001');
    expect(deterministicUuid(2)).not.toBe(deterministicUuid(1));
    expect(() => deterministicUuid(-1)).toThrow();
  });

  it('produces identical output for identical input', () => {
    expect(buildHenkaten('MATERIAL', 'OPEN')).toEqual(buildHenkaten('MATERIAL', 'OPEN'));
    expect(buildExternalEvent()).toEqual(buildExternalEvent());
  });

  it('applies explicit overrides without changing unrelated defaults', () => {
    const baseline = buildLine();
    const overridden = buildLine({ lineName: 'Example Override' });

    expect(overridden.lineName).toBe('Example Override');
    expect(overridden.id).toBe(baseline.id);
    expect(overridden.supplierId).toBe(baseline.supplierId);
  });

  it('covers foundational supplier, identity, and domain fixture families', () => {
    expect(buildHostedSupplier().sourceMode).toBe('HOSTED');
    expect(buildExternalSupplier().sourceMode).toBe('EXTERNAL');
    expect(buildUser('TMMIN_ADMIN')).not.toHaveProperty('supplierId');
    expect(buildUser('SUPERVISOR')).toHaveProperty('supplierId');
    expect(buildMember('MP').registrationNumber).toMatch(/^TEST-REG-/);
    expect(buildJob()).toHaveProperty('lineId');
    expect(buildPart()).toHaveProperty('partNumber');
    expect(buildShift()).toHaveProperty('status', 'NOT_STARTED');
    expect(buildChecklistVersion('METHOD')).toHaveProperty('category', 'METHOD');
    expect(buildAssignment('DEFAULT')).toHaveProperty('kind', 'DEFAULT');
    expect(buildAssignment('WORKING')).toHaveProperty('kind', 'WORKING');
    expect(buildReservation()).toHaveProperty('active', true);
    expect(buildAssignmentIssue()).toHaveProperty('status', 'OPEN');
    expect(buildHealthResponse()).toHaveProperty('checkedAt', FIXED_NOW);
  });

  it('covers every Henkaten category and terminal outcome', () => {
    for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const) {
      expect(buildHenkaten(category).category).toBe(category);
    }

    for (const status of ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(buildHenkaten('MAN', status).status).toBe(status);
    }
  });

  it('keeps forbidden External PII and credential fields out of event fixtures', () => {
    const forbiddenKeys = new Set([
      'registrationNumber',
      'photo',
      'username',
      'password',
      'credential',
      'secret',
      'email',
      'phone',
      'health',
      'attendance',
      'skill',
      'token',
    ]);
    const keys = collectKeys(buildExternalEvent());

    expect(keys.filter((key) => forbiddenKeys.has(key))).toEqual([]);
  });
});
