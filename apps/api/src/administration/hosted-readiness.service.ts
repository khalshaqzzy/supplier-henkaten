import { Injectable } from '@nestjs/common';

import type {
  MemberRole,
  SupplierSetupArea,
  SupplierSetupBlockerCandidate,
  SupplierSetupBlockerReason,
} from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { minuteToTime } from '../master-data/master-data-presenters.js';
import { PrismaService } from '../persistence/prisma.service.js';

type ReadinessClient = PrismaService | Prisma.TransactionClient;

/** Upper bound for candidate entities attached to one aggregate blocker. */
export const READINESS_CANDIDATE_LIMIT = 20;

type BlockerLine = { id: string; code: string; name: string };
type BlockerShift = {
  lineShiftId: string;
  shiftTemplateId: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  active: boolean;
};
type BlockerJob = { id: string; name: string; displayOrder: number };
type BlockerMember = {
  id: string;
  fullName: string;
  role: MemberRole;
  active: boolean;
  accountStatus: 'ACTIVE' | 'INACTIVE' | null;
};

export type HostedReadinessBlocker = {
  contributor: 'hosted-configuration';
  area: SupplierSetupArea;
  code: string;
  detail: string;
  resourceType?: string;
  resourceId?: string;
  reason?: SupplierSetupBlockerReason;
  line?: BlockerLine;
  shift?: BlockerShift;
  job?: BlockerJob;
  member?: BlockerMember;
  candidates?: SupplierSetupBlockerCandidate[];
  candidateTotal?: number;
};

const roleLabel: Record<MemberRole, string> = {
  SUPERVISOR: 'Supervisor',
  LINE_LEADER: 'Line Leader',
  QC: 'QC',
  MP: 'MP',
};

const operationalRoles = ['SUPERVISOR', 'LINE_LEADER', 'QC'] as const;

const assignedMemberSelect = {
  id: true,
  fullName: true,
  role: true,
  active: true,
  users: { select: { status: true, role: true } },
} as const;

@Injectable()
export class HostedReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  evaluate(supplierId: string, client: ReadinessClient = this.prisma) {
    return evaluateHostedReadiness(client, supplierId);
  }
}

