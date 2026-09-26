import Papa from 'papaparse';

export type PartImportRow = { partNumber: string; partName: string; sourceRow: number };

const numberHeaders = new Set(['partnumber', 'partno', 'nomorpart', 'kodepart']);
const nameHeaders = new Set(['partname', 'namapart']);

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  throw new Error(
    'File memiliki nilai sel yang tidak didukung. Gunakan teks untuk Part number dan Nama part.',
  );
};

const normalizeHeader = (value: unknown) =>
  cellText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function parsePartMatrix(matrix: unknown[][]): PartImportRow[] {
  const [header, ...body] = matrix;
  if (!header) throw new Error('File kosong. Gunakan template part untuk memulai.');
  const numberIndex = header.findIndex((cell) => numberHeaders.has(normalizeHeader(cell)));
  const nameIndex = header.findIndex((cell) => nameHeaders.has(normalizeHeader(cell)));
  if (numberIndex < 0 || nameIndex < 0 || numberIndex === nameIndex)
    throw new Error('Kolom “Part number” dan “Nama part” wajib ada pada baris pertama.');
  const rows: PartImportRow[] = [];
  const seen = new Map<string, number>();
  for (const [index, cells] of body.entries()) {
    if (cells.every((cell) => cellText(cell).trim() === '')) continue;
    const sourceRow = index + 2;
    if (
      typeof cells[numberIndex] === 'number' &&
      (!Number.isSafeInteger(cells[numberIndex]) || cells[numberIndex] < 0)
    )
      throw new Error(
        `Baris ${sourceRow}: Part number harus bilangan bulat yang presisi. Untuk nomor panjang atau nol di depan, format kolom sebagai teks di Excel.`,
      );
    const partNumber = cellText(cells[numberIndex]).trim();
    const partName = cellText(cells[nameIndex]).trim();
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
    if (rows.length > 500)
      throw new Error('Satu file maksimal 500 part. Pecah file menjadi beberapa batch.');
  }
  if (!rows.length) throw new Error('Tidak ada baris part untuk diimpor.');
  return rows;
}

export async function parsePartFile(file: File): Promise<PartImportRow[]> {
  if (file.size > 2 * 1024 * 1024) throw new Error('Ukuran file maksimal 2 MB.');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension === 'csv') {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    if (parsed.errors.length)
      throw new Error(`CSV tidak dapat dibaca pada baris ${(parsed.errors[0]?.row ?? 0) + 1}.`);
    return parsePartMatrix(parsed.data);
  }
  if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    return parsePartMatrix(await readSheet(file));
  }
  throw new Error('Pilih file CSV atau Excel (.xlsx).');
}
