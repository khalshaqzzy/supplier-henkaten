import {
  SETUP_SHEETS,
  SETUP_MAX_ROWS,
  SETUP_WORKBOOK_VERSION,
  setupNormalize,
  validateSetupRows,
  type SetupIssue,
  type SetupRow,
} from '@tmmin-henkaten/contracts';

export type ParsedSetupWorkbook = { rows: SetupRow[]; issues: SetupIssue[]; warnings: string[] };
const cellText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : '';
const headerKey = (value: string) => setupNormalize(value).replace(/[\s_-]/g, '');

/** Check ZIP expansion before handing bytes to the workbook reader. ZIP64 is not needed for this bounded format. */
export async function inspectSetupWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Pilih file Excel (.xlsx).');
  if (file.size > 50 * 1024 * 1024) throw new Error('Ukuran file maksimal 50 MB.');
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('File Excel tidak dapat dibaca. Simpan ulang sebagai .xlsx.');
  const entries = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  if (entries > 2_000 || directorySize > 1024 * 1024 || directoryOffset + directorySize > file.size)
    throw new Error('Workbook terlalu kompleks. Kurangi sheet dan objek di Excel.');
  const directory = new DataView(
    await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer(),
  );
  let cursor = 0;
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > directory.byteLength || directory.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('Struktur workbook tidak valid.');
    const size = directory.getUint32(cursor + 24, true);
    expanded += size;
    if (size > 64 * 1024 * 1024 || expanded > 160 * 1024 * 1024)
      throw new Error('Isi workbook terlalu besar. Pecah data menjadi beberapa file.');
    cursor +=
      46 +
      directory.getUint16(cursor + 28, true) +
      directory.getUint16(cursor + 30, true) +
      directory.getUint16(cursor + 32, true);
  }
}

export function parseSetupSheets(
  sheets: { sheet: string; data: unknown[][] }[],
): ParsedSetupWorkbook {
  if (sheets.length > 32) throw new Error('Workbook maksimal 32 sheet.');
  const rows: SetupRow[] = [];
  const issues: SetupIssue[] = [];
  const warnings: string[] = [];
  const seenSheets = new Set<string>();
  let cells = 0;
  let characters = 0;
  for (const source of sheets) {
    const spec = SETUP_SHEETS.find((s) => headerKey(s.name) === headerKey(source.sheet));
    if (headerKey(source.sheet) === 'panduan') {
      const version = source.data.find((r) => headerKey(cellText(r[0])) === 'versiformat')?.[1];
      if (version !== undefined && cellText(version) !== SETUP_WORKBOOK_VERSION)
        throw new Error('Versi template tidak didukung. Download template terbaru.');
      continue;
    }
    if (!spec) {
      warnings.push(`Sheet ${source.sheet} diabaikan.`);
      continue;
    }
    if (seenSheets.has(spec.name)) throw new Error(`Sheet ${spec.name} muncul lebih dari sekali.`);
    seenSheets.add(spec.name);
    if (
      !source.data
        .slice(1)
        .some((r) => r.some((c) => c !== null && c !== undefined && cellText(c).trim() !== ''))
    )
      continue;
    const headers = source.data[0] ?? [];
    if (headers.length > 32) throw new Error(`Sheet ${spec.name}: maksimal 32 kolom.`);
    const mapped = spec.columns.map((c) =>
      headers.flatMap((h, i) =>
        [headerKey(c.label), headerKey(c.key)].includes(headerKey(cellText(h))) ? [i] : [],
      ),
    );
    for (const [index, matches] of mapped.entries()) {
      const column = spec.columns[index]!;
      if (matches.length > 1 || (!matches.length && column.required))
        issues.push({
          sheet: spec.name,
          sourceRow: 1,
          column: column.label,
          message: matches.length
            ? 'Header muncul lebih dari sekali.'
            : 'Kolom wajib tidak ditemukan.',
        });
    }
    const ignored = headers.filter((_, i) => !mapped.some((m) => m.includes(i))).length;
    if (ignored) warnings.push(`${spec.name}: ${ignored} kolom tambahan diabaikan.`);
    for (const [index, sourceRow] of source.data.slice(1).entries()) {
      if (sourceRow.every((v) => v === null || v === undefined || cellText(v).trim() === ''))
        continue;
      cells += sourceRow.length;
      if (cells > 600_000 || sourceRow.length > 32)
        throw new Error('Workbook memiliki terlalu banyak sel. Pecah menjadi beberapa file.');
      const data: Record<string, string> = {};
      for (const [cIndex, column] of spec.columns.entries()) {
        const value = sourceRow[mapped[cIndex]?.[0] ?? -1];
        let text = '';
        if (value instanceof Date && ['start', 'end'].includes(column.key))
          text = `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
        else if (typeof value === 'string') text = column.key === 'password' ? value : value.trim();
        else if (
          typeof value === 'number' &&
          column.key !== 'password' &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
          text = String(value);
        else if (value !== null && value !== undefined)
          issues.push({
            sheet: spec.name,
            sourceRow: index + 2,
            column: column.label,
            message: 'Gunakan teks; untuk jam gunakan format HH:mm.',
          });
        characters += text.length;
        if (characters > 64 * 1024 * 1024)
          throw new Error('Teks workbook terlalu besar. Pecah menjadi beberapa file.');
        data[column.key] = text;
      }
      rows.push({ sheet: spec.name, sourceRow: index + 2, data });
      if (rows.length > SETUP_MAX_ROWS) throw new Error('Workbook maksimal 60.000 baris data.');
    }
  }
  if (!rows.length) throw new Error('Tidak ada data setup. Gunakan template untuk memulai.');
  return { rows, issues: [...issues, ...validateSetupRows(rows)], warnings };
}
