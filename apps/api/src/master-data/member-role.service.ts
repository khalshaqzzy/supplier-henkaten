import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ChangeMemberRoleRequest, MemberRolePreview } from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { RequestPrincipal } from '../common/request-context.js';
import type { TenantScope } from '../common/scope.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { ProblemException } from '../common/problem.js';
import { assertCurrentPrincipal } from '../auth/current-principal.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { runSerializable } from '../persistence/transaction.js';
import { lockSetupMutation } from './setup-lock.js';
import { presentMember } from './master-data-presenters.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';

type Role = ChangeMemberRoleRequest['role'];
@Injectable()
export class MemberRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async preview(scope: TenantScope, id: string, role: Role) {
    return this.prisma.$transaction((tx) => this.inspect(tx, scope, id, role), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async inspect(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    id: string,
    role: Role,
  ): Promise<MemberRolePreview> {
    const member = await tx.member.findFirst({
      where: { id, supplierId: scope.supplierId },
      include: { users: true, photos: true },
    });
    if (!member) throw missing('Member');
    if (member.role === 'MP' || member.role === role)
      throw conflict('Pilih role operasional yang berbeda.');
    const account = member.users.find((u) => u.realm === 'SUPPLIER');
    if (!account || account.role !== member.role)
      throw conflict('Akun member perlu diperiksa sebelum role diubah.');
    const isLeader = member.role === 'LINE_LEADER';
    const isSupervisor = member.role === 'SUPERVISOR';
    const shifts =
      isLeader || isSupervisor
        ? await tx.lineShift.findMany({
            where: {
              supplierId: scope.supplierId,
              ...(isLeader ? { lineLeaderMemberId: id } : { supervisorMemberId: id }),
            },
            include: { line: true, shiftTemplate: true },
            orderBy: { id: 'asc' },
          })
        : [];
    const defaults = isLeader
      ? await tx.defaultLineLeader.findMany({
          where: { supplierId: scope.supplierId, lineLeaderMemberId: id },
          include: { line: true },
          orderBy: { id: 'asc' },
        })
      : isSupervisor
        ? await tx.defaultLineSupervisor.findMany({
            where: { supplierId: scope.supplierId, supervisorMemberId: id },
            include: { line: true },
            orderBy: { id: 'asc' },
          })
        : [];
    const henkatens =
      isLeader || isSupervisor
        ? await tx.henkaten.findMany({
            where: {
              supplierId: scope.supplierId,
              deletedAt: null,
              status: 'OPEN',
              ...(isLeader
                ? {
                    OR: [
                      { lineLeaderResponsibility: { memberId: id } },
                      { lineLeaderResponsibility: null, shiftRun: { lineLeaderMemberId: id } },
                    ],
                  }
                : {
                    approvalRoutes: {
                      some: {
                        route: 'SUPERVISOR',
                        status: 'PENDING',
                        currentResponsibleMemberId: id,
                      },
                    },
                  }),
            },
            take: 1001,
            include: { approvalRoutes: true, lineLeaderResponsibility: true },
            orderBy: { id: 'asc' },
          })
        : [];
    const users = await tx.user.findMany({
      where: { supplierId: scope.supplierId, realm: 'SUPPLIER', memberId: { not: null } },
      include: { member: true },
      orderBy: { id: 'asc' },
    });
    const activeShifts = isLeader
      ? await tx.lineShift.findMany({
          where: { supplierId: scope.supplierId, active: true, lineLeaderMemberId: { not: null } },
          select: { id: true, lineLeaderMemberId: true, version: true },
          orderBy: { id: 'asc' },
        })
      : [];
    const leaderDefaults = isLeader
      ? await tx.defaultLineLeader.findMany({
          where: { supplierId: scope.supplierId },
          orderBy: { id: 'asc' },
        })
      : [];
    const pendingQcCount =
      member.role === 'QC'
        ? await tx.henkatenApprovalRoute.count({
            where: {
              supplierId: scope.supplierId,
              route: 'QC',
              status: 'PENDING',
              henkaten: { deletedAt: null, status: 'OPEN' },
            },
          })
        : 0;
    const otherQc = users.some(
      (u) => u.memberId !== id && u.role === 'QC' && u.status === 'ACTIVE' && u.member?.active,
    );
    const dependencies: MemberRolePreview['dependencies'] = [
      ...shifts.map((s) => ({
        kind: 'LINE_SHIFT' as const,
        id: s.id,
        label: `${s.line.code} · ${s.shiftTemplate.name}`,
        detail: s.active ? 'Assignment aktif' : 'Assignment nonaktif',
        version: s.version,
        active: s.active,
      })),
      ...defaults.map((d) => ({
        kind: 'DEFAULT_LINE' as const,
        id: d.id,
        label: d.line.name,
        detail: 'Default assignment',
        version: d.version,
        active: d.line.active,
      })),
      ...henkatens.map((h) => ({
        kind: 'HENKATEN' as const,
        id: h.id,
        label: h.identifier,
        detail: isLeader ? 'Penanggung jawab LL · Open' : 'Approval Supervisor tertunda',
        version: h.version,
        active: true,
      })),
    ];
    const blockers = [];
    if (dependencies.length > 1000)
      blockers.push(
        'Lebih dari 1.000 tanggung jawab terkait. Alihkan sebagian melalui pengaturan assignment atau approval terlebih dahulu.',
      );
    if (pendingQcCount && !otherQc)
      blockers.push(
        'Masih ada approval QC tertunda dan belum ada QC aktif lain. Aktifkan QC pengganti terlebih dahulu.',
      );
    const candidates = users
      .filter(
        (u) =>
          u.memberId !== id && u.role === member.role && u.status === 'ACTIVE' && u.member?.active,
      )
      .map((u) => {
        const occupied =
          isLeader &&
          ((shifts.some((s) => s.active) &&
            activeShifts.some((s) => s.lineLeaderMemberId === u.memberId)) ||
            (defaults.length > 0 &&
              leaderDefaults.some((d) => d.lineLeaderMemberId === u.memberId)));
        return {
          id: u.memberId!,
          fullName: u.member!.fullName,
          registrationNumber: u.member!.registrationNumber,
          available: !occupied,
          unavailableReason: occupied ? 'Sudah memiliki assignment LL lain' : null,
        };
      });
    if (dependencies.length && !candidates.some((c) => c.available))
      blockers.push(
        `Belum ada ${isLeader ? 'Line Leader' : 'Supervisor'} pengganti yang tersedia.`,
      );
    // All operational versions and account eligibility participate in the review revision.
    const revision = hash({
      role,
      memberVersion: member.version,
      accountVersion: account.version,
      dependencies,
      users: users.map((u) => [
        u.id,
        u.version,
        u.status,
        u.role,
        u.member?.version,
        u.member?.active,
      ]),
      activeShifts,
      leaderDefaults,
      henkatens: henkatens.map((h) => [
        h.id,
        h.version,
        h.approvalRoutes.map((a) => [a.id, a.version]),
        h.lineLeaderResponsibility?.version,
      ]),
      pendingQcCount,
    });
    return {
      member: presentMember(member),
      role,
      revision,
      dependencies,
      candidates,
      pendingQcCount,
      blockers,
    };
  }

  async change(
    scope: TenantScope,
    id: string,
    input: ChangeMemberRoleRequest,
    key: string,
    principal: RequestPrincipal,
    context: MutationContext,
  ) {
    const payloadHash = hash({ id, ...input });
    const commandId = await runSerializable(
      this.prisma,
      async (tx) => {
        await lockSetupMutation(tx, scope.supplierId);
        await assertCurrentPrincipal(tx, principal);
        if (principal.role !== 'SUPPLIER_ADMIN' || principal.supplierId !== scope.supplierId)
          throw new ProblemException({
            status: 403,
            code: 'FORBIDDEN',
            title: 'Supplier Admin required',
            detail: 'Hanya Supplier Admin pada supplier ini yang dapat mengubah role.',
          });
        const retry = await tx.memberRoleChange.findUnique({
          where: {
            supplierId_actorUserId_idempotencyKey: {
              supplierId: scope.supplierId,
              actorUserId: principal.userId,
              idempotencyKey: key,
            },
          },
        });
        if (retry) {
          if (retry.payloadHash !== payloadHash)
            throw conflict('Permintaan ulang memiliki isi berbeda.', 'IDEMPOTENCY_CONFLICT');
          return retry.id;
        }
        const review = await this.inspect(tx, scope, id, input.role);
        if (review.revision !== input.revision)
          throw conflict(
            'Data member atau tanggung jawab telah berubah. Muat ulang tinjauan.',
            'VERSION_CONFLICT',
          );
        if (review.blockers.length) throw conflict(review.blockers.join(' '));
        const mappings = new Map(
          input.handovers.map((h) => [`${h.kind}:${h.id}`, h.replacementMemberId]),
        );
        if (
          mappings.size !== input.handovers.length ||
          mappings.size !== review.dependencies.length ||
          review.dependencies.some((d) => !mappings.has(`${d.kind}:${d.id}`))
        )
          throw conflict('Pilih pengganti untuk setiap tanggung jawab.');
        const eligible = new Set(review.candidates.filter((c) => c.available).map((c) => c.id));
        if (input.handovers.some((h) => !eligible.has(h.replacementMemberId)))
          throw conflict(
            'Pengganti tidak aktif, berbeda role, atau sudah memiliki assignment lain.',
          );
        const isLeader = review.member.role === 'LINE_LEADER';
        // A single LL may not take over two active shifts, even when selected in one command.
        const selectedActive = review.dependencies
          .filter((d) => d.kind === 'LINE_SHIFT' && d.active)
          .map((d) => mappings.get(`${d.kind}:${d.id}`));
        if (new Set(selectedActive).size !== selectedActive.length)
          throw conflict('Satu Line Leader hanya dapat menerima satu Line–Shift aktif.');
        for (const dependency of review.dependencies) {
          const replacementMemberId = mappings.get(`${dependency.kind}:${dependency.id}`)!;
          const replacement = review.candidates.find((c) => c.id === replacementMemberId)!;
          if (dependency.kind === 'LINE_SHIFT') {
            await tx.lineShift.update({
              where: { id: dependency.id },
              data: {
                ...(isLeader
                  ? { lineLeaderMemberId: replacementMemberId }
                  : { supervisorMemberId: replacementMemberId }),
                version: { increment: 1 },
                updatedById: principal.userId,
              },
            });
          } else if (dependency.kind === 'DEFAULT_LINE') {
            const data = { version: { increment: 1 }, updatedById: principal.userId };
            if (isLeader)
              await tx.defaultLineLeader.update({
                where: { id: dependency.id },
                data: { ...data, lineLeaderMemberId: replacementMemberId },
              });
            else
              await tx.defaultLineSupervisor.update({
                where: { id: dependency.id },
                data: { ...data, supervisorMemberId: replacementMemberId },
              });
          } else {
            await tx.henkaten.update({
              where: { id: dependency.id },
              data: { version: { increment: 1 } },
            });
            if (isLeader)
              await tx.henkatenLineLeaderResponsibility.upsert({
                where: { henkatenId: dependency.id },
                create: {
                  henkatenId: dependency.id,
                  supplierId: scope.supplierId,
                  memberId: replacementMemberId,
                },
                update: { memberId: replacementMemberId, version: { increment: 1 } },
              });
            else {
              const route = await tx.henkatenApprovalRoute.findUniqueOrThrow({
                where: { henkatenId_route: { henkatenId: dependency.id, route: 'SUPERVISOR' } },
              });
              await tx.henkatenApprovalRoute.update({
                where: { id: route.id },
                data: {
                  currentResponsibleMemberId: replacementMemberId,
                  currentResponsibleNameSnapshot: replacement.fullName,
                  version: { increment: 1 },
                },
              });
              await tx.approvalRouteRouting.create({
                data: {
                  supplierId: scope.supplierId,
                  routeId: route.id,
                  henkatenId: dependency.id,
                  fromMemberId: id,
                  fromNameSnapshot: route.currentResponsibleNameSnapshot,
                  toMemberId: replacementMemberId,
                  toNameSnapshot: replacement.fullName,
                  actorUserId: principal.userId,
                  correlationId: context.correlationId,
                  expectedHenkatenVersion: dependency.version,
                  resultHenkatenVersion: dependency.version + 1,
                  idempotencyKey: hash([key, route.id]),
                  commandPayloadHash: payloadHash,
                },
              });
            }
          }
        }
        const command = await tx.memberRoleChange.create({
          data: {
            supplierId: scope.supplierId,
            memberId: id,
            actorUserId: principal.userId,
            fromRole: review.member.role,
            toRole: input.role,
            memberVersion: review.member.version + 1,
            reason: input.reason,
            idempotencyKey: key,
            payloadHash,
            handovers: input.handovers,
          },
        });
        await tx.member.update({
          where: { id },
          data: { role: input.role, version: { increment: 1 }, updatedById: principal.userId },
        });
        const accountId = review.member.account!.id;
        await tx.user.update({
          where: { id: accountId },
          data: {
            role: input.role,
            version: { increment: 1 },
            authorizationEpoch: { increment: 1 },
            updatedById: principal.userId,
          },
        });
        await tx.userSession.updateMany({
          where: { userId: accountId, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revocationReason: 'ROLE_CHANGED',
            version: { increment: 1 },
          },
        });
        await tx.pushSubscription.updateMany({
          where: { userId: accountId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } },
        });
        await this.audit.write(
          {
            ...masterAudit(context, scope.supplierId, 'MEMBER_ROLE_CHANGED', 'Member', id, {
              commandId: command.id,
              fromRole: review.member.role,
              toRole: input.role,
              handoverCount: input.handovers.length,
              ...(principal.impersonatedBy
                ? { operatorUserId: principal.impersonatedBy.userId }
                : {}),
            }),
            reason: input.reason,
          },
          tx,
        );
        return command.id;
      },
      { timeout: 30000 },
    );
    const member = await this.prisma.member.findUniqueOrThrow({
      where: { id },
      include: { users: true, photos: true },
    });
    return { member: presentMember(member), commandId };
  }
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function conflict(
  detail: string,
  code: 'STATE_CONFLICT' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' = 'STATE_CONFLICT',
) {
  return new ProblemException({ status: 409, code, title: 'Role change conflict', detail });
}
