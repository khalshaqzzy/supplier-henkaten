import { z } from 'zod';

import {
  approvalDecisionSchema,
  approvalRouteSchema,
  approvalRouteStatusSchema,
  checklistAnswerSchema,
  henkatenCategorySchema,
  henkatenStatusSchema,
  sourceModeSchema,
  warningStatusSchema,
} from './enums.js';
import {
  cursorSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  pageInfoSchema,
  utcTimestampSchema,
} from './common.js';
import { businessDateSchema, workingAssignmentSchema } from './shifts.js';

const requiredText = z.string().trim().min(1).max(2_000);

export const checklistSubmissionAnswerSchema = z
  .object({ itemId: opaqueIdSchema, answer: checklistAnswerSchema })
  .strict();

const submissionBase = {
  shiftRunId: opaqueIdSchema,
  jobId: opaqueIdSchema,
  partId: opaqueIdSchema,
  checklistVersionId: opaqueIdSchema,
  checklistAnswers: z.array(checklistSubmissionAnswerSchema).min(1).max(100),
  cause: requiredText,
  detail: requiredText,
  clonedFromHenkatenId: opaqueIdSchema.optional(),
};

export const createHenkatenRequestSchema = z.discriminatedUnion('category', [
  z
    .object({
      ...submissionBase,
      category: z.literal('MAN'),
      targetWorkingAssignmentId: opaqueIdSchema,
      targetAssignmentVersion: optimisticVersionSchema,
      replaced: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('VACANT') }).strict(),
        z.object({ kind: z.literal('MP'), memberId: opaqueIdSchema }).strict(),
      ]),
      replacementMpMemberId: opaqueIdSchema,
      sourceWorkingAssignmentId: opaqueIdSchema.optional(),
      sourceAssignmentVersion: optimisticVersionSchema.optional(),
      resolutionIssueId: opaqueIdSchema.optional(),
    })
    .strict(),
  ...(['MACHINE', 'MATERIAL', 'METHOD'] as const).map((category) =>
    z
      .object({
        ...submissionBase,
        category: z.literal(category),
        affectedObject: requiredText,
        replacementObject: requiredText,
      })
      .strict(),
  ),
]);
export type CreateHenkatenRequest = z.infer<typeof createHenkatenRequestSchema>;

export const approvalDecisionEvidenceSchema = z
  .object({
    id: opaqueIdSchema,
    decision: approvalDecisionSchema,
    actorName: z.string().min(1).max(150),
    actorRole: z.enum(['SUPERVISOR', 'QC']),
    comment: z.string().max(2_000).nullable(),
    decidedAt: utcTimestampSchema,
    correlationId: z.string().min(1).max(128),
    resultHenkatenVersion: optimisticVersionSchema,
  })
  .strict();

export const approvalRouteStateSchema = z
  .object({
    route: approvalRouteSchema,
    status: approvalRouteStatusSchema,
    initialResponsibleMemberId: opaqueIdSchema.nullable(),
    initialResponsibleName: z.string().max(150).nullable(),
    currentResponsibleMemberId: opaqueIdSchema.nullable(),
    currentResponsibleName: z.string().max(150).nullable(),
    version: optimisticVersionSchema,
    decision: approvalDecisionEvidenceSchema.nullable(),
  })
  .strict();

export const approvalRouteSummarySchema = z
  .object({
    supervisor: approvalRouteStateSchema,
    qc: approvalRouteStateSchema,
  })
  .strict();

export const henkatenSummarySchema = z
  .object({
    id: opaqueIdSchema,
    identifier: z.string().min(1).max(150),
    shiftRunId: opaqueIdSchema,
    lineId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    partId: opaqueIdSchema,
    status: henkatenStatusSchema,
    sourceMode: sourceModeSchema,
    sourceEpoch: optimisticVersionSchema,
    category: henkatenCategorySchema,
    businessDate: businessDateSchema,
    occurredAt: utcTimestampSchema,
    line: z.object({ code: z.string(), name: z.string() }).strict(),
    jobName: z.string(),
    part: z.object({ number: z.string(), name: z.string() }).strict(),
    routes: approvalRouteSummarySchema,
    version: optimisticVersionSchema,
  })
  .strict();

