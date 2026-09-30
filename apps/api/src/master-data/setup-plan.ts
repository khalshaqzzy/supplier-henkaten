import { randomUUID } from 'node:crypto';
import {
  SETUP_SHEETS,
  setupNormalize as norm,
  setupRowKey,
  validateSetupRows,
  type SetupDecision,
  type SetupDiff,
  type SetupRow,
  type SetupSheet,
} from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';

type Entity = {
  sheet: SetupSheet;
  id: string;
  version: number;
  active: boolean;
  data: Record<string, string>;
  parent?: string;
  userId?: string | undefined;
  userActive?: boolean | undefined;
  hasDraft?: boolean;
};
export type PlannedRow = {
  row: SetupRow;
  diff: SetupDiff;
  id: string;
  apply: boolean;
  restore: boolean;
  current?: Entity;
  refs: Record<string, string>;
  items?: { label: string; displayOrder: number }[];
};
export type SetupPlan = Awaited<ReturnType<typeof prepareSetupPlan>>;
const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const pair = (...values: string[]) => values.map(norm).join('|');

export async function prepareSetupPlan(
  tx: Prisma.TransactionClient,
  supplierId: string,
  inputRows: SetupRow[],
  decisions?: SetupDecision[],
  committing = false,
) {
  const rows = inputRows.map((r) => ({
    ...r,
    data: Object.fromEntries(
      Object.entries(r.data).map(([k, v]) => [k, k === 'password' ? v : v.trim()]),
    ),
  }));
  const issues = validateSetupRows(rows);
  const [supplier, members, lines, jobs, shifts, lineShifts, templates] = await Promise.all([
    tx.supplier.findUniqueOrThrow({ where: { id: supplierId } }),
    tx.member.findMany({ where: { supplierId }, include: { users: true } }),
    tx.line.findMany({ where: { supplierId } }),
    tx.job.findMany({ where: { supplierId } }),
    tx.shiftTemplate.findMany({ where: { supplierId } }),
    tx.lineShift.findMany({ where: { supplierId }, include: { jobAssignments: true } }),
    tx.checklistTemplate.findMany({
      where: { supplierId },
      include: {
        currentVersion: { include: { items: { orderBy: { displayOrder: 'asc' } } } },
        draftItems: true,
      },
    }),
  ]);
  const parts = [] as Awaited<ReturnType<typeof tx.part.findMany>>;
  const numbers = rows.filter((r) => r.sheet === 'Part').map((r) => norm(r.data['code'] ?? ''));
  for (let i = 0; i < numbers.length; i += 1000)
    parts.push(
      ...(await tx.part.findMany({
        where: { supplierId, normalizedPartNumber: { in: numbers.slice(i, i + 1000) } },
      })),
    );
  const lineCode = new Map(lines.map((l) => [l.id, l.code]));
  const memberCode = new Map(members.map((m) => [m.id, m.importCode ?? m.id]));
  const jobCode = new Map(jobs.map((j) => [j.id, j.importCode ?? j.name]));
  const shiftCode = new Map(shifts.map((s) => [s.id, s.importCode ?? s.id]));
  const entities: Entity[] = [
    ...members.map((m): Entity => ({
      sheet: 'Member',
      id: m.id,
      version: m.version,
      active: m.active,
      userId: m.users[0]?.id,
      userActive: m.users[0]?.status === 'ACTIVE',
      data: {
        code: m.importCode ?? '',
        name: m.fullName,
        role: m.role,
        registration: m.registrationNumber ?? '',
        username: m.users[0]?.username ?? '',
      },
    })),
    ...lines.map((l): Entity => ({
      sheet: 'Line',
      id: l.id,
      version: l.version,
      active: l.active,
      data: { code: l.code, name: l.name, order: String(l.displayOrder) },
    })),
    ...jobs.map((j): Entity => ({
      sheet: 'Job',
      id: j.id,
      version: j.version,
      active: j.active,
      parent: j.lineId,
      data: {
        line: lineCode.get(j.lineId) ?? '',
        code: j.importCode ?? '',
        name: j.name,
        order: String(j.displayOrder),
        category: j.skillCategory ?? '',
      },
    })),
    ...parts.map((p): Entity => ({
      sheet: 'Part',
      id: p.id,
      version: p.version,
      active: p.active,
      data: { code: p.partNumber, name: p.partName },
    })),
    ...shifts.map((s): Entity => ({
      sheet: 'Shift',
      id: s.id,
      version: s.version,
      active: s.active,
      data: {
        code: s.importCode ?? '',
        name: s.name,
        start: time(s.startMinute),
        end: time(s.endMinute),
        order: String(s.displayOrder),
        timezone: s.timezone,
      },
    })),
    ...lineShifts.map((s): Entity => ({
      sheet: 'Line Shift',
      id: s.id,
      version: s.version,
      active: s.active,
      parent: s.lineId,
      data: {
        line: lineCode.get(s.lineId) ?? '',
        shift: shiftCode.get(s.shiftTemplateId) ?? '',
        supervisor: s.supervisorMemberId ? (memberCode.get(s.supervisorMemberId) ?? '') : '',
        leader: s.lineLeaderMemberId ? (memberCode.get(s.lineLeaderMemberId) ?? '') : '',
      },
    })),
    ...lineShifts.flatMap((s) =>
      s.jobAssignments.map((a): Entity => ({
        sheet: 'Assignment MP',
        id: a.id,
        version: a.version,
        active: s.active,
        parent: s.id,
        data: {
          line: lineCode.get(s.lineId) ?? '',
          shift: shiftCode.get(s.shiftTemplateId) ?? '',
          job: jobCode.get(a.jobId) ?? '',
          mp: a.mpMemberId ? (memberCode.get(a.mpMemberId) ?? '') : '',
        },
      })),
    ),
    ...templates.map((t): Entity => ({
      sheet: 'Checklist 4M',
      id: t.id,
      version: t.version,
      active: t.active && t.currentVersionId !== null,
      hasDraft: t.draftItems.length > 0,
      data: {
        category: t.category,
        question: t.currentVersion?.items.map((i) => i.label).join('\n') ?? '',
      },
    })),
  ];
  const choices = new Map((decisions ?? []).map((d) => [d.key, d.action]));
  const byId = new Map(entities.map((e) => [e.id, e]));
  const index = new Map<string, Entity>();
  const identity = (sheet: SetupSheet, d: Record<string, string>) =>
    sheet === 'Job'
      ? pair(d['line'] ?? '', d['code'] ?? '')
      : sheet === 'Line Shift'
        ? pair(d['line'] ?? '', d['shift'] ?? '')
        : sheet === 'Assignment MP'
          ? pair(d['line'] ?? '', d['shift'] ?? '', d['job'] ?? '')
          : sheet === 'Checklist 4M'
            ? norm(d['category'] ?? '')
            : norm(d['code'] ?? '');
  for (const e of entities)
    if (e.data['code'] || !['Member', 'Job', 'Shift'].includes(e.sheet))
      index.set(`${e.sheet}|${identity(e.sheet, e.data)}`, e);
  const add = (row: SetupRow, column: string, message: string) =>
    issues.push({ sheet: row.sheet, sourceRow: row.sourceRow, column, message });
  const plan: PlannedRow[] = [];
  const used = new Set<string>();
  const plannedCodes = new Map<string, string>();
  const entitiesBySheet = new Map<SetupSheet, Entity[]>(
    SETUP_SHEETS.map((spec) => [
      spec.name,
      entities.filter((entity) => entity.sheet === spec.name),
    ]),
  );
  const sorted = [...rows].sort(
    (a, b) =>
      SETUP_SHEETS.findIndex((s) => s.name === a.sheet) -
      SETUP_SHEETS.findIndex((s) => s.name === b.sheet),
  );
  for (const row of sorted) {
    const key = setupRowKey(row);
    if (row.sheet === 'Checklist 4M' && plan.some((p) => p.diff.key === key)) continue;
    let current = index.get(`${row.sheet}|${identity(row.sheet, row.data)}`);
    const resolveCode = (sheet: SetupSheet, value: string, line?: string) =>
      plannedCodes.get(`${sheet}|${sheet === 'Job' ? pair(line ?? '', value) : norm(value)}`) ??
      index.get(`${sheet}|${sheet === 'Job' ? pair(line ?? '', value) : norm(value)}`)?.id;
    if (!current && row.sheet === 'Line Shift') {
      const found = lineShifts.find(
        (s) =>
          s.lineId === resolveCode('Line', row.data['line'] ?? '') &&
          s.shiftTemplateId === resolveCode('Shift', row.data['shift'] ?? ''),
      );
      if (found) current = byId.get(found.id);
    }
    if (!current && row.sheet === 'Assignment MP') {
      const shift = lineShifts.find(
        (s) =>
          s.lineId === resolveCode('Line', row.data['line'] ?? '') &&
          s.shiftTemplateId === resolveCode('Shift', row.data['shift'] ?? ''),
      );
      const found = shift?.jobAssignments.find(
        (a) => a.jobId === resolveCode('Job', row.data['job'] ?? '', row.data['line']),
      );
      if (found) current = byId.get(found.id);
    }

    if (row.targetId) {
      const target = byId.get(row.targetId);
      if (!target || target.sheet !== row.sheet)
        add(row, 'Identitas', 'Data yang dipilih tidak tersedia.');
      else if (current && current.id !== target.id)
        add(row, 'Identitas', 'Kode sudah digunakan data lain.');
      else if (target.data['code'] && norm(target.data['code']) !== norm(row.data['code'] ?? ''))
        add(row, 'Identitas', 'Kode import existing tidak dapat diganti.');
      else current = target;
    }
    if (!current && row.sheet === 'Member' && row.data['role'] !== 'MP') {
      const matches = (entitiesBySheet.get(row.sheet) ?? []).filter(
        (e) =>
          e.sheet === 'Member' &&
          ((e.data['registration'] &&
            norm(e.data['registration']) === norm(row.data['registration'] ?? '')) ||
            (e.data['username'] && norm(e.data['username']) === norm(row.data['username'] ?? ''))),
      );
      if (matches.length > 1)
        add(row, 'Identitas', 'Registrasi dan username merujuk member berbeda.');
      else current = matches[0];
    }
    if (!current && (row.sheet === 'Job' || row.sheet === 'Shift')) {
      const matches = (entitiesBySheet.get(row.sheet) ?? []).filter(
        (e) =>
          e.sheet === row.sheet &&
          !e.data['code'] &&
          norm(e.data['name'] ?? '') === norm(row.data['name'] ?? '') &&
          (row.sheet !== 'Job' || norm(e.data['line'] ?? '') === norm(row.data['line'] ?? '')),
      );
      if (matches.length > 1)
        add(row, 'Identitas', 'Nama tidak unik. Gunakan kode import existing.');
      else current = matches[0];
    }
    if (
      current?.data['code'] &&
      norm(current.data['code']) !== norm(row.data['code'] ?? '') &&
      ['Member', 'Job', 'Shift'].includes(row.sheet)
    )
      add(row, 'Kode', 'Identitas existing sudah mempunyai kode berbeda.');
    if (current && used.has(current.id))
      add(row, 'Identitas', 'Dua baris merujuk data existing yang sama.');
    if (current) used.add(current.id);
    if (current && row.sheet === 'Member' && current.data['role'] !== row.data['role'])
      add(row, 'Role', 'Role member existing tidak dapat diubah.');
    const items =
      row.sheet === 'Checklist 4M'
        ? rows
            .filter((r) => r.sheet === row.sheet && r.data['category'] === row.data['category'])
            .sort((a, b) => Number(a.data['order']) - Number(b.data['order']))
            .map((r) => ({
              label: r.data['question'] ?? '',
              displayOrder: Number(r.data['order']),
            }))
        : undefined;
    if (items && new Set(items.map((i) => norm(i.label))).size !== items.length)
      add(row, 'Pertanyaan', 'Pertanyaan dalam satu kategori harus unik.');
    const proposed = items
      ? { category: row.data['category'] ?? '', question: items.map((i) => i.label).join('\n') }
      : row.data;
    const columns = SETUP_SHEETS.find((s) => s.name === row.sheet)!.columns;
    const changes = current
      ? columns
          .filter(
            (c) =>
              c.key !== 'password' &&
              c.key !== 'order' &&
              !(row.sheet === 'Part' && c.key === 'code') &&
              (items ? c.key === 'question' : true),
          )
          .flatMap((c) =>
            (current.data[c.key] ?? '') !== (proposed[c.key] ?? '')
              ? [
                  {
                    field: c.label,
                    before: current.data[c.key] ?? '',
                    after: proposed[c.key] ?? '',
                  },
                ]
              : [],
          )
      : [];
    if (
      current &&
      !items &&
      (current.data['order'] ?? '') !== (proposed['order'] ?? '') &&
      proposed['order']
    )
      changes.push({
        field: 'Urutan',
        before: current.data['order'] ?? '',
        after: proposed['order'] ?? '',
      });
    if (current?.hasDraft && items)
      changes.push({ field: 'Draft', before: 'Draft tersedia', after: 'Diganti dan dipublish' });
    const status = !current
      ? 'NEW'
      : !current.active
        ? 'INACTIVE'
        : changes.length
          ? 'CHANGED'
          : 'SAME';
    const action = choices.get(key) ?? (committing ? 'SKIP' : 'UPDATE');
    const apply = !current
      ? action !== 'SKIP' || !choices.has(key)
      : status === 'INACTIVE'
        ? action === 'RESTORE'
        : status === 'CHANGED' && action === 'UPDATE';
    if (status !== 'INACTIVE' && action === 'RESTORE')
      add(row, 'Aksi', 'Restore hanya untuk data arsip.');
    const diff: SetupDiff = {
      key,
      sheet: row.sheet,
      sourceRow: row.sourceRow,
      label:
        row.data['name'] ??
        row.data['category'] ??
        [row.data['line'], row.data['shift'], row.data['job']].filter(Boolean).join(' · '),
      status,
      existingId: current?.id ?? null,
      version: current?.version ?? null,
      linked: Boolean(
        current && !current.data['code'] && ['Member', 'Job', 'Shift'].includes(row.sheet),
      ),
      changes,
    };
    const id = current?.id ?? randomUUID();
    plannedCodes.set(`${row.sheet}|${identity(row.sheet, row.data)}`, id);
    plan.push({
      row,
      diff,
      id,
      apply,
      restore: status === 'INACTIVE' && apply,
      ...(current ? { current } : {}),
      refs: {},
      ...(items ? { items } : {}),
    });
  }
  // Resolve references against the final selected state; skipped rows retain existing values.
  const final = new Map(entities.map((e) => [e.id, { ...e, data: { ...e.data } }]));
  const aliases = new Map<string, Entity>();
  for (const e of final.values()) {
    if (e.data['code'] || !['Member', 'Job', 'Shift'].includes(e.sheet))
      aliases.set(`${e.sheet}|${identity(e.sheet, e.data)}`, e);
    aliases.set(`${e.sheet}|${norm(e.id)}`, e);
    if (e.sheet === 'Job' && !e.data['code'])
      aliases.set(`Job|${pair(e.data['line'] ?? '', e.data['name'] ?? '')}`, e);
  }
  for (const p of plan) {
    if (!p.apply && !p.current) continue;
    const e: Entity = p.apply
      ? {
          sheet: p.row.sheet,
          id: p.id,
          version: p.current?.version ?? 0,
          active: true,
          data: p.items
            ? {
                category: p.row.data['category'] ?? '',
                question: p.items.map((i) => i.label).join('\n'),
              }
            : p.row.data,
          ...(p.current?.userId
            ? { userId: p.current.userId, userActive: p.restore ? true : p.current.userActive }
            : {}),
        }
      : final.get(p.id)!;
    final.set(e.id, e);
    aliases.set(`${e.sheet}|${identity(e.sheet, p.row.data)}`, e);
  }
  for (const p of plan) {
    if (!p.apply) continue;
    const d = p.row.data;
    const ref = (
      field: string,
      sheet: SetupSheet,
      key: string,
      role?: string,
      optional = false,
    ) => {
      if (!key && optional) return;
      const target = aliases.get(`${sheet}|${key}`);
      if (
        !target?.active ||
        (role && target.data['role'] !== role) ||
        (role && role !== 'MP' && target.userActive === false)
      )
        add(p.row, field, `Referensi ${sheet}${role ? ` (${role})` : ''} aktif tidak ditemukan.`);
      else p.refs[field] = target.id;
    };
    if (['Job', 'Line Shift', 'Assignment MP'].includes(p.row.sheet))
      ref('line', 'Line', norm(d['line'] ?? ''));
    if (['Line Shift', 'Assignment MP'].includes(p.row.sheet))
      ref('shift', 'Shift', norm(d['shift'] ?? ''));
    if (p.row.sheet === 'Line Shift') {
      ref('supervisor', 'Member', norm(d['supervisor'] ?? ''), 'SUPERVISOR', true);
      ref('leader', 'Member', norm(d['leader'] ?? ''), 'LINE_LEADER', true);
    }
    if (p.row.sheet === 'Assignment MP') {
      ref('lineShift', 'Line Shift', pair(d['line'] ?? '', d['shift'] ?? ''));
      ref('job', 'Job', pair(d['line'] ?? '', d['job'] ?? ''));
      ref('mp', 'Member', norm(d['mp'] ?? ''), 'MP', true);
    }
    if (p.current?.parent && p.row.sheet === 'Job' && p.current.parent !== p.refs['line'])
      add(p.row, 'Kode line', 'Job existing tidak dapat dipindahkan ke line lain.');
  }
  // Check global uniqueness, including records omitted from this workbook.
  for (const [sheet, field, parentField] of [
    ['Member', 'registration', ''],
    ['Member', 'username', ''],
    ['Job', 'name', 'line'],
  ] as const) {
    const usedValues = new Map<string, string>();
    for (const e of final.values()) {
      if (e.sheet !== sheet || !e.data[field]) continue;
      const value = pair(e.data[parentField] ?? '', e.data[field]);
      const previous = usedValues.get(value);
      if (previous && previous !== e.id) {
        const p = plan.find((p) => p.id === e.id) ?? plan.find((p) => p.id === previous);
        if (p) add(p.row, field, 'Nilai sudah digunakan data lain.');
      }
      usedValues.set(value, e.id);
    }
  }
  const standaloneUsers = await tx.user.findMany({
    where: { supplierId, memberId: null },
    select: { normalizedUsername: true },
  });
  const reservedUsernames = new Set(standaloneUsers.map((user) => user.normalizedUsername));
  for (const p of plan)
    if (
      p.apply &&
      p.row.sheet === 'Member' &&
      p.row.data['role'] !== 'MP' &&
      reservedUsernames.has(norm(p.row.data['username'] ?? ''))
    )
      add(p.row, 'Username', 'Username sudah digunakan akun supplier lain.');
  const leaders = new Map<string, string>();
  for (const e of final.values()) {
    if (e.sheet !== 'Line Shift' || !e.active) continue;
    const member = aliases.get(`Member|${norm(e.data['leader'] ?? '')}`);
    if (!member) continue;
    const previous = leaders.get(member.id);
    if (previous && previous !== e.id) {
      const p = plan.find((p) => p.id === e.id) ?? plan.find((p) => p.id === previous);
      if (p) add(p.row, 'Kode LL', 'LL hanya boleh berada pada satu Line–Shift aktif.');
    }
    leaders.set(member.id, e.id);
  }
  for (const [sheet, limit] of [
    ['Member', 300],
    ['Line', 20],
    ['Job', 500],
  ] as const)
    if ([...final.values()].filter((e) => e.sheet === sheet && e.active).length > limit) {
      const p = plan.find((p) => p.row.sheet === sheet && p.apply);
      if (p) add(p.row, 'Sheet', `Kapasitas aktif maksimal ${limit}.`);
    }
  const warnings: string[] = [];
  if (plan.some((p) => p.row.sheet === 'Member' && p.current))
    warnings.push('Password akun existing tetap dipertahankan.');
  if (
    plan.some(
      (p) => (p.row.sheet === 'Member' && p.row.data['role'] === 'MP') || p.row.sheet === 'Job',
    )
  )
    warnings.push('Nilai Tanoko diatur melalui halaman Tanoko.');
  if (
    plan.some(
      (p) => p.row.sheet === 'Line Shift' && (!p.row.data['supervisor'] || !p.row.data['leader']),
    )
  )
    warnings.push('Assignment yang kosong perlu dilengkapi melalui Line Setup.');
  return {
    revision: supplier.setupRevision,
    plan,
    issues,
    warnings,
    candidates: members
      .filter((m) => m.importCode === null)
      .map((m) => ({ id: m.id, name: m.fullName, role: m.role, active: m.active })),
  };
}