export async function evaluateHostedReadiness(client: ReadinessClient, supplierId: string) {
  const [
    activeAdminCount,
    activeMembers,
    activeOperationalAccounts,
    lines,
    jobs,
    partCount,
    shiftCount,
    checklistCategories,
    lineShiftRows,
  ] = await Promise.all([
    client.user.count({ where: { supplierId, role: 'SUPPLIER_ADMIN', status: 'ACTIVE' } }),
    client.member.count({ where: { supplierId, active: true } }),
    client.user.count({
      where: {
        supplierId,
        status: 'ACTIVE',
        role: { in: [...operationalRoles] },
        member: { active: true },
      },
    }),
    client.line.findMany({
      where: { supplierId, active: true },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true },
    }),
    client.job.findMany({
      where: { supplierId, active: true, line: { active: true } },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, lineId: true, name: true, displayOrder: true },
    }),
    client.part.count({ where: { supplierId, active: true } }),
    client.shiftTemplate.count({ where: { supplierId, active: true } }),
    client.checklistVersion.findMany({
      where: { supplierId, currentFor: { some: { active: true } } },
      distinct: ['category'],
      select: { category: true },
    }),
    // Every Line–Shift of an active line is read so an inactive shift can be named as the
    // reason a line has no operational shift. Readiness counts use the active subset only.
    client.lineShift.findMany({
      where: { supplierId, line: { active: true } },
      orderBy: [
        { line: { displayOrder: 'asc' } },
        { shiftTemplate: { displayOrder: 'asc' } },
        { id: 'asc' },
      ],
      select: {
        id: true,
        lineId: true,
        active: true,
        supervisorMemberId: true,
        lineLeaderMemberId: true,
        shiftTemplate: {
          select: { id: true, name: true, startMinute: true, endMinute: true, active: true },
        },
        supervisor: { select: assignedMemberSelect },
        lineLeader: { select: assignedMemberSelect },
        jobAssignments: {
          where: { job: { active: true } },
          select: { jobId: true, mpMemberId: true, mp: { select: assignedMemberSelect } },
        },
      },
    }),
  ]);

  const blockers: HostedReadinessBlocker[] = [];
  const add = (blocker: Omit<HostedReadinessBlocker, 'contributor'>) =>
    blockers.push({ contributor: 'hosted-configuration', ...blocker });

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const lineShifts = lineShiftRows.filter(
    (lineShift) => lineShift.active && lineShift.shiftTemplate.active,
  );

  if (!shiftCount) {
    const inactive = await inactiveCandidates(client, 'SHIFT_TEMPLATE', supplierId);
    add({
      area: 'SHIFT_TEMPLATES',
      code: 'ACTIVE_SHIFT_TEMPLATE_MISSING',
      detail: 'Minimal satu Shift Template aktif diperlukan.',
      ...candidateFields(inactive, 'ONLY_INACTIVE'),
    });
  }
  if (!activeMembers) {
    const archived = await inactiveCandidates(client, 'MEMBER', supplierId);
    add({
      area: 'MEMBERS_ACCOUNTS',
      code: 'ACTIVE_MEMBER_MISSING',
      detail: 'Minimal satu member aktif diperlukan.',
      ...candidateFields(archived, 'ONLY_INACTIVE'),
    });
  }
  if (activeAdminCount !== 1) {
    add({
      area: 'MEMBERS_ACCOUNTS',
      code: 'HOSTED_ADMIN_MISSING',
      detail: 'Harus ada tepat satu Supplier Admin aktif.',
      reason: 'COUNT_MISMATCH',
    });
  }
  if (!activeOperationalAccounts) {
    const where = {
      supplierId,
      active: true,
      role: { in: [...operationalRoles] },
    } satisfies Prisma.MemberWhereInput;
    const [total, members] = await Promise.all([
      client.member.count({ where }),
      client.member.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: READINESS_CANDIDATE_LIMIT,
        select: { id: true, fullName: true, role: true },
      }),
    ]);
    add({
      area: 'MEMBERS_ACCOUNTS',
      code: 'OPERATIONAL_ACCOUNT_MISSING',
      detail: 'Minimal satu akun operasional Supervisor, Line Leader, atau QC diperlukan.',
      ...candidateFields(
        {
          total,
          items: members.map((member) => ({
            kind: 'MEMBER' as const,
            id: member.id,
            label: member.fullName,
            detail: roleLabel[member.role],
            role: member.role,
          })),
        },
        'ACCOUNT_INACTIVE',
      ),
    });
  }
  if (!lines.length) {
    const inactive = await inactiveCandidates(client, 'LINE', supplierId);
    add({
      area: 'LINES_JOBS',
      code: 'ACTIVE_LINE_MISSING',
      detail: 'Minimal satu line aktif diperlukan.',
      ...candidateFields(inactive, 'ONLY_INACTIVE'),
    });
  }
  if (!jobs.length) {
    // Without any active job every active line is a place where the first job can be added.
    add({
      area: 'LINES_JOBS',
      code: 'ACTIVE_JOB_MISSING',
      detail: 'Minimal satu job aktif diperlukan.',
      reason: 'NOT_CONFIGURED',
      ...(lines.length
        ? {
            candidates: lines.slice(0, READINESS_CANDIDATE_LIMIT).map((line) => ({
              kind: 'LINE' as const,
              id: line.id,
              label: line.name,
              detail: line.code,
            })),
            candidateTotal: lines.length,
          }
        : {}),
    });
  }

  const categories = new Set(checklistCategories.map(({ category }) => category));
  const configuredLines = new Set(lineShifts.map(({ lineId }) => lineId));
  if (!lines.length) {
    add({
      area: 'DEFAULT_ASSIGNMENTS',
      code: 'LINE_SHIFT_CONFIGURATION_PENDING',
      detail: 'Tambahkan line sebelum mengatur assignment line dan shift.',
      reason: 'NOT_CONFIGURED',
    });
  }
  for (const line of lines) {
    if (configuredLines.has(line.id)) continue;
    const inactiveShift = lineShiftRows.find((lineShift) => lineShift.lineId === line.id);
    add({
      area: 'DEFAULT_ASSIGNMENTS',
      code: 'LINE_SHIFT_MISSING',
      detail: `${line.code}: line aktif memerlukan minimal satu shift aktif.`,
      resourceType: 'Line',
      resourceId: line.id,
      reason: inactiveShift ? 'ONLY_INACTIVE' : 'NOT_CONFIGURED',
      line: presentLine(line),
      ...(inactiveShift ? { shift: presentShift(inactiveShift) } : {}),
    });
  }
  for (const lineShift of lineShifts) {
    const line = lineById.get(lineShift.lineId)!;
    const context = {
      area: 'DEFAULT_ASSIGNMENTS' as const,
      resourceType: 'LineShift',
      resourceId: lineShift.id,
      line: presentLine(line),
      shift: presentShift(lineShift),
    };
    const label = `${line.code} · ${lineShift.shiftTemplate.name}`;
    const supervisor = assignmentGap(
      lineShift.supervisorMemberId,
      lineShift.supervisor,
      'SUPERVISOR',
    );
    if (supervisor) {
      add({
        ...context,
        code: 'LINE_SHIFT_SUPERVISOR_MISSING',
        detail: `${label}: Supervisor ${reasonDetail[supervisor.reason]}.`,
        ...supervisor,
      });
    }
    const leader = assignmentGap(lineShift.lineLeaderMemberId, lineShift.lineLeader, 'LINE_LEADER');
    if (leader) {
      add({
        ...context,
        code: 'LINE_SHIFT_LEADER_MISSING',
        detail: `${label}: Line Leader ${reasonDetail[leader.reason]}.`,
        ...leader,
      });
    }
    const assignments = new Map(
      lineShift.jobAssignments.map((assignment) => [assignment.jobId, assignment]),
    );
    for (const job of jobs.filter((item) => item.lineId === lineShift.lineId)) {
      const assignment = assignments.get(job.id);
      const gap = assignmentGap(assignment?.mpMemberId ?? null, assignment?.mp ?? null, 'MP');
      if (!gap) continue;
      add({
        ...context,
        code: 'LINE_SHIFT_MP_MISSING',
        detail: `${label} · ${job.name}: MP ${reasonDetail[gap.reason]}.`,
        job: { id: job.id, name: job.name, displayOrder: job.displayOrder },
        ...gap,
      });
    }
  }

  const assignmentRequiredCount = lineShifts.reduce(
    (total, item) => total + 2 + jobs.filter((job) => job.lineId === item.lineId).length,
    0,
  );
  const assignmentActiveCount = lineShifts.reduce(
    (total, item) =>
      total +
      Number(!assignmentGap(item.supervisorMemberId, item.supervisor, 'SUPERVISOR')) +
      Number(!assignmentGap(item.lineLeaderMemberId, item.lineLeader, 'LINE_LEADER')) +
      item.jobAssignments.filter(({ mp }) => mp?.active).length,
    0,
  );
  const counts: Record<SupplierSetupArea, { activeCount: number; requiredCount: number }> = {
    SHIFT_TEMPLATES: { activeCount: shiftCount, requiredCount: 1 },
    MEMBERS_ACCOUNTS: {
      activeCount: Math.min(activeMembers, activeOperationalAccounts),
      requiredCount: 1,
    },
    LINES_JOBS: { activeCount: lines.length + jobs.length, requiredCount: 2 },
    PARTS: { activeCount: partCount, requiredCount: 0 },
    CHECKLISTS: { activeCount: categories.size, requiredCount: 0 },
    DEFAULT_ASSIGNMENTS: {
      activeCount: assignmentActiveCount,
      requiredCount: Math.max(1, assignmentRequiredCount),
    },
  };
  const order = Object.keys(counts) as SupplierSetupArea[];
  const areas = order.map((area) => {
    const blockerCount = blockers.filter((blocker) => blocker.area === area).length;
    return { area, ready: blockerCount === 0, ...counts[area], blockerCount };
  });
  return {
    generatedAt: new Date().toISOString(),
    ready: blockers.length === 0,
    areas,
    blockers,
    nextArea: areas.find((area) => !area.ready)?.area ?? null,
  };
}

