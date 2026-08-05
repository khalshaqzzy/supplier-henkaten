import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { WEB_PUSH_GATEWAY, classifyPushFailure, type WebPushGateway } from './push.gateway.js';

type ClaimedDelivery = {
  id: string;
  subscriptionId: string;
  attemptCount: number;
  expiresAt: Date;
  payload: unknown;
  endpoint: string;
  p256dh: string;
  auth: string;
  subscriptionUserId: string;
  recipientUserId: string;
};

@Injectable()
export class PushDeliveryWorker implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(PushDeliveryWorker.name);
  private readonly workerId = `push-${process.pid}-${randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WEB_PUSH_GATEWAY) private readonly gateway: WebPushGateway,
  ) {}

  onModuleInit(): void {
    if (this.config.pushEnabled) this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.processBatch()
        .catch((error: unknown) => {
          this.logger.warn(
            { safeErrorClass: error instanceof Error ? error.name : 'UnknownError' },
            'push delivery batch failed',
          );
        })
        .finally(() => {
          this.inFlight = undefined;
          this.schedule(this.config.pushDeliveryPollMs);
        });
    }, delay);
    this.timer.unref();
  }

  async processBatch(): Promise<void> {
    const deliveries = await this.claimBatch();
    for (const delivery of deliveries) await this.process(delivery);
  }

  private async claimBatch(): Promise<ClaimedDelivery[]> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<ClaimedDelivery[]>`
        SELECT delivery.id, delivery."subscriptionId", delivery."attemptCount",
               delivery."expiresAt", delivery.payload, subscription.endpoint,
               subscription.p256dh, subscription.auth,
               subscription."userId" AS "subscriptionUserId",
               notification."recipientUserId"
        FROM "PushDelivery" AS delivery
        JOIN "PushSubscription" AS subscription ON subscription.id = delivery."subscriptionId"
        JOIN "Notification" AS notification ON notification.id = delivery."notificationId"
        WHERE delivery.status = 'PENDING'
          AND delivery."nextAttemptAt" <= now()
          AND (delivery."lockedAt" IS NULL OR delivery."lockedAt" < now() - interval '30 seconds')
        ORDER BY delivery."nextAttemptAt", delivery."createdAt"
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT ${this.config.pushDeliveryBatchSize}
      `;
      if (claimed.length === 0) return [];
      await transaction.pushDelivery.updateMany({
        where: { id: { in: claimed.map(({ id }) => id) } },
        data: { lockedAt: new Date(), lockedBy: this.workerId, attemptCount: { increment: 1 } },
      });
      return claimed.map((delivery) => ({
        ...delivery,
        attemptCount: delivery.attemptCount + 1,
      }));
    });
  }

  private async process(delivery: ClaimedDelivery): Promise<void> {
    const now = new Date();
    if (delivery.expiresAt <= now) {
      await this.finish(delivery.id, 'EXPIRED', 'DeliveryTtlExpired');
      return;
    }
    if (delivery.subscriptionUserId !== delivery.recipientUserId) {
      await this.finish(delivery.id, 'PERMANENT_FAILURE', 'SubscriptionOwnershipChanged');
      return;
    }
    const subscription = await this.prisma.pushSubscription.findUnique({
      where: { id: delivery.subscriptionId },
      select: { status: true },
    });
    if (!subscription || subscription.status !== 'ACTIVE') {
      await this.finish(delivery.id, 'PERMANENT_FAILURE', 'SubscriptionInactive');
      return;
    }
    try {
      await this.gateway.send(
        {
          endpoint: delivery.endpoint,
          keys: { p256dh: delivery.p256dh, auth: delivery.auth },
        },
        JSON.stringify(delivery.payload),
        Math.max(60, Math.floor((delivery.expiresAt.getTime() - now.getTime()) / 1_000)),
      );
      await this.prisma.$transaction([
        this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: now,
            lockedAt: null,
            lockedBy: null,
          },
        }),
        this.prisma.pushSubscription.update({
          where: { id: delivery.subscriptionId },
          data: {
            lastAcceptedAt: now,
            lastFailureAt: null,
            lastFailureClass: null,
          },
        }),
      ]);
    } catch (error) {
      const failure = classifyPushFailure(error);
      if (failure.disposition === 'EXPIRE_SUBSCRIPTION') {
        await this.prisma.$transaction([
          this.prisma.pushDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'PERMANENT_FAILURE',
              failedAt: now,
              safeFailureClass: failure.safeClass,
              lockedAt: null,
              lockedBy: null,
            },
          }),
          this.prisma.pushSubscription.update({
            where: { id: delivery.subscriptionId },
            data: {
              status: 'EXPIRED',
              revokedAt: now,
              lastFailureAt: now,
              lastFailureClass: failure.safeClass,
              version: { increment: 1 },
            },
          }),
        ]);
        return;
      }
      const finalAttempt =
        failure.disposition === 'PERMANENT' ||
        delivery.attemptCount >= this.config.pushDeliveryMaxAttempts;
      if (finalAttempt) {
        await this.finish(delivery.id, 'PERMANENT_FAILURE', failure.safeClass);
        await this.prisma.pushSubscription.update({
          where: { id: delivery.subscriptionId },
          data: { lastFailureAt: now, lastFailureClass: failure.safeClass },
        });
        return;
      }
      const backoff = Math.min(
        10 * 60_000,
        failure.retryAfterMs ?? 30_000 * 2 ** Math.max(0, delivery.attemptCount - 1),
      );
      await this.prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: {
          lockedAt: null,
          lockedBy: null,
          safeFailureClass: failure.safeClass,
          nextAttemptAt: new Date(now.getTime() + backoff),
        },
      });
    }
  }

  private async finish(
    id: string,
    status: 'PERMANENT_FAILURE' | 'EXPIRED',
    safeFailureClass: string,
  ): Promise<void> {
    await this.prisma.pushDelivery.update({
      where: { id },
      data: {
        status,
        failedAt: new Date(),
        safeFailureClass,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.inFlight) {
      await Promise.race([
        this.inFlight,
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
  }
}
