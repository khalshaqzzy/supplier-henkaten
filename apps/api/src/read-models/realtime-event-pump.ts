import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../persistence/prisma.service.js';

export type RealtimeOutboxEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  supplierId: string | null;
  occurredAt: Date;
  payload: unknown;
};

@Injectable()
export class RealtimeEventPump implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(RealtimeEventPump.name);
  private readonly subject = new Subject<RealtimeOutboxEvent>();
  private readonly startedAt = new Date();
  private cursor: Pick<RealtimeOutboxEvent, 'id' | 'occurredAt'> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  events(): Observable<RealtimeOutboxEvent> {
    return this.subject.asObservable();
  }

  onModuleInit(): void {
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.poll()
        .catch((error: unknown) => {
          this.logger.warn(
            { safeError: error instanceof Error ? error.name : 'UnknownError' },
            'realtime outbox poll failed',
          );
        })
        .finally(() => {
          this.inFlight = undefined;
          this.schedule(this.config.realtimePollMs);
        });
    }, delay);
    this.timer.unref();
  }

  async poll(): Promise<void> {
    for (;;) {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          supplierId: { not: null },
          ...(this.cursor
            ? {
                OR: [
                  { occurredAt: { gt: this.cursor.occurredAt } },
                  { occurredAt: this.cursor.occurredAt, id: { gt: this.cursor.id } },
                ],
              }
            : { occurredAt: { gte: this.startedAt } }),
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 500,
        select: {
          id: true,
          eventType: true,
          aggregateType: true,
          aggregateId: true,
          aggregateVersion: true,
          supplierId: true,
          occurredAt: true,
          payload: true,
        },
      });
      if (events.length === 0) return;
      for (const event of events) {
        this.cursor = { id: event.id, occurredAt: event.occurredAt };
        this.subject.next(event);
      }
      if (events.length < 500) return;
    }
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
    this.subject.complete();
  }
}
