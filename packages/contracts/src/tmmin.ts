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
  userStatusSchema,
} from './enums.js';
import {
  sourcePreflightResponseSchema,
  supplierSummarySchema,
  userSummarySchema,
} from './administration.js';
import { hostedPreparationSchema, temporaryCredentialSchema } from './administration.js';

export const tmminListStatusSchema = z.enum(['ALL', 'ACTIVE', 'INACTIVE']);
export const supplierListSortSchema = z.enum(['NAME_ASC', 'UPDATED_DESC']);
export const qualityUserListSortSchema = z.enum(['USERNAME_ASC', 'UPDATED_DESC']);

export const supplierListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().min(1).max(200).optional(),
    status: tmminListStatusSchema.default('ALL'),
    sourceMode: sourceModeSchema.optional(),
    sort: supplierListSortSchema.default('NAME_ASC'),
  })
  .strict();
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

export const qualityUserListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().min(1).max(200).optional(),
    status: userStatusSchema.optional(),
    sort: qualityUserListSortSchema.default('USERNAME_ASC'),
  })
  .strict();
export type QualityUserListQuery = z.infer<typeof qualityUserListQuerySchema>;

const preparationSummarySchema = z
  .object({
    id: opaqueIdSchema,
    adminUserId: opaqueIdSchema.nullable(),
    sourceEpoch: optimisticVersionSchema,
    status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']),
    startedAt: utcTimestampSchema,
    completedAt: utcTimestampSchema.nullable(),
    cancelledAt: utcTimestampSchema.nullable(),
    version: optimisticVersionSchema,
  })
  .strict();

