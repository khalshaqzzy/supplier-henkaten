import { describe, expect, it } from 'vitest';

import { parsePartMatrix } from './partImport';

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
});