const reasonDetail: Record<'UNASSIGNED' | 'MEMBER_ARCHIVED' | 'ACCOUNT_INACTIVE', string> = {
  UNASSIGNED: 'belum ditetapkan',
  MEMBER_ARCHIVED: 'yang ditetapkan sudah diarsipkan',
  ACCOUNT_INACTIVE: 'yang ditetapkan belum memiliki akun aktif',
};

type AssignedMember = {
  id: string;
  fullName: string;
  role: MemberRole;
  active: boolean;
  users: { status: 'ACTIVE' | 'INACTIVE'; role: string }[];
};

/**
 * Classifies one required Line–Shift position. MP positions need an active member only;
 * Supervisor and Line Leader positions additionally need an active account in that role.
 */
function assignmentGap(
  memberId: string | null,
  member: AssignedMember | null,
  role: MemberRole,
): {
  reason: 'UNASSIGNED' | 'MEMBER_ARCHIVED' | 'ACCOUNT_INACTIVE';
  member?: BlockerMember;
} | null {
  if (!memberId || !member) return { reason: 'UNASSIGNED' };
  const present: BlockerMember = {
    id: member.id,
    fullName: member.fullName,
    role: member.role,
    active: member.active,
    accountStatus: member.users.some(({ status }) => status === 'ACTIVE')
      ? 'ACTIVE'
      : member.users.length
        ? 'INACTIVE'
        : null,
  };
  if (!member.active) return { reason: 'MEMBER_ARCHIVED', member: present };
  if (role === 'MP') return null;
  if (!member.users.some((user) => user.status === 'ACTIVE' && user.role === role)) {
    return { reason: 'ACCOUNT_INACTIVE', member: present };
  }
  return null;
}

