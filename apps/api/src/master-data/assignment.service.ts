import { Injectable } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';

type AssignmentKind = 'supervisor' | 'leader' | 'mp';

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async get(scope: TenantScope) {
    const [set, supervisors, leaders, mps] = await Promise.all([
      this.prisma.defaultAssignmentSet.findUnique({ where: { supplierId: scope.supplierId } }),
      this.prisma.defaultLineSupervisor.findMany({
        where: { supplierId: scope.supplierId },
        orderBy: { lineId: 'asc' },
      }),
      this.prisma.defaultLineLeader.findMany({
        where: { supplierId: scope.supplierId },
        orderBy: { lineId: 'asc' },
      }),
      this.prisma.defaultJobMp.findMany({
        where: { supplierId: scope.supplierId },
        orderBy: { jobId: 'asc' },
      }),
    ]);
    return {
      version: set?.version ?? 1,
      supervisors: supervisors.map(({ id, lineId, supervisorMemberId, version }) => ({
        id,
        resourceId: lineId,
        memberId: supervisorMemberId,
        version,
      })),
      lineLeaders: leaders.map(({ id, lineId, lineLeaderMemberId, version }) => ({
        id,
        resourceId: lineId,
        memberId: lineLeaderMemberId,
        version,
      })),
      mps: mps.map(({ id, jobId, mpMemberId, version }) => ({
        id,
        resourceId: jobId,
        memberId: mpMemberId,
        version,
      })),
    };
  }

  assign(
    scope: TenantScope,
    kind: AssignmentKind,
    resourceId: string,
    input: { memberId: string; expectedAssignmentVersion?: number },
    context: MutationContext,
  ) {
    return this.mutate(scope, kind, resourceId, input, context);
  }

  async remove(
    scope: TenantScope,
    kind: AssignmentKind,
    resourceId: string,
    expectedVersion: number,
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockAssignmentSet(tx, scope.supplierId, context.actorUserId);
      const current = await findAssignment(tx, scope.supplierId, kind, resourceId);
      if (!current) throw missing('Default assignment');
      if (current.version !== expectedVersion) throw versionConflict();
      if (kind === 'supervisor') {
        await tx.defaultLineSupervisor.delete({ where: { id: current.id } });
      } else if (kind === 'leader') {
        await tx.defaultLineLeader.delete({ where: { id: current.id } });
      } else {
        await tx.defaultJobMp.delete({ where: { id: current.id } });
      }
      await bumpAssignmentSet(tx, scope.supplierId, context.actorUserId);
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          `DEFAULT_${kind.toUpperCase()}_REMOVED`,
          'DefaultAssignment',
          current.id,
          { resourceId },
        ),
        tx,
      );
    });
    return this.get(scope);
  }

  async move(
    scope: TenantScope,
    kind: 'leader' | 'mp',
    targetResourceId: string,
    input: {
      memberId: string;
      fromResourceId: string;
      expectedSourceVersion: number;
      expectedTargetVersion?: number;
    },
    context: MutationContext,
  ) {
    if (input.fromResourceId === targetResourceId) {
      throw conflict('Source and target must be different.');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockAssignmentSet(tx, scope.supplierId, context.actorUserId);
      await requireTargetAndMember(tx, scope.supplierId, kind, targetResourceId, input.memberId);
      const source = await findAssignment(tx, scope.supplierId, kind, input.fromResourceId);
      if (!source || source.memberId !== input.memberId) throw missing('Source default assignment');
      if (source.version !== input.expectedSourceVersion) throw versionConflict();
      const target = await findAssignment(tx, scope.supplierId, kind, targetResourceId);
      if (
        target &&
        (input.expectedTargetVersion === undefined ||
          target.version !== input.expectedTargetVersion)
      ) {
        throw versionConflict();
      }
      if (kind === 'leader') {
        if (target) await tx.defaultLineLeader.delete({ where: { id: target.id } });
        await tx.defaultLineLeader.update({
          where: { id: source.id },
          data: {
            lineId: targetResourceId,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      } else {
        if (target) await tx.defaultJobMp.delete({ where: { id: target.id } });
        await tx.defaultJobMp.update({
          where: { id: source.id },
          data: {
            jobId: targetResourceId,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      }
      await bumpAssignmentSet(tx, scope.supplierId, context.actorUserId);
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          `DEFAULT_${kind.toUpperCase()}_MOVED`,
          'DefaultAssignment',
          source.id,
          { fromResourceId: input.fromResourceId, targetResourceId, memberId: input.memberId },
        ),
        tx,
      );
    });
    return this.get(scope);
  }

  private async mutate(
    scope: TenantScope,
    kind: AssignmentKind,
    resourceId: string,
    input: { memberId: string; expectedAssignmentVersion?: number },
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockAssignmentSet(tx, scope.supplierId, context.actorUserId);
      await requireTargetAndMember(tx, scope.supplierId, kind, resourceId, input.memberId);
      const current = await findAssignment(tx, scope.supplierId, kind, resourceId);
      if (
        current &&
        (input.expectedAssignmentVersion === undefined ||
          current.version !== input.expectedAssignmentVersion)
      ) {
        throw versionConflict();
      }
      if (kind !== 'supervisor') {
        const conflictAssignment =
          kind === 'leader'
            ? await tx.defaultLineLeader.findFirst({
                where: {
                  supplierId: scope.supplierId,
                  lineLeaderMemberId: input.memberId,
                  lineId: { not: resourceId },
                },
              })
            : await tx.defaultJobMp.findFirst({
                where: {
                  supplierId: scope.supplierId,
                  mpMemberId: input.memberId,
                  jobId: { not: resourceId },
                },
              });
        if (conflictAssignment) throw conflict('Member is already assigned to another resource.');
      }
      if (kind === 'supervisor') {
        await tx.defaultLineSupervisor.upsert({
          where: { lineId_supplierId: { lineId: resourceId, supplierId: scope.supplierId } },
          create: {
            supplierId: scope.supplierId,
            lineId: resourceId,
            supervisorMemberId: input.memberId,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          },
          update: {
            supervisorMemberId: input.memberId,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      } else if (kind === 'leader') {
        await tx.defaultLineLeader.upsert({
          where: { lineId_supplierId: { lineId: resourceId, supplierId: scope.supplierId } },
          create: {
            supplierId: scope.supplierId,
            lineId: resourceId,
            lineLeaderMemberId: input.memberId,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          },
          update: {
            lineLeaderMemberId: input.memberId,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      } else {
        await tx.defaultJobMp.upsert({
          where: { jobId_supplierId: { jobId: resourceId, supplierId: scope.supplierId } },
          create: {
            supplierId: scope.supplierId,
            jobId: resourceId,
            mpMemberId: input.memberId,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          },
          update: {
            mpMemberId: input.memberId,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      }
      await bumpAssignmentSet(tx, scope.supplierId, context.actorUserId);
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          `DEFAULT_${kind.toUpperCase()}_${current ? 'CHANGED' : 'ASSIGNED'}`,
          'DefaultAssignment',
          current?.id,
          { resourceId, memberId: input.memberId },
        ),
        tx,
      );
    });
    return this.get(scope);
  }
}

type FoundAssignment = { id: string; memberId: string; version: number };

async function findAssignment(
  tx: Prisma.TransactionClient,
  supplierId: string,
  kind: AssignmentKind,
  resourceId: string,
): Promise<FoundAssignment | null> {
  if (kind === 'supervisor') {
    const row = await tx.defaultLineSupervisor.findFirst({
      where: { supplierId, lineId: resourceId },
    });
    return row ? { id: row.id, memberId: row.supervisorMemberId, version: row.version } : null;
  }
  if (kind === 'leader') {
    const row = await tx.defaultLineLeader.findFirst({
      where: { supplierId, lineId: resourceId },
    });
    return row ? { id: row.id, memberId: row.lineLeaderMemberId, version: row.version } : null;
  }
  const row = await tx.defaultJobMp.findFirst({ where: { supplierId, jobId: resourceId } });
  return row ? { id: row.id, memberId: row.mpMemberId, version: row.version } : null;
}

async function requireTargetAndMember(
  tx: Prisma.TransactionClient,
  supplierId: string,
  kind: AssignmentKind,
  resourceId: string,
  memberId: string,
) {
  const role = kind === 'supervisor' ? 'SUPERVISOR' : kind === 'leader' ? 'LINE_LEADER' : 'MP';
  const [target, member] = await Promise.all([
    kind === 'mp'
      ? tx.job.findFirst({ where: { id: resourceId, supplierId, active: true } })
      : tx.line.findFirst({ where: { id: resourceId, supplierId, active: true } }),
    tx.member.findFirst({ where: { id: memberId, supplierId, role, active: true } }),
  ]);
  if (!target) throw missing(kind === 'mp' ? 'Active job' : 'Active line');
  if (!member) throw missing(`Active ${role} member`);
}

async function lockAssignmentSet(
  tx: Prisma.TransactionClient,
  supplierId: string,
  actorId: string,
) {
  await tx.defaultAssignmentSet.upsert({
    where: { supplierId },
    create: { supplierId, updatedById: actorId },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM "DefaultAssignmentSet" WHERE "supplierId" = ${supplierId}::uuid FOR UPDATE`;
}

async function bumpAssignmentSet(
  tx: Prisma.TransactionClient,
  supplierId: string,
  actorId: string,
) {
  await tx.defaultAssignmentSet.update({
    where: { supplierId },
    data: { version: { increment: 1 }, updatedById: actorId },
  });
}

function conflict(detail: string): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Assignment conflict',
    detail,
  });
}
