import { z } from 'zod';

import { henkatenCategorySchema, memberRoleSchema, userStatusSchema } from './enums.js';
import {
  cursorSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  pageInfoSchema,
  utcTimestampSchema,
} from './common.js';
import { temporaryCredentialSchema, usernameSchema } from './administration.js';

const nameSchema = z.string().trim().min(1).max(150);
const registrationNumberSchema = z.string().trim().min(1).max(100);
const displayOrderSchema = z.number().int().positive();
const activeFilterSchema = z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ACTIVE');
const searchSchema = z.string().trim().min(1).max(150).optional();
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const masterListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: searchSchema,
    active: activeFilterSchema,
  })
  .strict();
export type MasterListQuery = z.infer<typeof masterListQuerySchema>;

const memberBaseCreateSchema = z.object({
  fullName: nameSchema,
  registrationNumber: registrationNumberSchema,
});

export const createMemberRequestSchema = z.discriminatedUnion('role', [
  memberBaseCreateSchema.extend({ role: z.literal('MP') }).strict(),
  memberBaseCreateSchema
    .extend({ role: z.literal('SUPERVISOR'), username: usernameSchema })
    .strict(),
  memberBaseCreateSchema
    .extend({ role: z.literal('LINE_LEADER'), username: usernameSchema })
    .strict(),
  memberBaseCreateSchema.extend({ role: z.literal('QC'), username: usernameSchema }).strict(),
]);
export type CreateMemberRequest = z.infer<typeof createMemberRequestSchema>;

export const updateMemberRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    fullName: nameSchema.optional(),
    registrationNumber: registrationNumberSchema.optional(),
  })
  .strict()
  .refine(
    ({ fullName, registrationNumber }) =>
      fullName !== undefined || registrationNumber !== undefined,
    { message: 'At least one mutable field is required.' },
  );
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const memberAccountSchema = z
  .object({
    id: opaqueIdSchema,
    username: usernameSchema,
    status: userStatusSchema,
    mustChangePassword: z.boolean(),
    version: optimisticVersionSchema,
  })
  .strict();

export const memberPhotoSummarySchema = z
  .object({
    id: opaqueIdSchema,
    fullUrl: z.string().min(1),
    thumbnailUrl: z.string().min(1),
    version: optimisticVersionSchema,
  })
  .strict();

