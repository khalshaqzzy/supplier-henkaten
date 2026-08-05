import { describe, expect, it } from 'vitest';

import { loadAppConfig } from '../config/app-config.js';
import { PushSubscriptionService } from './push.service.js';

const config = loadAppConfig({
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:55432/database',
  SESSION_CSRF_SECRET: 'csrf-secret-that-is-at-least-thirty-two-characters',
  AUTH_THROTTLE_SECRET: 'throttle-secret-at-least-thirty-two-characters',
  PUSH_ENABLED: 'true',
  PUSH_VAPID_PUBLIC_KEY: 'A'.repeat(64),
  PUSH_VAPID_PRIVATE_KEY: 'B'.repeat(32),
  PUSH_VAPID_SUBJECT: 'mailto:push@example.com',
  PUSH_ENDPOINT_HOSTS: 'push.example.com,.googleapis.com',
});

const principal = {
  userId: '00000000-0000-4000-8000-000000000001',
  supplierId: '00000000-0000-4000-8000-000000000002',
  displayName: 'Line Leader',
  realm: 'SUPPLIER' as const,
  role: 'LINE_LEADER' as const,
  purpose: 'NORMAL' as const,
  mustChangePassword: false,
  sessionId: '00000000-0000-4000-8000-000000000004',
  rawSessionToken: 'test-session-token',
};

describe('push subscription endpoint validation', () => {
  const service = new PushSubscriptionService({} as never, {} as never, config);
  const subscription = (endpoint: string) =>
    service.subscribe(
      principal,
      '00000000-0000-4000-8000-000000000003',
      {
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) },
      },
      'correlation-id',
    );

  it.each([
    'http://push.example.com/send/1',
    'https://push.example.com:8443/send/1',
    'https://127.0.0.1/send/1',
    'https://push.example.com.evil.test/send/1',
    'https://user:password@push.example.com/send/1',
  ])('rejects non-vendor or unsafe target %s', async (endpoint) => {
    await expect(subscription(endpoint)).rejects.toMatchObject({ response: { status: 400 } });
  });
});
