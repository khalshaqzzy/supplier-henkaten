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
  it('provides 20 valid CSV examples matching the Excel template', () => {
    const parsed = parseMemberCsv(memberCsvTemplate());
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(20);
    expect(parsed.rows[0]?.data['password']).toBe('MemberAwal01');
    expect(parsed.rows[0]?.data['password']).toHaveLength(12);
    expect(parsed.rows[0]?.data['registration']).toBe('001001');
    expect(parsed.rows.filter((row) => row.data['role'] === 'MP')).toHaveLength(13);
  });
  it.each(['', 'Kode member,Nama,Role', 'Kode member,Nama,Role\n,,,'])(
    'explains files without member rows',
    (source) => {
      expect(() => parseMemberCsv(source)).toThrow('Isi setidaknya satu baris');
    },
  );
  it('reports shifted CSV fields instead of silently discarding extra cells', () => {
    const parsed = parseMemberCsv(headers.join(',') + '\nM1,Operator,MP,,,,extra');
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        sourceRow: 2,
        column: 'Susunan kolom',
        message: expect.stringContaining('7 kolom; header memiliki 6'),
      }),
    );
    expect(JSON.stringify(parsed.issues)).not.toContain('extra');
  });
  it('reports short CSV rows with physical line numbers', () => {
    const parsed = parseMemberCsv(headers.join(',') + '\n\nM1,Operator,MP');
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ sourceRow: 3, column: 'Susunan kolom' }),
    );
  });
  it('keeps duplicate-code locations accurate after empty lines and multiline names', () => {
    const parsed = parseMemberCsv(
      headers.join(',') + '\n\nM1,"Nama\nPanjang",MP,,,\n m1 ,Kedua,MP,,,',
    );
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ sourceRow: 5, message: 'Duplikat dengan baris 3.' }),
    );
  });
  it('explains unsafe Excel identifiers and numeric passwords without including the values', () => {
    const parsed = parseMemberSheets([
      {
        sheet: 'Member',
        data: [headers, [9007199254740992, 'QC', 'QC', '001', 'qc', 123456789012]],
      },
    ]);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        column: 'Kode member',
        message: expect.stringContaining('ketik ulang'),
      }),
    );
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        column: 'Password awal',
        message: expect.stringContaining('harus berupa teks'),
      }),
    );
    expect(JSON.stringify(parsed.issues)).not.toContain('123456789012');
  });
});
