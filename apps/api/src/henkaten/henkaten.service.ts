import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { CreateHenkatenRequest, HenkatenListQuery } from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { missing } from '../master-data/member.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { OperationalFinalizationService } from '../operations/operational-finalization.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import { presentWorking } from '../shifts/shift-presenters.js';
import {
  henkatenDetailInclude,
  presentHenkatenDetail,
  presentHenkatenSummary,
} from './henkaten-presenters.js';

@Injectable()
export class HenkatenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    private readonly finalization: OperationalFinalizationService,
  ) {}

  async create(
    scope: TenantScope,
    input: CreateHenkatenRequest,
    idempotencyKey: string,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (principal.role !== 'LINE_LEADER' || !principal.memberId) throw forbidden();
    const memberId = principal.memberId;
    const payloadHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
    try {
      const id = await runSerializable(this.prisma, async (tx) => {
        await lockSupplier(tx, scope.supplierId);
        const existing = await tx.henkaten.findFirst({
          where: {
            supplierId: scope.supplierId,
            createdById: principal.userId,
            submissionKey: idempotencyKey,
          },
        });
        if (existing) {
          if (existing.submissionPayloadHash !== payloadHash) throw idempotencyConflict();
          return existing.id;
        }
        const submittedSource =
          input.category === 'MAN' && input.sourceWorkingAssignmentId
            ? await tx.workingAssignment.findFirst({
                where: {
                  id: input.sourceWorkingAssignmentId,
                  supplierId: scope.supplierId,
                },
                select: { shiftRunId: true },
              })
            : null;
        await lockShiftRuns(tx, [
          input.shiftRunId,
          ...(submittedSource ? [submittedSource.shiftRunId] : []),
        ]);
        const shift = await tx.shiftRun.findFirst({
          where: {
            id: input.shiftRunId,
            supplierId: scope.supplierId,
            status: { in: ['NOT_STARTED', 'ACTIVE'] },
            lineLeaderMemberId: memberId,
          },
        });
        if (!shift) throw missing('Owned active or planned Shift Run');
        if (shift.status === 'NOT_STARTED' && input.category !== 'MAN') throw invalidTransition();
        const [supplier, job, part, checklist] = await Promise.all([
          tx.supplier.findUnique({ where: { id: scope.supplierId } }),
          tx.job.findFirst({
            where: {
              id: input.jobId,
              supplierId: scope.supplierId,
              lineId: shift.lineId,
              active: true,
            },
          }),
          tx.part.findFirst({
            where: { id: input.partId, supplierId: scope.supplierId, active: true },
          }),
          tx.checklistVersion.findFirst({
            where: {
              id: input.checklistVersionId,
              supplierId: scope.supplierId,
              category: input.category,
              template: { active: true },
            },
            include: {
              items: { orderBy: { displayOrder: 'asc' } },
              template: { include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } },
            },
          }),
        ]);
        if (
          !supplier ||
          supplier.sourceMode !== 'HOSTED' ||
          supplier.sourceEpoch !== principal.sourceEpoch
        ) {
          throw sourceMismatch();
        }
        if (!job) throw missing('Active job');
        if (!part) throw missing('Active part');
        if (
          !checklist ||
          checklist.template.versions[0]?.id !== checklist.id ||
          checklist.items.length !== input.checklistAnswers.length
        ) {
          throw checklistInvalid();
        }
        const answers = new Map(
          input.checklistAnswers.map((answer) => [answer.itemId, answer.answer]),
        );
        if (
          answers.size !== checklist.items.length ||
          checklist.items.some(({ id }) => answers.get(id) !== 'YES')
        ) {
          throw checklistInvalid();
        }

        const man =
          input.category === 'MAN'
            ? await this.validateMan(tx, scope.supplierId, shift.id, input)
            : undefined;
        if (input.clonedFromHenkatenId) {
          const source = await tx.henkaten.findFirst({
            where: { id: input.clonedFromHenkatenId, supplierId: scope.supplierId },
          });
          if (!source) throw missing('Cloned Henkaten');
        }
        const sequence = await nextSequence(tx, scope.supplierId, shift.businessDate);
        const dateToken = shift.businessDate.toISOString().slice(0, 10).replaceAll('-', '');
        const identifier = `HEN-${supplier.code}-${dateToken}-${sequence
          .toString()
          .padStart(4, '0')}`;
        const now = new Date();
        const created = await tx.henkaten.create({
          data: {
            supplierId: scope.supplierId,
            shiftRunId: shift.id,
            lineId: shift.lineId,
            jobId: job.id,
            partId: part.id,
            identifier,
            dailySequence: sequence,
            sourceMode: supplier.sourceMode,
            sourceEpoch: supplier.sourceEpoch,
            category: input.category,
            businessDate: shift.businessDate,
            timezoneSnapshot: shift.timezoneSnapshot,
            shiftNameSnapshot: shift.shiftNameSnapshot,
            lineCodeSnapshot: shift.lineCodeSnapshot,
            lineNameSnapshot: shift.lineNameSnapshot,
            jobNameSnapshot: job.name,
            partNumberSnapshot: part.partNumber,
            normalizedPartNumberSnapshot: normalizeLookup(part.partNumber),
            partNameSnapshot: part.partName,
            creatorMemberId: memberId,
            creatorNameSnapshot: principal.displayName,
            cause: input.cause,
            detail: input.detail,
            ...(input.category !== 'MAN'
              ? {
                  affectedObject: input.affectedObject,
                  replacementObject: input.replacementObject,
                }
              : {}),
            occurredAt: now,
            ...(input.clonedFromHenkatenId
              ? { clonedFromHenkatenId: input.clonedFromHenkatenId }
              : {}),
            submissionKey: idempotencyKey,
            submissionPayloadHash: payloadHash,
            createdById: principal.userId,
            checklistSnapshot: {
              create: {
                checklistVersionId: checklist.id,
                category: checklist.category,
                versionNumber: checklist.versionNumber,
                answers: {
                  create: checklist.items.map((item) => ({
                    sourceItemId: item.id,
                    labelSnapshot: item.label,
                    displayOrderSnapshot: item.displayOrder,
                    answer: 'YES',
                  })),
                },
              },
            },
            transitions: {
              create: {
                toStatus: 'OPEN',
                actorUserId: principal.userId,
                actorRole: principal.role,
                actorName: principal.displayName,
                correlationId: context.correlationId,
              },
            },
            warning: {
              create: {
                partNumberSnapshot: part.partNumber,
                normalizedPartNumberSnapshot: normalizeLookup(part.partNumber),
                partNameSnapshot: part.partName,
              },
            },
            approvalRoutes: {
              create: [
                {
                  route: 'SUPERVISOR',
                  initialResponsibleMemberId: shift.supervisorMemberId,
                  initialResponsibleNameSnapshot: shift.supervisorNameSnapshot,
                  currentResponsibleMemberId: shift.supervisorMemberId,
                  currentResponsibleNameSnapshot: shift.supervisorNameSnapshot,
                },
                { route: 'QC' },
              ],
            },
            ...(man
              ? {
                  manDetail: {
                    create: {
                      targetWorkingAssignmentId: man.target.id,
                      ...(man.source ? { sourceWorkingAssignmentId: man.source.id } : {}),
                      ...(man.replaced
                        ? {
                            replacedMpMemberId: man.replaced.id,
                            replacedMpNameSnapshot: man.replaced.fullName,
                          }
                        : {}),
                      replacedWasVacant: !man.replaced,
                      replacementMpMemberId: man.replacement.id,
                      replacementMpNameSnapshot: man.replacement.fullName,
                      targetAssignmentVersion: man.target.version,
                      ...(man.source ? { sourceAssignmentVersion: man.source.version } : {}),
                      ...(man.issue ? { resolutionIssueId: man.issue.id } : {}),
                    },
                  },
                }
              : {}),
          },
        });
        if (man) {
          await tx.mPReservation.create({
            data: {
              supplierId: scope.supplierId,
              henkatenId: created.id,
              shiftRunId: shift.id,
              replacementMpMemberId: man.replacement.id,
              targetWorkingAssignmentId: man.target.id,
              ...(man.source ? { sourceWorkingAssignmentId: man.source.id } : {}),
              targetAssignmentVersion: man.target.version,
              ...(man.source ? { sourceAssignmentVersion: man.source.version } : {}),
              expiresAt: shift.scheduledEndAt,
            },
          });
        }
        await this.audit.write(
          auditInput(context, scope.supplierId, 'HENKATEN_SUBMITTED', created.id, {
            identifier,
            category: created.category,
            lineId: created.lineId,
            jobId: created.jobId,
            partId: created.partId,
          }),
          tx,
        );
        await this.outbox.enqueue(
          {
            eventType: 'HENKATEN_OPENED',
            aggregateType: 'Henkaten',
            aggregateId: created.id,
            aggregateVersion: created.version,
            supplierId: scope.supplierId,
            actor: { userId: principal.userId, role: principal.role },
            correlationId: context.correlationId,
            payload: {
              identifier,
              category: created.category,
              lineId: created.lineId,
              partNumber: created.partNumberSnapshot,
            },
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            eventType: 'WARNING_OPENED',
            aggregateType: 'Henkaten',
            aggregateId: created.id,
            aggregateVersion: created.version,
            supplierId: scope.supplierId,
            actor: { userId: principal.userId, role: principal.role },
            correlationId: context.correlationId,
            payload: { partNumber: created.partNumberSnapshot },
          },
          tx,
        );
        if (man) {
          await this.outbox.enqueue(
            {
              eventType: 'MP_RESERVED',
              aggregateType: 'Henkaten',
              aggregateId: created.id,
              aggregateVersion: created.version,
              supplierId: scope.supplierId,
              actor: { userId: principal.userId, role: principal.role },
              correlationId: context.correlationId,
              payload: {
                replacementMpMemberId: man.replacement.id,
                targetWorkingAssignmentId: man.target.id,
              },
            },
            tx,
          );
        }
        return created.id;
      });
      return this.get(scope, id, principal);
    } catch (error) {
      if (isReservationUniqueConflict(error)) throw reservationConflict();
      throw error;
    }
  }

  async withdraw(
    scope: TenantScope,
    id: string,
    input: { expectedVersion: number; reason: string },
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (principal.role !== 'LINE_LEADER' || !principal.memberId) throw forbidden();
    const memberId = principal.memberId;
    await runSerializable(this.prisma, async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const lockCandidate = await tx.henkaten.findFirst({
        where: { id, supplierId: scope.supplierId },
        select: {
          shiftRunId: true,
          reservation: {
            select: {
              sourceWorkingAssignment: { select: { shiftRunId: true } },
            },
          },
        },
      });
      if (!lockCandidate) throw missing('Open owned Henkaten');
      await lockShiftRuns(tx, [
        lockCandidate.shiftRunId,
        ...(lockCandidate.reservation?.sourceWorkingAssignment
          ? [lockCandidate.reservation.sourceWorkingAssignment.shiftRunId]
          : []),
      ]);
      await tx.$queryRaw`SELECT id FROM "Henkaten" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.henkaten.findFirst({
        where: {
          id,
          supplierId: scope.supplierId,
          status: 'OPEN',
          shiftRun: { lineLeaderMemberId: memberId },
        },
      });
      if (!current) throw missing('Open owned Henkaten');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const now = new Date();
      const updated = await tx.henkaten.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancellationReason: 'WITHDRAWN',
          withdrawalReason: input.reason,
          finalizedAt: now,
          finalizedById: principal.userId,
          version: { increment: 1 },
        },
      });
      await this.finalization.closeTerminalEffects(tx, {
        supplierId: scope.supplierId,
        henkatenId: id,
        henkatenVersion: updated.version,
        toStatus: 'CANCELLED',
        reason: 'WITHDRAWN',
        actor: {
          userId: principal.userId,
          role: principal.role,
          name: principal.displayName,
          correlationId: context.correlationId,
        },
        markPendingRoutesNotRequired: true,
        releaseReservation: true,
      });
      await this.audit.write(
        {
          ...auditInput(context, scope.supplierId, 'HENKATEN_WITHDRAWN', id, {
            identifier: current.identifier,
          }),
          reason: input.reason,
        },
        tx,
      );
    });
    return this.get(scope, id, principal);
  }

  async list(scope: TenantScope, query: HenkatenListQuery, principal?: RequestPrincipal) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.henkaten.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.lineId ? { lineId: query.lineId } : {}),
        ...(query.shiftRunId ? { shiftRunId: query.shiftRunId } : {}),
        ...(query.part
          ? {
              OR: [
                { partNumberSnapshot: { contains: query.part, mode: 'insensitive' } },
                { partNameSnapshot: { contains: query.part, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.approvalStatus || query.approvalRoute
          ? {
              approvalRoutes: {
                some: {
                  ...(query.approvalStatus ? { status: query.approvalStatus } : {}),
                  ...(query.approvalRoute ? { route: query.approvalRoute } : {}),
                },
              },
            }
          : {}),
        ...roleWhere(principal),
      },
      include: {
        approvalRoutes: { include: { decision: true }, orderBy: { route: 'asc' } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > query.limit;
    const items = hasNextPage ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map(presentHenkatenSummary),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)!.id) : null,
      },
    };
  }

  async get(scope: TenantScope, id: string, principal?: RequestPrincipal) {
    const row = await this.prisma.henkaten.findFirst({
      where: { id, supplierId: scope.supplierId, ...roleWhere(principal) },
      include: henkatenDetailInclude,
    });
    if (!row) throw missing('Henkaten');
    return presentHenkatenDetail(row);
  }

  async clonePrefill(scope: TenantScope, id: string, principal: RequestPrincipal) {
    const row = await this.prisma.henkaten.findFirst({
      where: { id, supplierId: scope.supplierId, ...roleWhere(principal) },
      include: { manDetail: true },
    });
    if (!row) throw missing('Henkaten');
    const [checklist, shift, job, part] = await Promise.all([
      this.prisma.checklistVersion.findFirst({
        where: { supplierId: scope.supplierId, category: row.category, template: { active: true } },
        include: { items: { orderBy: { displayOrder: 'asc' } } },
        orderBy: { versionNumber: 'desc' },
      }),
      this.prisma.shiftRun.findFirst({
        where: { id: row.shiftRunId, supplierId: scope.supplierId, status: 'ACTIVE' },
      }),
      this.prisma.job.findFirst({
        where: { id: row.jobId, supplierId: scope.supplierId, active: true },
      }),
      this.prisma.part.findFirst({
        where: { id: row.partId, supplierId: scope.supplierId, active: true },
      }),
    ]);
    if (!checklist) throw checklistInvalid();
    const working = row.manDetail
      ? await this.prisma.workingAssignment.findFirst({
          where: {
            id: row.manDetail.targetWorkingAssignmentId,
            supplierId: scope.supplierId,
            active: true,
          },
        })
      : null;
    return {
      clonedFromHenkatenId: row.id,
      category: row.category,
      shiftRunId: row.shiftRunId,
      jobId: row.jobId,
      partId: row.partId,
      cause: row.cause,
      detail: row.detail,
      affectedObject: row.affectedObject,
      replacementObject: row.replacementObject,
      checklistVersionId: checklist.id,
      checklistItems: checklist.items.map((item) => ({
        itemId: item.id,
        label: item.label,
        displayOrder: item.displayOrder,
      })),
      shiftStillValid: Boolean(shift),
      jobStillValid: Boolean(job && shift && job.lineId === shift.lineId),
      partStillValid: Boolean(part),
      assignmentStillValid: Boolean(
        !row.manDetail || (working && working.version === row.manDetail.targetAssignmentVersion),
      ),
      workingAssignment: working ? presentWorking(working) : null,
    };
  }

  async warnings(scope: TenantScope) {
    const rows = await this.prisma.warningInstance.findMany({
      where: { supplierId: scope.supplierId },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        henkatenId: row.henkatenId,
        status: row.status,
        partNumber: row.partNumberSnapshot,
        partName: row.partNameSnapshot,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
      })),
      pageInfo: { hasNextPage: false, nextCursor: null },
    };
  }

  async warning(scope: TenantScope, id: string) {
    const row = await this.prisma.warningInstance.findFirst({
      where: { id, supplierId: scope.supplierId },
    });
    if (!row) throw missing('Warning Instance');
    return presentWarning(row);
  }

  async affectedParts() {
    const groups = await this.prisma.warningInstance.groupBy({
      by: ['supplierId', 'normalizedPartNumberSnapshot'],
      where: { status: 'OPEN' },
      _count: { _all: true },
      _min: { openedAt: true },
      orderBy: { _min: { openedAt: 'asc' } },
      take: 100,
    });
    const suppliers = new Map(
      (
        await this.prisma.supplier.findMany({
          where: { id: { in: groups.map(({ supplierId }) => supplierId) } },
          select: { id: true, name: true },
        })
      ).map((supplier) => [supplier.id, supplier.name]),
    );
    const samples = await this.prisma.warningInstance.findMany({
      where: {
        status: 'OPEN',
        OR: groups.map((group) => ({
          supplierId: group.supplierId,
          normalizedPartNumberSnapshot: group.normalizedPartNumberSnapshot,
        })),
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    });
    const sampleByGroup = new Map(
      samples.map((sample) => [
        `${sample.supplierId}:${sample.normalizedPartNumberSnapshot}`,
        sample,
      ]),
    );
    return {
      items: groups.map((group) => {
        const sample = sampleByGroup.get(
          `${group.supplierId}:${group.normalizedPartNumberSnapshot}`,
        );
        if (!sample) throw new Error('MissingAffectedPartWarningSample');
        return {
          supplierId: group.supplierId,
          supplierName: suppliers.get(group.supplierId) ?? 'Unknown supplier',
          partNumber: sample.partNumberSnapshot,
          partName: sample.partNameSnapshot,
          openWarningCount: group._count._all,
          oldestOpenedAt: group._min.openedAt!.toISOString(),
        };
      }),
      pageInfo: { hasNextPage: false, nextCursor: null },
    };
  }

  async affectedPart(supplierId: string, partNumber: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });
    if (!supplier) throw missing('Supplier');
    const normalizedPartNumber = normalizeLookup(partNumber);
    const rows = await this.prisma.warningInstance.findMany({
      where: {
        supplierId,
        normalizedPartNumberSnapshot: normalizedPartNumber,
        status: 'OPEN',
      },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    });
    if (!rows.length) throw missing('Affected Part');
    return {
      supplierId,
      supplierName: supplier.name,
      partNumber: rows[0]!.partNumberSnapshot,
      partName: rows[0]!.partNameSnapshot,
      openWarningCount: rows.length,
      oldestOpenedAt: rows[0]!.openedAt.toISOString(),
      warnings: rows.map(presentWarning),
    };
  }

  private async validateMan(
    tx: Prisma.TransactionClient,
    supplierId: string,
    shiftRunId: string,
    input: Extract<CreateHenkatenRequest, { category: 'MAN' }>,
  ) {
    await tx.$queryRaw`SELECT id FROM "WorkingAssignment" WHERE id = ${input.targetWorkingAssignmentId}::uuid FOR UPDATE`;
    const target = await tx.workingAssignment.findFirst({
      where: {
        id: input.targetWorkingAssignmentId,
        supplierId,
        shiftRunId,
        jobId: input.jobId,
        includedInPlan: true,
      },
    });
    if (!target) throw missing('Target Working Assignment');
    if (target.version !== input.targetAssignmentVersion) throw versionConflict();
    const replaced =
      input.replaced.kind === 'MP'
        ? await tx.member.findFirst({
            where: { id: input.replaced.memberId, supplierId, active: true, role: 'MP' },
          })
        : null;
    if (
      (input.replaced.kind === 'VACANT' && target.effectiveMpMemberId) ||
      (input.replaced.kind === 'MP' &&
        (!replaced || target.effectiveMpMemberId !== input.replaced.memberId))
    ) {
      throw assignmentConflict();
    }
    const replacement = await tx.member.findFirst({
      where: {
        id: input.replacementMpMemberId,
        supplierId,
        active: true,
        role: 'MP',
      },
    });
    if (!replacement) throw missing('Active replacement MP');
    if (replacement.id === replaced?.id) throw assignmentConflict();
    const source = await tx.workingAssignment.findFirst({
      where: {
        supplierId,
        effectiveMpMemberId: replacement.id,
        active: true,
      },
    });
    if (source) {
      if (
        !input.sourceWorkingAssignmentId ||
        input.sourceWorkingAssignmentId !== source.id ||
        input.sourceAssignmentVersion !== source.version
      ) {
        throw versionConflict();
      }
    } else if (input.sourceWorkingAssignmentId || input.sourceAssignmentVersion) {
      throw assignmentConflict();
    }
    const reservation = await tx.mPReservation.findFirst({
      where: {
        supplierId,
        releasedAt: null,
        OR: [{ replacementMpMemberId: replacement.id }, { targetWorkingAssignmentId: target.id }],
      },
    });
    if (reservation) throw reservationConflict();
    const issue = input.resolutionIssueId
      ? await tx.assignmentIssue.findFirst({
          where: {
            id: input.resolutionIssueId,
            supplierId,
            shiftRunId,
            lineId: target.lineId,
            jobId: target.jobId,
            status: 'OPEN',
          },
        })
      : null;
    const existingIssue = await tx.assignmentIssue.findFirst({
      where: { supplierId, shiftRunId, jobId: target.jobId, status: 'OPEN' },
    });
    if ((input.resolutionIssueId && !issue) || (existingIssue && existingIssue.id !== issue?.id)) {
      throw assignmentConflict();
    }
    return { target, source, replaced, replacement, issue };
  }
}

function roleWhere(principal?: RequestPrincipal): Prisma.HenkatenWhereInput {
  if (
    !principal ||
    principal.realm === 'TMMIN' ||
    ['SUPPLIER_ADMIN', 'QC'].includes(principal.role)
  ) {
    return {};
  }
  if (!principal.memberId) {
    return { id: '00000000-0000-0000-0000-000000000000' };
  }
  return principal.role === 'SUPERVISOR'
    ? {
        OR: [
          { shiftRun: { supervisorMemberId: principal.memberId } },
          {
            approvalRoutes: {
              some: { route: 'SUPERVISOR', currentResponsibleMemberId: principal.memberId },
            },
          },
        ],
      }
    : { shiftRun: { lineLeaderMemberId: principal.memberId } };
}

function presentWarning(row: {
  id: string;
  henkatenId: string;
  status: 'OPEN' | 'CLOSED';
  partNumberSnapshot: string;
  partNameSnapshot: string;
  openedAt: Date;
  closedAt: Date | null;
}) {
  return {
    id: row.id,
    henkatenId: row.henkatenId,
    status: row.status,
    partNumber: row.partNumberSnapshot,
    partName: row.partNameSnapshot,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function nextSequence(
  tx: Prisma.TransactionClient,
  supplierId: string,
  businessDate: Date,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "HenkatenDailySequence" ("supplierId", "businessDate", "lastValue")
    VALUES (${supplierId}::uuid, ${businessDate}::date, 1)
    ON CONFLICT ("supplierId", "businessDate")
    DO UPDATE SET "lastValue" = "HenkatenDailySequence"."lastValue" + 1
    RETURNING "lastValue"
  `;
  const value = rows[0]?.lastValue;
  if (!value) throw new Error('HenkatenSequenceAllocationFailed');
  return value;
}

async function lockSupplier(tx: Prisma.TransactionClient, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
}

async function lockShiftRuns(tx: Prisma.TransactionClient, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`
    SELECT id FROM "ShiftRun"
    WHERE id = ANY(${sorted}::uuid[])
    ORDER BY id
    FOR UPDATE
  `;
}

function auditInput(
  context: MutationContext,
  supplierId: string,
  action: string,
  resourceId: string,
  changeSummary: Record<string, unknown>,
) {
  return {
    actorKind: 'USER' as const,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
    supplierId,
    action,
    resourceType: 'Henkaten',
    resourceId,
    changeSummary,
    correlationId: context.correlationId,
    ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    sourceMode: 'HOSTED' as const,
  };
}

function isReservationUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002' &&
    JSON.stringify(error).includes('MPReservation')
  );
}

