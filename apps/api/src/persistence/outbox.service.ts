import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from './prisma.service.js';

type OutboxClient = PrismaService | Prisma.TransactionClient;
type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;

export type OutboxInput = {
  id?: string;
  eventType: string;
  schemaVersion?: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  supplierId?: string;
  actor: Record<string, unknown>;
  correlationId: string;
  causationId?: string;
  payload: Record<string, unknown>;
};

export type ClaimedOutboxEvent = {
  id: string;
  eventType: string;
  attemptCount: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  supplierId: string | null;
  occurredAt: Date;
  actor: unknown;
  correlationId: string;
  payload: unknown;
};

@Injectable()
export class OutboxService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private inFlight: Promise<void> | undefined;
  private readonly workerId = `api-${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(eventType: string, handler: OutboxHandler): void {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);
  }

  async enqueue(input: OutboxInput, client: OutboxClient = this.prisma): Promise<string> {
    const event = await client.outboxEvent.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        eventType: input.eventType,
        schemaVersion: input.schemaVersion ?? 1,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateVersion: input.aggregateVersion,
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        actor: input.actor as Prisma.InputJsonValue,
        correlationId: input.correlationId,
        ...(input.causationId ? { causationId: input.causationId } : {}),
        payload: input.payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return event.id;
  }

  onModuleInit(): void {
    if (this.config.outboxEnabled) this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.processBatch().finally(() => {
        this.inFlight = undefined;
        this.schedule(this.config.outboxPollMs);
      });
    }, delay);
    this.timer.unref();
  }

  async processBatch(): Promise<void> {
    const events = await this.claimBatch();
    for (const event of events) {
      const handlers = this.handlers.get(event.eventType) ?? [];
      try {
        for (const handler of handlers) await handler(event);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), lockedAt: null, lockedBy: null },
        });
      } catch (error) {
        await this.recordFailure(event, error);
      }
    }
  }

  private async claimBatch(): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<ClaimedOutboxEvent[]>`
        SELECT id, "eventType", "attemptCount", "aggregateType", "aggregateId",
               "aggregateVersion", "supplierId", "occurredAt", actor, "correlationId", payload
        FROM "OutboxEvent"
        WHERE "processedAt" IS NULL
          AND "failedAt" IS NULL
          AND "availableAt" <= now()
          AND ("lockedAt" IS NULL OR "lockedAt" < now() - (${this.config.outboxLockLeaseMs} * interval '1 millisecond'))
        ORDER BY "availableAt", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.config.outboxBatchSize}
      `;
      if (claimed.length === 0) return [];
      const ids = claimed.map((event) => event.id);
      await transaction.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { lockedAt: new Date(), lockedBy: this.workerId, attemptCount: { increment: 1 } },
      });
      return claimed.map((event) => ({ ...event, attemptCount: event.attemptCount + 1 }));
    });
  }

  private async recordFailure(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
    const finalAttempt = event.attemptCount >= this.config.outboxMaxAttempts;
    const safeError = error instanceof Error ? error.name : 'UnknownError';
    const delay = Math.min(60_000, 250 * 2 ** Math.max(0, event.attemptCount - 1));
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        lockedAt: null,
        lockedBy: null,
        lastSafeError: safeError,
        failedAt: finalAttempt ? new Date() : null,
        ...(!finalAttempt ? { availableAt: new Date(Date.now() + delay) } : {}),
      },
    });
    this.logger.warn({ eventId: event.id, eventType: event.eventType, safeError }, 'outbox failed');
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
