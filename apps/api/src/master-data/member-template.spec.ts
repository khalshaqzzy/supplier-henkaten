import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { SETUP_SHEETS, validateSetupRows, type SetupRow } from '@tmmin-henkaten/contracts';
import { createMemberTemplate } from './member-template.js';

describe('member template', () => {
  it('contains only guidance and members with valid editable examples and text identifiers', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await createMemberTemplate());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Panduan', 'Member']);
    const sheet = book.getWorksheet('Member')!;
    const columns = SETUP_SHEETS.find((spec) => spec.name === 'Member')!.columns;
    const rows: SetupRow[] = [];
    sheet.eachRow((row, sourceRow) => {
      if (sourceRow > 1 && row.getCell(1).text)
        rows.push({
          sheet: 'Member',
          sourceRow,
          data: Object.fromEntries(
            columns.map((column, i) => [column.key, row.getCell(i + 1).text]),
          ),
        });
    });
    expect(rows).toHaveLength(20);
    expect(validateSetupRows(rows, true)).toEqual([]);
    expect(sheet.getCell('D2').text).toBe('001001');
    expect(sheet.getColumn(4).numFmt).toBe('@');
    expect(sheet.getCell('C2').dataValidation.type).toBe('list');
    expect(rows.filter((row) => row.data['role'] === 'MP')).toHaveLength(13);
    for (const row of rows) {
      expect(row.data['password']).toBe(row.data['role'] === 'MP' ? '' : 'MemberAwal01');
    }
    const guide = book.getWorksheet('Panduan')!;
    const guidance = guide
      .getSheetValues()
      .flat(Infinity)
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    expect(guidance).toContain('KRY-0007');
    expect(guidance).toContain('tidak mencocokkan orang berdasarkan nama');
    expect(guidance).toContain('Hubungkan MP existing');
    expect(guidance).toContain('aktifkan akunnya secara terpisah');
    expect(guidance).not.toMatch(/[—–]/);
    expect(sheet.getCell('A1').note).toContain('kode yang sudah terikat tidak dapat diganti');
  });
});
