import { z } from 'zod';

import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

export const pcrStatusSchema = z.enum(['PENDING', 'PCR', 'NO_PCR', 'REVIEW']);
export type PcrStatus = z.infer<typeof pcrStatusSchema>;

export const pcrAssessmentSchema = z
  .object({
    status: pcrStatusSchema,
    decisionSource: z.enum(['AI', 'TMMIN', 'SEED']).nullable(),
    assessment: z.string().nullable(),
    version: optimisticVersionSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();
export type PcrAssessment = z.infer<typeof pcrAssessmentSchema>;

export const pcrCorrectionRequestSchema = z
  .object({
    status: z.enum(['PCR', 'NO_PCR']),
    reason: z.string().trim().min(10).max(2_000),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type PcrCorrectionRequest = z.infer<typeof pcrCorrectionRequestSchema>;

export const pcrRecordKindSchema = z.enum(['HOSTED', 'EXTERNAL']);
export const pcrRecordReferenceSchema = z
  .object({
    kind: pcrRecordKindSchema,
    supplierId: opaqueIdSchema,
    recordId: opaqueIdSchema,
  })
  .strict();
