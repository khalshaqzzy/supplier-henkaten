import { lockSetupMutation } from './setup-lock.js';
import { Injectable } from '@nestjs/common';

import type {
  CreateLineShiftRequest,
  UpdateLineShiftAssignmentsRequest,
} from '@tmmin-henkaten/contracts';

import { Prisma } from '../generated/prisma/client.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { occurrenceHenkatenWindowWhere } from './shift-time.js';
import { presentWeeklySchedule, resolveShiftOccurrence } from './shift-schedule.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';

const includeLineShift = {
  line: true,
  shiftTemplate: true,
  supervisor: true,
  lineLeader: true,
  lineLeaders: {
    include: { member: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
  jobAssignments: {
    where: { job: { active: true } },
    include: { job: true, mp: true },
    orderBy: [{ job: { displayOrder: 'asc' } }, { id: 'asc' }],
  },
} satisfies Prisma.LineShiftInclude;

type IncludedLineShift = Prisma.LineShiftGetPayload<{ include: typeof includeLineShift }>;

@Injectable()
export class LineShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async list(scope: TenantScope, lineId?: string, principal?: RequestPrincipal) {
    const rows = await this.prisma.lineShift.findMany({
      where: {
        supplierId: scope.supplierId,
        deletedAt: null,
        line: { deletedAt: null },
        shiftTemplate: { deletedAt: null },
        ...(lineId ? { lineId } : {}),
        ...(principal?.role === 'LINE_LEADER' && principal.memberId
          ? { lineLeaders: { some: { memberId: principal.memberId } } }
          : principal?.role === 'SUPERVISOR' && principal.memberId
            ? { supervisorMemberId: principal.memberId }
            : {}),
      },
      include: includeLineShift,
      orderBy: [
        { line: { displayOrder: 'asc' } },
        { shiftTemplate: { displayOrder: 'asc' } },
        { id: 'asc' },
      ],
    });
    return { items: rows.map(presentLineShift) };
  }

  /**
   * Current or next occurrence of every active Line–Shift in scope. Supervisors and Line Leaders
   * see their assigned Line–Shifts; with `allLines` they see every Line–Shift of the supplier
   * read-only, and `assigned` tells which ones they are responsible for.
   */
  async operationalContext(
    scope: TenantScope,
    principal: RequestPrincipal,
    now = new Date(),
    { allLines = false }: { allLines?: boolean } = {},
  ) {
    const assignment = assignmentWhere(principal);
    const rows = await this.prisma.lineShift.findMany({
      where: {
        supplierId: scope.supplierId,
        active: true,
        line: { active: true },
        shiftTemplate: { active: true },
        ...(allLines ? {} : assignment),
      },
      include: includeLineShift,
      orderBy: [
        { line: { displayOrder: 'asc' } },
        { shiftTemplate: { displayOrder: 'asc' } },
        { id: 'asc' },
      ],
    });
    const assignedIds = new Set(
      Object.keys(assignment).length && allLines
        ? (
            await this.prisma.lineShift.findMany({
              where: {
                supplierId: scope.supplierId,
                id: { in: rows.map(({ id }) => id) },
                ...assignment,
              },
              select: { id: true },
            })
          ).map(({ id }) => id)
        : rows.map(({ id }) => id),
    );
    const occurrences = rows.map((row) => occurrenceFor(row, now));
    const current = occurrences.filter((item) => item.current);
    const items = await Promise.all(
      occurrences.map(async (occurrence) => {
        // Retained Man evidence continues to determine MP after visibility deletion.
        // Board indicators use the separate visible-record query.
        const overrides = await this.prisma.henkaten.findMany({
          where: {
            supplierId: scope.supplierId,
            lineShiftId: occurrence.row.id,
            category: 'MAN',
            status: { in: ['OPEN', 'APPROVED'] },
            ...occurrenceHenkatenWindowWhere(occurrence, now),
            manDetail: { lineShiftJobAssignmentId: { not: null } },
          },
          select: {
            occurredAt: true,
            manDetail: {
              select: {
                lineShiftJobAssignmentId: true,
                replacementMpMemberId: true,
                replacementMpNameSnapshot: true,
                replacementMp: { select: { registrationNumber: true } },
              },
            },
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        });
        const effective = new Map<
          string,
          { id: string; name: string; registrationNumber: string | null }
        >();
        for (const override of overrides) {
          const detail = override.manDetail;
          if (!detail?.lineShiftJobAssignmentId || effective.has(detail.lineShiftJobAssignmentId))
            continue;
          effective.set(detail.lineShiftJobAssignmentId, {
            id: detail.replacementMpMemberId,
            name: detail.replacementMpNameSnapshot,
            registrationNumber: detail.replacementMp.registrationNumber,
          });
        }
        const base = presentLineShift(occurrence.row);
        return {
          ...base,
          startTime: minuteToTime(occurrence.startMinute),
          endTime: minuteToTime(occurrence.endMinute),
          crossesMidnight: occurrence.endMinute < occurrence.startMinute,
          assigned: assignedIds.has(occurrence.row.id),
          businessDate: occurrence.businessDate,
          effectiveStartAt: occurrence.start.toISOString(),
          effectiveEndAt: occurrence.end.toISOString(),
          current: occurrence.current,
          assignments: base.assignments.map((assignment) => {
            const replacement = effective.get(assignment.id);
            return replacement
              ? {
                  ...assignment,
                  mpMemberId: replacement.id,
                  mpName: replacement.name,
                  mpRegistrationNumber: replacement.registrationNumber,
                }
              : assignment;
          }),
        };
      }),
    );
    const currentAssigned = current.filter(({ row }) => assignedIds.has(row.id));
    return {
      generatedAt: now.toISOString(),
      currentLineShiftId: currentAssigned[0]?.row.id ?? null,
      currentLineShiftIds: currentAssigned.map(({ row }) => row.id),
      items,
    };
  }

  /**
   * Resolves the Line–Shift occurrence a Line Leader submits for. A Line Leader may lead several
   * active Line–Shifts; the request then names one with `lineShiftId`.
   */
  async resolveAssignedOccurrence(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    principal: RequestPrincipal,
    lineShiftId?: string,
    now?: Date,
  ) {
    if (principal.role !== 'LINE_LEADER' || !principal.memberId) {
      throw missing('Assigned Line Shift');
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT ls.id FROM "LineShift" ls
      JOIN "LineShiftLineLeader" leader ON leader."lineShiftId" = ls.id
      WHERE ls."supplierId" = ${scope.supplierId}::uuid
        AND leader."memberId" = ${principal.memberId}::uuid
        AND ls.active = true
      ORDER BY ls.id
      FOR SHARE OF ls
    `;
    if (locked.length === 0) {
      throw conflict('Line Leader belum ditugaskan pada Line–Shift aktif. Hubungi Supplier Admin.');
    }
    const chosen = lineShiftId
      ? locked.find(({ id }) => id === lineShiftId)
      : locked.length === 1
        ? locked[0]
        : undefined;
    if (!chosen) {
      throw conflict(
        lineShiftId
          ? 'Anda tidak lagi ditugaskan pada Line–Shift ini. Pilih Line–Shift lain.'
          : 'Pilih Line–Shift untuk Henkaten ini.',
      );
    }
    const row = await tx.lineShift.findFirst({
      where: {
        id: chosen.id,
        supplierId: scope.supplierId,
        lineLeaders: { some: { memberId: principal.memberId } },
        active: true,
        line: { active: true },
        shiftTemplate: { active: true },
      },
      include: includeLineShift,
    });
    if (!row) {
      throw conflict('Line–Shift LL tidak tersedia. Hubungi Supplier Admin.');
    }
    return occurrenceFor(row, now ?? new Date());
  }

  async create(
    scope: TenantScope,
    lineId: string,
    input: CreateLineShiftRequest,
    context: MutationContext,
  ) {
    const id = await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      const [line, shift, existing, source, jobs] = await Promise.all([
        tx.line.findFirst({ where: { id: lineId, supplierId: scope.supplierId, active: true } }),
        tx.shiftTemplate.findFirst({
          where: { id: input.shiftTemplateId, supplierId: scope.supplierId, active: true },
        }),
        tx.lineShift.findFirst({
          where: { supplierId: scope.supplierId, lineId, shiftTemplateId: input.shiftTemplateId },
        }),
        input.copyFromLineShiftId
          ? tx.lineShift.findFirst({
              where: {
                id: input.copyFromLineShiftId,
                supplierId: scope.supplierId,
                lineId,
              },
              include: { jobAssignments: true, lineLeaders: { orderBy: { position: 'asc' } } },
            })
          : Promise.resolve(null),
        tx.job.findMany({
          where: { supplierId: scope.supplierId, lineId, active: true },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);
      if (!line) throw missing('Active line');
      if (!shift) throw missing('Active Shift Template');
      if (existing) throw conflict('Shift tersebut sudah ditambahkan ke line.');
      if (input.copyFromLineShiftId && !source) throw missing('Source Line Shift');
      const sourceMps = new Map(
        source?.jobAssignments.map((assignment) => [assignment.jobId, assignment.mpMemberId]) ?? [],
      );
      const created = await tx.lineShift.create({
        data: {
          supplierId: scope.supplierId,
          lineId,
          shiftTemplateId: shift.id,
          supervisorMemberId: source?.supervisorMemberId ?? null,
          lineLeaderMemberId: source?.lineLeaders[0]?.memberId ?? null,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      if (source?.lineLeaders.length) {
        await tx.lineShiftLineLeader.createMany({
          data: source.lineLeaders.map((leader, index) => ({
            supplierId: scope.supplierId,
            lineShiftId: created.id,
            memberId: leader.memberId,
            position: index + 1,
            createdById: context.actorUserId,
          })),
        });
      }
      if (jobs.length) {
        await tx.lineShiftJobAssignment.createMany({
          data: jobs.map((job) => ({
            supplierId: scope.supplierId,
            lineShiftId: created.id,
            jobId: job.id,
            mpMemberId: sourceMps.get(job.id) ?? null,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          })),
        });
      }
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'LINE_SHIFT_CREATED', 'LineShift', created.id, {
          lineId,
          shiftTemplateId: shift.id,
          copiedFrom: source?.id ?? null,
        }),
        tx,
      );
      return created.id;
    });
    return this.get(scope, id);
  }

  async updateAssignments(
    scope: TenantScope,
    id: string,
    input: UpdateLineShiftAssignmentsRequest,
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      await tx.$queryRaw`SELECT id FROM "LineShift" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.lineShift.findFirst({
        where: { id, supplierId: scope.supplierId },
        include: {
          line: { include: { jobs: { where: { active: true } } } },
          lineLeaders: { orderBy: { position: 'asc' } },
        },
      });
      if (!current) throw missing('Line Shift');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const expectedJobs = new Set(current.line.jobs.map(({ id: jobId }) => jobId));
      const submittedJobs = new Set(input.jobs.map(({ jobId }) => jobId));
      if (
        expectedJobs.size !== submittedJobs.size ||
        [...expectedJobs].some((jobId) => !submittedJobs.has(jobId))
      ) {
        throw conflict('Assignment harus memuat tepat seluruh job aktif pada line.');
      }
      const memberIds = [
        ...(input.supervisorMemberId ? [input.supervisorMemberId] : []),
        ...input.lineLeaderMemberIds,
        ...input.jobs.flatMap(({ mpMemberId }) => (mpMemberId ? [mpMemberId] : [])),
      ];
      const members = memberIds.length
        ? await tx.member.findMany({
            where: {
              supplierId: scope.supplierId,
              id: { in: [...new Set(memberIds)] },
              active: true,
            },
          })
        : [];
      const roles = new Map(members.map((member) => [member.id, member.role]));
      if (input.supervisorMemberId && roles.get(input.supervisorMemberId) !== 'SUPERVISOR')
        throw missing('Active Supervisor');
      if (input.lineLeaderMemberIds.some((leaderId) => roles.get(leaderId) !== 'LINE_LEADER'))
        throw missing('Active Line Leader');
      if (input.jobs.some(({ mpMemberId }) => mpMemberId && roles.get(mpMemberId) !== 'MP'))
        throw missing('Active MP');
      await tx.lineShift.update({
        where: { id },
        data: {
          supervisorMemberId: input.supervisorMemberId,
          lineLeaderMemberId: input.lineLeaderMemberIds[0] ?? null,
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      const previousLeaders = current.lineLeaders.map(({ memberId }) => memberId);
      const leadersChanged =
        previousLeaders.length !== input.lineLeaderMemberIds.length ||
        previousLeaders.some((memberId, index) => memberId !== input.lineLeaderMemberIds[index]);
      if (leadersChanged) {
        await tx.lineShiftLineLeader.deleteMany({
          where: { supplierId: scope.supplierId, lineShiftId: id },
        });
        if (input.lineLeaderMemberIds.length) {
          await tx.lineShiftLineLeader.createMany({
            data: input.lineLeaderMemberIds.map((memberId, index) => ({
              supplierId: scope.supplierId,
              lineShiftId: id,
              memberId,
              position: index + 1,
              createdById: context.actorUserId,
            })),
          });
        }
      }
      for (const assignment of input.jobs) {
        await tx.lineShiftJobAssignment.upsert({
          where: {
            supplierId_lineShiftId_jobId: {
              supplierId: scope.supplierId,
              lineShiftId: id,
              jobId: assignment.jobId,
            },
          },
          create: {
            supplierId: scope.supplierId,
            lineShiftId: id,
            jobId: assignment.jobId,
            mpMemberId: assignment.mpMemberId,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          },
          update: {
            mpMemberId: assignment.mpMemberId,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      }
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'LINE_SHIFT_ASSIGNMENTS_UPDATED', 'LineShift', id, {
          lineId: current.lineId,
          shiftTemplateId: current.shiftTemplateId,
          assignedJobs: input.jobs.filter(({ mpMemberId }) => mpMemberId).length,
          lineLeaderMemberIds: input.lineLeaderMemberIds,
        }),
        tx,
      );
    });
    return this.get(scope, id);
  }

  async setActive(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${scope.supplierId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "LineShift" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.lineShift.findFirst({
        where: { id, supplierId: scope.supplierId },
        include: includeLineShift,
      });
      if (!current) throw missing('Line Shift');
      if (current.version !== expectedVersion) throw versionConflict();
      if (active) {
        if (!current.line.active || !current.shiftTemplate.active)
          throw conflict('Line dan shift harus aktif.');
        if (
          current.supervisorMemberId &&
          (!current.supervisor?.active || current.supervisor.role !== 'SUPERVISOR')
        )
          throw missing('Active Supervisor');
        if (
          current.lineLeaders.some(({ member }) => !member.active || member.role !== 'LINE_LEADER')
        )
          throw missing('Active Line Leader');
        if (
          current.jobAssignments.some(
            ({ job, mpMemberId, mp }) =>
              job.active && mpMemberId && (!mp?.active || mp.role !== 'MP'),
          )
        )
          throw missing('Active MP');
      }
      await tx.lineShift.update({
        where: { id },
        data: {
          active,
          ...(active ? { resetArchivedAt: null } : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'LINE_SHIFT_ACTIVATED' : 'LINE_SHIFT_DEACTIVATED',
          'LineShift',
          id,
          { lineId: current.lineId, shiftTemplateId: current.shiftTemplateId },
        ),
        tx,
      );
    });
    return this.get(scope, id);
  }

  async get(scope: TenantScope, id: string) {
    const row = await this.prisma.lineShift.findFirst({
      where: { id, supplierId: scope.supplierId },
      include: includeLineShift,
    });
    if (!row) throw missing('Line Shift');
    return presentLineShift(row);
  }
}

function presentLineShift(row: IncludedLineShift) {
  return {
    id: row.id,
    lineId: row.lineId,
    lineCode: row.line.code,
    lineName: row.line.name,
    shiftTemplateId: row.shiftTemplateId,
    shiftName: row.shiftTemplate.name,
    startTime: minuteToTime(row.shiftTemplate.startMinute),
    endTime: minuteToTime(row.shiftTemplate.endMinute),
    timezone: row.shiftTemplate.timezone,
    crossesMidnight: row.shiftTemplate.endMinute < row.shiftTemplate.startMinute,
    ...presentWeeklySchedule(row.shiftTemplate),
    supervisorMemberId: row.supervisorMemberId,
    supervisorName: row.supervisor?.fullName ?? null,
    lineLeaders: row.lineLeaders.map((leader) => ({
      memberId: leader.memberId,
      name: leader.member.fullName,
    })),
    active: row.active,
    assignments: row.jobAssignments.map((assignment) => ({
      id: assignment.id,
      jobId: assignment.jobId,
      jobName: assignment.job.name,
      jobDisplayOrder: assignment.job.displayOrder,
      mpMemberId: assignment.mpMemberId,
      mpName: assignment.mp?.fullName ?? null,
      mpRegistrationNumber: assignment.mp?.registrationNumber ?? null,
      version: assignment.version,
    })),
    version: row.version,
  };
}

function occurrenceFor(row: IncludedLineShift, now: Date) {
  const occurrence = resolveShiftOccurrence(row.shiftTemplate, now);
  return { row, ...occurrence };
}

function assignmentWhere(principal: RequestPrincipal): Prisma.LineShiftWhereInput {
  if (principal.role === 'LINE_LEADER')
    return { lineLeaders: { some: { memberId: principal.memberId ?? impossibleId } } };
  if (principal.role === 'SUPERVISOR')
    return { supervisorMemberId: principal.memberId ?? impossibleId };
  return {};
}

const impossibleId = '00000000-0000-0000-0000-000000000000';

function minuteToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function conflict(detail: string) {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Line Shift conflict',
    detail,
  });
}
