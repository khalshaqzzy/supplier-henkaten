import { assertTanokoEligible } from '../master-data/tanoko-eligibility.js';
import { LineShiftService } from '../master-data/line-shift.service.js';
import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  CreateHenkatenRequest,
  HenkatenFormOptionsQuery,
  HenkatenListQuery,
  TmminHenkatenQuery,
} from '@tmmin-henkaten/contracts';

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
    private readonly lineShifts: LineShiftService,
  ) {}

  async create(
    scope: TenantScope,
    input: CreateHenkatenRequest,
    idempotencyKey: string,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (principal.role !== 'LINE_LEADER' || !principal.memberId) throw forbidden();
    const operational = await this.lineShifts.operationalContext(scope, principal);
    if (
      operational.currentLineShiftIds.length > 0 &&
      !operational.currentLineShiftIds.includes(input.lineShiftId)
    ) {
      throw shiftSelectionConflict();
    }
    return this.createForLineShift(scope, input, idempotencyKey, principal, context);
  }

  private async createForLineShift(
    scope: TenantScope,
    input: CreateHenkatenRequest & { lineShiftId: string },
    idempotencyKey: string,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (!principal.memberId) throw missing('Line Shift');
    const memberId = principal.memberId;
    const payloadHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
    const id = await runSerializable(this.prisma, async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const retry = await tx.henkaten.findFirst({
        where: {
          supplierId: scope.supplierId,
          createdById: principal.userId,
          submissionKey: idempotencyKey,
        },
      });
      if (retry) {
        if (retry.submissionPayloadHash !== payloadHash) throw idempotencyConflict();
        return retry.id;
      }
      const occurrence = await this.lineShifts.resolveOccurrence(
        tx,
        scope,
        input.lineShiftId,
        principal,
      );
      const lineShift = occurrence.row;
      const [supplier, job, part, checklist] = await Promise.all([
        tx.supplier.findUnique({ where: { id: scope.supplierId } }),
        tx.job.findFirst({
          where: {
            id: input.jobId,
            supplierId: scope.supplierId,
            lineId: lineShift.lineId,
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
      )
        throw sourceMismatch();
      if (!job) throw missing('Active job');
      if (!part) throw missing('Active part');
      const answers = new Map(
        input.checklistAnswers.map((answer) => [answer.itemId, answer.answer]),
      );
      if (
        !checklist ||
        checklist.template.versions[0]?.id !== checklist.id ||
        checklist.items.length !== input.checklistAnswers.length ||
        answers.size !== checklist.items.length ||
        checklist.items.some(({ id: itemId }) => answers.get(itemId) !== 'YES')
      )
        throw checklistInvalid();

      const legacyShift = await ensureAutomaticOccurrence(
        tx,
        scope.supplierId,
        supplier.sourceEpoch,
        lineShift,
        occurrence.businessDate,
        occurrence.start,
        occurrence.end,
        principal.userId,
      );
      const targetWorking = legacyShift.workingAssignments.find(
        (assignment) => assignment.jobId === job.id,
      );
      if (!targetWorking) throw missing('Line Shift job assignment');

      let man:
        | {
            assignment: (typeof lineShift.jobAssignments)[number];
            replacement: { id: string; fullName: string; registrationNumber: string };
            replaced: { id: string; fullName: string } | null;
          }
        | undefined;
      if (input.category === 'MAN') {
        const assignment = lineShift.jobAssignments.find(
          (item) =>
            item.jobId === job.id &&
            (!input.lineShiftJobAssignmentId || item.id === input.lineShiftJobAssignmentId),
        );
        if (!assignment) throw missing('Line Shift job assignment');
        const replacement = await tx.member.findFirst({
          where: {
            id: input.replacementMpMemberId,
            supplierId: scope.supplierId,
            role: 'MP',
            active: true,
          },
          select: { id: true, fullName: true, registrationNumber: true },
        });
        if (!replacement) throw missing('Active replacement MP');
        await assertTanokoEligible(tx, scope.supplierId, replacement.id, job.id);
        const previousOverride = await tx.henkaten.findFirst({
          where: {
            supplierId: scope.supplierId,
            lineShiftId: lineShift.id,
            jobId: job.id,
            category: 'MAN',
            status: { in: ['OPEN', 'APPROVED'] },
            effectiveStartAt: occurrence.start,
            effectiveEndAt: occurrence.end,
            manDetail: { lineShiftJobAssignmentId: assignment.id },
          },
          include: { manDetail: { include: { replacementMp: true } } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        });
        const replacedMember = previousOverride?.manDetail?.replacementMp ?? assignment.mp;
        man = {
          assignment,
          replacement,
          replaced: replacedMember
            ? { id: replacedMember.id, fullName: replacedMember.fullName }
            : null,
        };
      }

      if (input.clonedFromHenkatenId) {
        const source = await tx.henkaten.findFirst({
          where: { id: input.clonedFromHenkatenId, supplierId: scope.supplierId },
        });
        if (!source) throw missing('Cloned Henkaten');
      }
      const businessDate = new Date(`${occurrence.businessDate}T00:00:00.000Z`);
      const sequence = await nextSequence(tx, scope.supplierId, businessDate);
      const identifier = `HEN-${supplier.code}-${occurrence.businessDate.replaceAll('-', '')}-${sequence
        .toString()
        .padStart(4, '0')}`;
      const now = new Date();
      const created = await tx.henkaten.create({
        data: {
          supplierId: scope.supplierId,
          shiftRunId: legacyShift.id,
          lineShiftId: lineShift.id,
          lineId: lineShift.lineId,
          jobId: job.id,
          partId: part.id,
          identifier,
          dailySequence: sequence,
          sourceMode: supplier.sourceMode,
          sourceEpoch: supplier.sourceEpoch,
          category: input.category,
          businessDate,
          timezoneSnapshot: lineShift.shiftTemplate.timezone,
          shiftNameSnapshot: lineShift.shiftTemplate.name,
          lineCodeSnapshot: lineShift.line.code,
          lineNameSnapshot: lineShift.line.name,
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
          effectiveStartAt: occurrence.start,
          effectiveEndAt: occurrence.end,
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
                initialResponsibleMemberId: lineShift.supervisorMemberId,
                initialResponsibleNameSnapshot: lineShift.supervisor?.fullName ?? null,
                currentResponsibleMemberId: lineShift.supervisorMemberId,
                currentResponsibleNameSnapshot: lineShift.supervisor?.fullName ?? null,
              },
              { route: 'QC' },
            ],
          },
          ...(man
            ? {
                manDetail: {
                  create: {
                    targetWorkingAssignmentId: targetWorking.id,
                    lineShiftJobAssignmentId: man.assignment.id,
                    ...(man.replaced
                      ? {
                          replacedMpMemberId: man.replaced.id,
                          replacedMpNameSnapshot: man.replaced.fullName,
                        }
                      : {}),
                    replacedWasVacant: !man.replaced,
                    replacementMpMemberId: man.replacement.id,
                    replacementMpNameSnapshot: man.replacement.fullName,
                    targetAssignmentVersion: targetWorking.version,
                  },
                },
              }
            : {}),
        },
      });

      if (man) {
        const updatedTarget = await tx.workingAssignment.update({
          where: { id: targetWorking.id },
          data: {
            effectiveMpMemberId: man.replacement.id,
            candidateMpMemberId: man.replacement.id,
            mpNameSnapshot: man.replacement.fullName,
            mpRegistrationSnapshot: man.replacement.registrationNumber,
            state: 'ASSIGNED',
            version: { increment: 1 },
            updatedById: principal.userId,
          },
        });
        await tx.assignmentMovement.create({
          data: {
            supplierId: scope.supplierId,
            henkatenId: created.id,
            targetShiftRunId: legacyShift.id,
            targetWorkingAssignmentId: targetWorking.id,
            targetLineId: lineShift.lineId,
            targetJobId: job.id,
            movedMpMemberId: man.replacement.id,
            movedMpNameSnapshot: man.replacement.fullName,
            ...(man.replaced
              ? {
                  replacedMpMemberId: man.replaced.id,
                  replacedMpNameSnapshot: man.replaced.fullName,
                }
              : {}),
            targetAssignmentVersionBefore: targetWorking.version,
            targetAssignmentVersionAfter: updatedTarget.version,
            movedById: principal.userId,
            correlationId: context.correlationId,
          },
        });
      }
      await this.audit.write(
        auditInput(context, scope.supplierId, 'HENKATEN_SUBMITTED', created.id, {
          identifier,
          category: created.category,
          lineId: created.lineId,
          lineShiftId: lineShift.id,
          jobId: created.jobId,
          partId: created.partId,
          assignmentAppliedImmediately: Boolean(man),
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
      return created.id;
    });
    return this.get(scope, id, principal);
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
      if (current.lineShiftId && current.category === 'MAN') {
        await this.restoreLineShiftAssignment(tx, scope.supplierId, current.id, principal.userId);
      }
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
        releaseReservation: !current.lineShiftId,
      });
      await this.audit.write(
        {
          ...auditInput(context, scope.supplierId, 'HENKATEN_WITHDRAWN', id, {
            identifier: current.identifier,
            lineId: current.lineId,
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

  async restoreLineShiftAssignment(
    tx: Prisma.TransactionClient,
    supplierId: string,
    henkatenId: string,
    actorUserId: string,
  ) {
    const target = await tx.henkaten.findFirst({
      where: { id: henkatenId, supplierId, lineShiftId: { not: null }, category: 'MAN' },
      include: {
        manDetail: {
          include: {
            lineShiftJobAssignment: { include: { mp: true } },
            targetWorkingAssignment: true,
          },
        },
      },
    });
    const detail = target?.manDetail;
    const assignment = detail?.lineShiftJobAssignment;
    if (!target || !detail || !assignment) return;
    const fallback = await tx.henkaten.findFirst({
      where: {
        id: { not: target.id },
        supplierId,
        lineShiftId: target.lineShiftId,
        jobId: target.jobId,
        category: 'MAN',
        status: { in: ['OPEN', 'APPROVED'] },
        effectiveStartAt: target.effectiveStartAt,
        effectiveEndAt: target.effectiveEndAt,
        manDetail: { lineShiftJobAssignmentId: assignment.id },
      },
      include: { manDetail: { include: { replacementMp: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    const effectiveMp = fallback?.manDetail?.replacementMp ?? assignment.mp;
    await tx.workingAssignment.update({
      where: { id: detail.targetWorkingAssignmentId },
      data: {
        effectiveMpMemberId: effectiveMp?.id ?? null,
        candidateMpMemberId: effectiveMp?.id ?? null,
        mpNameSnapshot: effectiveMp?.fullName ?? null,
        mpRegistrationSnapshot: effectiveMp?.registrationNumber ?? null,
        state: effectiveMp ? 'ASSIGNED' : 'VACANT',
        version: { increment: 1 },
        updatedById: actorUserId,
      },
    });
  }

  async formOptions(scope: TenantScope, query: HenkatenFormOptionsQuery) {
    const partSearch = query.part ? normalizeLookup(query.part) : null;
    const [checklist, parts, members] = await Promise.all([
      this.prisma.checklistVersion.findFirst({
        where: {
          supplierId: scope.supplierId,
          category: query.category,
          template: { active: true },
        },
        include: { items: { orderBy: { displayOrder: 'asc' } } },
        orderBy: { versionNumber: 'desc' },
      }),
      this.prisma.part.findMany({
        where: {
          supplierId: scope.supplierId,
          active: true,
          ...(partSearch
            ? {
                OR: [
                  { normalizedPartNumber: { contains: partSearch } },
                  { normalizedPartName: { contains: partSearch } },
                ],
              }
            : {}),
        },
        orderBy: [{ normalizedPartNumber: 'asc' }, { id: 'asc' }],
        take: 50,
      }),
      this.prisma.member.findMany({
        where: { supplierId: scope.supplierId, active: true, role: 'MP' },
        select: {
          id: true,
          fullName: true,
          registrationNumber: true,
          tanokoMappings: {
            where: { supplierId: scope.supplierId },
            select: { jobId: true, level: true },
          },
        },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      checklist: checklist
        ? {
            id: checklist.id,
            category: checklist.category,
            versionNumber: checklist.versionNumber,
            publishedAt: checklist.publishedAt.toISOString(),
            items: checklist.items.map((item) => ({
              id: item.id,
              label: item.label,
              displayOrder: item.displayOrder,
            })),
          }
        : null,
      parts: parts.map((part) => ({
        id: part.id,
        partNumber: part.partNumber,
        partName: part.partName,
      })),
      replacementMembers: members.map((member) => ({
        id: member.id,
        fullName: member.fullName,
        registrationNumber: member.registrationNumber,
        reserved: false,
        skillLevels: member.tanokoMappings,
        currentAssignment: null,
      })),
    };
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
        henkatenId: row.henkatenId ?? row.externalProjectionId!,
        sourceMode: row.sourceMode,
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

  async globalList(query: TmminHenkatenQuery) {
    const cursor = decodeGlobalCursor(query.cursor);
    const cursorWhere = cursor
      ? {
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        }
      : {};
    const commonDate =
      query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {};
    const [hosted, external] = await Promise.all([
      query.sourceMode === 'EXTERNAL'
        ? Promise.resolve([])
        : this.prisma.henkaten.findMany({
            where: {
              ...cursorWhere,
              ...commonDate,
              ...(query.supplierId ? { supplierId: query.supplierId } : {}),
              ...(query.status ? { status: query.status } : {}),
              ...(query.category ? { category: query.category } : {}),
              ...(query.line
                ? { lineNameSnapshot: { contains: query.line, mode: 'insensitive' as const } }
                : {}),
              ...(query.part
                ? {
                    OR: [
                      {
                        partNumberSnapshot: {
                          contains: query.part,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        partNameSnapshot: {
                          contains: query.part,
                          mode: 'insensitive' as const,
                        },
                      },
                    ],
                  }
                : {}),
            },
            include: {
              supplier: { select: { code: true, name: true } },
              approvalRoutes: true,
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: query.limit + 1,
          }),
      query.sourceMode === 'HOSTED'
        ? Promise.resolve([])
        : this.prisma.externalHenkatenProjection.findMany({
            where: {
              ...cursorWhere,
              ...commonDate,
              ...(query.supplierId ? { supplierId: query.supplierId } : {}),
              ...(query.status ? { status: query.status } : {}),
              ...(query.category ? { category: query.category } : {}),
            },
            include: { supplier: { select: { code: true, name: true } } },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: query.limit + 1,
          }),
    ]);
    const mapped = [
      ...hosted.map((row) => ({
        kind: 'HOSTED' as const,
        recordId: row.id,
        supplierId: row.supplierId,
        supplierCode: row.supplier.code,
        supplierName: row.supplier.name,
        sourceMode: row.sourceMode,
        sourceEpoch: row.sourceEpoch,
        displayId: row.identifier,
        status: row.status,
        category: row.category,
        lineName: row.lineNameSnapshot,
        jobName: row.jobNameSnapshot,
        partNumber: row.partNumberSnapshot,
        partName: row.partNameSnapshot,
        occurredAt: row.occurredAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        supervisorStatus:
          row.approvalRoutes.find((route) => route.route === 'SUPERVISOR')?.status ??
          'NOT_REQUIRED',
        qcStatus:
          row.approvalRoutes.find((route) => route.route === 'QC')?.status ?? 'NOT_REQUIRED',
      })),
      ...external.map((row) => {
        const line = objectRecord(row.lineSnapshot);
        const job = objectRecord(row.jobSnapshot);
        const part = objectRecord(row.partSnapshot);
        return {
          kind: 'EXTERNAL' as const,
          recordId: row.id,
          supplierId: row.supplierId,
          supplierCode: row.supplier.code,
          supplierName: row.supplier.name,
          sourceMode: 'EXTERNAL' as const,
          sourceEpoch: row.sourceEpoch,
          displayId: row.sourceHenkatenId,
          sourceVersion: row.sourceVersion,
          status: row.status,
          category: row.category,
          lineName: safeText(line['name']),
          jobName: safeText(job['name']),
          partNumber: safeText(part['number']),
          partName: safeText(part['name']),
          occurredAt: row.occurredAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    ]
      .filter((row) => {
        if (row.kind !== 'EXTERNAL') return true;
        const lineMatches =
          !query.line || row.lineName.toLowerCase().includes(query.line.toLowerCase());
        const partMatches =
          !query.part ||
          `${row.partNumber} ${row.partName}`.toLowerCase().includes(query.part.toLowerCase());
        return lineMatches && partMatches;
      })
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.recordId.localeCompare(left.recordId),
      );
    const hasNextPage = mapped.length > query.limit;
    const items = mapped.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeGlobalCursor({ updatedAt: last.updatedAt, id: last.recordId })
            : null,
      },
    };
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

async function ensureAutomaticOccurrence(
  tx: Prisma.TransactionClient,
  supplierId: string,
  sourceEpoch: number,
  lineShift: Awaited<ReturnType<LineShiftService['resolveOccurrence']>>['row'],
  businessDate: string,
  start: Date,
  end: Date,
  actorUserId: string,
) {
  const existing = await tx.shiftRun.findFirst({
    where: {
      supplierId,
      lineId: lineShift.lineId,
      shiftTemplateId: lineShift.shiftTemplateId,
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
    },
    include: { workingAssignments: true },
  });
  if (existing) return existing;
  const created = await tx.shiftRun.create({
    data: {
      supplierId,
      lineId: lineShift.lineId,
      shiftTemplateId: lineShift.shiftTemplateId,
      status: 'NOT_STARTED',
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
      scheduledStartAt: start,
      scheduledEndAt: end,
      timezoneSnapshot: lineShift.shiftTemplate.timezone,
      lineCodeSnapshot: lineShift.line.code,
      lineNameSnapshot: lineShift.line.name,
      shiftNameSnapshot: lineShift.shiftTemplate.name,
      shiftStartMinuteSnapshot: lineShift.shiftTemplate.startMinute,
      shiftEndMinuteSnapshot: lineShift.shiftTemplate.endMinute,
      defaultAssignmentSetVersion: lineShift.version,
      sourceEpoch,
      supervisorMemberId: lineShift.supervisorMemberId,
      supervisorNameSnapshot: lineShift.supervisor?.fullName ?? null,
      lineLeaderMemberId: lineShift.lineLeaderMemberId,
      lineLeaderNameSnapshot: lineShift.lineLeader?.fullName ?? null,
      latestPreflight: [],
      latestPreflightAt: new Date(),
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });
  if (lineShift.jobAssignments.length) {
    await tx.workingAssignment.createMany({
      data: lineShift.jobAssignments.map((assignment) => ({
        supplierId,
        shiftRunId: created.id,
        lineId: lineShift.lineId,
        jobId: assignment.jobId,
        jobNameSnapshot: assignment.job.name,
        jobDisplayOrderSnapshot: assignment.job.displayOrder,
        effectiveMpMemberId: assignment.mpMemberId,
        candidateMpMemberId: assignment.mpMemberId,
        mpNameSnapshot: assignment.mp?.fullName ?? null,
        mpRegistrationSnapshot: assignment.mp?.registrationNumber ?? null,
        state: assignment.mpMemberId ? ('ASSIGNED' as const) : ('VACANT' as const),
        active: true,
        includedInPlan: true,
        updatedById: actorUserId,
      })),
    });
  }
  return tx.shiftRun.findUniqueOrThrow({
    where: { id: created.id },
    include: { workingAssignments: true },
  });
}

function presentWarning(row: {
  id: string;
  henkatenId: string | null;
  externalProjectionId?: string | null;
  sourceMode?: 'HOSTED' | 'EXTERNAL';
  status: 'OPEN' | 'CLOSED';
  partNumberSnapshot: string;
  partNameSnapshot: string;
  openedAt: Date;
  closedAt: Date | null;
}) {
  return {
    id: row.id,
    henkatenId: row.henkatenId ?? row.externalProjectionId!,
    sourceMode: row.sourceMode ?? 'HOSTED',
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
function shiftSelectionConflict() {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Shift selection conflict',
    detail: 'Henkaten harus menggunakan shift yang sedang berjalan.',
  });
}

function encodeGlobalCursor(value: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeGlobalCursor(value?: string): { updatedAt: Date; id: string } | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.updatedAt !== 'string' || typeof decoded.id !== 'string') return undefined;
    return { updatedAt: new Date(decoded.updatedAt), id: decoded.id };
  } catch {
    return undefined;
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value : 'Tidak tersedia';
}