function presentLine(line: BlockerLine): BlockerLine {
  return { id: line.id, code: line.code, name: line.name };
}

function presentShift(lineShift: {
  id: string;
  active: boolean;
  shiftTemplate: {
    id: string;
    name: string;
    startMinute: number;
    endMinute: number;
    active: boolean;
  };
}): BlockerShift {
  return {
    lineShiftId: lineShift.id,
    shiftTemplateId: lineShift.shiftTemplate.id,
    name: lineShift.shiftTemplate.name,
    startTime: minuteToTime(lineShift.shiftTemplate.startMinute),
    endTime: minuteToTime(lineShift.shiftTemplate.endMinute),
    crossesMidnight: lineShift.shiftTemplate.endMinute < lineShift.shiftTemplate.startMinute,
    active: lineShift.active && lineShift.shiftTemplate.active,
  };
}

type CandidateSet = { total: number; items: SupplierSetupBlockerCandidate[] };

/**
 * An aggregate blocker resolved by restoring existing data reports `whenPresent`; without
 * restorable data it reports `NOT_CONFIGURED` so the corrective action becomes creation.
 */
function candidateFields(set: CandidateSet, whenPresent: SupplierSetupBlockerReason) {
  if (!set.total) return { reason: 'NOT_CONFIGURED' as const };
  return { reason: whenPresent, candidates: set.items, candidateTotal: set.total };
}

async function inactiveCandidates(
  client: ReadinessClient,
  kind: 'SHIFT_TEMPLATE' | 'MEMBER' | 'LINE',
  supplierId: string,
): Promise<CandidateSet> {
  const take = READINESS_CANDIDATE_LIMIT;
  if (kind === 'SHIFT_TEMPLATE') {
    const where = { supplierId, active: false };
    const [total, rows] = await Promise.all([
      client.shiftTemplate.count({ where }),
      client.shiftTemplate.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        take,
        select: { id: true, name: true, startMinute: true, endMinute: true },
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        kind,
        id: row.id,
        label: row.name,
        detail: `${minuteToTime(row.startMinute)}–${minuteToTime(row.endMinute)}`,
      })),
    };
  }
  if (kind === 'MEMBER') {
    const where = { supplierId, active: false };
    const [total, rows] = await Promise.all([
      client.member.count({ where }),
      client.member.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take,
        select: { id: true, fullName: true, role: true },
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        kind,
        id: row.id,
        label: row.fullName,
        detail: roleLabel[row.role],
        role: row.role,
      })),
    };
  }
  const where = { supplierId, active: false };
  const [total, rows] = await Promise.all([
    client.line.count({ where }),
    client.line.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      take,
      select: { id: true, code: true, name: true },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({ kind, id: row.id, label: row.name, detail: row.code })),
  };
}
