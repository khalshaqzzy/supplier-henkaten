import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuditQuery, DashboardQuery, TmminDashboardQuery } from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';

import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';

@Injectable()
export class ReadModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

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

  async tmminDashboard(query: TmminDashboardQuery) {
    const supplierWhere: Prisma.SupplierWhereInput = {
      active: true,
      ...(query.supplierId ? { id: query.supplierId } : {}),
      ...(query.sourceMode ? { sourceMode: query.sourceMode } : {}),
    };
    const occurredAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
    const hostedWhere: Prisma.HenkatenWhereInput = {
      supplier: supplierWhere,
      ...(query.from || query.to ? { occurredAt } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.line ? { lineNameSnapshot: { contains: query.line, mode: 'insensitive' } } : {}),
      ...(query.part
        ? {
            OR: [
              { partNumberSnapshot: { contains: query.part, mode: 'insensitive' } },
              { partNameSnapshot: { contains: query.part, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const externalWhere: Prisma.ExternalHenkatenProjectionWhereInput = {
      supplier: supplierWhere,
      ...(query.from || query.to ? { occurredAt } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.line ? { lineSnapshot: { string_contains: query.line, mode: 'insensitive' } } : {}),
      ...(query.part ? { partSnapshot: { string_contains: query.part, mode: 'insensitive' } } : {}),
    };
    const [
      suppliers,
      hostedRows,
      externalRows,
      warningRows,
      overrideRows,
      accepted,
      externalAttempts,
      freshness,
    ] = await Promise.all([
      this.prisma.supplier.groupBy({
        by: ['sourceMode'],
        where: supplierWhere,
        _count: { _all: true },
      }),
      query.sourceMode === 'EXTERNAL'
        ? Promise.resolve([])
        : this.prisma.henkaten.findMany({
            where: hostedWhere,
            select: {
              id: true,
              supplierId: true,
              status: true,
              category: true,
              lineNameSnapshot: true,
              partNumberSnapshot: true,
              occurredAt: true,
              supplier: { select: { name: true } },
            },
          }),
      query.sourceMode === 'HOSTED'
        ? Promise.resolve([])
        : this.prisma.externalHenkatenProjection.findMany({
            where: externalWhere,
            select: {
              id: true,
              supplierId: true,
              status: true,
              category: true,
              lineSnapshot: true,
              partSnapshot: true,
              occurredAt: true,
              supplier: { select: { name: true } },
            },
          }),
      this.prisma.warningInstance.findMany({
        where: {
          status: 'OPEN',
          supplier: supplierWhere,
          ...(query.from || query.to ? { openedAt: occurredAt } : {}),
        },
        select: {
          supplierId: true,
          normalizedPartNumberSnapshot: true,
          partNumberSnapshot: true,
          openedAt: true,
        },
      }),
      query.sourceMode === 'EXTERNAL'
        ? Promise.resolve([])
        : this.prisma.shiftRun.findMany({
            where: {
              startedWithOverride: true,
              supplier: supplierWhere,
              ...(query.from || query.to ? { startedAt: occurredAt } : {}),
              ...(query.line
                ? { lineNameSnapshot: { contains: query.line, mode: 'insensitive' } }
                : {}),
            },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            take: 10,
            select: {
              id: true,
              supplierId: true,
              lineNameSnapshot: true,
              businessDate: true,
              overrideReason: true,
              startedAt: true,
              supplier: { select: { name: true } },
            },
          }),
      this.prisma.externalIngestionEvent.count({
        where: {
          supplier: supplierWhere,
          ...(query.from || query.to ? { receivedAt: occurredAt } : {}),
        },
      }),
      this.prisma.auditEvent.groupBy({
        by: ['action'],
        where: {
          action: { in: ['EXTERNAL_INGEST_DUPLICATE', 'EXTERNAL_INGEST_REJECTED'] },
          supplier: supplierWhere,
          ...(query.from || query.to ? { occurredAt } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.supplier.findMany({
        where: supplierWhere,
        select: {
          id: true,
          code: true,
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
    const records = [
      ...hostedRows.map((row) => ({
        supplierId: row.supplierId,
        supplierName: row.supplier.name,
        sourceMode: 'HOSTED' as const,
        status: row.status,
        category: row.category,
        line: row.lineNameSnapshot,
        part: row.partNumberSnapshot,
        occurredAt: row.occurredAt,
      })),
      ...externalRows.map((row) => ({
        supplierId: row.supplierId,
        supplierName: row.supplier.name,
        sourceMode: 'EXTERNAL' as const,
        status: row.status,
        category: row.category,
        line: snapshotLabel(row.lineSnapshot),
        part: snapshotLabel(row.partSnapshot, 'number'),
        occurredAt: row.occurredAt,
      })),
    ];
    const filteredWarnings = warningRows.filter(({ openedAt }) =>
      query.aging ? ageBucket(openedAt) === query.aging : true,
    );
    const freshnessRows = freshness
      .map((supplier) => {
        const lastDataAt =
          supplier.sourceMode === 'EXTERNAL'
            ? supplier.externalProjections[0]?.updatedAt
            : supplier.henkatens[0]?.updatedAt;
        return {
          supplierId: supplier.id,
          supplierCode: supplier.code,
          supplierName: supplier.name,
          sourceMode: supplier.sourceMode,
          lastDataAt: lastDataAt?.toISOString() ?? null,
          activeWarnings: supplier.warningInstances.length,
          lastIngestionAt:
            supplier.externalApiClients[0]?.lastSuccessfulIngestionAt?.toISOString() ?? null,
          state: freshnessState(lastDataAt ?? null),
        };
      })
      .filter(({ state }) => (query.freshness ? state === query.freshness : true));
    const duplicate =
      externalAttempts.find(({ action }) => action === 'EXTERNAL_INGEST_DUPLICATE')?._count._all ??
      0;
    const rejected =
      externalAttempts.find(({ action }) => action === 'EXTERNAL_INGEST_REJECTED')?._count._all ??
      0;
    const trend = dashboardTrend(records, query.granularity, query.from, query.to);
    const freshnessSummary = {
      fresh: freshnessRows.filter(({ state }) => state === 'FRESH').length,
      warning: freshnessRows.filter(({ state }) => state === 'WARNING').length,
      stale: freshnessRows.filter(({ state }) => state === 'STALE').length,
      noData: freshnessRows.filter(({ state }) => state === 'NO_DATA').length,
    };
    const supplierOverview = freshnessRows
      .map((supplier) => {
        const supplierRecords = records.filter(
          ({ supplierId }) => supplierId === supplier.supplierId,
        );
        const supplierWarnings = filteredWarnings.filter(
          ({ supplierId }) => supplierId === supplier.supplierId,
        );
        return {
          supplierId: supplier.supplierId,
          supplierCode: supplier.supplierCode,
          supplierName: supplier.supplierName,
          sourceMode: supplier.sourceMode,
          openHenkatens: supplierRecords.filter(({ status }) => status === 'OPEN').length,
          activeWarnings: supplierWarnings.length,
          over24HourWarnings: supplierWarnings.filter(
            ({ openedAt }) => ageBucket(openedAt) === 'OVER_24_HOURS',
          ).length,
          freshness: supplier.state,
          lastDataAt: supplier.lastDataAt,
        };
      })
      .sort(
        (left, right) =>
          right.openHenkatens - left.openHenkatens ||
          right.activeWarnings - left.activeWarnings ||
          left.supplierName.localeCompare(right.supplierName),
      )
      .slice(0, 10);
    return {
      generatedAt: new Date().toISOString(),
      filterOptions: {
        suppliers: freshness.map((supplier) => ({
          id: supplier.id,
          code: supplier.code,
          name: supplier.name,
          sourceMode: supplier.sourceMode,
        })),
      },
      suppliers: {
        active: suppliers.reduce((sum, item) => sum + item._count._all, 0),
        hosted: source.get('HOSTED') ?? 0,
        external: source.get('EXTERNAL') ?? 0,
        withWarnings: freshnessRows.filter(({ activeWarnings }) => activeWarnings > 0).length,
      },
      openHenkatens: records.filter(({ status }) => status === 'OPEN').length,
      affectedParts: new Set(
        filteredWarnings.map(
          ({ supplierId, normalizedPartNumberSnapshot }) =>
            `${supplierId}:${normalizedPartNumberSnapshot}`,
        ),
      ).size,
      emergencyOverrides: overrideRows.length,
      externalIngestion: { accepted, duplicate, rejected, recentRejected: rejected },
      aging: ['UNDER_4_HOURS', 'FOUR_TO_EIGHT_HOURS', 'EIGHT_TO_24_HOURS', 'OVER_24_HOURS'].map(
        (bucket) => ({
          bucket,
          count: warningRows.filter(({ openedAt }) => ageBucket(openedAt) === bucket).length,
        }),
      ),
      bySourceMode: suppliers.map((item) => ({
        label: item.sourceMode,
        count: item._count._all,
      })),
      byCategory: countLabels(records.map(({ category }) => category)),
      outcomes: countLabels(
        records.filter(({ status }) => status !== 'OPEN').map(({ status }) => status),
      ),
      rankings: {
        suppliers: rankLabels(records.map(({ supplierName }) => supplierName)),
        lines: rankLabels(records.map(({ line }) => line)),
        parts: rankLabels(records.map(({ part }) => part)),
      },
      trend,
      freshnessSummary,
      supplierOverview,
      freshness: freshnessRows,
      recentOverrides: overrideRows.flatMap((row) =>
        row.startedAt && row.overrideReason
          ? [
              {
                shiftRunId: row.id,
                supplierId: row.supplierId,
                supplierName: row.supplier.name,
                lineName: row.lineNameSnapshot,
                businessDate: row.businessDate.toISOString().slice(0, 10),
                reason: row.overrideReason,
                startedAt: row.startedAt.toISOString(),
              },
            ]
          : [],
      ),
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

  async tmminAudit(principal: RequestPrincipal, query: AuditQuery, correlationId: string) {
    const qualityActions =
      principal.role === 'TMMIN_QUALITY'
        ? {
            OR: [
              { action: { startsWith: 'HENKATEN_' } },
              { action: { startsWith: 'WARNING_' } },
              { action: { startsWith: 'SHIFT_' } },
              { action: { startsWith: 'ASSIGNMENT_' } },
              { action: { startsWith: 'SOURCE_' } },
              { action: { startsWith: 'SUPPLIER_SOURCE_' } },
              { action: { startsWith: 'NOTIFICATION_' } },
              { action: { startsWith: 'EXTERNAL_INGEST_' } },
            ],
          }
        : {};
    const page = await this.auditPage(qualityActions, query, principal.role === 'TMMIN_ADMIN');
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: 'AUDIT_VIEWED',
      resourceType: 'AuditEvent',
      changeSummary: {
        resultCount: page.items.length,
        supplierFiltered: Boolean(query.supplierId),
      },
      correlationId,
    });
    return page;
  }

  private async auditPage(
    where: Prisma.AuditEventWhereInput,
    query: AuditQuery,
    includeReason = true,
  ) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...where,
        ...(query.action ? { action: query.action } : {}),
        ...(query.resourceType ? { resourceType: query.resourceType } : {}),
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { supplier: true },
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
        supplierId: row.supplierId,
        supplierCode: row.supplier?.code ?? null,
        supplierName: row.supplier?.name ?? null,
        lineId: row.lineId,
        changeSummary: redact(row.changeSummary),
        result: row.result,
        correlationId: row.correlationId,
        sourceMode: row.sourceMode,
        sourceEpoch: row.sourceEpoch,
        reason: includeReason ? row.reason : null,
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

function countLabels(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count }));
}

function rankLabels(values: string[]) {
  return countLabels(values)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10);
}

function snapshotLabel(value: Prisma.JsonValue, preferredKey = 'name'): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Unknown';
  const record = value as Record<string, unknown>;
  const preferred = record[preferredKey];
  if (typeof preferred === 'string' && preferred.trim()) return preferred;
  for (const key of ['name', 'code', 'number', 'externalId']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return 'Unknown';
}

function freshnessState(value: Date | null): 'FRESH' | 'WARNING' | 'STALE' | 'NO_DATA' {
  if (!value) return 'NO_DATA';
  const age = Date.now() - value.getTime();
  if (age <= 4 * 60 * 60_000) return 'FRESH';
  if (age <= 24 * 60 * 60_000) return 'WARNING';
  return 'STALE';
}

export type DashboardRecord = {
  supplierId: string;
  supplierName: string;
  sourceMode: 'HOSTED' | 'EXTERNAL';
  status: string;
  category: string;
  line: string;
  part: string;
  occurredAt: Date;
};

export function dashboardTrend(
  records: DashboardRecord[],
  granularity: 'DAY' | 'WEEK' | 'MONTH',
  from?: string,
  to?: string,
) {
  const now = new Date();
  const rangeEnd = to ? new Date(to) : (records.at(-1)?.occurredAt ?? now);
  const fallbackStart = new Date(rangeEnd);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 29);
  const rangeStart = from
    ? new Date(from)
    : records.length
      ? records.reduce(
          (earliest, record) => (record.occurredAt < earliest ? record.occurredAt : earliest),
          records[0]!.occurredAt,
        )
      : fallbackStart;
  const first = dashboardBucketStart(rangeStart, granularity);
  const last = dashboardBucketStart(rangeEnd, granularity);
  const buckets = new Map<
    string,
    {
      bucketStart: string;
      hosted: number;
      external: number;
      total: number;
      open: number;
      approved: number;
      rejected: number;
      cancelled: number;
    }
  >();
  for (
    let cursor = first;
    cursor.getTime() <= last.getTime();
    cursor = nextDashboardBucket(cursor, granularity)
  ) {
    const bucketStart = cursor.toISOString();
    buckets.set(bucketStart, {
      bucketStart,
      hosted: 0,
      external: 0,
      total: 0,
      open: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    });
  }
  for (const record of records) {
    const key = dashboardBucketStart(record.occurredAt, granularity).toISOString();
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (record.sourceMode === 'HOSTED') bucket.hosted += 1;
    else bucket.external += 1;
    if (record.status === 'OPEN') bucket.open += 1;
    if (record.status === 'APPROVED') bucket.approved += 1;
    if (record.status === 'REJECTED') bucket.rejected += 1;
    if (record.status === 'CANCELLED') bucket.cancelled += 1;
  }
  return [...buckets.values()];
}

function dashboardBucketStart(value: Date, granularity: 'DAY' | 'WEEK' | 'MONTH') {
  const result = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  if (granularity === 'MONTH') {
    result.setUTCDate(1);
  } else if (granularity === 'WEEK') {
    const day = result.getUTCDay();
    result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  }
  return result;
}

function nextDashboardBucket(value: Date, granularity: 'DAY' | 'WEEK' | 'MONTH') {
  const result = new Date(value);
  if (granularity === 'MONTH') result.setUTCMonth(result.getUTCMonth() + 1);
  else result.setUTCDate(result.getUTCDate() + (granularity === 'WEEK' ? 7 : 1));
  return result;
}

function ageBucket(
  openedAt: Date,
): 'UNDER_4_HOURS' | 'FOUR_TO_EIGHT_HOURS' | 'EIGHT_TO_24_HOURS' | 'OVER_24_HOURS' {
  const age = (Date.now() - openedAt.getTime()) / 3_600_000;
  if (age < 4) return 'UNDER_4_HOURS';
  if (age < 8) return 'FOUR_TO_EIGHT_HOURS';
  if (age < 24) return 'EIGHT_TO_24_HOURS';
  return 'OVER_24_HOURS';
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
