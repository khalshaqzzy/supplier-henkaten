import { z } from 'zod';
import { opaqueIdSchema, utcTimestampSchema } from './common.js';

export const skillCategorySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const tanokoLevelSchema = z.number().int().min(1).max(4).nullable();
export const tanokoMappingSchema = z
  .object({
    memberId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    level: tanokoLevelSchema,
    version: z.number().int().positive(),
    updatedAt: utcTimestampSchema,
  })
  .strict();
export const tanokoMatrixSchema = z
  .object({
    canEdit: z.boolean(),
    members: z.array(
      z.object({ id: opaqueIdSchema, name: z.string(), active: z.boolean() }).strict(),
    ),
    jobs: z.array(
      z
        .object({
          id: opaqueIdSchema,
          name: z.string(),
          lineId: opaqueIdSchema,
          lineName: z.string(),
          lineCode: z.string(),
          category: skillCategorySchema.nullable(),
          active: z.boolean(),
        })
        .strict(),
    ),
    mappings: z.array(tanokoMappingSchema),
  })
  .strict();
export const tanokoSaveSchema = z
  .object({
    expectedVersion: z.number().int().positive().nullable(),
    level: tanokoLevelSchema,
    note: z.string().trim().max(500).default(''),
  })
  .strict();
export const tanokoHistoryQuerySchema = z
  .object({
    cursor: opaqueIdSchema.optional(),
    search: z.string().trim().max(150).optional(),
    lineId: opaqueIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export const tanokoHistorySchema = z
  .object({
    items: z.array(
      z
        .object({
          id: opaqueIdSchema,
          memberName: z.string(),
          jobName: z.string(),
          lineName: z.string(),
          previousLevel: tanokoLevelSchema,
          level: tanokoLevelSchema,
          actorName: z.string(),
          actorRole: z.string(),
          note: z.string(),
          createdAt: utcTimestampSchema,
        })
        .strict(),
    ),
    nextCursor: opaqueIdSchema.nullable(),
  })
  .strict();
export type TanokoMatrix = z.infer<typeof tanokoMatrixSchema>;
export type TanokoMapping = z.infer<typeof tanokoMappingSchema>;
export type TanokoSave = z.infer<typeof tanokoSaveSchema>;
export type TanokoHistoryQuery = z.infer<typeof tanokoHistoryQuerySchema>;
export type SkillCategory = z.infer<typeof skillCategorySchema>;
