import { Injectable } from '@nestjs/common';

import type { MasterListQuery } from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import {
  presentJob,
  presentLine,
  presentPart,
  presentShiftTemplate,
} from './master-data-presenters.js';
import { capacity, missing, resourceInUse } from './member.service.js';
import { assertIanaTimezone, timeToMinute } from './shift-time.js';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async listLines(scope: TenantScope, query: MasterListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.line.findMany({
      where: {
        supplierId: scope.supplierId,
        ...activeWhere(query.active),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return page(rows, query.limit, presentLine);
  }

  async getLine(scope: TenantScope, id: string) {
    const row = await this.prisma.line.findFirst({
      where: { id, supplierId: scope.supplierId },
    });
    if (!row) throw missing('Line');
    return presentLine(row);
  }

  async createLine(
    scope: TenantScope,
    input: { code: string; name: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      if ((await tx.line.count({ where: { supplierId: scope.supplierId, active: true } })) >= 20) {
        throw capacity('lines', 20);
      }
      const displayOrder =
        (
          await tx.line.aggregate({
            where: { supplierId: scope.supplierId },
            _max: { displayOrder: true },
          })
        )._max.displayOrder ?? 0;
      const created = await tx.line.create({
        data: {
          supplierId: scope.supplierId,
          code: input.code.trim(),
          normalizedCode: normalizeLookup(input.code),
          name: input.name.trim(),
          displayOrder: displayOrder + 1,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'LINE_CREATED', 'Line', created.id),
        tx,
      );
      return created;
    });
    return presentLine(row);
  }

  async updateLine(
    scope: TenantScope,
    id: string,
    input: { expectedVersion: number; code?: string; name?: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.line.findFirst({ where: { id, supplierId: scope.supplierId } });
      if (!current) throw missing('Line');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const updated = await tx.line.update({
        where: { id },
        data: {
          ...(input.code
            ? { code: input.code.trim(), normalizedCode: normalizeLookup(input.code) }
            : {}),
          ...(input.name ? { name: input.name.trim() } : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'LINE_UPDATED', 'Line', id),
        tx,
      );
      return updated;
    });
    return presentLine(row);
  }

  async setLineActive(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const current = await tx.line.findFirst({ where: { id, supplierId: scope.supplierId } });
      if (!current) throw missing('Line');
      if (current.version !== expectedVersion) throw versionConflict();
      if (!active) {
        const [jobs, supervisor, leader] = await Promise.all([
          tx.job.count({ where: { lineId: id, active: true } }),
          tx.defaultLineSupervisor.count({ where: { lineId: id } }),
          tx.defaultLineLeader.count({ where: { lineId: id } }),
        ]);
        if (jobs || supervisor || leader)
          throw resourceInUse('Line still has active jobs or assignments.');
      } else if (
        (await tx.line.count({ where: { supplierId: scope.supplierId, active: true } })) >= 20
      ) {
        throw capacity('lines', 20);
      }
      const updated = await tx.line.update({
        where: { id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'LINE_ACTIVATED' : 'LINE_DEACTIVATED',
          'Line',
          id,
        ),
        tx,
      );
      return updated;
    });
    return presentLine(row);
  }

  async listJobs(scope: TenantScope, lineId: string, query: MasterListQuery) {
    await this.requireLine(scope, lineId);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.job.findMany({
      where: {
        supplierId: scope.supplierId,
        lineId,
        ...activeWhere(query.active),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return page(rows, query.limit, presentJob);
  }

  async createJob(
    scope: TenantScope,
    lineId: string,
    input: { name: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const line = await tx.line.findFirst({
        where: { id: lineId, supplierId: scope.supplierId, active: true },
      });
      if (!line) throw missing('Active line');
      if ((await tx.job.count({ where: { supplierId: scope.supplierId, active: true } })) >= 500) {
        throw capacity('jobs', 500);
      }
      const displayOrder =
        (await tx.job.aggregate({ where: { lineId }, _max: { displayOrder: true } }))._max
          .displayOrder ?? 0;
      const created = await tx.job.create({
        data: {
          supplierId: scope.supplierId,
          lineId,
          name: input.name.trim(),
          normalizedName: normalizeLookup(input.name),
          displayOrder: displayOrder + 1,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'JOB_CREATED', 'Job', created.id, { lineId }),
        tx,
      );
      return created;
    });
    return presentJob(row);
  }

  async getJob(scope: TenantScope, lineId: string, id: string) {
    const row = await this.prisma.job.findFirst({
      where: { id, lineId, supplierId: scope.supplierId },
    });
    if (!row) throw missing('Job');
    return presentJob(row);
  }

  async updateJob(
    scope: TenantScope,
    lineId: string,
    id: string,
    input: { expectedVersion: number; name: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.job.findFirst({
        where: { id, lineId, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Job');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const updated = await tx.job.update({
        where: { id },
        data: {
          name: input.name.trim(),
          normalizedName: normalizeLookup(input.name),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(masterAudit(context, scope.supplierId, 'JOB_UPDATED', 'Job', id), tx);
      return updated;
    });
    return presentJob(row);
  }

  async setJobActive(
    scope: TenantScope,
    lineId: string,
    id: string,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const current = await tx.job.findFirst({
        where: { id, lineId, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Job');
      if (current.version !== expectedVersion) throw versionConflict();
      if (!active && (await tx.defaultJobMp.count({ where: { jobId: id } }))) {
        throw resourceInUse('Job still has an active default MP.');
      }
      if (
        active &&
        (await tx.job.count({ where: { supplierId: scope.supplierId, active: true } })) >= 500
      ) {
        throw capacity('jobs', 500);
      }
      const updated = await tx.job.update({
        where: { id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'JOB_ACTIVATED' : 'JOB_DEACTIVATED',
          'Job',
          id,
        ),
        tx,
      );
      return updated;
    });
    return presentJob(row);
  }

  async listParts(scope: TenantScope, query: MasterListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.part.findMany({
      where: {
        supplierId: scope.supplierId,
        ...activeWhere(query.active),
        ...(query.search
          ? {
              OR: [
                { normalizedPartNumber: { contains: normalizeLookup(query.search) } },
                { partName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return page(rows, query.limit, presentPart);
  }

  async createPart(
    scope: TenantScope,
    input: { partNumber: string; partName: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.part.create({
        data: {
          supplierId: scope.supplierId,
          partNumber: input.partNumber.trim(),
          normalizedPartNumber: normalizeLookup(input.partNumber),
          partName: input.partName.trim(),
          normalizedPartName: normalizeLookup(input.partName),
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'PART_CREATED', 'Part', created.id),
        tx,
      );
      return created;
    });
    return presentPart(row);
  }

  async getPart(scope: TenantScope, id: string) {
    const row = await this.prisma.part.findFirst({
      where: { id, supplierId: scope.supplierId },
    });
    if (!row) throw missing('Part');
    return presentPart(row);
  }

  async updatePart(
    scope: TenantScope,
    id: string,
    input: { expectedVersion: number; partNumber?: string; partName?: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.part.findFirst({ where: { id, supplierId: scope.supplierId } });
      if (!current) throw missing('Part');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const updated = await tx.part.update({
        where: { id },
        data: {
          ...(input.partNumber
            ? {
                partNumber: input.partNumber.trim(),
                normalizedPartNumber: normalizeLookup(input.partNumber),
              }
            : {}),
          ...(input.partName
            ? {
                partName: input.partName.trim(),
                normalizedPartName: normalizeLookup(input.partName),
              }
            : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'PART_UPDATED', 'Part', id),
        tx,
      );
      return updated;
    });
    return presentPart(row);
  }

  async setPartActive(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.part.findFirst({ where: { id, supplierId: scope.supplierId } });
      if (!current) throw missing('Part');
      if (current.version !== expectedVersion) throw versionConflict();
      const updated = await tx.part.update({
        where: { id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'PART_ACTIVATED' : 'PART_DEACTIVATED',
          'Part',
          id,
        ),
        tx,
      );
      return updated;
    });
    return presentPart(row);
  }

  async listShiftTemplates(scope: TenantScope, query: MasterListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.shiftTemplate.findMany({
      where: {
        supplierId: scope.supplierId,
        ...activeWhere(query.active),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return page(rows, query.limit, presentShiftTemplate);
  }

  async createShiftTemplate(
    scope: TenantScope,
    input: { name: string; startTime: string; endTime: string; timezone: string },
    context: MutationContext,
  ) {
    const times = parseShiftTimes(input.startTime, input.endTime, input.timezone);
    const row = await this.prisma.$transaction(async (tx) => {
      const displayOrder =
        (
          await tx.shiftTemplate.aggregate({
            where: { supplierId: scope.supplierId },
            _max: { displayOrder: true },
          })
        )._max.displayOrder ?? 0;
      const created = await tx.shiftTemplate.create({
        data: {
          supplierId: scope.supplierId,
          name: input.name.trim(),
          displayOrder: displayOrder + 1,
          ...times,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          'SHIFT_TEMPLATE_CREATED',
          'ShiftTemplate',
          created.id,
        ),
        tx,
      );
      return created;
    });
    return presentShiftTemplate(row);
  }

  async getShiftTemplate(scope: TenantScope, id: string) {
    const row = await this.prisma.shiftTemplate.findFirst({
      where: { id, supplierId: scope.supplierId },
    });
    if (!row) throw missing('Shift Template');
    return presentShiftTemplate(row);
  }

  async updateShiftTemplate(
    scope: TenantScope,
    id: string,
    input: {
      expectedVersion: number;
      name?: string;
      startTime?: string;
      endTime?: string;
      timezone?: string;
    },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shiftTemplate.findFirst({
        where: { id, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Shift Template');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const times = parseShiftTimes(
        input.startTime ?? minuteString(current.startMinute),
        input.endTime ?? minuteString(current.endMinute),
        input.timezone ?? current.timezone,
      );
      const updated = await tx.shiftTemplate.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...times,
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'SHIFT_TEMPLATE_UPDATED', 'ShiftTemplate', id),
        tx,
      );
      return updated;
    });
    return presentShiftTemplate(row);
  }

  async setShiftTemplateActive(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shiftTemplate.findFirst({
        where: { id, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Shift Template');
      if (current.version !== expectedVersion) throw versionConflict();
      const updated = await tx.shiftTemplate.update({
        where: { id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'SHIFT_TEMPLATE_ACTIVATED' : 'SHIFT_TEMPLATE_DEACTIVATED',
          'ShiftTemplate',
          id,
        ),
        tx,
      );
      return updated;
    });
    return presentShiftTemplate(row);
  }

  async reorder(
    scope: TenantScope,
    kind: 'line' | 'job' | 'shift',
    items: Array<{ id: string; expectedVersion: number }>,
    context: MutationContext,
    lineId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ids = [...items.map(({ id }) => id)].sort();
      if (kind === 'line') {
        await tx.$queryRaw`SELECT id FROM "Line" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const current = await tx.line.findMany({
          where: { supplierId: scope.supplierId, id: { in: ids } },
        });
        verifyReorder(current, items);
        for (const [index, item] of items.entries()) {
          await tx.line.update({
            where: { id: item.id },
            data: {
              displayOrder: index + 1,
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          });
        }
      } else if (kind === 'job' && lineId) {
        await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const current = await tx.job.findMany({
          where: { supplierId: scope.supplierId, lineId, id: { in: ids } },
        });
        verifyReorder(current, items);
        for (const [index, item] of items.entries()) {
          await tx.job.update({
            where: { id: item.id },
            data: {
              displayOrder: index + 1,
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          });
        }
      } else if (kind === 'shift') {
        await tx.$queryRaw`SELECT id FROM "ShiftTemplate" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const current = await tx.shiftTemplate.findMany({
          where: { supplierId: scope.supplierId, id: { in: ids } },
        });
        verifyReorder(current, items);
        for (const [index, item] of items.entries()) {
          await tx.shiftTemplate.update({
            where: { id: item.id },
            data: {
              displayOrder: index + 1,
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          });
        }
      } else {
        throw missing('Reorder target');
      }
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          `${kind.toUpperCase()}_REORDERED`,
          'MasterData',
          undefined,
          {
            count: items.length,
          },
        ),
        tx,
      );
      return { reordered: items.length };
    });
  }

  private async requireLine(scope: TenantScope, id: string) {
    const line = await this.prisma.line.findFirst({ where: { id, supplierId: scope.supplierId } });
    if (!line) throw missing('Line');
    return line;
  }
}

function activeWhere(active: MasterListQuery['active']) {
  return active === 'ACTIVE' ? { active: true } : active === 'INACTIVE' ? { active: false } : {};
}

function page<T extends { id: string }>(rows: T[], limit: number, presenter: (row: T) => unknown) {
  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    items: items.map(presenter),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)?.id as string) : null,
    },
  };
}

async function lockSupplier(tx: Prisma.TransactionClient, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
}

function parseShiftTimes(startTime: string, endTime: string, timezone: string) {
  try {
    assertIanaTimezone(timezone);
    const startMinute = timeToMinute(startTime);
    const endMinute = timeToMinute(endTime);
    if (startMinute === endMinute) throw new Error('EqualShiftTimes');
    return { startMinute, endMinute, timezone };
  } catch {
    throw new ProblemException({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Validation failed',
      detail: 'Shift time or IANA timezone is invalid.',
    });
  }
}

function minuteString(minute: number) {
  return `${Math.floor(minute / 60)
    .toString()
    .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
}

function verifyReorder(
  current: Array<{ id: string; version: number }>,
  requested: Array<{ id: string; expectedVersion: number }>,
) {
  if (
    current.length !== requested.length ||
    new Set(requested.map(({ id }) => id)).size !== requested.length
  ) {
    throw missing('Reorder resource');
  }
  const versions = new Map(current.map(({ id, version }) => [id, version]));
  if (requested.some(({ id, expectedVersion }) => versions.get(id) !== expectedVersion)) {
    throw versionConflict();
  }
}
