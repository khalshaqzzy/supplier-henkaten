import { Injectable } from '@nestjs/common';

import type {
  PrepareShiftRequest,
  ShiftListQuery,
  ShiftPreflightCheck,
} from '@tmmin-henkaten/contracts';

import type { Prisma, WorkingAssignmentState } from '../generated/prisma/client.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import { missing } from '../master-data/member.service.js';
import { AssignmentIssueService } from './assignment-issue.service.js';
import { presentShift } from './shift-presenters.js';
import { shiftBoundaries } from './shift-time.js';

type SnapshotAssignment = {
  jobId: string;
  jobName: string;
  displayOrder: number;
  defaultId?: string;
  defaultVersion?: number;
  memberId?: string;
  memberName?: string;
  registrationNumber?: string;
  state: WorkingAssignmentState;
  effectiveMemberId?: string;
  unavailableReason?: 'INACTIVE';
};

@Injectable()
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    private readonly assignmentIssues: AssignmentIssueService,
  ) {}

  async prepare(
    scope: TenantScope,
    input: PrepareShiftRequest,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (!['LINE_LEADER', 'SUPPLIER_ADMIN'].includes(principal.role)) throw forbidden();
    const result = await runSerializable(this.prisma, async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const source = await this.snapshotSource(tx, scope, input);
      if (
        principal.role === 'LINE_LEADER' &&
        (!principal.memberId || source.lineLeader?.id !== principal.memberId)
      ) {
        throw forbidden();
      }
      const boundaries = shiftBoundaries(
        input.businessDate,
        source.shift.startMinute,
        source.shift.endMinute,
        source.shift.timezone,
      );
      const slot = {
        supplierId_lineId_shiftTemplateId_businessDate: {
          supplierId: scope.supplierId,
          lineId: input.lineId,
          shiftTemplateId: input.shiftTemplateId,
          businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
        },
      };
      const current = await tx.shiftRun.findUnique({ where: slot });
      if (current && current.status !== 'NOT_STARTED') {
        return tx.shiftRun.findUniqueOrThrow({
          where: { id: current.id },
          include: { workingAssignments: { orderBy: { jobDisplayOrderSnapshot: 'asc' } } },
        });
      }
      const checks = await this.evaluate(tx, scope.supplierId, input.lineId, current?.id, source);
      const plan = current
        ? await tx.shiftRun.update({
            where: { id: current.id },
            data: {
              scheduledStartAt: boundaries.start,
              scheduledEndAt: boundaries.end,
              timezoneSnapshot: source.shift.timezone,
              lineCodeSnapshot: source.line.code,
              lineNameSnapshot: source.line.name,
              shiftNameSnapshot: source.shift.name,
              shiftStartMinuteSnapshot: source.shift.startMinute,
              shiftEndMinuteSnapshot: source.shift.endMinute,
              defaultAssignmentSetVersion: source.assignmentSetVersion,
              sourceEpoch: source.sourceEpoch,
              supervisorMemberId: source.supervisor?.id ?? null,
              supervisorNameSnapshot: source.supervisor?.fullName ?? null,
              lineLeaderMemberId: source.lineLeader?.id ?? null,
              lineLeaderNameSnapshot: source.lineLeader?.fullName ?? null,
              latestPreflight: checks,
              latestPreflightAt: new Date(),
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          })
        : await tx.shiftRun.create({
            data: {
              supplierId: scope.supplierId,
              lineId: input.lineId,
              shiftTemplateId: input.shiftTemplateId,
              businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
              scheduledStartAt: boundaries.start,
              scheduledEndAt: boundaries.end,
              timezoneSnapshot: source.shift.timezone,
              lineCodeSnapshot: source.line.code,
              lineNameSnapshot: source.line.name,
              shiftNameSnapshot: source.shift.name,
              shiftStartMinuteSnapshot: source.shift.startMinute,
              shiftEndMinuteSnapshot: source.shift.endMinute,
              defaultAssignmentSetVersion: source.assignmentSetVersion,
              sourceEpoch: source.sourceEpoch,
              ...(source.supervisor
                ? {
                    supervisorMemberId: source.supervisor.id,
                    supervisorNameSnapshot: source.supervisor.fullName,
                  }
                : {}),
              ...(source.lineLeader
                ? {
                    lineLeaderMemberId: source.lineLeader.id,
                    lineLeaderNameSnapshot: source.lineLeader.fullName,
                  }
                : {}),
              latestPreflight: checks,
              latestPreflightAt: new Date(),
              createdById: context.actorUserId,
              updatedById: context.actorUserId,
            },
          });
      await tx.workingAssignment.deleteMany({ where: { shiftRunId: plan.id } });
      if (source.assignments.length) {
        await tx.workingAssignment.createMany({
          data: source.assignments.map((assignment) => ({
            supplierId: scope.supplierId,
            shiftRunId: plan.id,
            lineId: input.lineId,
            jobId: assignment.jobId,
            jobNameSnapshot: assignment.jobName,
            jobDisplayOrderSnapshot: assignment.displayOrder,
            ...(assignment.defaultId ? { sourceDefaultAssignmentId: assignment.defaultId } : {}),
            ...(assignment.defaultVersion
              ? { sourceDefaultVersion: assignment.defaultVersion }
              : {}),
            ...(assignment.effectiveMemberId
              ? { effectiveMpMemberId: assignment.effectiveMemberId }
              : {}),
            ...(assignment.memberId ? { candidateMpMemberId: assignment.memberId } : {}),
            ...(assignment.memberName ? { mpNameSnapshot: assignment.memberName } : {}),
            ...(assignment.registrationNumber
              ? { mpRegistrationSnapshot: assignment.registrationNumber }
              : {}),
            state: assignment.state,
          })),
        });
      }
      await this.audit.write(
        auditInput(context, scope.supplierId, 'SHIFT_PREFLIGHT_COMPLETED', 'ShiftRun', plan.id, {
          blockerCodes: checks.filter(({ blocking }) => blocking).map(({ code }) => code),
        }),
        tx,
      );
      return tx.shiftRun.findUniqueOrThrow({
        where: { id: plan.id },
        include: { workingAssignments: { orderBy: { jobDisplayOrderSnapshot: 'asc' } } },
      });
    });
    return presentShift(result, result.workingAssignments);
  }

  async start(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (principal.role !== 'LINE_LEADER' || !principal.memberId) throw forbidden();
    return this.activate(scope, id, expectedVersion, principal.memberId, undefined, context);
  }

  async emergencyStart(
    scope: TenantScope,
    id: string,
    input: {
      expectedVersion: number;
      reason: string;
      substituteLineLeaderMemberId?: string | undefined;
    },
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    if (principal.role !== 'SUPPLIER_ADMIN') throw forbidden();
    return this.activate(
      scope,
      id,
      input.expectedVersion,
      input.substituteLineLeaderMemberId,
      input.reason,
      context,
    );
  }

  private async activate(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    requestedLeaderId: string | undefined,
    overrideReason: string | undefined,
    context: MutationContext,
  ) {
    const result = await runSerializable(this.prisma, async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      await tx.$queryRaw`SELECT id FROM "ShiftRun" WHERE id = ${id}::uuid FOR UPDATE`;
      const plan = await tx.shiftRun.findFirst({
        where: { id, supplierId: scope.supplierId },
        include: { workingAssignments: { orderBy: { jobDisplayOrderSnapshot: 'asc' } } },
      });
      if (!plan) throw missing('Shift Run');
      if (plan.version !== expectedVersion) throw versionConflict();
      if (plan.status !== 'NOT_STARTED') throw invalidTransition();

      const assignmentSet = await tx.defaultAssignmentSet.findUnique({
        where: { supplierId: scope.supplierId },
        select: { version: true },
      });
      const supplier = await tx.supplier.findUnique({
        where: { id: scope.supplierId },
        select: { sourceMode: true, sourceEpoch: true, active: true },
      });
      if (!supplier?.active || supplier.sourceMode !== 'HOSTED') throw sourceMismatch();
      let checks = await this.evaluateExisting(
        tx,
        plan,
        assignmentSet?.version ?? 1,
        supplier.sourceEpoch,
      );
      let leaderId = plan.lineLeaderMemberId;
      let leaderName = plan.lineLeaderNameSnapshot;
      let usedSubstitute = false;
      if (overrideReason && requestedLeaderId) {
        const substitute = await tx.member.findFirst({
          where: {
            id: requestedLeaderId,
            supplierId: scope.supplierId,
            active: true,
            role: 'LINE_LEADER',
            users: { some: { status: 'ACTIVE', role: 'LINE_LEADER' } },
          },
        });
        if (!substitute) throw missing('Active substitute Line Leader');
        leaderId = substitute.id;
        leaderName = substitute.fullName;
        usedSubstitute = true;
      }
      if (!leaderId || (!overrideReason && requestedLeaderId !== leaderId)) throw forbidden();
      const leaderConflict = await tx.shiftRun.findFirst({
        where: {
          supplierId: scope.supplierId,
          status: 'ACTIVE',
          lineLeaderMemberId: leaderId,
          id: { not: plan.id },
        },
        select: { id: true },
      });
      if (leaderConflict) {
        checks.push(check('LINE_LEADER_CONFLICT', 'Line Leader owns another active Shift Run.'));
      }
      const originalFailedChecks = checks.filter(({ blocking }) => blocking);
      if (usedSubstitute) {
        checks = checks.filter(({ code }) => code !== 'LINE_LEADER_MISSING');
      }
      const nonOverrideable = new Set([
        'ACTIVE_SHIFT_EXISTS',
        'LINE_INACTIVE',
        'SHIFT_TEMPLATE_INACTIVE',
        'LINE_LEADER_MISSING',
        'LINE_LEADER_CONFLICT',
        'STALE_PLANNED_ASSIGNMENT',
        'SOURCE_EPOCH_STALE',
      ]);
      const blockers = checks.filter(({ blocking }) => blocking);
      const recordedBlockers = overrideReason ? originalFailedChecks : blockers;
      if (
        (!overrideReason && blockers.length) ||
        blockers.some(({ code }) => nonOverrideable.has(code))
      ) {
        await this.audit.write(
          auditInput(context, scope.supplierId, 'SHIFT_START_BLOCKED', 'ShiftRun', plan.id, {
            blockerCodes: blockers.map(({ code }) => code),
          }),
          tx,
        );
        return { blocked: true as const };
      }

      const updatedAssignments = [];
      for (const assignment of plan.workingAssignments) {
        const dynamic = await this.assignmentState(
          tx,
          scope.supplierId,
          assignment.candidateMpMemberId,
          assignment.id,
        );
        updatedAssignments.push(
          await tx.workingAssignment.update({
            where: { id: assignment.id },
            data: {
              state: dynamic.state,
              effectiveMpMemberId: dynamic.effectiveMemberId ?? null,
              active: true,
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          }),
        );
        if (overrideReason && dynamic.state !== 'ASSIGNED') {
          await this.assignmentIssues.createOpen(tx, {
            supplierId: scope.supplierId,
            shiftRunId: plan.id,
            lineId: plan.lineId,
            jobId: assignment.jobId,
            type: dynamic.state === 'VACANT' ? 'VACANCY' : 'CONFLICT',
            originKind: 'EMERGENCY_SHIFT_START',
            originReferenceId: plan.id,
          });
        }
      }
      const updated = await tx.shiftRun.update({
        where: { id: plan.id },
        data: {
          status: 'ACTIVE',
          lineLeaderMemberId: leaderId,
          lineLeaderNameSnapshot: leaderName,
          latestPreflight: checks,
          latestPreflightAt: new Date(),
          startedAt: new Date(),
          startedById: context.actorUserId,
          startedWithOverride: Boolean(overrideReason),
          overrideReason: overrideReason ?? null,
          ...(overrideReason ? { overrideFailedChecks: originalFailedChecks } : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      const action = overrideReason ? 'SHIFT_STARTED_WITH_OVERRIDE' : 'SHIFT_STARTED';
      await this.audit.write(
        {
          ...auditInput(context, scope.supplierId, action, 'ShiftRun', plan.id, {
            blockerCodes: recordedBlockers.map(({ code }) => code),
            substituteLineLeader: leaderId !== plan.lineLeaderMemberId,
          }),
          ...(overrideReason ? { reason: overrideReason } : {}),
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          eventType: action,
          aggregateType: 'ShiftRun',
          aggregateId: plan.id,
          aggregateVersion: updated.version,
          supplierId: scope.supplierId,
          actor: { userId: context.actorUserId, role: context.actorRole },
          correlationId: context.correlationId,
          payload: {
            lineId: plan.lineId,
            businessDate: plan.businessDate.toISOString().slice(0, 10),
            blockerCodes: recordedBlockers.map(({ code }) => code),
          },
        },
        tx,
      );
      return {
        blocked: false as const,
        shift: { ...updated, workingAssignments: updatedAssignments },
      };
    });
    if (result.blocked) throw preflightBlocked();
    return presentShift(result.shift, result.shift.workingAssignments);
  }

  async list(scope: TenantScope, query: ShiftListQuery, principal?: RequestPrincipal) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.shiftRun.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.lineId ? { lineId: query.lineId } : {}),
        ...(query.businessDate
          ? { businessDate: new Date(`${query.businessDate}T00:00:00.000Z`) }
          : {}),
        ...roleWhere(principal),
      },
      orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return page(rows, query.limit, presentShift);
  }

  async get(scope: TenantScope, id: string, principal?: RequestPrincipal) {
    const row = await this.prisma.shiftRun.findFirst({
      where: { id, supplierId: scope.supplierId, ...roleWhere(principal) },
      include: { workingAssignments: { orderBy: { jobDisplayOrderSnapshot: 'asc' } } },
    });
    if (!row) throw missing('Shift Run');
    return presentShift(row, row.workingAssignments);
  }

  async current(scope: TenantScope, lineId: string | undefined, principal?: RequestPrincipal) {
    const row = await this.prisma.shiftRun.findFirst({
      where: {
        supplierId: scope.supplierId,
        status: 'ACTIVE',
        ...(lineId ? { lineId } : {}),
        ...roleWhere(principal),
      },
      include: { workingAssignments: { orderBy: { jobDisplayOrderSnapshot: 'asc' } } },
    });
    return row ? presentShift(row, row.workingAssignments) : null;
  }

  async issues(scope: TenantScope, shiftRunId?: string, principal?: RequestPrincipal) {
    const shifts = roleWhere(principal);
    const rows = await this.prisma.assignmentIssue.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(shiftRunId ? { shiftRunId } : {}),
        ...(Object.keys(shifts).length ? { shiftRun: shifts } : {}),
      },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        shiftRunId: row.shiftRunId,
        lineId: row.lineId,
        jobId: row.jobId,
        type: row.type,
        status: row.status,
        originKind: row.originKind,
        originReferenceId: row.originReferenceId,
        openedAt: row.openedAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        version: row.version,
      })),
      pageInfo: { hasNextPage: false, nextCursor: null },
    };
  }

  private async snapshotSource(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    input: PrepareShiftRequest,
  ) {
    const [supplier, line, shift, set, supervisorAssignment, leaderAssignment, jobs] =
      await Promise.all([
        tx.supplier.findUnique({ where: { id: scope.supplierId } }),
        tx.line.findFirst({ where: { id: input.lineId, supplierId: scope.supplierId } }),
        tx.shiftTemplate.findFirst({
          where: { id: input.shiftTemplateId, supplierId: scope.supplierId },
        }),
        tx.defaultAssignmentSet.findUnique({ where: { supplierId: scope.supplierId } }),
        tx.defaultLineSupervisor.findFirst({
          where: { supplierId: scope.supplierId, lineId: input.lineId },
          include: { supervisor: { include: { users: true } } },
        }),
        tx.defaultLineLeader.findFirst({
          where: { supplierId: scope.supplierId, lineId: input.lineId },
          include: { lineLeader: { include: { users: true } } },
        }),
        tx.job.findMany({
          where: { supplierId: scope.supplierId, lineId: input.lineId, active: true },
          include: { defaultMp: { include: { mp: true } } },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);
    if (!supplier || supplier.sourceMode !== 'HOSTED' || !supplier.active) throw sourceMismatch();
    if (!line) throw missing('Line');
    if (!shift) throw missing('Shift Template');
    const assignments: SnapshotAssignment[] = [];
    for (const job of jobs) {
      const value = job.defaultMp;
      const dynamic = await this.assignmentState(
        tx,
        scope.supplierId,
        value?.mp.active ? value.mp.id : undefined,
      );
      assignments.push({
        jobId: job.id,
        jobName: job.name,
        displayOrder: job.displayOrder,
        ...(value ? { defaultId: value.id, defaultVersion: value.version } : {}),
        ...(value?.mp
          ? {
              memberId: value.mp.id,
              memberName: value.mp.fullName,
              registrationNumber: value.mp.registrationNumber,
            }
          : {}),
        state: value?.mp.active ? dynamic.state : 'VACANT',
        ...(!value?.mp.active && value?.mp ? { unavailableReason: 'INACTIVE' as const } : {}),
        ...(value?.mp.active && dynamic.effectiveMemberId
          ? { effectiveMemberId: dynamic.effectiveMemberId }
          : {}),
      });
    }
    const supervisor =
      supervisorAssignment?.supervisor.active &&
      supervisorAssignment.supervisor.users.some(
        ({ status, role }) => status === 'ACTIVE' && role === 'SUPERVISOR',
      )
        ? supervisorAssignment.supervisor
        : undefined;
    const lineLeader =
      leaderAssignment?.lineLeader.active &&
      leaderAssignment.lineLeader.users.some(
        ({ status, role }) => status === 'ACTIVE' && role === 'LINE_LEADER',
      )
        ? leaderAssignment.lineLeader
        : undefined;
    return {
      sourceEpoch: supplier.sourceEpoch,
      line,
      shift,
      assignmentSetVersion: set?.version ?? 1,
      supervisor,
      lineLeader,
      assignments,
    };
  }

  private async evaluate(
    tx: Prisma.TransactionClient,
    supplierId: string,
    lineId: string,
    currentPlanId: string | undefined,
    source: Awaited<ReturnType<ShiftService['snapshotSource']>>,
  ): Promise<ShiftPreflightCheck[]> {
    const checks: ShiftPreflightCheck[] = [];
    const active = await tx.shiftRun.findFirst({
      where: {
        supplierId,
        lineId,
        status: 'ACTIVE',
        ...(currentPlanId ? { id: { not: currentPlanId } } : {}),
      },
    });
    if (active)
      checks.push(
        check(
          'ACTIVE_SHIFT_EXISTS',
          'Line already has an active Shift Run.',
          'ShiftRun',
          active.id,
        ),
      );
    if (!source.line.active)
      checks.push(check('LINE_INACTIVE', 'Line is inactive.', 'Line', source.line.id));
    if (!source.shift.active)
      checks.push(
        check(
          'SHIFT_TEMPLATE_INACTIVE',
          'Shift Template is inactive.',
          'ShiftTemplate',
          source.shift.id,
        ),
      );
    if (!source.supervisor)
      checks.push(check('SUPERVISOR_MISSING', 'An active Supervisor account is required.'));
    if (!source.lineLeader)
      checks.push(check('LINE_LEADER_MISSING', 'An active Line Leader account is required.'));
    const candidateCounts = new Map<string, number>();
    for (const assignment of source.assignments) {
      if (assignment.memberId) {
        candidateCounts.set(
          assignment.memberId,
          (candidateCounts.get(assignment.memberId) ?? 0) + 1,
        );
      }
    }
    for (const assignment of source.assignments) {
      if (!assignment.memberId) {
        checks.push(
          check('REQUIRED_JOB_VACANT', 'Required active job has no MP.', 'Job', assignment.jobId),
        );
      } else if (assignment.unavailableReason === 'INACTIVE') {
        checks.push(check('MP_INACTIVE', 'Default MP is inactive.', 'Job', assignment.jobId));
      } else if ((candidateCounts.get(assignment.memberId) ?? 0) > 1) {
        checks.push(
          check('DUPLICATE_MP', 'Default MP appears on multiple jobs.', 'Job', assignment.jobId),
        );
      } else if (assignment.state === 'CONFLICTED') {
        checks.push(
          check(
            'MP_ACTIVE_ELSEWHERE',
            'Default MP is active on another shift.',
            'Job',
            assignment.jobId,
          ),
        );
      } else if (assignment.state === 'RESERVED') {
        checks.push(
          check(
            'MP_RESERVED',
            'Default MP has an active Man reservation.',
            'Job',
            assignment.jobId,
          ),
        );
      }
    }
    checks.push(...(await this.sharedChecks(tx, supplierId, lineId, currentPlanId)));
    return uniqueChecks(checks);
  }

  private async evaluateExisting(
    tx: Prisma.TransactionClient,
    plan: {
      id: string;
      supplierId: string;
      lineId: string;
      shiftTemplateId: string;
      supervisorMemberId: string | null;
      lineLeaderMemberId: string | null;
      sourceEpoch: number;
      defaultAssignmentSetVersion: number;
      workingAssignments: Array<{
        id: string;
        candidateMpMemberId: string | null;
      }>;
    },
    currentDefaultVersion: number,
    currentSourceEpoch: number,
  ) {
    const checks = await this.sharedChecks(tx, plan.supplierId, plan.lineId, plan.id);
    const [line, shiftTemplate, supervisor, lineLeader] = await Promise.all([
      tx.line.findFirst({
        where: { id: plan.lineId, supplierId: plan.supplierId },
        select: { active: true },
      }),
      tx.shiftTemplate.findFirst({
        where: { id: plan.shiftTemplateId, supplierId: plan.supplierId },
        select: { active: true },
      }),
      plan.supervisorMemberId
        ? tx.member.findFirst({
            where: {
              id: plan.supervisorMemberId,
              supplierId: plan.supplierId,
              active: true,
              role: 'SUPERVISOR',
              users: { some: { status: 'ACTIVE', role: 'SUPERVISOR' } },
            },
          })
        : Promise.resolve(null),
      plan.lineLeaderMemberId
        ? tx.member.findFirst({
            where: {
              id: plan.lineLeaderMemberId,
              supplierId: plan.supplierId,
              active: true,
              role: 'LINE_LEADER',
              users: { some: { status: 'ACTIVE', role: 'LINE_LEADER' } },
            },
          })
        : Promise.resolve(null),
    ]);
    if (!line?.active) checks.push(check('LINE_INACTIVE', 'Line is inactive.'));
    if (!shiftTemplate?.active) {
      checks.push(check('SHIFT_TEMPLATE_INACTIVE', 'Shift Template is inactive.'));
    }
    if (!supervisor) {
      checks.push(check('SUPERVISOR_MISSING', 'An active Supervisor account is required.'));
    }
    if (!lineLeader) {
      checks.push(check('LINE_LEADER_MISSING', 'An active Line Leader account is required.'));
    }
    if (currentDefaultVersion !== plan.defaultAssignmentSetVersion) {
      checks.push(check('STALE_PLANNED_ASSIGNMENT', 'Default Assignment changed after preflight.'));
    }
    if (plan.sourceEpoch !== currentSourceEpoch) {
      checks.push(check('SOURCE_EPOCH_STALE', 'Source epoch changed after preflight.'));
    }
    for (const assignment of plan.workingAssignments) {
      if (!assignment.candidateMpMemberId) {
        checks.push(check('REQUIRED_JOB_VACANT', 'Required active job is vacant.'));
        continue;
      }
      const state = await this.assignmentState(
        tx,
        plan.supplierId,
        assignment.candidateMpMemberId,
        assignment.id,
      );
      if (state.unavailableReason === 'INACTIVE') {
        checks.push(check('MP_INACTIVE', 'Planned MP is inactive.'));
        continue;
      }
      if (state.state === 'CONFLICTED')
        checks.push(check('MP_ACTIVE_ELSEWHERE', 'MP is active on another shift.'));
      if (state.state === 'RESERVED')
        checks.push(check('MP_RESERVED', 'MP has an active reservation.'));
    }
    return uniqueChecks(checks);
  }

  private async sharedChecks(
    tx: Prisma.TransactionClient,
    supplierId: string,
    lineId: string,
    currentPlanId?: string,
  ) {
    const checks: ShiftPreflightCheck[] = [];
    const [active, issue, carryOver, categories] = await Promise.all([
      tx.shiftRun.findFirst({
        where: {
          supplierId,
          lineId,
          status: 'ACTIVE',
          ...(currentPlanId ? { id: { not: currentPlanId } } : {}),
        },
      }),
      tx.assignmentIssue.findFirst({ where: { supplierId, lineId, status: 'OPEN' } }),
      tx.henkaten.findFirst({
        where: {
          supplierId,
          lineId,
          status: 'OPEN',
          ...(currentPlanId ? { shiftRunId: { not: currentPlanId } } : {}),
        },
      }),
      tx.checklistVersion.findMany({
        where: { supplierId, template: { active: true } },
        distinct: ['category'],
        select: { category: true },
      }),
    ]);
    if (active)
      checks.push(
        check(
          'ACTIVE_SHIFT_EXISTS',
          'Line already has an active Shift Run.',
          'ShiftRun',
          active.id,
        ),
      );
    if (issue)
      checks.push(
        check(
          'ASSIGNMENT_ISSUE_OPEN',
          'Line has an unresolved Assignment Issue.',
          'AssignmentIssue',
          issue.id,
        ),
      );
    if (carryOver)
      checks.push(
        check(
          'OPEN_HENKATEN_CARRY_OVER',
          'Line has an Open Henkaten from another Shift Run.',
          'Henkaten',
          carryOver.id,
        ),
      );
    const published = new Set(categories.map(({ category }) => category));
    for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const) {
      if (!published.has(category)) {
        checks.push({
          ...check('CHECKLIST_INVALID', `Published ${category} checklist is required.`),
          category,
        });
      }
    }
    return checks;
  }

  private async assignmentState(
    tx: Prisma.TransactionClient,
    supplierId: string,
    memberId?: string | null,
    currentAssignmentId?: string,
  ): Promise<{
    state: WorkingAssignmentState;
    effectiveMemberId?: string;
    unavailableReason?: 'INACTIVE';
  }> {
    if (!memberId) return { state: 'VACANT' };
    const [member, activeElsewhere, reservation] = await Promise.all([
      tx.member.findFirst({
        where: { id: memberId, supplierId, active: true, role: 'MP' },
        select: { id: true },
      }),
      tx.workingAssignment.findFirst({
        where: {
          supplierId,
          effectiveMpMemberId: memberId,
          active: true,
          ...(currentAssignmentId ? { id: { not: currentAssignmentId } } : {}),
        },
      }),
      tx.mPReservation.findFirst({
        where: { supplierId, replacementMpMemberId: memberId, releasedAt: null },
      }),
    ]);
    if (!member) return { state: 'VACANT', unavailableReason: 'INACTIVE' };
    if (activeElsewhere) return { state: 'CONFLICTED' };
    if (reservation) return { state: 'RESERVED' };
    return { state: 'ASSIGNED', effectiveMemberId: memberId };
  }
}

function roleWhere(principal?: RequestPrincipal): Prisma.ShiftRunWhereInput {
  if (
    !principal ||
    principal.realm === 'TMMIN' ||
    ['SUPPLIER_ADMIN', 'QC'].includes(principal.role)
  ) {
    return {};
  }
  if (!principal.memberId) {
    return { id: '00000000-0000-0000-0000-000000000000' };
  }
  return principal.role === 'SUPERVISOR'
    ? { supervisorMemberId: principal.memberId }
    : { lineLeaderMemberId: principal.memberId };
}

function page<T extends { id: string }>(rows: T[], limit: number, presenter: (row: T) => unknown) {
  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    items: items.map(presenter),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)!.id) : null,
    },
  };
}

