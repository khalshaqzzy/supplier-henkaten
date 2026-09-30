import { firstValueFrom, Subject } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';

import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { RealtimeEventPump, type RealtimeOutboxEvent } from './realtime-event-pump.js';
import { RealtimeService } from './realtime.service.js';

const principal: RequestPrincipal = {
  userId: 'user-1',
  displayName: 'Supplier Admin',
  realm: 'SUPPLIER',
  role: 'SUPPLIER_ADMIN',
  supplierId: 'supplier-1',
  purpose: 'NORMAL',
  mustChangePassword: false,
  sessionId: 'session-1',
  rawSessionToken: 'session-token',
};

function event(overrides: Partial<RealtimeOutboxEvent> = {}): RealtimeOutboxEvent {
  return {
    id: 'event-1',
    eventType: 'HENKATEN_OPENED',
    aggregateType: 'Henkaten',
    aggregateId: 'henkaten-1',
    aggregateVersion: 1,
    supplierId: 'supplier-1',
    occurredAt: new Date('2026-07-25T00:00:00.000Z'),
    payload: { lineId: 'line-a' },
    ...overrides,
  };
}

describe('RealtimeEventPump', () => {
  it('polls the ordered outbox once and fans each event to subscribers', async () => {
    const events = [event(), event({ id: 'event-2', aggregateVersion: 2 })];
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
  it('emits resync when Last-Event-ID is unavailable in the tenant history', async () => {
    const pumpEvents = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: 'line-a' }]) },
        outboxEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      } as never,
      { events: () => pumpEvents.asObservable() } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );

    const message = await firstValueFrom(
      service.stream(new TenantScope('supplier-1'), principal, undefined, 'missing-event').pipe(
        filter(({ type }) => type === 'resync'),
        take(1),
      ),
    );

    expect(message.data.reason).toBe('CURSOR_UNAVAILABLE');
  });

  it('fans live events only to the authorized tenant and requested line', async () => {
    const pumpEvents = new Subject<RealtimeOutboxEvent>();
    const service = new RealtimeService(
      {
        line: { findMany: vi.fn().mockResolvedValue([{ id: 'line-a' }, { id: 'line-b' }]) },
        outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { events: () => pumpEvents.asObservable() } as never,
      { resolve: vi.fn().mockResolvedValue(principal) } as never,
    );
    const nextInvalidation = firstValueFrom(
      service.stream(new TenantScope('supplier-1'), principal, 'line-a', undefined).pipe(
        filter(({ type }) => type === 'invalidate'),
        take(1),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    pumpEvents.next(event({ id: 'wrong-tenant', supplierId: 'supplier-2' }));
    pumpEvents.next(event({ id: 'wrong-line', payload: { lineId: 'line-b' } }));
    pumpEvents.next(event({ id: 'right-line' }));

    await expect(nextInvalidation).resolves.toMatchObject({
      id: 'right-line',
      type: 'invalidate',
      data: {
        lineId: 'line-a',
        refresh: ['assignment-board', 'assignment-board-layout', 'notifications', 'dashboard'],
      },
    });
  });
  it('closes a silent stream when the session is revoked without touching its activity', async () => {
    vi.useFakeTimers();
    try {
      const events = new Subject<RealtimeOutboxEvent>();
      const resolve = vi.fn().mockResolvedValue(principal);
      const service = new RealtimeService(
        {
          line: { findMany: vi.fn().mockResolvedValue([{ id: 'line-a' }]) },
          outboxEvent: { findMany: vi.fn().mockResolvedValue([]) },
        } as never,
        { events: () => events } as never,
        { resolve } as never,
      );
      const messages: unknown[] = [];
      const complete = vi.fn();
      service
        .stream(new TenantScope('supplier-1'), principal, undefined, undefined)
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
      .mockResolvedValueOnce([{ id: 'line-a' }])
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
      .stream(new TenantScope('supplier-1'), principal, undefined, undefined)
      .subscribe((item) => received.push(item.type));
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.next(event({ id: 'live' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).not.toContain('invalidate');
    sub.unsubscribe();
  });
});
