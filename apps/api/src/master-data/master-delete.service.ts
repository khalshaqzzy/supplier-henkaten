import { Injectable } from '@nestjs/common';

import type {
  MasterDeleteImpact,
  MasterDeleteKind,
  MasterDeleteMode,
  MasterDeletePreview,
  MasterDeleteRequest,
  MasterDeleteResult,
} from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import { missing, revokeSessions } from './member.service.js';
import { lockSetupMutation } from './setup-lock.js';

type Tx = Prisma.TransactionClient;
type Target = { kind: MasterDeleteKind; id: string; lineId?: string | undefined };

type Inspection = {
  resource: MasterDeletePreview['resource'];
  /** Open Henkaten that must be closed before the record can be removed. */
  openWhere: Prisma.HenkatenWhereInput;
  impact: MasterDeleteImpact;
  /** Line–Shifts whose assignments are released. */
  lineShiftIds: string[];
  /** Line ids whose boards must refresh. */
  lineIds: string[];
};

const emptyImpact = (): MasterDeleteImpact => ({
  jobs: 0,
  lineShifts: 0,
  lineShiftLabels: [],
  clearedAssignments: 0,
  rotationSchedules: [],
  accountUsername: null,
  boardLayout: false,
});

const lineShiftSelect = {
  id: true,
  lineId: true,
  active: true,
  supervisorMemberId: true,
  line: { select: { code: true } },
  shiftTemplate: { select: { name: true } },
  _count: {
    select: {
      lineLeaders: true,
      jobAssignments: { where: { mpMemberId: { not: null } } },
    },
  },
} satisfies Prisma.LineShiftSelect;

type LineShiftRow = Prisma.LineShiftGetPayload<{ select: typeof lineShiftSelect }>;

const auditAction: Record<MasterDeleteKind, string> = {
  LINE: 'LINE',
  JOB: 'JOB',
  MEMBER: 'MEMBER',
  PART: 'PART',
  SHIFT_TEMPLATE: 'SHIFT_TEMPLATE',
};

const resourceType: Record<MasterDeleteKind, string> = {
  LINE: 'Line',
  JOB: 'Job',
  MEMBER: 'Member',
  PART: 'Part',
  SHIFT_TEMPLATE: 'ShiftTemplate',
};

/**
 * Archive or permanently delete master data. The only blocker is an Open Henkaten that depends on
 * the record; every assignment that depends on it is released in the same transaction. A
 * permanent deletion keeps the row as a tombstone so historical evidence stays linked, hides it
 * from every list and frees its natural key.
 */