export const supplierDetailSchema = z
  .object({
    supplier: supplierSummarySchema,
    currentSupplierAdmin: userSummarySchema.nullable(),
    activePreparation: preparationSummarySchema.nullable(),
    monitoring: z
      .object({
        activeWarnings: z.number().int().nonnegative(),
        lastHostedDataAt: utcTimestampSchema.nullable(),
        lastExternalIngestionAt: utcTimestampSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const sourceHistoryEntrySchema = z
  .object({
    id: opaqueIdSchema,
    epoch: optimisticVersionSchema,
    mode: sourceModeSchema,
    previousMode: sourceModeSchema.nullable(),
    action: z.enum([
      'SUPPLIER_CREATED',
      'HOSTED_PREPARATION_STARTED',
      'HOSTED_PREPARATION_CANCELLED',
      'SUPPLIER_SOURCE_MODE_CHANGED',
    ]),
    occurredAt: utcTimestampSchema,
    actorRole: z.string().nullable(),
    reason: z.string().max(1_000).nullable(),
    correlationId: z.string().min(1).max(128),
  })
  .strict();

export const sourceGovernanceSummarySchema = z
  .object({
    generatedAt: utcTimestampSchema,
    supplier: supplierSummarySchema,
    currentSupplierAdmin: userSummarySchema.nullable(),
    activePreparation: preparationSummarySchema.nullable(),
    preflight: sourcePreflightResponseSchema,
    history: z.array(sourceHistoryEntrySchema),
  })
  .strict();

export const hostedPreparationCredentialSchema = z
  .object({
    preparation: hostedPreparationSchema,
    user: userSummarySchema,
    credential: temporaryCredentialSchema,
  })
  .strict();

export const tmminDashboardQuerySchema = z
  .object({
    supplierId: opaqueIdSchema.optional(),
    sourceMode: sourceModeSchema.optional(),
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
    status: henkatenStatusSchema.optional(),
    category: henkatenCategorySchema.optional(),
    line: z.string().trim().min(1).max(200).optional(),
    part: z.string().trim().min(1).max(200).optional(),
    aging: z
      .enum(['UNDER_4_HOURS', 'FOUR_TO_EIGHT_HOURS', 'EIGHT_TO_24_HOURS', 'OVER_24_HOURS'])
      .optional(),
    freshness: z.enum(['FRESH', 'WARNING', 'STALE', 'NO_DATA']).optional(),
    granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
  })
  .strict();
export type TmminDashboardQuery = z.infer<typeof tmminDashboardQuerySchema>;

const countByLabelSchema = z.array(
  z.object({ label: z.string(), count: z.number().int().nonnegative() }).strict(),
);

export const tmminDashboardExtendedSchema = z
  .object({
    generatedAt: utcTimestampSchema,
    filterOptions: z
      .object({
        suppliers: z.array(
          z
            .object({
              id: opaqueIdSchema,
              code: z.string(),
              name: z.string(),
              sourceMode: sourceModeSchema,
            })
            .strict(),
        ),
      })
      .strict(),
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
        duplicate: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        recentRejected: z.number().int().nonnegative(),
      })
      .strict(),
    aging: z.array(
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
    bySourceMode: countByLabelSchema,
    byCategory: countByLabelSchema,
    outcomes: countByLabelSchema,
    rankings: z
      .object({
        suppliers: countByLabelSchema,
        lines: countByLabelSchema,
        parts: countByLabelSchema,
      })
      .strict(),
    freshness: z.array(
      z
        .object({
          supplierId: opaqueIdSchema,
          supplierCode: z.string(),
          supplierName: z.string(),
          sourceMode: sourceModeSchema,
          lastDataAt: utcTimestampSchema.nullable(),
          lastIngestionAt: utcTimestampSchema.nullable(),
          activeWarnings: z.number().int().nonnegative(),
          state: z.enum(['FRESH', 'WARNING', 'STALE', 'NO_DATA']),
        })
        .strict(),
    ),
    recentOverrides: z.array(
      z
        .object({
          shiftRunId: opaqueIdSchema,
          supplierId: opaqueIdSchema,
          supplierName: z.string(),
          lineName: z.string(),
          businessDate: z.string().date(),
          reason: z.string(),
          startedAt: utcTimestampSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const tmminHenkatenQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    supplierId: opaqueIdSchema.optional(),
    sourceMode: sourceModeSchema.optional(),
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
    status: henkatenStatusSchema.optional(),
    category: henkatenCategorySchema.optional(),
    line: z.string().trim().min(1).max(200).optional(),
    part: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type TmminHenkatenQuery = z.infer<typeof tmminHenkatenQuerySchema>;

const tmminHenkatenBase = {
  recordId: opaqueIdSchema,
  supplierId: opaqueIdSchema,
  supplierCode: z.string(),
  supplierName: z.string(),
  sourceMode: sourceModeSchema,
  sourceEpoch: optimisticVersionSchema,
  status: henkatenStatusSchema,
  category: henkatenCategorySchema,
  lineName: z.string(),
  jobName: z.string(),
  partNumber: z.string(),
  partName: z.string(),
  occurredAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
};

export const tmminHenkatenSummarySchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...tmminHenkatenBase,
      kind: z.literal('HOSTED'),
      displayId: z.string(),
      supervisorStatus: approvalRouteStatusSchema,
      qcStatus: approvalRouteStatusSchema,
    })
    .strict(),
  z
    .object({
      ...tmminHenkatenBase,
      kind: z.literal('EXTERNAL'),
      displayId: z.string(),
      sourceVersion: z.number().int().positive(),
    })
    .strict(),
]);

export const tmminHenkatenPageSchema = z
  .object({ items: z.array(tmminHenkatenSummarySchema), pageInfo: pageInfoSchema })
  .strict();

export const externalHealthQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    supplierId: opaqueIdSchema.optional(),
    sourceEpoch: z.coerce.number().int().positive().optional(),
    outcome: z.enum(['ACCEPTED', 'DUPLICATE', 'REJECTED']).optional(),
    code: z.string().trim().min(1).max(100).optional(),
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
    lookup: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type ExternalHealthQuery = z.infer<typeof externalHealthQuerySchema>;

export const externalHealthSchema = z
  .object({
    generatedAt: utcTimestampSchema,
    totals: z
      .object({
        accepted: z.number().int().nonnegative(),
        duplicate: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        fresh: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
        stale: z.number().int().nonnegative(),
        noData: z.number().int().nonnegative(),
      })
      .strict(),
    suppliers: z.array(
      z
        .object({
          supplierId: opaqueIdSchema,
          supplierCode: z.string(),
          supplierName: z.string(),
          sourceEpoch: optimisticVersionSchema,
          clientId: opaqueIdSchema.nullable(),
          clientName: z.string().nullable(),
          clientActive: z.boolean().nullable(),
          lastSuccessfulIngestionAt: utcTimestampSchema.nullable(),
          freshness: z.enum(['FRESH', 'WARNING', 'STALE', 'NO_DATA']),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          id: opaqueIdSchema,
          supplierId: opaqueIdSchema,
          supplierName: z.string(),
          sourceEpoch: optimisticVersionSchema,
          outcome: z.enum(['ACCEPTED', 'DUPLICATE', 'REJECTED']),
          eventId: z.string().nullable(),
          sourceHenkatenId: z.string().nullable(),
          projectionId: opaqueIdSchema.nullable(),
          code: z.string().nullable(),
          correlationId: z.string(),
          occurredAt: utcTimestampSchema,
        })
        .strict(),
    ),
    pageInfo: pageInfoSchema,
  })
  .strict();
