import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PasswordService } from '../auth/password.service.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';

const supplierOrigin = 'http://localhost:5173';
const tmminOrigin = 'http://localhost:5174';

describe('Phase 3 administration flows', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUsername: string;
  let initialPassword: string;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'integration-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'integration-test-throttle-secret-32';
    process.env['OUTBOX_ENABLED'] = 'false';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    adminUsername = `bootstrap-${randomUUID()}`;
    initialPassword = 'Temporary-Bootstrap-Password-123';
    const passwordHash = await passwords.hash(initialPassword);
    const admin = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username: adminUsername,
        normalizedUsername: adminUsername,
        displayName: 'Bootstrap Integration Admin',
        passwordHash,
        protectedBootstrapAdmin: true,
      },
    });
    await prisma.passwordHistory.create({ data: { userId: admin.id, passwordHash } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('forces initial password change then provisions Hosted and pure External suppliers', async () => {
    const firstLogin = await tmminLogin(adminUsername, initialPassword);
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.principal.mustChangePassword).toBe(true);
    const firstCookie = firstLogin.headers['set-cookie'] ?? '';

    const changedPassword = 'Changed-Bootstrap-Password-456';
    const passwordChange = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/change-password')
      .set('Origin', tmminOrigin)
      .set('Cookie', firstCookie)
      .set('X-CSRF-Token', firstLogin.body.csrfToken)
      .send({ currentPassword: initialPassword, newPassword: changedPassword });
    expect(passwordChange.status).toBe(204);

    const login = await tmminLogin(adminUsername, changedPassword);
    const cookie = login.headers['set-cookie'] ?? '';
    const csrf = login.body.csrfToken as string;
    expect(login.body.principal.mustChangePassword).toBe(false);

    const quality = await request(app.getHttpServer())
      .post('/api/v1/tmmin/quality-users')
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({
        username: `quality-${randomUUID()}`,
        displayName: 'Quality Integration User',
      });
    expect(quality.status).toBe(201);
    expect(quality.headers['cache-control']).toBe('no-store');
    expect(quality.body.credential.temporaryPassword).toBeTypeOf('string');

    const hostedCode = `HOSTED-${randomUUID()}`;
    const hosted = await request(app.getHttpServer())
      .post('/api/v1/tmmin/suppliers')
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({
        sourceMode: 'HOSTED',
        code: hostedCode,
        name: 'Hosted Integration Supplier',
        timezone: 'Asia/Jakarta',
        supplierAdmin: {
          username: `admin-${randomUUID()}`,
          displayName: 'Hosted Supplier Admin',
        },
      });
    expect(hosted.status).toBe(201);
    expect(hosted.body.supplier.active).toBe(true);
    expect(hosted.body.credential.temporaryPassword).toBeTypeOf('string');

    const replacements = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/tmmin/suppliers/${hosted.body.supplier.id}/supplier-admin/replace`)
        .set('Origin', tmminOrigin)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .send({
          expectedVersion: 1,
          username: `replacement-a-${randomUUID()}`,
          displayName: 'Replacement Admin A',
        }),
      request(app.getHttpServer())
        .post(`/api/v1/tmmin/suppliers/${hosted.body.supplier.id}/supplier-admin/replace`)
        .set('Origin', tmminOrigin)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .send({
          expectedVersion: 1,
          username: `replacement-b-${randomUUID()}`,
          displayName: 'Replacement Admin B',
        }),
    ]);
    expect(replacements.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(
      prisma.user.count({
        where: {
          supplierId: hosted.body.supplier.id,
          role: 'SUPPLIER_ADMIN',
          status: 'ACTIVE',
        },
      }),
    ).resolves.toBe(1);

    const externalCode = `EXTERNAL-${randomUUID()}`;
    const external = await request(app.getHttpServer())
      .post('/api/v1/tmmin/suppliers')
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({
        sourceMode: 'EXTERNAL',
        code: externalCode,
        name: 'External Integration Supplier',
        timezone: 'Asia/Jakarta',
      });
    expect(external.status).toBe(201);
    expect(external.body.supplier.active).toBe(false);
    expect(external.body).not.toHaveProperty('supplierAdmin');
    expect(external.body).not.toHaveProperty('credential');

    const preparationUsername = `preparation-${randomUUID()}`;
    const preparation = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${external.body.supplier.id}/source/preparation`)
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({
        expectedVersion: 1,
        reason: 'Controlled integration preparation for Hosted cutover',
        privacyAcknowledged: true,
        supplierAdmin: {
          username: preparationUsername,
          displayName: 'Preparation Supplier Admin',
        },
      });
    expect(preparation.status).toBe(201);
    expect(preparation.body.preparation.status).toBe('ACTIVE');

    const preparationLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/login')
      .set('Origin', supplierOrigin)
      .set('Content-Type', 'application/json')
      .send({
        supplierCode: externalCode,
        username: preparationUsername,
        password: preparation.body.credential.temporaryPassword,
      });
    expect(preparationLogin.status).toBe(200);
    expect(preparationLogin.body.principal.purpose).toBe('HOSTED_PREPARATION');

    const preflight = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${external.body.supplier.id}/source/preflight`)
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ targetMode: 'HOSTED' });
    expect(preflight.status).toBe(200);
    expect(preflight.body.eligible).toBe(false);
    expect(preflight.body.blockers.length).toBeGreaterThan(0);

    const cancelledPreparation = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${external.body.supplier.id}/source/preparation/cancel`)
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({
        expectedVersion: 2,
        reason: 'Cancel integration preparation after validation completed',
      });
    expect(cancelledPreparation.status).toBe(200);
    expect(cancelledPreparation.body.active).toBe(false);

    const externalOverPost = await request(app.getHttpServer())
      .post('/api/v1/tmmin/suppliers')
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({
        sourceMode: 'EXTERNAL',
        code: `INVALID-${randomUUID()}`,
        name: 'Invalid External',
        timezone: 'Asia/Jakarta',
        supplierAdmin: {
          username: 'must-not-be-accepted',
          displayName: 'Forbidden PII',
        },
      });
    expect(externalOverPost.status).toBe(400);
    expect(externalOverPost.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects cross-realm cookies and unauthorised mutations', async () => {
    const password = 'Cross-Realm-Test-Password-123';
    const passwords = app.get(PasswordService);
    const passwordHash = await passwords.hash(password);
    const username = `quality-readonly-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        username,
        normalizedUsername: username,
        displayName: 'Read Only Quality',
        passwordHash,
        mustChangePassword: false,
      },
    });
    const login = await tmminLogin(username, password);
    const cookie = login.headers['set-cookie'] ?? '';

    const crossRealm = await request(app.getHttpServer())
      .get('/api/v1/auth/supplier/session')
      .set('Cookie', cookie);
    expect(crossRealm.status).toBe(401);

    const forbidden = await request(app.getHttpServer())
      .post('/api/v1/tmmin/quality-users')
      .set('Origin', tmminOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ username: `forbidden-${randomUUID()}`, displayName: 'Forbidden' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
  });

  it('claims outbox work once across concurrent workers and surfaces poison events', async () => {
    const outbox = app.get(OutboxService);
    const onceType = `OUTBOX_ONCE_${randomUUID()}`;
    let handled = 0;
    outbox.register(onceType, () => {
      handled += 1;
      return Promise.resolve();
    });
    const onceId = await outbox.enqueue({
      eventType: onceType,
      aggregateType: 'IntegrationTest',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      actor: { kind: 'SYSTEM' },
      correlationId: randomUUID(),
      payload: {},
    });
    await Promise.all([outbox.processBatch(), outbox.processBatch()]);
    expect(handled).toBe(1);
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: onceId } }),
    ).resolves.toMatchObject({ processedAt: expect.any(Date), attemptCount: 1 });

    const poisonType = `OUTBOX_POISON_${randomUUID()}`;
    outbox.register(poisonType, () => Promise.reject(new Error('safe poison test')));
    const poisonId = await outbox.enqueue({
      eventType: poisonType,
      aggregateType: 'IntegrationTest',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      actor: { kind: 'SYSTEM' },
      correlationId: randomUUID(),
      payload: {},
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await prisma.outboxEvent.update({
        where: { id: poisonId },
        data: { availableAt: new Date(0) },
      });
      await outbox.processBatch();
    }
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: poisonId } }),
    ).resolves.toMatchObject({
      failedAt: expect.any(Date),
      attemptCount: 10,
      lastSafeError: 'Error',
    });
  });

  async function tmminLogin(username: string, password: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .set('Content-Type', 'application/json')
      .send({ username, password });
  }
});
