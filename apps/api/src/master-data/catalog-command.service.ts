import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DeletePartsRequest, SwapShiftTimesRequest } from '@tmmin-henkaten/contracts';
import { deletePartsResultSchema, swapShiftTimesResultSchema } from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { RequestPrincipal } from '../common/request-context.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { assertCurrentPrincipal } from '../auth/current-principal.js';
import { ProblemException } from '../common/problem.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { runSerializable } from '../persistence/transaction.js';
import { lockSetupMutation } from './setup-lock.js';
import { masterAudit } from './master-data-audit.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = (detail: string) =>
  new ProblemException({
    status: 409,
    code: 'VERSION_CONFLICT',
    title: 'Periksa perubahan',
    detail,
  });
@Injectable()
export class CatalogCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async deletePreview(supplierId: string) {
    return this.prisma.$transaction((tx) => this.inspectParts(tx, supplierId), {
      isolationLevel: 'RepeatableRead',
    });
  }
  private async inspectParts(tx: Prisma.TransactionClient, supplierId: string) {
    const parts = await tx.part.findMany({
      where: { supplierId, deletedAt: null },
      select: { id: true, version: true },
      orderBy: { id: 'asc' },
    });
    return { count: parts.length, revision: hash(parts) };
  }
  async deleteParts(
    principal: RequestPrincipal,
    input: DeletePartsRequest,
    key: string,
    context: MutationContext,
  ) {
    return runSerializable(
      this.prisma,
      async (tx) => {
        const previous = await this.begin(tx, principal, key, { kind: 'DELETE_PARTS', input });
        if (previous) return deletePartsResultSchema.parse(previous.result);
        const supplierId = principal.supplierId!;
        const preview = await this.inspectParts(tx, supplierId);
        if (preview.revision !== input.revision)
          throw conflict('Daftar Part berubah. Muat ulang ringkasan sebelum menghapus.');
        const changed = await tx.part.updateMany({
          where: { supplierId, deletedAt: null },
          data: {
            active: false,
            deletedAt: new Date(),
            version: { increment: 1 },
            updatedById: principal.userId,
          },
        });
        const result = { deleted: changed.count };
        await this.audit.write(
          masterAudit(context, supplierId, 'PARTS_DELETED', 'Part', undefined, {
            ...result,
            ...(principal.impersonatedBy
              ? { operatorUserId: principal.impersonatedBy.userId }
              : {}),
          }),
          tx,
        );
        await this.finish(tx, principal, key, { kind: 'DELETE_PARTS', input }, result);
        return result;
      },
      { timeout: 30_000 },
    );
  }
  async swap(
    principal: RequestPrincipal,
    input: SwapShiftTimesRequest,
    key: string,
    context: MutationContext,
  ) {
    return runSerializable(this.prisma, async (tx) => {
      const previous = await this.begin(tx, principal, key, { kind: 'SWAP_SHIFT_TIMES', input });
      if (previous) return swapShiftTimesResultSchema.parse(previous.result);
      const supplierId = principal.supplierId!;
      const shifts = await tx.shiftTemplate.findMany({
        where: { supplierId, id: { in: [input.first.id, input.second.id] }, active: true },
      });
      const first = shifts.find((s) => s.id === input.first.id);
      const second = shifts.find((s) => s.id === input.second.id);
      if (
        !first ||
        !second ||
        first.id === second.id ||
        first.version !== input.first.expectedVersion ||
        second.version !== input.second.expectedVersion
      )
        throw conflict('Shift berubah atau tidak tersedia. Muat ulang lalu pilih kembali.');
      if (
        first.startMinute === second.startMinute &&
        first.endMinute === second.endMinute &&
        first.timezone === second.timezone
      )
        throw conflict('Kedua shift memiliki waktu yang sama. Pilih pasangan lain.');
      const lines = await tx.lineShift.findMany({
        where: { supplierId, shiftTemplateId: { in: [first.id, second.id] } },
        select: { lineId: true },
      });
      for (const [target, source] of [
        [first, second],
        [second, first],
      ] as const) {
        await tx.shiftTemplate.update({
          where: { id: target.id },
          data: {
            startMinute: source.startMinute,
            endMinute: source.endMinute,
            timezone: source.timezone,
            version: { increment: 1 },
            updatedById: principal.userId,
          },
        });
      }
      await tx.lineShift.updateMany({
        where: { supplierId, shiftTemplateId: { in: [first.id, second.id] } },
        data: { version: { increment: 1 }, updatedById: principal.userId },
      });
      const result = {
        swapped: 2 as const,
        affectedLines: new Set(lines.map((l) => l.lineId)).size,
      };
      await this.audit.write(
        masterAudit(context, supplierId, 'SHIFT_TIMES_SWAPPED', 'ShiftTemplate', undefined, {
          ...(principal.impersonatedBy ? { operatorUserId: principal.impersonatedBy.userId } : {}),
          firstId: first.id,
          secondId: second.id,
          ...result,
        }),
        tx,
      );
      await this.finish(tx, principal, key, { kind: 'SWAP_SHIFT_TIMES', input }, result);
      return result;
    });
  }
  private async begin(
    tx: Prisma.TransactionClient,
    principal: RequestPrincipal,
    key: string,
    payload: unknown,
  ) {
    if (!principal.supplierId || principal.role !== 'SUPPLIER_ADMIN')
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Forbidden',
        detail: 'Supplier Admin diperlukan.',
      });
    await lockSetupMutation(tx, principal.supplierId);
    await assertCurrentPrincipal(tx, principal);
    const previous = await tx.catalogCommand.findUnique({
      where: {
        supplierId_actorUserId_key: {
          supplierId: principal.supplierId,
          actorUserId: principal.userId,
          key,
        },
      },
    });
    if (previous && previous.payloadHash !== hash(payload))
      throw conflict('Permintaan berbeda. Mulai ulang tindakan ini.');
    return previous;
  }
  private async finish(
    tx: Prisma.TransactionClient,
    principal: RequestPrincipal,
    key: string,
    payload: unknown,
    result: Prisma.InputJsonObject,
  ) {
    await tx.catalogCommand.create({
      data: {
        supplierId: principal.supplierId!,
        actorUserId: principal.userId,
        key,
        payloadHash: hash(payload),
        result,
      },
    });
  }
}
