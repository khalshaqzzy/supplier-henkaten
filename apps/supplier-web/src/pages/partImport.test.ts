import { describe, expect, it } from 'vitest';

import {
  parsePartMatrix,
  preparePartSheet,
  readPartFile,
  suggestedPartMapping,
} from './partImport';

describe('part import rows', () => {
  it('preserves text part numbers and source row numbers', () => {
    expect(
      parsePartMatrix([
        ['Part number', 'Nama part'],
        ['00012', 'Bracket, left'],
        ['', ''],
        ['A-7', 'Bracket right'],
      ]),
    ).toEqual([
      { partNumber: '00012', partName: 'Bracket, left', sourceRow: 2 },
      { partNumber: 'A-7', partName: 'Bracket right', sourceRow: 4 },
    ]);
  });

  it('accepts exact numeric Excel identifiers and rejects imprecise values', () => {
    expect(
      parsePartMatrix([
        ['Part number', 'Nama part'],
        [123456789, 'Numeric part'],
      ]),
    ).toEqual([{ partNumber: '123456789', partName: 'Numeric part', sourceRow: 2 }]);
    expect(() =>
      parsePartMatrix([
        ['Part number', 'Nama part'],
        [Number.MAX_SAFE_INTEGER + 1, 'Unsafe'],
      ]),
    ).toThrow(/bilangan bulat yang presisi/);
    expect(() =>
      parsePartMatrix([
        ['Part number', 'Nama part'],
        [12.5, 'Fraction'],
      ]),
    ).toThrow(/bilangan bulat yang presisi/);
  });

  it('rejects normalized duplicates', () => {
    expect(() =>
      parsePartMatrix([
        ['Part number', 'Nama part'],
        ['Ａ-1', 'First'],
        ['a-1', 'Second'],
      ]),
    ).toThrow(/baris 2 dan 3/);
  });

  it('maps arbitrary columns and ignores unrelated Excel values', () => {
    const sheet = preparePartSheet([
      ['Catatan', 'Kode produksi', 'Deskripsi', 'Tanggal'],
      ['A', 123456789, 'Bracket', new Date('2026-09-26T00:00:00Z')],
    ]);
    expect(suggestedPartMapping(sheet.headers)).toEqual({ numberIndex: -1, nameIndex: -1 });
    expect(parsePartMatrix(sheet.matrix, { numberIndex: 1, nameIndex: 2 })).toEqual([
      { partNumber: '123456789', partName: 'Bracket', sourceRow: 2 },
    ]);
    expect(() => parsePartMatrix(sheet.matrix, { numberIndex: 1, nameIndex: 1 })).toThrow(
      /dua kolom berbeda/,
    );
  });

  it('reads CSV and rejects files larger than 50 MB', async () => {
    const csv = new File(['Part number,Nama part\n123,Bracket\n'], 'parts.csv', {
      type: 'text/csv',
    });
    expect((await readPartFile(csv)).dataRowCount).toBe(1);
    const oversized = { name: 'parts.csv', size: 50 * 1024 * 1024 + 1 } as File;
    await expect(readPartFile(oversized)).rejects.toThrow(/50 MB/);
  });

  it('accepts 50,000 mapped rows and rejects the next row', () => {
    const matrix = [
      ['Number', 'Name'],
      ...Array.from({ length: 50_000 }, (_, index) => [String(index + 1), `Part ${index + 1}`]),
    ];
    expect(parsePartMatrix(matrix, { numberIndex: 0, nameIndex: 1 })).toHaveLength(50_000);
    matrix.push(['50001', 'Part 50001']);
    expect(() => preparePartSheet(matrix)).toThrow(/50.000 baris/);
  });
});
