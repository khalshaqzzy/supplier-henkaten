import { timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { IdentityRealm, Prisma, User } from '../generated/prisma/client.js';
import { CLOCK, type Clock } from '../common/scope.js';
import { ProblemException } from '../common/problem.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PasswordService } from './password.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService, type CreatedSession } from './session.service.js';

type LoginInput = {
  realm: IdentityRealm;
  supplierCode?: string;
  username: string;
  password: string;
  sourceIp: string;
  userAgent?: string;
  correlationId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(input: LoginInput): Promise<{ user: User; session: CreatedSession }> {
    const now = this.clock.now();
    const ipLimit = this.limiter.consume('login-ip', input.sourceIp, now);
    if (!ipLimit.allowed) {
      await this.auditLogin(input, null, 'FAILURE', 'AUTH_RATE_LIMITED');
      throw new ProblemException({
        status: 429,
        code: 'RATE_LIMITED',
        title: 'Too many requests',
        detail: `Try again in ${ipLimit.retryAfterSeconds} seconds.`,
      });
    }

    const normalizedUsername = normalizeLookup(input.username);
    const normalizedSupplierCode = input.supplierCode
      ? normalizeLookup(input.supplierCode)
      : undefined;
    const accountKey = `${input.realm}:${normalizedSupplierCode ?? ''}:${normalizedUsername}`;
    const accountLimit = this.limiter.consume('login-account', accountKey, now);
    const user = await this.findLoginUser(input.realm, normalizedUsername, normalizedSupplierCode);

    const blocked =
      !accountLimit.allowed ||
      !user ||
      user.status !== 'ACTIVE' ||
      (user.lockedUntil !== null && user.lockedUntil > now);
    const passwordValid = blocked
      ? (await this.passwords.verifyDummy(input.password), false)
      : await this.passwords.verify(user.passwordHash, input.password);

    if (!user || blocked || !passwordValid) {
      if (user && user.status === 'ACTIVE' && !blocked) await this.recordFailure(user, now);
      await this.auditLogin(input, user, 'FAILURE', 'AUTHENTICATION_FAILED');
      throw authenticationFailed();
    }

    const supplier =
      user.supplierId === null
        ? null
        : await this.prisma.supplier.findUnique({ where: { id: user.supplierId } });
    if (supplier && !supplier.active) {
      await this.passwords.verifyDummy(input.password);
      await this.auditLogin(input, user, 'FAILURE', 'AUTHENTICATION_FAILED');
      throw authenticationFailed();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, failedLoginWindowStartedAt: null, lockedUntil: null },
    });
    const purpose =
      supplier?.sourceMode === 'EXTERNAL' ? 'HOSTED_PREPARATION' : ('NORMAL' as const);
    const session = await this.sessions.create(user, supplier?.sourceEpoch ?? null, purpose, {
      sourceIp: input.sourceIp,
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    await this.auditLogin(input, user, 'SUCCESS', 'AUTHENTICATION_SUCCEEDED');
    return { user, session };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        include: { passwordHistory: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });
      if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
        throw authenticationFailed();
      }
      for (const history of user.passwordHistory) {
        if (await this.passwords.verify(history.passwordHash, newPassword)) {
          throw new ProblemException({
            status: 409,
            code: 'STATE_CONFLICT',
            title: 'Password reuse is not allowed',
            detail: 'The password must differ from the five most recent passwords.',
          });
        }
      }
      const passwordHash = await this.passwords.hash(newPassword);
      await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordEpoch: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await transaction.passwordHistory.create({ data: { userId, passwordHash } });
      const older = await transaction.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        select: { id: true },
      });
      if (older.length > 0) {
        await transaction.passwordHistory.deleteMany({
          where: { id: { in: older.map(({ id }) => id) } },
        });
      }
      await transaction.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: {
          revokedAt: this.clock.now(),
          revocationReason: 'PASSWORD_CHANGED',
          version: { increment: 1 },
        },
      });
      await transaction.pushSubscription.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: this.clock.now(), version: { increment: 1 } },
      });
    });
  }

  private findLoginUser(
    realm: IdentityRealm,
    normalizedUsername: string,
    normalizedSupplierCode?: string,
  ): Promise<User | null> {
    const where: Prisma.UserWhereInput =
      realm === 'TMMIN'
        ? { realm, normalizedUsername }
        : normalizedSupplierCode
          ? {
              realm,
              normalizedUsername,
              supplier: { normalizedCode: normalizedSupplierCode },
            }
          : { id: '__invalid_supplier_login__' };
    return this.prisma.user.findFirst({ where });
  }

  private async recordFailure(user: User, now: Date): Promise<void> {
    const withinWindow =
      user.failedLoginWindowStartedAt !== null &&
      now.getTime() - user.failedLoginWindowStartedAt.getTime() < 15 * 60_000;
    const count = withinWindow ? user.failedLoginCount + 1 : 1;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: count,
        failedLoginWindowStartedAt: withinWindow ? user.failedLoginWindowStartedAt : now,
        lockedUntil: count >= 5 ? new Date(now.getTime() + 15 * 60_000) : null,
      },
    });
  }

  private auditLogin(
    input: LoginInput,
    user: User | null,
    result: 'SUCCESS' | 'FAILURE',
    action: string,
  ): Promise<void> {
    return this.audit.write({
      actorKind: user ? 'USER' : 'SYSTEM',
      ...(user ? { actorUserId: user.id, actorRole: user.role } : {}),
      ...(user?.supplierId
        ? { actorSupplierId: user.supplierId, supplierId: user.supplierId }
        : {}),
      action,
      resourceType: 'Authentication',
      ...(user ? { resourceId: user.id } : {}),
      correlationId: input.correlationId,
      sourceIp: input.sourceIp,
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 512) } : {}),
      result,
    });
  }
}

export function normalizeLookup(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function authenticationFailed(): ProblemException {
  return new ProblemException({
    status: 401,
    code: 'AUTHENTICATION_FAILED',
    title: 'Authentication failed',
    detail: 'The supplied credentials are invalid.',
  });
}

export function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
