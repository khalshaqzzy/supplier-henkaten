import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';

import { opaqueIdSchema } from '@tmmin-henkaten/contracts';

import { SessionService } from '../auth/session.service.js';
import { capabilitiesForPrincipal } from '../common/policy.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../persistence/prisma.service.js';
import {
  RealtimeEventPump,
  SUPPLIER_SSE_ALLOWED_EVENTS,
  SUPPLIER_SSE_BLOCKED_AGGREGATES,
  SUPPLIER_SSE_LINE_SCOPED_EVENTS,
  SUPPLIER_SSE_TENANT_WIDE_EVENTS,
  type RealtimeOutboxEvent,
} from './realtime-event-pump.js';

export type StreamMessage = {
  id?: string;
  type: 'heartbeat' | 'invalidate' | 'resync';
  data: Record<string, unknown>;
  retry?: number;
};

type ActiveStreamSlot = {
  sessionId: string;
  userId: string;
  supplierId: string;
  released: boolean;
  evict: () => void;
  release: () => void;
};

type CachedEntry<T> = {
  value: T;
  expiresAt: number;
  epoch: number;
};

const REPLAY_LIMIT = 500;
const MAX_REPLAY_SCAN = 2_000;
const MAX_PENDING_LIVE = 256;
const MAX_WRITER_BUFFERED_BYTES = 512 * 1024;
const HEARTBEAT_INTERVAL_MS = 15_000;

const ALLOWED_EVENT_SET = new Set<string>(SUPPLIER_SSE_ALLOWED_EVENTS);
const LINE_SCOPED_EVENT_SET = new Set<string>(SUPPLIER_SSE_LINE_SCOPED_EVENTS);
const TENANT_WIDE_EVENT_SET = new Set<string>(SUPPLIER_SSE_TENANT_WIDE_EVENTS);
const BLOCKED_AGGREGATE_SET = new Set<string>(SUPPLIER_SSE_BLOCKED_AGGREGATES);
const LINE_CACHE_INVALIDATING_EVENTS = new Set<string>([
  'MASTER_DATA_CHANGED',
  'MASTER_DATA_REMOVED',
  'SUPPLIER_SOURCE_MODE_CHANGED',
]);

