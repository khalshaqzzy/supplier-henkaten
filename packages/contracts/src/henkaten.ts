import { z } from 'zod';

import {
  approvalRouteStatusSchema,
  checklistAnswerSchema,
  henkatenCategorySchema,
  henkatenStatusSchema,
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

export const approvalRouteSummarySchema = z
  .object({
    supervisor: approvalRouteStatusSchema,
    qc: approvalRouteStatusSchema,
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
        reservationActive: z.boolean(),
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
  })
  .strict();
export type HenkatenListQuery = z.infer<typeof henkatenListQuerySchema>;

export const henkatenPageSchema = z
  .object({ items: z.array(henkatenSummarySchema), pageInfo: pageInfoSchema })
  .strict();

export const withdrawHenkatenRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

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
