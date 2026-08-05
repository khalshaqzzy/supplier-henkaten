import { z } from 'zod';

import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

export const installationIdSchema = opaqueIdSchema;

export const pushSubscriptionStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);

export const pushConfigSchema = z
  .object({
    enabled: z.boolean(),
    mandatory: z.boolean(),
    applicationServerKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{40,512}$/)
      .nullable(),
    permissionGuidance: z
      .object({
        explicitGestureRequired: z.literal(true),
        iosHomeScreenRequired: z.literal(true),
        minimumIosVersion: z.literal('16.4'),
      })
      .strict(),
    subscription: z
      .object({
        id: opaqueIdSchema,
        status: pushSubscriptionStatusSchema,
        expirationAt: utcTimestampSchema.nullable(),
        lastAcceptedAt: utcTimestampSchema.nullable(),
        version: optimisticVersionSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PushConfig = z.infer<typeof pushConfigSchema>;

export const createPushSubscriptionRequestSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(4_096)
      .refine((value) => new URL(value).protocol === 'https:', 'Endpoint must use HTTPS.'),
    expirationTime: z.number().int().nonnegative().max(8_640_000_000_000_000).nullable(),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{20,512}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{8,256}$/),
      })
      .strict(),
  })
  .strict();
export type CreatePushSubscriptionRequest = z.infer<typeof createPushSubscriptionRequestSchema>;

export const pushSubscriptionSchema = z
  .object({
    id: opaqueIdSchema,
    status: pushSubscriptionStatusSchema,
    expirationAt: utcTimestampSchema.nullable(),
    lastAcceptedAt: utcTimestampSchema.nullable(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const deletePushSubscriptionRequestSchema = z
  .object({ expectedVersion: optimisticVersionSchema })
  .strict();
export type DeletePushSubscriptionRequest = z.infer<typeof deletePushSubscriptionRequestSchema>;
