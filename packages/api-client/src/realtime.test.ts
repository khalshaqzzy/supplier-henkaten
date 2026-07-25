import { describe, expect, it, vi } from 'vitest';

import { createSupplierRealtimeClient } from './realtime';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly listeners = new Map<string, EventListener>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly init: EventSourceInit,
  ) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }
}

describe('Supplier realtime client', () => {
  it('tracks connection, parses invalidations, reconnects and closes', () => {
    const states: string[] = [];
    const onInvalidate = vi.fn();
    const onReconnect = vi.fn();
    const client = createSupplierRealtimeClient({
      baseUrl: 'https://api.example.test',
      query: { lineId: '00000000-0000-4000-8000-000000000001' },
      onInvalidate,
      onReconnect,
      onStateChange: (state) => states.push(state),
      eventSourceFactory: (url, init) => new FakeEventSource(url, init) as unknown as EventSource,
    });
    client.connect();
    const first = FakeEventSource.last!;
    expect(first.url).toContain('lineId=');
    expect(first.init.withCredentials).toBe(true);
    first.onopen?.();
    first.listeners.get('invalidate')?.(
      new MessageEvent('invalidate', {
        data: JSON.stringify({
          eventType: 'ASSIGNMENT_CHANGED',
          aggregateType: 'SHIFT_RUN',
          aggregateId: '00000000-0000-4000-8000-000000000002',
          aggregateVersion: 2,
          occurredAt: '2026-07-24T00:00:00.000Z',
          refresh: ['assignment-board'],
        }),
      }),
    );
    expect(onInvalidate).toHaveBeenCalledOnce();
    expect(() =>
      first.listeners.get('invalidate')?.(new MessageEvent('invalidate', { data: '{malformed' })),
    ).not.toThrow();
    expect(() =>
      first.listeners.get('heartbeat')?.(new MessageEvent('heartbeat', { data: '{malformed' })),
    ).not.toThrow();
    expect(onInvalidate).toHaveBeenCalledOnce();
    client.reconnect();
    const second = FakeEventSource.last!;
    expect(first.closed).toBe(true);
    second.onopen?.();
    expect(onReconnect).toHaveBeenCalledOnce();
    client.close();
    expect(second.closed).toBe(true);
    expect(states).toEqual(['connecting', 'connected', 'connecting', 'connected', 'disconnected']);
  });
});
