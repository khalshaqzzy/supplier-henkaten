import { Injectable } from '@nestjs/common';

import type { Prisma, UserRole } from '../generated/prisma/client.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { AssignmentIssueService } from '../shifts/assignment-issue.service.js';

type MovementActor = {
  userId: string;
  role: UserRole;
  correlationId: string;
};

@Injectable()
export class ManMovementService {
  constructor(
    private readonly issues: AssignmentIssueService,
    private readonly outbox: OutboxService,
  ) {}

  async apply(
    tx: Prisma.TransactionClient,
    supplierId: string,
    henkatenId: string,
    henkatenVersion: number,
    actor: MovementActor,
  ): Promise<{ movementId: string; releasedReservation: boolean }> {
    const detail = await tx.manHenkatenDetail.findFirst({
      where: { henkatenId, supplierId },
      include: { resolutionIssue: true },
    });
    if (!detail) return { movementId: '', releasedReservation: false };
    const reservation = await tx.mPReservation.findFirst({
      where: { henkatenId, supplierId, releasedAt: null },
    });
    if (!reservation) throw reservationConflict();

    const assignmentIds = [
      detail.targetWorkingAssignmentId,
      ...(detail.sourceWorkingAssignmentId ? [detail.sourceWorkingAssignmentId] : []),
    ].sort();
    await tx.$queryRaw`
      SELECT id
      FROM "WorkingAssignment"
      WHERE id = ANY(${assignmentIds}::uuid[])
      ORDER BY id
      FOR UPDATE
    `;
    const target = await tx.workingAssignment.findFirst({
      where: {
        id: detail.targetWorkingAssignmentId,
        supplierId,
        includedInPlan: true,
      },
    });
    const source = detail.sourceWorkingAssignmentId
      ? await tx.workingAssignment.findFirst({
          where: { id: detail.sourceWorkingAssignmentId, supplierId },
        })
      : null;
    if (!target || target.version !== detail.targetAssignmentVersion) throw versionConflict();
    if (
      detail.sourceWorkingAssignmentId &&
      (!source ||
        source.version !== detail.sourceAssignmentVersion ||
        source.effectiveMpMemberId !== detail.replacementMpMemberId)
    ) {
      throw versionConflict();
    }
    if (
      detail.replacedWasVacant
        ? target.effectiveMpMemberId !== null
        : target.effectiveMpMemberId !== detail.replacedMpMemberId
    ) {
      throw versionConflict();
    }
    if (source) {
      const incompatible = await tx.assignmentIssue.findFirst({
        where: { supplierId, jobId: source.jobId, status: 'OPEN' },
      });
      if (incompatible) throw assignmentConflict();
    }
    if (detail.resolutionIssue) {
      if (
        detail.resolutionIssue.status !== 'OPEN' ||
        detail.resolutionIssue.jobId !== target.jobId ||
        detail.resolutionIssue.lineId !== target.lineId ||
        detail.resolutionIssue.shiftRunId !== target.shiftRunId
      ) {
        throw assignmentConflict();
      }
    }

    const now = new Date();
    const updatedSource = source
      ? await tx.workingAssignment.update({
          where: { id: source.id },
          data: {
            effectiveMpMemberId: null,
            candidateMpMemberId: null,
            mpNameSnapshot: null,
            mpRegistrationSnapshot: null,
            state: 'VACANT',
            version: { increment: 1 },
            updatedById: actor.userId,
          },
        })
      : null;
    const replacement = await tx.member.findFirst({
      where: {
        id: detail.replacementMpMemberId,
        supplierId,
        active: true,
        role: 'MP',
      },
    });
    if (!replacement) throw assignmentConflict();
    const updatedTarget = await tx.workingAssignment.update({
      where: { id: target.id },
      data: {
        effectiveMpMemberId: replacement.id,
        candidateMpMemberId: replacement.id,
        mpNameSnapshot: replacement.fullName,
        mpRegistrationSnapshot: replacement.registrationNumber,
        state: 'ASSIGNED',
        version: { increment: 1 },
        updatedById: actor.userId,
      },
    });
    const movement = await tx.assignmentMovement.create({
      data: {
        supplierId,
        henkatenId,
        targetShiftRunId: target.shiftRunId,
        ...(source ? { sourceShiftRunId: source.shiftRunId } : {}),
        targetWorkingAssignmentId: target.id,
        ...(source ? { sourceWorkingAssignmentId: source.id } : {}),
        targetLineId: target.lineId,
        targetJobId: target.jobId,
        ...(source ? { sourceLineId: source.lineId, sourceJobId: source.jobId } : {}),
        movedMpMemberId: replacement.id,
        movedMpNameSnapshot: replacement.fullName,
        ...(detail.replacedMpMemberId
          ? {
              replacedMpMemberId: detail.replacedMpMemberId,
              replacedMpNameSnapshot: detail.replacedMpNameSnapshot,
            }
          : {}),
        targetAssignmentVersionBefore: target.version,
        targetAssignmentVersionAfter: updatedTarget.version,
        ...(source && updatedSource
          ? {
              sourceAssignmentVersionBefore: source.version,
              sourceAssignmentVersionAfter: updatedSource.version,
            }
          : {}),
        movedById: actor.userId,
        correlationId: actor.correlationId,
      },
    });
    await tx.mPReservation.update({
      where: { henkatenId },
      data: {
        releasedAt: now,
        releaseReason: 'APPROVED',
        version: { increment: 1 },
      },
    });

    if (source) {
      const issue = await this.issues.createOpen(tx, {
        supplierId,
        shiftRunId: source.shiftRunId,
        lineId: source.lineId,
        jobId: source.jobId,
        type: 'VACANCY',
        originKind: 'MAN_HENKATEN_MOVEMENT',
        originReferenceId: movement.id,
        originHenkatenId: henkatenId,
        originMovementId: movement.id,
      });
      await this.outbox.enqueue(
        event('ASSIGNMENT_ISSUE_OPENED', issue.id, issue.version, supplierId, actor, {
          lineId: source.lineId,
          jobId: source.jobId,
          originHenkatenId: henkatenId,
        }),
        tx,
      );
      await this.outbox.enqueue(
        event('NOTIFICATION_REQUESTED', issue.id, issue.version, supplierId, actor, {
          kind: 'DONOR_ASSIGNMENT_VACANCY',
          shiftRunId: source.shiftRunId,
          lineId: source.lineId,
          jobId: source.jobId,
        }),
        tx,
      );
    }
    if (detail.resolutionIssueId) {
      const resolved = await this.issues.resolveFromVerifiedWorkflow(tx, {
        supplierId,
        issueId: detail.resolutionIssueId,
        shiftRunId: target.shiftRunId,
        jobId: target.jobId,
        resolutionKind: 'MAN_HENKATEN_APPROVED',
        resolutionReferenceId: henkatenId,
        resolutionHenkatenId: henkatenId,
        resolvedById: actor.userId,
      });
      if (!resolved) throw assignmentConflict();
      await this.outbox.enqueue(
        event('ASSIGNMENT_ISSUE_RESOLVED', resolved.id, resolved.version, supplierId, actor, {
          henkatenId,
          jobId: target.jobId,
        }),
        tx,
      );
    }
    await this.outbox.enqueue(
      event('MP_MOVED', henkatenId, henkatenVersion, supplierId, actor, {
        movementId: movement.id,
        replacementMpMemberId: replacement.id,
        targetWorkingAssignmentId: target.id,
        sourceWorkingAssignmentId: source?.id ?? null,
      }),
      tx,
    );
    await this.outbox.enqueue(
      event('MP_RESERVATION_RELEASED', henkatenId, henkatenVersion, supplierId, actor, {
        reason: 'APPROVED',
      }),
      tx,
    );
    return { movementId: movement.id, releasedReservation: true };
  }
}

function event(
  eventType: string,
  aggregateId: string,
  aggregateVersion: number,
  supplierId: string,
  actor: MovementActor,
  payload: Record<string, unknown>,
) {
  return {
    eventType,
    aggregateType: 'Henkaten',
    aggregateId,
    aggregateVersion,
    supplierId,
    actor: { userId: actor.userId, role: actor.role },
    correlationId: actor.correlationId,
    payload,
  };
}

function reservationConflict() {
  return new ProblemException({
    status: 409,
    code: 'RESERVATION_CONFLICT',
    title: 'Reservation conflict',
    detail: 'The Man reservation is no longer active.',
  });
}

function assignmentConflict() {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Assignment conflict',
    detail: 'The assignment can no longer be finalized safely.',
  });
}
