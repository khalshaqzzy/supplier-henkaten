import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../persistence/prisma.service.js';

export const SUPPLIER_SSE_LINE_SCOPED_EVENTS = [
  'HENKATEN_OPENED',
  'WARNING_OPENED',
  'HENKATEN_APPROVAL_RECORDED',
  'HENKATEN_APPROVED',
  'HENKATEN_REJECTED',
  'HENKATEN_CANCELLED',
  'WARNING_CLOSED',
  'MP_RESERVATION_RELEASED',
  'MP_MOVED',
  'ASSIGNMENT_ISSUE_OPENED',
  'ASSIGNMENT_ISSUE_RESOLVED',
  'NOTIFICATION_REQUESTED',
  'SHIFT_STARTED',
  'SHIFT_STARTED_WITH_OVERRIDE',
  'SHIFT_START_BLOCKED',
  'SHIFT_ENDED',
  'BOARD_LAYOUT_UPDATED',
  'HENKATEN_DATA_DELETED',
  'PCR_ASSESSED',
  'PCR_DECISION_CORRECTED',
] as const;

export const SUPPLIER_SSE_TENANT_WIDE_EVENTS = [
  'MASTER_DATA_CHANGED',
  'MASTER_DATA_REMOVED',
  'MEMBER_PHOTO_CHANGED',
  'SHIFT_TEMPLATE_UPDATED',
  'SHIFT_TIMES_SWAPPED',
  'SUPPLIER_SOURCE_MODE_CHANGED',
] as const;

export const SUPPLIER_SSE_ALLOWED_EVENTS = [
  ...SUPPLIER_SSE_LINE_SCOPED_EVENTS,
  ...SUPPLIER_SSE_TENANT_WIDE_EVENTS,
] as const;

export const SUPPLIER_SSE_BLOCKED_AGGREGATES = [
  'ExternalHenkatenProjection',
  'ExternalApiClient',
] as const;

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
  private static readonly LATE_COMMIT_LOOKBACK_MS = 10_000;
  private static readonly MAX_PUBLISHED_IDS = 5_000;
  private readonly logger = new Logger(RealtimeEventPump.name);
  private readonly subject = new Subject<RealtimeOutboxEvent>();
  private readonly startedAt = new Date();
  private readonly publishedIds = new Set<string>();
  private readonly publishedOrder: string[] = [];
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
    const initialLowerBound = this.cursor
      ? new Date(this.cursor.occurredAt.getTime() - RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS)
      : this.startedAt;
    let pageCursor: Pick<RealtimeOutboxEvent, 'id' | 'occurredAt'> | undefined;
    for (;;) {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          suppressedAt: null,
          supplierId: { not: null },
          eventType: { in: [...SUPPLIER_SSE_ALLOWED_EVENTS] },
          aggregateType: { notIn: [...SUPPLIER_SSE_BLOCKED_AGGREGATES] },
          ...(pageCursor
            ? {
                OR: [
                  { occurredAt: { gt: pageCursor.occurredAt } },
                  { occurredAt: pageCursor.occurredAt, id: { gt: pageCursor.id } },
                ],
              }
            : { occurredAt: { gte: initialLowerBound } }),
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
        pageCursor = { id: event.id, occurredAt: event.occurredAt };
        if (
          !this.cursor ||
          event.occurredAt.getTime() > this.cursor.occurredAt.getTime() ||
          (event.occurredAt.getTime() === this.cursor.occurredAt.getTime() &&
            event.id > this.cursor.id)
        ) {
          this.cursor = { id: event.id, occurredAt: event.occurredAt };
        }
        if (this.publishedIds.has(event.id)) continue;
        this.publishedIds.add(event.id);
        this.publishedOrder.push(event.id);
        if (this.publishedOrder.length > RealtimeEventPump.MAX_PUBLISHED_IDS) {
          const expired = this.publishedOrder.shift();
          if (expired) this.publishedIds.delete(expired);
        }
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
