import { z } from 'zod';

export const SETUP_WORKBOOK_VERSION = '1';
export const SETUP_MAX_ROWS = 60_000;
export const setupSheetSchema = z.enum([
  'Member',
  'Line',
  'Job',
  'Part',
  'Shift',
  'Line Shift',
  'Assignment MP',
  'Checklist 4M',
]);
export type SetupSheet = z.infer<typeof setupSheetSchema>;
export type SetupColumn = {
  key: string;
  label: string;
  required?: boolean;
  text?: boolean;
  values?: readonly string[];
};
export const SETUP_SHEETS: ReadonlyArray<{
  name: SetupSheet;
  limit: number;
  columns: readonly SetupColumn[];
}> = [
  {
    name: 'Member',
    limit: 300,
    columns: [
      { key: 'code', label: 'Kode member', required: true, text: true },
      { key: 'name', label: 'Nama', required: true },
      {
        key: 'role',
        label: 'Role',
        required: true,
        values: ['SUPERVISOR', 'LINE_LEADER', 'QC', 'MP'],
      },
      { key: 'registration', label: 'Nomor registrasi', text: true },
      { key: 'username', label: 'Username', text: true },
      { key: 'password', label: 'Password awal', text: true },
    ],
  },
  {
    name: 'Line',
    limit: 20,
    columns: [
      { key: 'code', label: 'Kode line', required: true, text: true },
      { key: 'name', label: 'Nama line', required: true },
      { key: 'order', label: 'Urutan', required: true },
    ],
  },
  {
    name: 'Job',
    limit: 500,
    columns: [
      { key: 'line', label: 'Kode line', required: true, text: true },
      { key: 'code', label: 'Kode job', required: true, text: true },
      { key: 'name', label: 'Nama job', required: true },
      { key: 'order', label: 'Urutan', required: true },
      { key: 'category', label: 'Kategori', values: ['HIGH', 'MEDIUM', 'LOW'] },
    ],
  },
  {
    name: 'Part',
    limit: 50_000,
    columns: [
      { key: 'code', label: 'Part number', required: true, text: true },
      { key: 'name', label: 'Nama part', required: true },
    ],
  },
  {
    name: 'Shift',
    limit: 100,
    columns: [
      { key: 'code', label: 'Kode shift', required: true, text: true },
      { key: 'name', label: 'Nama shift', required: true },
      { key: 'start', label: 'Mulai', required: true },
      { key: 'end', label: 'Selesai', required: true },
      { key: 'order', label: 'Urutan', required: true },
      { key: 'timezone', label: 'Timezone', required: true },
    ],
  },
  {
    name: 'Line Shift',
    limit: 2_000,
    columns: [
      { key: 'line', label: 'Kode line', required: true, text: true },
      { key: 'shift', label: 'Kode shift', required: true, text: true },
      { key: 'supervisor', label: 'Kode Supervisor', text: true },
      { key: 'leader', label: 'Kode LL', text: true },
    ],
  },
  {
    name: 'Assignment MP',
    limit: 25_000,
    columns: [
      { key: 'line', label: 'Kode line', required: true, text: true },
      { key: 'shift', label: 'Kode shift', required: true, text: true },
      { key: 'job', label: 'Kode job', required: true, text: true },
      { key: 'mp', label: 'Kode MP', text: true },
    ],
  },
  {
    name: 'Checklist 4M',
    limit: 800,
    columns: [
      {
        key: 'category',
        label: 'Kategori',
        required: true,
        values: ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'],
      },
      { key: 'order', label: 'Urutan', required: true },
      { key: 'question', label: 'Pertanyaan', required: true },
    ],
  },
];
export const setupRowSchema = z
  .object({
    sheet: setupSheetSchema,
    sourceRow: z.number().int().min(2).max(1_048_576),
    data: z.record(z.string().max(30), z.string().max(500)),
    targetId: z.string().uuid().optional(),
  })
  .strict();
export type SetupRow = z.infer<typeof setupRowSchema>;
export const setupPreviewRequestSchema = z
  .object({
    rows: z.array(setupRowSchema).min(1).max(SETUP_MAX_ROWS),
    decisions: z
      .array(
        z
          .object({ key: z.string().max(100), action: z.enum(['UPDATE', 'SKIP', 'RESTORE']) })
          .strict(),
      )
      .max(SETUP_MAX_ROWS)
      .optional(),
  })
  .strict();
export const setupIssueSchema = z
  .object({
    sheet: setupSheetSchema,
    sourceRow: z.number().int(),
    column: z.string(),
    message: z.string(),
  })
  .strict();
export type SetupIssue = z.infer<typeof setupIssueSchema>;
export const setupDiffSchema = z
  .object({
    key: z.string(),
    sheet: setupSheetSchema,
    sourceRow: z.number().int(),
    label: z.string(),
    status: z.enum(['NEW', 'CHANGED', 'SAME', 'INACTIVE']),
    existingId: z.string().uuid().nullable(),
    version: z.number().int().nullable(),
    linked: z.boolean(),
    changes: z.array(
      z.object({ field: z.string(), before: z.string(), after: z.string() }).strict(),
    ),
  })
  .strict();
export type SetupDiff = z.infer<typeof setupDiffSchema>;
export const setupPreviewSchema = z
  .object({
    revision: z.number().int(),
    rows: z.array(setupDiffSchema),
    issues: z.array(setupIssueSchema),
    warnings: z.array(z.string()),
    candidates: z.array(
      z
        .object({ id: z.string().uuid(), name: z.string(), role: z.string(), active: z.boolean() })
        .strict(),
    ),
  })
  .strict();
