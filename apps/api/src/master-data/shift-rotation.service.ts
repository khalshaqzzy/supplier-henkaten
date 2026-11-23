import { Temporal } from '@js-temporal/polyfill';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';

import type {
  CreateShiftRotationRequest,
  UpdateShiftRotationRequest,
} from '@tmmin-henkaten/contracts';

import { Prisma } from '../generated/prisma/client.js';
import type { ShiftRotationExecution, ShiftRotationSchedule } from '../generated/prisma/client.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';
import { lockSetupMutation } from './setup-lock.js';
import { assertIanaTimezone, timeToMinute } from './shift-time.js';
import { minuteToTime, weeklyScheduleOf } from './shift-schedule.js';

type Tx = Prisma.TransactionClient;
type RotationWithExecutions = ShiftRotationSchedule & { executions: ShiftRotationExecution[] };

/**
 * First instant strictly after `after` that falls on ISO weekday `dayOfWeek` at local
 * `minute` in `timezone`.
 */
export function nextWeeklyRun(
  dayOfWeek: number,
  minute: number,
  timezone: string,
  after: Date,
): Date {
  const today = Temporal.Instant.fromEpochMilliseconds(after.getTime())
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  const time = Temporal.PlainTime.from({ hour: Math.floor(minute / 60), minute: minute % 60 });
  for (let offset = 0; offset <= 14; offset++) {
    const date = today.add({ days: offset });
    if (date.dayOfWeek !== dayOfWeek) continue;
    const at = new Date(
      date.toZonedDateTime({ timeZone: timezone, plainTime: time }).epochMilliseconds,
    );
    if (at > after) return at;
  }
  throw new Error('NextWeeklyRunUnavailable');
}

/** Index of the shift whose times shift `index` takes on a rotation (the next one, cyclic). */
export const rotationSource = (index: number, length: number) => (index + 1) % length;

