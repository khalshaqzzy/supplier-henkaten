import { z } from 'zod';
import { opaqueIdSchema, optimisticVersionSchema } from './common.js';

const shiftReference = z
  .object({ id: opaqueIdSchema, expectedVersion: optimisticVersionSchema })
  .strict();
export const swapShiftTimesRequestSchema = z
  .object({ first: shiftReference, second: shiftReference })
  .strict()
  .refine((value) => value.first.id !== value.second.id, {
    message: 'Pilih dua shift yang berbeda.',
  });
export const swapShiftTimesResultSchema = z
  .object({ swapped: z.literal(2), affectedLines: z.number().int().nonnegative() })
  .strict();
export const deletePartsPreviewSchema = z
  .object({ count: z.number().int().nonnegative(), revision: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const deletePartsRequestSchema = z
  .object({ revision: deletePartsPreviewSchema.shape.revision })
  .strict();
export const deletePartsResultSchema = z
  .object({ deleted: z.number().int().nonnegative() })
  .strict();
export type SwapShiftTimesRequest = z.infer<typeof swapShiftTimesRequestSchema>;
export type DeletePartsRequest = z.infer<typeof deletePartsRequestSchema>;
