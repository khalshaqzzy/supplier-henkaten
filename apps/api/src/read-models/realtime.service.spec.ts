import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { firstValueFrom, Subject } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';

import { realtimeInvalidationSchema, realtimeResyncSchema } from '@tmmin-henkaten/contracts';

import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { RealtimeEventPump, type RealtimeOutboxEvent } from './realtime-event-pump.js';
import { formatSseFrame, RealtimeService } from './realtime.service.js';

const SUPPLIER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SUPPLIER_ID = '22222222-2222-4222-8222-222222222222';
const LINE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HENKATEN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const principal: RequestPrincipal = {
  userId: 'user-1',
  displayName: 'Supplier Admin',
  realm: 'SUPPLIER',
  role: 'SUPPLIER_ADMIN',
  supplierId: SUPPLIER_ID,
  purpose: 'NORMAL',
  mustChangePassword: false,
  sessionId: 'session-1',
  rawSessionToken: 'session-token',
};

function event(overrides: Partial<RealtimeOutboxEvent> = {}): RealtimeOutboxEvent {
  return {
    id: randomUUID(),
    eventType: 'HENKATEN_OPENED',
    aggregateType: 'Henkaten',
    aggregateId: HENKATEN_ID,
    aggregateVersion: 1,
    supplierId: SUPPLIER_ID,
    occurredAt: new Date('2026-07-25T00:00:00.000Z'),
    payload: { lineId: LINE_A },
    ...overrides,
  };
}

function fakeResponse() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    destroyed: false,
    writableEnded: false,
    writableNeedDrain: false,
    writableLength: 0,
    destroy: vi.fn(function (this: { destroyed: boolean }) {
      this.destroyed = true;
    }),
    end: vi.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  });
}

