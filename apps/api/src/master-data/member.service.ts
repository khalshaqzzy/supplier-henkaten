import { Injectable } from '@nestjs/common';

import type { CreateMemberRequest, MasterListQuery } from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { PasswordService } from '../auth/password.service.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { TenantScope } from '../common/scope.js';
import { ProblemException } from '../common/problem.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { trimPasswordHistory, versionConflict } from '../administration/user-admin.service.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { masterAudit } from './master-data-audit.js';
import { presentMember } from './master-data-presenters.js';

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditWriter,
  ) {}

  async list(
    scope: TenantScope,
    query: MasterListQuery,
    includeAccount = true,
    photoBase?: string,
  ) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.member.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(query.active === 'ACTIVE'
          ? { active: true }
          : query.active === 'INACTIVE'
            ? { active: false }
            : {}),
        ...(query.search
          ? {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                {
                  normalizedRegistrationNumber: {
                    contains: normalizeLookup(query.search),
                  },
                },
              ],
            }
          : {}),
      },
      include: { users: { where: { realm: 'SUPPLIER' }, take: 1 }, photos: true },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > query.limit;
    const items = hasNextPage ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map((member) => presentMember(member, includeAccount, photoBase)),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)?.id as string) : null,
      },
    };
  }

  async get(scope: TenantScope, id: string, includeAccount = true, photoBase?: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, supplierId: scope.supplierId },
      include: { users: { where: { realm: 'SUPPLIER' }, take: 1 }, photos: true },
    });
    if (!member) throw missing('Member');
    return presentMember(member, includeAccount, photoBase);
  }

  async create(scope: TenantScope, input: CreateMemberRequest, context: MutationContext) {
    const credential =
      input.role === 'MP'
        ? undefined
        : {
            temporaryPassword: this.passwords.temporaryPassword(),
            username: input.username.trim(),
          };
    const passwordHash = credential
      ? await this.passwords.hash(credential.temporaryPassword)
      : undefined;
    const member = await this.prisma.$transaction(async (transaction) => {
      await lockSupplier(transaction, scope.supplierId);
      const count = await transaction.member.count({
        where: { supplierId: scope.supplierId, active: true },
      });
      if (count >= 300) throw capacity('members', 300);
      const created = await transaction.member.create({
        data: {
          supplierId: scope.supplierId,
          fullName: input.fullName.trim(),
          registrationNumber: input.registrationNumber.trim(),
          normalizedRegistrationNumber: normalizeLookup(input.registrationNumber),
          role: input.role,
          createdById: context.actorUserId,
          updatedById: context.actorUserId,
        },
      });
      if (credential && passwordHash) {
        const user = await transaction.user.create({
          data: {
            realm: 'SUPPLIER',
            supplierId: scope.supplierId,
            memberId: created.id,
            role: input.role as 'SUPERVISOR' | 'LINE_LEADER' | 'QC',
            username: credential.username,
            normalizedUsername: normalizeLookup(credential.username),
            displayName: created.fullName,
            passwordHash,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
          },
        });
        await transaction.passwordHistory.create({ data: { userId: user.id, passwordHash } });
      }
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'MEMBER_CREATED', 'Member', created.id, {
          role: created.role,
          accountCreated: Boolean(credential),
        }),
        transaction,
      );
      return created;
    });
    return {
      member: await this.get(scope, member.id),
      ...(credential ? { credential } : {}),
    };
  }

  async update(
    scope: TenantScope,
    id: string,
    input: { expectedVersion: number; fullName?: string; registrationNumber?: string },
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.member.findFirst({
        where: { id, supplierId: scope.supplierId },
      });
      if (!current) throw missing('Member');
      if (current.version !== input.expectedVersion) throw versionConflict();
      const updated = await transaction.member.update({
        where: { id },
        data: {
          ...(input.fullName
            ? {
                fullName: input.fullName.trim(),
              }
            : {}),
          ...(input.registrationNumber
            ? {
                registrationNumber: input.registrationNumber.trim(),
                normalizedRegistrationNumber: normalizeLookup(input.registrationNumber),
              }
            : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      if (input.fullName) {
        await transaction.user.updateMany({
          where: { memberId: id, supplierId: scope.supplierId },
          data: {
            displayName: updated.fullName,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
      }
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'MEMBER_UPDATED', 'Member', id, {
          fields: [
            ...(input.fullName ? ['fullName'] : []),
            ...(input.registrationNumber ? ['registrationNumber'] : []),
          ],
        }),
        transaction,
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
    await this.prisma.$transaction(async (transaction) => {
      await lockSupplier(transaction, scope.supplierId);
      const member = await transaction.member.findFirst({
        where: { id, supplierId: scope.supplierId },
      });
      if (!member) throw missing('Member');
      if (member.version !== expectedVersion) throw versionConflict();
      if (!active) {
        const references = await Promise.all([
          transaction.defaultLineSupervisor.count({ where: { supervisorMemberId: id } }),
          transaction.defaultLineLeader.count({ where: { lineLeaderMemberId: id } }),
          transaction.defaultJobMp.count({ where: { mpMemberId: id } }),
          transaction.shiftRun.count({
            where: {
              supplierId: scope.supplierId,
              status: { in: ['NOT_STARTED', 'ACTIVE'] },
              OR: [{ supervisorMemberId: id }, { lineLeaderMemberId: id }],
            },
          }),
          transaction.workingAssignment.count({
            where: {
              supplierId: scope.supplierId,
              active: true,
              OR: [{ effectiveMpMemberId: id }, { candidateMpMemberId: id }],
            },
          }),
          transaction.mPReservation.count({
            where: { supplierId: scope.supplierId, replacementMpMemberId: id, releasedAt: null },
          }),
          transaction.henkaten.count({
            where: {
              supplierId: scope.supplierId,
              status: 'OPEN',
              OR: [
                { creatorMemberId: id },
                { manDetail: { replacedMpMemberId: id } },
                { manDetail: { replacementMpMemberId: id } },
              ],
            },
          }),
        ]);
        if (references.some(Boolean))
          throw resourceInUse('Member is required by an active operational record.');
      } else {
        const count = await transaction.member.count({
          where: { supplierId: scope.supplierId, active: true },
        });
        if (count >= 300) throw capacity('members', 300);
      }
      await transaction.member.update({
        where: { id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
      });
      if (!active) {
        const users = await transaction.user.findMany({
          where: { memberId: id, supplierId: scope.supplierId },
          select: { id: true },
        });
        const ids = users.map(({ id: userId }) => userId);
        await transaction.user.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'INACTIVE',
            authorizationEpoch: { increment: 1 },
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
        await transaction.userSession.updateMany({
          where: { userId: { in: ids }, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revocationReason: 'USER_DEACTIVATED',
            version: { increment: 1 },
          },
        });
        await transaction.pushSubscription.updateMany({
          where: { userId: { in: ids }, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } },
        });
      }
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'MEMBER_ACTIVATED' : 'MEMBER_DEACTIVATED',
          'Member',
          id,
        ),
        transaction,
      );
    });
    return this.get(scope, id);
  }

  async updateAccount(
    scope: TenantScope,
    memberId: string,
    input: { expectedVersion: number; username: string },
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const user = await requireOperationalUser(transaction, scope, memberId);
      if (user.version !== input.expectedVersion) throw versionConflict();
      await transaction.user.update({
        where: { id: user.id },
        data: {
          username: input.username.trim(),
          normalizedUsername: normalizeLookup(input.username),
          authorizationEpoch: { increment: 1 },
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await revokeSessions(transaction, user.id, 'ROLE_CHANGED');
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'MEMBER_ACCOUNT_UPDATED', 'Member', memberId, {
          fields: ['username'],
        }),
        transaction,
      );
    });
    return this.get(scope, memberId);
  }

  async setAccountActive(
    scope: TenantScope,
    memberId: string,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    const temporaryPassword = active ? this.passwords.temporaryPassword() : undefined;
    const passwordHash = temporaryPassword
      ? await this.passwords.hash(temporaryPassword)
      : undefined;
    const username = await this.prisma.$transaction(async (transaction) => {
      const member = await transaction.member.findFirst({
        where: { id: memberId, supplierId: scope.supplierId },
      });
      if (!member) throw missing('Member');
      if (active && !member.active)
        throw resourceInUse('Inactive member cannot have an active account.');
      const user = await requireOperationalUser(transaction, scope, memberId);
      if (user.version !== expectedVersion) throw versionConflict();
      await transaction.user.update({
        where: { id: user.id },
        data: {
          status: active ? 'ACTIVE' : 'INACTIVE',
          ...(passwordHash
            ? {
                passwordHash,
                mustChangePassword: true,
                passwordEpoch: { increment: 1 },
              }
            : {}),
          authorizationEpoch: { increment: 1 },
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      if (passwordHash) {
        await transaction.passwordHistory.create({ data: { userId: user.id, passwordHash } });
        await trimPasswordHistory(transaction, user.id);
      }
      await revokeSessions(transaction, user.id, active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED');
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'MEMBER_ACCOUNT_ACTIVATED' : 'MEMBER_ACCOUNT_DEACTIVATED',
          'Member',
          memberId,
        ),
        transaction,
      );
      return user.username;
    });
    return {
      member: await this.get(scope, memberId),
      ...(temporaryPassword ? { credential: { username, temporaryPassword } } : {}),
    };
  }

  async resetPassword(
    scope: TenantScope,
    memberId: string,
    expectedVersion: number,
    context: MutationContext,
  ) {
    const temporaryPassword = this.passwords.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const username = await this.prisma.$transaction(async (transaction) => {
      const user = await requireOperationalUser(transaction, scope, memberId);
      if (user.version !== expectedVersion) throw versionConflict();
      await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordEpoch: { increment: 1 },
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await transaction.passwordHistory.create({ data: { userId: user.id, passwordHash } });
      await trimPasswordHistory(transaction, user.id);
      await revokeSessions(transaction, user.id, 'PASSWORD_RESET');
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'MEMBER_ACCOUNT_PASSWORD_RESET', 'Member', memberId),
        transaction,
      );
      return user.username;
    });
    return {
      member: await this.get(scope, memberId),
      credential: { username, temporaryPassword },
    };
  }
}

async function lockSupplier(transaction: Prisma.TransactionClient, supplierId: string) {
  await transaction.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
}

async function requireOperationalUser(
  transaction: Prisma.TransactionClient,
  scope: TenantScope,
  memberId: string,
) {
  const user = await transaction.user.findFirst({
    where: { memberId, supplierId: scope.supplierId, realm: 'SUPPLIER' },
  });
  if (!user) throw missing('Member account');
  return user;
}

async function revokeSessions(
  transaction: Prisma.TransactionClient,
  userId: string,
  reason: 'ROLE_CHANGED' | 'USER_REACTIVATED' | 'USER_DEACTIVATED' | 'PASSWORD_RESET',
) {
  await transaction.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revocationReason: reason, version: { increment: 1 } },
  });
  await transaction.pushSubscription.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } },
  });
}

export function missing(resource: string): ProblemException {
  return new ProblemException({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    title: 'Resource not found',
    detail: `${resource} was not found.`,
  });
}

export function capacity(resource: string, limit: number): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'CAPACITY_EXCEEDED',
    title: 'Capacity exceeded',
    detail: `The supplier can have at most ${limit} active ${resource}.`,
  });
}

export function resourceInUse(detail: string): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'RESOURCE_IN_USE',
    title: 'Resource is in use',
    detail,
  });
}