export function formatSseFrame(message: StreamMessage): string {
  const lines: string[] = [];
  // Only include `id:` on invalidation events so heartbeats/resyncs never overwrite
  // the browser's Last-Event-ID outbox UUID cursor.
  if (message.type === 'invalidate' && message.id) {
    lines.push(`id: ${message.id}`);
  }
  lines.push(`event: ${message.type}`);
  if (typeof message.retry === 'number') {
    lines.push(`retry: ${message.retry}`);
  }
  lines.push(`data: ${JSON.stringify(message.data)}`);
  return `${lines.join('\n')}\n\n`;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly activeSlots = new Set<ActiveStreamSlot>();
  private readonly sessionSlots = new Map<string, ActiveStreamSlot[]>();
  private readonly userCounts = new Map<string, number>();
  private readonly supplierCounts = new Map<string, number>();

  private pendingAdmissionsGlobal = 0;
  private readonly pendingAdmissionsByUser = new Map<string, number>();

  private readonly sessionCache = new Map<string, CachedEntry<boolean>>();
  private readonly sessionInFlight = new Map<
    string,
    { epoch: number; promise: Promise<boolean> }
  >();
  private readonly sessionEpochs = new Map<string, number>();

  private readonly lineCache = new Map<string, CachedEntry<string[]>>();
  private readonly lineInFlight = new Map<string, { epoch: number; promise: Promise<string[]> }>();
  private readonly lineEpochs = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pump: RealtimeEventPump,
    private readonly sessions: SessionService,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  async assertLineExists(supplierId: string, lineId: string): Promise<void> {
    const line = await this.prisma.line.findFirst({
      where: { id: lineId, supplierId, deletedAt: null },
      select: { id: true },
    });
    if (!line) {
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Line not found',
        detail: 'The requested line does not exist.',
      });
    }
  }

  /**
   * Direct HTTP SSE handler guaranteeing 404/429 admission decisions complete
   * before 200 text/event-stream headers commit, avoiding NestJS SseStream's
   * auto-incrementing numeric IDs and hidden concatMap writer buffer.
   */
  async handleHttpStream(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
    response: Response,
  ): Promise<void> {
    const observable = await this.prepareStream(scope, principal, lineId, lastEventId, response);
    if (response.destroyed || response.writableEnded) return;

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    const subscription = observable.subscribe({
      next: (message) => {
        if (response.destroyed || response.writableEnded) {
          subscription.unsubscribe();
          return;
        }
        if (response.writableLength > MAX_WRITER_BUFFERED_BYTES) {
          subscription.unsubscribe();
          response.destroy();
          return;
        }
        response.write(formatSseFrame(message));
      },
      complete: () => {
        if (!response.destroyed && !response.writableEnded) {
          response.end();
        }
      },
      error: () => {
        if (!response.destroyed && !response.writableEnded) {
          response.end();
        }
      },
    });

    response.once('close', () => {
      subscription.unsubscribe();
    });
  }

  async prepareStream(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
    response?: Response,
  ): Promise<Observable<StreamMessage>> {
    const releaseAdmission = this.acquireAdmission(principal.userId);
    try {
      if (lineId) {
        await this.assertLineExists(scope.supplierId, lineId);
      }
      if (response && (response.destroyed || response.writableEnded)) {
        return new Observable<StreamMessage>((subscriber) => subscriber.complete());
      }
      const slot = this.acquireSlot(scope.supplierId, principal, response);
      return this.createStreamObservable(scope, principal, lineId, lastEventId, response, slot);
    } finally {
      releaseAdmission();
    }
  }

  stream(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
  ): Observable<StreamMessage> {
    return this.createStreamObservable(scope, principal, lineId, lastEventId);
  }

  private limits() {
    return {
      maxPerSession: this.config?.sseMaxPerSession ?? 6,
      maxPerUser: this.config?.sseMaxPerUser ?? 12,
      maxPerSupplier: this.config?.sseMaxPerSupplier ?? 60,
      maxGlobal: this.config?.sseMaxGlobal ?? 300,
      revalidationCacheMs: this.config ? this.config.sseRevalidationCacheMs : 0,
    };
  }

  private acquireAdmission(userId: string): () => void {
    const limits = this.limits();
    const userPending = this.pendingAdmissionsByUser.get(userId) ?? 0;
    if (userPending >= limits.maxPerUser || this.pendingAdmissionsGlobal >= limits.maxGlobal) {
      this.logger.warn({ scope: 'sse', limitType: 'admission' }, 'SSE admission limit exceeded');
      throw rateLimited();
    }
    this.pendingAdmissionsGlobal += 1;
    this.pendingAdmissionsByUser.set(userId, userPending + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingAdmissionsGlobal = Math.max(0, this.pendingAdmissionsGlobal - 1);
      const next = (this.pendingAdmissionsByUser.get(userId) ?? 1) - 1;
      if (next > 0) this.pendingAdmissionsByUser.set(userId, next);
      else this.pendingAdmissionsByUser.delete(userId);
    };
  }

  private acquireSlot(
    supplierId: string,
    principal: RequestPrincipal,
    response?: Response,
  ): ActiveStreamSlot {
    const limits = this.limits();
    const existingForSession = this.sessionSlots.get(principal.sessionId) ?? [];
    const evictCandidate =
      existingForSession.length >= limits.maxPerSession ? existingForSession[0] : undefined;
    const delta = evictCandidate ? 0 : 1;
    const projectedUser = (this.userCounts.get(principal.userId) ?? 0) + delta;
    const projectedSupplier = (this.supplierCounts.get(supplierId) ?? 0) + delta;
    const projectedGlobal = this.activeSlots.size + delta;

    if (projectedUser > limits.maxPerUser) {
      this.logger.warn({ scope: 'sse', limitType: 'user' }, 'SSE connection limit exceeded');
      throw rateLimited();
    }
    if (projectedSupplier > limits.maxPerSupplier) {
      this.logger.warn({ scope: 'sse', limitType: 'supplier' }, 'SSE connection limit exceeded');
      throw rateLimited();
    }
    if (projectedGlobal > limits.maxGlobal) {
      this.logger.warn({ scope: 'sse', limitType: 'global' }, 'SSE connection limit exceeded');
      throw rateLimited();
    }

    if (evictCandidate) {
      try {
        evictCandidate.evict();
      } finally {
        evictCandidate.release();
      }
    }

    const slot: ActiveStreamSlot = {
      sessionId: principal.sessionId,
      userId: principal.userId,
      supplierId,
      released: false,
      evict: () => {
        if (response && !response.destroyed && !response.writableEnded) {
          response.end();
        }
      },
      release: () => {
        if (slot.released) return;
        slot.released = true;
        this.activeSlots.delete(slot);
        const list = this.sessionSlots.get(slot.sessionId);
        if (list) {
          const next = list.filter((entry) => entry !== slot);
          if (next.length) {
            this.sessionSlots.set(slot.sessionId, next);
          } else {
            this.sessionSlots.delete(slot.sessionId);
            if (!this.sessionInFlight.has(slot.sessionId)) {
              this.sessionCache.delete(slot.sessionId);
              this.sessionEpochs.delete(slot.sessionId);
            }
          }
        }
        const nextUser = (this.userCounts.get(slot.userId) ?? 1) - 1;
        if (nextUser > 0) this.userCounts.set(slot.userId, nextUser);
        else this.userCounts.delete(slot.userId);
        const nextSupplier = (this.supplierCounts.get(slot.supplierId) ?? 1) - 1;
        if (nextSupplier > 0) this.supplierCounts.set(slot.supplierId, nextSupplier);
        else this.supplierCounts.delete(slot.supplierId);
      },
    };

    this.activeSlots.add(slot);
    this.sessionSlots.set(principal.sessionId, [
      ...(this.sessionSlots.get(principal.sessionId) ?? []),
      slot,
    ]);
    this.userCounts.set(principal.userId, (this.userCounts.get(principal.userId) ?? 0) + 1);
    this.supplierCounts.set(supplierId, (this.supplierCounts.get(supplierId) ?? 0) + 1);
    response?.once('close', slot.release);
    return slot;
  }

  private createStreamObservable(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
    response?: Response,
    slot?: ActiveStreamSlot,
  ): Observable<StreamMessage> {
    return new Observable<StreamMessage>((subscriber) => {
      if (slot?.released || response?.destroyed || response?.writableEnded) {
        slot?.release();
        subscriber.complete();
        return;
      }

      let closed = false;
      let replaying = true;
      let liveOverflowed = false;
      let waitingForDrain = false;
      let draining = false;
      const pendingLive: RealtimeOutboxEvent[] = [];
      const seen = new Set<string>();
      const seenOrder: string[] = [];

      let heartbeatTimer: NodeJS.Timeout | undefined;
      let pumpSubscription: { unsubscribe(): void } | undefined;

      const teardown = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        pumpSubscription?.unsubscribe();
        pumpSubscription = undefined;
        pendingLive.length = 0;
        slot?.release();
      };

      const finish = () => {
        teardown();
        if (!subscriber.closed) subscriber.complete();
      };

      const closeStalledWriter = () => {
        finish();
        if (response && !response.destroyed) {
          response.destroy();
        }
      };

      if (slot) {
        slot.evict = () => {
          if (closed || subscriber.closed) return;
          const retryMs = 30_000 + Math.floor(Math.random() * 30_000);
          subscriber.next({
            type: 'heartbeat',
            retry: retryMs,
            data: { at: new Date().toISOString() },
          });
          finish();
        };
      }

      const recordSeen = (id: string): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        seenOrder.push(id);
        if (seenOrder.length > REPLAY_LIMIT) {
          const expired = seenOrder.shift();
          if (expired) seen.delete(expired);
        }
        return true;
      };

      const emitResync = () => {
        if (closed || subscriber.closed) return;
        subscriber.next({
          type: 'resync',
          retry: 3_000,
          data: { reason: 'CURSOR_UNAVAILABLE', at: new Date().toISOString() },
        });
      };

      const writerExceededHardCap = () =>
        Boolean(response && response.writableLength > MAX_WRITER_BUFFERED_BYTES);

      const writerNeedsDrain = () => Boolean(response && response.writableNeedDrain);

      const scheduleAfterDrain = () => {
        if (closed || waitingForDrain) return;
        if (!response) return;
        waitingForDrain = true;
        response.once('drain', () => {
          waitingForDrain = false;
          if (!closed && !replaying && (liveOverflowed || pendingLive.length > 0)) {
            void drainLive();
          }
        });
      };

      const enqueueLive = (event: RealtimeOutboxEvent) => {
        if (closed) return;
        if (event.supplierId !== scope.supplierId) return;
        if (!isAllowedSupplierEvent(event)) return;
        if (LINE_CACHE_INVALIDATING_EVENTS.has(event.eventType)) {
          this.invalidateSupplierLines(scope.supplierId);
          if (event.eventType === 'SUPPLIER_SOURCE_MODE_CHANGED') {
            this.invalidateSession(principal.sessionId);
          }
        }
        if (writerExceededHardCap()) {
          closeStalledWriter();
          return;
        }
        if (pendingLive.length >= MAX_PENDING_LIVE || writerNeedsDrain()) {
          pendingLive.length = 0;
          liveOverflowed = true;
        } else if (!liveOverflowed) {
          pendingLive.push(event);
        }
        if (!replaying) void drainLive();
      };

      const drainLive = async () => {
        if (draining || closed || replaying || waitingForDrain) return;
        draining = true;
        try {
          while (!closed && (liveOverflowed || pendingLive.length > 0)) {
            if (writerExceededHardCap()) {
              finish();
              return;
            }
            if (writerNeedsDrain()) {
              pendingLive.length = 0;
              liveOverflowed = true;
              scheduleAfterDrain();
              return;
            }
            if (liveOverflowed) {
              liveOverflowed = false;
              const sessionOk = await this.validateSession(scope.supplierId, principal, false);
              if (closed) return;
              if (!sessionOk) {
                finish();
                return;
              }
              if (writerExceededHardCap()) {
                finish();
                return;
              }
              if (writerNeedsDrain()) {
                liveOverflowed = true;
                scheduleAfterDrain();
                return;
              }
              emitResync();
              continue;
            }
            const nextEvent = pendingLive.shift();
            if (!nextEvent) continue;
            if (!recordSeen(nextEvent.id)) continue;
            const sessionOk = await this.validateSession(scope.supplierId, principal, false);
            if (closed) return;
            if (!sessionOk) {
              finish();
              return;
            }
            const allowed = await this.loadAllowedLines(scope.supplierId, false);
            if (closed) return;
            if (lineId && !allowed.includes(lineId)) {
              finish();
              return;
            }
            if (!this.inScope(nextEvent, lineId, allowed)) continue;
            if (writerExceededHardCap()) {
              finish();
              return;
            }
            if (writerNeedsDrain()) {
              pendingLive.length = 0;
              liveOverflowed = true;
              scheduleAfterDrain();
              return;
            }
            subscriber.next(this.invalidation(nextEvent, scope.supplierId));
          }
        } catch {
          finish();
        } finally {
          draining = false;
          if (
            !closed &&
            !replaying &&
            !waitingForDrain &&
            (liveOverflowed || pendingLive.length > 0)
          ) {
            void drainLive();
          }
        }
      };

      // Subscribe to live events BEFORE opening the replay query so no events
      // committed during replay are lost; recordSeen deduplicates the handoff
      // without dropping late-committed transactions.
      pumpSubscription = this.pump.events().subscribe({
        next: enqueueLive,
        complete: finish,
      });

      const sendHeartbeat = async () => {
        if (closed) return;
        try {
          const sessionOk = await this.validateSession(scope.supplierId, principal, true);
          if (closed) return;
          if (!sessionOk) {
            finish();
            return;
          }
          if (lineId) {
            const allowed = await this.loadAllowedLines(scope.supplierId, false);
            if (closed) return;
            if (!allowed.includes(lineId)) {
              finish();
              return;
            }
          }
          if (writerExceededHardCap()) {
            finish();
            return;
          }
          if (!writerNeedsDrain()) {
            subscriber.next({
              type: 'heartbeat',
              retry: 3_000,
              data: { at: new Date().toISOString() },
            });
          }
        } catch {
          finish();
        }
      };

      const start = async () => {
        try {
          const sessionOk = await this.validateSession(scope.supplierId, principal, false);
          if (closed) return;
          if (!sessionOk) {
            finish();
            return;
          }
          const initialAllowed = await this.loadAllowedLines(scope.supplierId, false);
          if (closed) return;

          if (lineId && !initialAllowed.includes(lineId)) {
            finish();
            return;
          }

          subscriber.next({
            type: 'heartbeat',
            retry: 3_000,
            data: { at: new Date().toISOString() },
          });

          heartbeatTimer = setInterval(() => {
            void sendHeartbeat();
          }, HEARTBEAT_INTERVAL_MS);
          heartbeatTimer.unref?.();

          const replayResult = await this.replay(
            scope.supplierId,
            lastEventId,
            lineId,
            initialAllowed,
          );
          if (closed) return;

          // Validate session and line scope ONCE for the entire replay batch.
          const postReplaySessionOk = await this.validateSession(
            scope.supplierId,
            principal,
            false,
          );
          if (closed) return;
          if (!postReplaySessionOk) {
            finish();
            return;
          }
          const currentAllowed = await this.loadAllowedLines(scope.supplierId, false);
          if (closed) return;
          if (lineId && !currentAllowed.includes(lineId)) {
            finish();
            return;
          }

          if (replayResult.resync) {
            if (writerExceededHardCap()) {
              finish();
              return;
            }
            if (writerNeedsDrain()) {
              liveOverflowed = true;
              scheduleAfterDrain();
            } else {
              emitResync();
            }
          } else {
            for (const item of replayResult.events) {
              if (closed) return;
              if (!this.inScope(item, lineId, currentAllowed)) continue;
              if (!recordSeen(item.id)) continue;
              if (writerExceededHardCap()) {
                finish();
                return;
              }
              if (writerNeedsDrain()) {
                pendingLive.length = 0;
                liveOverflowed = true;
                scheduleAfterDrain();
                break;
              }
              subscriber.next(this.invalidation(item, scope.supplierId));
            }
          }

          replaying = false;
          if (!closed && !waitingForDrain && (liveOverflowed || pendingLive.length > 0)) {
            void drainLive();
          }
        } catch {
          finish();
        }
      };

      void start();
      return teardown;
    });
  }

  private async validateSession(
    supplierId: string,
    principal: RequestPrincipal,
    bypassCache: boolean,
  ): Promise<boolean> {
    const ttlMs = this.limits().revalidationCacheMs;
    const key = principal.sessionId;
    const epoch = this.sessionEpochs.get(key) ?? 0;
    const now = Date.now();

    if (!bypassCache && ttlMs > 0) {
      const cached = this.sessionCache.get(key);
      if (cached && cached.epoch === epoch && cached.expiresAt > now) {
        return cached.value;
      }
      const inFlight = this.sessionInFlight.get(key);
      if (inFlight && inFlight.epoch === epoch) {
        return inFlight.promise;
      }
    }

    const requestEpoch = this.sessionEpochs.get(key) ?? 0;
    let trackedPromise: Promise<boolean> | undefined;
    const promise = (async () => {
      try {
        const current = await this.sessions.resolve(principal.rawSessionToken, 'SUPPLIER', false);
        const valid = Boolean(
          current &&
          current.sessionId === principal.sessionId &&
          current.supplierId === supplierId &&
          !current.mustChangePassword &&
          capabilitiesForPrincipal(current).has('SUPPLIER_BOARD_READ'),
        );
        if (!valid) {
          this.invalidateSession(key);
          return false;
        }
        const currentEpoch = this.sessionEpochs.get(key) ?? 0;
        if (currentEpoch !== requestEpoch) {
          return false;
        }
        if (ttlMs > 0 && this.sessionSlots.has(key)) {
          this.sessionCache.set(key, {
            value: true,
            expiresAt: Date.now() + ttlMs,
            epoch: requestEpoch,
          });
        }
        return true;
      } finally {
        if (trackedPromise) {
          const entry = this.sessionInFlight.get(key);
          if (entry?.promise === trackedPromise) {
            this.sessionInFlight.delete(key);
          }
        }
        if (!this.sessionSlots.has(key) && !this.sessionInFlight.has(key)) {
          this.sessionCache.delete(key);
          this.sessionEpochs.delete(key);
        }
      }
    })();

    if (!bypassCache && ttlMs > 0) {
      trackedPromise = promise;
      this.sessionInFlight.set(key, { epoch: requestEpoch, promise });
    }

    return promise;
  }

  private async loadAllowedLines(supplierId: string, bypassCache: boolean): Promise<string[]> {
    const ttlMs = this.limits().revalidationCacheMs;
    const epoch = this.lineEpochs.get(supplierId) ?? 0;
    const now = Date.now();

    if (!bypassCache && ttlMs > 0) {
      const cached = this.lineCache.get(supplierId);
      if (cached && cached.epoch === epoch && cached.expiresAt > now) {
        return cached.value;
      }
      const inFlight = this.lineInFlight.get(supplierId);
      if (inFlight && inFlight.epoch === epoch) {
        return inFlight.promise;
      }
    }

    const requestEpoch = this.lineEpochs.get(supplierId) ?? 0;
    let trackedPromise: Promise<string[]> | undefined;
    const promise = (async () => {
      try {
        const lines = (
          await this.prisma.line.findMany({
            where: { supplierId, deletedAt: null },
            select: { id: true },
          })
        ).map(({ id }) => id);
        const currentEpoch = this.lineEpochs.get(supplierId) ?? 0;
        if (ttlMs > 0 && currentEpoch === requestEpoch) {
          this.lineCache.set(supplierId, {
            value: lines,
            expiresAt: Date.now() + ttlMs,
            epoch: requestEpoch,
          });
        }
        return lines;
      } finally {
        if (trackedPromise) {
          const entry = this.lineInFlight.get(supplierId);
          if (entry?.promise === trackedPromise) {
            this.lineInFlight.delete(supplierId);
          }
        }
      }
    })();

    if (!bypassCache && ttlMs > 0) {
      trackedPromise = promise;
      this.lineInFlight.set(supplierId, { epoch: requestEpoch, promise });
    }

    return promise;
  }

  private invalidateSession(sessionId: string): void {
    this.sessionCache.delete(sessionId);
    this.sessionInFlight.delete(sessionId);
    if (this.sessionSlots.has(sessionId)) {
      this.sessionEpochs.set(sessionId, (this.sessionEpochs.get(sessionId) ?? 0) + 1);
    } else {
      this.sessionEpochs.delete(sessionId);
    }
  }

  private invalidateSupplierLines(supplierId: string): void {
    this.lineEpochs.set(supplierId, (this.lineEpochs.get(supplierId) ?? 0) + 1);
    this.lineCache.delete(supplierId);
    this.lineInFlight.delete(supplierId);
  }

  private async replay(
    supplierId: string,
    lastEventId: string | undefined,
    requestedLineId: string | undefined,
    allowedLineIds: readonly string[],
  ): Promise<{
    events: RealtimeOutboxEvent[];
    resync: boolean;
  }> {
    let cursor: { occurredAt: Date; id: string } | null = null;
    if (lastEventId !== undefined) {
      if (!opaqueIdSchema.safeParse(lastEventId).success) {
        return { events: [], resync: true };
      }
      const cursorRow = await this.prisma.outboxEvent.findFirst({
        where: {
          id: lastEventId,
          supplierId,
          suppressedAt: null,
          eventType: { in: [...SUPPLIER_SSE_ALLOWED_EVENTS] },
          aggregateType: { notIn: [...SUPPLIER_SSE_BLOCKED_AGGREGATES] },
        },
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
      if (!cursorRow || !this.inScope(cursorRow, requestedLineId, allowedLineIds)) {
        return { events: [], resync: true };
      }
      cursor = { occurredAt: cursorRow.occurredAt, id: cursorRow.id };
    }

    const matched: RealtimeOutboxEvent[] = [];
    let scanCursor = cursor;
    let scanned = 0;

    for (;;) {
      const batch = await this.prisma.outboxEvent.findMany({
        where: {
          suppressedAt: null,
          supplierId,
          eventType: { in: [...SUPPLIER_SSE_ALLOWED_EVENTS] },
          aggregateType: { notIn: [...SUPPLIER_SSE_BLOCKED_AGGREGATES] },
          ...(scanCursor
            ? {
                OR: [
                  { occurredAt: { gt: scanCursor.occurredAt } },
                  { occurredAt: scanCursor.occurredAt, id: { gt: scanCursor.id } },
                ],
              }
            : { occurredAt: { gte: new Date(Date.now() - 30_000) } }),
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: REPLAY_LIMIT + 1,
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
      if (batch.length === 0) break;

      for (const row of batch) {
        scanned += 1;
        if (this.inScope(row, requestedLineId, allowedLineIds)) {
          matched.push(row);
          if (matched.length > REPLAY_LIMIT) {
            return { events: [], resync: true };
          }
        }
      }

      if (batch.length <= REPLAY_LIMIT) break;
      if (scanned >= MAX_REPLAY_SCAN) {
        return { events: [], resync: true };
      }
      const tail = batch[batch.length - 1]!;
      scanCursor = { occurredAt: tail.occurredAt, id: tail.id };
    }

    return { events: matched, resync: false };
  }

  private invalidation(event: RealtimeOutboxEvent, supplierId: string): StreamMessage {
    const isDeletion = event.eventType === 'HENKATEN_DATA_DELETED';
    return {
      id: event.id,
      type: 'invalidate',
      retry: 3_000,
      data: {
        eventType: event.eventType,
        aggregateType: isDeletion ? 'Supplier' : event.aggregateType,
        aggregateId: isDeletion ? supplierId : event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        occurredAt: event.occurredAt.toISOString(),
        refresh: ['assignment-board', 'assignment-board-layout', 'notifications', 'dashboard'],
      },
    };
  }

  private inScope(
    event: RealtimeOutboxEvent,
    requestedLineId: string | undefined,
    allowedLineIds: readonly string[],
  ): boolean {
    if (!isAllowedSupplierEvent(event)) return false;
    if (requestedLineId && !allowedLineIds.includes(requestedLineId)) return false;
    const eventLineIds = extractEventLineIds(event);

    if (TENANT_WIDE_EVENT_SET.has(event.eventType)) {
      if (eventLineIds.length === 0) return true;
      const inTenant = eventLineIds.some((id) => allowedLineIds.includes(id));
      if (!inTenant) return false;
      return !requestedLineId || eventLineIds.includes(requestedLineId);
    }

    if (LINE_SCOPED_EVENT_SET.has(event.eventType)) {
      if (eventLineIds.length === 0) {
        // Pre-rollout replay rows without payload.lineId remain deliverable on
        // supplier-wide subscriptions; line-filtered streams fail closed.
        return !requestedLineId && allowedLineIds.length > 0;
      }
      const inTenant = eventLineIds.some((id) => allowedLineIds.includes(id));
      if (!inTenant) return false;
      return !requestedLineId || eventLineIds.includes(requestedLineId);
    }

    return false;
  }
}

export function isAllowedSupplierEvent(
  event: Pick<RealtimeOutboxEvent, 'eventType' | 'aggregateType'>,
): boolean {
  return ALLOWED_EVENT_SET.has(event.eventType) && !BLOCKED_AGGREGATE_SET.has(event.aggregateType);
}

function extractEventLineIds(event: Pick<RealtimeOutboxEvent, 'payload'>): string[] {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return [];
  }
  const record = event.payload as Record<string, unknown>;
  const result: string[] = [];
  if (typeof record.lineId === 'string' && record.lineId) result.push(record.lineId);
  if (typeof record.sourceLineId === 'string' && record.sourceLineId) {
    result.push(record.sourceLineId);
  }
  return result;
}

function rateLimited(): ProblemException {
  return new ProblemException({
    status: 429,
    code: 'RATE_LIMITED',
    title: 'Too many realtime connections',
    detail: 'The concurrent realtime connection limit has been reached.',
  });
}
