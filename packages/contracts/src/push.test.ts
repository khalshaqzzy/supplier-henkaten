import { describe, expect, it } from 'vitest';

import {
  createPushSubscriptionRequestSchema,
  pushConfigSchema,
  pushSubscriptionSchema,
} from './push.js';

describe('supplier Web Push contracts', () => {
  it('accepts a redacted device status without endpoint or keys', () => {
    const parsed = pushConfigSchema.parse({
      enabled: true,
      mandatory: true,
      applicationServerKey: 'A'.repeat(64),
      permissionGuidance: {
        explicitGestureRequired: true,
        iosHomeScreenRequired: true,
        minimumIosVersion: '16.4',
      },
      subscription: {
        id: '00000000-0000-4000-8000-000000000001',
        status: 'ACTIVE',
        expirationAt: null,
        lastAcceptedAt: null,
        version: 1,
      },
    });
    expect(parsed.subscription).not.toHaveProperty('endpoint');
    expect(parsed.subscription).not.toHaveProperty('keys');
  });

  it('rejects non-HTTPS subscription endpoints', () => {
    expect(() =>
      createPushSubscriptionRequestSchema.parse({
        endpoint: 'http://push.example.com/send/1',
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) },
      }),
    ).toThrow();
  });

  it('keeps returned subscription material free of browser credentials', () => {
    const result = pushSubscriptionSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      status: 'ACTIVE',
      expirationAt: null,
      lastAcceptedAt: null,
      version: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      endpoint: 'https://push.example.com/secret',
    });
    expect(result.success).toBe(false);
  });
});
