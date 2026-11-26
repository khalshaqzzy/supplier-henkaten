import {
  realtimeHeartbeatSchema,
  realtimeInvalidationSchema,
  realtimeResyncSchema,
  type RealtimeInvalidation,
} from '@tmmin-henkaten/contracts';

import { normalizeApiBaseUrl, type QueryRecord } from './core';

export type RealtimeConnectionState = 'connecting' | 'connected' | 'resyncing' | 'disconnected';

export interface SupplierRealtimeOptions {
  baseUrl: string;
  query?: QueryRecord;
  onInvalidate: (event: RealtimeInvalidation) => void;
  onStateChange: (state: RealtimeConnectionState) => void;
  onReconnect?: () => void;
  onResync?: () => void | Promise<void>;
  eventSourceFactory?: (url: string, init: EventSourceInit) => EventSource;
}

export interface SupplierRealtimeClient {
  connect(): void;
  reconnect(): void;
  close(): void;
}

export function createSupplierRealtimeClient(
  options: SupplierRealtimeOptions,
): SupplierRealtimeClient {
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let reconnectAttempts = 0;
  let hasConnected = false;
  const factory =
    options.eventSourceFactory ??
    ((url: string, init: EventSourceInit) => new EventSource(url, init));

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) return;
    const baseDelay = Math.min(30_000, 3_000 * 2 ** Math.min(reconnectAttempts, 4));
    const jitter = Math.floor(Math.random() * 1_000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!closed) open();
    }, baseDelay + jitter);
  };

  const open = () => {
    closed = false;
    clearReconnectTimer();
    source?.close();
    options.onStateChange('connecting');
    const url = new URL('/api/v1/supplier/realtime', `${normalizeApiBaseUrl(options.baseUrl)}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== '')
        url.searchParams.set(key, String(value));
    }
    const current = factory(url.toString(), { withCredentials: true });
    source = current;
    current.onopen = () => {
      if (source !== current) return;
      reconnectAttempts = 0;
      options.onStateChange('connected');
      if (hasConnected) options.onReconnect?.();
      hasConnected = true;
    };
    current.onerror = () => {
      if (source !== current) return;
      options.onStateChange('disconnected');
      // Browsers do not auto-retry EventSource once readyState becomes CLOSED (2),
      // e.g. after a transient 429 during reconnect storms; recover with bounded backoff.
      if (current.readyState === 2) {
        current.close();
        scheduleReconnect();
      }
    };
    current.addEventListener('heartbeat', (event) => {
      try {
        realtimeHeartbeatSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // A malformed heartbeat must not terminate the native EventSource reconnect lifecycle.
      }
    });
    current.addEventListener('invalidate', (event) => {
      try {
        const parsed = realtimeInvalidationSchema.safeParse(
          JSON.parse((event as MessageEvent<string>).data),
        );
        if (parsed.success) options.onInvalidate(parsed.data);
      } catch {
        // Ignore malformed invalidations; the next authoritative refetch remains the source of truth.
      }
    });
    current.addEventListener('resync', (event) => {
      try {
        const parsed = realtimeResyncSchema.safeParse(
          JSON.parse((event as MessageEvent<string>).data),
        );
        if (!parsed.success) return;
        options.onStateChange('resyncing');
        void Promise.resolve(options.onResync?.()).finally(() => {
          options.onStateChange('connected');
        });
      } catch {
        // Ignore malformed control events and retain the current authoritative REST state.
      }
    });
  };

  return {
    connect: open,
    reconnect: open,
    close() {
      closed = true;
      clearReconnectTimer();
      source?.close();
      source = null;
      options.onStateChange('disconnected');
    },
  };
}
