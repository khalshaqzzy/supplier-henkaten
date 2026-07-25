import { Injectable } from '@nestjs/common';

import type { Prisma, User } from '../generated/prisma/client.js';
import { ProblemException } from '../common/problem.js';
import { PasswordService } from '../auth/password.service.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import type { MutationContext } from './mutation-context.js';
import { decodeCursor, encodeCursor, presentUser } from './presenters.js';
import type { QualityUserListQuery } from '@tmmin-henkaten/contracts';

@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditWriter,
  ) {}

  async listQuality(query: QualityUserListQuery) {
    const cursorId = decodeCursor(query.cursor);
    const users = await this.prisma.user.findMany({
      where: {
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { username: { contains: query.search, mode: 'insensitive' as const } },
                { displayName: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy:
        query.sort === 'UPDATED_DESC'
          ? [{ updatedAt: 'desc' }, { id: 'desc' }]
          : [{ username: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    const hasNextPage = users.length > query.limit;
    const items = hasNextPage ? users.slice(0, query.limit) : users;
    return {
      items: items.map(presentUser),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)?.id as string) : null,
      },
    };
  }

  async getQuality(id: string): Promise<ReturnType<typeof presentUser>> {
    return presentUser(await this.requireQuality(id));
  }

  async createQuality(input: { username: string; displayName: string }, context: MutationContext) {
    const temporaryPassword = this.passwords.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const user = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          realm: 'TMMIN',
          role: 'TMMIN_QUALITY',
          username: input.username.trim(),
          normalizedUsername: normalizeLookup(input.username),
          displayName: input.displayName.trim(),
          passwordHash,
          createdById: context.actorUserId,
        },
      });
      await transaction.passwordHistory.create({
        data: { userId: created.id, passwordHash },
      });
      await this.audit.write(
        auditInput(context, 'TMMIN_QUALITY_CREATED', created.id, {
          role: created.role,
          username: created.username,
        }),
        transaction,
      );
      return created;
    });
    return {
      user: presentUser(user),
      credential: { username: user.username, temporaryPassword },
    };
  }

  setQualityStatus(id: string, expectedVersion: number, active: boolean, context: MutationContext) {
    return this.mutateQuality(id, expectedVersion, context, async (transaction, user) => {
      const updated = await transaction.user.update({
        where: { id: user.id },
        data: {
          status: active ? 'ACTIVE' : 'INACTIVE',
          authorizationEpoch: { increment: 1 },
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await transaction.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
          version: { increment: 1 },
        },
      });
      return { response: presentUser(updated), action: active ? 'REACTIVATED' : 'DEACTIVATED' };
    });
  }

  async resetQuality(id: string, expectedVersion: number, context: MutationContext) {
    const temporaryPassword = this.passwords.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const user = await this.mutateQuality(
      id,
      expectedVersion,
      context,
      async (transaction, current) => {
        const updated = await transaction.user.update({
          where: { id: current.id },
          data: {
            passwordHash,
            mustChangePassword: true,
            passwordEpoch: { increment: 1 },
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
        });
        await transaction.passwordHistory.create({
          data: { userId: current.id, passwordHash },
        });
        await trimPasswordHistory(transaction, current.id);
        await transaction.userSession.updateMany({
          where: { userId: current.id, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revocationReason: 'PASSWORD_RESET',
            version: { increment: 1 },
          },
        });
        return { response: updated, action: 'PASSWORD_RESET' };
      },
    );
    return {
      user: presentUser(user),
      credential: { username: user.username, temporaryPassword },
    };
  }

  private async mutateQuality<T>(
    id: string,
    expectedVersion: number,
    context: MutationContext,
    mutation: (
      transaction: Prisma.TransactionClient,
      user: User,
    ) => Promise<{ response: T; action: string }>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findFirst({
        where: { id, realm: 'TMMIN', role: 'TMMIN_QUALITY' },
      });
      if (!user) throw notFound('TMMIN Quality account');
      if (user.protectedBootstrapAdmin) throw protectedAdmin();
      if (user.version !== expectedVersion) throw versionConflict();
      const result = await mutation(transaction, user);
      await this.audit.write(
        auditInput(context, `TMMIN_QUALITY_${result.action}`, user.id),
        transaction,
      );
      return result.response;
    });
  }

  private async requireQuality(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, realm: 'TMMIN', role: 'TMMIN_QUALITY' },
    });
    if (!user) throw notFound('TMMIN Quality account');
    return user;
  }
}

export async function trimPasswordHistory(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const older = await transaction.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: 5,
    select: { id: true },
  });
  if (older.length) {
    await transaction.passwordHistory.deleteMany({
      where: { id: { in: older.map(({ id }) => id) } },
    });
  }
}

export function auditInput(
  context: MutationContext,
  action: string,
  resourceId: string,
  changeSummary?: Record<string, unknown>,
) {
  return {
    actorKind: 'USER' as const,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
    action,
    resourceType: 'User',
    resourceId,
    ...(changeSummary ? { changeSummary } : {}),
    correlationId: context.correlationId,
    ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  };
}

export function notFound(resource: string): ProblemException {
  return new ProblemException({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    title: 'Resource not found',
    detail: `${resource} was not found.`,
  });
}

export function versionConflict(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'VERSION_CONFLICT',
    title: 'Version conflict',
    detail: 'The resource was changed by another operation.',
  });
}

function protectedAdmin(): ProblemException {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Protected bootstrap administrator',
    detail: 'The bootstrap administrator can only be recovered by the operator command.',
  });
}
