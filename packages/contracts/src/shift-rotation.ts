import { z } from 'zod';

import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const MAX_SHIFTS_PER_ROTATION = 10;

const rotationShiftIdsSchema = z
  .array(opaqueIdSchema)
  .min(2)
  .max(MAX_SHIFTS_PER_ROTATION)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Setiap shift hanya boleh muncul satu kali.',
  });

/**
 * Weekly rotation: on `dayOfWeek` at `executeTime` (in `timezone`), every shift takes the working
 * times of the next shift in `shiftTemplateIds`; the last shift takes the first one's times.
 */
export const createShiftRotationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    shiftTemplateIds: rotationShiftIdsSchema,
    dayOfWeek: z.number().int().min(1).max(7),
    executeTime: timeSchema,
    timezone: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateShiftRotationRequest = z.input<typeof createShiftRotationRequestSchema>;

export const updateShiftRotationRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    name: z.string().trim().min(1).max(150).optional(),
    shiftTemplateIds: rotationShiftIdsSchema.optional(),
    dayOfWeek: z.number().int().min(1).max(7).optional(),
    executeTime: timeSchema.optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type UpdateShiftRotationRequest = z.infer<typeof updateShiftRotationRequestSchema>;

export const shiftRotationExecutionSchema = z
  .object({
    id: opaqueIdSchema,
    scheduledForAt: utcTimestampSchema,
    executedAt: utcTimestampSchema,
    status: z.enum(['SUCCESS', 'SKIPPED']),
    trigger: z.enum(['SCHEDULE', 'MANUAL']),
    affectedLines: z.number().int().nonnegative(),
    message: z.string().nullable(),
  })
  .strict();

export const shiftRotationShiftSchema = z
  .object({
    id: opaqueIdSchema,
    name: z.string(),
    active: z.boolean(),
    available: z.boolean(),
  })
  .strict();

export const shiftRotationSchema = z
  .object({
    id: opaqueIdSchema,
    name: z.string(),
    enabled: z.boolean(),
    shifts: z.array(shiftRotationShiftSchema),
    dayOfWeek: z.number().int().min(1).max(7),
    executeTime: timeSchema,
    timezone: z.string(),
    nextRunAt: utcTimestampSchema.nullable(),
    lastRunAt: utcTimestampSchema.nullable(),
    lastRunStatus: z.enum(['SUCCESS', 'SKIPPED']).nullable(),
    lastRunMessage: z.string().nullable(),
    executions: z.array(shiftRotationExecutionSchema).max(10),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();
export type ShiftRotation = z.infer<typeof shiftRotationSchema>;

export const shiftRotationListSchema = z.object({ items: z.array(shiftRotationSchema) }).strict();

export const runShiftRotationRequestSchema = z
  .object({ expectedVersion: optimisticVersionSchema })
  .strict();

export const runShiftRotationResultSchema = z
  .object({
    rotation: shiftRotationSchema,
    execution: shiftRotationExecutionSchema,
  })
  .strict();
