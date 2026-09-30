import { describe, expect, it } from 'vitest';
import { parseSetupSheets } from './setupWorkbook';

describe('multi-sheet setup parsing', () => {
  it('preserves text identifiers and actual Excel row locations', () => {
    const result = parseSetupSheets([
      {
        sheet: 'Part',
        data: [
          ['Part number', 'Nama part'],
          [null, null],
          ['0012345', 'Bracket'],
        ],
      },
      {
        sheet: 'Line',
        data: [
          ['Kode line', 'Nama line', 'Urutan'],
          ['L-01', 'Assembly', 1],
        ],
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      sheet: 'Part',
      sourceRow: 3,
      data: { code: '0012345', name: 'Bracket' },
    });
    expect(result.rows).toHaveLength(2);
  });
  it('never converts an unsafe numeric identifier', () => {
    const result = parseSetupSheets([
      {
        sheet: 'Part',
        data: [
          ['Part number', 'Nama part'],
          [Number.MAX_SAFE_INTEGER + 1, 'Bracket'],
        ],
      },
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ column: 'Part number', sourceRow: 2 }),
    );
  });
  it('preserves password whitespace and ignores extra supplier columns', () => {
    const result = parseSetupSheets([
      {
        sheet: 'Member',
        data: [
          [
            'Kode member',
            'Nama',
            'Role',
            'Nomor registrasi',
            'Username',
            'Password awal',
            'Catatan',
          ],
          ['QC-01', ' QC ', 'QC', '001', 'qc', ' password exact ', 'ignored'],
        ],
      },
    ]);
    expect(result.rows[0]?.data['password']).toBe(' password exact ');
    expect(result.rows[0]?.data['name']).toBe('QC');
    expect(result.warnings).toHaveLength(1);
  });
  it('reports missing and duplicated required headers', () => {
    const result = parseSetupSheets([
      {
        sheet: 'Part',
        data: [
          ['Part number', 'Part number'],
          ['A', 'B'],
        ],
      },
    ]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRow: 1, column: 'Part number' }),
        expect.objectContaining({ sourceRow: 1, column: 'Nama part' }),
      ]),
    );
  });
  it('supports native Excel time cells and an overnight interval', () => {
    const result = parseSetupSheets([
      {
        sheet: 'Shift',
        data: [
          ['Kode shift', 'Nama shift', 'Mulai', 'Selesai', 'Urutan', 'Timezone'],
          [
            'N',
            'Night',
            new Date('1899-12-30T23:00:00Z'),
            new Date('1899-12-30T07:00:00Z'),
            1,
            'Asia/Jakarta',
          ],
        ],
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.rows[0]?.data['start']).toBe('23:00');
  });
  it('ignores empty setup sheets but rejects unsupported template versions', () => {
    const data = [
      { sheet: 'Member', data: [] },
      {
        sheet: 'Part',
        data: [
          ['Part number', 'Nama part'],
          ['A', 'Bracket'],
        ],
      },
    ];
    expect(parseSetupSheets(data).rows).toHaveLength(1);
    expect(() =>
      parseSetupSheets([{ sheet: 'Panduan', data: [['Versi format', '999']] }, ...data]),
    ).toThrow('Versi template');
  });
  it('rejects duplicate sheet aliases and empty workbooks', () => {
    expect(() =>
      parseSetupSheets([
        { sheet: 'Part', data: [] },
        { sheet: 'part', data: [] },
      ]),
    ).toThrow('lebih dari sekali');
    expect(() => parseSetupSheets([{ sheet: 'Member', data: [] }])).toThrow('Tidak ada data');
  });
});
