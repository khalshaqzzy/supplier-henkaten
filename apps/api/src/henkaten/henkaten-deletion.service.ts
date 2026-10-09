import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  henkatenDeletionResultSchema,
  type DeleteHenkatenRequest,
  type DeleteSupplierHenkatensRequest,
} from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { RequestPrincipal } from '../common/request-context.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { ProblemException } from '../common/problem.js';
import { missing } from '../master-data/member.service.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';

@Injectable()
export class HenkatenDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
  ) {}

  async preview(supplierId: string, principal: RequestPrincipal) {
    this.assertRole(principal);
    return this.prisma.$transaction(async (tx) => this.summary(tx, supplierId), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async summary(tx: Prisma.TransactionClient, supplierId: string) {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { code: true },
    });
    if (!supplier) throw missing('Supplier');
    const [hosted, external] = await Promise.all([
      tx.henkaten.findMany({
        where: { supplierId, deletedAt: null },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
      }),
      tx.externalHenkatenProjection.findMany({
        where: { supplierId, deletedAt: null },
        select: { id: true, sourceVersion: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      supplierCode: supplier.code,
      hosted: hosted.length,
      external: external.length,
      total: hosted.length + external.length,
      revision: createHash('sha256')
        .update(
          JSON.stringify({
            supplierId,
            code: supplier.code,
            hosted,
            external,
          }),
        )
        .digest('hex'),
    };
  }

  async remove(
    supplierId: string,
    principal: RequestPrincipal,
    key: string,
    input: DeleteSupplierHenkatensRequest | DeleteHenkatenRequest,
    target: { kind: 'HOSTED' | 'EXTERNAL'; id: string } | null,
    context: MutationContext,
  ) {
    this.assertRole(principal);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ target, input }))
      .digest('hex');
    return runSerializable(
      this.prisma,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
        const actor = await tx.user.findFirst({
          where: { id: principal.userId, realm: 'TMMIN', status: 'ACTIVE', role: principal.role },
        });
        if (!actor) throw forbidden();
        const retry = await tx.henkatenDeletionCommand.findUnique({
          where: {
            supplierId_actorUserId_key: { supplierId, actorUserId: principal.userId, key },
          },
        });
        if (retry) {
          if (retry.payloadHash !== payloadHash)
            throw conflict('IDEMPOTENCY_CONFLICT', 'Permintaan ulang berbeda.');
          return henkatenDeletionResultSchema.parse(retry.result);
        }
        if (target) {
          const row =
            target.kind === 'HOSTED'
              ? await tx.henkaten.findFirst({
                  where: { id: target.id, supplierId, deletedAt: null },
                })
              : await tx.externalHenkatenProjection.findFirst({
                  where: { id: target.id, supplierId, deletedAt: null },
                });
          if (!row) throw missing('Henkaten');
          const version = 'version' in row ? row.version : row.sourceVersion;
          if (version !== (input as DeleteHenkatenRequest).expectedVersion) throw versionConflict();
        } else {
          const summary = await this.summary(tx, supplierId);
          const bulk = input as DeleteSupplierHenkatensRequest;
          if (bulk.supplierCode !== summary.supplierCode)
            throw conflict('STATE_CONFLICT', 'Kode supplier tidak sesuai.');
          if (bulk.expectedRevision !== summary.revision)
            throw conflict(
              'VERSION_CONFLICT',
              'Data Henkaten berubah. Perbarui ringkasan sebelum menghapus.',
            );
        }
        const [hosted, external] = await Promise.all([
          target?.kind === 'EXTERNAL'
            ? []
            : tx.henkaten.findMany({
                where: { supplierId, deletedAt: null, ...(target ? { id: target.id } : {}) },
                select: { id: true, lineId: true },
              }),
          target?.kind === 'HOSTED'
            ? []
            : tx.externalHenkatenProjection.findMany({
                where: { supplierId, deletedAt: null, ...(target ? { id: target.id } : {}) },
                select: { id: true },
              }),
        ]);
        const hostedIds = hosted.map((r) => r.id),
          externalIds = external.map((r) => r.id);
        const relation = {
          supplierId,
          OR: [{ henkatenId: { in: hostedIds } }, { externalProjectionId: { in: externalIds } }],
        };
        const [warnings, pcr, ingestion, movements, routes, decisions] = await Promise.all([
          tx.warningInstance.findMany({ where: relation, select: { id: true } }),
          tx.pcrAssessment.findMany({ where: relation, select: { id: true } }),
          tx.externalIngestionEvent.findMany({
            where: { supplierId, projectionId: { in: externalIds } },
            select: { id: true, eventId: true },
          }),
          tx.assignmentMovement.findMany({
            where: { supplierId, henkatenId: { in: hostedIds } },
            select: { id: true },
          }),
          tx.henkatenApprovalRoute.findMany({
            where: { supplierId, henkatenId: { in: hostedIds } },
            select: { id: true },
          }),
          tx.approvalDecision.findMany({
            where: { supplierId, henkatenId: { in: hostedIds } },
            select: { id: true },
          }),
        ]);
        const resourceIds = [
          ...hostedIds,
          ...externalIds,
          ...warnings.map((r) => r.id),
          ...pcr.map((r) => r.id),
          ...ingestion.map((r) => r.id),
          ...movements.map((r) => r.id),
          ...routes.map((r) => r.id),
          ...decisions.map((r) => r.id),
        ];
        const notifications = await tx.notification.findMany({
          where: { supplierId, resourceId: { in: resourceIds } },
          select: { id: true },
        });
        resourceIds.push(...notifications.map((row) => row.id));
        const now = new Date();
        await tx.henkaten.updateMany({
          where: { supplierId, id: { in: hostedIds }, deletedAt: null },
          data: { deletedAt: now, deletedById: principal.userId, version: { increment: 1 } },
        });
        await tx.externalHenkatenProjection.updateMany({
          where: { supplierId, id: { in: externalIds }, deletedAt: null },
          data: { deletedAt: now, deletedById: principal.userId },
        });
        await tx.warningInstance.updateMany({ where: relation, data: { hiddenAt: now } });
        await tx.pcrAssessment.updateMany({
          where: relation,
          data: { hiddenAt: now, leaseToken: null, leasedAt: null },
        });
        await tx.externalIngestionEvent.updateMany({
          where: { supplierId, projectionId: { in: externalIds } },
          data: { hiddenAt: now },
        });
        await tx.notification.updateMany({
          where: { supplierId, resourceId: { in: resourceIds } },
          data: { hiddenAt: now },
        });
        await tx.pushDelivery.updateMany({
          where: { supplierId, status: 'PENDING', notification: { hiddenAt: { not: null } } },
          data: {
            status: 'PERMANENT_FAILURE',
            safeFailureClass: 'HenkatenDeleted',
            lockedAt: null,
            lockedBy: null,
          },
        });
        // Array predicates keep a supplier-wide command bounded by query size, rather than
        // generating one JSON predicate per historical record.
        const ingestionEventIds = ingestion.map((row) => row.eventId);
        await tx.$executeRaw`UPDATE "AuditEvent" SET "hiddenAt" = ${now}
        WHERE "supplierId" = ${supplierId}::uuid AND "hiddenAt" IS NULL AND (
          "resourceId"::text = ANY(${resourceIds}::text[]) OR
          "changeSummary"->>'henkatenId' = ANY(${hostedIds}::text[]) OR
          "changeSummary"->>'eventId' = ANY(${ingestionEventIds}::text[])
        )`;
        await tx.outboxEvent.updateMany({
          where: { supplierId, aggregateId: { in: resourceIds }, suppressedAt: null },
          data: { suppressedAt: now },
        });
        await tx.henkatenExportJob.updateMany({
          where: { supplierId, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        const result = {
          commandId: randomUUID(),
          deletedAt: now.toISOString(),
          hosted: hosted.length,
          external: external.length,
          total: hosted.length + external.length,
        };
        await tx.henkatenDeletionCommand.create({
          data: {
            id: result.commandId,
            supplierId,
            actorUserId: principal.userId,
            key,
            payloadHash,
            result,
          },
        });
        await this.audit.write(
          {
            actorKind: 'USER',
            actorUserId: principal.userId,
            actorRole: principal.role,
            supplierId,
            action: target ? 'HENKATEN_DELETED' : 'HENKATEN_SUPPLIER_DELETED',
            resourceType: 'HenkatenDeletionCommand',
            resourceId: result.commandId,
            changeSummary: {
              hosted: result.hosted,
              external: result.external,
              total: result.total,
            },
            reason: input.reason,
            correlationId: context.correlationId,
            ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
          },
          tx,
        );
        for (const lineId of [...new Set(hosted.map((r) => r.lineId))]) {
          await this.outbox.enqueue(
            {
              eventType: 'HENKATEN_DATA_DELETED',
              aggregateType: 'HenkatenDeletionCommand',
              aggregateId: result.commandId,
              aggregateVersion: 1,
              supplierId,
              actor: { userId: principal.userId, role: principal.role },
              correlationId: context.correlationId,
              payload: { lineId },
            },
            tx,
          );
        }
        return result;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private assertRole(principal: RequestPrincipal) {
    if (
      principal.realm !== 'TMMIN' ||
      principal.purpose !== 'NORMAL' ||
      !['TMMIN_ADMIN', 'TMMIN_QUALITY'].includes(principal.role)
    )
      throw forbidden();
  }
}
function forbidden() {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'Hanya TMMIN Admin dan Quality yang dapat menghapus Henkaten.',
  });
}
function conflict(
  code: 'IDEMPOTENCY_CONFLICT' | 'STATE_CONFLICT' | 'VERSION_CONFLICT',
  detail: string,
) {
  return new ProblemException({ status: 409, code, title: 'Penghapusan belum dilakukan', detail });
}
