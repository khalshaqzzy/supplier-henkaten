import { z } from 'zod';

import {
  assignmentIssueStatusSchema,
  assignmentIssueTypeSchema,
  henkatenCategorySchema,
  shiftRunStatusSchema,
  workingAssignmentStateSchema,
} from './enums.js';
import {
  cursorSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  pageInfoSchema,
  utcTimestampSchema,
} from './common.js';

export const businessDateSchema = z.string().date();

export const shiftPreflightCheckCodeSchema = z.enum([
  'ACTIVE_SHIFT_EXISTS',
  'LINE_INACTIVE',
  'SHIFT_TEMPLATE_INACTIVE',
  'SUPERVISOR_MISSING',
  'LINE_LEADER_MISSING',
  'LINE_LEADER_CONFLICT',
  'REQUIRED_JOB_VACANT',
  'DUPLICATE_MP',
  'MP_INACTIVE',
  'MP_ACTIVE_ELSEWHERE',
  'MP_RESERVED',
  'ASSIGNMENT_ISSUE_OPEN',
  'OPEN_HENKATEN_CARRY_OVER',
  'CHECKLIST_INVALID',
  'STALE_PLANNED_ASSIGNMENT',
  'SOURCE_EPOCH_STALE',
]);
export type ShiftPreflightCheckCode = z.infer<typeof shiftPreflightCheckCodeSchema>;

export const shiftPreflightCheckSchema = z
  .object({
    code: shiftPreflightCheckCodeSchema,
    blocking: z.boolean(),
    message: z.string().min(1).max(500),
    resourceType: z.string().min(1).max(100).optional(),
    resourceId: opaqueIdSchema.optional(),
    version: optimisticVersionSchema.optional(),
    category: henkatenCategorySchema.optional(),
  })
  .strict();
export type ShiftPreflightCheck = z.infer<typeof shiftPreflightCheckSchema>;

export const prepareShiftRequestSchema = z
  .object({
    lineId: opaqueIdSchema,
    shiftTemplateId: opaqueIdSchema,
    businessDate: businessDateSchema,
  })
  .strict();
export type PrepareShiftRequest = z.infer<typeof prepareShiftRequestSchema>;

export const startShiftRequestSchema = z
  .object({ expectedVersion: optimisticVersionSchema })
  .strict();

export const emergencyStartShiftRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    reason: z.string().trim().min(10).max(1_000),
    substituteLineLeaderMemberId: opaqueIdSchema.optional(),
  })
  .strict();
export type EmergencyStartShiftRequest = z.infer<typeof emergencyStartShiftRequestSchema>;

export const workingAssignmentSchema = z
  .object({
    id: opaqueIdSchema,
    shiftRunId: opaqueIdSchema,
    lineId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    jobName: z.string().min(1).max(150),
    jobDisplayOrder: z.number().int().positive(),
    effectiveMpMemberId: opaqueIdSchema.nullable(),
    candidateMpMemberId: opaqueIdSchema.nullable(),
    mpName: z.string().min(1).max(150).nullable(),
    mpRegistrationNumber: z.string().min(1).max(100).nullable(),
    state: workingAssignmentStateSchema,
    active: z.boolean(),
    version: optimisticVersionSchema,
  })
  .strict();
export type WorkingAssignment = z.infer<typeof workingAssignmentSchema>;

export const shiftRunSchema = z
  .object({
    id: opaqueIdSchema,
    lineId: opaqueIdSchema,
    shiftTemplateId: opaqueIdSchema,
    status: shiftRunStatusSchema,
    businessDate: businessDateSchema,
    scheduledStartAt: utcTimestampSchema,
    scheduledEndAt: utcTimestampSchema,
    timezone: z.string().min(1).max(100),
    line: z.object({ code: z.string(), name: z.string() }).strict(),
    shift: z
      .object({
        name: z.string(),
        startMinute: z.number().int().min(0).max(1_439),
        endMinute: z.number().int().min(0).max(1_439),
      })
      .strict(),
    defaultAssignmentSetVersion: optimisticVersionSchema,
    supervisor: z
      .object({ memberId: opaqueIdSchema, name: z.string().min(1).max(150) })
      .strict()
      .nullable(),
    lineLeader: z
      .object({ memberId: opaqueIdSchema, name: z.string().min(1).max(150) })
      .strict()
      .nullable(),
    eligible: z.boolean(),
    checks: z.array(shiftPreflightCheckSchema),
    latestPreflightAt: utcTimestampSchema,
    startedAt: utcTimestampSchema.nullable(),
    startedWithOverride: z.boolean(),
    overrideReason: z.string().max(1_000).nullable(),
    version: optimisticVersionSchema,
  })
  .strict();
export type ShiftRun = z.infer<typeof shiftRunSchema>;

export const shiftRunDetailSchema = shiftRunSchema
  .extend({ workingAssignments: z.array(workingAssignmentSchema) })
  .strict();

export const shiftListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: shiftRunStatusSchema.optional(),
    lineId: opaqueIdSchema.optional(),
    businessDate: businessDateSchema.optional(),
  })
  .strict();
export type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;

export const shiftRunPageSchema = z
  .object({ items: z.array(shiftRunSchema), pageInfo: pageInfoSchema })
  .strict();

export const currentShiftQuerySchema = z.object({ lineId: opaqueIdSchema.optional() }).strict();

export const assignmentIssueSchema = z
  .object({
    id: opaqueIdSchema,
    shiftRunId: opaqueIdSchema.nullable(),
    lineId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    type: assignmentIssueTypeSchema,
    status: assignmentIssueStatusSchema,
    originKind: z.string().min(1).max(50),
    originReferenceId: opaqueIdSchema.nullable(),
    openedAt: utcTimestampSchema,
    resolvedAt: utcTimestampSchema.nullable(),
    version: optimisticVersionSchema,
  })
  .strict();

export const assignmentIssuePageSchema = z
  .object({ items: z.array(assignmentIssueSchema), pageInfo: pageInfoSchema })
  .strict();

export const preStartResolutionContextSchema = z
  .object({
    shift: shiftRunDetailSchema,
    issues: z.array(assignmentIssueSchema),
    proposedManResolutionSupported: z.literal(false),
  })
  .strict();