describe('RealtimeEventPump', () => {
  it('polls the ordered outbox once with supplier allowlist and fans each event to subscribers', async () => {
    const events = [event({ id: 'event-1' }), event({ id: 'event-2', aggregateVersion: 2 })];
    const findMany = vi.fn().mockResolvedValueOnce(events);
    const pump = new RealtimeEventPump(
      { outboxEvent: { findMany } } as never,
      { realtimePollMs: 1_000 } as never,
    );
    const received: RealtimeOutboxEvent[] = [];
    const subscription = pump.events().subscribe((item) => received.push(item));

    await pump.poll();

    expect(received.map(({ id }) => id)).toEqual(['event-1', 'event-2']);
    expect(findMany).toHaveBeenCalledOnce();
    subscription.unsubscribe();
    await pump.beforeApplicationShutdown();
  });

  it('delivers late-committed events within the lookback window exactly once', async () => {
    const t2 = event({ id: 'event-2', occurredAt: new Date('2026-07-25T00:00:05.000Z') });
    const t1Late = event({ id: 'event-1-late', occurredAt: new Date('2026-07-25T00:00:02.000Z') });
    const findMany = vi.fn().mockResolvedValueOnce([t2]).mockResolvedValueOnce([t1Late, t2]);
    const pump = new RealtimeEventPump(
      { outboxEvent: { findMany } } as never,
      { realtimePollMs: 1_000 } as never,
    );
    const received: string[] = [];
    const subscription = pump.events().subscribe((item) => received.push(item.id));

    await pump.poll();
    await pump.poll();

    expect(received).toEqual(['event-2', 'event-1-late']);
    subscription.unsubscribe();
    await pump.beforeApplicationShutdown();
  });

  it('bounds dense lookback windows via overflow resync + delayed reconciliation without entering an indefinite replay loop', async () => {
    vi.useFakeTimers();
    try {
      const makePage = (offset: number, count: number) =>
        Array.from({ length: count }, (_, idx) => {
          const seq = offset + idx;
          return event({
            id: `00000000-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
            occurredAt: new Date(Date.parse('2026-07-25T00:00:00.000Z') + Math.floor(seq / 500)),
          });
        });

      const findMany = vi
        .fn()
        .mockResolvedValueOnce(makePage(0, 500))
        .mockResolvedValueOnce(makePage(500, 500))
        .mockResolvedValueOnce(makePage(1_000, 500))
        .mockResolvedValueOnce(makePage(1_500, 500))
        .mockResolvedValueOnce([]);
      const pump = new RealtimeEventPump(
        { outboxEvent: { findMany } } as never,
        { realtimePollMs: 1_000 } as never,
      );
      const received: string[] = [];
      let resyncCount = 0;
      const subEvents = pump.events().subscribe((item) => received.push(item.id));
      const subResync = pump.resyncs().subscribe(() => {
        resyncCount += 1;
      });

      await pump.poll();
      expect(received).toHaveLength(2_000);
      expect(resyncCount).toBe(1);
      expect(findMany).toHaveBeenCalledTimes(4);

      // Next poll must query strictly after confirmedCursor with an explicit leading occurredAt >= bound.
      await pump.poll();
      expect(findMany).toHaveBeenCalledTimes(5);
      const nextWhere = findMany.mock.calls[4]![0].where;
      expect(nextWhere).toHaveProperty('AND');
      expect(nextWhere.AND[0]).toHaveProperty('occurredAt.gte');
      expect(nextWhere.AND[1]).toHaveProperty('OR');
      expect(nextWhere).not.toHaveProperty('occurredAt');
      expect(received).toHaveLength(2_000);

      // After the lookback window, one bounded follow-up resync reconciles any commit that became visible after overflow.
      await vi.advanceTimersByTimeAsync(RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS);
      expect(resyncCount).toBe(2);

      subEvents.unsubscribe();
      subResync.unsubscribe();
      await pump.beforeApplicationShutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes a final overlapping lookback sweep before confirming idle cursor and stops multi-page polling on shutdown', async () => {
    vi.useFakeTimers();
    try {
      const e2 = event({ id: 'event-idle-2', occurredAt: new Date('2026-07-25T00:00:05.000Z') });
      const e1LateBeforeExpiry = event({
        id: 'event-idle-1-late',
        occurredAt: new Date('2026-07-25T00:00:02.000Z'),
      });
      const findMany = vi
        .fn()
        .mockResolvedValueOnce([e2])
        .mockResolvedValueOnce([e1LateBeforeExpiry, e2])
        .mockResolvedValueOnce([e1LateBeforeExpiry, e2])
        .mockResolvedValueOnce([]);
      const pump = new RealtimeEventPump(
        { outboxEvent: { findMany } } as never,
        { realtimePollMs: 1_000 } as never,
      );
      const received: string[] = [];
      const sub = pump.events().subscribe((item) => received.push(item.id));

      await pump.poll();
      // First poll after lookback expiry performs a final overlapping sweep and catches a late commit.
      await vi.advanceTimersByTimeAsync(RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS + 100);
      await pump.poll();
      expect(findMany.mock.calls[1]![0].where).toHaveProperty('occurredAt.gte');
      expect(received).toEqual(['event-idle-2', 'event-idle-1-late']);

      // Another quiet window passes: final sweep sees no new events and confirms cursor.
      await vi.advanceTimersByTimeAsync(RealtimeEventPump.LATE_COMMIT_LOOKBACK_MS + 100);
      await pump.poll();
      expect(findMany.mock.calls[2]![0].where).toHaveProperty('occurredAt.gte');

      // Subsequent idle poll uses strict confirmedCursor with explicit leading occurredAt >= bound.
      await pump.poll();
      expect(findMany.mock.calls[3]![0].where).toHaveProperty('AND');
      expect(findMany.mock.calls[3]![0].where.AND[0]).toHaveProperty('occurredAt.gte');
      expect(findMany.mock.calls[3]![0].where.AND[1]).toHaveProperty('OR');
      sub.unsubscribe();
      await pump.beforeApplicationShutdown();
    } finally {
      vi.useRealTimers();
    }

    // Shutdown during page 1 of a multi-page batch prevents page 2 from executing.
    let resolvePage1!: (rows: RealtimeOutboxEvent[]) => void;
    const page1Promise = new Promise<RealtimeOutboxEvent[]>((resolve) => {
      resolvePage1 = resolve;
    });
    const findManyShutdown = vi.fn().mockReturnValueOnce(page1Promise).mockResolvedValue([]);
    const shutdownPump = new RealtimeEventPump(
      { outboxEvent: { findMany: findManyShutdown } } as never,
      { realtimePollMs: 1_000 } as never,
    );
    const pollPromise = shutdownPump.poll();
    const shutdownPromise = shutdownPump.beforeApplicationShutdown();
    resolvePage1(
      Array.from({ length: 500 }, (_, idx) =>
        event({ id: `00000000-0000-4000-8000-${idx.toString().padStart(12, '0')}` }),
      ),
    );
    await Promise.all([pollPromise, shutdownPromise]);
    expect(findManyShutdown).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeService', () => {
  it('emits resync without querying DB when Last-Event-ID is not a valid UUID', async () => {
    const pumpEvents = new Subject<RealtimeOutboxEvent>();
    const findFirst = vi.fn();
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]) },
        outboxEvent: { findFirst },
      } as never,
      { events: () => pumpEvents.asObservable() } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );

    const message = await firstValueFrom(
      service.stream(new TenantScope(SUPPLIER_ID), principal, undefined, 'not-a-uuid').pipe(
        filter(({ type }) => type === 'resync'),
        take(1),
      ),
    );

    expect(findFirst).not.toHaveBeenCalled();
    expect(realtimeResyncSchema.safeParse(message.data).success).toBe(true);
    expect(message.data.reason).toBe('CURSOR_UNAVAILABLE');
  });

  it('fans live events only to the authorized tenant and requested line with strict wire schema', async () => {
    const pumpEvents = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }, { id: LINE_B }]) },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => pumpEvents.asObservable() } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );
    const rightEvent = event({ id: randomUUID() });
    const nextInvalidation = firstValueFrom(
      service.stream(new TenantScope(SUPPLIER_ID), principal, LINE_A, undefined).pipe(
        filter(({ type }) => type === 'invalidate'),
        take(1),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    pumpEvents.next(event({ supplierId: OTHER_SUPPLIER_ID }));
    pumpEvents.next(event({ payload: { lineId: LINE_B } }));
    pumpEvents.next(event({ eventType: 'PCR_REVIEW_REQUIRED', payload: {} }));
    pumpEvents.next(
      event({ eventType: 'PCR_ASSESSED', aggregateType: 'ExternalHenkatenProjection' }),
    );
    pumpEvents.next(rightEvent);

    const received = await nextInvalidation;
    expect(received.id).toBe(rightEvent.id);
    expect(received.data).not.toHaveProperty('lineId');
    expect(realtimeInvalidationSchema.safeParse(received.data).success).toBe(true);
  });

  it('matches MP_MOVED against donor sourceLineId and masks HENKATEN_DATA_DELETED command ID', async () => {
    const pumpEvents = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }, { id: LINE_B }]) },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => pumpEvents.asObservable() } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );
    const received: Array<{ id?: string; data: Record<string, unknown> }> = [];
    const sub = service
      .stream(new TenantScope(SUPPLIER_ID), principal, LINE_B, undefined)
      .pipe(filter(({ type }) => type === 'invalidate'))
      .subscribe((msg) => received.push(msg));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const moveEvent = event({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      eventType: 'MP_MOVED',
      payload: { lineId: LINE_A, sourceLineId: LINE_B },
    });
    const deleteCommandId = randomUUID();
    const deleteEvent = event({
      id: '00000000-0000-4000-8000-000000000001',
      eventType: 'HENKATEN_DATA_DELETED',
      aggregateType: 'HenkatenDeletionCommand',
      aggregateId: deleteCommandId,
      payload: { lineId: LINE_B },
    });
    pumpEvents.next(moveEvent);
    pumpEvents.next(deleteEvent);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received).toHaveLength(2);
    expect(received[0]?.id).toBe(moveEvent.id);
    expect(received[1]?.data.aggregateType).toBe('Supplier');
    expect(received[1]?.data.aggregateId).toBe(SUPPLIER_ID);
    expect(received[1]?.data.aggregateId).not.toBe(deleteCommandId);
    sub.unsubscribe();
  });

  it('closes a silent stream when the session is revoked without touching its activity', async () => {
    vi.useFakeTimers();
    try {
      const events = new Subject<RealtimeOutboxEvent>();
      const resolve = vi.fn().mockResolvedValue(principal);
      const service = new RealtimeService(
        {
          line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]) },
          outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
        } as never,
        { events: () => events } as never,
        { resolve } as never,
      );
      const messages: unknown[] = [];
      const complete = vi.fn();
      service
        .stream(new TenantScope(SUPPLIER_ID), principal, undefined, undefined)
        .subscribe({ next: (item) => messages.push(item), complete });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolve).toHaveBeenCalledWith('session-token', 'SUPPLIER', false);
      resolve.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(complete).toHaveBeenCalledOnce();
      expect(events.observed).toBe(false);
      expect(messages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit replay or live metadata after the line scope changes', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: LINE_A }])
      .mockResolvedValue([]);
    const service = new RealtimeService(
      {
        line: { findMany },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([event()]) },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );
    const received: string[] = [];
    const sub = service
      .stream(new TenantScope(SUPPLIER_ID), principal, undefined, undefined)
      .subscribe((item) => received.push(item.type));
    await new Promise((resolve) => setTimeout(resolve, 15));
    events.next(event({ id: randomUUID() }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(received).not.toContain('invalidate');
    sub.unsubscribe();
  });

  it('rejects foreign lineId with 404, evicts oldest per-session stream with long retry, and enforces user/global 429 caps', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: {
          findFirst: vi
            .fn()
            .mockImplementation(({ where }: { where: { id: string } }) =>
              Promise.resolve(where.id === LINE_A ? { id: LINE_A } : null),
            ),
          findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]),
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
      {
        sseMaxPerSession: 1,
        sseMaxPerUser: 2,
        sseMaxPerSupplier: 10,
        sseMaxGlobal: 20,
        sseRevalidationCacheMs: 2_000,
      } as never,
    );

    await expect(
      service.prepareStream(new TenantScope(SUPPLIER_ID), principal, LINE_B, undefined),
    ).rejects.toMatchObject({ problem: { status: 404 } });

    const res1 = fakeResponse();
    const stream1 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      res1 as never,
    );
    const s1Messages: Array<{ retry?: number }> = [];
    const s1Completed = vi.fn();
    const sub1 = stream1.subscribe({
      next: (msg) => s1Messages.push(msg),
      complete: s1Completed,
    });

    // Opening a 2nd stream on the same session evicts stream 1 with >=30s retry hint.
    const res2 = fakeResponse();
    const stream2 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      res2 as never,
    );
    const sub2 = stream2.subscribe();
    expect(s1Completed).toHaveBeenCalledOnce();
    expect(s1Messages.at(-1)?.retry).toBeGreaterThanOrEqual(30_000);

    // A 2nd distinct session for the same user uses slot 2 of maxPerUser=2.
    const res3 = fakeResponse();
    const stream3 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      { ...principal, sessionId: 'session-2' },
      LINE_A,
      undefined,
      res3 as never,
    );
    const sub3 = stream3.subscribe();

    // A 3rd distinct session for the same user exceeds maxPerUser=2 -> 429 before headers commit.
    await expect(
      service.prepareStream(
        new TenantScope(SUPPLIER_ID),
        { ...principal, sessionId: 'session-3' },
        LINE_A,
        undefined,
        fakeResponse() as never,
      ),
    ).rejects.toMatchObject({ problem: { status: 429 } });

    // Closing res3 releases its slot so session-3 can now connect.
    res3.emit('close');
    const res4 = fakeResponse();
    const stream4 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      { ...principal, sessionId: 'session-3' },
      LINE_A,
      undefined,
      res4 as never,
    );
    const sub4 = stream4.subscribe();

    sub1.unsubscribe();
    sub2.unsubscribe();
    sub3.unsubscribe();
    sub4.unsubscribe();
  });

  it('prevents pre-subscription eviction race, omits id on heartbeats, and handles DB rejection without unhandled rejection', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const findFirst = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return null;
    });
    const resolveSession = vi.fn().mockRejectedValue(new Error('db_transient_error'));
    const service = new RealtimeService(
      {
        line: {
          findFirst,
          findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]),
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: resolveSession } as never,
      {
        sseMaxPerSession: 1,
        sseMaxPerUser: 5,
        sseMaxPerSupplier: 10,
        sseMaxGlobal: 20,
        sseRevalidationCacheMs: 2_000,
      } as never,
    );

    // Delayed 404 lookup must reject before HTTP 200 SSE headers are written.
    const httpRes = Object.assign(fakeResponse(), {
      status: vi.fn(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    });
    await expect(
      service.handleHttpStream(
        new TenantScope(SUPPLIER_ID),
        principal,
        LINE_B,
        undefined,
        httpRes as never,
      ),
    ).rejects.toMatchObject({ problem: { status: 404 } });
    expect(httpRes.status).not.toHaveBeenCalled();
    expect(httpRes.write).not.toHaveBeenCalled();

    // Heartbeat and resync frames must NOT emit `id:` so browser Last-Event-ID UUID is preserved.
    expect(
      formatSseFrame({ type: 'heartbeat', retry: 3_000, data: { at: '2026-11-26T00:00:00.000Z' } }),
    ).not.toContain('id:');
    expect(
      formatSseFrame({
        type: 'resync',
        retry: 3_000,
        data: { reason: 'CURSOR_UNAVAILABLE', at: '2026-11-26T00:00:00.000Z' },
      }),
    ).not.toContain('id:');
    expect(
      formatSseFrame({
        id: HENKATEN_ID,
        type: 'invalidate',
        retry: 3_000,
        data: { eventType: 'HENKATEN_OPENED' },
      }),
    ).toContain(`id: ${HENKATEN_ID}`);

    // Pre-subscription eviction: stream 1 is evicted BEFORE subscribe() is called.
    const resA = fakeResponse();
    const resB = fakeResponse();
    const unsubscribed1 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      undefined,
      undefined,
      resA as never,
    );
    const stream2 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      undefined,
      undefined,
      resB as never,
    );
    const completed1 = vi.fn();
    const sub1 = unsubscribed1.subscribe({ complete: completed1 });
    expect(completed1).toHaveBeenCalledOnce();
    const sub2 = stream2.subscribe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('closes stalled SSE writers exceeding hard byte budget and defers resync until drain', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: {
          findFirst: vi.fn().mockResolvedValue({ id: LINE_A }),
          findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]),
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
      {
        sseMaxPerSession: 6,
        sseMaxPerUser: 12,
        sseMaxPerSupplier: 60,
        sseMaxGlobal: 300,
        sseRevalidationCacheMs: 2_000,
      } as never,
    );

    const res = fakeResponse();
    const stream = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      res as never,
    );
    const messages: Array<{ type: string }> = [];
    const completed = vi.fn();
    const sub = stream.subscribe({ next: (m) => messages.push(m), complete: completed });
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Simulate writableNeedDrain: resync must be deferred until 'drain' fires.
    res.writableNeedDrain = true;
    events.next(event({ id: randomUUID() }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(messages.filter((m) => m.type === 'resync')).toHaveLength(0);

    res.writableNeedDrain = false;
    res.emit('drain');
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(messages.filter((m) => m.type === 'resync')).toHaveLength(1);

    // Exceeding hard byte budget closes and destroys the stalled HTTP socket immediately.
    res.writableLength = 600 * 1024;
    events.next(event({ id: randomUUID() }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(completed).toHaveBeenCalledOnce();
    expect(res.destroy).toHaveBeenCalledOnce();
    sub.unsubscribe();
  });

  it('destroys stalled HTTP socket through handleHttpStream when drainLive hits hard byte cap', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    let resolveSessionGate!: (value: RequestPrincipal) => void;
    let calls = 0;
    const resolveSession = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls <= 2) return Promise.resolve(principal);
      return new Promise<RequestPrincipal>((resolve) => {
        resolveSessionGate = resolve;
      });
    });
    const service = new RealtimeService(
      {
        line: {
          findFirst: vi.fn().mockResolvedValue({ id: LINE_A }),
          findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]),
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: resolveSession } as never,
    );
    const httpRes = Object.assign(fakeResponse(), {
      status: vi.fn(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    });

    await service.handleHttpStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      httpRes as never,
    );
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Enqueue event while below cap; then raise buffer past hard cap before drainLive finishes validation.
    events.next(event({ id: randomUUID() }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    httpRes.writableLength = 600 * 1024;
    resolveSessionGate(principal);
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(httpRes.destroy).toHaveBeenCalledOnce();
  });

  it('aborts remaining replay DB pages when the stream closes mid-replay', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    let resolveBatch1!: (rows: RealtimeOutboxEvent[]) => void;
    const batch1 = new Promise<RealtimeOutboxEvent[]>((resolve) => {
      resolveBatch1 = resolve;
    });
    const findMany = vi.fn().mockReturnValueOnce(batch1).mockResolvedValue([]);
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]) },
        outboxEvent: { findMany },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );

    const sub = service
      .stream(new TenantScope(SUPPLIER_ID), principal, undefined, undefined)
      .subscribe();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(findMany).toHaveBeenCalledTimes(1);

    sub.unsubscribe();
    resolveBatch1(
      Array.from({ length: 501 }, () => event({ id: randomUUID(), payload: { lineId: LINE_B } })),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('serializes slow heartbeats and coalesces concurrent bypass checks across tabs of the same session', async () => {
    vi.useFakeTimers();
    try {
      const events = new Subject<RealtimeOutboxEvent>();
      let resolveSlowHeartbeat: ((value: RequestPrincipal) => void) | undefined;
      let calls = 0;
      const resolve = vi.fn().mockImplementation(() => {
        calls += 1;
        // Initial startup + post-replay checks are coalesced across both tabs into call #1;
        // heartbeat bypass checks stay pending from call #2 onward.
        if (calls <= 1) return Promise.resolve(principal);
        return new Promise<RequestPrincipal>((r) => {
          resolveSlowHeartbeat = r;
        });
      });
      const service = new RealtimeService(
        {
          line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]) },
          outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
        } as never,
        { events: () => events } as never,
        { resolve } as never,
        {
          sseMaxPerSession: 6,
          sseMaxPerUser: 12,
          sseMaxPerSupplier: 60,
          sseMaxGlobal: 300,
          sseRevalidationCacheMs: 2_000,
        } as never,
      );

      const res1 = fakeResponse();
      const res2 = fakeResponse();
      const s1 = await service.prepareStream(
        new TenantScope(SUPPLIER_ID),
        principal,
        undefined,
        undefined,
        res1 as never,
      );
      const s2 = await service.prepareStream(
        new TenantScope(SUPPLIER_ID),
        principal,
        undefined,
        undefined,
        res2 as never,
      );
      const sub1 = s1.subscribe();
      const sub2 = s2.subscribe();
      await vi.advanceTimersByTimeAsync(0);
      const callsAfterStart = resolve.mock.calls.length;

      // Both tabs hit their 15s heartbeat tick; coalesced into a single live bypass DB lookup.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(resolve.mock.calls.length).toBe(callsAfterStart + 1);

      // Even after another 30s while the first heartbeat query is stalled, no overlapping heartbeats pile up.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(resolve.mock.calls.length).toBe(callsAfterStart + 1);

      resolveSlowHeartbeat?.(principal);
      await vi.advanceTimersByTimeAsync(0);
      sub1.unsubscribe();
      sub2.unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('delivers MASTER_DATA_REMOVED for a tombstoned line to unfiltered board streams while closing line-filtered streams', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    let activeLines = [{ id: LINE_A }, { id: LINE_B }];
    const service = new RealtimeService(
      {
        line: {
          findFirst: vi.fn().mockResolvedValue({ id: LINE_A }),
          findMany: vi.fn().mockImplementation(() => Promise.resolve(activeLines)),
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );

    const unfilteredMessages: string[] = [];
    const lineFilteredCompleted = vi.fn();
    const resUnfiltered = fakeResponse();
    const resFiltered = fakeResponse();
    const unfiltered = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      undefined,
      undefined,
      resUnfiltered as never,
    );
    const filtered = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      resFiltered as never,
    );
    const subUnfiltered = unfiltered.subscribe((m) => unfilteredMessages.push(m.type));
    const subFiltered = filtered.subscribe({ complete: lineFilteredCompleted });
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Tombstone LINE_A, then publish MASTER_DATA_REMOVED referencing the deleted lineId.
    activeLines = [{ id: LINE_B }];
    events.next(
      event({
        id: randomUUID(),
        eventType: 'MASTER_DATA_REMOVED',
        aggregateType: 'Line',
        aggregateId: LINE_A,
        payload: { kind: 'LINE', mode: 'DELETE', lineId: LINE_A },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(unfilteredMessages).toContain('invalidate');
    expect(lineFilteredCompleted).toHaveBeenCalledOnce();
    subUnfiltered.unsubscribe();
    subFiltered.unsubscribe();
  });

  it('requeries allowed lines when invalidated mid-flight instead of returning stale lines', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    let releaseStaleLoad!: (rows: Array<{ id: string }>) => void;
    let loadCount = 0;
    const findManyLines = vi.fn().mockImplementation(() => {
      loadCount += 1;
      if (loadCount === 1) return Promise.resolve([{ id: LINE_A }]);
      if (loadCount === 2) {
        return new Promise<Array<{ id: string }>>((resolve) => {
          releaseStaleLoad = resolve;
        });
      }
      return Promise.resolve([{ id: LINE_B }]);
    });

    const service = new RealtimeService(
      {
        line: {
          findFirst: vi.fn().mockResolvedValue({ id: LINE_A }),
          findMany: findManyLines,
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
      {
        sseMaxPerSession: 6,
        sseMaxPerUser: 12,
        sseMaxPerSupplier: 60,
        sseMaxGlobal: 300,
        sseRevalidationCacheMs: 0,
      } as never,
    );

    const received: string[] = [];
    const completed = vi.fn();
    const res = fakeResponse();
    const stream = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      res as never,
    );
    const sub = stream.subscribe({
      next: (msg) => received.push(msg.type),
      complete: completed,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Trigger a live event that starts load #2 (in-flight).
    events.next(
      event({ id: randomUUID(), eventType: 'HENKATEN_OPENED', payload: { lineId: LINE_A } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    // While load #2 is in-flight, MASTER_DATA_REMOVED bumps line epoch once for the tenant.
    events.next(
      event({
        id: randomUUID(),
        eventType: 'MASTER_DATA_REMOVED',
        aggregateType: 'Line',
        aggregateId: LINE_A,
        payload: { kind: 'LINE', mode: 'DELETE', lineId: LINE_A },
      }),
    );
    // Now resolve the stale load #2 with [LINE_A]; loadAllowedLines must detect epoch mismatch and requery load #3 ([LINE_B]).
    releaseStaleLoad([{ id: LINE_A }]);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(findManyLines).toHaveBeenCalledTimes(3);
    expect(received).not.toContain('invalidate');
    expect(completed).toHaveBeenCalledOnce();
    sub.unsubscribe();
  });

  it('forwards RealtimeEventPump overflow resync signals to active streams', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const resyncs = new Subject<void>();
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]) },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events, resyncs: () => resyncs } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );

    const received: string[] = [];
    const sub = service
      .stream(new TenantScope(SUPPLIER_ID), principal, undefined, undefined)
      .subscribe((msg) => received.push(msg.type));
    await new Promise((resolve) => setTimeout(resolve, 15));

    resyncs.next();
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(received).toContain('resync');
    sub.unsubscribe();
  });

  it('immediately destroys evicted sockets that are already backpressured instead of holding them in grace', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: {
          findFirst: vi.fn().mockResolvedValue({ id: LINE_A }),
          findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]),
        },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
      {
        sseMaxPerSession: 1,
        sseMaxPerUser: 5,
        sseMaxPerSupplier: 10,
        sseMaxGlobal: 20,
        sseRevalidationCacheMs: 2_000,
      } as never,
    );

    const stalledRes = fakeResponse();
    stalledRes.writableNeedDrain = true;
    const stream1 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      stalledRes as never,
    );
    const sub1 = stream1.subscribe();

    const freshRes = fakeResponse();
    const stream2 = await service.prepareStream(
      new TenantScope(SUPPLIER_ID),
      principal,
      LINE_A,
      undefined,
      freshRes as never,
    );
    const sub2 = stream2.subscribe();

    expect(stalledRes.destroy).toHaveBeenCalledOnce();
    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('caps concurrent replay SQL queries across rapid evictions and falls back to resync until in-flight replays settle', async () => {
    const events = new Subject<RealtimeOutboxEvent>();
    const resolvers: Array<(rows: RealtimeOutboxEvent[]) => void> = [];
    const findManyOutbox = vi.fn().mockImplementation(
      () =>
        new Promise<RealtimeOutboxEvent[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const service = new RealtimeService(
      {
        line: {
          findFirst: vi.fn().mockResolvedValue({ id: LINE_A }),
          findMany: vi.fn().mockResolvedValue([{ id: LINE_A }]),
        },
        outboxEvent: { findMany: findManyOutbox },
      } as never,
      { events: () => events } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
      {
        sseMaxPerSession: 1,
        sseMaxPerUser: 5,
        sseMaxPerSupplier: 10,
        sseMaxGlobal: 20,
        sseRevalidationCacheMs: 2_000,
      } as never,
    );

    const openAndSubscribe = async () => {
      const res = fakeResponse();
      const s = await service.prepareStream(
        new TenantScope(SUPPLIER_ID),
        principal,
        LINE_A,
        undefined,
        res as never,
      );
      const msgs: string[] = [];
      const sub = s.subscribe((m) => msgs.push(m.type));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { res, sub, msgs };
    };

    // Streams 1 and 2 occupy the 2 per-user replay DB slots even after stream 1 is evicted.
    const c1 = await openAndSubscribe();
    const c2 = await openAndSubscribe();
    expect(findManyOutbox).toHaveBeenCalledTimes(2);

    // Stream 3 evicts stream 2 while both replay queries are still pending: must NOT start a 3rd SQL query.
    const c3 = await openAndSubscribe();
    expect(findManyOutbox).toHaveBeenCalledTimes(2);
    expect(c3.msgs).toContain('resync');

    // Once an in-flight replay settles, its replay budget slot is released for future streams.
    resolvers.shift()?.([]);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const c4 = await openAndSubscribe();
    expect(findManyOutbox).toHaveBeenCalledTimes(3);

    resolvers.forEach((resolve) => resolve([]));
    await new Promise((resolve) => setTimeout(resolve, 15));
    c1.sub.unsubscribe();
    c2.sub.unsubscribe();
    c3.sub.unsubscribe();
    c4.sub.unsubscribe();
  });
});
