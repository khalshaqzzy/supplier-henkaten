import { Temporal } from '@js-temporal/polyfill';
import { Injectable } from '@nestjs/common';

import type {
  CreateLineShiftRequest,
  UpdateLineShiftAssignmentsRequest,
} from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { databaseDate, shiftBoundaries } from '../shifts/shift-time.js';
import { businessDateForInstant } from './shift-time.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';

const includeLineShift = {
  line: true,
  shiftTemplate: true,
  supervisor: true,
  lineLeader: true,
  jobAssignments: {
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
        ...(lineId ? { lineId } : {}),
        ...(principal?.role === 'LINE_LEADER' && principal.memberId
          ? { lineLeaderMemberId: principal.memberId }
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

  async operationalContext(scope: TenantScope, principal: RequestPrincipal, now = new Date()) {
    const rows = await this.prisma.lineShift.findMany({
      where: {
        supplierId: scope.supplierId,
        active: true,
        line: { active: true },
        shiftTemplate: { active: true },
        ...(principal.role === 'LINE_LEADER' && principal.memberId
          ? { lineLeaderMemberId: principal.memberId }
          : principal.role === 'SUPERVISOR' && principal.memberId
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
    const occurrences = rows.map((row) => occurrenceFor(row, now));
    const current = occurrences.filter((item) => item.current);
    const items = await Promise.all(
      occurrences.map(async (occurrence) => {
        const overrides = await this.prisma.henkaten.findMany({
          where: {
            supplierId: scope.supplierId,
            lineShiftId: occurrence.row.id,
            category: 'MAN',
            status: { in: ['OPEN', 'APPROVED'] },
            effectiveStartAt: occurrence.start,
            effectiveEndAt: occurrence.end,
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
          { id: string; name: string; registrationNumber: string }
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
    return {
      generatedAt: now.toISOString(),
      currentLineShiftId: current[0]?.row.id ?? null,
      currentLineShiftIds: current.map(({ row }) => row.id),
      items,
    };
  }

  async resolveOccurrence(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    id: string,
    principal: RequestPrincipal,
    now = new Date(),
  ) {
    const row = await tx.lineShift.findFirst({
      where: {
        id,
        supplierId: scope.supplierId,
        active: true,
        line: { active: true },
        shiftTemplate: { active: true },
        ...(principal.role === 'LINE_LEADER' && principal.memberId
          ? { lineLeaderMemberId: principal.memberId }
          : {}),
      },
      include: includeLineShift,
    });
    if (!row) throw missing('Assigned Line Shift');
    return occurrenceFor(row, now);
  }

  async create(
    scope: TenantScope,
    lineId: string,
    input: CreateLineShiftRequest,
    context: MutationContext,
  ) {
    const id = await this.prisma.$transaction(async (tx) => {
      const [line, shift, existing, source, activeForLine, jobs] = await Promise.all([
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
              include: { jobAssignments: true },
            })
          : Promise.resolve(null),
        tx.lineShift.findMany({
          where: { supplierId: scope.supplierId, lineId, active: true },
          include: { shiftTemplate: true },
        }),
        tx.job.findMany({
          where: { supplierId: scope.supplierId, lineId, active: true },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);
      if (!line) throw missing('Active line');
      if (!shift) throw missing('Active Shift Template');
      if (existing) throw conflict('Shift tersebut sudah ditambahkan ke line.');
      if (input.copyFromLineShiftId && !source) throw missing('Source Line Shift');
      if (
        activeForLine.some(({ shiftTemplate }) =>
          overlaps(
            shift.startMinute,
            shift.endMinute,
            shiftTemplate.startMinute,
            shiftTemplate.endMinute,
          ),
        )
      ) {
        throw conflict('Jadwal shift overlap dengan shift aktif lain pada line ini.');
      }
      const sourceMps = new Map(
        source?.jobAssignments.map((assignment) => [assignment.jobId, assignment.mpMemberId]) ?? [],
      );
      const created = await tx.lineShift.create({
        data: {
          supplierId: scope.supplierId,
          lineId,
          shiftTemplateId: shift.id,
          supervisorMemberId: source?.supervisorMemberId ?? null,
          lineLeaderMemberId: source?.lineLeaderMemberId ?? null,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
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
      await tx.$queryRaw`SELECT id FROM "LineShift" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.lineShift.findFirst({
        where: { id, supplierId: scope.supplierId },
        include: { line: { include: { jobs: { where: { active: true } } } } },
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
        ...(input.lineLeaderMemberId ? [input.lineLeaderMemberId] : []),
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
      if (input.lineLeaderMemberId && roles.get(input.lineLeaderMemberId) !== 'LINE_LEADER')
        throw missing('Active Line Leader');
      if (input.jobs.some(({ mpMemberId }) => mpMemberId && roles.get(mpMemberId) !== 'MP'))
        throw missing('Active MP');

      await tx.lineShift.update({
        where: { id },
        data: {
          supervisorMemberId: input.supervisorMemberId,
          lineLeaderMemberId: input.lineLeaderMemberId,
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
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
      const current = await tx.lineShift.findFirst({ where: { id, supplierId: scope.supplierId } });
      if (!current) throw missing('Line Shift');
      if (current.version !== expectedVersion) throw versionConflict();
      if (active && !current.active) {
        const [target, siblings] = await Promise.all([
          tx.shiftTemplate.findUnique({ where: { id: current.shiftTemplateId } }),
          tx.lineShift.findMany({
            where: { supplierId: scope.supplierId, lineId: current.lineId, active: true },
            include: { shiftTemplate: true },
          }),
        ]);
        if (
          !target ||
          siblings.some(({ shiftTemplate }) =>
            overlaps(
              target.startMinute,
              target.endMinute,
              shiftTemplate.startMinute,
              shiftTemplate.endMinute,
            ),
          )
        ) {
          throw conflict('Jadwal shift overlap dengan shift aktif lain pada line ini.');
        }
      }
      await tx.lineShift.update({
        where: { id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
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
    supervisorMemberId: row.supervisorMemberId,
    supervisorName: row.supervisor?.fullName ?? null,
    lineLeaderMemberId: row.lineLeaderMemberId,
    lineLeaderName: row.lineLeader?.fullName ?? null,
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
  const candidateDate = businessDateForInstant(
    now,
    row.shiftTemplate.timezone,
    row.shiftTemplate.startMinute,
    row.shiftTemplate.endMinute,
  );
  let boundaries = shiftBoundaries(
    candidateDate,
    row.shiftTemplate.startMinute,
    row.shiftTemplate.endMinute,
    row.shiftTemplate.timezone,
  );
  let businessDate = candidateDate;
  const current = boundaries.start <= now && now < boundaries.end;
  if (!current && now >= boundaries.start) {
    businessDate = Temporal.PlainDate.from(candidateDate).add({ days: 1 }).toString();
    boundaries = shiftBoundaries(
      businessDate,
      row.shiftTemplate.startMinute,
      row.shiftTemplate.endMinute,
      row.shiftTemplate.timezone,
    );
  }
  return {
    row,
    businessDate: databaseDate(businessDate),
    start: boundaries.start,
    end: boundaries.end,
    current,
  };
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  const normalized = (start: number, end: number): [number, number] => [
    start,
    end <= start ? end + 1_440 : end,
  ];
  const [aStart, aEnd] = normalized(startA, endA);
  const [bStart, bEnd] = normalized(startB, endB);
  return [bStart - 1_440, bStart, bStart + 1_440].some(
    (candidate) => aStart < candidate + (bEnd - bStart) && candidate < aEnd,
  );
}

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
