import { describe, expect, it } from 'vitest';

import { supplierSetupReadinessSchema } from '@tmmin-henkaten/contracts';

import { evaluateHostedReadiness } from './hosted-readiness.service.js';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

type Member = {
  id: string;
  fullName: string;
  role: 'SUPERVISOR' | 'LINE_LEADER' | 'MP' | 'QC';
  active: boolean;
  users: { status: 'ACTIVE' | 'INACTIVE'; role: string }[];
};

type Fixture = {
  admins?: number;
  activeMembers?: number;
  operationalAccounts?: number;
  lines?: { id: string; code: string; name: string }[];
  jobs?: { id: string; lineId: string; name: string; displayOrder: number }[];
  shiftCount?: number;
  lineShifts?: unknown[];
  inactiveTemplates?: { id: string; name: string; startMinute: number; endMinute: number }[];
  inactiveLines?: { id: string; code: string; name: string }[];
  archivedMembers?: { id: string; fullName: string; role: Member['role'] }[];
  operationalMembers?: { id: string; fullName: string; role: Member['role'] }[];
};

/** Minimal Prisma double answering exactly the reads made by readiness evaluation. */
function client(fixture: Fixture) {
  const inactive = (where: { active?: boolean; role?: unknown }) => where.active === false;
  return {
    user: {
      count: ({ where }: { where: { role: unknown } }) =>
        Promise.resolve(
          where.role === 'SUPPLIER_ADMIN'
            ? (fixture.admins ?? 1)
            : (fixture.operationalAccounts ?? 1),
        ),
    },
    member: {
      count: ({ where }: { where: { active: boolean; role?: unknown } }) =>
        Promise.resolve(
          inactive(where)
            ? (fixture.archivedMembers?.length ?? 0)
            : where.role
              ? (fixture.operationalMembers?.length ?? 0)
              : (fixture.activeMembers ?? 1),
        ),
      findMany: ({ where }: { where: { active: boolean } }) =>
        Promise.resolve(
          inactive(where) ? (fixture.archivedMembers ?? []) : (fixture.operationalMembers ?? []),
        ),
    },
    line: {
      count: () => Promise.resolve(fixture.inactiveLines?.length ?? 0),
      findMany: ({ where }: { where: { active: boolean } }) =>
        Promise.resolve(inactive(where) ? (fixture.inactiveLines ?? []) : (fixture.lines ?? [])),
    },
    job: { findMany: () => Promise.resolve(fixture.jobs ?? []) },
    part: { count: () => Promise.resolve(0) },
    shiftTemplate: {
      count: ({ where }: { where: { active: boolean } }) =>
        Promise.resolve(
          inactive(where) ? (fixture.inactiveTemplates?.length ?? 0) : (fixture.shiftCount ?? 1),
        ),
      findMany: () => Promise.resolve(fixture.inactiveTemplates ?? []),
    },
    checklistVersion: { findMany: () => Promise.resolve([]) },
    lineShift: { findMany: () => Promise.resolve(fixture.lineShifts ?? []) },
  } as never;
}

const line = { id: id(1), code: 'L-01', name: 'Assembly' };
const template = { id: id(2), name: 'Pagi', startMinute: 360, endMinute: 840, active: true };
const jobs = [
  { id: id(10), lineId: line.id, name: 'Torque', displayOrder: 1 },
  { id: id(11), lineId: line.id, name: 'Inspection', displayOrder: 2 },
];
const member = (value: number, role: Member['role'], overrides: Partial<Member> = {}): Member => ({
  id: id(value),
  fullName: `Member ${value}`,
  role,
  active: true,
  users: role === 'MP' ? [] : [{ status: 'ACTIVE', role }],
  ...overrides,
});

function lineShift(overrides: Record<string, unknown> = {}) {
  const supervisor = member(20, 'SUPERVISOR');
  const leader = member(21, 'LINE_LEADER');
  const mp = member(22, 'MP');
  return {
    id: id(5),
    lineId: line.id,
    active: true,
    supervisorMemberId: supervisor.id,
    lineLeaderMemberId: leader.id,
    shiftTemplate: template,
    supervisor,
    lineLeader: leader,
    jobAssignments: jobs.map((job) => ({ jobId: job.id, mpMemberId: mp.id, mp })),
    ...overrides,
  };
}

