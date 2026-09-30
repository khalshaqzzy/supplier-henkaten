import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  SETUP_SHEETS,
  SETUP_WORKBOOK_VERSION,
  validateSetupRows,
  type SetupRow,
} from '@tmmin-henkaten/contracts';
import { createSetupTemplate } from './setup-template.js';

describe('comprehensive setup workbook template', () => {
  it('includes every supported sheet, column guidance, readable formatting and valid complete examples', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createSetupTemplate('Asia/Jakarta')) as unknown as ExcelJS.Buffer,
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Panduan',
      ...SETUP_SHEETS.map((spec) => spec.name),
    ]);
    const guide = workbook.getWorksheet('Panduan')!;
    expect(guide.getCell('B2').text).toBe(SETUP_WORKBOOK_VERSION);
    expect(guide.rowCount).toBeGreaterThan(70);
    const rows: SetupRow[] = [];
    for (const spec of SETUP_SHEETS) {
      const sheet = workbook.getWorksheet(spec.name)!;
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      for (const [index, column] of spec.columns.entries()) {
        expect(sheet.getRow(1).getCell(index + 1).text).toBe(column.label);
        expect(sheet.getRow(1).getCell(index + 1).note).toBeTruthy();
        if (column.text) expect(sheet.getColumn(index + 1).numFmt).toBe('@');
      }
      sheet.eachRow((row, sourceRow) => {
        if (sourceRow > 1 && row.getCell(1).value)
          rows.push({
            sheet: spec.name,
            sourceRow,
            data: Object.fromEntries(
              spec.columns.map((column, index) => [column.key, row.getCell(index + 1).text]),
            ),
          });
      });
    }
    expect(validateSetupRows(rows, true)).toEqual([]);
    expect(rows.filter((row) => row.sheet === 'Line')).toHaveLength(2);
    expect(rows.filter((row) => row.sheet === 'Job')).toHaveLength(4);
    expect(rows.filter((row) => row.sheet === 'Checklist 4M')).toHaveLength(12);
    expect(workbook.getWorksheet('Part')!.getCell('A2').text).toBe('001234567890');
    expect(workbook.getWorksheet('Job')!.getCell('E2').dataValidation.type).toBe('list');
    expect(workbook.getWorksheet('Line Shift')!.getCell('A2').dataValidation.formulae).toEqual([
      'LineCodes',
    ]);
    expect(
      workbook.getWorksheet('Line Shift')!.getCell('A2').dataValidation.showErrorMessage,
    ).not.toBe(true);
  });
});
