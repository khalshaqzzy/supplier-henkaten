import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  CreateExternalClientRequest,
  ExternalHenkatenEvent,
  ExternalTokenRequest,
} from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';

import type { MutationContext } from '../administration/mutation-context.js';
import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { notFound, versionConflict } from '../administration/user-admin.service.js';
import { PasswordService } from '../auth/password.service.js';
import { ProblemException } from '../common/problem.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import { ExternalRateLimiterService } from './external-rate-limiter.service.js';

export type ExternalPrincipal = {
  tokenId: string;
  clientId: string;
  supplierId: string;
  sourceEpoch: number;
  scopes: string[];
};

@Injectable()
export class ExternalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    private readonly limiter: ExternalRateLimiterService,
  ) {}

  async createClient(
    supplierId: string,
    input: CreateExternalClientRequest,
    context: MutationContext,
  ) {
    const secret = this.secret();
    const secretHash = await this.passwords.hash(secret);
    const created = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      const sourceEpoch =
        supplier.sourceMode === 'EXTERNAL' ? supplier.sourceEpoch : supplier.sourceEpoch + 1;
      const client = await tx.externalApiClient.create({
        data: {
          supplierId,
          clientId: `ext_${randomBytes(24).toString('base64url')}`,
          name: input.name.trim(),
          sourceEpoch,
          scopes: ['henkaten:ingest'],
          ipAllowlist: input.ipAllowlist,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
          secrets: {
            create: {
              secretHash,
              lastFour: secret.slice(-4),
              createdById: context.actorUserId,
            },
          },
        },
        include: { secrets: true },
      });
      await this.audit.write(
        externalAudit(context, supplierId, 'EXTERNAL_CLIENT_CREATED', client.id, {
          clientId: client.clientId,
          sourceEpoch,
          ipAllowlistCount: input.ipAllowlist.length,
        }),
        tx,
      );
      return client;
    });
    return { client: presentClient(created), clientSecret: secret };
  }

  async listClients(supplierId: string, limit: number, cursor?: string) {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.externalApiClient.findMany({
      where: { supplierId },
      include: { secrets: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map(presentClient),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)!.id) : null,
      },
    };
  }

  async rotateClient(
    supplierId: string,
    id: string,
    expectedVersion: number,
    context: MutationContext,
  ) {
    const secret = this.secret();
    const secretHash = await this.passwords.hash(secret);
    const client = await runSerializable(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExternalApiClient" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.externalApiClient.findFirst({
        where: { id, supplierId, status: 'ACTIVE' },
        include: { secrets: true },
      });
      if (!current) throw notFound('External API client');
      if (current.version !== expectedVersion) throw versionConflict();
      const active = current.secrets.filter(
        ({ revokedAt, expiresAt }) => !revokedAt && (!expiresAt || expiresAt > new Date()),
      );
      if (active.length >= 2) {
        throw new ProblemException({
          status: 409,
          code: 'CAPACITY_EXCEEDED',
          title: 'Secret rotation limit reached',
          detail: 'Revoke an existing secret before issuing another rotation secret.',
        });
      }
      await tx.externalApiSecret.create({
        data: {
          clientId: id,
          secretHash,
          lastFour: secret.slice(-4),
          createdById: context.actorUserId,
        },
      });
      const updated = await tx.externalApiClient.update({
        where: { id },
        data: { version: { increment: 1 }, updatedById: context.actorUserId },
        include: { secrets: true },
      });
      await this.audit.write(
        externalAudit(context, supplierId, 'EXTERNAL_CLIENT_SECRET_ROTATED', id),
        tx,
      );
      return updated;
    });
    return { client: presentClient(client), clientSecret: secret };
  }

  async revokeClient(
    supplierId: string,
    id: string,
    expectedVersion: number,
    context: MutationContext,
  ) {
    return runSerializable(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExternalApiClient" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.externalApiClient.findFirst({ where: { id, supplierId } });
      if (!current) throw notFound('External API client');
      if (current.version !== expectedVersion) throw versionConflict();
      const now = new Date();
      await Promise.all([
        tx.externalApiSecret.updateMany({
          where: { clientId: id, revokedAt: null },
          data: { revokedAt: now },
        }),
        tx.externalAccessToken.updateMany({
          where: { clientId: id, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
      const updated = await tx.externalApiClient.update({
        where: { id },
        data: {
          status: 'REVOKED',
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
        include: { secrets: true },
      });
      await this.audit.write(externalAudit(context, supplierId, 'EXTERNAL_CLIENT_REVOKED', id), tx);
      return presentClient(updated);
    });
  }

  async token(input: ExternalTokenRequest, ip: string, correlationId: string) {
    const rate = this.limiter.token(input.client_id, ip);
    if (!rate.allowed) throw rateLimited();
    const client = await this.prisma.externalApiClient.findUnique({
      where: { clientId: input.client_id },
      include: { secrets: true, supplier: true },
    });
    const validClient =
      client?.status === 'ACTIVE' &&
      client.supplier.active &&
      client.supplier.sourceMode === 'EXTERNAL' &&
      client.sourceEpoch === client.supplier.sourceEpoch &&
      externalIpAllowed(client.ipAllowlist, ip);
    let verified = false;
    if (validClient && client) {
      const activeSecrets = client.secrets.filter(
        ({ revokedAt, expiresAt }) => !revokedAt && (!expiresAt || expiresAt > new Date()),
      );
      for (const secret of activeSecrets) {
        if (await this.passwords.verify(secret.secretHash, input.client_secret)) {
          verified = true;
          break;
        }
      }
    } else {
      await this.passwords.verifyDummy(input.client_secret);
    }
    if (!client || !validClient || !verified) {
      await this.audit.write({
        actorKind: 'EXTERNAL_CLIENT',
        ...(client ? { supplierId: client.supplierId } : {}),
        action: 'EXTERNAL_TOKEN_DENIED',
        resourceType: 'ExternalApiClient',
        ...(client ? { resourceId: client.id } : {}),
        changeSummary: { safeReason: 'INVALID_CLIENT_CREDENTIAL' },
        correlationId,
        sourceIp: ip,
        result: 'FAILURE',
      });
      throw authenticationFailed();
    }
    const rawToken = `eat_${randomBytes(32).toString('base64url')}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.externalAccessToken.create({
        data: {
          clientId: client.id,
          supplierId: client.supplierId,
          sourceEpoch: client.sourceEpoch,
          tokenHash: tokenHash(rawToken),
          scopes: client.scopes,
          sourceIp: ip,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      await this.audit.write(
        {
          actorKind: 'EXTERNAL_CLIENT',
          supplierId: client.supplierId,
          action: 'EXTERNAL_TOKEN_ISSUED',
          resourceType: 'ExternalApiClient',
          resourceId: client.id,
          correlationId,
          sourceIp: ip,
          sourceMode: 'EXTERNAL',
          sourceEpoch: client.sourceEpoch,
        },
        tx,
      );
    });
    return {
      response: {
        access_token: rawToken,
        token_type: 'Bearer' as const,
        expires_in: 900 as const,
        scope: 'henkaten:ingest' as const,
      },
      rate,
    };
  }

  async authenticate(authorization: string | undefined, ip: string): Promise<ExternalPrincipal> {
    if (!authorization?.startsWith('Bearer ')) throw authenticationFailed();
    const rawToken = authorization.slice('Bearer '.length);
    const token = await this.prisma.externalAccessToken.findUnique({
      where: { tokenHash: tokenHash(rawToken) },
    });
    const [client, supplier] = token
      ? await Promise.all([
          this.prisma.externalApiClient.findUnique({ where: { id: token.clientId } }),
          this.prisma.supplier.findUnique({ where: { id: token.supplierId } }),
        ])
      : [null, null];
    if (
      !token ||
      !client ||
      !supplier ||
      token.revokedAt ||
      token.expiresAt <= new Date() ||
      client.status !== 'ACTIVE' ||
      !supplier.active ||
      supplier.sourceMode !== 'EXTERNAL' ||
      token.sourceEpoch !== supplier.sourceEpoch ||
      client.sourceEpoch !== supplier.sourceEpoch ||
      !token.scopes.includes('henkaten:ingest') ||
      !externalIpAllowed(client.ipAllowlist, ip)
    ) {
      throw authenticationFailed();
    }
    return {
      tokenId: token.id,
      clientId: token.clientId,
      supplierId: token.supplierId,
      sourceEpoch: token.sourceEpoch,
      scopes: token.scopes,
    };
  }

  consumeIngestLimit(clientId: string) {
    const result = this.limiter.ingest(clientId);
    if (!result.allowed) throw rateLimited();
    return result;
  }

  async ingest(
    principal: ExternalPrincipal,
    event: ExternalHenkatenEvent,
    correlationId: string,
    ip: string,
  ) {
    const payloadHash = createHash('sha256').update(canonicalizeExternalJson(event)).digest('hex');
    try {
      return await runSerializable(this.prisma, async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${principal.supplierId}::uuid FOR UPDATE`;
        const supplier = await tx.supplier.findUnique({ where: { id: principal.supplierId } });
        if (
          !supplier?.active ||
          supplier.sourceMode !== 'EXTERNAL' ||
          supplier.sourceEpoch !== principal.sourceEpoch
        ) {
          throw sourceMismatch();
        }
        const duplicate = await tx.externalIngestionEvent.findUnique({
          where: {
            supplierId_sourceEpoch_eventId: {
              supplierId: principal.supplierId,
              sourceEpoch: principal.sourceEpoch,
              eventId: event.eventId,
            },
          },
        });
        if (duplicate) {
          if (duplicate.payloadHash !== payloadHash) throw idempotencyConflict();
          return result(duplicate.id, event.eventId, 'DUPLICATE', correlationId);
        }
        await tx.$queryRaw`
          SELECT id FROM "ExternalHenkatenProjection"
          WHERE "supplierId" = ${principal.supplierId}::uuid
            AND "sourceEpoch" = ${principal.sourceEpoch}
            AND "sourceHenkatenId" = ${event.sourceHenkatenId}
          FOR UPDATE
        `;
        const current = await tx.externalHenkatenProjection.findUnique({
          where: {
            supplierId_sourceEpoch_sourceHenkatenId: {
              supplierId: principal.supplierId,
              sourceEpoch: principal.sourceEpoch,
              sourceHenkatenId: event.sourceHenkatenId,
            },
          },
        });
        assertExternalOrdering(current, event);
        const projection = current
          ? await tx.externalHenkatenProjection.update({
              where: { id: current.id },
              data: projectionData(event),
            })
          : await tx.externalHenkatenProjection.create({
              data: {
                supplierId: principal.supplierId,
                sourceEpoch: principal.sourceEpoch,
                sourceHenkatenId: event.sourceHenkatenId,
                ...projectionData(event),
              },
            });
        const ingestion = await tx.externalIngestionEvent.create({
          data: {
            supplierId: principal.supplierId,
            clientId: principal.clientId,
            sourceEpoch: principal.sourceEpoch,
            eventId: event.eventId,
            sourceHenkatenId: event.sourceHenkatenId,
            sourceVersion: event.sourceVersion,
            eventType: event.eventType,
            payloadHash,
            canonicalPayload: event,
            correlationId,
            projectionId: projection.id,
          },
        });
        await this.applyWarning(tx, principal.supplierId, projection, event);
        await tx.externalApiClient.update({
          where: { id: principal.clientId },
          data: { lastSuccessfulIngestionAt: new Date() },
        });
        await this.audit.write(
          {
            actorKind: 'EXTERNAL_CLIENT',
            supplierId: principal.supplierId,
            action: 'EXTERNAL_INGEST_ACCEPTED',
            resourceType: 'ExternalIngestionEvent',
            resourceId: ingestion.id,
            changeSummary: {
              eventId: event.eventId,
              sourceHenkatenId: event.sourceHenkatenId,
              sourceVersion: event.sourceVersion,
              eventType: event.eventType,
            },
            correlationId,
            sourceIp: ip,
            sourceMode: 'EXTERNAL',
            sourceEpoch: principal.sourceEpoch,
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            eventType: 'EXTERNAL_PROJECTION_UPDATED',
            aggregateType: 'ExternalHenkatenProjection',
            aggregateId: projection.id,
            aggregateVersion: projection.sourceVersion,
            supplierId: principal.supplierId,
            actor: { kind: 'EXTERNAL_CLIENT', id: principal.clientId },
            correlationId,
            payload: {
              eventType: event.eventType,
              sourceHenkatenId: event.sourceHenkatenId,
              status: event.status,
            },
          },
          tx,
        );
        return result(ingestion.id, event.eventId, 'ACCEPTED', correlationId);
      });
    } catch (error) {
      const duplicate = await this.prisma.externalIngestionEvent.findUnique({
        where: {
          supplierId_sourceEpoch_eventId: {
            supplierId: principal.supplierId,
            sourceEpoch: principal.sourceEpoch,
            eventId: event.eventId,
          },
        },
      });
      if (duplicate) {
        if (duplicate.payloadHash !== payloadHash) throw idempotencyConflict();
        return result(duplicate.id, event.eventId, 'DUPLICATE', correlationId);
      }
      throw error;
    }
  }

  async ingestionStatus(principal: ExternalPrincipal, eventId: string) {
    const row = await this.prisma.externalIngestionEvent.findUnique({
      where: {
        supplierId_sourceEpoch_eventId: {
          supplierId: principal.supplierId,
          sourceEpoch: principal.sourceEpoch,
          eventId,
        },
      },
    });
    if (!row || row.clientId !== principal.clientId) throw notFound('External ingestion');
    return {
      ingestionId: row.id,
      eventId: row.eventId,
      sourceHenkatenId: row.sourceHenkatenId,
      sourceVersion: row.sourceVersion,
      eventType: row.eventType,
      status: 'ACCEPTED' as const,
      receivedAt: row.receivedAt.toISOString(),
      correlationId: row.correlationId,
    };
  }

  async listProjections(supplierId: string, limit: number, cursor?: string) {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.externalHenkatenProjection.findMany({
      where: { supplierId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map(presentProjection),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)!.id) : null,
      },
    };
  }

  async projection(supplierId: string, id: string) {
    const row = await this.prisma.externalHenkatenProjection.findFirst({
      where: { id, supplierId },
      include: {
        ingestionEvents: { orderBy: { sourceVersion: 'asc' } },
      },
    });
    if (!row) throw notFound('External Henkaten projection');
    return {
      ...presentProjection(row),
      events: row.ingestionEvents.map((event) => ({
        ingestionId: event.id,
        eventId: event.eventId,
        sourceHenkatenId: event.sourceHenkatenId,
        sourceVersion: event.sourceVersion,
        eventType: event.eventType,
        status: 'ACCEPTED' as const,
        receivedAt: event.receivedAt.toISOString(),
        correlationId: event.correlationId,
      })),
    };
  }

  async recordRejected(
    principal: ExternalPrincipal,
    eventId: string,
    code: string,
    correlationId: string,
    ip: string,
  ) {
    await this.audit.write({
      actorKind: 'EXTERNAL_CLIENT',
      supplierId: principal.supplierId,
      action: 'EXTERNAL_INGEST_REJECTED',
      resourceType: 'ExternalApiClient',
      resourceId: principal.clientId,
      changeSummary: { eventId, safeCode: code },
      correlationId,
      sourceIp: ip,
      result: 'FAILURE',
      sourceMode: 'EXTERNAL',
      sourceEpoch: principal.sourceEpoch,
    });
  }

  private async applyWarning(
    tx: Prisma.TransactionClient,
    supplierId: string,
    projection: { id: string },
    event: ExternalHenkatenEvent,
  ) {
    const partNumber = event.part.number.trim();
    if (event.status === 'OPEN') {
      await tx.warningInstance.upsert({
        where: { externalProjectionId: projection.id },
        create: {
          supplierId,
          externalProjectionId: projection.id,
          sourceMode: 'EXTERNAL',
          partNumberSnapshot: partNumber,
          normalizedPartNumberSnapshot: normalize(partNumber),
          partNameSnapshot: event.part.name.trim(),
        },
        update: {
          partNumberSnapshot: partNumber,
          normalizedPartNumberSnapshot: normalize(partNumber),
          partNameSnapshot: event.part.name.trim(),
          status: 'OPEN',
          closedAt: null,
          closeReason: null,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.warningInstance.updateMany({
        where: { externalProjectionId: projection.id, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closeReason: event.status,
          version: { increment: 1 },
        },
      });
    }
  }

  private secret(): string {
    return `ecs_${randomBytes(32).toString('base64url')}`;
  }
}

function projectionData(event: ExternalHenkatenEvent) {
  return {
    sourceVersion: event.sourceVersion,
    status: event.status,
    category: event.changePoint,
    occurredAt: new Date(event.occurredAt),
    lineSnapshot: event.line as Prisma.InputJsonValue,
    shiftSnapshot: event.shift as Prisma.InputJsonValue,
    jobSnapshot: event.job as Prisma.InputJsonValue,
    partSnapshot: event.part as Prisma.InputJsonValue,
    changeSnapshot: event.change as Prisma.InputJsonValue,
    checklistSnapshot: event.checklist as Prisma.InputJsonValue,
    decisionsSnapshot: event.decisions as Prisma.InputJsonValue,
    lastEventId: event.eventId,
  };
}

export function assertExternalOrdering(
  current: { sourceVersion: number; status: string } | null,
  event: ExternalHenkatenEvent,
) {
  if (!current) {
    if (event.sourceVersion !== 1 || event.eventType !== 'HENKATEN_OPENED') {
      throw versionOutOfOrder();
    }
    return;
  }
  if (current.status !== 'OPEN') throw invalidTransition();
  if (event.sourceVersion !== current.sourceVersion + 1) throw versionOutOfOrder();
  if (event.eventType === 'HENKATEN_OPENED') throw invalidTransition();
}

function presentClient(row: {
  id: string;
  supplierId: string;
  clientId: string;
  name: string;
  sourceEpoch: number;
  scopes: string[];
  ipAllowlist: string[];
  status: 'ACTIVE' | 'REVOKED';
  lastSuccessfulIngestionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  secrets: Array<{ revokedAt: Date | null; expiresAt: Date | null }>;
}) {
  const now = new Date();
  return {
    id: row.id,
    supplierId: row.supplierId,
    clientId: row.clientId,
    name: row.name,
    sourceEpoch: row.sourceEpoch,
    scopes: row.scopes,
    ipAllowlist: row.ipAllowlist,
    active: row.status === 'ACTIVE',
    validSecretCount: row.secrets.filter(
      ({ revokedAt, expiresAt }) => !revokedAt && (!expiresAt || expiresAt > now),
    ).length,
    lastSuccessfulIngestionAt: row.lastSuccessfulIngestionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function presentProjection(row: {
  id: string;
  supplierId: string;
  sourceHenkatenId: string;
  sourceVersion: number;
  status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  category: 'MAN' | 'MACHINE' | 'MATERIAL' | 'METHOD';
  lineSnapshot: Prisma.JsonValue;
  shiftSnapshot: Prisma.JsonValue;
  jobSnapshot: Prisma.JsonValue;
  partSnapshot: Prisma.JsonValue;
  occurredAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    supplierId: row.supplierId,
    sourceHenkatenId: row.sourceHenkatenId,
    sourceVersion: row.sourceVersion,
    status: row.status,
    category: row.category,
    sourceMode: 'EXTERNAL' as const,
    line: row.lineSnapshot,
    shift: row.shiftSnapshot,
    job: row.jobSnapshot,
    part: row.partSnapshot,
    occurredAt: row.occurredAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function externalAudit(
  context: MutationContext,
  supplierId: string,
  action: string,
  resourceId: string,
  changeSummary?: Record<string, unknown>,
) {
  return {
    actorKind: 'USER' as const,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    supplierId,
    action,
    resourceType: 'ExternalApiClient',
    resourceId,
    ...(changeSummary ? { changeSummary } : {}),
    correlationId: context.correlationId,
    ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  };
}

function tokenHash(token: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash('sha256').update(token).digest());
}

export function canonicalizeExternalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeExternalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeExternalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function externalIpAllowed(allowlist: string[], ip: string): boolean {
  return allowlist.length === 0 || allowlist.includes(ip);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function result(
  ingestionId: string,
  eventId: string,
  status: 'ACCEPTED' | 'DUPLICATE',
  correlationId: string,
) {
  return { ingestionId, eventId, status, code: null, correlationId };
}

function authenticationFailed() {
  return new ProblemException({
    status: 401,
    code: 'AUTHENTICATION_FAILED',
    title: 'Authentication failed',
    detail: 'External client authentication failed.',
  });
}
function sourceMismatch() {
  return new ProblemException({
    status: 403,
    code: 'SOURCE_MODE_MISMATCH',
    title: 'External source denied',
    detail: 'The credential is not valid for the active supplier source epoch.',
  });
}
function rateLimited() {
  return new ProblemException({
    status: 429,
    code: 'RATE_LIMITED',
    title: 'Too many requests',
    detail: 'The external request rate limit has been exceeded.',
  });
}
function idempotencyConflict() {
  return new ProblemException({
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    title: 'Event ID conflict',
    detail: 'The event ID was already used with a different canonical payload.',
  });
}
function versionOutOfOrder() {
  return new ProblemException({
    status: 422,
    code: 'SOURCE_VERSION_OUT_OF_ORDER',
    title: 'Source version out of order',
    detail: 'The first version must be 1 and later versions must be sequential.',
  });
}
function invalidTransition() {
  return new ProblemException({
    status: 422,
    code: 'INVALID_TRANSITION',
    title: 'Invalid external transition',
    detail: 'The external Henkaten transition is not permitted.',
  });
}
