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
  henkatenCategorySchema,
  henkatenStatusSchema,
  sourceModeSchema,
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
  })
  .strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const countByLabelSchema = z.array(
  z.object({ label: z.string(), count: z.number().int().nonnegative() }).strict(),
);

export const supplierDashboardSchema = z
  .object({
    generatedAt: utcTimestampSchema,
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
    byCategory: countByLabelSchema,
    byLine: countByLabelSchema,
    byPart: countByLabelSchema,
    outcomes: countByLabelSchema,
    recentActivity: z.array(
      z
        .object({
          id: opaqueIdSchema,
          action: z.string(),
          resourceType: z.string(),
          resourceId: z.string().nullable(),
          occurredAt: utcTimestampSchema,
        })
        .strict(),
    ),
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
    changeSummary: z.record(z.string(), z.unknown()).nullable(),
    result: z.enum(['SUCCESS', 'FAILURE']),
    correlationId: z.string(),
  })
  .strict();

export const auditPageSchema = z
  .object({ items: z.array(auditEntrySchema), pageInfo: pageInfoSchema })
  .strict();

export const realtimeQuerySchema = z.object({ lineId: opaqueIdSchema.optional() }).strict();
export type RealtimeQuery = z.infer<typeof realtimeQuerySchema>;
