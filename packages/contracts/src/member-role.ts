import { z } from 'zod';
import { opaqueIdSchema, optimisticVersionSchema } from './common.js';
import { memberSchema } from './master-data.js';

export const operationalMemberRoleSchema = z.enum(['LINE_LEADER', 'SUPERVISOR', 'QC']);
export const memberRolePreviewRequestSchema = z
  .object({ role: operationalMemberRoleSchema })
  .strict();
export const memberRoleDependencySchema = z.object({
  kind: z.enum(['LINE_SHIFT', 'DEFAULT_LINE', 'HENKATEN']),
  id: opaqueIdSchema,
  label: z.string(),
  detail: z.string(),
  version: optimisticVersionSchema,
  active: z.boolean(),
});
export const memberRolePreviewSchema = z.object({
  member: memberSchema,
  role: operationalMemberRoleSchema,
  revision: z.string(),
  dependencies: z.array(memberRoleDependencySchema),
  candidates: z.array(
    z.object({
      id: opaqueIdSchema,
      fullName: z.string(),
      registrationNumber: z.string().nullable(),
      available: z.boolean(),
      unavailableReason: z.string().nullable(),
    }),
  ),
  pendingQcCount: z.number().int().nonnegative(),
  blockers: z.array(z.string()),
});
export const changeMemberRoleRequestSchema = z
  .object({
    role: operationalMemberRoleSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(500),
    handovers: z
      .array(
        z
          .object({
            kind: memberRoleDependencySchema.shape.kind,
            id: opaqueIdSchema,
            replacementMemberId: opaqueIdSchema,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type MemberRolePreview = z.infer<typeof memberRolePreviewSchema>;
export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleRequestSchema>;
export const changeMemberRoleResponseSchema = z.object({
  member: memberSchema,
  commandId: opaqueIdSchema,
});
