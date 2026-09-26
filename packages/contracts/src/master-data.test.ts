import { describe, expect, it } from 'vitest';

import {
  createMemberRequestSchema,
  createShiftTemplateRequestSchema,
  masterListQuerySchema,
  partImportPreviewRequestSchema,
  updateMemberRequestSchema,
} from './master-data.js';

describe('master-data contracts', () => {
  it('requires credentials for operational account roles and forbids them for MP', () => {
    expect(
      createMemberRequestSchema.safeParse({ role: 'MP', fullName: 'Example MP' }).success,
    ).toBe(true);
    expect(
      createMemberRequestSchema.safeParse({
        role: 'SUPERVISOR',
        fullName: 'Example Supervisor',
        registrationNumber: 'TEST-001',
      }).success,
    ).toBe(false);
    expect(
      createMemberRequestSchema.safeParse({
        role: 'MP',
        fullName: 'Example MP',
        registrationNumber: 'TEST-002',
        username: 'not-allowed',
      }).success,
    ).toBe(false);
  });

  it('does not expose role as a mutable member field', () => {
    expect(updateMemberRequestSchema.safeParse({ expectedVersion: 1, role: 'QC' }).success).toBe(
      false,
    );
  });

  it('applies bounded pagination and strict local time', () => {
    expect(masterListQuerySchema.parse({})).toMatchObject({ limit: 25, active: 'ACTIVE' });
    expect(masterListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      createShiftTemplateRequestSchema.safeParse({
        name: 'Shift',
        startTime: '24:00',
        endTime: '06:00',
        timezone: 'Asia/Jakarta',
      }).success,
    ).toBe(false);
  });

  it('accepts at most 50,000 part import rows', () => {
    const row = { partNumber: '1', partName: 'Part' };
    expect(
      partImportPreviewRequestSchema.safeParse({ rows: Array(50_000).fill(row) }).success,
    ).toBe(true);
    expect(
      partImportPreviewRequestSchema.safeParse({ rows: Array(50_001).fill(row) }).success,
    ).toBe(false);
  });
});
