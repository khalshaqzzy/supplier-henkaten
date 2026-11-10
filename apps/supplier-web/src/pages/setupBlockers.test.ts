import { describe, expect, it } from 'vitest';

import type { SupplierSetupBlocker } from '@tmmin-henkaten/contracts';

import { groupSetupBlockers, lineSetupHref } from './setupBlockers';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const line = { id: id(1), code: 'L-01', name: 'Assembly' };
const shift = (lineShiftId: string, name = 'Pagi') => ({
  lineShiftId,
  shiftTemplateId: id(90),
  name,
  startTime: '06:00',
  endTime: '14:00',
  crossesMidnight: false,
  active: true,
});
const position = (
  code: string,
  lineShiftId: string,
  extra: Partial<SupplierSetupBlocker> = {},
): SupplierSetupBlocker => ({
  area: 'DEFAULT_ASSIGNMENTS',
  code,
  detail: `${code} detail`,
  resourceType: 'LineShift',
  resourceId: lineShiftId,
  reason: 'UNASSIGNED',
  line,
  shift: shift(lineShiftId),
  ...extra,
});

describe('setup blocker grouping', () => {
  it('orders areas by setup sequence and merges entity blockers per type', () => {
    const groups = groupSetupBlockers([
      position('LINE_SHIFT_MP_MISSING', id(5), {
        job: { id: id(10), name: 'Torque', displayOrder: 1 },
      }),
      {
        area: 'SHIFT_TEMPLATES',
        code: 'ACTIVE_SHIFT_TEMPLATE_MISSING',
        detail: 'x',
        reason: 'NOT_CONFIGURED',
      },
      position('LINE_SHIFT_MP_MISSING', id(5), {
        job: { id: id(11), name: 'Inspection', displayOrder: 2 },
      }),
      position('LINE_SHIFT_MP_MISSING', id(6), {
        shift: shift(id(6), 'Malam'),
        job: { id: id(10), name: 'Torque', displayOrder: 1 },
      }),
      position('LINE_SHIFT_SUPERVISOR_MISSING', id(6), { shift: shift(id(6), 'Malam') }),
    ]);
    expect(groups.map(({ area, step, count }) => [area, step, count])).toEqual([
      ['SHIFT_TEMPLATES', 1, 1],
      ['DEFAULT_ASSIGNMENTS', 6, 4],
    ]);
    const [mp, supervisor] = groups[1]!.issues;
    expect(mp).toMatchObject({
      key: 'DEFAULT_ASSIGNMENTS:LINE_SHIFT_MP_MISSING',
      title: 'MP belum lengkap',
      summary: '3 job · 2 line-shift',
      count: 3,
    });
    expect(
      mp!.contexts.map(({ title, subtitle, items }) => [title, subtitle, items.length]),
    ).toEqual([
      ['L-01 · Assembly', 'Pagi · 06:00–14:00', 2],
      ['L-01 · Assembly', 'Malam · 06:00–14:00', 1],
    ]);
    expect(mp!.contexts[0]!.items[1]).toMatchObject({
      title: 'Inspection',
      subtitle: 'Job 02',
      reason: 'UNASSIGNED',
      actions: [
        {
          label: 'Tetapkan MP',
          emphasis: 'primary',
          ariaLabel: 'Tetapkan MP: L-01 · Assembly · Pagi · Inspection',
          to: lineSetupHref({ lineId: line.id, lineShiftId: id(5), focus: `job:${id(11)}` }),
        },
      ],
    });
    expect(supervisor).toMatchObject({
      summary: '1 line-shift',
      title: 'Supervisor belum lengkap',
    });
    expect(supervisor!.contexts[0]!.items[0]!.actions[0]!.to).toBe(
      `/master-data/line-setup?lineId=${line.id}&lineShiftId=${id(6)}&focus=supervisor`,
    );
  });

  it('chooses the corrective action from the blocker reason', () => {
    const member = {
      id: id(30),
      fullName: 'Rudi',
      role: 'LINE_LEADER' as const,
      active: true,
      accountStatus: 'INACTIVE' as const,
    };
    const [group] = groupSetupBlockers([
      position('LINE_SHIFT_LEADER_MISSING', id(5), { reason: 'ACCOUNT_INACTIVE', member }),
      position('LINE_SHIFT_SUPERVISOR_MISSING', id(5), {
        reason: 'MEMBER_ARCHIVED',
        member: { ...member, id: id(31), fullName: 'Sari', role: 'SUPERVISOR', active: false },
      }),
    ]);
    const [leader, supervisor] = group!.issues;
    expect(leader!.contexts[0]!.items[0]).toMatchObject({
      person: 'Rudi',
      reason: 'ACCOUNT_INACTIVE',
      actions: [
        { label: 'Aktifkan akun', to: `/master-data/members/${id(30)}?focus=account` },
        {
          label: 'Ganti Line Leader',
          emphasis: 'secondary',
          to: lineSetupHref({ lineId: line.id, lineShiftId: id(5), focus: 'line-leader' }),
        },
      ],
    });
    expect(supervisor!.contexts[0]!.items[0]!.actions).toMatchObject([
      { label: 'Ganti Supervisor', emphasis: 'primary' },
      { label: 'Lihat member', to: `/master-data/members/${id(31)}?focus=status` },
    ]);
  });

  it('links a line without shifts to creation or to its inactive shift', () => {
    const [group] = groupSetupBlockers([
      {
        area: 'DEFAULT_ASSIGNMENTS',
        code: 'LINE_SHIFT_MISSING',
        detail: 'x',
        reason: 'NOT_CONFIGURED',
        line,
        resourceType: 'Line',
        resourceId: line.id,
      },
      {
        area: 'DEFAULT_ASSIGNMENTS',
        code: 'LINE_SHIFT_MISSING',
        detail: 'x',
        reason: 'ONLY_INACTIVE',
        line: { id: id(2), code: 'L-02', name: 'Paint' },
        shift: { ...shift(id(7)), active: false },
      },
    ]);
    const items = group!.issues[0]!.contexts[0]!.items;
    expect(group!.issues[0]!.summary).toBe('2 line');
    expect(items[0]!.actions[0]).toMatchObject({
      label: 'Tambah shift',
      to: `/master-data/line-setup?lineId=${line.id}&focus=add-shift`,
    });
    expect(items[1]).toMatchObject({
      subtitle: 'Pagi · 06:00–14:00 nonaktif',
      actions: [
        {
          label: 'Aktifkan shift',
          to: `/master-data/line-setup?lineId=${id(2)}&lineShiftId=${id(7)}&focus=shift-status`,
        },
      ],
    });
  });

  it('turns aggregate candidates into restoration or activation actions', () => {
    const groups = groupSetupBlockers([
      {
        area: 'SHIFT_TEMPLATES',
        code: 'ACTIVE_SHIFT_TEMPLATE_MISSING',
        detail: 'x',
        reason: 'ONLY_INACTIVE',
        candidates: [{ kind: 'SHIFT_TEMPLATE', id: id(40), label: 'Malam', detail: '22:00–06:00' }],
        candidateTotal: 23,
      },
      {
        area: 'MEMBERS_ACCOUNTS',
        code: 'OPERATIONAL_ACCOUNT_MISSING',
        detail: 'x',
        reason: 'ACCOUNT_INACTIVE',
        candidates: [{ kind: 'MEMBER', id: id(42), label: 'Rina', detail: 'QC', role: 'QC' }],
        candidateTotal: 1,
      },
      {
        area: 'MEMBERS_ACCOUNTS',
        code: 'HOSTED_ADMIN_MISSING',
        detail: 'Harus ada tepat satu Supplier Admin aktif.',
        reason: 'COUNT_MISMATCH',
      },
      {
        area: 'LINES_JOBS',
        code: 'ACTIVE_JOB_MISSING',
        detail: 'x',
        reason: 'NOT_CONFIGURED',
        candidates: [{ kind: 'LINE', id: line.id, label: 'Assembly', detail: 'L-01' }],
        candidateTotal: 1,
      },
    ]);
    const [shiftIssue] = groups[0]!.issues;
    expect(shiftIssue).toMatchObject({
      summary: '23 data dapat diaktifkan',
      actions: [{ label: 'Buat Shift Template', emphasis: 'secondary' }],
      hiddenCandidates: {
        count: 22,
        action: { label: 'Lihat 22 lainnya', to: '/master-data/shifts?active=INACTIVE' },
      },
    });
    expect(shiftIssue!.contexts[0]!.items[0]!.actions[0]!.to).toBe(
      `/master-data/shifts/${id(40)}?focus=status`,
    );
    const [accounts, admin] = groups[1]!.issues;
    expect(accounts).toMatchObject({ summary: '1 akun dapat diaktifkan' });
    expect(accounts!.contexts[0]!.items[0]!.actions[0]).toMatchObject({
      label: 'Aktifkan akun',
      ariaLabel: 'Aktifkan akun: Rina',
      to: `/master-data/members/${id(42)}?focus=account`,
    });
    expect(admin).toMatchObject({
      summary: 'Hubungi TMMIN Admin',
      actions: [],
      contexts: [],
      note: 'Perubahan Supplier Admin dilakukan oleh TMMIN Admin.',
    });
    const [jobs] = groups[2]!.issues;
    expect(jobs!.contexts[0]!.items[0]).toMatchObject({
      title: 'Assembly',
      subtitle: 'L-01',
      actions: [{ label: 'Tambah job', to: `/master-data/lines/${line.id}?focus=jobs` }],
    });
    expect(jobs!.contexts[0]!.items[0]).not.toHaveProperty('reason');
  });

  it('offers creation as the primary action when nothing can be restored', () => {
    const [group] = groupSetupBlockers([
      {
        area: 'LINES_JOBS',
        code: 'ACTIVE_LINE_MISSING',
        detail: 'x',
        reason: 'NOT_CONFIGURED',
      },
    ]);
    expect(group!.issues[0]).toMatchObject({
      summary: 'Belum ada data',
      actions: [{ label: 'Tambah line', emphasis: 'primary', to: '/master-data/lines/new' }],
      contexts: [],
    });
  });

  it('falls back to the server detail for codes without a dedicated presentation', () => {
    const [group] = groupSetupBlockers([
      { area: 'SHIFT_TEMPLATES', code: 'FUTURE_CODE', detail: 'Server explanation.' },
    ]);
    expect(group!.issues[0]).toMatchObject({
      title: 'Server explanation.',
      note: 'Server explanation.',
      actions: [],
    });
  });
});