export type SetupPreview = z.infer<typeof setupPreviewSchema>;
export const setupDecisionSchema = z
  .object({ key: z.string().max(100), action: z.enum(['UPDATE', 'SKIP', 'RESTORE']) })
  .strict();
export type SetupDecision = z.infer<typeof setupDecisionSchema>;
export const setupCommitRequestSchema = setupPreviewRequestSchema
  .extend({
    revision: z.number().int(),
    decisions: z.array(setupDecisionSchema).max(SETUP_MAX_ROWS),
  })
  .strict();
export type SetupCommit = z.infer<typeof setupCommitRequestSchema>;
export const setupOperationSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['IMPORT', 'RESET']),
    status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
    error: z.string().nullable(),
    result: z.array(
      z
        .object({
          sheet: z.string(),
          created: z.number().int(),
          updated: z.number().int(),
          skipped: z.number().int(),
        })
        .strict(),
    ),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type SetupOperation = z.infer<typeof setupOperationSchema>;
export const setupResetPreviewSchema = z
  .object({
    revision: z.number().int(),
    openCount: z.number().int(),
    empty: z.boolean(),
    counts: z.array(z.object({ label: z.string(), count: z.number().int() }).strict()),
  })
  .strict();
export const setupResetRequestSchema = z
  .object({ revision: z.number().int(), password: z.string().min(1).max(128) })
  .strict();

export const setupRowKey = (
  row: Pick<SetupRow, 'sheet' | 'sourceRow'> & { data?: Record<string, string> },
) =>
  row.sheet === 'Checklist 4M' && row.data
    ? `${row.sheet}:${row.data['category']}`
    : `${row.sheet}:${row.sourceRow}`;
export const setupNormalize = (value: string) =>
  value.trim().normalize('NFKC').toLocaleLowerCase('en-US');

/** Shared cell rules; cross-sheet and database rules are validated by the API. */
export function validateSetupRows(rows: SetupRow[], checkPasswords = false): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const seen = new Map<string, number>();
  const counts = new Map<SetupSheet, number>();
  for (const row of rows) {
    const spec = SETUP_SHEETS.find((s) => s.name === row.sheet)!;
    counts.set(row.sheet, (counts.get(row.sheet) ?? 0) + 1);
    const add = (column: string, message: string) =>
      issues.push({ sheet: row.sheet, sourceRow: row.sourceRow, column, message });
    for (const [key] of Object.entries(row.data))
      if (!spec.columns.some((c) => c.key === key)) add(key, 'Kolom tidak dikenali.');
    for (const column of spec.columns) {
      const value = row.data[column.key] ?? '';
      if (column.required && !value.trim()) add(column.label, 'Wajib diisi.');
      if (value && column.values && !column.values.includes(value))
        add(column.label, `Pilih ${column.values.join(', ')}.`);
      const max =
        column.key === 'question'
          ? 500
          : column.key === 'name'
            ? row.sheet === 'Part'
              ? 200
              : 150
            : column.key === 'password'
              ? 128
              : 100;
      if (value.length > max) add(column.label, `Maksimal ${max} karakter.`);
    }
    if (row.data['order'] && !/^[1-9]\d{0,5}$/.test(row.data['order']))
      add('Urutan', 'Gunakan bilangan bulat positif.');
    if (row.sheet === 'Member') {
      if (row.data['role'] !== 'MP') {
        if (!row.data['registration'])
          add('Nomor registrasi', 'Wajib untuk Supervisor, LL, dan QC.');
        if (!row.data['username']?.trim()) add('Username', 'Wajib untuk Supervisor, LL, dan QC.');
        if (checkPasswords && (row.data['password']?.length ?? 0) < 12)
          add('Password awal', 'Gunakan 12–128 karakter.');
      } else if (row.data['registration'] || row.data['username'] || row.data['password'])
        add('Role', 'MP tidak menggunakan registrasi atau akun.');
    }
    if (row.sheet === 'Shift') {
      for (const key of ['start', 'end'])
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.data[key] ?? ''))
          add(key === 'start' ? 'Mulai' : 'Selesai', 'Gunakan waktu HH:mm.');
      if (row.data['start'] === row.data['end'])
        add('Selesai', 'Waktu mulai dan selesai harus berbeda.');
      try {
        new Intl.DateTimeFormat('id-ID', { timeZone: row.data['timezone'] }).format();
      } catch {
        add('Timezone', 'Gunakan timezone IANA, misalnya Asia/Jakarta.');
      }
    }
    const identity =
      row.sheet === 'Checklist 4M'
        ? `${row.data['category']}|${row.data['order']}`
        : row.sheet === 'Line Shift'
          ? `${row.data['line']}|${row.data['shift']}`
          : row.sheet === 'Assignment MP'
            ? `${row.data['line']}|${row.data['shift']}|${row.data['job']}`
            : row.sheet === 'Job'
              ? `${row.data['line']}|${row.data['code']}`
              : (row.data['code'] ?? '');
    const key = `${row.sheet}|${setupNormalize(identity)}`;
    const first = seen.get(key);
    if (first !== undefined) add('Identitas', `Duplikat dengan baris ${first}.`);
    seen.set(key, row.sourceRow);
  }
  for (const spec of SETUP_SHEETS)
    if ((counts.get(spec.name) ?? 0) > spec.limit)
      issues.push({
        sheet: spec.name,
        sourceRow: 2,
        column: 'Sheet',
        message: `Maksimal ${spec.limit.toLocaleString('id-ID')} baris.`,
      });
  return issues;
}
