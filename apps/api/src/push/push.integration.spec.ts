import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { PushDeliveryService } from './push-delivery.service.js';
import { PushDeliveryWorker } from './push-delivery.worker.js';
import { WEB_PUSH_GATEWAY, type WebPushGateway } from './push.gateway.js';

const supplierOrigin = 'http://localhost:5173';
const password = 'Push-Integration-Password-123';

type Login = { cookie: string[]; csrf: string; userId: string };

class FakePushGateway implements WebPushGateway {
  readonly acceptedEndpoints: string[] = [];
  nextError: Error | null = null;

  send(subscription: { endpoint: string }, _payload: string, _ttl: number): Promise<void> {
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      return Promise.reject(error);
    }
    this.acceptedEndpoints.push(subscription.endpoint);
    return Promise.resolve();
  }
}

describe('Supplier Web Push persistence and enforcement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let deliveries: PushDeliveryService;
  let worker: PushDeliveryWorker;
  let gateway: FakePushGateway;
  let supplierCode: string;
  let supplierId: string;
  let first: Login;
  let second: Login;

  const installationOne = randomUUID();
  const installationTwo = randomUUID();
  const installationThree = randomUUID();
  const installationFour = randomUUID();
  const endpointOne = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const endpointTwo = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const endpointThree = `https://web.push.apple.com/Q${randomUUID()}`;
  const endpointFour = `https://updates.push.services.mozilla.com/wpush/v2/${randomUUID()}`;

  beforeAll(async () => {
    const vapid = webpush.generateVAPIDKeys();
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'integration-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'integration-test-throttle-secret-32';
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['PUSH_ENABLED'] = 'true';
    process.env['PUSH_VAPID_PUBLIC_KEY'] = vapid.publicKey;
    process.env['PUSH_VAPID_PRIVATE_KEY'] = vapid.privateKey;
    process.env['PUSH_VAPID_SUBJECT'] = 'mailto:push-integration@example.com';
    process.env['PUSH_DELIVERY_POLL_MS'] = '60000';

    gateway = new FakePushGateway();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WEB_PUSH_GATEWAY)
      .useValue(gateway)
      .compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    deliveries = app.get(PushDeliveryService);
    worker = app.get(PushDeliveryWorker);
    const passwords = app.get(PasswordService);
    supplierCode = `PUSH-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code: supplierCode,
        normalizedCode: supplierCode.toLowerCase(),
        name: 'Push Integration Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    supplierId = supplier.id;
    const passwordHash = await passwords.hash(password);
    const users = await Promise.all(
      ['first', 'second'].map(async (label) => {
        const username = `${label}-${randomUUID()}`;
        const registrationNumber = `PUSH-${randomUUID()}`;
        const member = await prisma.member.create({
          data: {
            supplierId,
            fullName: `${label} Line Leader`,
            registrationNumber,
            normalizedRegistrationNumber: registrationNumber.toLowerCase(),
            role: 'LINE_LEADER',
          },
        });
        return prisma.user.create({
          data: {
            realm: 'SUPPLIER',
            supplierId,
            memberId: member.id,
            role: 'LINE_LEADER',
            username,
            normalizedUsername: username,
            displayName: `${label} Line Leader`,
            passwordHash,
            mustChangePassword: false,
          },
        });
      }),
    );
    first = await login(users[0]!.username, users[0]!.id);
    second = await login(users[1]!.username, users[1]!.id);
  });

  afterAll(async () => {
    await app.close();
    for (const name of [
      'PUSH_ENABLED',
      'PUSH_VAPID_PUBLIC_KEY',
      'PUSH_VAPID_PRIVATE_KEY',
      'PUSH_VAPID_SUBJECT',
      'PUSH_DELIVERY_POLL_MS',
    ]) {
      delete process.env[name];
    }
  });

  it('hard-blocks Line Leader operations until this installation is active', async () => {
    const blocked = await supplierGet(first, '/api/v1/supplier/notifications/unread-count');
    expect(blocked.status).toBe(428);
    expect(blocked.body.code).toBe('PUSH_SUBSCRIPTION_REQUIRED');

    const config = await supplierGet(first, '/api/v1/supplier/push/config', installationOne);
    expect(config.status).toBe(200);
    expect(config.body).toMatchObject({ enabled: true, mandatory: true, subscription: null });
    expect(config.body).not.toHaveProperty('endpoint');

    const created = await createSubscription(first, installationOne, endpointOne);
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('endpoint');
    expect(created.body).not.toHaveProperty('keys');

    const allowed = await supplierGet(
      first,
      '/api/v1/supplier/notifications/unread-count',
      installationOne,
    );
    expect(allowed.status).toBe(200);
  });

  it('reassigns a shared browser endpoint and denies cross-user revocation', async () => {
    const reassigned = await createSubscription(second, installationTwo, endpointOne);
    expect(reassigned.status).toBe(201);

    const firstBlocked = await supplierGet(
      first,
      '/api/v1/supplier/notifications/unread-count',
      installationOne,
    );
    expect(firstBlocked.status).toBe(428);

    const crossUserDelete = await request(app.getHttpServer())
      .delete(`/api/v1/supplier/push-subscriptions/${reassigned.body.id}`)
      .set('Origin', supplierOrigin)
      .set('Cookie', first.cookie)
      .set('X-CSRF-Token', first.csrf)
      .set('X-Device-Installation-ID', installationOne)
      .send({ expectedVersion: reassigned.body.version });
    expect(crossUserDelete.status).toBe(404);
  });

  it('materializes one delivery per active device and claims concurrently without duplicates', async () => {
    expect((await createSubscription(first, installationOne, endpointTwo)).status).toBe(201);
    expect((await createSubscription(first, installationThree, endpointThree)).status).toBe(201);

    const notification = await createNotification(first.userId, 'APPROVAL_PENDING');
    await prisma.$transaction(async (transaction) => {
      await deliveries.materialize(notification, transaction);
      await deliveries.materialize(notification, transaction);
    });
    expect(await prisma.pushDelivery.count({ where: { notificationId: notification.id } })).toBe(2);

    await Promise.all([worker.processBatch(), worker.processBatch()]);
    const rows = await prisma.pushDelivery.findMany({ where: { notificationId: notification.id } });
    expect(rows.map(({ status }) => status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(gateway.acceptedEndpoints.filter((value) => value === endpointTwo)).toHaveLength(1);
    expect(gateway.acceptedEndpoints.filter((value) => value === endpointThree)).toHaveLength(1);
  });

  it('retries transient failures, expires gone endpoints, and revokes only the logout installation', async () => {
    expect((await createSubscription(first, installationFour, endpointFour)).status).toBe(201);
    const transientNotification = await createNotification(first.userId, 'SECURITY');
    const transientSubscription = await prisma.pushSubscription.findFirstOrThrow({
      where: { endpoint: endpointFour },
    });
    await prisma.pushDelivery.create({
      data: {
        supplierId,
        notificationId: transientNotification.id,
        subscriptionId: transientSubscription.id,
        payload: { title: 'Security', deepLink: '/notifications' },
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    gateway.nextError = Object.assign(new Error('service unavailable'), { statusCode: 503 });
    await worker.processBatch();
    const pending = await prisma.pushDelivery.findFirstOrThrow({
      where: { notificationId: transientNotification.id, subscription: { endpoint: endpointFour } },
    });
    expect(pending.status).toBe('PENDING');
    expect(pending.attemptCount).toBe(1);
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const goneNotification = await createNotification(second.userId, 'SECURITY');
    await prisma.$transaction((transaction) =>
      deliveries.materialize(goneNotification, transaction),
    );
    gateway.nextError = Object.assign(new Error('endpoint gone'), { statusCode: 410 });
    await worker.processBatch();
    const gone = await prisma.pushSubscription.findFirstOrThrow({
      where: { endpoint: endpointOne },
    });
    expect(gone.status).toBe('EXPIRED');

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/logout')
      .set('Origin', supplierOrigin)
      .set('Cookie', first.cookie)
      .set('X-CSRF-Token', first.csrf)
      .set('X-Device-Installation-ID', installationOne);
    expect(logout.status).toBe(204);
    const statuses = await prisma.pushSubscription.findMany({
      where: { userId: first.userId, endpoint: { in: [endpointTwo, endpointThree, endpointFour] } },
      select: { endpoint: true, status: true },
    });
    expect(statuses.find(({ endpoint }) => endpoint === endpointTwo)?.status).toBe('REVOKED');
    expect(statuses.find(({ endpoint }) => endpoint === endpointThree)?.status).toBe('ACTIVE');
    expect(statuses.find(({ endpoint }) => endpoint === endpointFour)?.status).toBe('ACTIVE');
  });

  async function login(username: string, userId: string): Promise<Login> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/login')
      .set('Origin', supplierOrigin)
      .send({ supplierCode, username, password });
    expect(response.status).toBe(200);
    const rawCookie = response.headers['set-cookie'];
    return {
      cookie: Array.isArray(rawCookie) ? rawCookie : rawCookie ? [rawCookie] : [],
      csrf: response.body.csrfToken as string,
      userId,
    };
  }

  function supplierGet(loginContext: Login, path: string, installationId?: string) {
    const call = request(app.getHttpServer()).get(path).set('Cookie', loginContext.cookie);
    return installationId ? call.set('X-Device-Installation-ID', installationId) : call;
  }

  function createSubscription(loginContext: Login, installationId: string, endpoint: string) {
    return request(app.getHttpServer())
      .post('/api/v1/supplier/push-subscriptions')
      .set('Origin', supplierOrigin)
      .set('Cookie', loginContext.cookie)
      .set('X-CSRF-Token', loginContext.csrf)
      .set('X-Device-Installation-ID', installationId)
      .send({
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(24) },
      });
  }

  async function createNotification(userId: string, kind: string) {
    return prisma.notification.create({
      data: {
        supplierId,
        recipientUserId: userId,
        sourceEventId: randomUUID(),
        kind,
        title: 'Action required',
        body: 'A supplier action requires attention.',
        resourceType: 'AssignmentIssue',
        resourceId: randomUUID(),
        deepLink: '/notifications',
      },
    });
  }
});
