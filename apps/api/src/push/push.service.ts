import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  CreatePushSubscriptionRequest,
  DeletePushSubscriptionRequest,
} from '@tmmin-henkaten/contracts';
import { installationIdSchema } from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import type { ContextRequest, RequestPrincipal } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';

type PushClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PushSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  installationId(request: ContextRequest): string | null {
    const parsed = installationIdSchema.safeParse(request.header('X-Device-Installation-ID'));
    return parsed.success ? parsed.data : null;
  }

  async configFor(principal: RequestPrincipal, installationId: string | null) {
    const subscription = installationId
      ? await this.prisma.pushSubscription.findFirst({
          where: {
            userId: principal.userId,
            installationId,
            status: 'ACTIVE',
            OR: [{ expirationAt: null }, { expirationAt: { gt: new Date() } }],
          },
          orderBy: { updatedAt: 'desc' },
        })
      : null;
    return {
      enabled: this.config.pushEnabled,
      mandatory: principal.role === 'LINE_LEADER' && principal.purpose === 'NORMAL',
      applicationServerKey: this.config.pushEnabled ? this.config.pushVapidPublicKey : null,
      permissionGuidance: {
        explicitGestureRequired: true as const,
        iosHomeScreenRequired: true as const,
        minimumIosVersion: '16.4' as const,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            expirationAt: subscription.expirationAt?.toISOString() ?? null,
            lastAcceptedAt: subscription.lastAcceptedAt?.toISOString() ?? null,
            version: subscription.version,
          }
        : null,
    };
  }

  async subscribe(
    principal: RequestPrincipal,
    installationId: string | null,
    input: CreatePushSubscriptionRequest,
    correlationId: string,
  ) {
    if (!this.config.pushEnabled) throw pushUnavailable();
    if (!principal.supplierId || !installationId) throw installationRequired();
    this.assertEndpointAllowed(input.endpoint);
    const endpointHash = createHash('sha256').update(input.endpoint).digest('hex');
    const expirationAt = input.expirationTime === null ? null : new Date(input.expirationTime);
    if (expirationAt && expirationAt <= new Date()) {
      throw new ProblemException({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Expired push subscription',
        detail: 'The browser push subscription has already expired.',
      });
    }
    const now = new Date();
    const subscription = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.pushSubscription.findUnique({
        where: { endpointHash },
      });
      if (
        existing &&
        (existing.userId !== principal.userId || existing.installationId !== installationId)
      ) {
        await transaction.pushDelivery.updateMany({
          where: { subscriptionId: existing.id, status: 'PENDING' },
          data: {
            status: 'PERMANENT_FAILURE',
            failedAt: now,
            safeFailureClass: 'SubscriptionReassigned',
            lockedAt: null,
            lockedBy: null,
          },
        });
      }
      return transaction.pushSubscription.upsert({
        where: { endpointHash },
        create: {
          supplierId: principal.supplierId!,
          userId: principal.userId,
          installationId,
          endpointHash,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationAt,
        },
        update: {
          supplierId: principal.supplierId!,
          userId: principal.userId,
          installationId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationAt,
          status: 'ACTIVE',
          revokedAt: null,
          lastFailureAt: null,
          lastFailureClass: null,
          version: { increment: 1 },
        },
      });
    });
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: principal.userId,
      actorRole: principal.role,
      actorSupplierId: principal.supplierId,
      supplierId: principal.supplierId,
      action: 'PUSH_SUBSCRIPTION_ENABLED',
      resourceType: 'PushSubscription',
      resourceId: subscription.id,
      changeSummary: { installationId },
      correlationId,
    });
    return presentSubscription(subscription);
  }

  async revoke(
    principal: RequestPrincipal,
    id: string,
    input: DeletePushSubscriptionRequest,
    correlationId: string,
  ) {
    const current = await this.prisma.pushSubscription.findFirst({
      where: { id, userId: principal.userId },
    });
    if (!current) throw missingSubscription();
    if (current.version !== input.expectedVersion) throw versionConflict();
    const updated = await this.prisma.pushSubscription.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } },
    });
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: principal.userId,
      actorRole: principal.role,
      ...(principal.supplierId
        ? { actorSupplierId: principal.supplierId, supplierId: principal.supplierId }
        : {}),
      action: 'PUSH_SUBSCRIPTION_DISABLED',
      resourceType: 'PushSubscription',
      resourceId: id,
      correlationId,
    });
    return presentSubscription(updated);
  }

  async revokeInstallation(userId: string, installationId: string | null): Promise<void> {
    if (!installationId) return;
    await this.revokeWhere({ userId, installationId });
  }

  async revokeUser(userId: string, client: PushClient = this.prisma): Promise<void> {
    await this.revokeWhere({ userId }, client);
  }

  async revokeSupplier(supplierId: string, client: PushClient = this.prisma): Promise<void> {
    await this.revokeWhere({ supplierId }, client);
  }

  async isCompliant(principal: RequestPrincipal, installationId: string | null): Promise<boolean> {
    if (
      !this.config.pushEnabled ||
      principal.role !== 'LINE_LEADER' ||
      principal.purpose !== 'NORMAL'
    ) {
      return true;
    }
    if (!installationId) return false;
    return Boolean(
      await this.prisma.pushSubscription.findFirst({
        where: {
          userId: principal.userId,
          installationId,
          status: 'ACTIVE',
          OR: [{ expirationAt: null }, { expirationAt: { gt: new Date() } }],
        },
        select: { id: true },
      }),
    );
  }

  private async revokeWhere(
    where: { userId?: string; supplierId?: string; installationId?: string },
    client: PushClient = this.prisma,
  ): Promise<void> {
    await client.pushSubscription.updateMany({
      where: { ...where, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } },
    });
  }

  private assertEndpointAllowed(endpoint: string): void {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    const hostAllowed = [...this.config.pushEndpointHosts].some((allowed) =>
      allowed.startsWith('.')
        ? hostname.endsWith(allowed) && hostname.length > allowed.length
        : hostname === allowed,
    );
    if (
      url.protocol !== 'https:' ||
      (url.port && url.port !== '443') ||
      url.username ||
      url.password ||
      !hostAllowed
    ) {
      throw new ProblemException({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Invalid push endpoint',
        detail: 'The browser push endpoint is not supported.',
      });
    }
  }
}

export function installationRequired(): ProblemException {
  return new ProblemException({
    status: 400,
    code: 'VALIDATION_FAILED',
    title: 'Device installation required',
    detail: 'A valid X-Device-Installation-ID header is required.',
  });
}

function pushUnavailable(): ProblemException {
  return new ProblemException({
    status: 503,
    code: 'NOT_READY',
    title: 'Push unavailable',
    detail: 'Supplier push notification is not enabled in this environment.',
  });
}

function missingSubscription(): ProblemException {
  return new ProblemException({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    title: 'Push subscription not found',
    detail: 'The push subscription does not exist or is not owned by this user.',
  });
}

function presentSubscription(row: {
  id: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expirationAt: Date | null;
  lastAcceptedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    status: row.status,
    expirationAt: row.expirationAt?.toISOString() ?? null,
    lastAcceptedAt: row.lastAcceptedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
