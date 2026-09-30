import { createHmac } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  setupCommitRequestSchema,
  setupOperationSchema,
  setupNormalize as norm,
  type SetupCommit,
  type SetupDecision,
  type SetupRow,
  type SetupOperation,
} from '@tmmin-henkaten/contracts';
import { Prisma, type SetupOperation as Operation } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PasswordService } from '../auth/password.service.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { MasterDataAccessService } from './master-data-access.service.js';
import { masterAudit } from './master-data-audit.js';
import { prepareSetupPlan, type PlannedRow } from './setup-plan.js';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const fail = (detail: string, status = 409) =>
  new ProblemException({
    status,
    code: status === 403 ? 'FORBIDDEN' : status === 422 ? 'VALIDATION_FAILED' : 'STATE_CONFLICT',
    title: 'Setup tidak dapat disimpan',
    detail,
  });
type Pending = { body: SetupCommit; hashes: Record<string, string>; context: MutationContext };

@Injectable()
export class SetupService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(SetupService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | undefined;
  private stopping = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly access: MasterDataAccessService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    private readonly limiter: RateLimiterService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.schedule();
  }
  private schedule() {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.processNext()
        .catch(() => this.logger.warn('Setup operation polling failed'))
        .finally(() => {
          this.inFlight = undefined;
          this.schedule();
        });
    }, 1000);
    this.timer.unref();
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  async preview(principal: RequestPrincipal, rows: SetupRow[], decisions?: SetupDecision[]) {
    const scope = await this.access.assertWritable(principal);
    const safeRows = rows.map((r) => ({
      ...r,
      data: Object.fromEntries(Object.entries(r.data).filter(([k]) => k !== 'password')),
    }));
    const prepared = await this.prisma.$transaction(
      (tx) => prepareSetupPlan(tx, scope.supplierId, safeRows, decisions),
      { isolationLevel: 'RepeatableRead', timeout: 60_000 },
    );
    return {
      revision: prepared.revision,
      rows: prepared.plan.map((p) => p.diff),
      issues: prepared.issues,
      warnings: prepared.warnings,
      candidates: prepared.candidates,
    };
  }

  private async digest(
    value: unknown,
    principal: RequestPrincipal,
    key: string,
    kind: 'IMPORT' | 'RESET',
  ) {
    // A secret, request-scoped salt keeps retries deterministic without sharing password
    // fingerprints between operations. The payload includes credentials, so use Argon2id
    // with the same work budget as account passwords rather than a fast request hash.
    const salt = createHmac('sha256', this.config.authThrottleSecret)
      .update(
        JSON.stringify(['setup-digest-v1', principal.supplierId, principal.userId, kind, key]),
      )
      .digest();
    const digest = await argon2.hash(JSON.stringify(value), {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryKib,
      timeCost: this.config.argon2Iterations,
      parallelism: this.config.argon2Parallelism,
      hashLength: 32,
      salt,
      raw: true,
    });
    return digest.toString('hex');
  }
  private async prior(principal: RequestPrincipal, key: string, digest: string, kind: string) {
    const operation = await this.prisma.setupOperation.findUnique({
      where: {
        supplierId_requestedById_key: {
          supplierId: principal.supplierId!,
          requestedById: principal.userId,
          key,
        },
      },
    });
    if (operation && (operation.digest !== digest || operation.kind !== kind))
      throw fail('Permintaan retry berbeda. Mulai review baru.');
    return operation ? this.present(operation) : null;
  }

  async commit(
    principal: RequestPrincipal,
    input: SetupCommit,
    key: string,
    context: MutationContext,
  ) {
    const scope = await this.access.assertWritable(principal);
    const digest = await this.digest(input, principal, key, 'IMPORT');
    const previous = await this.prior(principal, key, digest, 'IMPORT');
    if (previous) return previous;
    const prepared = await this.prisma.$transaction(
      (tx) => prepareSetupPlan(tx, scope.supplierId, input.rows, input.decisions, true),
      { isolationLevel: 'RepeatableRead', timeout: 60_000 },
    );
    if (prepared.revision !== input.revision)
      throw fail('Setup berubah selama review. Periksa data kembali.');
    if (prepared.issues.length)
      throw new ProblemException({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Data perlu diperbaiki',
        detail: 'Perbaiki error sebelum import.',
        fieldErrors: prepared.issues.slice(0, 100).map((i) => ({
          path: `${i.sheet}.${i.sourceRow}.${i.column}`,
          code: 'INVALID_REFERENCE',
          message: i.message,
        })),
      });
    const hashes: Record<string, string> = {};
    const newAccounts = prepared.plan.filter(
      (p) => p.apply && !p.current && p.row.sheet === 'Member' && p.row.data['role'] !== 'MP',
    );
    for (const p of newAccounts)
      if ((p.row.data['password']?.length ?? 0) < 12 || (p.row.data['password']?.length ?? 0) > 128)
        throw fail(`Member baris ${p.row.sourceRow}: Password awal harus 12–128 karakter.`, 422);
    // Two bounded Argon2 jobs avoid multiplying the configured memory budget by member count.
    for (let index = 0; index < newAccounts.length; index += 2)
      await Promise.all(
        newAccounts.slice(index, index + 2).map(async (p) => {
          hashes[p.diff.key] = await this.passwords.hash(p.row.data['password']!);
        }),
      );
    const body = {
      ...input,
      rows: input.rows.map((r) => ({
        ...r,
        data: Object.fromEntries(Object.entries(r.data).filter(([k]) => k !== 'password')),
      })),
    };
    const operation = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${scope.supplierId}::uuid FOR UPDATE`;
        await this.authorize(tx, principal.sessionId, scope.supplierId);
        const existing = await tx.setupOperation.findUnique({
          where: {
            supplierId_requestedById_key: {
              supplierId: scope.supplierId,
              requestedById: principal.userId,
              key,
            },
          },
        });
        if (existing) {
          if (existing.digest !== digest || existing.kind !== 'IMPORT')
            throw fail('Permintaan retry berbeda.');
          return existing;
        }
        const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: scope.supplierId } });
        if (supplier.setupRevision !== input.revision)
          throw fail('Setup berubah selama review. Periksa data kembali.');
        if (
          await tx.setupOperation.count({
            where: { supplierId: scope.supplierId, status: { in: ['QUEUED', 'RUNNING'] } },
          })
        )
          throw fail('Import lain sedang berjalan. Tunggu hingga selesai.');
        return tx.setupOperation.create({
          data: {
            supplierId: scope.supplierId,
            requestedById: principal.userId,
            sessionId: principal.sessionId,
            kind: 'IMPORT',
            key,
            digest,
            payload: json({ body, hashes, context }),
          },
        });
      },
      { timeout: 60_000 },
    );
    return this.present(operation);
  }

  async operation(principal: RequestPrincipal, id: string) {
    const scope = await this.access.assertWritable(principal);
    const operation = await this.prisma.setupOperation.findFirst({
      where: { id, supplierId: scope.supplierId, requestedById: principal.userId },
    });
    if (!operation)
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Import tidak ditemukan',
        detail: 'Operasi setup tidak tersedia.',
      });
    return this.present(operation);
  }
  private present(operation: Operation): SetupOperation {
    return setupOperationSchema.parse({
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      error: operation.error,
      result: operation.result,
      createdAt: operation.createdAt.toISOString(),
      finishedAt: operation.finishedAt?.toISOString() ?? null,
    });
  }

  async processNext() {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const selected = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "SetupOperation" WHERE status = 'QUEUED' OR (status = 'RUNNING' AND "leaseUntil" < now()) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!selected[0]) return null;
      return tx.setupOperation.update({
        where: { id: selected[0].id },
        data: { status: 'RUNNING', leaseUntil: new Date(Date.now() + 10 * 60_000) },
      });
    });
    if (!claimed) return;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${claimed.supplierId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "SetupOperation" WHERE id = ${claimed.id}::uuid FOR UPDATE`;
          const current = await tx.setupOperation.findUniqueOrThrow({ where: { id: claimed.id } });
          if (current.status === 'COMPLETED' || current.status === 'FAILED') return;
          const principal = await this.authorize(tx, claimed.sessionId, claimed.supplierId);
          const pending = current.payload as unknown as Pending;
          const body = setupCommitRequestSchema.parse(pending.body);
          const prepared = await prepareSetupPlan(
            tx,
            claimed.supplierId,
            body.rows,
            body.decisions,
            true,
          );
          if (prepared.revision !== body.revision)
            throw fail('Setup berubah. Periksa data kembali sebelum import.');
          if (prepared.issues.length)
            throw fail('Referensi setup berubah. Periksa data kembali sebelum import.');
          const result = await this.apply(
            tx,
            claimed.supplierId,
            prepared.plan,
            pending.hashes,
            pending.context,
          );
          const supplier = await tx.supplier.update({
            where: { id: claimed.supplierId },
            data: { setupRevision: { increment: 1 } },
          });
          await this.audit.write(
            masterAudit(
              pending.context,
              claimed.supplierId,
              'SETUP_IMPORTED',
              'SetupOperation',
              claimed.id,
              {
                result,
                ...(principal.impersonatedBy
                  ? { operatorUserId: principal.impersonatedBy.userId }
                  : {}),
              },
            ),
            tx,
          );
          await this.outbox.enqueue(
            {
              eventType: 'MASTER_DATA_CHANGED',
              aggregateType: 'Supplier',
              aggregateId: claimed.supplierId,
              aggregateVersion: supplier.setupRevision,
              supplierId: claimed.supplierId,
              actor: { userId: principal.userId, role: principal.role },
              correlationId: pending.context.correlationId,
              payload: {
                areas: [
                  'assignment-board',
                  'assignment-board-layout',
                  'setup-readiness',
                  'master-data',
                  'tanoko',
                ],
              },
            },
            tx,
          );
          await tx.setupOperation.update({
            where: { id: claimed.id },
            data: {
              status: 'COMPLETED',
              result: json(result),
              payload: Prisma.DbNull,
              leaseUntil: null,
              finishedAt: new Date(),
            },
          });
        },
        { maxWait: 10_000, timeout: 300_000 },
      );
    } catch (error) {
      const detail =
        error instanceof ProblemException
          ? error.problem.detail
          : 'Import gagal. Tidak ada data yang disimpan. Periksa data dan coba lagi.';
      await this.prisma.setupOperation.updateMany({
        where: { id: claimed.id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: detail,
          payload: Prisma.DbNull,
          leaseUntil: null,
          finishedAt: new Date(),
        },
      });
    }
  }

  /** Authorization is locked through the write boundary; no idle timeout extension in the worker. */
  private async authorize(
    tx: Prisma.TransactionClient,
    sessionId: string,
    supplierId: string,
  ): Promise<RequestPrincipal> {
    await tx.$queryRaw`SELECT id FROM "UserSession" WHERE id = ${sessionId}::uuid FOR SHARE`;
    const identity = await tx.userSession.findUnique({ where: { id: sessionId } });
    if (identity)
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${identity.userId}::uuid FOR SHARE`;
    const session = await tx.userSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    const now = new Date();
    if (
      !session ||
      !supplier?.active ||
      session.supplierId !== supplierId ||
      session.realm !== 'SUPPLIER' ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.sourceEpoch !== supplier.sourceEpoch ||
      session.user.status !== 'ACTIVE' ||
      session.user.role !== 'SUPPLIER_ADMIN' ||
      session.user.mustChangePassword ||
      session.passwordEpoch !== session.user.passwordEpoch ||
      session.authorizationEpoch !== session.user.authorizationEpoch
    )
      throw fail('Sesi admin tidak berlaku. Masuk kembali untuk melanjutkan.', 403);
    if (session.purpose === 'NORMAL' && supplier.sourceMode !== 'HOSTED')
      throw fail('Setup tidak dapat diubah pada mode supplier ini.', 403);
    if (
      session.purpose === 'HOSTED_PREPARATION' &&
      (supplier.sourceMode !== 'EXTERNAL' ||
        !(await tx.hostedPreparation.count({
          where: {
            supplierId,
            status: 'ACTIVE',
            sourceEpoch: supplier.sourceEpoch,
            adminUserId: session.userId,
          },
        })))
    )
      throw fail('Persiapan supplier tidak aktif.', 403);
    let impersonatedBy: RequestPrincipal['impersonatedBy'];
    if (session.impersonatedBySessionId) {
      await tx.$queryRaw`SELECT id FROM "UserSession" WHERE id = ${session.impersonatedBySessionId}::uuid FOR SHARE`;
      const actorIdentity = await tx.userSession.findUnique({
        where: { id: session.impersonatedBySessionId },
      });
      if (actorIdentity)
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorIdentity.userId}::uuid FOR SHARE`;
      const actor = await tx.userSession.findUnique({
        where: { id: session.impersonatedBySessionId },
        include: { user: true },
      });
      if (
        !actor ||
        actor.realm !== 'TMMIN' ||
        actor.userId !== session.impersonatedByUserId ||
        actor.revokedAt ||
        actor.idleExpiresAt <= now ||
        actor.absoluteExpiresAt <= now ||
        actor.user.status !== 'ACTIVE' ||
        actor.user.role !== 'TMMIN_ADMIN' ||
        actor.passwordEpoch !== actor.user.passwordEpoch ||
        actor.authorizationEpoch !== actor.user.authorizationEpoch
      )
        throw fail('Sesi dukungan telah berakhir.', 403);
      impersonatedBy = { userId: actor.userId, displayName: actor.user.displayName };
    }
    return {
      userId: session.userId,
      displayName: session.user.displayName,
      realm: 'SUPPLIER',
      role: 'SUPPLIER_ADMIN',
      supplierId,
      sourceEpoch: supplier.sourceEpoch,
      purpose: session.purpose,
      mustChangePassword: false,
      sessionId,
      rawSessionToken: '',
      ...(impersonatedBy ? { impersonatedBy } : {}),
    };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    supplierId: string,
    plan: PlannedRow[],
    hashes: Record<string, string>,
    context: MutationContext,
  ) {
    const totals = new Map<
      string,
      { sheet: string; created: number; updated: number; skipped: number }
    >();
    const meta = { createdById: context.actorUserId, updatedById: context.actorUserId };
    const updateMeta = { updatedById: context.actorUserId, version: { increment: 1 } };
    // Release affected LL assignments first so an explicitly reviewed swap remains atomic.
    const changedLineShifts = plan
      .filter((p) => p.apply && p.current && p.row.sheet === 'Line Shift')
      .map((p) => p.id);
    if (changedLineShifts.length)
      await tx.lineShift.updateMany({
        where: { supplierId, id: { in: changedLineShifts } },
        data: { lineLeaderMemberId: null },
      });
    const parts = plan.filter((p) => p.apply && !p.current && p.row.sheet === 'Part');
    for (let index = 0; index < parts.length; index += 500) {
      const batch = parts.slice(index, index + 500);
      await tx.part.createMany({
        data: batch.map((p) => ({
          id: p.id,
          supplierId,
          partNumber: p.row.data['code']!,
          normalizedPartNumber: norm(p.row.data['code']!),
          partName: p.row.data['name']!,
          normalizedPartName: norm(p.row.data['name']!),
          ...meta,
        })),
      });
      await this.audit.writeMany(
        batch.map((p) =>
          masterAudit(context, supplierId, 'PART_CREATED', 'Part', p.id, {
            source: 'SETUP_IMPORT',
          }),
        ),
        tx,
      );
    }
    const changedParts = plan.filter((p) => p.apply && p.current && p.row.sheet === 'Part');
    for (let index = 0; index < changedParts.length; index += 500) {
      const batch = changedParts.slice(index, index + 500);
      const payload = JSON.stringify(
        batch.map((p) => ({
          id: p.id,
          name: p.row.data['name']!,
          normalized: norm(p.row.data['name']!),
          restore: p.restore,
        })),
      );
      await tx.$executeRaw`UPDATE "Part" p SET "partName" = s.name, "normalizedPartName" = s.normalized, active = CASE WHEN s.restore THEN true ELSE p.active END, "resetArchivedAt" = CASE WHEN s.restore THEN NULL ELSE p."resetArchivedAt" END, version = p.version + 1, "updatedAt" = CURRENT_TIMESTAMP, "updatedById" = ${context.actorUserId}::uuid FROM jsonb_to_recordset(${payload}::jsonb) AS s(id uuid, name text, normalized text, restore boolean) WHERE p.id = s.id AND p."supplierId" = ${supplierId}::uuid`;
      await this.audit.writeMany(
        batch.map((p) =>
          masterAudit(context, supplierId, 'PART_UPDATED', 'Part', p.id, {
            source: 'SETUP_IMPORT',
            restored: p.restore,
          }),
        ),
        tx,
      );
    }
    for (const p of plan) {
      const sheet = p.row.sheet;
      const counts = totals.get(sheet) ?? { sheet, created: 0, updated: 0, skipped: 0 };
      counts[p.apply ? (p.current ? 'updated' : 'created') : 'skipped']++;
      totals.set(sheet, counts);
      if (!p.apply || sheet === 'Part') continue;
      const d = p.row.data;
      const code = { importCode: d['code']!, normalizedImportCode: norm(d['code'] ?? '') };
      const restored = p.restore ? { active: true, resetArchivedAt: null } : {};
      if (sheet === 'Member') {
        const fields = {
          fullName: d['name']!,
          registrationNumber: d['role'] === 'MP' ? null : d['registration']!,
          normalizedRegistrationNumber: d['role'] === 'MP' ? null : norm(d['registration']!),
          ...code,
        };
        if (p.current) {
          await tx.member.update({
            where: { id: p.id },
            data: { ...fields, ...restored, ...updateMeta },
          });
          if (p.current.userId)
            await tx.user.update({
              where: { id: p.current.userId },
              data: {
                username: d['username']!,
                normalizedUsername: norm(d['username']!),
                displayName: d['name']!,
                ...(p.restore ? { status: 'ACTIVE', authorizationEpoch: { increment: 1 } } : {}),
                ...updateMeta,
              },
            });
        } else {
          await tx.member.create({
            data: {
              id: p.id,
              supplierId,
              role: d['role'] as 'MP' | 'SUPERVISOR' | 'LINE_LEADER' | 'QC',
              ...fields,
              ...meta,
            },
          });
          if (d['role'] !== 'MP') {
            const passwordHash = hashes[p.diff.key];
            if (!passwordHash?.startsWith('$argon2id$'))
              throw fail('Password akun baru belum siap.', 422);
            const user = await tx.user.create({
              data: {
                supplierId,
                memberId: p.id,
                realm: 'SUPPLIER',
                role: d['role'] as 'SUPERVISOR' | 'LINE_LEADER' | 'QC',
                username: d['username']!,
                normalizedUsername: norm(d['username']!),
                displayName: d['name']!,
                passwordHash,
                mustChangePassword: true,
                ...meta,
              },
            });
            await tx.passwordHistory.create({ data: { userId: user.id, passwordHash } });
          }
        }
      } else if (sheet === 'Line') {
        const fields = {
          code: d['code']!,
          normalizedCode: norm(d['code']!),
          name: d['name']!,
          displayOrder: Number(d['order']),
        };
        if (p.current)
          await tx.line.update({
            where: { id: p.id },
            data: { ...fields, ...restored, ...updateMeta },
          });
        else await tx.line.create({ data: { id: p.id, supplierId, ...fields, ...meta } });
      } else if (sheet === 'Job') {
        const fields = {
          ...code,
          name: d['name']!,
          normalizedName: norm(d['name']!),
          displayOrder: Number(d['order']),
          skillCategory: d['category'] || null,
        };
        if (p.current)
          await tx.job.update({
            where: { id: p.id },
            data: { ...fields, ...restored, ...updateMeta },
          });
        else
          await tx.job.create({
            data: { id: p.id, supplierId, lineId: p.refs['line']!, ...fields, ...meta },
          });
      } else if (sheet === 'Shift') {
        const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
        const fields = {
          ...code,
          name: d['name']!,
          startMinute: minute(d['start']!),
          endMinute: minute(d['end']!),
          displayOrder: Number(d['order']),
          timezone: d['timezone']!,
        };
        if (p.current)
          await tx.shiftTemplate.update({
            where: { id: p.id },
            data: { ...fields, ...restored, ...updateMeta },
          });
        else await tx.shiftTemplate.create({ data: { id: p.id, supplierId, ...fields, ...meta } });
      } else if (sheet === 'Line Shift') {
        const fields = {
          supervisorMemberId: p.refs['supervisor'] ?? null,
          lineLeaderMemberId: p.refs['leader'] ?? null,
        };
        if (p.current)
          await tx.lineShift.update({
            where: { id: p.id },
            data: { ...fields, ...restored, ...updateMeta },
          });
        else {
          await tx.lineShift.create({
            data: {
              id: p.id,
              supplierId,
              lineId: p.refs['line']!,
              shiftTemplateId: p.refs['shift']!,
              ...fields,
              ...meta,
            },
          });
          const jobs = await tx.job.findMany({
            where: { supplierId, lineId: p.refs['line']!, active: true },
            select: { id: true },
          });
          await tx.lineShiftJobAssignment.createMany({
            data: jobs.map((j) => ({ supplierId, lineShiftId: p.id, jobId: j.id, ...meta })),
          });
        }
      } else if (sheet === 'Assignment MP') {
        const assignment = await tx.lineShiftJobAssignment.upsert({
          where: {
            supplierId_lineShiftId_jobId: {
              supplierId,
              lineShiftId: p.refs['lineShift']!,
              jobId: p.refs['job']!,
            },
          },
          create: {
            id: p.id,
            supplierId,
            lineShiftId: p.refs['lineShift']!,
            jobId: p.refs['job']!,
            mpMemberId: p.refs['mp'] ?? null,
            ...meta,
          },
          update: { mpMemberId: p.refs['mp'] ?? null, ...updateMeta },
        });
        p.id = assignment.id;
      } else if (sheet === 'Checklist 4M') {
        const category = d['category'] as 'MAN' | 'MACHINE' | 'MATERIAL' | 'METHOD';
        const template = p.current
          ? await tx.checklistTemplate.update({
              where: { id: p.id },
              data: { active: true, ...updateMeta },
            })
          : await tx.checklistTemplate.create({
              data: { id: p.id, supplierId, category, ...meta },
            });
        const latest = await tx.checklistVersion.aggregate({
          where: { templateId: template.id },
          _max: { versionNumber: true },
        });
        await tx.checklistDraftItem.deleteMany({ where: { templateId: template.id, supplierId } });
        const version = await tx.checklistVersion.create({
          data: {
            supplierId,
            templateId: template.id,
            category,
            versionNumber: (latest._max.versionNumber ?? 0) + 1,
            publishedById: context.actorUserId,
            items: { create: p.items! },
          },
        });
        await tx.checklistTemplate.update({
          where: { id: template.id },
          data: { currentVersionId: version.id },
        });
        await this.audit.write(
          masterAudit(
            context,
            supplierId,
            'CHECKLIST_VERSION_PUBLISHED',
            'ChecklistVersion',
            version.id,
            { category, versionNumber: version.versionNumber, source: 'SETUP_IMPORT' },
          ),
          tx,
        );
      }
      await this.audit.write(
        masterAudit(
          context,
          supplierId,
          `SETUP_${p.current ? 'UPDATED' : 'CREATED'}`,
          sheet,
          p.id,
          {
            source: 'SETUP_IMPORT',
            restored: p.restore,
            fields: p.diff.changes.map((c) => c.field),
          },
        ),
        tx,
      );
    }
    // Ensure newly imported jobs participate in every existing active shift on their line.
    const newJobs = plan.filter((p) => p.apply && !p.current && p.row.sheet === 'Job');
    for (const p of newJobs) {
      const shifts = await tx.lineShift.findMany({
        where: { supplierId, lineId: p.refs['line']!, active: true },
        select: { id: true },
      });
      await tx.lineShiftJobAssignment.createMany({
        data: shifts.map((s) => ({ supplierId, lineShiftId: s.id, jobId: p.id, ...meta })),
        skipDuplicates: true,
      });
    }
    return [...totals.values()];
  }

  async resetPreview(principal: RequestPrincipal) {
    const scope = await this.access.assertWritable(principal);
    if (principal.impersonatedBy)
      throw fail('Reset hanya tersedia untuk Supplier Admin yang masuk langsung.', 403);
    return this.prisma.$transaction((tx) => this.resetSummary(tx, scope.supplierId), {
      isolationLevel: 'RepeatableRead',
    });
  }
  private async resetSummary(tx: Prisma.TransactionClient, supplierId: string) {
    const [supplier, openCount, member, line, job, part, shift, lineShift, checklist, account] =
      await Promise.all([
        tx.supplier.findUniqueOrThrow({ where: { id: supplierId } }),
        tx.henkaten.count({ where: { supplierId, status: 'OPEN' } }),
        tx.member.count({ where: { supplierId, resetArchivedAt: null } }),
        tx.line.count({ where: { supplierId, resetArchivedAt: null } }),
        tx.job.count({ where: { supplierId, resetArchivedAt: null } }),
        tx.part.count({ where: { supplierId, resetArchivedAt: null } }),
        tx.shiftTemplate.count({ where: { supplierId, resetArchivedAt: null } }),
        tx.lineShift.count({ where: { supplierId, resetArchivedAt: null } }),
        tx.checklistTemplate.count({
          where: {
            supplierId,
            OR: [{ currentVersionId: { not: null } }, { draftItems: { some: {} } }],
          },
        }),
        tx.user.count({
          where: {
            supplierId,
            role: { in: ['SUPERVISOR', 'LINE_LEADER', 'QC'] },
            member: { resetArchivedAt: null },
          },
        }),
      ]);
    const counts = [
      { label: 'Member', count: member },
      { label: 'Akun member', count: account },
      { label: 'Line', count: line },
      { label: 'Job', count: job },
      { label: 'Part', count: part },
      { label: 'Shift', count: shift },
      { label: 'Line–Shift', count: lineShift },
      { label: 'Checklist 4M', count: checklist },
    ];
    return {
      revision: supplier.setupRevision,
      openCount,
      empty: counts.every((c) => c.count === 0),
      counts,
    };
  }

  async reset(
    principal: RequestPrincipal,
    input: { revision: number; password: string },
    key: string,
    context: MutationContext,
  ) {
    const scope = await this.access.assertWritable(principal);
    if (principal.impersonatedBy)
      throw fail('Reset hanya tersedia untuk Supplier Admin yang masuk langsung.', 403);
    const digest = await this.digest(input, principal, key, 'RESET');
    const previous = await this.prior(principal, key, digest, 'RESET');
    if (previous) return previous;
    const rate = this.limiter.consume(
      'login-account',
      `setup-reset:${principal.userId}`,
      new Date(),
    );
    if (!rate.allowed)
      throw new ProblemException({
        status: 429,
        code: 'RATE_LIMITED',
        title: 'Terlalu banyak percobaan',
        detail: `Coba lagi dalam ${rate.retryAfterSeconds} detik.`,
      });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await this.passwords.verify(user.passwordHash, input.password)))
      throw new ProblemException({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Password tidak sesuai',
        detail: 'Password admin tidak sesuai.',
        fieldErrors: [
          { path: 'password', code: 'INVALID_PASSWORD', message: 'Password admin tidak sesuai.' },
        ],
      });
    const saved = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${scope.supplierId}::uuid FOR UPDATE`;
        await this.authorize(tx, principal.sessionId, scope.supplierId);
        const currentUser = await tx.user.findUniqueOrThrow({ where: { id: principal.userId } });
        if (currentUser.passwordHash !== user.passwordHash)
          throw fail('Password berubah. Verifikasi kembali.');
        const existing = await tx.setupOperation.findUnique({
          where: {
            supplierId_requestedById_key: {
              supplierId: scope.supplierId,
              requestedById: principal.userId,
              key,
            },
          },
        });
        if (existing) {
          if (existing.digest !== digest || existing.kind !== 'RESET')
            throw fail('Permintaan retry berbeda.');
          return existing;
        }
        if (
          await tx.setupOperation.count({
            where: { supplierId: scope.supplierId, status: { in: ['QUEUED', 'RUNNING'] } },
          })
        )
          throw fail('Import sedang berjalan. Tunggu sebelum reset.');
        const summary = await this.resetSummary(tx, scope.supplierId);
        if (summary.revision !== input.revision)
          throw fail('Setup berubah. Perbarui ringkasan reset.');
        if (summary.openCount) throw fail('Selesaikan seluruh Henkaten Open sebelum reset.');
        if (summary.empty) throw fail('Setup sudah kosong.');
        const now = new Date();
        const archive = {
          active: false,
          resetArchivedAt: now,
          version: { increment: 1 },
          updatedById: principal.userId,
        };
        await tx.lineShiftJobAssignment.updateMany({
          where: { supplierId: scope.supplierId },
          data: { mpMemberId: null, version: { increment: 1 }, updatedById: principal.userId },
        });
        await tx.lineShift.updateMany({
          where: { supplierId: scope.supplierId },
          data: { ...archive, supervisorMemberId: null, lineLeaderMemberId: null },
        });
        await tx.defaultLineSupervisor.deleteMany({ where: { supplierId: scope.supplierId } });
        await tx.defaultLineLeader.deleteMany({ where: { supplierId: scope.supplierId } });
        await tx.defaultJobMp.deleteMany({ where: { supplierId: scope.supplierId } });
        await tx.defaultAssignmentSet.updateMany({
          where: { supplierId: scope.supplierId },
          data: { version: { increment: 1 }, updatedById: principal.userId },
        });
        await tx.member.updateMany({ where: { supplierId: scope.supplierId }, data: archive });
        await tx.job.updateMany({ where: { supplierId: scope.supplierId }, data: archive });
        await tx.line.updateMany({ where: { supplierId: scope.supplierId }, data: archive });
        await tx.part.updateMany({ where: { supplierId: scope.supplierId }, data: archive });
        await tx.shiftTemplate.updateMany({
          where: { supplierId: scope.supplierId },
          data: archive,
        });
        const accounts = await tx.user.findMany({
          where: {
            supplierId: scope.supplierId,
            role: { in: ['SUPERVISOR', 'LINE_LEADER', 'QC'] },
          },
          select: { id: true },
        });
        const ids = accounts.map((a) => a.id);
        await tx.user.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'INACTIVE',
            authorizationEpoch: { increment: 1 },
            version: { increment: 1 },
            updatedById: principal.userId,
          },
        });
        await tx.userSession.updateMany({
          where: { userId: { in: ids }, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'USER_DEACTIVATED', version: { increment: 1 } },
        });
        await tx.pushSubscription.updateMany({
          where: { userId: { in: ids }, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: now, version: { increment: 1 } },
        });
        await tx.pushDelivery.updateMany({
          where: {
            supplierId: scope.supplierId,
            subscription: { userId: { in: ids } },
            status: 'PENDING',
          },
          data: { status: 'EXPIRED' },
        });
        await tx.checklistDraftItem.deleteMany({ where: { supplierId: scope.supplierId } });
        await tx.checklistTemplate.updateMany({
          where: { supplierId: scope.supplierId },
          data: {
            active: false,
            currentVersionId: null,
            version: { increment: 1 },
            updatedById: principal.userId,
          },
        });
        const mappings = await tx.tanokoMapping.findMany({
          where: { supplierId: scope.supplierId, level: { not: null } },
          include: { member: true, job: { include: { line: true } } },
        });
        for (let index = 0; index < mappings.length; index += 500)
          await tx.tanokoChange.createMany({
            data: mappings.slice(index, index + 500).map((m) => ({
              supplierId: scope.supplierId,
              memberId: m.memberId,
              jobId: m.jobId,
              lineId: m.job.lineId,
              memberName: m.member.fullName,
              jobName: m.job.name,
              lineName: m.job.line.name,
              previousLevel: m.level,
              level: null,
              actorUserId: principal.userId,
              actorName: principal.displayName,
              actorRole: principal.role,
              note: 'Reset setup',
            })),
          });
        await tx.tanokoMapping.updateMany({
          where: { supplierId: scope.supplierId },
          data: { level: null, version: { increment: 1 } },
        });
        await tx.lineBoardLayout.updateMany({
          where: { supplierId: scope.supplierId },
          data: {
            document: {
              schemaVersion: 1,
              canvas: { width: 2400, height: 1600, background: 'LIGHT_GRID' },
              nodes: [],
            },
            version: { increment: 1 },
            updatedById: principal.userId,
          },
        });
        const supplier = await tx.supplier.update({
          where: { id: scope.supplierId },
          data: { setupRevision: { increment: 1 } },
        });
        const result = summary.counts.map((c) => ({
          sheet: c.label,
          created: 0,
          updated: c.count,
          skipped: 0,
        }));
        const operation = await tx.setupOperation.create({
          data: {
            supplierId: scope.supplierId,
            requestedById: principal.userId,
            sessionId: principal.sessionId,
            kind: 'RESET',
            key,
            digest,
            status: 'COMPLETED',
            result: json(result),
            finishedAt: now,
          },
        });
        await this.audit.write(
          masterAudit(context, scope.supplierId, 'SETUP_RESET', 'SetupOperation', operation.id, {
            counts: summary.counts,
            retainedHistory: true,
          }),
          tx,
        );
        await this.outbox.enqueue(
          {
            eventType: 'MASTER_DATA_CHANGED',
            aggregateType: 'Supplier',
            aggregateId: scope.supplierId,
            aggregateVersion: supplier.setupRevision,
            supplierId: scope.supplierId,
            actor: { userId: principal.userId, role: principal.role },
            correlationId: context.correlationId,
            payload: {
              areas: [
                'assignment-board',
                'assignment-board-layout',
                'setup-readiness',
                'master-data',
                'tanoko',
              ],
            },
          },
          tx,
        );
        return operation;
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    this.limiter.clearAccount(`setup-reset:${principal.userId}`);
    return this.present(saved);
  }
}
