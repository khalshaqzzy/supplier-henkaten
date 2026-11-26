import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { firstValueFrom, Subject } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';

import { realtimeInvalidationSchema, realtimeResyncSchema } from '@tmmin-henkaten/contracts';

import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { RealtimeEventPump, type RealtimeOutboxEvent } from './realtime-event-pump.js';
import { RealtimeService } from './realtime.service.js';

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
    writableLength: 0,
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
      eventType: 'MP_MOVED',
      payload: { lineId: LINE_A, sourceLineId: LINE_B },
    });
    const deleteCommandId = randomUUID();
    const deleteEvent = event({
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
});