export const henkatenChecklistSnapshotSchema = z
  .object({
    checklistVersionId: opaqueIdSchema,
    versionNumber: optimisticVersionSchema,
    category: henkatenCategorySchema,
    answers: z.array(
      z
        .object({
          sourceItemId: opaqueIdSchema,
          label: z.string().min(1).max(500),
          displayOrder: z.number().int().positive(),
          answer: checklistAnswerSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const henkatenTransitionSchema = z
  .object({
    id: opaqueIdSchema,
    fromStatus: henkatenStatusSchema.nullable(),
    toStatus: henkatenStatusSchema,
    actorName: z.string().min(1).max(150),
    actorRole: z.string(),
    reason: z.string().max(1_000).nullable(),
    occurredAt: utcTimestampSchema,
  })
  .strict();

export const henkatenDetailSchema = henkatenSummarySchema
  .extend({
    timezone: z.string(),
    shiftName: z.string(),
    creatorName: z.string(),
    cause: z.string(),
    detail: z.string(),
    affectedObject: z.string().nullable(),
    replacementObject: z.string().nullable(),
    cancellationReason: z.enum(['WITHDRAWN', 'SHIFT_ENDED']).nullable(),
    withdrawalReason: z.string().nullable(),
    clonedFromHenkatenId: opaqueIdSchema.nullable(),
    checklist: henkatenChecklistSnapshotSchema,
    man: z
      .object({
        targetWorkingAssignmentId: opaqueIdSchema,
        sourceWorkingAssignmentId: opaqueIdSchema.nullable(),
        replacedMpMemberId: opaqueIdSchema.nullable(),
        replacedWasVacant: z.boolean(),
        replacedMpName: z.string().nullable(),
        replacementMpMemberId: opaqueIdSchema,
        replacementMpName: z.string(),
        targetAssignmentVersion: optimisticVersionSchema,
        sourceAssignmentVersion: optimisticVersionSchema.nullable(),
        resolutionIssueId: opaqueIdSchema.nullable(),
        reservationActive: z.boolean(),
      })
      .strict()
      .nullable(),
    movement: z
      .object({
        id: opaqueIdSchema,
        targetShiftRunId: opaqueIdSchema,
        sourceShiftRunId: opaqueIdSchema.nullable(),
        targetWorkingAssignmentId: opaqueIdSchema,
        sourceWorkingAssignmentId: opaqueIdSchema.nullable(),
        targetLineId: opaqueIdSchema,
        targetJobId: opaqueIdSchema,
        sourceLineId: opaqueIdSchema.nullable(),
        sourceJobId: opaqueIdSchema.nullable(),
        movedMpMemberId: opaqueIdSchema,
        movedMpName: z.string().min(1).max(150),
        replacedMpMemberId: opaqueIdSchema.nullable(),
        replacedMpName: z.string().max(150).nullable(),
        movedAt: utcTimestampSchema,
      })
      .strict()
      .nullable(),
    history: z.array(henkatenTransitionSchema),
  })
  .strict();

export const henkatenListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: henkatenStatusSchema.optional(),
    category: henkatenCategorySchema.optional(),
    lineId: opaqueIdSchema.optional(),
    shiftRunId: opaqueIdSchema.optional(),
    part: z.string().trim().min(1).max(200).optional(),
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
    approvalStatus: approvalRouteStatusSchema.optional(),
    approvalRoute: approvalRouteSchema.optional(),
  })
  .strict();
export type HenkatenListQuery = z.infer<typeof henkatenListQuerySchema>;

export const henkatenPageSchema = z
  .object({ items: z.array(henkatenSummarySchema), pageInfo: pageInfoSchema })
  .strict();

export const henkatenFormOptionsQuerySchema = z
  .object({
    category: henkatenCategorySchema,
    part: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type HenkatenFormOptionsQuery = z.infer<typeof henkatenFormOptionsQuerySchema>;

export const henkatenFormOptionsSchema = z
  .object({
    generatedAt: utcTimestampSchema,
    checklist: z
      .object({
        id: opaqueIdSchema,
        category: henkatenCategorySchema,
        versionNumber: optimisticVersionSchema,
        publishedAt: utcTimestampSchema,
        items: z.array(
          z
            .object({
              id: opaqueIdSchema,
              label: z.string().min(1).max(500),
              displayOrder: z.number().int().positive(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    parts: z.array(
      z
        .object({
          id: opaqueIdSchema,
          partNumber: z.string().min(1).max(100),
          partName: z.string().min(1).max(200),
        })
        .strict(),
    ),
    replacementMembers: z.array(
      z
        .object({
          id: opaqueIdSchema,
          fullName: z.string().min(1).max(150),
          registrationNumber: z.string().min(1).max(100),
          reserved: z.boolean(),
          currentAssignment: z
            .object({
              id: opaqueIdSchema,
              version: optimisticVersionSchema,
              shiftRunId: opaqueIdSchema,
              lineId: opaqueIdSchema,
              lineName: z.string().min(1).max(150),
              jobId: opaqueIdSchema,
              jobName: z.string().min(1).max(150),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const withdrawHenkatenRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const decideHenkatenRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    decision: approvalDecisionSchema,
    comment: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type DecideHenkatenRequest = z.infer<typeof decideHenkatenRequestSchema>;

export const rerouteSupervisorRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    supervisorMemberId: opaqueIdSchema,
  })
  .strict();
export type RerouteSupervisorRequest = z.infer<typeof rerouteSupervisorRequestSchema>;

export const clonePrefillSchema = z
  .object({
    clonedFromHenkatenId: opaqueIdSchema,
    category: henkatenCategorySchema,
    shiftRunId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    partId: opaqueIdSchema,
    cause: z.string(),
    detail: z.string(),
    affectedObject: z.string().nullable(),
    replacementObject: z.string().nullable(),
    checklistVersionId: opaqueIdSchema,
    checklistItems: z.array(
      z
        .object({ itemId: opaqueIdSchema, label: z.string(), displayOrder: z.number().int() })
        .strict(),
    ),
    shiftStillValid: z.boolean(),
    jobStillValid: z.boolean(),
    partStillValid: z.boolean(),
    assignmentStillValid: z.boolean(),
    workingAssignment: workingAssignmentSchema.nullable(),
  })
  .strict();

export const warningInstanceSchema = z
  .object({
    id: opaqueIdSchema,
    henkatenId: opaqueIdSchema,
    sourceMode: z.enum(['HOSTED', 'EXTERNAL']),
    status: warningStatusSchema,
    partNumber: z.string(),
    partName: z.string(),
    openedAt: utcTimestampSchema,
    closedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const affectedPartSchema = z
  .object({
    supplierId: opaqueIdSchema,
    supplierName: z.string(),
    partNumber: z.string(),
    partName: z.string(),
    openWarningCount: z.number().int().positive(),
    oldestOpenedAt: utcTimestampSchema,
  })
  .strict();

export const affectedPartPageSchema = z
  .object({ items: z.array(affectedPartSchema), pageInfo: pageInfoSchema })
  .strict();

export const affectedPartDetailSchema = affectedPartSchema
  .extend({ warnings: z.array(warningInstanceSchema) })
  .strict();
