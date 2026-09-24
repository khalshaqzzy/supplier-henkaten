import { Injectable } from '@nestjs/common';
import type { TanokoHistoryQuery, TanokoSave, SkillCategory } from '@tmmin-henkaten/contracts';
import type { RequestPrincipal } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { runSerializable } from '../persistence/transaction.js';
import { versionConflict } from '../administration/user-admin.service.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';

@Injectable()
export class TanokoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  private async scope(principal: RequestPrincipal) {
    const supplier =
      principal.realm === 'SUPPLIER' && principal.supplierId
        ? await this.prisma.supplier.findFirst({
            where: {
              id: principal.supplierId,
              active: true,
              sourceMode: 'HOSTED',
              sourceEpoch: principal.sourceEpoch ?? -1,
            },
          })
        : null;
    if (!supplier || principal.purpose !== 'NORMAL')
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Tanoko unavailable',
        detail: 'A current Hosted supplier session is required.',
      });
    return supplier.id;
  }

  async matrix(principal: RequestPrincipal) {
    const supplierId = await this.scope(principal);
    const [members, jobs, mappings] = await this.prisma.$transaction(
      [
        this.prisma.member.findMany({
          where: { supplierId, role: 'MP' },
          select: { id: true, fullName: true, active: true },
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.job.findMany({
          where: { supplierId },
          include: { line: true },
          orderBy: [{ line: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.tanokoMapping.findMany({ where: { supplierId } }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      canEdit: ['SUPPLIER_ADMIN', 'SUPERVISOR'].includes(principal.role),
      members: members.map((m) => ({ id: m.id, name: m.fullName, active: m.active })),
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        lineId: j.lineId,
        lineName: j.line.name,
        lineCode: j.line.code,
        category: j.skillCategory as SkillCategory | null,
        active: j.active && j.line.active,
      })),
      mappings: mappings.map((mapping) => ({
        memberId: mapping.memberId,
        jobId: mapping.jobId,
        level: mapping.level,
        version: mapping.version,
        updatedAt: mapping.updatedAt.toISOString(),
      })),
    };
  }

  async history(principal: RequestPrincipal, query: TanokoHistoryQuery) {
    const supplierId = await this.scope(principal);
    const cursor = query.cursor
      ? await this.prisma.tanokoChange.findFirst({
          where: { id: query.cursor, supplierId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !cursor) throw missing('History cursor');
    const rows = await this.prisma.tanokoChange.findMany({
      where: {
        supplierId,
        ...(query.lineId ? { lineId: query.lineId } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
        ...(query.search
          ? {
              AND: [
                {
                  OR: ['memberName', 'jobName', 'actorName'].map((field) => ({
                    [field]: { contains: query.search, mode: 'insensitive' },
                  })),
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        memberName: r.memberName,
        jobName: r.jobName,
        lineName: r.lineName,
        previousLevel: r.previousLevel,
        level: r.level,
        actorName: r.actorName,
        actorRole: r.actorRole,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async save(
    principal: RequestPrincipal,
    memberId: string,
    jobId: string,
    input: TanokoSave,
    context: MutationContext,
  ) {
    const supplierId = await this.scope(principal);
    if (!['SUPPLIER_ADMIN', 'SUPERVISOR'].includes(principal.role))
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Read only',
        detail: 'Only Supplier Admin and GL can edit Tanoko.',
      });
    const result = await runSerializable(this.prisma, async (tx) => {
      // Supplier lock also coordinates with source cutover and member creation/deactivation.
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          active: true,
          sourceMode: 'HOSTED',
          sourceEpoch: principal.sourceEpoch ?? -1,
        },
      });
      if (!supplier) throw versionConflict();
      const member = await tx.member.findFirst({
        where: { id: memberId, supplierId, role: 'MP', active: true },
      });
      const job = await tx.job.findFirst({
        where: { id: jobId, supplierId, active: true, line: { active: true } },
        include: { line: true },
      });
      if (!member || !job) throw missing('Active MP or job');
      const key = { supplierId, memberId, jobId };
      const current = await tx.tanokoMapping.findUnique({
        where: { supplierId_memberId_jobId: key },
      });
      if ((current?.version ?? null) !== input.expectedVersion) throw versionConflict();
      if ((current?.level ?? null) === input.level) {
        if (current) return current;
        throw new ProblemException({
          status: 422,
          code: 'VALIDATION_FAILED',
          title: 'No change',
          detail: 'Choose a new skill level.',
        });
      }
      const saved = await tx.tanokoMapping.upsert({
        where: { supplierId_memberId_jobId: key },
        create: { ...key, level: input.level },
        update: { level: input.level, version: { increment: 1 } },
      });
      await tx.tanokoChange.create({
        data: {
          ...key,
          lineId: job.lineId,
          memberName: member.fullName,
          jobName: job.name,
          lineName: job.line.name,
          previousLevel: current?.level ?? null,
          level: input.level,
          actorUserId: principal.userId,
          actorName: principal.displayName,
          actorRole: principal.role,
          note: input.note,
        },
      });
      await this.audit.write(
        masterAudit(context, supplierId, 'TANOKO_MAPPING_UPDATED', 'TanokoMapping', saved.id, {
          lineId: job.lineId,
          memberId,
          jobId,
          previousLevel: current?.level ?? null,
          level: input.level,
          version: saved.version,
        }),
        tx,
      );
      return saved;
    });
    return {
      memberId,
      jobId,
      level: result.level,
      version: result.version,
      updatedAt: result.updatedAt.toISOString(),
    };
  }
}