function forbidden() {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'The account is not allowed to operate this Henkaten.',
  });
}
function sourceMismatch() {
  return new ProblemException({
    status: 409,
    code: 'SOURCE_MODE_MISMATCH',
    title: 'Source mode mismatch',
    detail: 'Hosted Henkaten operations are unavailable.',
  });
}
function checklistInvalid() {
  return new ProblemException({
    status: 409,
    code: 'CHECKLIST_NOT_PUBLISHED',
    title: 'Checklist invalid',
    detail: 'The latest active checklist must be answered YES in full.',
  });
}
function idempotencyConflict() {
  return new ProblemException({
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    title: 'Idempotency conflict',
    detail: 'The Idempotency-Key was already used with a different request.',
  });
}
function reservationConflict() {
  return new ProblemException({
    status: 409,
    code: 'RESERVATION_CONFLICT',
    title: 'Reservation conflict',
    detail: 'The replacement MP or target job already has an active reservation.',
  });
}

function invalidTransition() {
  return new ProblemException({
    status: 409,
    code: 'INVALID_TRANSITION',
    title: 'Invalid transition',
    detail: 'Only Man Henkaten can be submitted for a planned Shift Run.',
  });
}
function assignmentConflict() {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Assignment conflict',
    detail: 'The submitted Man assignment no longer matches current Working Assignment.',
  });
}