function check(
  code: ShiftPreflightCheck['code'],
  message: string,
  resourceType?: string,
  resourceId?: string,
): ShiftPreflightCheck {
  return {
    code,
    blocking: true,
    message,
    ...(resourceType ? { resourceType } : {}),
    ...(resourceId ? { resourceId } : {}),
  };
}

function uniqueChecks(checks: ShiftPreflightCheck[]): ShiftPreflightCheck[] {
  const seen = new Set<string>();
  return checks.filter((value) => {
    const key = `${value.code}:${value.resourceId ?? ''}:${value.category ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function lockSupplier(tx: Prisma.TransactionClient, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
}

function auditInput(
  context: MutationContext,
  supplierId: string,
  action: string,
  resourceType: string,
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
    resourceType,
    resourceId,
    changeSummary,
    correlationId: context.correlationId,
    ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    sourceMode: 'HOSTED' as const,
  };
}

function forbidden(): ProblemException {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'The account is not allowed to operate this shift.',
  });
}
function invalidTransition(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'INVALID_TRANSITION',
    title: 'Invalid transition',
    detail: 'Shift Run is not in a startable state.',
  });
}
function preflightBlocked(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Shift start blocked',
    detail: 'The latest Shift Run preflight contains blocking checks.',
  });
}
function sourceMismatch(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'SOURCE_MODE_MISMATCH',
    title: 'Source mode mismatch',
    detail: 'Hosted shift operations are unavailable for this supplier.',
  });
}
