import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuditQuery, DashboardQuery } from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';

import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { PrismaService } from '../persistence/prisma.service.js';

@Injectable()
export class ReadModelService {
  constructor(private readonly prisma: PrismaService) {}

  async board(scope: TenantScope, principal: RequestPrincipal, requestedLineId?: string) {
    const shifts = await this.prisma.shiftRun.findMany({
      where: {
        supplierId: scope.supplierId,
        status: 'ACTIVE',
        ...(requestedLineId ? { lineId: requestedLineId } : {}),
        ...shiftScope(principal),
      },
      include: {
        workingAssignments: {
          where: { active: true, includedInPlan: true },
          orderBy: [{ jobDisplayOrderSnapshot: 'asc' }, { id: 'asc' }],
          include: {
            effectiveMp: {
              include: { photos: { where: { state: 'CURRENT' }, take: 1 } },
            },
          },
        },
        henkatens: {
          where: { status: { in: ['OPEN', 'APPROVED'] } },
          include: { approvalRoutes: true },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        },
        assignmentIssues: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
      },
      orderBy: [{ lineCodeSnapshot: 'asc' }, { id: 'asc' }],
    });
    const updated = shifts.flatMap((shift) => [
      shift.updatedAt,
      ...shift.workingAssignments.map(({ updatedAt }) => updatedAt),
      ...shift.henkatens.map(({ updatedAt }) => updatedAt),
    ]);
    const lastUpdatedAt = updated.length
      ? new Date(Math.max(...updated.map((value) => value.getTime())))
      : new Date();
    const version = createHash('sha256')
      .update(
        shifts
          .flatMap((shift) => [
            `${shift.id}:${shift.version}`,
            ...shift.workingAssignments.map(
              ({ id, version: itemVersion }) => `${id}:${itemVersion}`,
            ),
            ...shift.henkatens.map(({ id, version: itemVersion }) => `${id}:${itemVersion}`),
          ])
          .join('|'),
      )
      .digest('base64url')
      .slice(0, 22);
    return {
      version,
      lastUpdatedAt: lastUpdatedAt.toISOString(),
      lines: shifts.map((shift) => ({
        shiftRunId: shift.id,
        lineId: shift.lineId,
        lineCode: shift.lineCodeSnapshot,
        lineName: shift.lineNameSnapshot,
        shiftName: shift.shiftNameSnapshot,
        businessDate: shift.businessDate.toISOString().slice(0, 10),
        supervisor: {
          memberId: shift.supervisorMemberId,
          name: shift.supervisorNameSnapshot,
        },
        lineLeader: {
          memberId: shift.lineLeaderMemberId,
          name: shift.lineLeaderNameSnapshot,
        },
        activeOverride:
          shift.startedWithOverride && shift.overrideReason && shift.startedAt
            ? {
                reason: shift.overrideReason,
                startedAt: shift.startedAt.toISOString(),
                unresolvedIssueCount: shift.assignmentIssues.length,
                failedChecks: overrideChecks(shift.overrideFailedChecks),
              }
            : null,
        jobs: shift.workingAssignments.map((assignment) => ({
          assignmentId: assignment.id,
          jobId: assignment.jobId,
          jobName: assignment.jobNameSnapshot,
          displayOrder: assignment.jobDisplayOrderSnapshot,
          state: assignment.state,
          mp: {
            memberId: assignment.effectiveMpMemberId,
            name: assignment.mpNameSnapshot,
            registrationNumber: assignment.mpRegistrationSnapshot,
            photoThumbnailUrl: assignment.effectiveMp?.photos[0]
              ? `/api/v1/supplier/master-data/members/${assignment.effectiveMp.id}/photo/thumbnail`
              : null,
            initials: initials(assignment.mpNameSnapshot),
          },
          indicators: shift.henkatens
            .filter(({ jobId }) => jobId === assignment.jobId)
            .map((henkaten) => ({
              henkatenId: henkaten.id,
              identifier: henkaten.identifier,
              category: henkaten.category,
              status: henkaten.status,
              approval: {
                supervisor:
                  henkaten.approvalRoutes.find(({ route }) => route === 'SUPERVISOR')?.status ??
                  'PENDING',
                qc:
                  henkaten.approvalRoutes.find(({ route }) => route === 'QC')?.status ?? 'PENDING',
              },
            })),
        })),
      })),
    };
  }

