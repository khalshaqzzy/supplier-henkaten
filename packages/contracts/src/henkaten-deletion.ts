import { z } from 'zod';
import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

export const henkatenDeletionPreviewSchema = z
  .object({
    supplierCode: z.string(),
    hosted: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const deleteHenkatenRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const deleteSupplierHenkatensRequestSchema = z
  .object({
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    supplierCode: z.string().trim().min(1).max(50),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const henkatenDeletionResultSchema = z
  .object({
    commandId: opaqueIdSchema,
    deletedAt: utcTimestampSchema,
    hosted: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type HenkatenDeletionPreview = z.infer<typeof henkatenDeletionPreviewSchema>;
export type DeleteHenkatenRequest = z.infer<typeof deleteHenkatenRequestSchema>;
export type DeleteSupplierHenkatensRequest = z.infer<typeof deleteSupplierHenkatensRequestSchema>;
