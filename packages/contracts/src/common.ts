import { z } from 'zod';

import { publicErrorCodeSchema } from './enums.js';

export const CONTRACT_SCHEMA_VERSION = 1 as const;

export const opaqueIdSchema = z.string().uuid();
export type OpaqueId = z.infer<typeof opaqueIdSchema>;

export const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .overwrite((value) => new Date(value).toISOString());
export type UtcTimestamp = z.output<typeof utcTimestampSchema>;

export const correlationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export type CorrelationId = z.infer<typeof correlationIdSchema>;

export const optimisticVersionSchema = z.number().int().positive();
export type OptimisticVersion = z.infer<typeof optimisticVersionSchema>;

export const cursorSchema = z.string().min(1).max(512);
export type Cursor = z.infer<typeof cursorSchema>;

export const paginationRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PaginationRequest = z.input<typeof paginationRequestSchema>;

export const pageInfoSchema = z
  .object({
    nextCursor: cursorSchema.nullable(),
    hasNextPage: z.boolean(),
  })
  .strict();
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const fieldErrorSchema = z
  .object({
    path: z.string().min(1).max(512),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(1_000),
  })
  .strict();
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const problemDetailsSchema = z
  .object({
    type: z.string().url(),
    title: z.string().min(1).max(200),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1).max(2_000),
    code: publicErrorCodeSchema,
    correlationId: correlationIdSchema,
    fieldErrors: z.array(fieldErrorSchema).optional(),
  })
  .strict();
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
