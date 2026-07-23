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
      ...(query.part
        ? {
            OR: [
              { partNumberSnapshot: { contains: query.part, mode: 'insensitive' } },
              { partNameSnapshot: { contains: query.part, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [status, category, line, part, routes, warnings, issues, overrides, recent] =
      await Promise.all([
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
        this.prisma.warningInstance.count({
          where: { supplierId: scope.supplierId, status: 'OPEN', henkaten: where },
        }),
        this.prisma.assignmentIssue.count({
          where: {
            supplierId: scope.supplierId,
            status: 'OPEN',
            ...(Object.keys(shiftScope(principal)).length
              ? { shiftRun: shiftScope(principal) }
              : {}),
          },
        }),
        this.prisma.shiftRun.count({
          where: {
            supplierId: scope.supplierId,
            startedWithOverride: true,
            ...shiftScope(principal),
          },
        }),
        this.prisma.auditEvent.findMany({
          where: { supplierId: scope.supplierId },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 20,
        }),
      ]);
    const byStatus = new Map(status.map((item) => [item.status, item._count._all]));
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        all: status.reduce((sum, item) => sum + item._count._all, 0),
        open: byStatus.get('OPEN') ?? 0,
        approved: byStatus.get('APPROVED') ?? 0,
        rejected: byStatus.get('REJECTED') ?? 0,
        cancelled: byStatus.get('CANCELLED') ?? 0,
        activeWarnings: warnings,
        unresolvedAssignmentIssues: issues,
        emergencyOverrides: overrides,
      },
      pendingApprovals: {
        supervisor: routes.find(({ route }) => route === 'SUPERVISOR')?._count._all ?? 0,
        qc: routes.find(({ route }) => route === 'QC')?._count._all ?? 0,
      },
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
    const [suppliers, open, affected, overrides, categories, outcomes, freshness] =
      await Promise.all([
        this.prisma.supplier.groupBy({
          by: ['sourceMode'],
          where: { active: true },
          _count: { _all: true },
        }),
        this.prisma.henkaten.count({ where: { status: 'OPEN' } }),
        this.prisma.warningInstance.groupBy({
          by: ['supplierId', 'normalizedPartNumberSnapshot'],
          where: { status: 'OPEN' },
        }),
        this.prisma.shiftRun.count({ where: { startedWithOverride: true } }),
        this.prisma.henkaten.groupBy({
          by: ['category'],
          _count: { _all: true },
        }),
        this.prisma.henkaten.groupBy({
          by: ['status'],
          where: { status: { not: 'OPEN' } },
          _count: { _all: true },
        }),
        this.prisma.supplier.findMany({
          where: { active: true },
          select: {
            id: true,
            name: true,
            sourceMode: true,
            henkatens: { orderBy: { updatedAt: 'desc' }, take: 1, select: { updatedAt: true } },
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
      openHenkatens: open,
      affectedParts: affected.length,
      emergencyOverrides: overrides,
      bySourceMode: suppliers.map((item) => ({
        label: item.sourceMode,
        count: item._count._all,
      })),
      byCategory: categories.map((item) => ({
        label: item.category,
        count: item._count._all,
      })),
      outcomes: outcomes.map((item) => ({ label: item.status, count: item._count._all })),
      freshness: freshness.map((supplier) => ({
        supplierId: supplier.id,
        supplierName: supplier.name,
        sourceMode: supplier.sourceMode,
        lastDataAt: supplier.henkatens[0]?.updatedAt.toISOString() ?? null,
        activeWarnings: supplier.warningInstances.length,
      })),
    };
  }

  async supplierAudit(scope: TenantScope, query: AuditQuery) {
    return this.auditPage({ supplierId: scope.supplierId }, query);
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
