import { Injectable } from '@nestjs/common';

import type { SupplierSetupArea } from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../persistence/prisma.service.js';

type ReadinessClient = PrismaService | Prisma.TransactionClient;

export type HostedReadinessBlocker = {
  contributor: 'hosted-configuration';
  area: SupplierSetupArea;
  code: string;
  detail: string;
  resourceType?: string;
  resourceId?: string;
};

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
    supervisorAssignments,
    leaderAssignments,
    mpAssignments,
  ] = await Promise.all([
    client.user.count({ where: { supplierId, role: 'SUPPLIER_ADMIN', status: 'ACTIVE' } }),
    client.member.count({ where: { supplierId, active: true } }),
    client.user.count({
      where: {
        supplierId,
        status: 'ACTIVE',
        role: { in: ['SUPERVISOR', 'LINE_LEADER', 'QC'] },
        member: { active: true },
      },
    }),
    client.line.findMany({ where: { supplierId, active: true }, select: { id: true } }),
    client.job.findMany({
      where: { supplierId, active: true, line: { active: true } },
      select: { id: true },
    }),
    client.part.count({ where: { supplierId, active: true } }),
    client.shiftTemplate.count({ where: { supplierId, active: true } }),
    client.checklistVersion.findMany({
      where: { supplierId, template: { active: true } },
      distinct: ['category'],
      select: { category: true },
    }),
    client.defaultLineSupervisor.findMany({
      where: {
        supplierId,
        line: { active: true },
        supervisor: {
          active: true,
          users: { some: { status: 'ACTIVE', role: 'SUPERVISOR' } },
        },
      },
      select: { lineId: true },
    }),
    client.defaultLineLeader.findMany({
      where: {
        supplierId,
        line: { active: true },
        lineLeader: {
          active: true,
          users: { some: { status: 'ACTIVE', role: 'LINE_LEADER' } },
        },
      },
      select: { lineId: true },
    }),
    client.defaultJobMp.findMany({
      where: { supplierId, job: { active: true }, mp: { active: true } },
      select: { jobId: true },
    }),
  ]);

  const blockers: HostedReadinessBlocker[] = [];
  const add = (area: SupplierSetupArea, code: string, detail: string, resourceId?: string) =>
    blockers.push({
      contributor: 'hosted-configuration',
      area,
      code,
      detail,
      ...(resourceId ? { resourceId, resourceType: area === 'LINES_JOBS' ? 'Line' : 'Job' } : {}),
    });

  if (!shiftCount) {
    add(
      'SHIFT_TEMPLATES',
      'ACTIVE_SHIFT_TEMPLATE_MISSING',
      'Minimal satu Shift Template aktif diperlukan.',
    );
  }
  if (!activeMembers) {
    add('MEMBERS_ACCOUNTS', 'ACTIVE_MEMBER_MISSING', 'Minimal satu member aktif diperlukan.');
  }
  if (activeAdminCount !== 1) {
    add('MEMBERS_ACCOUNTS', 'HOSTED_ADMIN_MISSING', 'Harus ada tepat satu Supplier Admin aktif.');
  }
  if (!activeOperationalAccounts) {
    add(
      'MEMBERS_ACCOUNTS',
      'OPERATIONAL_ACCOUNT_MISSING',
      'Minimal satu akun operasional Supervisor, Line Leader, atau QC diperlukan.',
    );
  }
  if (!lines.length)
    add('LINES_JOBS', 'ACTIVE_LINE_MISSING', 'Minimal satu line aktif diperlukan.');
  if (!jobs.length) add('LINES_JOBS', 'ACTIVE_JOB_MISSING', 'Minimal satu job aktif diperlukan.');
  if (!partCount) add('PARTS', 'ACTIVE_PART_MISSING', 'Minimal satu part aktif diperlukan.');

  const categories = new Set(checklistCategories.map(({ category }) => category));
  for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const) {
    if (!categories.has(category)) {
      add(
        'CHECKLISTS',
        `CHECKLIST_${category}_MISSING`,
        `Checklist ${category} yang aktif dan sudah dipublikasikan diperlukan.`,
      );
    }
  }

  const supervised = new Set(supervisorAssignments.map(({ lineId }) => lineId));
  const led = new Set(leaderAssignments.map(({ lineId }) => lineId));
  for (const { id } of lines) {
    if (!supervised.has(id)) {
      add(
        'DEFAULT_ASSIGNMENTS',
        'LINE_SUPERVISOR_MISSING',
        'Setiap line aktif memerlukan Supervisor.',
        id,
      );
    }
    if (!led.has(id)) {
      add(
        'DEFAULT_ASSIGNMENTS',
        'LINE_LEADER_MISSING',
        'Setiap line aktif memerlukan Line Leader.',
        id,
      );
    }
  }
  const staffed = new Set(mpAssignments.map(({ jobId }) => jobId));
  for (const { id } of jobs) {
    if (!staffed.has(id)) {
      add('DEFAULT_ASSIGNMENTS', 'JOB_MP_MISSING', 'Setiap job aktif memerlukan MP default.', id);
    }
  }

  const assignmentRequiredCount = lines.length * 2 + jobs.length;
  const assignmentActiveCount =
    supervisorAssignments.length + leaderAssignments.length + mpAssignments.length;
  const counts: Record<SupplierSetupArea, { activeCount: number; requiredCount: number }> = {
    SHIFT_TEMPLATES: { activeCount: shiftCount, requiredCount: 1 },
    MEMBERS_ACCOUNTS: {
      activeCount: Math.min(activeMembers, activeOperationalAccounts),
      requiredCount: 1,
    },
    LINES_JOBS: { activeCount: lines.length + jobs.length, requiredCount: 2 },
    PARTS: { activeCount: partCount, requiredCount: 1 },
    CHECKLISTS: { activeCount: categories.size, requiredCount: 4 },
    DEFAULT_ASSIGNMENTS: {
      activeCount: assignmentActiveCount,
      requiredCount: assignmentRequiredCount,
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