async function evaluate(fixture: Fixture) {
  const readiness = await evaluateHostedReadiness(client(fixture), id(99));
  const contract = supplierSetupReadinessSchema.parse({
    ...readiness,
    blockers: readiness.blockers.map(({ contributor: _contributor, ...blocker }) => blocker),
  });
  return contract;
}

describe('hosted readiness blocker detail', () => {
  it('reports a fully staffed Line–Shift as ready', async () => {
    const readiness = await evaluate({ lines: [line], jobs, lineShifts: [lineShift()] });
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.areas.find(({ area }) => area === 'DEFAULT_ASSIGNMENTS')).toMatchObject({
      ready: true,
      activeCount: 4,
      requiredCount: 4,
    });
  });

  it('names the line, shift and job of every unassigned position', async () => {
    const readiness = await evaluate({
      lines: [line],
      jobs,
      lineShifts: [
        lineShift({
          supervisorMemberId: null,
          supervisor: null,
          lineLeaderMemberId: null,
          lineLeader: null,
          jobAssignments: [{ jobId: jobs[0]!.id, mpMemberId: null, mp: null }],
        }),
      ],
    });
    const shift = {
      lineShiftId: id(5),
      shiftTemplateId: template.id,
      name: 'Pagi',
      startTime: '06:00',
      endTime: '14:00',
      crossesMidnight: false,
      active: true,
    };
    expect(readiness.blockers).toEqual([
      expect.objectContaining({
        code: 'LINE_SHIFT_SUPERVISOR_MISSING',
        reason: 'UNASSIGNED',
        resourceType: 'LineShift',
        resourceId: id(5),
        line,
        shift,
        detail: 'L-01 · Pagi: Supervisor belum ditetapkan.',
      }),
      expect.objectContaining({ code: 'LINE_SHIFT_LEADER_MISSING', reason: 'UNASSIGNED' }),
      expect.objectContaining({
        code: 'LINE_SHIFT_MP_MISSING',
        reason: 'UNASSIGNED',
        job: { id: jobs[0]!.id, name: 'Torque', displayOrder: 1 },
      }),
      // A job without an assignment row is still reported with its own identity.
      expect.objectContaining({
        code: 'LINE_SHIFT_MP_MISSING',
        reason: 'UNASSIGNED',
        job: { id: jobs[1]!.id, name: 'Inspection', displayOrder: 2 },
      }),
    ]);
    expect(readiness.blockers.some((blocker) => 'member' in blocker)).toBe(false);
  });

  it('distinguishes archived members from inactive accounts', async () => {
    const archivedSupervisor = member(30, 'SUPERVISOR', {
      active: false,
      users: [{ status: 'INACTIVE', role: 'SUPERVISOR' }],
    });
    const inactiveLeader = member(31, 'LINE_LEADER', {
      users: [{ status: 'INACTIVE', role: 'LINE_LEADER' }],
    });
    const archivedMp = member(32, 'MP', { active: false });
    const readiness = await evaluate({
      lines: [line],
      jobs: [jobs[0]!],
      lineShifts: [
        lineShift({
          supervisorMemberId: archivedSupervisor.id,
          supervisor: archivedSupervisor,
          lineLeaderMemberId: inactiveLeader.id,
          lineLeader: inactiveLeader,
          jobAssignments: [{ jobId: jobs[0]!.id, mpMemberId: archivedMp.id, mp: archivedMp }],
        }),
      ],
    });
    expect(readiness.blockers).toEqual([
      expect.objectContaining({
        code: 'LINE_SHIFT_SUPERVISOR_MISSING',
        reason: 'MEMBER_ARCHIVED',
        member: {
          id: archivedSupervisor.id,
          fullName: 'Member 30',
          role: 'SUPERVISOR',
          active: false,
          accountStatus: 'INACTIVE',
        },
      }),
      expect.objectContaining({
        code: 'LINE_SHIFT_LEADER_MISSING',
        reason: 'ACCOUNT_INACTIVE',
        member: expect.objectContaining({ id: inactiveLeader.id, accountStatus: 'INACTIVE' }),
      }),
      expect.objectContaining({
        code: 'LINE_SHIFT_MP_MISSING',
        reason: 'MEMBER_ARCHIVED',
        member: expect.objectContaining({ id: archivedMp.id, accountStatus: null }),
      }),
    ]);
    expect(readiness.areas.find(({ area }) => area === 'DEFAULT_ASSIGNMENTS')).toMatchObject({
      activeCount: 0,
      requiredCount: 3,
    });
  });

  it('points a line without an active shift to its inactive shift when one exists', async () => {
    const inactive = lineShift({ active: false });
    const readiness = await evaluate({ lines: [line], jobs, lineShifts: [inactive] });
    expect(readiness.blockers).toEqual([
      expect.objectContaining({
        code: 'LINE_SHIFT_MISSING',
        reason: 'ONLY_INACTIVE',
        resourceType: 'Line',
        resourceId: line.id,
        line,
        shift: expect.objectContaining({ lineShiftId: id(5), active: false }),
      }),
    ]);
    const empty = await evaluate({ lines: [line], jobs, lineShifts: [] });
    expect(empty.blockers).toEqual([
      expect.objectContaining({ code: 'LINE_SHIFT_MISSING', reason: 'NOT_CONFIGURED' }),
    ]);
    expect(empty.blockers[0]).not.toHaveProperty('shift');
  });

  it('offers restorable or activatable candidates for aggregate blockers', async () => {
    const readiness = await evaluate({
      shiftCount: 0,
      inactiveTemplates: [{ id: id(40), name: 'Malam', startMinute: 1320, endMinute: 360 }],
      lines: [],
      inactiveLines: [{ id: id(41), code: 'L-OLD', name: 'Old line' }],
      operationalAccounts: 0,
      operationalMembers: [{ id: id(42), fullName: 'Rina', role: 'QC' }],
    });
    const byCode = Object.fromEntries(readiness.blockers.map((item) => [item.code, item]));
    expect(byCode['ACTIVE_SHIFT_TEMPLATE_MISSING']).toMatchObject({
      reason: 'ONLY_INACTIVE',
      candidateTotal: 1,
      candidates: [{ kind: 'SHIFT_TEMPLATE', id: id(40), label: 'Malam', detail: '22:00–06:00' }],
    });
    expect(byCode['ACTIVE_LINE_MISSING']).toMatchObject({
      reason: 'ONLY_INACTIVE',
      candidates: [{ kind: 'LINE', id: id(41), label: 'Old line', detail: 'L-OLD' }],
    });
    expect(byCode['OPERATIONAL_ACCOUNT_MISSING']).toMatchObject({
      reason: 'ACCOUNT_INACTIVE',
      candidates: [{ kind: 'MEMBER', id: id(42), label: 'Rina', detail: 'QC', role: 'QC' }],
    });
    expect(byCode['ACTIVE_JOB_MISSING']).toMatchObject({ reason: 'NOT_CONFIGURED' });
    expect(byCode['ACTIVE_JOB_MISSING']).not.toHaveProperty('candidates');
    expect(byCode['LINE_SHIFT_CONFIGURATION_PENDING']).toMatchObject({ reason: 'NOT_CONFIGURED' });
  });

  it('asks for creation when nothing can be restored and lists lines awaiting a job', async () => {
    const readiness = await evaluate({
      shiftCount: 0,
      activeMembers: 0,
      admins: 2,
      operationalAccounts: 0,
      lines: [line],
      jobs: [],
      lineShifts: [],
    });
    const byCode = Object.fromEntries(readiness.blockers.map((item) => [item.code, item]));
    expect(byCode['ACTIVE_SHIFT_TEMPLATE_MISSING']).toEqual(
      expect.objectContaining({ reason: 'NOT_CONFIGURED' }),
    );
    expect(byCode['ACTIVE_SHIFT_TEMPLATE_MISSING']).not.toHaveProperty('candidates');
    expect(byCode['ACTIVE_MEMBER_MISSING']).toMatchObject({ reason: 'NOT_CONFIGURED' });
    expect(byCode['HOSTED_ADMIN_MISSING']).toMatchObject({ reason: 'COUNT_MISMATCH' });
    expect(byCode['OPERATIONAL_ACCOUNT_MISSING']).toMatchObject({ reason: 'NOT_CONFIGURED' });
    expect(byCode['ACTIVE_JOB_MISSING']).toMatchObject({
      candidateTotal: 1,
      candidates: [{ kind: 'LINE', id: line.id, label: 'Assembly', detail: 'L-01' }],
    });
  });
});
