import {
  realtimeHeartbeatSchema,
  realtimeInvalidationSchema,
  type RealtimeInvalidation,
} from '@tmmin-henkaten/contracts';

import { normalizeApiBaseUrl, type QueryRecord } from './core';

export type RealtimeConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface SupplierRealtimeOptions {
  baseUrl: string;
  query?: QueryRecord;
  onInvalidate: (event: RealtimeInvalidation) => void;
  onStateChange: (state: RealtimeConnectionState) => void;
  onReconnect?: () => void;
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
  let hasConnected = false;
  const factory =
    options.eventSourceFactory ??
    ((url: string, init: EventSourceInit) => new EventSource(url, init));

  const open = () => {
    source?.close();
    options.onStateChange('connecting');
    const url = new URL('/api/v1/supplier/realtime', `${normalizeApiBaseUrl(options.baseUrl)}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== '')
        url.searchParams.set(key, String(value));
    }
    source = factory(url.toString(), { withCredentials: true });
    source.onopen = () => {
      options.onStateChange('connected');
      if (hasConnected) options.onReconnect?.();
      hasConnected = true;
    };
    source.onerror = () => options.onStateChange('disconnected');
    source.addEventListener('heartbeat', (event) => {
      try {
        realtimeHeartbeatSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // A malformed heartbeat must not terminate the native EventSource reconnect lifecycle.
      }
    });
    source.addEventListener('invalidate', (event) => {
      try {
        const parsed = realtimeInvalidationSchema.safeParse(
          JSON.parse((event as MessageEvent<string>).data),
        );
        if (parsed.success) options.onInvalidate(parsed.data);
      } catch {
        // Ignore malformed invalidations; the next authoritative refetch remains the source of truth.
      }
    });
  };

  return {
    connect: open,
    reconnect: open,
    close() {
      source?.close();
      source = null;
      options.onStateChange('disconnected');
    },
  };
}