  async supplierDashboard(scope: TenantScope, principal: RequestPrincipal, query: DashboardQuery) {
    const auditLineIds = await this.auditLineScope(scope, principal);
    const roleShiftScope = shiftScope(principal);
    const [lineOptions, shiftTemplateOptions] = await Promise.all([
      this.prisma.line.findMany({
        where: {
          supplierId: scope.supplierId,
          active: true,
          ...(Object.keys(roleShiftScope).length ? { shiftRuns: { some: roleShiftScope } } : {}),
        },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, code: true, name: true },
      }),
      this.prisma.shiftTemplate.findMany({
        where: {
          supplierId: scope.supplierId,
          active: true,
          ...(Object.keys(roleShiftScope).length ? { shiftRuns: { some: roleShiftScope } } : {}),
        },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);
    const scopedShiftWhere: Prisma.ShiftRunWhereInput = {
      supplierId: scope.supplierId,
      ...shiftScope(principal),
      ...(query.lineId ? { lineId: query.lineId } : {}),
      ...(query.shiftTemplateId ? { shiftTemplateId: query.shiftTemplateId } : {}),
      ...(query.from || query.to
        ? {
            scheduledStartAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const where: Prisma.HenkatenWhereInput = {
      supplierId: scope.supplierId,
      ...henkatenScope(principal),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.lineId ? { lineId: query.lineId } : {}),
      ...(query.shiftTemplateId ? { shiftRun: { shiftTemplateId: query.shiftTemplateId } } : {}),
      ...(query.approvalRoute || query.approvalStatus
        ? {
            approvalRoutes: {
              some: {
                ...(query.approvalRoute ? { route: query.approvalRoute } : {}),
                ...(query.approvalStatus ? { status: query.approvalStatus } : {}),
              },
            },
          }
        : {}),
      ...(query.part
        ? {
            OR: [
              { partNumberSnapshot: { contains: query.part, mode: 'insensitive' } },
              { partNameSnapshot: { contains: query.part, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [
      status,
      category,
      line,
      part,
      routes,
      pendingRouteRows,
      warnings,
      issueGroups,
      overrideCount,
      recentOverrides,
      trendRows,
      recent,
    ] = await Promise.all([
      this.prisma.henkaten.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.henkaten.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
      }),
      this.prisma.henkaten.groupBy({
        by: ['lineNameSnapshot'],
        where,
        _count: { _all: true },
        orderBy: { _count: { lineNameSnapshot: 'desc' } },
        take: 20,
      }),
      this.prisma.henkaten.groupBy({
        by: ['partNumberSnapshot'],
        where,
        _count: { _all: true },
        orderBy: { _count: { partNumberSnapshot: 'desc' } },
        take: 20,
      }),
      this.prisma.henkatenApprovalRoute.groupBy({
        by: ['route'],
        where: {
          supplierId: scope.supplierId,
          status: 'PENDING',
          henkaten: where,
        },
        _count: { _all: true },
      }),
      this.prisma.henkatenApprovalRoute.findMany({
        where: {
          supplierId: scope.supplierId,
          status: 'PENDING',
          henkaten: where,
        },
        select: { createdAt: true },
      }),
      this.prisma.warningInstance.count({
        where: { supplierId: scope.supplierId, status: 'OPEN', henkaten: where },
      }),
      this.prisma.assignmentIssue.groupBy({
        by: ['type'],
        where: {
          supplierId: scope.supplierId,
          status: 'OPEN',
          shiftRun: scopedShiftWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.shiftRun.count({
        where: {
          startedWithOverride: true,
          ...scopedShiftWhere,
        },
      }),
      this.prisma.shiftRun.findMany({
        where: {
          startedWithOverride: true,
          ...scopedShiftWhere,
        },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          lineId: true,
          lineNameSnapshot: true,
          businessDate: true,
          overrideReason: true,
          startedAt: true,
        },
      }),
      this.prisma.henkaten.findMany({
        where,
        select: { occurredAt: true, category: true, status: true },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.auditEvent.findMany({
        where: {
          supplierId: scope.supplierId,
          ...(auditLineIds ? { lineId: { in: auditLineIds } } : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
    ]);
    const byStatus = new Map(status.map((item) => [item.status, item._count._all]));
    const approvalAging = approvalAgingBuckets(pendingRouteRows.map(({ createdAt }) => createdAt));
    const trend = aggregateDashboardTrend(trendRows, query.granularity);
    const unresolvedIssueCount = issueGroups.reduce((sum, item) => sum + item._count._all, 0);
    return {
      generatedAt: new Date().toISOString(),
      filterOptions: {
        lines: lineOptions,
        shiftTemplates: shiftTemplateOptions,
      },
      totals: {
        all: status.reduce((sum, item) => sum + item._count._all, 0),
        open: byStatus.get('OPEN') ?? 0,
        approved: byStatus.get('APPROVED') ?? 0,
        rejected: byStatus.get('REJECTED') ?? 0,
        cancelled: byStatus.get('CANCELLED') ?? 0,
        activeWarnings: warnings,
        unresolvedAssignmentIssues: unresolvedIssueCount,
        emergencyOverrides: overrideCount,
      },
      pendingApprovals: {
        supervisor: routes.find(({ route }) => route === 'SUPERVISOR')?._count._all ?? 0,
        qc: routes.find(({ route }) => route === 'QC')?._count._all ?? 0,
      },
      approvalAging,
      trend,
      assignmentIssues: issueGroups.map((item) => ({
        type: item.type,
        count: item._count._all,
      })),
      recentOverrides: recentOverrides.flatMap((shift) =>
        shift.overrideReason && shift.startedAt
          ? [
              {
                shiftRunId: shift.id,
                lineId: shift.lineId,
                lineName: shift.lineNameSnapshot,
                businessDate: shift.businessDate.toISOString().slice(0, 10),
                reason: shift.overrideReason,
                startedAt: shift.startedAt.toISOString(),
              },
            ]
          : [],
      ),
      byCategory: category.map((item) => ({ label: item.category, count: item._count._all })),
      byLine: line.map((item) => ({ label: item.lineNameSnapshot, count: item._count._all })),
      byPart: part.map((item) => ({ label: item.partNumberSnapshot, count: item._count._all })),
      outcomes: status
        .filter(({ status: value }) => value !== 'OPEN')
        .map((item) => ({ label: item.status, count: item._count._all })),
      recentActivity: recent.map((item) => ({
        id: item.id,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        occurredAt: item.occurredAt.toISOString(),
      })),
    };
  }

  async tmminDashboard() {
    const [
      suppliers,
      hostedOpen,
      externalOpen,
      affected,
      overrides,
      hostedCategories,
      externalCategories,
      hostedOutcomes,
      externalOutcomes,
      accepted,
      recentRejected,
      freshness,
    ] = await Promise.all([
      this.prisma.supplier.groupBy({
        by: ['sourceMode'],
        where: { active: true },
        _count: { _all: true },
      }),
      this.prisma.henkaten.count({ where: { status: 'OPEN' } }),
      this.prisma.externalHenkatenProjection.count({ where: { status: 'OPEN' } }),
      this.prisma.warningInstance.groupBy({
        by: ['supplierId', 'normalizedPartNumberSnapshot'],
        where: { status: 'OPEN' },
      }),
      this.prisma.shiftRun.count({ where: { startedWithOverride: true } }),
      this.prisma.henkaten.groupBy({
        by: ['category'],
        _count: { _all: true },
      }),
      this.prisma.externalHenkatenProjection.groupBy({
        by: ['category'],
        _count: { _all: true },
      }),
      this.prisma.henkaten.groupBy({
        by: ['status'],
        where: { status: { not: 'OPEN' } },
        _count: { _all: true },
      }),
      this.prisma.externalHenkatenProjection.groupBy({
        by: ['status'],
        where: { status: { not: 'OPEN' } },
        _count: { _all: true },
      }),
      this.prisma.externalIngestionEvent.count(),
      this.prisma.auditEvent.count({
        where: {
          action: 'EXTERNAL_INGEST_REJECTED',
          occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
      }),
      this.prisma.supplier.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          sourceMode: true,
          henkatens: { orderBy: { updatedAt: 'desc' }, take: 1, select: { updatedAt: true } },
          externalProjections: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: { updatedAt: true },
          },
          externalApiClients: {
            orderBy: { lastSuccessfulIngestionAt: 'desc' },
            take: 1,
            select: { lastSuccessfulIngestionAt: true },
          },
          warningInstances: { where: { status: 'OPEN' }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    const source = new Map(suppliers.map((item) => [item.sourceMode, item._count._all]));
    return {
      generatedAt: new Date().toISOString(),
      suppliers: {
        active: suppliers.reduce((sum, item) => sum + item._count._all, 0),
        hosted: source.get('HOSTED') ?? 0,
        external: source.get('EXTERNAL') ?? 0,
        withWarnings: freshness.filter(({ warningInstances }) => warningInstances.length > 0)
          .length,
      },
      openHenkatens: hostedOpen + externalOpen,
      affectedParts: affected.length,
      emergencyOverrides: overrides,
      externalIngestion: { accepted, recentRejected },
      bySourceMode: suppliers.map((item) => ({
        label: item.sourceMode,
        count: item._count._all,
      })),
      byCategory: mergeCounts(hostedCategories, externalCategories, 'category'),
      outcomes: mergeCounts(hostedOutcomes, externalOutcomes, 'status'),
      freshness: freshness.map((supplier) => ({
        supplierId: supplier.id,
        supplierName: supplier.name,
        sourceMode: supplier.sourceMode,
        lastDataAt:
          (supplier.sourceMode === 'EXTERNAL'
            ? supplier.externalProjections[0]?.updatedAt
            : supplier.henkatens[0]?.updatedAt
          )?.toISOString() ?? null,
        activeWarnings: supplier.warningInstances.length,
        lastIngestionAt:
          supplier.externalApiClients[0]?.lastSuccessfulIngestionAt?.toISOString() ?? null,
      })),
    };
  }

  async supplierAudit(scope: TenantScope, principal: RequestPrincipal, query: AuditQuery) {
    const lineIds = await this.auditLineScope(scope, principal);
    return this.auditPage(
      {
        supplierId: scope.supplierId,
        ...(lineIds ? { lineId: { in: lineIds } } : {}),
      },
      query,
    );
  }

  async tmminAudit(query: AuditQuery) {
    return this.auditPage({}, query);
  }

  private async auditPage(where: Prisma.AuditEventWhereInput, query: AuditQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...where,
        ...(query.action ? { action: query.action } : {}),
        ...(query.resourceType ? { resourceType: query.resourceType } : {}),
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorKind: row.actorKind,
        actorRole: row.actorRole,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        lineId: row.lineId,
        changeSummary: redact(row.changeSummary),
        result: row.result,
        correlationId: row.correlationId,
      })),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)!.id) : null,
      },
    };
  }

  private async auditLineScope(
    scope: TenantScope,
    principal: RequestPrincipal,
  ): Promise<string[] | null> {
    if (['SUPPLIER_ADMIN', 'QC'].includes(principal.role)) return null;
    if (!principal.memberId) return [];
    const shifts = await this.prisma.shiftRun.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(principal.role === 'SUPERVISOR'
          ? { supervisorMemberId: principal.memberId }
          : { lineLeaderMemberId: principal.memberId }),
      },
      distinct: ['lineId'],
      select: { lineId: true },
    });
    return shifts.map(({ lineId }) => lineId);
  }
}

function mergeCounts<T extends Record<K, string>, K extends keyof T>(
  left: Array<T & { _count: { _all: number } }>,
  right: Array<T & { _count: { _all: number } }>,
  key: K,
) {
  const counts = new Map<string, number>();
  for (const item of [...left, ...right]) {
    const label = item[key];
    counts.set(label, (counts.get(label) ?? 0) + item._count._all);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

function shiftScope(principal: RequestPrincipal): Prisma.ShiftRunWhereInput {
  if (principal.realm === 'TMMIN' || ['SUPPLIER_ADMIN', 'QC'].includes(principal.role)) return {};
  if (!principal.memberId) return { id: '00000000-0000-0000-0000-000000000000' };
  return principal.role === 'SUPERVISOR'
    ? { supervisorMemberId: principal.memberId }
    : { lineLeaderMemberId: principal.memberId };
}

function henkatenScope(principal: RequestPrincipal): Prisma.HenkatenWhereInput {
  const shift = shiftScope(principal);
  return Object.keys(shift).length ? { shiftRun: shift } : {};
}

function initials(name: string | null): string | null {
  if (!name) return null;
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function redact(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const denied = /password|secret|token|cookie|authorization|registration|photo/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !denied.test(key))
      .map(([key, entry]) => [key, typeof entry === 'string' ? entry.slice(0, 500) : entry]),
  );
}

function overrideChecks(value: Prisma.JsonValue | null): Array<{
  code: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const code = 'code' in entry && typeof entry.code === 'string' ? entry.code : null;
    const message = 'message' in entry && typeof entry.message === 'string' ? entry.message : null;
    if (!code || !message) return [];
    const resourceType =
      'resourceType' in entry && typeof entry.resourceType === 'string'
        ? entry.resourceType
        : undefined;
    const resourceId =
      'resourceId' in entry && typeof entry.resourceId === 'string' ? entry.resourceId : undefined;
    return [
      {
        code,
        message,
        ...(resourceType ? { resourceType } : {}),
        ...(resourceId ? { resourceId } : {}),
      },
    ];
  });
}

function approvalAgingBuckets(createdAt: Date[]) {
  const counts = new Map<string, number>([
    ['UNDER_4_HOURS', 0],
    ['FOUR_TO_EIGHT_HOURS', 0],
    ['EIGHT_TO_24_HOURS', 0],
    ['OVER_24_HOURS', 0],
  ]);
  const now = Date.now();
  for (const created of createdAt) {
    const hours = (now - created.getTime()) / 3_600_000;
    const bucket =
      hours < 4
        ? 'UNDER_4_HOURS'
        : hours < 8
          ? 'FOUR_TO_EIGHT_HOURS'
          : hours < 24
            ? 'EIGHT_TO_24_HOURS'
            : 'OVER_24_HOURS';
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts].map(([bucket, count]) => ({ bucket, count }));
}

function aggregateDashboardTrend(
  rows: Array<{
    occurredAt: Date;
    category: 'MAN' | 'MACHINE' | 'MATERIAL' | 'METHOD';
    status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  }>,
  granularity: 'DAY' | 'WEEK' | 'MONTH',
) {
  const periods = new Map<
    string,
    {
      periodStart: string;
      total: number;
      man: number;
      machine: number;
      material: number;
      method: number;
      approved: number;
      rejected: number;
      cancelled: number;
    }
  >();
  for (const row of rows) {
    const periodStart = dashboardPeriod(row.occurredAt, granularity);
    const current = periods.get(periodStart) ?? {
      periodStart,
      total: 0,
      man: 0,
      machine: 0,
      material: 0,
      method: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    current.total += 1;
    current[row.category.toLowerCase() as 'man' | 'machine' | 'material' | 'method'] += 1;
    if (row.status !== 'OPEN') {
      current[row.status.toLowerCase() as 'approved' | 'rejected' | 'cancelled'] += 1;
    }
    periods.set(periodStart, current);
  }
  return [...periods.values()].sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart),
  );
}

function dashboardPeriod(value: Date, granularity: 'DAY' | 'WEEK' | 'MONTH'): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  if (granularity === 'WEEK') {
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
  }
  if (granularity === 'MONTH') date.setUTCDate(1);
  return date.toISOString();
}
