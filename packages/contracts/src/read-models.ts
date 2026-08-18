import { z } from 'zod';

import {
  cursorSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  pageInfoSchema,
  utcTimestampSchema,
} from './common.js';
import {
  approvalRouteStatusSchema,
  approvalRouteSchema,
  assignmentIssueTypeSchema,
  henkatenCategorySchema,
  henkatenStatusSchema,
  sourceModeSchema,
  userRoleSchema,
  workingAssignmentStateSchema,
} from './enums.js';

export const notificationKindSchema = z.enum([
  'APPROVAL_PENDING',
  'HENKATEN_APPROVED',
  'HENKATEN_REJECTED',
  'HENKATEN_CANCELLED',
  'ASSIGNMENT_VACANCY',
  'ASSIGNMENT_ISSUE',
  'SHIFT_OVERRIDE',
  'EXTERNAL_WARNING',
  'EXTERNAL_INGESTION_ERROR',
  'SECURITY',
]);

export const notificationSchema = z
  .object({
    id: opaqueIdSchema,
    supplierId: opaqueIdSchema,
    kind: notificationKindSchema,
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(1_000),
    resourceType: z.string().min(1).max(100),
    resourceId: z.string().min(1).max(200),
    deepLink: z.string().startsWith('/').max(500).nullable(),
    createdAt: utcTimestampSchema,
    readAt: utcTimestampSchema.nullable(),
    version: optimisticVersionSchema,
  })
  .strict();

export const notificationListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    unreadOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationPageSchema = z
  .object({
    items: z.array(notificationSchema),
    pageInfo: pageInfoSchema,
  })
  .strict();

export const notificationReadRequestSchema = z
  .object({ read: z.boolean(), expectedVersion: optimisticVersionSchema })
  .strict();
export type NotificationReadRequest = z.infer<typeof notificationReadRequestSchema>;

export const notificationUnreadCountSchema = z.object({ count: z.number().int().nonnegative() });

export const boardQuerySchema = z.object({ lineId: opaqueIdSchema.optional() }).strict();
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const boardIndicatorSchema = z
  .object({
    henkatenId: opaqueIdSchema,
    identifier: z.string(),
    category: henkatenCategorySchema,
    status: z.enum(['OPEN', 'APPROVED']),
    approval: z
      .object({
        supervisor: approvalRouteStatusSchema,
        qc: approvalRouteStatusSchema,
      })
      .strict(),
  })
  .strict();

