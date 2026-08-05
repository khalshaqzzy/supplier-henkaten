import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';

import type { PushConfig } from '@tmmin-henkaten/contracts';

import { supplierApi } from './api';
import { unsubscribeBrowserPush } from './push-browser';
import { scopedKey } from './query';
import { useSession } from './session';

type PushSupport = 'SUPPORTED' | 'IOS_INSTALL_REQUIRED' | 'UNSUPPORTED';

type PushContextValue = {
  config: PushConfig | null;
  support: PushSupport;
  permission: NotificationPermission | 'unsupported';
  busy: boolean;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

const PushContext = createContext<PushContextValue | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
  const { session, status } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = detectPushSupport();
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const scope = session?.supplier
    ? {
        userId: session.principal.userId,
        supplierId: session.supplier.id,
        purpose: session.principal.purpose,
      }
    : null;
  const query = useQuery({
    queryKey: scope ? scopedKey(scope, 'push-config') : ['SUPPLIER', 'push-config'],
    queryFn: () => supplierApi.pushConfig(),
    enabled: status === 'authenticated' && Boolean(scope),
    staleTime: 15_000,
  });

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && status === 'authenticated') {
        void query.refetch();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [query, status]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (support !== 'SUPPORTED') throw new Error('Push tidak didukung pada mode perangkat ini.');
      const config = query.data ?? (await supplierApi.pushConfig());
      if (!config.enabled || !config.applicationServerKey) {
        throw new Error('Push belum diaktifkan pada environment ini.');
      }
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') {
        throw new Error('Izin notifikasi ditolak. Ubah izin browser sebelum melanjutkan.');
      }
      const registration = await navigator.serviceWorker.ready;
      let existing = await registration.pushManager.getSubscription();
      if (existing && !config.subscription) {
        await existing.unsubscribe();
        existing = null;
      }
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(config.applicationServerKey),
        }));
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error('Browser tidak memberikan subscription key yang lengkap.');
      }
      await supplierApi.createPushSubscription({
        endpoint: json.endpoint,
        expirationTime: json.expirationTime ?? null,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Push tidak dapat diaktifkan.');
    } finally {
      setBusy(false);
    }
  }, [query, support]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const config = query.data;
      if (config?.subscription) {
        await supplierApi.deletePushSubscription(
          config.subscription.id,
          config.subscription.version,
        );
      }
      await unsubscribeBrowserPush();
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Push tidak dapat dinonaktifkan.');
    } finally {
      setBusy(false);
    }
  }, [query]);

  const value = useMemo<PushContextValue>(
    () => ({
      config: query.data ?? null,
      support,
      permission,
      busy,
      error: error ?? (query.isError ? 'Status push tidak dapat dimuat.' : null),
      loading: query.isLoading,
      refresh,
      enable,
      disable,
    }),
    [
      busy,
      disable,
      enable,
      error,
      permission,
      query.data,
      query.isError,
      query.isLoading,
      refresh,
      support,
    ],
  );
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): PushContextValue {
  const value = useContext(PushContext);
  if (!value) throw new Error('usePush must be used within PushProvider.');
  return value;
}

function detectPushSupport(): PushSupport {
  const hasApis =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (ios && !standalone) return 'IOS_INSTALL_REQUIRED';
  return hasApis ? 'SUPPORTED' : 'UNSUPPORTED';
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
