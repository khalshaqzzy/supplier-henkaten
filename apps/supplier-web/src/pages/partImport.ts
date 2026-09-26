import Papa from 'papaparse';

export type PartImportRow = { partNumber: string; partName: string; sourceRow: number };
export type PartColumnMapping = { numberIndex: number; nameIndex: number };
export type PartImportSheet = { headers: string[]; matrix: unknown[][]; dataRowCount: number };

const numberHeaders = new Set(['partnumber', 'partno', 'nomorpart', 'kodepart']);
const nameHeaders = new Set(['partname', 'namapart']);

export const partCellText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toLocaleDateString('id-ID');
  if (value instanceof Error) return value.message;
  return '';
};

const selectedCellText = (value: unknown) => {
  if (value !== null && typeof value === 'object')
    throw new Error('Kolom part memiliki nilai sel yang tidak didukung. Gunakan teks atau angka.');
  return partCellText(value);
};

const normalizeHeader = (value: unknown) =>
  partCellText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function suggestedPartMapping(headers: string[]): PartColumnMapping {
  return {
    numberIndex: headers.findIndex((cell) => numberHeaders.has(normalizeHeader(cell))),
    nameIndex: headers.findIndex((cell) => nameHeaders.has(normalizeHeader(cell))),
  };
}

export function partColumnLabel(index: number) {
  let number = index + 1;
  let label = '';
  while (number > 0) {
    number--;
    label = String.fromCharCode(65 + (number % 26)) + label;
    number = Math.floor(number / 26);
  }
  return label;
}

export function preparePartSheet(matrix: unknown[][]): PartImportSheet {
  const header = matrix[0];
  if (!header) throw new Error('File kosong. Gunakan template part untuk memulai.');
  let width = 0;
  let dataRowCount = 0;
  for (const [index, row] of matrix.entries()) {
    width = Math.max(width, row.length);
    if (index > 0 && row.some((cell) => partCellText(cell).trim() !== '')) dataRowCount++;
    if (dataRowCount > 50_000)
      throw new Error('Satu file maksimal 50.000 baris data. Pecah file menjadi beberapa batch.');
  }
  if (width < 2) throw new Error('File harus memiliki sedikitnya dua kolom.');
  const headers = Array.from({ length: width }, (_, index) => partCellText(header[index]).trim());
  if (!dataRowCount) throw new Error('Tidak ada baris part untuk diimpor.');
  return { headers, matrix, dataRowCount };
}

export function parsePartMatrix(matrix: unknown[][], mapping?: PartColumnMapping): PartImportRow[] {
  const sheet = preparePartSheet(matrix);
  const { numberIndex, nameIndex } = mapping ?? suggestedPartMapping(sheet.headers);
  if (
    numberIndex < 0 ||
    nameIndex < 0 ||
    numberIndex === nameIndex ||
    numberIndex >= sheet.headers.length ||
    nameIndex >= sheet.headers.length
  )
    throw new Error('Pilih dua kolom berbeda untuk Part number dan Nama part.');
  const rows: PartImportRow[] = [];
  const seen = new Map<string, number>();
  for (const [index, cells] of matrix.slice(1).entries()) {
    if (cells.every((cell) => partCellText(cell).trim() === '')) continue;
    const sourceRow = index + 2;
    if (
      typeof cells[numberIndex] === 'number' &&
      (!Number.isSafeInteger(cells[numberIndex]) || cells[numberIndex] < 0)
    )
      throw new Error(
        `Baris ${sourceRow}: Part number harus bilangan bulat yang presisi. Untuk nomor panjang atau nol di depan, format kolom sebagai teks di Excel.`,
      );
    const partNumber = selectedCellText(cells[numberIndex]).trim();
    const partName = selectedCellText(cells[nameIndex]).trim();
    if (!partNumber || !partName)
      throw new Error(`Baris ${sourceRow}: Part number dan Nama part wajib diisi.`);
    if (partNumber.length > 100 || partName.length > 200)
      throw new Error(
        `Baris ${sourceRow}: Part number maksimal 100 karakter dan Nama part maksimal 200 karakter.`,
      );
    const normalized = partNumber.normalize('NFKC').toLocaleLowerCase('en-US');
    const first = seen.get(normalized);
    if (first)
      throw new Error(`Part number ${partNumber} muncul pada baris ${first} dan ${sourceRow}.`);
    seen.set(normalized, sourceRow);
    rows.push({ partNumber, partName, sourceRow });
  }
  return rows;
}

export async function readPartFile(file: File): Promise<PartImportSheet> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Ukuran file maksimal 50 MB.');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension === 'csv') {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    if (parsed.errors.length)
      throw new Error(`CSV tidak dapat dibaca pada baris ${(parsed.errors[0]?.row ?? 0) + 1}.`);
    return preparePartSheet(parsed.data);
  }
  if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    return preparePartSheet(await readSheet(file));
  }
  throw new Error('Pilih file CSV atau Excel (.xlsx).');
}
