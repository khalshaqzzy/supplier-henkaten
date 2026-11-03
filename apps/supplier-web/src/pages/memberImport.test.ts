import { describe, expect, it } from 'vitest';
import { parseMemberCsv, parseMemberSheets, memberCsvTemplate } from './memberImport';

const headers = ['Kode member', 'Nama', 'Role', 'Nomor registrasi', 'Username', 'Password awal'];
describe('member file import', () => {
  it('reads BOM, semicolons, quoted names, blank records and exact password text', () => {
    const parsed = parseMemberCsv(
      '\uFEFF' +
        headers.join(';') +
        '\r\n\r\nQC-01;"QC, Satu";QC;0012;qc.satu; password exact \r\n',
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        sheet: 'Member',
        sourceRow: 3,
        data: {
          code: 'QC-01',
          name: 'QC, Satu',
          role: 'QC',
          registration: '0012',
          username: 'qc.satu',
          password: ' password exact ',
        },
      },
    ]);
  });
  it('keeps physical source lines after quoted multiline records', () => {
    const parsed = parseMemberCsv(
      headers.join(',') + '\nMP1,"Nama\nPanjang",MP,,,\nMP2,Kedua,MP,,,',
    );
    expect(parsed.rows.map((row) => row.sourceRow)).toEqual([2, 4]);
  });
  it('imports only the Member sheet and reports ignored data', () => {
    const parsed = parseMemberSheets([
      { sheet: 'Line', data: [['Kode line'], ['L1']] },
      { sheet: 'Member', data: [headers, ['M1', 'Operator', 'MP']] },
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.sheet).toBe('Member');
    expect(parsed.warnings).toContain('Hanya sheet Member diimport. 1 sheet lain diabaikan.');
  });
  it('accepts one unambiguous worksheet but rejects multiple unnamed candidates', () => {
    expect(
      parseMemberSheets([{ sheet: 'Staff', data: [headers, ['M1', 'Operator', 'MP']] }]).rows,
    ).toHaveLength(1);
    expect(() =>
      parseMemberSheets([
        { sheet: 'A', data: [headers] },
        { sheet: 'B', data: [headers] },
      ]),
    ).toThrow('nama sheet Member');
  });
  it('rejects malformed CSV and oversized batches before matching', () => {
    expect(() => parseMemberCsv('Kode member,Nama,Role\nM1,"broken,MP')).toThrow(
      'CSV tidak dapat dibaca',
    );
    expect(() =>
      parseMemberCsv(
        headers.join(',') +
          '\n' +
          Array.from({ length: 301 }, (_, i) => `M${i},Operator,MP,,,`).join('\n'),
      ),
    ).toThrow('300 baris');
  });
  it('keeps identifiers as text and reports unsafe Excel numbers and numeric passwords', () => {
    const parsed = parseMemberSheets([
      {
        sheet: 'Member',
        data: [headers, [Number.MAX_SAFE_INTEGER + 1, 'QC', 'QC', '001', 'qc', 123456789012]],
      },
    ]);
    expect(parsed.issues.map((issue) => issue.column)).toContain('Kode member');
    expect(parsed.issues.map((issue) => issue.column)).toContain('Password awal');
  });
  it('supports reordered headers and diagnoses duplicate headers without exposing passwords', () => {
    const parsed = parseMemberCsv(
      'Role,Nama,Kode member,Kode member,Password awal\nMP,Operator,M1,M2,secret',
    );
    expect(parsed.issues.some((issue) => issue.column === 'Kode member')).toBe(true);
    expect(JSON.stringify(parsed.issues)).not.toContain('secret');
  });
  it('provides a header-only CSV template', () => {
    expect(memberCsvTemplate()).toBe('\uFEFF' + headers.join(',') + '\r\n');
  });
});
