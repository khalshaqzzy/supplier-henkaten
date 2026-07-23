import type {
  Henkaten,
  HenkatenChecklistAnswer,
  HenkatenChecklistSnapshot,
  HenkatenTransition,
  ManHenkatenDetail,
  MPReservation,
} from '../generated/prisma/client.js';
import { databaseDate } from '../shifts/shift-time.js';

export function routeSummary(status: Henkaten['status']) {
  if (status === 'OPEN') return { supervisor: 'PENDING' as const, qc: 'PENDING' as const };
  if (status === 'APPROVED') return { supervisor: 'APPROVED' as const, qc: 'APPROVED' as const };
  return { supervisor: 'NOT_REQUIRED' as const, qc: 'NOT_REQUIRED' as const };
}

export function presentHenkatenSummary(row: Henkaten) {
  return {
    id: row.id,
    identifier: row.identifier,
    shiftRunId: row.shiftRunId,
    lineId: row.lineId,
    jobId: row.jobId,
    partId: row.partId,
    status: row.status,
    category: row.category,
    businessDate: databaseDate(row.businessDate),
    occurredAt: row.occurredAt.toISOString(),
    line: { code: row.lineCodeSnapshot, name: row.lineNameSnapshot },
    jobName: row.jobNameSnapshot,
    part: { number: row.partNumberSnapshot, name: row.partNameSnapshot },
    routes: routeSummary(row.status),
    version: row.version,
  };
}

type DetailRow = Henkaten & {
  checklistSnapshot: (HenkatenChecklistSnapshot & { answers: HenkatenChecklistAnswer[] }) | null;
  manDetail: ManHenkatenDetail | null;
  reservation: MPReservation | null;
  transitions: HenkatenTransition[];
};

export function presentHenkatenDetail(row: DetailRow) {
  if (!row.checklistSnapshot) throw new Error('MissingHenkatenChecklistSnapshot');
  return {
    ...presentHenkatenSummary(row),
    timezone: row.timezoneSnapshot,
    shiftName: row.shiftNameSnapshot,
    creatorName: row.creatorNameSnapshot,
    cause: row.cause,
    detail: row.detail,
    affectedObject: row.affectedObject,
    replacementObject: row.replacementObject,
    cancellationReason: row.cancellationReason,
    withdrawalReason: row.withdrawalReason,
    clonedFromHenkatenId: row.clonedFromHenkatenId,
    checklist: {
      checklistVersionId: row.checklistSnapshot.checklistVersionId,
      versionNumber: row.checklistSnapshot.versionNumber,
      category: row.checklistSnapshot.category,
      answers: row.checklistSnapshot.answers.map((answer) => ({
        sourceItemId: answer.sourceItemId,
        label: answer.labelSnapshot,
        displayOrder: answer.displayOrderSnapshot,
        answer: answer.answer,
      })),
    },
    man: row.manDetail
      ? {
          targetWorkingAssignmentId: row.manDetail.targetWorkingAssignmentId,
          sourceWorkingAssignmentId: row.manDetail.sourceWorkingAssignmentId,
          replacedMpMemberId: row.manDetail.replacedMpMemberId,
          replacedWasVacant: row.manDetail.replacedWasVacant,
          replacedMpName: row.manDetail.replacedMpNameSnapshot,
          replacementMpMemberId: row.manDetail.replacementMpMemberId,
          replacementMpName: row.manDetail.replacementMpNameSnapshot,
          targetAssignmentVersion: row.manDetail.targetAssignmentVersion,
          sourceAssignmentVersion: row.manDetail.sourceAssignmentVersion,
          reservationActive: Boolean(row.reservation && !row.reservation.releasedAt),
        }
      : null,
    history: row.transitions.map((transition) => ({
      id: transition.id,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      actorName: transition.actorName,
      actorRole: transition.actorRole,
      reason: transition.reason,
      occurredAt: transition.occurredAt.toISOString(),
    })),
  };
}

export const henkatenDetailInclude = {
  checklistSnapshot: {
    include: { answers: { orderBy: { displayOrderSnapshot: 'asc' as const } } },
  },
  manDetail: true,
  reservation: true,
  transitions: { orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }] },
};
