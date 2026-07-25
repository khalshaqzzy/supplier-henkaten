import { z } from 'zod';

import {
  hostedPreparationStatusSchema,
  sourceModeSchema,
  userRoleSchema,
  userStatusSchema,
} from './enums.js';
import {
  cursorSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  pageInfoSchema,
  utcTimestampSchema,
} from './common.js';

export const usernameSchema = z.string().trim().min(1).max(100);
export const displayNameSchema = z.string().trim().min(1).max(150);
export const supplierCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const expectedVersionSchema = z
  .object({ expectedVersion: optimisticVersionSchema })
  .strict();

export const temporaryCredentialSchema = z
  .object({
    username: usernameSchema,
    temporaryPassword: z.string().min(20).max(128),
  })
  .strict();

export const userSummarySchema = z
  .object({
    id: opaqueIdSchema,
    supplierId: opaqueIdSchema.nullable(),
    role: userRoleSchema,
    username: usernameSchema,
    displayName: displayNameSchema,
    status: userStatusSchema,
    mustChangePassword: z.boolean(),
    protectedBootstrapAdmin: z.boolean(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const createTmminQualityRequestSchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
  })
  .strict();
export type CreateTmminQualityRequest = z.infer<typeof createTmminQualityRequestSchema>;

export const userCredentialResponseSchema = z
  .object({
    user: userSummarySchema,
    credential: temporaryCredentialSchema,
  })
  .strict();

const supplierAdminIdentitySchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
  })
  .strict();

export const createSupplierRequestSchema = z.discriminatedUnion('sourceMode', [
  z
    .object({
      sourceMode: z.literal('HOSTED'),
      code: supplierCodeSchema,
      name: z.string().trim().min(1).max(200),
      timezone: z.string().trim().min(1).max(100),
      supplierAdmin: supplierAdminIdentitySchema,
    })
    .strict(),
  z
    .object({
      sourceMode: z.literal('EXTERNAL'),
      code: supplierCodeSchema,
      name: z.string().trim().min(1).max(200),
      timezone: z.string().trim().min(1).max(100),
    })
    .strict(),
]);
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

export const supplierSummarySchema = z
  .object({
    id: opaqueIdSchema,
    code: supplierCodeSchema,
    name: z.string().min(1).max(200),
    timezone: z.string().min(1).max(100),
    sourceMode: sourceModeSchema,
    sourceEpoch: optimisticVersionSchema,
    active: z.boolean(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const supplierCredentialResponseSchema = z
  .object({
    supplier: supplierSummarySchema,
    supplierAdmin: userSummarySchema.optional(),
    credential: temporaryCredentialSchema.optional(),
  })
  .strict();

export const updateSupplierRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.timezone !== undefined, {
    message: 'At least one mutable field is required.',
  });
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const replaceSupplierAdminRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    username: usernameSchema,
    displayName: displayNameSchema,
  })
  .strict();
export type ReplaceSupplierAdminRequest = z.infer<typeof replaceSupplierAdminRequestSchema>;

export const startHostedPreparationRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    reason: z.string().trim().min(10).max(1_000),
    privacyAcknowledged: z.literal(true),
    supplierAdmin: supplierAdminIdentitySchema,
  })
  .strict();
export type StartHostedPreparationRequest = z.infer<typeof startHostedPreparationRequestSchema>;

export const cancelHostedPreparationRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    reason: z.string().trim().min(10).max(1_000),
  })
  .strict();
export type CancelHostedPreparationRequest = z.infer<typeof cancelHostedPreparationRequestSchema>;

export const sourceCutoverRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    targetMode: sourceModeSchema,
    reason: z.string().trim().min(10).max(1_000),
    privacyAcknowledged: z.literal(true),
  })
  .strict();
export type SourceCutoverRequest = z.infer<typeof sourceCutoverRequestSchema>;

export const sourcePreflightResponseSchema = z
  .object({
    supplierId: opaqueIdSchema,
    currentMode: sourceModeSchema,
    targetMode: sourceModeSchema,
    eligible: z.boolean(),
    blockers: z.array(
      z
        .object({
          contributor: z.string().min(1).max(100),
          code: z.string().min(1).max(100),
          detail: z.string().min(1).max(500),
        })
        .strict(),
    ),
  })
  .strict();

export const hostedPreparationSchema = z
  .object({
    id: opaqueIdSchema,
    supplierId: opaqueIdSchema,
    adminUserId: opaqueIdSchema,
    sourceEpoch: optimisticVersionSchema,
    status: hostedPreparationStatusSchema,
    reason: z.string().min(1).max(1_000),
    privacyAcknowledgedAt: utcTimestampSchema,
    startedAt: utcTimestampSchema,
    version: optimisticVersionSchema,
  })
  .strict();

export const listQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const supplierPageSchema = z
  .object({ items: z.array(supplierSummarySchema), pageInfo: pageInfoSchema })
  .strict();

export const userPageSchema = z
  .object({ items: z.array(userSummarySchema), pageInfo: pageInfoSchema })
  .strict();
