import { Injectable } from '@nestjs/common';

import type { Prisma, SourceMode, Supplier } from '../generated/prisma/client.js';
import { ProblemException } from '../common/problem.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import type { MutationContext } from './mutation-context.js';
import { presentSupplier } from './presenters.js';
import { notFound, versionConflict } from './user-admin.service.js';

export type CutoverBlocker = { contributor: string; code: string; detail: string };

export interface CutoverContributor {
  readonly name: string;
  check(
    transaction: Prisma.TransactionClient,
    supplier: Supplier,
    targetMode: SourceMode,
  ): Promise<CutoverBlocker[]>;
  revokeOldSource?(
    transaction: Prisma.TransactionClient,
    supplier: Supplier,
    targetMode: SourceMode,
  ): Promise<void>;
}

@Injectable()
export class SourceGovernanceService {
  private readonly contributors = new Map<string, CutoverContributor>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
  ) {
    this.register({
      name: 'phase-4-hosted-configuration',
      async check(transaction, supplier, targetMode) {
        if (targetMode !== 'HOSTED') return [];
        return hostedConfigurationBlockers(transaction, supplier.id);
      },
    });
    this.register({
      name: 'phase-9-external-credentials-and-projection',
      check(_transaction, _supplier, _targetMode) {
        return Promise.resolve([
          {
            contributor: 'phase-9-external-credentials-and-projection',
            code: 'CONTRIBUTOR_NOT_IMPLEMENTED',
            detail: 'External credential and projection validation is delivered in Phase 9.',
          },
        ]);
      },
    });
    this.register({
      name: 'hosted-operational-state',
      async check(transaction, supplier, targetMode) {
        if (targetMode !== 'EXTERNAL') return [];
        const [activeShift, openHenkaten, activeReservation] = await Promise.all([
          transaction.shiftRun.findFirst({
            where: { supplierId: supplier.id, status: 'ACTIVE' },
            select: { id: true },
          }),
          transaction.henkaten.findFirst({
            where: { supplierId: supplier.id, status: 'OPEN' },
            select: { id: true },
          }),
          transaction.mPReservation.findFirst({
            where: { supplierId: supplier.id, releasedAt: null },
            select: { id: true },
          }),
        ]);
        const blockers: CutoverBlocker[] = [];
        if (activeShift) {
          blockers.push({
            contributor: 'hosted-operational-state',
            code: 'ACTIVE_SHIFT_EXISTS',
            detail: 'Hosted source cutover is blocked by an active Shift Run.',
          });
        }
        if (openHenkaten) {
          blockers.push({
            contributor: 'hosted-operational-state',
            code: 'OPEN_HENKATEN_EXISTS',
            detail: 'Hosted source cutover is blocked by an Open Henkaten.',
          });
        }
        if (activeReservation) {
          blockers.push({
            contributor: 'hosted-operational-state',
            code: 'ACTIVE_MP_RESERVATION_EXISTS',
            detail: 'Hosted source cutover is blocked by an active MP reservation.',
          });
        }
        return blockers;
      },
    });
  }

  register(contributor: CutoverContributor): void {
    if (this.contributors.has(contributor.name)) {
      throw new Error(`Duplicate cutover contributor: ${contributor.name}`);
    }
    this.contributors.set(contributor.name, contributor);
  }

  async preflight(supplierId: string, targetMode: SourceMode) {
    return this.prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      const blockers = await this.collectBlockers(transaction, supplier, targetMode);
      return {
        supplierId,
        currentMode: supplier.sourceMode,
        targetMode,
        eligible: blockers.length === 0,
        blockers,
      };
    });
  }

  async cutover(
    supplierId: string,
    input: {
      expectedVersion: number;
      targetMode: SourceMode;
      reason: string;
      privacyAcknowledged: boolean;
    },
    context: MutationContext,
  ) {
    return runSerializable(this.prisma, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
      const supplier = await transaction.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== input.expectedVersion) throw versionConflict();
      const blockers = await this.collectBlockers(transaction, supplier, input.targetMode);
      if (blockers.length) {
        throw new ProblemException({
          status: 409,
          code: 'STATE_CONFLICT',
          title: 'Source cutover is blocked',
          detail: blockers.map(({ code }) => code).join(', '),
        });
      }
      for (const contributor of this.contributors.values()) {
        await contributor.revokeOldSource?.(transaction, supplier, input.targetMode);
      }
      await transaction.userSession.updateMany({
        where: { supplierId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: 'SOURCE_MODE_CHANGED',
          version: { increment: 1 },
        },
      });
      const updated = await transaction.supplier.update({
        where: { id: supplier.id },
        data: {
          sourceMode: input.targetMode,
          sourceEpoch: { increment: 1 },
          version: { increment: 1 },
          sourceModeChangedAt: new Date(),
          sourceModeChangedById: context.actorUserId,
        },
      });
      if (input.targetMode === 'HOSTED') {
        await transaction.hostedPreparation.updateMany({
          where: { supplierId, status: 'ACTIVE' },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedById: context.actorUserId,
            version: { increment: 1 },
          },
        });
      }
      await this.audit.write(
        {
          actorKind: 'USER',
          actorUserId: context.actorUserId,
          actorRole: context.actorRole,
          supplierId,
          action: 'SUPPLIER_SOURCE_MODE_CHANGED',
          resourceType: 'Supplier',
          resourceId: supplierId,
          changeSummary: {
            from: supplier.sourceMode,
            to: input.targetMode,
            privacyAcknowledged: input.privacyAcknowledged,
          },
          reason: input.reason,
          correlationId: context.correlationId,
          sourceMode: input.targetMode,
          sourceEpoch: updated.sourceEpoch,
        },
        transaction,
      );
      await this.outbox.enqueue(
        {
          eventType: 'SUPPLIER_SOURCE_MODE_CHANGED',
          aggregateType: 'Supplier',
          aggregateId: supplier.id,
          aggregateVersion: updated.version,
          supplierId,
          actor: { userId: context.actorUserId, role: context.actorRole },
          correlationId: context.correlationId,
          payload: {
            previousMode: supplier.sourceMode,
            sourceMode: updated.sourceMode,
            sourceEpoch: updated.sourceEpoch,
          },
        },
        transaction,
      );
      return presentSupplier(updated);
    });
  }

  private async collectBlockers(
    transaction: Prisma.TransactionClient,
    supplier: Supplier,
    targetMode: SourceMode,
  ): Promise<CutoverBlocker[]> {
    const blockers: CutoverBlocker[] = [];
    if (!supplier.active) {
      blockers.push({
        contributor: 'core',
        code: 'SUPPLIER_INACTIVE',
        detail: 'Supplier must be active before source cutover.',
      });
    }
    if (supplier.sourceMode === targetMode) {
      blockers.push({
        contributor: 'core',
        code: 'SAME_SOURCE_MODE',
        detail: 'Target mode must differ from the current source mode.',
      });
    }
    for (const contributor of this.contributors.values()) {
      blockers.push(...(await contributor.check(transaction, supplier, targetMode)));
    }
    return blockers;
  }
}

