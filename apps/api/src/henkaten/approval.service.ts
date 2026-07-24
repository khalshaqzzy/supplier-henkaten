import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { DecideHenkatenRequest, RerouteSupervisorRequest } from '@tmmin-henkaten/contracts';

import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ManMovementService } from '../operations/man-movement.service.js';
import { OperationalFinalizationService } from '../operations/operational-finalization.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import { HenkatenService } from './henkaten.service.js';

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    private readonly movements: ManMovementService,
    private readonly finalization: OperationalFinalizationService,
    private readonly henkatens: HenkatenService,
  ) {}

  async decide(
    scope: TenantScope,
    id: string,
    input: DecideHenkatenRequest,
    idempotencyKey: string,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    const route =
      principal.role === 'SUPERVISOR' ? 'SUPERVISOR' : principal.role === 'QC' ? 'QC' : null;
    if (!route || !principal.memberId) throw forbidden();
    const memberId = principal.memberId;
    const payloadHash = commandHash({ id, ...input });
    try {
      const henkatenId = await runSerializable(this.prisma, async (tx) => {
        await lockSupplier(tx, scope.supplierId);
        const retry = await tx.approvalDecision.findFirst({
          where: {
            supplierId: scope.supplierId,
            actorUserId: principal.userId,
            idempotencyKey,
          },
        });
        if (retry) {
          if (retry.commandPayloadHash !== payloadHash) throw idempotencyConflict();
          return retry.henkatenId;
        }
        const target = await tx.henkaten.findFirst({
          where: { id, supplierId: scope.supplierId },
          select: {
            id: true,
            shiftRunId: true,
            manDetail: {
              select: {
                sourceWorkingAssignment: {
                  select: { shiftRunId: true },
                },
              },
            },
          },
        });
        if (!target) throw notFound();
        await lockShiftRuns(tx, [
          target.shiftRunId,
          ...(target.manDetail?.sourceWorkingAssignment
            ? [target.manDetail.sourceWorkingAssignment.shiftRunId]
            : []),
        ]);
        await tx.$queryRaw`SELECT id FROM "Henkaten" WHERE id = ${id}::uuid FOR UPDATE`;
        const current = await tx.henkaten.findFirst({
          where: { id, supplierId: scope.supplierId },
          include: {
            approvalRoutes: { include: { decision: true } },
            manDetail: true,
          },
        });
        if (!current) throw notFound();
        if (current.version !== input.expectedVersion) throw versionConflict();
        if (current.status !== 'OPEN') throw stateConflict();
        const approvalRoute = current.approvalRoutes.find((item) => item.route === route);
        if (!approvalRoute || approvalRoute.status !== 'PENDING' || approvalRoute.decision) {
          throw stateConflict();
        }
        if (route === 'SUPERVISOR' && approvalRoute.currentResponsibleMemberId !== memberId) {
          throw forbidden();
        }

        const resultVersion = current.version + 1;
        await tx.henkatenApprovalRoute.update({
          where: { id: approvalRoute.id },
          data: {
            status: input.decision,
            version: { increment: 1 },
          },
        });
        await tx.approvalDecision.create({
          data: {
            supplierId: scope.supplierId,
            routeId: approvalRoute.id,
            henkatenId: current.id,
            decision: input.decision,
            actorUserId: principal.userId,
            actorMemberId: memberId,
            actorNameSnapshot: principal.displayName,
            actorRole: principal.role,
            comment: input.comment ?? null,
            sourceIp: context.sourceIp ?? null,
            correlationId: context.correlationId,
            expectedHenkatenVersion: input.expectedVersion,
            resultHenkatenVersion: resultVersion,
            idempotencyKey,
            commandPayloadHash: payloadHash,
          },
        });

        const otherApproved = current.approvalRoutes.some(
          (item) => item.route !== route && item.status === 'APPROVED',
        );
        const terminal =
          input.decision === 'REJECTED'
            ? ('REJECTED' as const)
            : otherApproved
              ? ('APPROVED' as const)
              : null;
        if (terminal === 'APPROVED' && current.category === 'MAN') {
          await this.movements.apply(tx, scope.supplierId, current.id, resultVersion, {
            userId: principal.userId,
            role: principal.role,
            correlationId: context.correlationId,
          });
        }
        const updated = await tx.henkaten.update({
          where: { id: current.id },
          data: {
            ...(terminal
              ? {
                  status: terminal,
                  finalizedAt: new Date(),
                  finalizedById: principal.userId,
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (terminal) {
          await this.finalization.closeTerminalEffects(tx, {
            supplierId: scope.supplierId,
            henkatenId: current.id,
            henkatenVersion: updated.version,
            toStatus: terminal,
            reason: terminal === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            actor: {
              userId: principal.userId,
              role: principal.role,
              name: principal.displayName,
              correlationId: context.correlationId,
            },
            markPendingRoutesNotRequired: terminal === 'REJECTED',
            releaseReservation: terminal === 'REJECTED',
          });
        }
        await this.audit.write(
          auditInput(context, scope.supplierId, 'HENKATEN_APPROVAL_DECIDED', current.id, {
            route,
            decision: input.decision,
            terminalStatus: terminal,
          }),
          tx,
        );
        await this.outbox.enqueue(
          {
            eventType: 'HENKATEN_APPROVAL_RECORDED',
            aggregateType: 'Henkaten',
            aggregateId: current.id,
            aggregateVersion: updated.version,
            supplierId: scope.supplierId,
            actor: { userId: principal.userId, role: principal.role },
            correlationId: context.correlationId,
            payload: { route, decision: input.decision, terminalStatus: terminal },
          },
          tx,
        );
        return current.id;
      });
      return this.henkatens.get(scope, henkatenId, principal);
    } catch (error) {
      if (isConflict(error)) {
        await this.audit.write({
          ...auditInput(context, scope.supplierId, 'HENKATEN_APPROVAL_CONFLICT', id, {
            safeCode: error.problem.code,
          }),
          result: 'FAILURE',
        });
      }
      throw error;
    }
  }

  async rerouteSupervisor(
    scope: TenantScope,
    id: string,
    input: RerouteSupervisorRequest,
    idempotencyKey: string,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (principal.role !== 'SUPPLIER_ADMIN') throw forbidden();
    const payloadHash = commandHash({ id, ...input });
    const henkatenId = await runSerializable(this.prisma, async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const retry = await tx.approvalRouteRouting.findFirst({
        where: {
          supplierId: scope.supplierId,
          actorUserId: principal.userId,
          idempotencyKey,
        },
      });
      if (retry) {
        if (retry.commandPayloadHash !== payloadHash) throw idempotencyConflict();
        return retry.henkatenId;
      }
      const target = await tx.henkaten.findFirst({
        where: { id, supplierId: scope.supplierId },
        select: { shiftRunId: true },
      });
      if (!target) throw notFound();
      await lockShiftRuns(tx, [target.shiftRunId]);
      await tx.$queryRaw`SELECT id FROM "Henkaten" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.henkaten.findFirst({
        where: { id, supplierId: scope.supplierId },
        include: { approvalRoutes: true },
      });
      if (!current) throw notFound();
      if (current.version !== input.expectedVersion) throw versionConflict();
      if (current.status !== 'OPEN') throw stateConflict();
      const route = current.approvalRoutes.find((item) => item.route === 'SUPERVISOR');
      if (!route || route.status !== 'PENDING') throw stateConflict();
      const supervisor = await tx.member.findFirst({
        where: {
          id: input.supervisorMemberId,
          supplierId: scope.supplierId,
          active: true,
          role: 'SUPERVISOR',
          users: { some: { role: 'SUPERVISOR', status: 'ACTIVE' } },
        },
      });
      if (!supervisor) throw notFound();
      const updated = await tx.henkaten.update({
        where: { id: current.id },
        data: { version: { increment: 1 } },
      });
      await tx.henkatenApprovalRoute.update({
        where: { id: route.id },
        data: {
          currentResponsibleMemberId: supervisor.id,
          currentResponsibleNameSnapshot: supervisor.fullName,
          version: { increment: 1 },
        },
      });
      await tx.approvalRouteRouting.create({
        data: {
          supplierId: scope.supplierId,
          routeId: route.id,
          henkatenId: current.id,
          fromMemberId: route.currentResponsibleMemberId,
          fromNameSnapshot: route.currentResponsibleNameSnapshot,
          toMemberId: supervisor.id,
          toNameSnapshot: supervisor.fullName,
          actorUserId: principal.userId,
          correlationId: context.correlationId,
          expectedHenkatenVersion: input.expectedVersion,
          resultHenkatenVersion: updated.version,
          idempotencyKey,
          commandPayloadHash: payloadHash,
        },
      });
      await this.audit.write(
        auditInput(context, scope.supplierId, 'HENKATEN_SUPERVISOR_REROUTED', current.id, {
          fromMemberId: route.currentResponsibleMemberId,
          toMemberId: supervisor.id,
        }),
        tx,
      );
      return current.id;
    });
    return this.henkatens.get(scope, henkatenId, principal);
  }
}

function commandHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function lockSupplier(tx: Prisma.TransactionClient, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
}

async function lockShiftRuns(tx: Prisma.TransactionClient, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`
    SELECT id FROM "ShiftRun"
    WHERE id = ANY(${sorted}::uuid[])
    ORDER BY id
    FOR UPDATE
  `;
}

function auditInput(
  context: MutationContext,
  supplierId: string,
  action: string,
  resourceId: string,
  changeSummary: Record<string, unknown>,
) {
  return {
    actorKind: 'USER' as const,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
    supplierId,
    action,
    resourceType: 'Henkaten',
    resourceId,
    changeSummary,
    correlationId: context.correlationId,
    ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    sourceMode: 'HOSTED' as const,
  };
}

function forbidden() {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'The account cannot decide or reroute this approval.',
  });
}

function notFound() {
  return new ProblemException({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    title: 'Resource not found',
    detail: 'The Henkaten or approval responsibility was not found.',
  });
}

function stateConflict() {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Approval state conflict',
    detail: 'The approval route is no longer pending.',
  });
}

function idempotencyConflict() {
  return new ProblemException({
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    title: 'Idempotency conflict',
    detail: 'The Idempotency-Key was already used with a different approval command.',
  });
}

function isConflict(error: unknown): error is ProblemException {
  return error instanceof ProblemException && error.problem.status === 409;
}
