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
    lineShifts,
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
      select: { id: true, lineId: true },
    }),
    client.part.count({ where: { supplierId, active: true } }),
    client.shiftTemplate.count({ where: { supplierId, active: true } }),
    client.checklistVersion.findMany({
      where: { supplierId, template: { active: true } },
      distinct: ['category'],
      select: { category: true },
    }),
    client.lineShift.findMany({
      where: {
        supplierId,
        active: true,
        line: { active: true },
        shiftTemplate: { active: true },
        supervisor: {
          active: true,
          users: { some: { status: 'ACTIVE', role: 'SUPERVISOR' } },
        },
      },
      select: {
        id: true,
        lineId: true,
        supervisorMemberId: true,
        lineLeaderMemberId: true,
        jobAssignments: {
          where: { job: { active: true } },
          select: { jobId: true, mpMemberId: true },
        },
      },
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

  const configuredLines = new Set(lineShifts.map(({ lineId }) => lineId));
  for (const { id } of lines) {
    if (!configuredLines.has(id)) {
      add(
        'DEFAULT_ASSIGNMENTS',
        'LINE_SHIFT_MISSING',
        'Setiap line aktif memerlukan minimal satu shift.',
        id,
      );
    }
  }
  for (const lineShift of lineShifts) {
    if (!lineShift.supervisorMemberId) {
      add(
        'DEFAULT_ASSIGNMENTS',
        'LINE_SHIFT_SUPERVISOR_MISSING',
        'Setiap line dan shift memerlukan Supervisor.',
        lineShift.id,
      );
    }
    if (!lineShift.lineLeaderMemberId) {
      add(
        'DEFAULT_ASSIGNMENTS',
        'LINE_SHIFT_LEADER_MISSING',
        'Setiap line dan shift memerlukan Line Leader.',
        lineShift.id,
      );
    }
    const staffed = new Set(
      lineShift.jobAssignments.filter(({ mpMemberId }) => mpMemberId).map(({ jobId }) => jobId),
    );
    for (const { id: jobId } of jobs.filter((job) => job.lineId === lineShift.lineId)) {
      if (!staffed.has(jobId)) {
        add(
          'DEFAULT_ASSIGNMENTS',
          'LINE_SHIFT_MP_MISSING',
          'Setiap job pada line dan shift memerlukan MP.',
          lineShift.id,
        );
      }
    }
  }

  const assignmentRequiredCount = lineShifts.reduce(
    (total, item) => total + 2 + jobs.filter((job) => job.lineId === item.lineId).length,
    0,
  );
  const assignmentActiveCount = lineShifts.reduce(
    (total, item) =>
      total +
      Number(Boolean(item.supervisorMemberId)) +
      Number(Boolean(item.lineLeaderMemberId)) +
      item.jobAssignments.filter(({ mpMemberId }) => mpMemberId).length,
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
