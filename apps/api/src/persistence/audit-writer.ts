import { Injectable } from '@nestjs/common';

import type {
  AuditResult,
  IdentityRealm,
  Prisma,
  SourceMode,
  UserRole,
} from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

type AuditClient = PrismaService | Prisma.TransactionClient;

export type AuditInput = {
  actorKind: 'USER' | 'SYSTEM' | 'EXTERNAL_CLIENT';
  actorUserId?: string;
  actorRole?: UserRole;
  actorSupplierId?: string;
  supplierId?: string;
  lineId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  changeSummary?: Record<string, unknown>;
  reason?: string;
  correlationId: string;
  sourceIp?: string;
  userAgent?: string;
  result?: AuditResult;
  sourceMode?: SourceMode;
  sourceEpoch?: number;
  _realm?: IdentityRealm;
};

@Injectable()
export class AuditWriter {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditInput, client: AuditClient = this.prisma): Promise<void> {
    await client.auditEvent.create({ data: auditData(input) });
  }

  async writeMany(inputs: AuditInput[], client: AuditClient = this.prisma): Promise<void> {
    if (!inputs.length) return;
    await client.auditEvent.createMany({ data: inputs.map(auditData) });
  }
}

function auditData(input: AuditInput): Prisma.AuditEventUncheckedCreateInput {
  const lineId = input.lineId ?? inferredLineId(input.changeSummary);
  return {
    actorKind: input.actorKind,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.actorRole ? { actorRole: input.actorRole } : {}),
    ...(input.actorSupplierId ? { actorSupplierId: input.actorSupplierId } : {}),
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(lineId ? { lineId } : {}),
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.changeSummary ? { changeSummary: input.changeSummary as Prisma.InputJsonValue } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    correlationId: input.correlationId,
    ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    result: input.result ?? 'SUCCESS',
    ...(input.sourceMode ? { sourceMode: input.sourceMode } : {}),
    ...(input.sourceEpoch ? { sourceEpoch: input.sourceEpoch } : {}),
  };
}

function inferredLineId(changeSummary?: Record<string, unknown>): string | undefined {
  const value = changeSummary?.lineId;
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}
