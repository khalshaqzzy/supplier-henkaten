import { z } from 'zod';

import {
  correlationIdSchema,
  opaqueIdSchema,
  pageInfoSchema,
  utcTimestampSchema,
} from './common.js';
import {
  approvalDecisionSchema,
  approvalRouteSchema,
  externalEventTypeSchema,
  henkatenCategorySchema,
  henkatenStatusSchema,
  ingestionResultStatusSchema,
} from './enums.js';

const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !/(password|secret|authorization|bearer)\s*[:=]/i.test(value), {
      message: 'Freeform text must not contain credentials or authorization data.',
    });
export const externalEventIdSchema = z.string().min(1).max(200);
const externalRefSchema = externalEventIdSchema;
const ipAddressSchema = z.union([z.ipv4(), z.ipv6()]);

export const createExternalClientRequestSchema = z
  .object({
    name: z.string().min(1).max(150),
    ipAllowlist: z.array(ipAddressSchema).max(50).default([]),
  })
  .strict();
export type CreateExternalClientRequest = z.infer<typeof createExternalClientRequestSchema>;

export const externalClientSchema = z
  .object({
    id: opaqueIdSchema,
    supplierId: opaqueIdSchema,
    clientId: z.string().min(16).max(100),
    name: z.string(),
    sourceEpoch: z.number().int().positive(),
    scopes: z.array(z.literal('henkaten:ingest')),
    ipAllowlist: z.array(ipAddressSchema),
    active: z.boolean(),
    validSecretCount: z.number().int().min(0).max(2),
    lastSuccessfulIngestionAt: utcTimestampSchema.nullable(),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const externalClientCredentialSchema = z
  .object({
    client: externalClientSchema,
    clientSecret: z.string().min(32),
  })
  .strict();

export const externalClientPageSchema = z
  .object({ items: z.array(externalClientSchema), pageInfo: pageInfoSchema })
  .strict();

export const externalClientActionRequestSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();

export const externalTokenRequestSchema = z
  .object({
    client_id: z.string().min(16).max(100),
    client_secret: z.string().min(32).max(500),
  })
  .strict();
export type ExternalTokenRequest = z.infer<typeof externalTokenRequestSchema>;

export const externalTokenResponseSchema = z
  .object({
    access_token: z.string().min(32),
    token_type: z.literal('Bearer'),
    expires_in: z.literal(900),
    scope: z.literal('henkaten:ingest'),
  })
  .strict();

const snapshotSchema = z.object({ externalId: externalRefSchema, name: safeText(200) }).strict();
const shiftSnapshotSchema = snapshotSchema
  .extend({
    businessDate: z.string().date(),
    timezone: z.string().min(1).max(100),
  })
  .strict();
const partSnapshotSchema = z.object({ number: safeText(100), name: safeText(200) }).strict();

export const externalDecisionSchema = z
  .object({
    route: approvalRouteSchema,
    decision: approvalDecisionSchema,
    actorRef: externalRefSchema,
    actorDisplayName: safeText(150).optional(),
    decidedAt: utcTimestampSchema,
    comment: safeText(1_000).optional(),
  })
  .strict();

const checklistSchema = z
  .object({
    templateVersion: externalRefSchema,
    allPassed: z.literal(true),
    items: z
      .array(
        z
          .object({
            externalId: externalRefSchema,
            label: safeText(500),
            answer: z.literal('YES'),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const objectChangeSchema = z
  .object({
    affectedObject: safeText(2_000),
    replacementObject: safeText(2_000),
    cause: safeText(2_000),
    detail: safeText(2_000),
  })
  .strict();

const manChangeSchema = z
  .object({
    replacedMpRef: externalRefSchema,
    replacedMpDisplayName: safeText(150).optional(),
    replacementMpRef: externalRefSchema,
    replacementMpDisplayName: safeText(150).optional(),
    affectedJob: snapshotSchema.optional(),
    replacementJob: snapshotSchema.optional(),
    cause: safeText(2_000),
    detail: safeText(2_000),
  })
  .strict();

const externalEventBaseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    eventId: externalRefSchema,
    sourceHenkatenId: externalRefSchema,
    sourceVersion: z.number().int().positive(),
    eventType: externalEventTypeSchema,
    status: henkatenStatusSchema,
    occurredAt: utcTimestampSchema,
    line: snapshotSchema,
    shift: shiftSnapshotSchema,
    job: snapshotSchema,
    part: partSnapshotSchema,
    checklist: checklistSchema,
    decisions: z.array(externalDecisionSchema).max(2),
    cancellationReason: safeText(1_000).optional(),
    metadata: z
      .object({
        sourceSystem: safeText(100),
        sourceCorrelationId: externalRefSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const externalHenkatenEventSchema = z
  .discriminatedUnion('changePoint', [
    externalEventBaseSchema
      .extend({ changePoint: z.literal('MAN'), change: manChangeSchema })
      .strict(),
    externalEventBaseSchema
      .extend({ changePoint: z.literal('MACHINE'), change: objectChangeSchema })
      .strict(),
    externalEventBaseSchema
      .extend({ changePoint: z.literal('MATERIAL'), change: objectChangeSchema })
      .strict(),
    externalEventBaseSchema
      .extend({ changePoint: z.literal('METHOD'), change: objectChangeSchema })
      .strict(),
  ])
  .superRefine((event, context) => {
    const expectedStatus =
      event.eventType === 'HENKATEN_OPENED' || event.eventType === 'HENKATEN_OPEN_UPDATED'
        ? 'OPEN'
        : event.eventType.replace('HENKATEN_', '');
    if (event.status !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Status must match eventType.',
      });
    }
    const supervisor = event.decisions.find(({ route }) => route === 'SUPERVISOR');
    const qc = event.decisions.find(({ route }) => route === 'QC');
    if (
      event.status === 'APPROVED' &&
      (supervisor?.decision !== 'APPROVED' || qc?.decision !== 'APPROVED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['decisions'],
        message: 'Approved events require approved Supervisor and QC decisions.',
      });
    }
    if (
      event.status === 'REJECTED' &&
      !event.decisions.some(({ decision }) => decision === 'REJECTED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['decisions'],
        message: 'Rejected events require at least one rejection.',
      });
    }
    if (event.status === 'CANCELLED' && !event.cancellationReason) {
      context.addIssue({
        code: 'custom',
        path: ['cancellationReason'],
        message: 'Cancelled events require a cancellation reason.',
      });
    }
  });
export type ExternalHenkatenEvent = z.infer<typeof externalHenkatenEventSchema>;

export const externalBatchRequestSchema = z
  .object({ events: z.array(z.unknown()).min(1).max(500) })
  .strict();
export type ExternalBatchRequest = z.infer<typeof externalBatchRequestSchema>;

export const ingestionResultSchema = z
  .object({
    ingestionId: opaqueIdSchema.nullable(),
    eventId: externalRefSchema,
    status: ingestionResultStatusSchema,
    code: z.string().nullable(),
    correlationId: correlationIdSchema,
  })
  .strict();

export const externalBatchResponseSchema = z
  .object({ results: z.array(ingestionResultSchema) })
  .strict();

export const ingestionStatusSchema = z
  .object({
    ingestionId: opaqueIdSchema,
    eventId: externalRefSchema,
    sourceHenkatenId: externalRefSchema,
    sourceVersion: z.number().int().positive(),
    eventType: externalEventTypeSchema,
    status: z.literal('ACCEPTED'),
    receivedAt: utcTimestampSchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const externalProjectionSchema = z
  .object({
    id: opaqueIdSchema,
    supplierId: opaqueIdSchema,
    sourceHenkatenId: externalRefSchema,
    sourceVersion: z.number().int().positive(),
    status: henkatenStatusSchema,
    category: henkatenCategorySchema,
    sourceMode: z.literal('EXTERNAL'),
    line: snapshotSchema,
    shift: shiftSnapshotSchema,
    job: snapshotSchema,
    part: partSnapshotSchema,
    occurredAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const externalProjectionPageSchema = z
  .object({ items: z.array(externalProjectionSchema), pageInfo: pageInfoSchema })
  .strict();

export const externalProjectionDetailSchema = externalProjectionSchema
  .extend({ events: z.array(ingestionStatusSchema) })
  .strict();
