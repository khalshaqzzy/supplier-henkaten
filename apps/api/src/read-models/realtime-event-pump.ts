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
  static readonly PAGE_SIZE = 500;
  static readonly LATE_COMMIT_LOOKBACK_MS = 10_000;
  static readonly MAX_POLL_EVENTS = 2_000;
  static readonly MAX_PUBLISHED_IDS = 5_000;
  private readonly logger = new Logger(RealtimeEventPump.name);
  private readonly subject = new Subject<RealtimeOutboxEvent>();
  private readonly resyncSubject = new Subject<void>();
  private readonly startedAt = new Date();
  private readonly publishedIds = new Map<string, number>();
  private cursor: Pick<RealtimeOutboxEvent, 'id' | 'occurredAt'> | undefined;
  private confirmedCursor: Pick<RealtimeOutboxEvent, 'id' | 'occurredAt'> | undefined;
  private lastActivityMs = 0;
  private timer: NodeJS.Timeout | undefined;
  private overflowReconcileTimer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  events(): Observable<RealtimeOutboxEvent> {
    return this.subject.asObservable();
  }

  resyncs(): Observable<void> {
    return this.resyncSubject.asObservable();
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

  private advanceOverflowCursor(
    target: Pick<RealtimeOutboxEvent, 'id' | 'occurredAt'> | undefined,
  ) {
    if (target) {
      this.confirmedCursor = target;
    }
    this.publishedIds.clear();
    this.lastActivityMs = Date.now();
    this.resyncSubject.next();
    if (!this.stopping) {
      if (this.overflowReconcileTimer) clearTimeout(this.overflowReconcileTimer);
      this.overflowReconcileTimer = setTimeout(() => {
        this.overflowReconcileTimer = undefined;
        if (!this.stopping) {
          this.resyncSubject.next();
        }
      }, RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS);
      this.overflowReconcileTimer.unref();
    }
  }

  private prunePublishedBefore(floorMs: number): void {
    for (const [id, occurredAtMs] of this.publishedIds) {
      if (occurredAtMs < floorMs) {
        this.publishedIds.delete(id);
      }
    }
  }

  async poll(): Promise<void> {
    if (this.stopping) return;

    const nowMs = Date.now();
    const cursorAtPollStart = this.cursor;
    const shouldConfirmAfterSweep = Boolean(
      cursorAtPollStart &&
      this.lastActivityMs > 0 &&
      nowMs - this.lastActivityMs >= RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS &&
      (!this.confirmedCursor ||
        cursorAtPollStart.occurredAt.getTime() > this.confirmedCursor.occurredAt.getTime() ||
        (cursorAtPollStart.occurredAt.getTime() === this.confirmedCursor.occurredAt.getTime() &&
          cursorAtPollStart.id > this.confirmedCursor.id)),
    );

    let pageCursor: Pick<RealtimeOutboxEvent, 'id' | 'occurredAt'> | undefined;
    let initialLowerBound: Date | undefined;

    if (this.cursor) {
      const lookbackMs =
        this.cursor.occurredAt.getTime() - RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS;
      if (this.confirmedCursor && lookbackMs <= this.confirmedCursor.occurredAt.getTime()) {
        pageCursor = this.confirmedCursor;
        this.prunePublishedBefore(this.confirmedCursor.occurredAt.getTime());
      } else {
        initialLowerBound = new Date(lookbackMs);
        this.prunePublishedBefore(lookbackMs);
      }
    } else {
      initialLowerBound = this.startedAt;
    }

    let scanned = 0;
    let sawNewEvent = false;

    const finishSweep = () => {
      if (shouldConfirmAfterSweep && !sawNewEvent && this.cursor) {
        this.confirmedCursor = this.cursor;
        this.publishedIds.clear();
      }
    };

    for (;;) {
      if (this.stopping) return;
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          suppressedAt: null,
          supplierId: { not: null },
          eventType: { in: [...SUPPLIER_SSE_ALLOWED_EVENTS] },
          aggregateType: { notIn: [...SUPPLIER_SSE_BLOCKED_AGGREGATES] },
          ...(pageCursor
            ? {
                AND: [
                  { occurredAt: { gte: pageCursor.occurredAt } },
                  {
                    OR: [
                      { occurredAt: { gt: pageCursor.occurredAt } },
                      { occurredAt: pageCursor.occurredAt, id: { gt: pageCursor.id } },
                    ],
                  },
                ],
              }
            : { occurredAt: { gte: initialLowerBound! } }),
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: RealtimeEventPump.PAGE_SIZE,
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
      if (this.stopping) return;
      if (events.length === 0) {
        finishSweep();
        return;
      }

      for (const event of events) {
        if (this.stopping) return;
        scanned += 1;
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
        if (this.publishedIds.size >= RealtimeEventPump.MAX_PUBLISHED_IDS) {
          this.logger.warn(
            { scanned },
            'realtime event pump dedup window exceeded cap; emitting resync',
          );
          this.advanceOverflowCursor(this.cursor ?? pageCursor);
          return;
        }
        sawNewEvent = true;
        this.publishedIds.set(event.id, event.occurredAt.getTime());
        this.lastActivityMs = Date.now();
        this.subject.next(event);
      }

      if (events.length < RealtimeEventPump.PAGE_SIZE) {
        finishSweep();
        return;
      }
      if (scanned >= RealtimeEventPump.MAX_POLL_EVENTS) {
        this.logger.warn(
          { scanned },
          'realtime event pump poll window exceeded cap; emitting resync',
        );
        this.advanceOverflowCursor(this.cursor ?? pageCursor);
        return;
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.overflowReconcileTimer) {
      clearTimeout(this.overflowReconcileTimer);
      this.overflowReconcileTimer = undefined;
    }
    if (this.inFlight) {
      await Promise.race([
        this.inFlight,
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    this.resyncSubject.complete();
    this.subject.complete();
  }
}
