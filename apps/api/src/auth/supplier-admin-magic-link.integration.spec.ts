import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PasswordService } from './password.service.js';
import { PrismaService } from '../persistence/prisma.service.js';

const tmminOrigin = 'http://localhost:5174';
const supplierOrigin = 'http://localhost:5173';

describe('Supplier Admin magic link', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let adminId: string;
  let tmminCookie: string;
  let delegatedCookie: string;
  let csrf: string;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] ??=
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
    const passwordHash = await app.get(PasswordService).hash('Magic-Link-Test-Password-123');
    const username = `magic-actor-${randomUUID()}`;
    const actor = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username,
        normalizedUsername: username,
        displayName: 'TMMIN Magic Test',
        passwordHash,
        mustChangePassword: false,
      },
    });
    const code = `MAGIC-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code,
        normalizedCode: code.toLowerCase(),
        name: 'Magic Test Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
        active: true,
      },
    });
    supplierId = supplier.id;
    const admin = await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        role: 'SUPPLIER_ADMIN',
        supplierId,
        username: `magic-admin-${randomUUID()}`,
        normalizedUsername: `magic-admin-${randomUUID()}`,
        displayName: 'Supplier Magic Test',
        passwordHash,
        mustChangePassword: true,
      },
    });
    adminId = admin.id;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ username, password: 'Magic-Link-Test-Password-123' });
    expect(login.status).toBe(200);
    expect(actor.id).toBe(login.body.principal.userId);
    tmminCookie = login.headers['set-cookie'] ?? '';
    csrf = login.body.csrfToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('opens a Supplier session once, without a supplier notification', async () => {
    const before = await prisma.notification.count({ where: { supplierId } });
    const issue = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${supplierId}/supplier-admin/magic-link`)
      .set('Origin', tmminOrigin)
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(issue.status).toBe(200);
    expect(issue.headers['cache-control']).toBe('no-store');
    expect(issue.body.url).toContain(`${supplierOrigin}/magic-login#token=`);
    const token = new URL(issue.body.url).hash.slice('#token='.length);
    const attempts = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/api/v1/auth/supplier/magic-link/redeem')
          .set('Origin', supplierOrigin)
          .send({ token }),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 401]);
    const success = attempts.find((attempt) => attempt.status === 200)!;
    delegatedCookie = success.headers['set-cookie'] ?? '';
    expect(success.body.principal.userId).toBe(adminId);
    expect(success.body.principal.impersonatedBy.displayName).toBe('TMMIN Magic Test');
    expect(success.body.principal.mustChangePassword).toBe(false);
    const supplierSession = await request(app.getHttpServer())
      .get('/api/v1/auth/supplier/session')
      .set('Cookie', success.headers['set-cookie'] ?? '');
    expect(supplierSession.status).toBe(200);
    expect(supplierSession.body.principal.impersonatedBy).toBeDefined();
    const changePassword = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/change-password')
      .set('Origin', supplierOrigin)
      .set('Cookie', success.headers['set-cookie'] ?? '')
      .set('X-CSRF-Token', success.body.csrfToken)
      .send({
        currentPassword: 'Magic-Link-Test-Password-123',
        newPassword: 'Another-Magic-Password-123',
      });
    expect(changePassword.status).toBe(403);
    expect(await prisma.notification.count({ where: { supplierId } })).toBe(before);
  });

  it('rejects untrusted origins and revoked issuer sessions', async () => {
    const issue = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${supplierId}/supplier-admin/magic-link`)
      .set('Origin', tmminOrigin)
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', csrf)
      .send({});
    const token = new URL(issue.body.url).hash.slice('#token='.length);
    const wrongOrigin = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/magic-link/redeem')
      .set('Origin', tmminOrigin)
      .send({ token });
    expect(wrongOrigin.status).toBe(401);
    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/logout')
      .set('Origin', tmminOrigin)
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(logout.status).toBe(204);
    const revoked = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/magic-link/redeem')
      .set('Origin', supplierOrigin)
      .send({ token });
    expect(revoked.status).toBe(401);
    const endedSession = await request(app.getHttpServer())
      .get('/api/v1/auth/supplier/session')
      .set('Cookie', delegatedCookie);
    expect(endedSession.status).toBe(401);
  });

  it('rejects expired links, inactive suppliers, and non-admin issuance', async () => {
    const actorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({
        username: (
          await prisma.user.findFirstOrThrow({
            where: { role: 'TMMIN_ADMIN', displayName: 'TMMIN Magic Test' },
          })
        ).username,
        password: 'Magic-Link-Test-Password-123',
      });
    const actorCookie = actorLogin.headers['set-cookie'] ?? '';
    const issue = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${supplierId}/supplier-admin/magic-link`)
      .set('Origin', tmminOrigin)
      .set('Cookie', actorCookie)
      .set('X-CSRF-Token', actorLogin.body.csrfToken)
      .send({});
    expect(issue.status).toBe(200);
    const token = new URL(issue.body.url).hash.slice('#token='.length);
    await prisma.supplierAdminMagicLink.updateMany({
      where: { supplierId, consumedAt: null },
      data: { expiresAt: new Date(0) },
    });
    const expired = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/magic-link/redeem')
      .set('Origin', supplierOrigin)
      .send({ token });
    expect(expired.status).toBe(401);
    await prisma.supplier.update({ where: { id: supplierId }, data: { active: false } });
    const inactive = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${supplierId}/supplier-admin/magic-link`)
      .set('Origin', tmminOrigin)
      .set('Cookie', actorCookie)
      .set('X-CSRF-Token', actorLogin.body.csrfToken)
      .send({});
    expect(inactive.status).toBe(409);
    const qualityUsername = `magic-quality-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        username: qualityUsername,
        normalizedUsername: qualityUsername,
        displayName: 'Quality Magic Test',
        passwordHash: await app.get(PasswordService).hash('Magic-Link-Test-Password-123'),
        mustChangePassword: false,
      },
    });
    const qualityLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ username: qualityUsername, password: 'Magic-Link-Test-Password-123' });
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${supplierId}/supplier-admin/magic-link`)
      .set('Origin', tmminOrigin)
      .set('Cookie', qualityLogin.headers['set-cookie'] ?? '')
      .set('X-CSRF-Token', qualityLogin.body.csrfToken)
      .send({});
    expect(forbidden.status).toBe(403);
  });
});
