import { z } from 'zod';

import {
  correlationIdSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  utcTimestampSchema,
} from './common.js';
import { domainEventTypeSchema, userRoleSchema } from './enums.js';

export const eventActorSchema = z
  .object({
    kind: z.enum(['USER', 'EXTERNAL_CLIENT', 'SYSTEM']),
    id: opaqueIdSchema.optional(),
    role: userRoleSchema.optional(),
  })
  .strict();
export type EventActor = z.infer<typeof eventActorSchema>;

export const domainEventEnvelopeSchema = z
  .object({
    eventId: opaqueIdSchema,
    eventType: domainEventTypeSchema,
    schemaVersion: z.number().int().positive(),
    aggregateType: z.string().min(1).max(100),
    aggregateId: opaqueIdSchema,
    aggregateVersion: optimisticVersionSchema,
    supplierId: opaqueIdSchema.nullable(),
    occurredAt: utcTimestampSchema,
    actor: eventActorSchema,
    correlationId: correlationIdSchema,
    causationId: opaqueIdSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;
