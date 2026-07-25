import { z } from 'zod';

import {
  capabilitySchema,
  identityRealmSchema,
  sessionPurposeSchema,
  sourceModeSchema,
  userRoleSchema,
} from './enums.js';
import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

const usernameSchema = z.string().trim().min(1).max(100);
const loginPasswordSchema = z.string().min(1).max(128);
export const newPasswordSchema = z.string().min(12).max(128);

export const supplierLoginRequestSchema = z
  .object({
    supplierCode: z.string().trim().min(1).max(50),
    username: usernameSchema,
    password: loginPasswordSchema,
  })
  .strict();
export type SupplierLoginRequest = z.infer<typeof supplierLoginRequestSchema>;

export const tmminLoginRequestSchema = z
  .object({
    username: usernameSchema,
    password: loginPasswordSchema,
  })
  .strict();
export type TmminLoginRequest = z.infer<typeof tmminLoginRequestSchema>;

export const sessionPrincipalSchema = z
  .object({
    userId: opaqueIdSchema,
    displayName: z.string().min(1).max(150),
    realm: identityRealmSchema,
    role: userRoleSchema,
    supplierId: opaqueIdSchema.optional(),
    purpose: sessionPurposeSchema,
    mustChangePassword: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const isTmminRole = value.role === 'TMMIN_ADMIN' || value.role === 'TMMIN_QUALITY';

    if (value.realm === 'TMMIN' && (!isTmminRole || value.supplierId !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'TMMIN principals require a TMMIN role and cannot have supplierId.',
      });
    }

    if (value.realm === 'SUPPLIER' && (isTmminRole || value.supplierId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Supplier principals require supplierId and a supplier role.',
      });
    }
  });
export type SessionPrincipal = z.infer<typeof sessionPrincipalSchema>;

export const supplierSessionContextSchema = z
  .object({
    id: opaqueIdSchema,
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(200),
    timezone: z.string().min(1).max(100),
    sourceMode: sourceModeSchema,
    sourceEpoch: optimisticVersionSchema,
  })
  .strict();

export const sessionResponseSchema = z
  .object({
    principal: sessionPrincipalSchema,
    capabilities: z.array(capabilitySchema),
    supplier: supplierSessionContextSchema.optional(),
    idleExpiresAt: utcTimestampSchema,
    absoluteExpiresAt: utcTimestampSchema,
    csrfToken: z.string().min(32).max(512),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.principal.realm === 'SUPPLIER' && !value.supplier) {
      context.addIssue({
        code: 'custom',
        path: ['supplier'],
        message: 'Supplier context is required.',
      });
    }
    if (value.principal.realm === 'TMMIN' && value.supplier) {
      context.addIssue({
        code: 'custom',
        path: ['supplier'],
        message: 'TMMIN session cannot include supplier context.',
      });
    }
  });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const passwordChangeRequestSchema = z
  .object({
    currentPassword: loginPasswordSchema,
    newPassword: newPasswordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password.',
  });
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;
