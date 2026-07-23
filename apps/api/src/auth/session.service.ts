import { createHash, createHmac, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { IdentityRealm, SessionPurpose } from '../generated/prisma/client.js';
import { CLOCK, type Clock } from '../common/scope.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../persistence/prisma.service.js';

export type CreatedSession = {
  rawToken: string;
  id: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

@Injectable()
export class SessionService {
  static readonly IDLE_MS = 30 * 60 * 1_000;
  static readonly ABSOLUTE_MS = 12 * 60 * 60 * 1_000;
  static readonly TOUCH_INTERVAL_MS = 60 * 1_000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(
    user: {
      id: string;
      realm: IdentityRealm;
      supplierId: string | null;
      passwordEpoch: number;
      authorizationEpoch: number;
    },
    sourceEpoch: number | null,
    purpose: SessionPurpose,
    client: { sourceIp?: string; userAgent?: string },
  ): Promise<CreatedSession> {
    const rawToken = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const idleExpiresAt = new Date(now.getTime() + SessionService.IDLE_MS);
    const absoluteExpiresAt = new Date(now.getTime() + SessionService.ABSOLUTE_MS);
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        supplierId: user.supplierId,
        realm: user.realm,
        purpose,
        sourceEpoch,
        passwordEpoch: user.passwordEpoch,
        authorizationEpoch: user.authorizationEpoch,
        tokenHash: this.hashToken(rawToken),
        lastActivityAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        ...(client.sourceIp ? { sourceIp: client.sourceIp } : {}),
        ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 512) } : {}),
      },
      select: { id: true },
    });
    return { rawToken, id: session.id, idleExpiresAt, absoluteExpiresAt };
  }

  async resolve(rawToken: string, expectedRealm: IdentityRealm): Promise<RequestPrincipal | null> {
    const now = this.clock.now();
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (!session) return null;
    const [user, supplier] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: session.userId } }),
      session.supplierId
        ? this.prisma.supplier.findUnique({ where: { id: session.supplierId } })
        : Promise.resolve(null),
    ]);
    if (
      !user ||
      session.realm !== expectedRealm ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      user.status !== 'ACTIVE' ||
      user.passwordEpoch !== session.passwordEpoch ||
      user.authorizationEpoch !== session.authorizationEpoch ||
      (supplier && (!supplier.active || supplier.sourceEpoch !== session.sourceEpoch))
    ) {
      return null;
    }

    if (now.getTime() - session.lastActivityAt.getTime() >= SessionService.TOUCH_INTERVAL_MS) {
      await this.prisma.userSession.updateMany({
        where: { id: session.id, version: session.version },
        data: {
          lastActivityAt: now,
          idleExpiresAt: new Date(now.getTime() + SessionService.IDLE_MS),
          version: { increment: 1 },
        },
      });
    }

    return {
      userId: user.id,
      displayName: user.displayName,
      realm: session.realm,
      role: user.role,
      ...(user.supplierId ? { supplierId: user.supplierId } : {}),
      ...(session.sourceEpoch ? { sourceEpoch: session.sourceEpoch } : {}),
      purpose: session.purpose,
      mustChangePassword: user.mustChangePassword,
      sessionId: session.id,
      rawSessionToken: rawToken,
    };
  }

  async revoke(sessionId: string, reason: 'LOGOUT' | 'PASSWORD_CHANGED'): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revocationReason: reason, version: { increment: 1 } },
    });
  }

  async expiry(sessionId: string): Promise<{ idleExpiresAt: Date; absoluteExpiresAt: Date }> {
    return this.prisma.userSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { idleExpiresAt: true, absoluteExpiresAt: true },
    });
  }

  async purpose(sessionId: string): Promise<SessionPurpose> {
    const session = await this.prisma.userSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { purpose: true },
    });
    return session.purpose;
  }

  async revokeUserSessions(
    userId: string,
    reason:
      | 'PASSWORD_CHANGED'
      | 'PASSWORD_RESET'
      | 'USER_DEACTIVATED'
      | 'USER_REACTIVATED'
      | 'PREPARATION_CANCELLED'
      | 'ADMIN_REPLACED'
      | 'OPERATOR_RECOVERY',
  ): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revocationReason: reason, version: { increment: 1 } },
    });
  }

  csrfToken(rawToken: string, sessionId: string, realm: IdentityRealm): string {
    return createHmac('sha256', this.config.sessionCsrfSecret)
      .update(`${rawToken}:${sessionId}:${realm}`)
      .digest('base64url');
  }

  private hashToken(rawToken: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(createHash('sha256').update(rawToken).digest());
  }
}
