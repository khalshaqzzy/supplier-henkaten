import type {
  Henkaten,
  HenkatenChecklistAnswer,
  HenkatenChecklistSnapshot,
  HenkatenApprovalRoute,
  HenkatenTransition,
  ManHenkatenDetail,
  MPReservation,
  ApprovalDecision,
  AssignmentMovement,
} from '../generated/prisma/client.js';
import { databaseDate } from '../shifts/shift-time.js';

type RouteRow = HenkatenApprovalRoute & { decision: ApprovalDecision | null };
type SummaryRow = Henkaten & { approvalRoutes: RouteRow[] };

export function routeSummary(routes: RouteRow[]) {
  const supervisor = routes.find(({ route }) => route === 'SUPERVISOR');
  const qc = routes.find(({ route }) => route === 'QC');
  if (!supervisor || !qc) throw new Error('MissingHenkatenApprovalRoute');
  return { supervisor: presentRoute(supervisor), qc: presentRoute(qc) };
}

export function presentHenkatenSummary(row: SummaryRow) {
  return {
    id: row.id,
    identifier: row.identifier,
    shiftRunId: row.shiftRunId,
    lineId: row.lineId,
    jobId: row.jobId,
    partId: row.partId,
    status: row.status,
    sourceMode: row.sourceMode,
    sourceEpoch: row.sourceEpoch,
    category: row.category,
    businessDate: databaseDate(row.businessDate),
    occurredAt: row.occurredAt.toISOString(),
    line: { code: row.lineCodeSnapshot, name: row.lineNameSnapshot },
    jobName: row.jobNameSnapshot,
    part: { number: row.partNumberSnapshot, name: row.partNameSnapshot },
    routes: routeSummary(row.approvalRoutes),
    version: row.version,
  };
}

type DetailRow = Henkaten & {
  checklistSnapshot: (HenkatenChecklistSnapshot & { answers: HenkatenChecklistAnswer[] }) | null;
  manDetail: ManHenkatenDetail | null;
  reservation: MPReservation | null;
  transitions: HenkatenTransition[];
  approvalRoutes: RouteRow[];
  movement: AssignmentMovement | null;
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
          resolutionIssueId: row.manDetail.resolutionIssueId,
          reservationActive: Boolean(row.reservation && !row.reservation.releasedAt),
        }
      : null,
    movement: row.movement
      ? {
          id: row.movement.id,
          targetShiftRunId: row.movement.targetShiftRunId,
          sourceShiftRunId: row.movement.sourceShiftRunId,
          targetWorkingAssignmentId: row.movement.targetWorkingAssignmentId,
          sourceWorkingAssignmentId: row.movement.sourceWorkingAssignmentId,
          targetLineId: row.movement.targetLineId,
          targetJobId: row.movement.targetJobId,
          sourceLineId: row.movement.sourceLineId,
          sourceJobId: row.movement.sourceJobId,
          movedMpMemberId: row.movement.movedMpMemberId,
          movedMpName: row.movement.movedMpNameSnapshot,
          replacedMpMemberId: row.movement.replacedMpMemberId,
          replacedMpName: row.movement.replacedMpNameSnapshot,
          movedAt: row.movement.movedAt.toISOString(),
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
  approvalRoutes: { include: { decision: true }, orderBy: { route: 'asc' as const } },
  movement: true,
  transitions: { orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }] },
};

function presentRoute(row: RouteRow) {
  return {
    route: row.route,
    status: row.status,
    initialResponsibleMemberId: row.initialResponsibleMemberId,
    initialResponsibleName: row.initialResponsibleNameSnapshot,
    currentResponsibleMemberId: row.currentResponsibleMemberId,
    currentResponsibleName: row.currentResponsibleNameSnapshot,
    version: row.version,
    decision: row.decision
      ? {
          id: row.decision.id,
          decision: row.decision.decision,
          actorName: row.decision.actorNameSnapshot,
          actorRole: row.decision.actorRole,
          comment: row.decision.comment,
          decidedAt: row.decision.decidedAt.toISOString(),
          correlationId: row.decision.correlationId,
          resultHenkatenVersion: row.decision.resultHenkatenVersion,
        }
      : null,
  };
}
