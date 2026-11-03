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
    expect(rows).toHaveLength(4);
    expect(validateSetupRows(rows, true)).toEqual([]);
    expect(sheet.getCell('D2').text).toBe('001001');
    expect(sheet.getColumn(4).numFmt).toBe('@');
    expect(sheet.getCell('C2').dataValidation.type).toBe('list');
  });
});
