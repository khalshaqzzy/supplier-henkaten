import { Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const PUSH_KINDS = new Set([
  'APPROVAL_PENDING',
  'ASSIGNMENT_VACANCY',
  'ASSIGNMENT_ISSUE',
  'SHIFT_OVERRIDE',
  'SHIFT_START_BLOCKED',
  'MP_RESERVATION',
  'SECURITY',
]);

@Injectable()
export class PushDeliveryService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async materialize(
    notification: {
      id: string;
      supplierId: string;
      recipientUserId: string;
      kind: string;
      title: string;
      body: string;
      resourceType: string;
      resourceId: string;
      deepLink: string | null;
    },
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    if (!this.config.pushEnabled || !PUSH_KINDS.has(notification.kind)) return;
    const subscriptions = await transaction.pushSubscription.findMany({
      where: {
        userId: notification.recipientUserId,
        supplierId: notification.supplierId,
        status: 'ACTIVE',
        OR: [{ expirationAt: null }, { expirationAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (subscriptions.length === 0) return;
    const payload = await this.payload(notification, transaction);
    const expiresAt = new Date(Date.now() + this.config.pushDeliveryTtlSeconds * 1_000);
    await transaction.pushDelivery.createMany({
      data: subscriptions.map((subscription) => ({
        supplierId: notification.supplierId,
        notificationId: notification.id,
        subscriptionId: subscription.id,
        payload,
        expiresAt,
      })),
      skipDuplicates: true,
    });
  }

  private async payload(
    notification: {
      id: string;
      kind: string;
      title: string;
      body: string;
      resourceType: string;
      resourceId: string;
      deepLink: string | null;
    },
    transaction: Prisma.TransactionClient,
  ) {
    if (notification.resourceType === 'Henkaten') {
      const henkaten = await transaction.henkaten.findUnique({
        where: { id: notification.resourceId },
        select: {
          identifier: true,
          category: true,
          status: true,
          line: { select: { code: true } },
          job: { select: { name: true } },
        },
      });
      if (henkaten) {
        return {
          notificationId: notification.id,
          kind: notification.kind,
          title:
            notification.kind === 'MP_RESERVATION'
              ? 'MP reservation membutuhkan perhatian'
              : 'Approval Henkaten menunggu',
          body: `${henkaten.identifier} · ${henkaten.category} · ${henkaten.status} · ${henkaten.line.code} · ${henkaten.job.name}`,
          deepLink: safeDeepLink(notification.deepLink),
          tag: `henkaten:${notification.resourceId}:${notification.kind}`,
        };
      }
    }
    return {
      notificationId: notification.id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      deepLink: safeDeepLink(notification.deepLink),
      tag: `${notification.resourceType}:${notification.resourceId}:${notification.kind}`,
    };
  }
}

function safeDeepLink(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/notifications';
}