export const memberSchema = z
  .object({
    id: opaqueIdSchema,
    fullName: nameSchema,
    registrationNumber: registrationNumberSchema,
    role: memberRoleSchema,
    active: z.boolean(),
    initials: z.string().min(1).max(4),
    photo: memberPhotoSummarySchema.nullable(),
    account: memberAccountSchema.optional(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const memberCredentialResponseSchema = z
  .object({
    member: memberSchema,
    credential: temporaryCredentialSchema.optional(),
  })
  .strict();

export const memberPageSchema = z
  .object({ items: z.array(memberSchema), pageInfo: pageInfoSchema })
  .strict();

export const updateMemberAccountRequestSchema = z
  .object({ expectedVersion: optimisticVersionSchema, username: usernameSchema })
  .strict();

export const createLineRequestSchema = z
  .object({ code: z.string().trim().min(1).max(100), name: nameSchema })
  .strict();
export const updateLineRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    code: z.string().trim().min(1).max(100).optional(),
    name: nameSchema.optional(),
  })
  .strict()
  .refine(({ code, name }) => code !== undefined || name !== undefined, {
    message: 'At least one mutable field is required.',
  });
export const lineSchema = z
  .object({
    id: opaqueIdSchema,
    code: z.string().min(1).max(100),
    name: nameSchema,
    displayOrder: displayOrderSchema,
    active: z.boolean(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();
export const linePageSchema = z
  .object({ items: z.array(lineSchema), pageInfo: pageInfoSchema })
  .strict();

export const createJobRequestSchema = z.object({ name: nameSchema }).strict();
export const updateJobRequestSchema = z
  .object({ expectedVersion: optimisticVersionSchema, name: nameSchema })
  .strict();
export const jobSchema = z
  .object({
    id: opaqueIdSchema,
    lineId: opaqueIdSchema,
    name: nameSchema,
    displayOrder: displayOrderSchema,
    active: z.boolean(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();
export const jobPageSchema = z
  .object({ items: z.array(jobSchema), pageInfo: pageInfoSchema })
  .strict();

export const createPartRequestSchema = z
  .object({
    partNumber: z.string().trim().min(1).max(100),
    partName: z.string().trim().min(1).max(200),
  })
  .strict();
export const updatePartRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    partNumber: z.string().trim().min(1).max(100).optional(),
    partName: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine(({ partNumber, partName }) => partNumber !== undefined || partName !== undefined, {
    message: 'At least one mutable field is required.',
  });
export const partSchema = z
  .object({
    id: opaqueIdSchema,
    partNumber: z.string().min(1).max(100),
    partName: z.string().min(1).max(200),
    active: z.boolean(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();
export const partPageSchema = z
  .object({ items: z.array(partSchema), pageInfo: pageInfoSchema })
  .strict();

export const createShiftTemplateRequestSchema = z
  .object({
    name: nameSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    timezone: z.string().trim().min(1).max(100),
  })
  .strict();
export const updateShiftTemplateRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema,
    name: nameSchema.optional(),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    ({ name, startTime, endTime, timezone }) =>
      name !== undefined ||
      startTime !== undefined ||
      endTime !== undefined ||
      timezone !== undefined,
    { message: 'At least one mutable field is required.' },
  );
export const shiftTemplateSchema = z
  .object({
    id: opaqueIdSchema,
    name: nameSchema,
    displayOrder: displayOrderSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    timezone: z.string().min(1).max(100),
    crossesMidnight: z.boolean(),
    active: z.boolean(),
    version: optimisticVersionSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();
export const shiftTemplatePageSchema = z
  .object({ items: z.array(shiftTemplateSchema), pageInfo: pageInfoSchema })
  .strict();

export const reorderRequestSchema = z
  .object({
    items: z
      .array(z.object({ id: opaqueIdSchema, expectedVersion: optimisticVersionSchema }).strict())
      .min(1)
      .max(500),
  })
  .strict();

export const checklistItemInputSchema = z
  .object({ label: z.string().trim().min(1).max(500) })
  .strict();
export const updateChecklistDraftRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema.optional(),
    items: z.array(checklistItemInputSchema).max(100),
  })
  .strict();
export const checklistItemSchema = z
  .object({
    id: opaqueIdSchema,
    label: z.string().min(1).max(500),
    displayOrder: displayOrderSchema,
  })
  .strict();
export const checklistDraftSchema = z
  .object({
    templateId: opaqueIdSchema,
    category: henkatenCategorySchema,
    active: z.boolean(),
    items: z.array(checklistItemSchema),
    version: optimisticVersionSchema,
  })
  .strict();
export const checklistVersionSchema = z
  .object({
    id: opaqueIdSchema,
    category: henkatenCategorySchema,
    versionNumber: optimisticVersionSchema,
    publishedAt: utcTimestampSchema,
    items: z.array(checklistItemSchema).min(1),
  })
  .strict();

export const assignmentMutationRequestSchema = z
  .object({
    memberId: opaqueIdSchema,
    expectedAssignmentVersion: optimisticVersionSchema.optional(),
  })
  .strict();
export const assignmentMoveRequestSchema = z
  .object({
    memberId: opaqueIdSchema,
    fromResourceId: opaqueIdSchema,
    expectedSourceVersion: optimisticVersionSchema,
    expectedTargetVersion: optimisticVersionSchema.optional(),
  })
  .strict();
export const assignmentRemoveRequestSchema = z
  .object({ expectedAssignmentVersion: optimisticVersionSchema })
  .strict();

const assignmentEntrySchema = z
  .object({
    id: opaqueIdSchema,
    resourceId: opaqueIdSchema,
    memberId: opaqueIdSchema,
    version: optimisticVersionSchema,
  })
  .strict();
export const defaultAssignmentsSchema = z
  .object({
    version: optimisticVersionSchema,
    supervisors: z.array(assignmentEntrySchema),
    lineLeaders: z.array(assignmentEntrySchema),
    mps: z.array(assignmentEntrySchema),
  })
  .strict();