@Injectable()
export class MasterDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
  ) {}

  async preview(scope: TenantScope, target: Target): Promise<MasterDeletePreview> {
    return this.prisma.$transaction(
      async (tx) => {
        const inspection = await this.inspect(tx, scope.supplierId, target);
        const blockers = await this.openHenkatens(tx, scope.supplierId, inspection.openWhere);
        return {
          kind: target.kind,
          resource: inspection.resource,
          canArchive: inspection.resource.active && blockers.total === 0,
          canDelete: blockers.total === 0,
          openHenkatenTotal: blockers.total,
          openHenkatens: blockers.items,
          impact: inspection.impact,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async delete(
    scope: TenantScope,
    target: Target,
    input: MasterDeleteRequest,
    context: MutationContext,
  ): Promise<MasterDeleteResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockSetupMutation(tx, scope.supplierId);
        const inspection = await this.inspect(tx, scope.supplierId, target);
        if (inspection.resource.version !== input.expectedVersion) throw versionConflict();
        if (input.mode === 'ARCHIVE' && !inspection.resource.active)
          throw stateConflict('Data sudah berada di arsip.');
        const blockers = await this.openHenkatens(tx, scope.supplierId, inspection.openWhere);
        if (blockers.total > 0)
          throw new ProblemException({
            status: 409,
            code: 'RESOURCE_IN_USE',
            title: 'Masih ada Henkaten Open',
            detail: `Tutup ${blockers.total} Henkaten Open terlebih dahulu: ${blockers.items
              .slice(0, 5)
              .map(({ identifier }) => identifier)
              .join(', ')}${blockers.total > 5 ? ', …' : ''}.`,
          });
        const now = new Date();
        const permanent = input.mode === 'PERMANENT';
        await this.releaseLineShifts(
          tx,
          scope.supplierId,
          target,
          inspection,
          permanent,
          now,
          context,
        );
        await this.removeResource(
          tx,
          scope.supplierId,
          target,
          inspection,
          input.mode,
          now,
          context,
        );
        await this.audit.write(
          masterAudit(
            context,
            scope.supplierId,
            `${auditAction[target.kind]}_${permanent ? 'DELETED' : 'ARCHIVED'}`,
            resourceType[target.kind],
            target.id,
            {
              mode: input.mode,
              label: inspection.resource.label,
              jobs: inspection.impact.jobs,
              lineShifts: inspection.impact.lineShifts,
              clearedAssignments: inspection.impact.clearedAssignments,
              rotationSchedules: inspection.impact.rotationSchedules.length,
            },
          ),
          tx,
        );
        const lineIds = inspection.lineIds.length ? inspection.lineIds : [undefined];
        for (const lineId of lineIds) {
          await this.outbox.enqueue(
            {
              eventType: 'MASTER_DATA_REMOVED',
              aggregateType: resourceType[target.kind],
              aggregateId: target.id,
              aggregateVersion: inspection.resource.version + 1,
              supplierId: scope.supplierId,
              actor: { userId: context.actorUserId, role: context.actorRole },
              correlationId: context.correlationId,
              payload: {
                kind: target.kind,
                mode: input.mode,
                ...(lineId ? { lineId } : {}),
                refresh: ['assignment-board', 'dashboard'],
              },
            },
            tx,
          );
        }
        return { kind: target.kind, id: target.id, mode: input.mode, impact: inspection.impact };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  private async openHenkatens(tx: Tx, supplierId: string, where: Prisma.HenkatenWhereInput) {
    const filter: Prisma.HenkatenWhereInput = {
      AND: [{ supplierId, deletedAt: null, status: 'OPEN' }, where],
    };
    const [total, rows] = await Promise.all([
      tx.henkaten.count({ where: filter }),
      tx.henkaten.findMany({
        where: filter,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: {
          id: true,
          identifier: true,
          category: true,
          lineCodeSnapshot: true,
          shiftNameSnapshot: true,
          jobNameSnapshot: true,
          occurredAt: true,
        },
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        identifier: row.identifier,
        category: row.category,
        lineCode: row.lineCodeSnapshot,
        shiftName: row.shiftNameSnapshot,
        jobName: row.jobNameSnapshot,
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
  }

  private async inspect(tx: Tx, supplierId: string, target: Target): Promise<Inspection> {
    switch (target.kind) {
      case 'LINE':
        return this.inspectLine(tx, supplierId, target.id);
      case 'JOB':
        return this.inspectJob(tx, supplierId, target.lineId ?? '', target.id);
      case 'MEMBER':
        return this.inspectMember(tx, supplierId, target.id);
      case 'PART':
        return this.inspectPart(tx, supplierId, target.id);
      case 'SHIFT_TEMPLATE':
        return this.inspectShiftTemplate(tx, supplierId, target.id);
    }
  }

  private async inspectLine(tx: Tx, supplierId: string, id: string): Promise<Inspection> {
    const line = await tx.line.findFirst({ where: { id, supplierId, deletedAt: null } });
    if (!line) throw missing('Line');
    const [lineShifts, jobs, layout] = await Promise.all([
      tx.lineShift.findMany({
        where: { supplierId, lineId: id, deletedAt: null },
        select: lineShiftSelect,
        orderBy: [{ shiftTemplate: { displayOrder: 'asc' } }, { id: 'asc' }],
      }),
      tx.job.count({ where: { supplierId, lineId: id, deletedAt: null } }),
      tx.lineBoardLayout.count({ where: { supplierId, lineId: id } }),
    ]);
    return {
      resource: {
        id,
        label: `${line.code} · ${line.name}`,
        active: line.active,
        version: line.version,
      },
      openWhere: { lineId: id },
      impact: {
        ...emptyImpact(),
        ...lineShiftImpact(lineShifts),
        jobs,
        boardLayout: layout > 0,
      },
      lineShiftIds: lineShifts.map(({ id: lineShiftId }) => lineShiftId),
      lineIds: [id],
    };
  }

  private async inspectJob(
    tx: Tx,
    supplierId: string,
    lineId: string,
    id: string,
  ): Promise<Inspection> {
    const job = await tx.job.findFirst({
      where: { id, lineId, supplierId, deletedAt: null },
      include: { line: { select: { code: true } } },
    });
    if (!job) throw missing('Job');
    const assignments = await tx.lineShiftJobAssignment.count({
      where: { supplierId, jobId: id, mpMemberId: { not: null }, lineShift: { deletedAt: null } },
    });
    return {
      resource: {
        id,
        label: `${job.line.code} · ${job.name}`,
        active: job.active,
        version: job.version,
      },
      openWhere: { jobId: id },
      impact: { ...emptyImpact(), clearedAssignments: assignments },
      lineShiftIds: [],
      lineIds: [lineId],
    };
  }

  private async inspectMember(tx: Tx, supplierId: string, id: string): Promise<Inspection> {
    const member = await tx.member.findFirst({
      where: { id, supplierId, deletedAt: null },
      include: { users: { where: { realm: 'SUPPLIER', deletedAt: null }, take: 1 } },
    });
    if (!member) throw missing('Member');
    const [lineShifts, mpAssignments] = await Promise.all([
      tx.lineShift.findMany({
        where: {
          supplierId,
          deletedAt: null,
          OR: [{ supervisorMemberId: id }, { lineLeaders: { some: { memberId: id } } }],
        },
        select: lineShiftSelect,
        orderBy: [{ line: { displayOrder: 'asc' } }, { id: 'asc' }],
      }),
      tx.lineShiftJobAssignment.findMany({
        where: { supplierId, mpMemberId: id, lineShift: { deletedAt: null } },
        select: {
          lineShiftId: true,
          lineShift: {
            select: {
              lineId: true,
              line: { select: { code: true } },
              shiftTemplate: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    const labels = new Map<string, string>();
    for (const row of lineShifts)
      labels.set(row.id, `${row.line.code} · ${row.shiftTemplate.name}`);
    for (const row of mpAssignments)
      labels.set(
        row.lineShiftId,
        `${row.lineShift.line.code} · ${row.lineShift.shiftTemplate.name}`,
      );
    const leaderOrSupervisor = lineShifts.length;
    return {
      resource: { id, label: member.fullName, active: member.active, version: member.version },
      openWhere: {
        OR: [
          { lineLeaderResponsibility: { memberId: id } },
          { lineLeaderResponsibility: null, shiftRun: { lineLeaderMemberId: id } },
          {
            approvalRoutes: {
              some: { route: 'SUPERVISOR', status: 'PENDING', currentResponsibleMemberId: id },
            },
          },
          { manDetail: { replacedMpMemberId: id } },
          { manDetail: { replacementMpMemberId: id } },
        ],
      },
      impact: {
        ...emptyImpact(),
        lineShifts: labels.size,
        lineShiftLabels: [...labels.values()].slice(0, 50),
        clearedAssignments: leaderOrSupervisor + mpAssignments.length,
        accountUsername: member.users[0]?.username ?? null,
      },
      lineShiftIds: [...labels.keys()],
      lineIds: [
        ...new Set([
          ...lineShifts.map(({ lineId }) => lineId),
          ...mpAssignments.map(({ lineShift }) => lineShift.lineId),
        ]),
      ],
    };
  }

  private async inspectPart(tx: Tx, supplierId: string, id: string): Promise<Inspection> {
    const part = await tx.part.findFirst({ where: { id, supplierId, deletedAt: null } });
    if (!part) throw missing('Part');
    return {
      resource: {
        id,
        label: `${part.partNumber} · ${part.partName}`,
        active: part.active,
        version: part.version,
      },
      openWhere: { OR: [{ partId: id }, { parts: { some: { partId: id } } }] },
      impact: emptyImpact(),
      lineShiftIds: [],
      lineIds: [],
    };
  }

  private async inspectShiftTemplate(tx: Tx, supplierId: string, id: string): Promise<Inspection> {
    const shift = await tx.shiftTemplate.findFirst({ where: { id, supplierId, deletedAt: null } });
    if (!shift) throw missing('Shift Template');
    const [lineShifts, rotations] = await Promise.all([
      tx.lineShift.findMany({
        where: { supplierId, shiftTemplateId: id, deletedAt: null },
        select: lineShiftSelect,
        orderBy: [{ line: { displayOrder: 'asc' } }, { id: 'asc' }],
      }),
      tx.shiftRotationSchedule.findMany({
        where: { supplierId, shiftTemplateIds: { has: id } },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      resource: { id, label: shift.name, active: shift.active, version: shift.version },
      openWhere: {
        OR: [{ lineShift: { shiftTemplateId: id } }, { shiftRun: { shiftTemplateId: id } }],
      },
      impact: { ...emptyImpact(), ...lineShiftImpact(lineShifts), rotationSchedules: rotations },
      lineShiftIds: lineShifts.map(({ id: lineShiftId }) => lineShiftId),
      lineIds: [...new Set(lineShifts.map(({ lineId }) => lineId))],
    };
  }

  /**
   * Releases assignments that depend on the removed record. Line and Shift Template removal
   * deactivates their Line–Shifts; Member removal only unassigns that member.
   */
  private async releaseLineShifts(
    tx: Tx,
    supplierId: string,
    target: Target,
    inspection: Inspection,
    permanent: boolean,
    now: Date,
    context: MutationContext,
  ) {
    const ids = inspection.lineShiftIds;
    const actor = context.actorUserId;
    if (target.kind === 'LINE' || target.kind === 'SHIFT_TEMPLATE') {
      if (!ids.length) return;
      await tx.lineShiftLineLeader.deleteMany({ where: { supplierId, lineShiftId: { in: ids } } });
      await tx.lineShiftJobAssignment.updateMany({
        where: { supplierId, lineShiftId: { in: ids }, mpMemberId: { not: null } },
        data: { mpMemberId: null, version: { increment: 1 }, updatedById: actor },
      });
      await tx.lineShift.updateMany({
        where: { supplierId, id: { in: ids } },
        data: {
          active: false,
          supervisorMemberId: null,
          lineLeaderMemberId: null,
          ...(permanent ? { deletedAt: now } : {}),
          version: { increment: 1 },
          updatedById: actor,
        },
      });
      return;
    }
    if (target.kind === 'MEMBER') {
      const id = target.id;
      await tx.lineShiftLineLeader.deleteMany({ where: { supplierId, memberId: id } });
      await tx.lineShift.updateMany({
        where: { supplierId, supervisorMemberId: id },
        data: { supervisorMemberId: null },
      });
      await tx.lineShift.updateMany({
        where: { supplierId, lineLeaderMemberId: id },
        data: { lineLeaderMemberId: null },
      });
      await tx.lineShiftJobAssignment.updateMany({
        where: { supplierId, mpMemberId: id },
        data: { mpMemberId: null, version: { increment: 1 }, updatedById: actor },
      });
      await tx.defaultLineSupervisor.deleteMany({ where: { supplierId, supervisorMemberId: id } });
      await tx.defaultLineLeader.deleteMany({ where: { supplierId, lineLeaderMemberId: id } });
      await tx.defaultJobMp.deleteMany({ where: { supplierId, mpMemberId: id } });
      // Keep the compatibility mirror pointing at the first remaining Line Leader.
      for (const lineShiftId of ids) {
        const first = await tx.lineShiftLineLeader.findFirst({
          where: { supplierId, lineShiftId },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { memberId: true },
        });
        await tx.lineShift.update({
          where: { id: lineShiftId },
          data: {
            lineLeaderMemberId: first?.memberId ?? null,
            version: { increment: 1 },
            updatedById: actor,
          },
        });
      }
      return;
    }
    if (target.kind === 'JOB') {
      await tx.lineShiftJobAssignment.updateMany({
        where: { supplierId, jobId: target.id, mpMemberId: { not: null } },
        data: { mpMemberId: null, version: { increment: 1 }, updatedById: actor },
      });
      await tx.defaultJobMp.deleteMany({ where: { supplierId, jobId: target.id } });
      await tx.lineShift.updateMany({
        where: { supplierId, lineId: target.lineId ?? '', deletedAt: null },
        data: { version: { increment: 1 }, updatedById: actor },
      });
    }
  }

  private async removeResource(
    tx: Tx,
    supplierId: string,
    target: Target,
    inspection: Inspection,
    mode: MasterDeleteMode,
    now: Date,
    context: MutationContext,
  ) {
    const permanent = mode === 'PERMANENT';
    const tombstone = {
      active: false,
      ...(permanent ? { deletedAt: now } : {}),
      version: { increment: 1 },
      updatedById: context.actorUserId,
    };
    const id = target.id;
    switch (target.kind) {
      case 'LINE':
        await tx.defaultLineSupervisor.deleteMany({ where: { supplierId, lineId: id } });
        await tx.defaultLineLeader.deleteMany({ where: { supplierId, lineId: id } });
        await tx.defaultJobMp.deleteMany({ where: { supplierId, job: { lineId: id } } });
        await tx.job.updateMany({
          where: {
            supplierId,
            lineId: id,
            deletedAt: null,
            ...(permanent ? {} : { active: true }),
          },
          data: tombstone,
        });
        if (permanent) await tx.lineBoardLayout.deleteMany({ where: { supplierId, lineId: id } });
        await tx.line.update({ where: { id }, data: tombstone });
        return;
      case 'JOB':
        await tx.job.update({ where: { id }, data: tombstone });
        return;
      case 'PART':
        await tx.part.update({ where: { id }, data: tombstone });
        return;
      case 'SHIFT_TEMPLATE': {
        await this.detachFromRotations(tx, supplierId, id, inspection, permanent, context);
        await tx.shiftTemplate.update({ where: { id }, data: tombstone });
        return;
      }
      case 'MEMBER': {
        await tx.member.update({ where: { id }, data: tombstone });
        const users = await tx.user.findMany({
          where: { supplierId, memberId: id, deletedAt: null },
          select: { id: true },
        });
        for (const user of users) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              status: 'INACTIVE',
              ...(permanent ? { deletedAt: now } : {}),
              authorizationEpoch: { increment: 1 },
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          });
          await revokeSessions(tx, user.id, 'USER_DEACTIVATED');
        }
        return;
      }
    }
  }

  /**
   * Archived shifts pause their rotations. Permanently deleted shifts leave their rotations; a
   * rotation left with fewer than two shifts is paused.
   */
  private async detachFromRotations(
    tx: Tx,
    supplierId: string,
    shiftTemplateId: string,
    inspection: Inspection,
    permanent: boolean,
    context: MutationContext,
  ) {
    for (const { id } of inspection.impact.rotationSchedules) {
      const rotation = await tx.shiftRotationSchedule.findFirstOrThrow({
        where: { id, supplierId },
      });
      const remaining = rotation.shiftTemplateIds.filter((value) => value !== shiftTemplateId);
      const keepRunning = permanent && remaining.length >= 2;
      await tx.shiftRotationSchedule.update({
        where: { id },
        data: {
          ...(permanent && remaining.length >= 2 ? { shiftTemplateIds: remaining } : {}),
          ...(keepRunning
            ? {}
            : {
                enabled: false,
                lastRunMessage: permanent
                  ? 'Dijeda: shift dalam jadwal ini dihapus.'
                  : 'Dijeda: shift dalam jadwal ini diarsipkan.',
              }),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
    }
  }
}

function lineShiftImpact(rows: LineShiftRow[]) {
  return {
    lineShifts: rows.length,
    lineShiftLabels: rows.map((row) => `${row.line.code} · ${row.shiftTemplate.name}`).slice(0, 50),
    clearedAssignments: rows.reduce(
      (total, row) =>
        total +
        (row.supervisorMemberId ? 1 : 0) +
        row._count.lineLeaders +
        row._count.jobAssignments,
      0,
    ),
  };
}

function stateConflict(detail: string) {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Status berubah',
    detail,
  });
}
