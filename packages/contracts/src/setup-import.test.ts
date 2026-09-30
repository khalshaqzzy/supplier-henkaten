import { describe, expect, it } from 'vitest';
import {
  setupCommitRequestSchema,
  setupRowKey,
  validateSetupRows,
  type SetupRow,
} from './setup-import.js';

describe('setup workbook rules', () => {
  const mp: SetupRow = {
    sheet: 'Member',
    sourceRow: 2,
    data: { code: 'MP-01', name: 'Operator', role: 'MP' },
  };
  it('keeps MP free of registration and account requirements', () => {
    expect(validateSetupRows([mp], true)).toEqual([]);
    expect(validateSetupRows([{ ...mp, data: { ...mp.data, registration: '0001' } }])).toEqual([
      expect.objectContaining({ column: 'Role' }),
    ]);
  });
  it('detects normalized duplicates without leaking password values', () => {
    const issues = validateSetupRows([
      mp,
      { ...mp, sourceRow: 8, data: { ...mp.data, code: ' mp-01 ' } },
    ]);
    expect(issues).toContainEqual(
      expect.objectContaining({ sourceRow: 8, message: 'Duplikat dengan baris 2.' }),
    );
  });
  it('accepts overnight schedules but rejects equal boundaries and invalid timezone', () => {
    const shift: SetupRow = {
      sheet: 'Shift',
      sourceRow: 2,
      data: {
        code: 'NIGHT',
        name: 'Night',
        start: '23:00',
        end: '07:00',
        order: '1',
        timezone: 'Asia/Jakarta',
      },
    };
    expect(validateSetupRows([shift])).toEqual([]);
    expect(
      validateSetupRows([
        { ...shift, data: { ...shift.data, end: '23:00', timezone: 'Invalid/Zone' } },
      ]),
    ).toHaveLength(2);
  });
  it('treats checklist decisions as complete categories', () => {
    expect(setupRowKey({ sheet: 'Checklist 4M', sourceRow: 5, data: { category: 'MAN' } })).toBe(
      'Checklist 4M:MAN',
    );
  });
  it('checks new account passwords without including their contents in errors', () => {
    const member: SetupRow = {
      ...mp,
      data: { ...mp.data, role: 'QC', registration: 'QC-01', username: 'qc', password: 'short' },
    };
    const issues = validateSetupRows([member], true);
    expect(issues).toContainEqual(
      expect.objectContaining({ column: 'Password awal', message: 'Gunakan 12–128 karakter.' }),
    );
    expect(JSON.stringify(issues)).not.toContain('short');
  });
  it('rejects unknown fields and oversized cells before persistence', () => {
    expect(
      setupCommitRequestSchema.safeParse({
        rows: [{ ...mp, data: { name: 'x'.repeat(501) } }],
        decisions: [],
        revision: 1,
      }).success,
    ).toBe(false);
    expect(
      validateSetupRows([{ ...mp, data: { ...mp.data, supplierId: 'foreign' } }]),
    ).toContainEqual(expect.objectContaining({ column: 'supplierId' }));
  });
});