export const assignmentBoardSchema = z
  .object({
    version: z.string().min(1),
    lastUpdatedAt: utcTimestampSchema,
    lines: z.array(
      z
        .object({
          shiftRunId: opaqueIdSchema,
          lineId: opaqueIdSchema,
          lineCode: z.string(),
          lineName: z.string(),
          shiftName: z.string(),
          businessDate: z.string().date(),
          supervisor: z
            .object({ memberId: opaqueIdSchema.nullable(), name: z.string().nullable() })
            .strict(),
          lineLeader: z
            .object({ memberId: opaqueIdSchema.nullable(), name: z.string().nullable() })
            .strict(),
          activeOverride: z
            .object({
              reason: z.string().min(1).max(1_000),
              startedAt: utcTimestampSchema,
              unresolvedIssueCount: z.number().int().nonnegative(),
              failedChecks: z.array(
                z
                  .object({
                    code: z.string().min(1).max(100),
                    message: z.string().min(1).max(500),
                    resourceType: z.string().max(100).optional(),
                    resourceId: opaqueIdSchema.optional(),
                  })
                  .strict(),
              ),
            })
            .strict()
            .nullable(),
          jobs: z.array(
            z
              .object({
                assignmentId: opaqueIdSchema,
                jobId: opaqueIdSchema,
                jobName: z.string(),
                displayOrder: z.number().int(),
                state: workingAssignmentStateSchema,
                mp: z
                  .object({
                    memberId: opaqueIdSchema.nullable(),
                    name: z.string().nullable(),
                    registrationNumber: z.string().nullable(),
                    photoThumbnailUrl: z.string().nullable(),
                    initials: z.string().min(1).max(8).nullable(),
                  })
                  .strict(),
                indicators: z.array(boardIndicatorSchema),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const dashboardQuerySchema = z
  .object({
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
    status: henkatenStatusSchema.optional(),
    category: henkatenCategorySchema.optional(),
    lineId: opaqueIdSchema.optional(),
    part: z.string().min(1).max(200).optional(),
    shiftTemplateId: opaqueIdSchema.optional(),
    approvalRoute: approvalRouteSchema.optional(),
    approvalStatus: approvalRouteStatusSchema.optional(),
    granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
  })
  .strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const countByLabelSchema = z.array(
  z.object({ label: z.string(), count: z.number().int().nonnegative() }).strict(),
);

const dashboardPeriodSchema = z
  .object({
    periodStart: utcTimestampSchema,
    total: z.number().int().nonnegative(),
    man: z.number().int().nonnegative(),
    machine: z.number().int().nonnegative(),
    material: z.number().int().nonnegative(),
    method: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  })
  .strict();

export const supplierDashboardActivitySchema = z
  .object({
    id: opaqueIdSchema,
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    occurredAt: utcTimestampSchema,
    actor: z
      .object({
        kind: z.enum(['USER', 'SYSTEM', 'EXTERNAL_CLIENT']),
        displayName: z.string().min(1).max(150).nullable(),
        role: userRoleSchema.nullable(),
      })
      .strict(),
    henkaten: z
      .object({
        id: opaqueIdSchema,
        identifier: z.string().min(1).max(150),
        category: henkatenCategorySchema,
        status: henkatenStatusSchema,
        line: z
          .object({
            code: z.string().min(1).max(100),
            name: z.string().min(1).max(150),
          })
          .strict(),
        jobName: z.string().min(1).max(150),
        part: z
          .object({
            number: z.string().min(1).max(100),
            name: z.string().min(1).max(200),
          })
          .strict(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const supplierDashboardSchema = z
  .object({
    generatedAt: utcTimestampSchema,
    filterOptions: z
      .object({
        lines: z.array(
          z.object({ id: opaqueIdSchema, code: z.string(), name: z.string() }).strict(),
        ),
        shiftTemplates: z.array(z.object({ id: opaqueIdSchema, name: z.string() }).strict()),
      })
      .strict(),
    totals: z
      .object({
        all: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        approved: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
        activeWarnings: z.number().int().nonnegative(),
        unresolvedAssignmentIssues: z.number().int().nonnegative(),
        emergencyOverrides: z.number().int().nonnegative(),
      })
      .strict(),
    pendingApprovals: z
      .object({
        supervisor: z.number().int().nonnegative(),
        qc: z.number().int().nonnegative(),
      })
      .strict(),
    approvalAging: z.array(
      z
        .object({
          bucket: z.enum([
            'UNDER_4_HOURS',
            'FOUR_TO_EIGHT_HOURS',
            'EIGHT_TO_24_HOURS',
            'OVER_24_HOURS',
          ]),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    trend: z.array(dashboardPeriodSchema),
    assignmentIssues: z.array(
      z.object({ type: assignmentIssueTypeSchema, count: z.number().int().nonnegative() }).strict(),
    ),
    recentOverrides: z.array(
      z
        .object({
          shiftRunId: opaqueIdSchema,
          lineId: opaqueIdSchema,
          lineName: z.string().min(1).max(150),
          businessDate: z.string().date(),
          reason: z.string().min(1).max(1_000),
          startedAt: utcTimestampSchema,
        })
        .strict(),
    ),
    byCategory: countByLabelSchema,
    byLine: countByLabelSchema,
    byPart: countByLabelSchema,
    outcomes: countByLabelSchema,
    recentActivity: z.array(supplierDashboardActivitySchema),
  })
  .strict();

export const tmminDashboardSchema = z
  .object({
    generatedAt: utcTimestampSchema,
    suppliers: z
      .object({
        active: z.number().int().nonnegative(),
        hosted: z.number().int().nonnegative(),
        external: z.number().int().nonnegative(),
        withWarnings: z.number().int().nonnegative(),
      })
      .strict(),
    openHenkatens: z.number().int().nonnegative(),
    affectedParts: z.number().int().nonnegative(),
    emergencyOverrides: z.number().int().nonnegative(),
    externalIngestion: z
      .object({
        accepted: z.number().int().nonnegative(),
        recentRejected: z.number().int().nonnegative(),
      })
      .strict(),
    bySourceMode: countByLabelSchema,
    byCategory: countByLabelSchema,
    outcomes: countByLabelSchema,
    freshness: z.array(
      z
        .object({
          supplierId: opaqueIdSchema,
          supplierName: z.string(),
          sourceMode: sourceModeSchema,
          lastDataAt: utcTimestampSchema.nullable(),
          activeWarnings: z.number().int().nonnegative(),
          lastIngestionAt: utcTimestampSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    action: z.string().min(1).max(150).optional(),
    resourceType: z.string().min(1).max(100).optional(),
    resourceId: opaqueIdSchema.optional(),
    supplierId: opaqueIdSchema.optional(),
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEntrySchema = z
  .object({
    id: opaqueIdSchema,
    occurredAt: utcTimestampSchema,
    actorKind: z.string(),
    actorRole: z.string().nullable(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    supplierId: opaqueIdSchema.nullable(),
    supplierCode: z.string().nullable(),
    supplierName: z.string().nullable(),
    lineId: opaqueIdSchema.nullable(),
    changeSummary: z.record(z.string(), z.unknown()).nullable(),
    result: z.enum(['SUCCESS', 'FAILURE']),
    correlationId: z.string(),
    sourceMode: sourceModeSchema.nullable(),
    sourceEpoch: optimisticVersionSchema.nullable(),
    reason: z.string().max(1_000).nullable(),
  })
  .strict();

export const auditPageSchema = z
  .object({ items: z.array(auditEntrySchema), pageInfo: pageInfoSchema })
  .strict();

export const realtimeQuerySchema = z.object({ lineId: opaqueIdSchema.optional() }).strict();
export type RealtimeQuery = z.infer<typeof realtimeQuerySchema>;

export const realtimeHeartbeatSchema = z.object({ at: utcTimestampSchema }).strict();
export const realtimeResyncSchema = z
  .object({
    reason: z.literal('CURSOR_UNAVAILABLE'),
    at: utcTimestampSchema,
  })
  .strict();
export type RealtimeResync = z.infer<typeof realtimeResyncSchema>;
export const realtimeInvalidationSchema = z
  .object({
    eventType: z.string().min(1).max(150),
    aggregateType: z.string().min(1).max(100),
    aggregateId: opaqueIdSchema,
    aggregateVersion: optimisticVersionSchema,
    occurredAt: utcTimestampSchema,
    refresh: z.array(
      z.enum(['assignment-board', 'assignment-board-layout', 'notifications', 'dashboard']),
    ),
  })
  .strict();
export type RealtimeInvalidation = z.infer<typeof realtimeInvalidationSchema>;

export const supplierSetupAreaSchema = z.enum([
  'SHIFT_TEMPLATES',
  'MEMBERS_ACCOUNTS',
  'LINES_JOBS',
  'PARTS',
  'CHECKLISTS',
  'DEFAULT_ASSIGNMENTS',
]);
export type SupplierSetupArea = z.infer<typeof supplierSetupAreaSchema>;

export const supplierSetupReadinessSchema = z
  .object({
    generatedAt: utcTimestampSchema,
    ready: z.boolean(),
    areas: z.array(
      z
        .object({
          area: supplierSetupAreaSchema,
          ready: z.boolean(),
          activeCount: z.number().int().nonnegative(),
          requiredCount: z.number().int().nonnegative(),
          blockerCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    blockers: z.array(
      z
        .object({
          area: supplierSetupAreaSchema,
          code: z.string().min(1).max(100),
          detail: z.string().min(1).max(500),
          resourceType: z.string().max(100).optional(),
          resourceId: opaqueIdSchema.optional(),
        })
        .strict(),
    ),
    nextArea: supplierSetupAreaSchema.nullable(),
  })
  .strict();
