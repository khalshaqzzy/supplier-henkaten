import { z } from 'zod';

import { henkatenCategorySchema } from './enums.js';
import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

/**
 * ARCHIVE moves the record to the inactive/archive list where it can be restored and keeps its
 * code reserved. PERMANENT removes it from every list; history stays intact and its code,
 * registration number, username or part number becomes available again.
 */
export const masterDeleteModeSchema = z.enum(['ARCHIVE', 'PERMANENT']);
export type MasterDeleteMode = z.infer<typeof masterDeleteModeSchema>;

export const masterDeleteKindSchema = z.enum(['LINE', 'JOB', 'MEMBER', 'PART', 'SHIFT_TEMPLATE']);
export type MasterDeleteKind = z.infer<typeof masterDeleteKindSchema>;

export const masterDeleteRequestSchema = z
  .object({ expectedVersion: optimisticVersionSchema, mode: masterDeleteModeSchema })
  .strict();
export type MasterDeleteRequest = z.infer<typeof masterDeleteRequestSchema>;

export const masterDeleteBlockingHenkatenSchema = z
  .object({
    id: opaqueIdSchema,
    identifier: z.string(),
    category: henkatenCategorySchema,
    lineCode: z.string(),
    shiftName: z.string(),
    jobName: z.string(),
    occurredAt: utcTimestampSchema,
  })
  .strict();

export const masterDeleteImpactSchema = z
  .object({
    jobs: z.number().int().nonnegative(),
    lineShifts: z.number().int().nonnegative(),
    lineShiftLabels: z.array(z.string()).max(50),
    clearedAssignments: z.number().int().nonnegative(),
    rotationSchedules: z.array(z.object({ id: opaqueIdSchema, name: z.string() }).strict()),
    accountUsername: z.string().nullable(),
    boardLayout: z.boolean(),
  })
  .strict();
export type MasterDeleteImpact = z.infer<typeof masterDeleteImpactSchema>;

export const masterDeletePreviewSchema = z
  .object({
    kind: masterDeleteKindSchema,
    resource: z
      .object({
        id: opaqueIdSchema,
        label: z.string(),
        active: z.boolean(),
        version: optimisticVersionSchema,
      })
      .strict(),
    canArchive: z.boolean(),
    canDelete: z.boolean(),
    openHenkatenTotal: z.number().int().nonnegative(),
    openHenkatens: z.array(masterDeleteBlockingHenkatenSchema).max(20),
    impact: masterDeleteImpactSchema,
  })
  .strict();
export type MasterDeletePreview = z.infer<typeof masterDeletePreviewSchema>;

export const masterDeleteResultSchema = z
  .object({
    kind: masterDeleteKindSchema,
    id: opaqueIdSchema,
    mode: masterDeleteModeSchema,
    impact: masterDeleteImpactSchema,
  })
  .strict();
export type MasterDeleteResult = z.infer<typeof masterDeleteResultSchema>;
