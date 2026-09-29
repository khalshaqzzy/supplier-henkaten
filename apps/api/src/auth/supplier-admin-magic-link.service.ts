import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CLOCK, type Clock } from '../common/scope.js';
import { ProblemException } from '../common/problem.js';
import type { ContextRequest } from '../common/request-context.js';
import { capabilitiesForPrincipal } from '../common/policy.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { cookieName } from './auth.guards.js';
import { SessionService } from './session.service.js';

const TTL_MS = 2 * 60_000;
const invalidLink = () =>
  new ProblemException({
    status: 401,
    code: 'AUTHENTICATION_FAILED',
    title: 'Link unavailable',
    detail: 'This link is invalid, expired, or has already been used.',
  });

@Injectable()
export class SupplierAdminMagicLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(supplierId: string, request: ContextRequest) {
    const principal = request.principal;
    if (!principal || principal.role !== 'TMMIN_ADMIN') throw invalidLink();
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || !supplier.active || supplier.sourceMode !== 'HOSTED') {
      throw new ProblemException({
        status: 409,
        code: 'STATE_CONFLICT',
        title: 'Supplier unavailable',
        detail: 'An active Hosted supplier is required.',
      });
    }
    const admin = await this.prisma.user.findFirst({
      where: { supplierId, realm: 'SUPPLIER', role: 'SUPPLIER_ADMIN', status: 'ACTIVE' },
    });
    if (!admin)
      throw new ProblemException({
        status: 409,
        code: 'STATE_CONFLICT',
        title: 'Administrator unavailable',
        detail: 'An active Supplier Admin is required.',
      });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.clock.now().getTime() + TTL_MS);
    const link = await this.prisma.supplierAdminMagicLink.create({
      data: {
        tokenHash: hash(token),
        supplierId,
        adminUserId: admin.id,
        actorUserId: principal.userId,
        actorSessionId: principal.sessionId,
        sourceEpoch: supplier.sourceEpoch,
        expiresAt,
      },
    });
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: principal.userId,
      actorRole: 'TMMIN_ADMIN',
      supplierId,
      action: 'SUPPLIER_ADMIN_MAGIC_LINK_ISSUED',
      resourceType: 'SupplierAdminMagicLink',
      resourceId: link.id,
      correlationId: request.correlationId ?? 'unavailable',
      ...(request.ip ? { sourceIp: request.ip } : {}),
      ...(request.header('User-Agent') ? { userAgent: request.header('User-Agent')! } : {}),
      result: 'SUCCESS',
    });
    return {
      url: `${this.config.supplierAppOrigin}/magic-login#token=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async redeem(token: string, request: Request, response: Response) {
    if (
      request.header('Origin') !== this.config.supplierAppOrigin ||
      !request.is('application/json')
    )
      throw invalidLink();
    const now = this.clock.now();
    const link = await this.prisma.supplierAdminMagicLink.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!link || link.consumedAt || link.expiresAt <= now) throw invalidLink();
    const [supplier, admin, actor, actorSession] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: link.supplierId } }),
      this.prisma.user.findUnique({ where: { id: link.adminUserId } }),
      this.prisma.user.findUnique({ where: { id: link.actorUserId } }),
      this.prisma.userSession.findUnique({ where: { id: link.actorSessionId } }),
    ]);
    if (
      !supplier?.active ||
      supplier.sourceMode !== 'HOSTED' ||
      supplier.sourceEpoch !== link.sourceEpoch ||
      !admin ||
      admin.status !== 'ACTIVE' ||
      admin.role !== 'SUPPLIER_ADMIN' ||
      admin.supplierId !== supplier.id ||
      !actor ||
      actor.status !== 'ACTIVE' ||
      actor.role !== 'TMMIN_ADMIN' ||
      !actorSession ||
      actorSession.userId !== actor.id ||
      actorSession.revokedAt ||
      actorSession.idleExpiresAt <= now ||
      actorSession.absoluteExpiresAt <= now ||
      actorSession.realm !== 'TMMIN' ||
      actorSession.purpose !== 'NORMAL' ||
      actorSession.supplierId !== null ||
      actorSession.passwordEpoch !== actor.passwordEpoch ||
      actorSession.authorizationEpoch !== actor.authorizationEpoch
    )
      throw invalidLink();
    const consumed = await this.prisma.supplierAdminMagicLink.updateMany({
      where: { id: link.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw invalidLink();
    const session = await this.sessions.create(
      admin,
      supplier.sourceEpoch,
      'NORMAL',
      {
        ...(request.ip ? { sourceIp: request.ip } : {}),
        ...(request.header('User-Agent') ? { userAgent: request.header('User-Agent')! } : {}),
      },
      actor.id,
      actorSession.id,
    );
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: actor.id,
      actorRole: 'TMMIN_ADMIN',
      supplierId: supplier.id,
      action: 'SUPPLIER_ADMIN_MAGIC_LINK_REDEEMED',
      resourceType: 'SupplierAdminMagicLink',
      resourceId: link.id,
      changeSummary: { supplierAdminUserId: admin.id, sessionId: session.id },
      correlationId:
        'correlationId' in request && typeof request.correlationId === 'string'
          ? request.correlationId
          : 'unavailable',
      ...(request.ip ? { sourceIp: request.ip } : {}),
      ...(request.header('User-Agent') ? { userAgent: request.header('User-Agent')! } : {}),
      result: 'SUCCESS',
    });
    response.cookie(cookieName('SUPPLIER', this.config), session.rawToken, {
      httpOnly: true,
      secure: this.config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
      expires: session.absoluteExpiresAt,
    });
    response.setHeader('Cache-Control', 'no-store');
    return {
      principal: {
        userId: admin.id,
        displayName: admin.displayName,
        realm: 'SUPPLIER' as const,
        role: 'SUPPLIER_ADMIN' as const,
        supplierId: supplier.id,
        purpose: 'NORMAL' as const,
        mustChangePassword: false,
        impersonatedBy: { userId: actor.id, displayName: actor.displayName },
      },
      capabilities: [...capabilitiesForPrincipal({ role: 'SUPPLIER_ADMIN', purpose: 'NORMAL' })],
      supplier: {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        timezone: supplier.timezone,
        sourceMode: supplier.sourceMode,
        sourceEpoch: supplier.sourceEpoch,
      },
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      csrfToken: this.sessions.csrfToken(session.rawToken, session.id, 'SUPPLIER'),
    };
  }
}

function hash(token: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash('sha256').update(token).digest());
}