async function hostedConfigurationBlockers(
  transaction: Prisma.TransactionClient,
  supplierId: string,
): Promise<CutoverBlocker[]> {
  const [
    adminCount,
    lines,
    jobs,
    partCount,
    shiftCount,
    checklistCategories,
    supervisorAssignments,
    leaderAssignments,
    mpAssignments,
  ] = await Promise.all([
    transaction.user.count({
      where: { supplierId, role: 'SUPPLIER_ADMIN', status: 'ACTIVE' },
    }),
    transaction.line.findMany({ where: { supplierId, active: true }, select: { id: true } }),
    transaction.job.findMany({ where: { supplierId, active: true }, select: { id: true } }),
    transaction.part.count({ where: { supplierId, active: true } }),
    transaction.shiftTemplate.count({ where: { supplierId, active: true } }),
    transaction.checklistVersion.findMany({
      where: { supplierId, template: { active: true } },
      distinct: ['category'],
      select: { category: true },
    }),
    transaction.defaultLineSupervisor.findMany({
      where: {
        supplierId,
        line: { active: true },
        supervisor: {
          active: true,
          users: { some: { status: 'ACTIVE', role: 'SUPERVISOR' } },
        },
      },
      select: { lineId: true },
    }),
    transaction.defaultLineLeader.findMany({
      where: {
        supplierId,
        line: { active: true },
        lineLeader: {
          active: true,
          users: { some: { status: 'ACTIVE', role: 'LINE_LEADER' } },
        },
      },
      select: { lineId: true },
    }),
    transaction.defaultJobMp.findMany({
      where: { supplierId, job: { active: true }, mp: { active: true } },
      select: { jobId: true },
    }),
  ]);
  const blockers: CutoverBlocker[] = [];
  const add = (code: string, detail: string) =>
    blockers.push({ contributor: 'phase-4-hosted-configuration', code, detail });
  if (adminCount !== 1)
    add('HOSTED_ADMIN_MISSING', 'Exactly one active Supplier Admin is required.');
  if (!lines.length) add('ACTIVE_LINE_MISSING', 'At least one active line is required.');
  if (!jobs.length) add('ACTIVE_JOB_MISSING', 'At least one active job is required.');
  if (!partCount) add('ACTIVE_PART_MISSING', 'At least one active part is required.');
  if (!shiftCount)
    add('ACTIVE_SHIFT_TEMPLATE_MISSING', 'At least one active Shift Template is required.');
  const categories = new Set(checklistCategories.map(({ category }) => category));
  for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const) {
    if (!categories.has(category)) {
      add(`CHECKLIST_${category}_MISSING`, `A published active ${category} checklist is required.`);
    }
  }
  const supervised = new Set(supervisorAssignments.map(({ lineId }) => lineId));
  const led = new Set(leaderAssignments.map(({ lineId }) => lineId));
  for (const { id } of lines) {
    if (!supervised.has(id))
      add('LINE_SUPERVISOR_MISSING', 'Every active line needs a Supervisor.');
    if (!led.has(id)) add('LINE_LEADER_MISSING', 'Every active line needs a Line Leader.');
  }
  const staffed = new Set(mpAssignments.map(({ jobId }) => jobId));
  if (jobs.some(({ id }) => !staffed.has(id))) {
    add('JOB_MP_MISSING', 'Every active job needs a default MP.');
  }
  return blockers;
}