@Injectable()
export class ShiftRotationService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(ShiftRotationService.name);
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private inFlight: Promise<unknown> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.shiftRotationEnabled) this.schedule(this.config.shiftRotationPollMs);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  private schedule(delay: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.runDue()
        .catch((error: unknown) =>
          this.logger.error(
            `Shift rotation run failed: ${error instanceof Error ? error.name : 'Error'}`,
          ),
        )
        .finally(() => {
          this.inFlight = undefined;
          this.schedule(this.config.shiftRotationPollMs);
        });
    }, delay);
    this.timer.unref();
  }

  async list(scope: TenantScope) {
    const rows = await this.prisma.shiftRotationSchedule.findMany({
      where: { supplierId: scope.supplierId },
      include: { executions: { orderBy: { executedAt: 'desc' }, take: 5 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items: await this.present(scope.supplierId, rows) };
  }

  async create(scope: TenantScope, input: CreateShiftRotationRequest, context: MutationContext) {
    const executeMinute = parseTime(input.executeTime);
    validTimezone(input.timezone);
    const id = await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      const enabled = input.enabled ?? true;
      await this.assertShifts(tx, scope.supplierId, input.shiftTemplateIds, enabled, null);
      const created = await tx.shiftRotationSchedule.create({
        data: {
          supplierId: scope.supplierId,
          name: input.name.trim(),
          enabled,
          shiftTemplateIds: input.shiftTemplateIds,
          dayOfWeek: input.dayOfWeek,
          executeMinute,
          timezone: input.timezone,
          nextRunAt: enabled
            ? nextWeeklyRun(input.dayOfWeek, executeMinute, input.timezone, new Date())
            : null,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          'SHIFT_ROTATION_CREATED',
          'ShiftRotationSchedule',
          created.id,
          {
            shifts: input.shiftTemplateIds.length,
            dayOfWeek: input.dayOfWeek,
            executeTime: input.executeTime,
            enabled,
          },
        ),
        tx,
      );
      return created.id;
    });
    return this.get(scope.supplierId, id);
  }

  async update(
    scope: TenantScope,
    id: string,
    input: UpdateShiftRotationRequest,
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      const current = await tx.shiftRotationSchedule.findFirst({
        where: { id, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Shift rotation');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const dayOfWeek = input.dayOfWeek ?? current.dayOfWeek;
      const executeMinute =
        input.executeTime !== undefined ? parseTime(input.executeTime) : current.executeMinute;
      const timezone = input.timezone ?? current.timezone;
      validTimezone(timezone);
      const shiftTemplateIds = input.shiftTemplateIds ?? current.shiftTemplateIds;
      const enabled = input.enabled ?? current.enabled;
      await this.assertShifts(tx, scope.supplierId, shiftTemplateIds, enabled, id);
      const timingChanged =
        dayOfWeek !== current.dayOfWeek ||
        executeMinute !== current.executeMinute ||
        timezone !== current.timezone;
      const nextRunAt = !enabled
        ? null
        : timingChanged || !current.enabled || !current.nextRunAt
          ? nextWeeklyRun(dayOfWeek, executeMinute, timezone, new Date())
          : current.nextRunAt;
      await tx.shiftRotationSchedule.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          shiftTemplateIds,
          dayOfWeek,
          executeMinute,
          timezone,
          enabled,
          nextRunAt,
          ...(enabled && !current.enabled ? { lastRunMessage: null } : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          'SHIFT_ROTATION_UPDATED',
          'ShiftRotationSchedule',
          id,
          {
            fields: Object.keys(input).filter((key) => key !== 'expectedVersion'),
            enabled,
          },
        ),
        tx,
      );
    });
    return this.get(scope.supplierId, id);
  }

  async remove(scope: TenantScope, id: string, expectedVersion: number, context: MutationContext) {
    await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      const current = await tx.shiftRotationSchedule.findFirst({
        where: { id, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Shift rotation');
      if (current.version !== expectedVersion) throw versionConflict();
      await tx.shiftRotationSchedule.delete({ where: { id } });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          'SHIFT_ROTATION_DELETED',
          'ShiftRotationSchedule',
          id,
          {
            name: current.name,
          },
        ),
        tx,
      );
    });
  }

  /** Rotates now, outside the weekly schedule. The next scheduled run is unchanged. */
  async runNow(scope: TenantScope, id: string, expectedVersion: number, context: MutationContext) {
    const executionId = await this.prisma.$transaction(
      async (tx) => {
        await lockSetupMutation(tx, scope.supplierId);
        const current = await tx.shiftRotationSchedule.findFirst({
          where: { id, supplierId: scope.supplierId },
        });
        if (!current) throw missing('Shift rotation');
        if (current.version !== expectedVersion) throw versionConflict();
        const outcome = await this.rotate(tx, current, {
          kind: 'USER',
          context,
        });
        if (outcome.status === 'SKIPPED') throw stateConflict(outcome.message);
        const execution = await tx.shiftRotationExecution.create({
          data: {
            supplierId: scope.supplierId,
            scheduleId: id,
            scheduledForAt: new Date(),
            status: 'SUCCESS',
            trigger: 'MANUAL',
            affectedLines: outcome.affectedLines,
            message: outcome.message,
            summary: outcome.summary as Prisma.InputJsonValue,
          },
        });
        await tx.shiftRotationSchedule.update({
          where: { id },
          data: {
            lastRunAt: execution.executedAt,
            lastRunStatus: 'SUCCESS',
            lastRunMessage: outcome.message,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
        return execution.id;
      },
      { isolationLevel: 'Serializable' },
    );
    const [rotation, execution] = await Promise.all([
      this.get(scope.supplierId, id),
      this.prisma.shiftRotationExecution.findUniqueOrThrow({ where: { id: executionId } }),
    ]);
    return { rotation, execution: presentExecution(execution) };
  }

  /**
   * Executes every enabled schedule whose run time has passed. A run that was missed for more than
   * one week executes once, then the schedule moves to the next future slot, so a downtime never
   * applies several rotations at once.
   */
  async runDue(now = new Date()): Promise<number> {
    let executed = 0;
    for (let guard = 0; guard < 100; guard++) {
      const done = await this.prisma.$transaction(
        async (tx) => {
          const [due] = await tx.$queryRaw<Array<{ id: string; supplierId: string }>>`
            SELECT id, "supplierId" FROM "ShiftRotationSchedule"
            WHERE enabled = true AND "nextRunAt" <= ${now}
            ORDER BY "nextRunAt" ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `;
          if (!due) return false;
          await lockSetupMutation(tx, due.supplierId);
          const schedule = await tx.shiftRotationSchedule.findUniqueOrThrow({
            where: { id: due.id },
          });
          if (!schedule.enabled || !schedule.nextRunAt || schedule.nextRunAt > now) return true;
          const scheduledForAt = schedule.nextRunAt;
          const nextRunAt = nextWeeklyRun(
            schedule.dayOfWeek,
            schedule.executeMinute,
            schedule.timezone,
            now,
          );
          const already = await tx.shiftRotationExecution.findUnique({
            where: { scheduleId_scheduledForAt: { scheduleId: schedule.id, scheduledForAt } },
          });
          if (already) {
            await tx.shiftRotationSchedule.update({
              where: { id: schedule.id },
              data: { nextRunAt },
            });
            return true;
          }
          const outcome = await this.rotate(tx, schedule, { kind: 'SYSTEM' });
          const execution = await tx.shiftRotationExecution.create({
            data: {
              supplierId: schedule.supplierId,
              scheduleId: schedule.id,
              scheduledForAt,
              status: outcome.status,
              trigger: 'SCHEDULE',
              affectedLines: outcome.affectedLines,
              message: outcome.message,
              summary: outcome.summary as Prisma.InputJsonValue,
            },
          });
          await tx.shiftRotationSchedule.update({
            where: { id: schedule.id },
            data: {
              nextRunAt,
              lastRunAt: execution.executedAt,
              lastRunStatus: outcome.status,
              lastRunMessage: outcome.message,
              version: { increment: 1 },
            },
          });
          executed++;
          return true;
        },
        { isolationLevel: 'ReadCommitted', timeout: 30_000 },
      );
      if (!done) break;
    }
    return executed;
  }

  /** Applies one rotation step: every shift takes the times of the next shift in the list. */
  private async rotate(
    tx: Tx,
    schedule: ShiftRotationSchedule,
    actor: { kind: 'SYSTEM' } | { kind: 'USER'; context: MutationContext },
  ): Promise<{
    status: 'SUCCESS' | 'SKIPPED';
    affectedLines: number;
    message: string;
    summary: Record<string, unknown>;
  }> {
    const ids = schedule.shiftTemplateIds;
    const rows = await tx.shiftTemplate.findMany({
      where: { supplierId: schedule.supplierId, id: { in: ids }, active: true, deletedAt: null },
    });
    const shifts = ids.map((id) => rows.find((row) => row.id === id));
    if (shifts.some((shift) => !shift))
      return {
        status: 'SKIPPED',
        affectedLines: 0,
        message: 'Dilewati: ada shift yang nonaktif atau dihapus.',
        summary: {},
      };
    const ordered = shifts as NonNullable<(typeof shifts)[number]>[];
    const signature = (shift: (typeof ordered)[number]) =>
      JSON.stringify([shift.timezone, weeklyScheduleOf(shift)]);
    if (new Set(ordered.map(signature)).size === 1)
      return {
        status: 'SKIPPED',
        affectedLines: 0,
        message: 'Dilewati: semua shift memiliki jadwal yang sama.',
        summary: {},
      };
    const actorUserId = actor.kind === 'USER' ? actor.context.actorUserId : null;
    for (const [index, target] of ordered.entries()) {
      const source = ordered[rotationSource(index, ordered.length)]!;
      await tx.shiftTemplate.update({
        where: { id: target.id },
        data: {
          startMinute: source.startMinute,
          endMinute: source.endMinute,
          timezone: source.timezone,
          weeklySchedule:
            source.weeklySchedule === null
              ? Prisma.DbNull
              : (source.weeklySchedule as Prisma.InputJsonValue),
          version: { increment: 1 },
          updatedById: actorUserId,
        },
      });
    }
    await tx.lineShift.updateMany({
      where: { supplierId: schedule.supplierId, shiftTemplateId: { in: ids } },
      data: { version: { increment: 1 }, ...(actorUserId ? { updatedById: actorUserId } : {}) },
    });
    const lines = await tx.lineShift.findMany({
      where: { supplierId: schedule.supplierId, shiftTemplateId: { in: ids }, deletedAt: null },
      select: { lineId: true },
    });
    const affectedLines = new Set(lines.map(({ lineId }) => lineId)).size;
    const summary = {
      shifts: ordered.map((shift, index) => ({
        id: shift.id,
        name: shift.name,
        from: `${minuteToTime(shift.startMinute)}–${minuteToTime(shift.endMinute)}`,
        to: `${minuteToTime(ordered[rotationSource(index, ordered.length)]!.startMinute)}–${minuteToTime(ordered[rotationSource(index, ordered.length)]!.endMinute)}`,
      })),
    };
    const correlationId =
      actor.kind === 'USER' ? actor.context.correlationId : `shift-rotation:${schedule.id}`;
    await this.audit.write(
      actor.kind === 'USER'
        ? masterAudit(
            actor.context,
            schedule.supplierId,
            'SHIFT_TIMES_ROTATED',
            'ShiftRotationSchedule',
            schedule.id,
            {
              trigger: 'MANUAL',
              affectedLines,
              ...summary,
            },
          )
        : {
            actorKind: 'SYSTEM',
            supplierId: schedule.supplierId,
            action: 'SHIFT_TIMES_ROTATED',
            resourceType: 'ShiftRotationSchedule',
            resourceId: schedule.id,
            changeSummary: { trigger: 'SCHEDULE', affectedLines, ...summary },
            correlationId,
          },
      tx,
    );
    await this.outbox.enqueue(
      {
        eventType: 'SHIFT_TIMES_SWAPPED',
        aggregateType: 'ShiftRotationSchedule',
        aggregateId: schedule.id,
        aggregateVersion: schedule.version + 1,
        supplierId: schedule.supplierId,
        actor:
          actor.kind === 'USER'
            ? { userId: actor.context.actorUserId, role: actor.context.actorRole }
            : { kind: 'SYSTEM' },
        correlationId,
        payload: {
          shiftTemplateIds: ids,
          affectedLines,
          refresh: ['assignment-board', 'dashboard'],
        },
      },
      tx,
    );
    return {
      status: 'SUCCESS',
      affectedLines,
      message: `${ordered.length} shift dirotasi · ${affectedLines} line`,
      summary,
    };
  }

  /** Enabled rotations need distinct active shifts that no other enabled rotation uses. */
  private async assertShifts(
    tx: Tx,
    supplierId: string,
    ids: readonly string[],
    enabled: boolean,
    excludeId: string | null,
  ) {
    const shifts = await tx.shiftTemplate.findMany({
      where: { supplierId, id: { in: [...ids] }, deletedAt: null },
      select: { id: true, active: true, name: true },
    });
    if (shifts.length !== ids.length) throw missing('Shift Template');
    if (!enabled) return;
    const inactive = shifts.find(({ active }) => !active);
    if (inactive)
      throw stateConflict(`${inactive.name} nonaktif. Aktifkan shift atau pilih shift lain.`);
    const overlap = await tx.shiftRotationSchedule.findFirst({
      where: {
        supplierId,
        enabled: true,
        shiftTemplateIds: { hasSome: [...ids] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { name: true },
    });
    if (overlap)
      throw stateConflict(
        `Shift sudah dipakai jadwal "${overlap.name}". Jeda jadwal itu terlebih dahulu.`,
      );
  }

  private async get(supplierId: string, id: string) {
    const row = await this.prisma.shiftRotationSchedule.findFirst({
      where: { id, supplierId },
      include: { executions: { orderBy: { executedAt: 'desc' }, take: 5 } },
    });
    if (!row) throw missing('Shift rotation');
    const [presented] = await this.present(supplierId, [row]);
    return presented!;
  }

  private async present(supplierId: string, rows: RotationWithExecutions[]) {
    const ids = [...new Set(rows.flatMap((row) => row.shiftTemplateIds))];
    const shifts = ids.length
      ? await this.prisma.shiftTemplate.findMany({
          where: { supplierId, id: { in: ids } },
          select: { id: true, name: true, active: true, deletedAt: true },
        })
      : [];
    const byId = new Map(shifts.map((shift) => [shift.id, shift]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      shifts: row.shiftTemplateIds.map((shiftId) => {
        const shift = byId.get(shiftId);
        return {
          id: shiftId,
          name: shift?.name ?? 'Shift dihapus',
          active: Boolean(shift?.active),
          available: Boolean(shift && !shift.deletedAt),
        };
      }),
      dayOfWeek: row.dayOfWeek,
      executeTime: minuteToTime(row.executeMinute),
      timezone: row.timezone,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      lastRunStatus: (row.lastRunStatus as 'SUCCESS' | 'SKIPPED' | null) ?? null,
      lastRunMessage: row.lastRunMessage,
      executions: row.executions.map(presentExecution),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}

function presentExecution(execution: ShiftRotationExecution) {
  return {
    id: execution.id,
    scheduledForAt: execution.scheduledForAt.toISOString(),
    executedAt: execution.executedAt.toISOString(),
    status: execution.status as 'SUCCESS' | 'SKIPPED',
    trigger: execution.trigger as 'SCHEDULE' | 'MANUAL',
    affectedLines: execution.affectedLines,
    message: execution.message,
  };
}

function parseTime(value: string) {
  try {
    return timeToMinute(value);
  } catch {
    throw validation('Jam rotasi tidak valid.');
  }
}

function validTimezone(value: string) {
  try {
    assertIanaTimezone(value);
  } catch {
    throw validation('Timezone IANA tidak valid.');
  }
}

function validation(detail: string) {
  return new ProblemException({
    status: 400,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    detail,
  });
}

function stateConflict(detail: string) {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Jadwal rotasi',
    detail,
  });
}
