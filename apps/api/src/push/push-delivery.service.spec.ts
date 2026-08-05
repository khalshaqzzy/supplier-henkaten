import { describe, expect, it, vi } from 'vitest';

import { loadAppConfig } from '../config/app-config.js';
import { PushDeliveryService } from './push-delivery.service.js';

const config = loadAppConfig({
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:55432/database',
  SESSION_CSRF_SECRET: 'csrf-secret-that-is-at-least-thirty-two-characters',
  AUTH_THROTTLE_SECRET: 'throttle-secret-at-least-thirty-two-characters',
  PUSH_ENABLED: 'true',
  PUSH_VAPID_PUBLIC_KEY: 'A'.repeat(64),
  PUSH_VAPID_PRIVATE_KEY: 'B'.repeat(32),
  PUSH_VAPID_SUBJECT: 'mailto:push@example.com',
});

describe('push payload materialization', () => {
  it('creates an idempotent non-PII Henkaten snapshot for active devices', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      pushSubscription: {
        findMany: vi.fn().mockResolvedValue([{ id: 'subscription-id' }]),
      },
      henkaten: {
        findUnique: vi.fn().mockResolvedValue({
          identifier: 'HEN-2026-0001',
          category: 'MAN',
          status: 'OPEN',
          line: { code: 'L-01' },
          job: { name: 'Torque Check' },
          creatorName: 'Must not be selected',
          cause: 'Must not be selected',
        }),
      },
      pushDelivery: { createMany },
    };
    const service = new PushDeliveryService(config);
    await service.materialize(
      {
        id: '00000000-0000-4000-8000-000000000001',
        supplierId: '00000000-0000-4000-8000-000000000002',
        recipientUserId: '00000000-0000-4000-8000-000000000003',
        kind: 'APPROVAL_PENDING',
        title: 'Untrusted title',
        body: 'Untrusted body containing a member name',
        resourceType: 'Henkaten',
        resourceId: '00000000-0000-4000-8000-000000000004',
        deepLink: '//evil.example/steal',
      },
      transaction as never,
    );

    const data = createMany.mock.calls[0]![0].data[0];
    expect(data.payload).toEqual({
      notificationId: '00000000-0000-4000-8000-000000000001',
      kind: 'APPROVAL_PENDING',
      title: 'Approval Henkaten menunggu',
      body: 'HEN-2026-0001 · MAN · OPEN · L-01 · Torque Check',
      deepLink: '/notifications',
      tag: 'henkaten:00000000-0000-4000-8000-000000000004:APPROVAL_PENDING',
    });
    expect(JSON.stringify(data.payload)).not.toContain('member name');
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('does not create push rows for routine terminal outcomes', async () => {
    const transaction = {
      pushSubscription: { findMany: vi.fn() },
      pushDelivery: { createMany: vi.fn() },
    };
    await new PushDeliveryService(config).materialize(
      {
        id: '00000000-0000-4000-8000-000000000001',
        supplierId: '00000000-0000-4000-8000-000000000002',
        recipientUserId: '00000000-0000-4000-8000-000000000003',
        kind: 'HENKATEN_APPROVED',
        title: 'Approved',
        body: 'Approved',
        resourceType: 'Henkaten',
        resourceId: '00000000-0000-4000-8000-000000000004',
        deepLink: '/henkatens/00000000-0000-4000-8000-000000000004',
      },
      transaction as never,
    );
    expect(transaction.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(transaction.pushDelivery.createMany).not.toHaveBeenCalled();
  });
});
