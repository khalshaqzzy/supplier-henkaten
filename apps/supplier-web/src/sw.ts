/// <reference lib="webworker" />

import { bypassRuntimeCache, safePushDeepLink } from './sw-policy';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

const OFFLINE_URL = '/offline.html';
const PRECACHE_MANIFEST = self.__WB_MANIFEST;
const PRECACHE_URLS = [...new Set(PRECACHE_MANIFEST.map(({ url }) => url))];
const CACHE_NAME = `supplier-henkaten-shell-${stableHash(
  PRECACHE_MANIFEST.map(({ url, revision }) => `${url}:${revision ?? ''}`).join('|'),
)}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (bypassRuntimeCache(request.method, request.url, self.location.origin)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((value) => value ?? Response.error()),
      ),
    );
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});

self.addEventListener('push', (event) => {
  const payload = parsePayload(event.data?.text());
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: payload.tag,
      renotify: false,
      data: {
        deepLink: safePushDeepLink(payload.deepLink),
        notificationId: payload.notificationId,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { deepLink?: unknown } | undefined;
  const deepLink = safePushDeepLink(data?.deepLink);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const target = new URL(deepLink, self.location.origin).href;
      for (const client of clients) {
        if ('focus' in client) {
          await client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

function parsePayload(value: string | undefined) {
  try {
    const parsed = JSON.parse(value ?? '{}') as Record<string, unknown>;
    return {
      notificationId: stringValue(parsed['notificationId'], ''),
      title: stringValue(parsed['title'], 'TMMIN Henkaten'),
      body: stringValue(parsed['body'], 'Ada aktivitas operasional yang memerlukan perhatian.'),
      tag: stringValue(parsed['tag'], 'supplier-henkaten'),
      deepLink: stringValue(parsed['deepLink'], '/notifications'),
    };
  } catch {
    return {
      notificationId: '',
      title: 'TMMIN Henkaten',
      body: 'Ada aktivitas operasional yang memerlukan perhatian.',
      tag: 'supplier-henkaten',
      deepLink: '/notifications',
    };
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length <= 1_000 ? value : fallback;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}
