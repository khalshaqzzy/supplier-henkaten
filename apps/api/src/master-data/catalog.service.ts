import { lockSetupMutation } from './setup-lock.js';
import { Injectable } from '@nestjs/common';

import {
  MAX_ACTIVE_LINES_PER_SUPPLIER,
  type CreateShiftTemplateRequest,
  type MasterListQuery,
  type PartImportCommitRequest,
  type UpdateShiftTemplateRequest,
  type WeeklyScheduleInput,
} from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import {
  presentJob,
  presentLine,
  presentPart,
  presentTmminPart,
  presentShiftTemplate,
} from './master-data-presenters.js';
import { capacity, missing, resourceInUse } from './member.service.js';
import { assertIanaTimezone, timeToMinute } from './shift-time.js';
import {
  isUniformSchedule,
  minuteToTime,
  normalizeWeeklySchedule,
  scheduleColumns,
  uniformWeeklySchedule,
  weeklyScheduleOf,
  type ShiftScheduleSource,
} from './shift-schedule.js';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
  ) {}

  async listLines(scope: TenantScope, query: MasterListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.line.findMany({
      where: {
        supplierId: scope.supplierId,
        deletedAt: null,
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
      where: { id, supplierId: scope.supplierId, deletedAt: null },
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
      if (
        (await tx.line.count({ where: { supplierId: scope.supplierId, active: true } })) >=
        MAX_ACTIVE_LINES_PER_SUPPLIER
      ) {
        throw capacity('lines', MAX_ACTIVE_LINES_PER_SUPPLIER);
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
      await lockSetupMutation(tx, scope.supplierId);
      const current = await tx.line.findFirst({
        where: { id, supplierId: scope.supplierId, deletedAt: null },
      });
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
      const current = await tx.line.findFirst({
        where: { id, supplierId: scope.supplierId, deletedAt: null },
      });
      if (!current) throw missing('Line');
      if (current.version !== expectedVersion) throw versionConflict();
      if (!active) {
        const [jobs, lineShifts, openHenkaten] = await Promise.all([
          tx.job.count({ where: { lineId: id, active: true } }),
          tx.lineShift.count({ where: { supplierId: scope.supplierId, lineId: id, active: true } }),
          tx.henkaten.count({
            where: { deletedAt: null, supplierId: scope.supplierId, lineId: id, status: 'OPEN' },
          }),
        ]);
        if (jobs || lineShifts || openHenkaten)
          throw resourceInUse('Line masih memiliki job, shift, atau Henkaten aktif.');
      } else if (
        (await tx.line.count({ where: { supplierId: scope.supplierId, active: true } })) >=
        MAX_ACTIVE_LINES_PER_SUPPLIER
      ) {
        throw capacity('lines', MAX_ACTIVE_LINES_PER_SUPPLIER);
      }
      const updated = await tx.line.update({
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
        deletedAt: null,
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
    input: { name: string; skillCategory?: string },
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
          ...(input.skillCategory ? { skillCategory: input.skillCategory } : {}),
          normalizedName: normalizeLookup(input.name),
          displayOrder: displayOrder + 1,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      const lineShifts = await tx.lineShift.findMany({
        where: { supplierId: scope.supplierId, lineId },
        select: { id: true },
      });
      if (lineShifts.length) {
        await tx.lineShiftJobAssignment.createMany({
          data: lineShifts.map(({ id: lineShiftId }) => ({
            supplierId: scope.supplierId,
            lineShiftId,
            jobId: created.id,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          })),
        });
      }
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
      where: { id, lineId, supplierId: scope.supplierId, deletedAt: null },
    });
    if (!row) throw missing('Job');
    return presentJob(row);
  }

  async updateJob(
    scope: TenantScope,
    lineId: string,
    id: string,
    input: { expectedVersion: number; name: string; skillCategory?: string },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      const current = await tx.job.findFirst({
        where: { id, lineId, supplierId: scope.supplierId, deletedAt: null },
      });
      if (!current) throw missing('Job');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const updated = await tx.job.update({
        where: { id },
        data: {
          name: input.name.trim(),
          ...(input.skillCategory ? { skillCategory: input.skillCategory } : {}),
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
        where: { id, lineId, supplierId: scope.supplierId, deletedAt: null },
      });
      if (!current) throw missing('Job');
      if (current.version !== expectedVersion) throw versionConflict();
      if (
        !active &&
        (
          await Promise.all([
            tx.lineShiftJobAssignment.count({ where: { supplierId: scope.supplierId, jobId: id } }),
            tx.henkaten.count({
              where: { deletedAt: null, supplierId: scope.supplierId, jobId: id, status: 'OPEN' },
            }),
          ])
        ).some(Boolean)
      ) {
        throw resourceInUse('Job masih digunakan oleh assignment shift atau Henkaten aktif.');
      }
      if (
        active &&
        (await tx.job.count({ where: { supplierId: scope.supplierId, active: true } })) >= 500
      ) {
        throw capacity('jobs', 500);
      }
      const updated = await tx.job.update({
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

  /** TMMIN reads omit the supplier-internal part number from results and search. */
  async listParts(scope: TenantScope, query: MasterListQuery, { internal = true } = {}) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.part.findMany({
      where: {
        supplierId: scope.supplierId,
        deletedAt: null,
        ...activeWhere(query.active),
        ...(query.search
          ? {
              OR: [
                { normalizedPartNumber: { contains: normalizeLookup(query.search) } },
                { partName: { contains: query.search, mode: 'insensitive' } },
                ...(internal
                  ? [{ normalizedInternalPartNumber: { contains: normalizeLookup(query.search) } }]
                  : []),
              ],
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return page(rows, query.limit, internal ? presentPart : presentTmminPart);
  }

  async createPart(
    scope: TenantScope,
    input: { partNumber: string; partName: string; internalPartNumber?: string | null | undefined },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const created = await tx.part.create({
        data: {
          supplierId: scope.supplierId,
          partNumber: input.partNumber.trim(),
          normalizedPartNumber: normalizeLookup(input.partNumber),
          partName: input.partName.trim(),
          normalizedPartName: normalizeLookup(input.partName),
          ...internalPartNumberFields(input.internalPartNumber),
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

  async previewPartImport(
    scope: TenantScope,
    rows: {
      partNumber: string;
      partName: string;
      internalPartNumber?: string | null | undefined;
    }[],
  ) {
    assertDistinctPartNumbers(rows);
    const existing = [] as {
      id: string;
      normalizedPartNumber: string;
      partName: string;
      internalPartNumber: string | null;
      active: boolean;
      version: number;
      deletedAt: Date | null;
    }[];
    for (const batch of chunks(rows, 1_000)) {
      existing.push(
        ...(await this.prisma.part.findMany({
          where: {
            supplierId: scope.supplierId,
            normalizedPartNumber: { in: batch.map((row) => normalizeLookup(row.partNumber)) },
          },
          select: {
            id: true,
            normalizedPartNumber: true,
            partName: true,
            internalPartNumber: true,
            active: true,
            deletedAt: true,
            version: true,
          },
        })),
      );
    }
    const byNumber = preferLiveParts(existing);
    return {
      rows: rows.map((row) => {
        const part = byNumber.get(normalizeLookup(row.partNumber));
        return {
          partNumber: row.partNumber.trim(),
          partName: row.partName.trim(),
          internalPartNumber:
            row.internalPartNumber === undefined
              ? (part?.internalPartNumber ?? null)
              : row.internalPartNumber?.trim() || null,
          existing: part
            ? {
                id: part.id,
                partName: part.partName,
                internalPartNumber: part.internalPartNumber,
                active: part.active,
                deleted: Boolean(part.deletedAt),
                version: part.version,
              }
            : null,
        };
      }),
    };
  }

  async commitPartImport(
    scope: TenantScope,
    rows: PartImportCommitRequest['rows'],
    context: MutationContext,
  ) {
    assertDistinctPartNumbers(rows);
    return this.prisma.$transaction(
      async (tx) => {
        await lockSetupMutation(tx, scope.supplierId);
        await lockSupplier(tx, scope.supplierId);
        const existing = [] as Awaited<ReturnType<typeof tx.part.findMany>>;
        for (const batch of chunks(rows, 1_000)) {
          existing.push(
            ...(await tx.part.findMany({
              where: {
                supplierId: scope.supplierId,
                normalizedPartNumber: { in: batch.map((row) => normalizeLookup(row.partNumber)) },
              },
            })),
          );
        }
        const byNumber = preferLiveParts(existing);
        const creates: PartImportCommitRequest['rows'] = [];
        const updates: {
          id: string;
          partName: string;
          internalPartNumber: string | null;
          version: number;
        }[] = [];
        let skipped = 0;
        for (const row of rows) {
          const normalizedPartNumber = normalizeLookup(row.partNumber);
          const current = byNumber.get(normalizedPartNumber);
          if (row.action === 'SKIP') {
            skipped++;
            continue;
          }
          if (row.action === 'CREATE') {
            if (current)
              throw partImportConflict('A part number already exists. Review the file again.');
            creates.push(row);
            continue;
          }
          if (!current || current.id !== row.existingId || current.version !== row.expectedVersion)
            throw partImportConflict(
              'A part changed while you were reviewing the file. Review the file again.',
            );
          const internalPartNumber =
            row.internalPartNumber === undefined
              ? current.internalPartNumber
              : row.internalPartNumber?.trim() || null;
          if (
            current.partName === row.partName.trim() &&
            current.internalPartNumber === internalPartNumber &&
            !current.deletedAt
          ) {
            skipped++;
            continue;
          }
          updates.push({
            id: current.id,
            partName: row.partName.trim(),
            internalPartNumber,
            version: current.version,
          });
        }
        for (const batch of chunks(creates, 500)) {
          const saved = await tx.part.createManyAndReturn({
            data: batch.map((row) => ({
              supplierId: scope.supplierId,
              partNumber: row.partNumber.trim(),
              normalizedPartNumber: normalizeLookup(row.partNumber),
              partName: row.partName.trim(),
              normalizedPartName: normalizeLookup(row.partName),
              ...internalPartNumberFields(row.internalPartNumber),
              createdById: context.actorUserId,
              updatedById: context.actorUserId,
            })),
            select: { id: true },
          });
          await this.audit.writeMany(
            saved.map((part) =>
              masterAudit(context, scope.supplierId, 'PART_CREATED', 'Part', part.id, {
                source: 'IMPORT',
              }),
            ),
            tx,
          );
        }
        for (const batch of chunks(updates, 500)) {
          const payload = JSON.stringify(
            batch.map((row) => ({
              id: row.id,
              version: row.version,
              partName: row.partName,
              normalizedPartName: normalizeLookup(row.partName),
              internalPartNumber: row.internalPartNumber,
              normalizedInternalPartNumber: row.internalPartNumber
                ? normalizeLookup(row.internalPartNumber)
                : null,
            })),
          );
          const changed = await tx.$executeRaw`
          UPDATE "Part" AS part
          SET "partName" = source."partName",
              "normalizedPartName" = source."normalizedPartName",
              "internalPartNumber" = source."internalPartNumber",
              "normalizedInternalPartNumber" = source."normalizedInternalPartNumber",
              active = CASE WHEN part."deletedAt" IS NOT NULL THEN true ELSE part.active END,
              "resetArchivedAt" = CASE WHEN part."deletedAt" IS NOT NULL THEN NULL ELSE part."resetArchivedAt" END,
              "deletedAt" = NULL,
              version = part.version + 1,
              "updatedAt" = CURRENT_TIMESTAMP,
              "updatedById" = ${context.actorUserId}::uuid
          FROM jsonb_to_recordset(${payload}::jsonb) AS source(
            id uuid, version integer, "partName" text, "normalizedPartName" text,
            "internalPartNumber" text, "normalizedInternalPartNumber" text
          )
          WHERE part.id = source.id AND part."supplierId" = ${scope.supplierId}::uuid
            AND part.version = source.version
        `;
          if (changed !== batch.length)
            throw partImportConflict(
              'A part changed while you were reviewing the file. Review the file again.',
            );
          await this.audit.writeMany(
            batch.map((row) =>
              masterAudit(context, scope.supplierId, 'PART_UPDATED', 'Part', row.id, {
                source: 'IMPORT',
                fields: ['partName', 'internalPartNumber'],
              }),
            ),
            tx,
          );
        }
        return { created: creates.length, updated: updates.length, skipped };
      },
      { maxWait: 10_000, timeout: 300_000 },
    );
  }

  async getPart(scope: TenantScope, id: string) {
    const row = await this.prisma.part.findFirst({
      where: { id, deletedAt: null, supplierId: scope.supplierId },
    });
    if (!row) throw missing('Part');
    return presentPart(row);
  }

  async updatePart(
    scope: TenantScope,
    id: string,
    input: {
      expectedVersion: number;
      partNumber?: string | undefined;
      partName?: string | undefined;
      internalPartNumber?: string | null | undefined;
    },
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSupplier(tx, scope.supplierId);
      const current = await tx.part.findFirst({
        where: { id, deletedAt: null, supplierId: scope.supplierId },
      });
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
          ...internalPartNumberFields(input.internalPartNumber),
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
      await lockSupplier(tx, scope.supplierId);
      const current = await tx.part.findFirst({
        where: { id, deletedAt: null, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Part');
      if (current.version !== expectedVersion) throw versionConflict();
      if (
        !active &&
        (await tx.henkaten.count({
          where: {
            deletedAt: null,
            supplierId: scope.supplierId,
            status: 'OPEN',
            parts: { some: { partId: id } },
          },
        }))
      ) {
        throw resourceInUse('Part is required by an Open Henkaten.');
      }
      const updated = await tx.part.update({
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
        deletedAt: null,
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
    input: CreateShiftTemplateRequest,
    context: MutationContext,
  ) {
    const times = parseShiftSchedule(input, null);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
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
          startMinute: times.startMinute,
          endMinute: times.endMinute,
          timezone: times.timezone,
          weeklySchedule: times.weeklySchedule,
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
      where: { id, supplierId: scope.supplierId, deletedAt: null },
    });
    if (!row) throw missing('Shift Template');
    return presentShiftTemplate(row);
  }

  async updateShiftTemplate(
    scope: TenantScope,
    id: string,
    input: UpdateShiftTemplateRequest,
    context: MutationContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockSetupMutation(tx, scope.supplierId);
      const current = await tx.shiftTemplate.findFirst({
        where: { id, supplierId: scope.supplierId, deletedAt: null },
      });
      if (!current) throw missing('Shift Template');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const times = parseShiftSchedule(input, current);
      const scheduleChanged =
        times.startMinute !== current.startMinute ||
        times.endMinute !== current.endMinute ||
        times.timezone !== current.timezone ||
        JSON.stringify(weeklyScheduleOf(current)) !==
          JSON.stringify(weeklyScheduleOf({ ...times, weeklySchedule: times.storedSchedule }));
      const nameChanged = Boolean(input.name && input.name.trim() !== current.name);
      const updated = await tx.shiftTemplate.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          startMinute: times.startMinute,
          endMinute: times.endMinute,
          timezone: times.timezone,
          weeklySchedule: times.weeklySchedule,
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      if (scheduleChanged || nameChanged) {
        await tx.lineShift.updateMany({
          where: { supplierId: scope.supplierId, shiftTemplateId: id },
          data: { version: { increment: 1 }, updatedById: context.actorUserId },
        });
      }
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'SHIFT_TEMPLATE_UPDATED', 'ShiftTemplate', id),
        tx,
      );
      if (scheduleChanged || nameChanged) {
        await this.outbox.enqueue(
          {
            eventType: 'SHIFT_TEMPLATE_UPDATED',
            aggregateType: 'ShiftTemplate',
            aggregateId: id,
            aggregateVersion: updated.version,
            supplierId: scope.supplierId,
            actor: { userId: context.actorUserId, role: context.actorRole },
            correlationId: context.correlationId,
            payload: {
              shiftTemplateId: id,
              scheduleChanged,
              nameChanged,
              refresh: ['assignment-board', 'dashboard'],
            },
          },
          tx,
        );
      }
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
      await lockSetupMutation(tx, scope.supplierId);
      const current = await tx.shiftTemplate.findFirst({
        where: { id, supplierId: scope.supplierId, deletedAt: null },
      });
      if (!current) throw missing('Shift Template');
      if (current.version !== expectedVersion) throw versionConflict();
      if (
        !active &&
        (await tx.lineShift.count({
          where: { supplierId: scope.supplierId, shiftTemplateId: id, active: true },
        }))
      ) {
        throw resourceInUse('Shift masih aktif pada Line Setup.');
      }
      const updated = await tx.shiftTemplate.update({
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
      await lockSetupMutation(tx, scope.supplierId);
      const ids = [...items.map(({ id }) => id)].sort();
      if (kind === 'line') {
        await tx.$queryRaw`SELECT id FROM "Line" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const current = await tx.line.findMany({
          where: { supplierId: scope.supplierId, id: { in: ids }, deletedAt: null },
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
    const line = await this.prisma.line.findFirst({
      where: { id, supplierId: scope.supplierId, deletedAt: null },
    });
    if (!line) throw missing('Line');
    return line;
  }
}

/**
 * Maps part numbers to the live part, or to the most recently updated deleted part (which an
 * import may restore) when no live part has that number.
 */
function preferLiveParts<T extends { normalizedPartNumber: string; deletedAt: Date | null }>(
  parts: T[],
) {
  const byNumber = new Map<string, T>();
  for (const part of parts) {
    const current = byNumber.get(part.normalizedPartNumber);
    if (!current || (current.deletedAt && !part.deletedAt))
      byNumber.set(part.normalizedPartNumber, part);
  }
  return byNumber;
}

function activeWhere(active: MasterListQuery['active']) {
  return active === 'ACTIVE' ? { active: true } : active === 'INACTIVE' ? { active: false } : {};
}

/** Undefined keeps the stored internal part number; blank or null clears it. */
function internalPartNumberFields(value: string | null | undefined) {
  if (value === undefined) return {};
  const trimmed = value?.trim() || null;
  return {
    internalPartNumber: trimmed,
    normalizedInternalPartNumber: trimmed ? normalizeLookup(trimmed) : null,
  };
}

function assertDistinctPartNumbers(rows: { partNumber: string }[]) {
  const numbers = rows.map((row) => normalizeLookup(row.partNumber));
  if (new Set(numbers).size !== numbers.length) {
    throw new ProblemException({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Duplicate part numbers',
      detail: 'The file contains a part number more than once.',
    });
  }
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) yield items.slice(index, index + size);
}

function partImportConflict(detail: string) {
  return new ProblemException({
    status: 409,
    code: 'VERSION_CONFLICT',
    title: 'Import review is out of date',
    detail,
  });
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
  await lockSetupMutation(tx, supplierId);
}

/**
 * Resolves the stored schedule from a create/update request. A weekly schedule wins; plain
 * start/end times set every day to the same hours; omitted fields keep the current schedule.
 */
function parseShiftSchedule(
  input: {
    startTime?: string | undefined;
    endTime?: string | undefined;
    timezone?: string | undefined;
    weeklySchedule?: WeeklyScheduleInput | undefined;
  },
  current: ShiftScheduleSource | null,
) {
  try {
    const timezone = input.timezone ?? current?.timezone;
    if (!timezone) throw new Error('MissingTimezone');
    assertIanaTimezone(timezone);
    let days;
    if (input.weeklySchedule) {
      days = normalizeWeeklySchedule(
        input.weeklySchedule.map((day) =>
          day.isOff
            ? { dayOfWeek: day.dayOfWeek, isOff: true }
            : {
                dayOfWeek: day.dayOfWeek,
                isOff: false,
                startMinute: timeToMinute(day.startTime),
                endMinute: timeToMinute(day.endTime),
              },
        ),
      );
    } else if (input.startTime !== undefined || input.endTime !== undefined || !current) {
      const startMinute = timeToMinute(input.startTime ?? minuteToTime(current!.startMinute));
      const endMinute = timeToMinute(input.endTime ?? minuteToTime(current!.endMinute));
      if (startMinute === endMinute) throw new Error('EqualShiftTimes');
      days = uniformWeeklySchedule(startMinute, endMinute);
    } else {
      days = weeklyScheduleOf(current);
    }
    const columns = scheduleColumns(days);
    return {
      ...columns,
      timezone,
      storedSchedule: isUniformSchedule(days) ? null : (days as unknown as Prisma.JsonValue),
    };
  } catch {
    throw new ProblemException({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Validation failed',
      detail: 'Jam shift atau timezone IANA tidak valid.',
    });
  }
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
