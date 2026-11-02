import Papa from 'papaparse';
import { SETUP_SHEETS, setupNormalize } from '@tmmin-henkaten/contracts';
import { parseSetupSheets, type ParsedSetupWorkbook } from './setupWorkbook';

type Sheet = { sheet: string; data: unknown[][] };
const name = (value: string) => setupNormalize(value).replace(/[\s_-]/g, '');
const populated = (row: unknown[]) =>
  row.some(
    (value) =>
      value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== ''),
  );

export function parseMemberSheets(sheets: Sheet[]): ParsedSetupWorkbook {
  if (sheets.length > 32) throw new Error('Workbook maksimal 32 sheet.');
  const member = sheets.filter((sheet) => name(sheet.sheet) === 'member');
  const candidates = sheets.filter(
    (sheet) => name(sheet.sheet) !== 'panduan' && sheet.data.some(populated),
  );
  if (member.length > 1 || (!member.length && candidates.length > 1))
    throw new Error('Gunakan nama sheet Member untuk menentukan data yang akan diimport.');
  const selected = member[0] ?? candidates[0];
  if (!selected) throw new Error('Tidak ada data member. Gunakan template untuk memulai.');
  if (selected.data.slice(1).filter(populated).length > 300)
    throw new Error('Satu file maksimal 300 baris member. Pecah file menjadi beberapa batch.');
  const result = parseSetupSheets([
    ...sheets.filter((sheet) => name(sheet.sheet) === 'panduan'),
    { sheet: 'Member', data: selected.data },
  ]);
  const ignored = sheets.filter((sheet) => sheet !== selected && name(sheet.sheet) !== 'panduan');
  if (ignored.length)
    result.warnings.push(
      `Hanya sheet ${selected.sheet} diimport. ${ignored.length} sheet lain diabaikan.`,
    );
  return result;
}

export function parseMemberCsv(text: string): ParsedSetupWorkbook {
  const source = text.replace(/^\uFEFF/, '');
  const matrix: string[][] = [];
  const sourceRows: number[] = [];
  let previousCursor = 0;
  let physicalRow = 1;
  let count = 0;
  let failure: string | null = null;
  Papa.parse<string[]>(source, {
    delimitersToGuess: [',', ';'],
    skipEmptyLines: false,
    step(result, parser) {
      if (result.errors.length) {
        failure = `CSV tidak dapat dibaca pada baris ${physicalRow}. Periksa tanda kutip dan pemisah kolom.`;
        parser.abort();
        return;
      }
      if (result.data.length > 32) {
        failure = 'File member maksimal 32 kolom.';
        parser.abort();
        return;
      }
      const start = physicalRow;
      physicalRow += (source.slice(previousCursor, result.meta.cursor).match(/\r\n|\r|\n/g) ?? [])
        .length;
      previousCursor = result.meta.cursor;
      if (matrix.length > 0 && !populated(result.data)) return;
      if (matrix.length > 0) count++;
      if (count > 300) {
        failure = 'Satu file maksimal 300 baris member. Pecah file menjadi beberapa batch.';
        parser.abort();
        return;
      }
      matrix.push(result.data);
      sourceRows.push(start);
    },
  });
  if (failure) throw new Error(failure);
  const parsed = parseMemberSheets([{ sheet: 'Member', data: matrix }]);
  return {
    ...parsed,
    rows: parsed.rows.map((row) => ({ ...row, sourceRow: sourceRows[row.sourceRow - 1]! })),
    issues: parsed.issues.map((issue) => ({
      ...issue,
      sourceRow: sourceRows[issue.sourceRow - 1] ?? issue.sourceRow,
      message: issue.message.replace(
        /Duplikat dengan baris (\d+)\./,
        (_, row: string) => `Duplikat dengan baris ${sourceRows[Number(row) - 1] ?? row}.`,
      ),
    })),
  };
}

/** Header-only CSV avoids accidentally creating example accounts. */
export function memberCsvTemplate() {
  return (
    '\uFEFF' +
    SETUP_SHEETS.find((sheet) => sheet.name === 'Member')!
      .columns.map((column) => column.label)
      .join(',') +
    '\r\n'
  );
}
