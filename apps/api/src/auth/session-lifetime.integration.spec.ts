import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { CLOCK } from '../common/scope.js';
import { correlationMiddleware } from '../common/request-context.js';
import type { UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const day = 86_400_000;
const initialPassword = 'Session-Lifetime-Integration-123';
const supplierOrigin = 'http://localhost:5173';
const tmminOrigin = 'http://localhost:5174';

describe('persistent browser sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let passwordHash: string;
  let now: Date;

  beforeAll(async () => {
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['PCR_WORKER_ENABLED'] = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    passwordHash = await app.get(PasswordService).hash(initialPassword);
  });
  beforeEach(() => {
    now = new Date();
  });
  afterAll(async () => {
    await app.close();
  });

  async function identity(role: UserRole = 'SUPPLIER_ADMIN', forced = false, external = false) {
    const tmmin = role.startsWith('TMMIN_');
    const code = `SESSION-${randomUUID()}`;
    const supplier = tmmin
      ? null
      : await prisma.supplier.create({
          data: {
            code,
            normalizedCode: code.toLowerCase(),
            name: 'Session lifetime supplier',
            timezone: 'Asia/Jakarta',
            sourceMode: external ? 'EXTERNAL' : 'HOSTED',
          },
        });
    const member =
      supplier && (role === 'SUPERVISOR' || role === 'LINE_LEADER' || role === 'QC')
        ? await prisma.member.create({
            data: {
              supplierId: supplier.id,
              fullName: 'Session test member',
              role,
              registrationNumber: randomUUID(),
              normalizedRegistrationNumber: randomUUID(),
            },
          })
        : null;
    const username = randomUUID();
    const user = await prisma.user.create({
      data: {
        realm: tmmin ? 'TMMIN' : 'SUPPLIER',
        supplierId: supplier?.id ?? null,
        memberId: member?.id ?? null,
        role,
        username,
        normalizedUsername: username,
        displayName: 'Session test',
        passwordHash,
        mustChangePassword: forced,
      },
    });
    const realm = tmmin ? 'tmmin' : 'supplier';
    const origin = tmmin ? tmminOrigin : supplierOrigin;
    const credentials = {
      username,
      password: initialPassword,
      ...(supplier ? { supplierCode: supplier.code } : {}),
    };
    const login = await request(app.getHttpServer())
      .post(`/api/v1/auth/${realm}/login`)
      .set('Origin', origin)
      .send(credentials);
    expect(login.status).toBe(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!;
    const row = await prisma.userSession.findFirstOrThrow({ where: { userId: user.id } });
    return { user, supplier, realm, origin, credentials, login, cookie, row };
  }

  function inspect(realm: string, cookie: string) {
    return request(app.getHttpServer()).get(`/api/v1/auth/${realm}/session`).set('Cookie', cookie);
  }

  it.each<UserRole>([
    'TMMIN_ADMIN',
    'TMMIN_QUALITY',
    'SUPPLIER_ADMIN',
    'SUPERVISOR',
    'LINE_LEADER',
    'QC',
  ])('issues 30 days through real login for %s', async (role) => {
    const f = await identity(role);
    expect(f.row.absoluteExpiresAt.getTime() - now.getTime()).toBe(30 * day);
    expect(f.row.idleExpiresAt).toEqual(f.row.absoluteExpiresAt);
    expect(f.login.body.absoluteExpiresAt).toBe(f.row.absoluteExpiresAt.toISOString());
    expect(f.cookie).toContain(`Expires=${f.row.absoluteExpiresAt.toUTCString()}`);
    expect(f.cookie).toContain('HttpOnly');
    expect(f.cookie).toContain('SameSite=Strict');
    expect(f.cookie).not.toContain('Domain=');
    now = new Date(now.getTime() + 7 * day);
    expect((await inspect(f.realm, f.cookie)).status).toBe(200);
    const after = await prisma.userSession.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(after.absoluteExpiresAt).toEqual(f.row.absoluteExpiresAt);
    expect(after.idleExpiresAt).toEqual(f.row.idleExpiresAt);
    expect((await inspect(f.realm === 'tmmin' ? 'supplier' : 'tmmin', f.cookie)).status).toBe(401);
  });

  it('retains the fixed cutoff after multi-day recovery and accepts only valid CSRF mutations', async () => {
    const f = await identity();
    now = new Date(now.getTime() + 13 * day);
    const restored = await inspect(f.realm, f.cookie);
    expect(restored.status).toBe(200);
    for (const csrf of [undefined, 'wrong-token', restored.body.csrfToken as string]) {
      const operation = request(app.getHttpServer())
        .post('/api/v1/supplier/master-data/lines')
        .set('Origin', supplierOrigin)
        .set('Cookie', f.cookie);
      if (csrf) operation.set('X-CSRF-Token', csrf);
      const result = await operation.send({ code: `LINE-${randomUUID()}`, name: 'Restored line' });
      expect(result.status).toBe(csrf === restored.body.csrfToken ? 201 : 403);
    }
    const wrongOrigin = await request(app.getHttpServer())
      .post('/api/v1/supplier/master-data/lines')
      .set('Origin', tmminOrigin)
      .set('Cookie', f.cookie)
      .set('X-CSRF-Token', restored.body.csrfToken)
      .send({ code: 'WRONG', name: 'Wrong origin' });
    expect(wrongOrigin.status).toBe(403);
    now = new Date(f.row.absoluteExpiresAt.getTime() - 1);
    expect((await inspect(f.realm, f.cookie)).status).toBe(200);
    now = f.row.absoluteExpiresAt;
    expect((await inspect(f.realm, f.cookie)).status).toBe(401);
  });

  it('keeps preparation capabilities restricted with the same long lifetime', async () => {
    const f = await identity('SUPPLIER_ADMIN', false, true);
    expect(f.login.body.principal.purpose).toBe('HOSTED_PREPARATION');
    expect(f.login.body.capabilities).toEqual(
      expect.arrayContaining(['SUPPLIER_MASTER_DATA_READ', 'SUPPLIER_MASTER_DATA_MANAGE']),
    );
    expect(f.login.body.capabilities).not.toContain('SUPPLIER_HENKATEN_SUBMIT');
    expect(f.row.idleExpiresAt.getTime() - now.getTime()).toBe(30 * day);
  });

  it('keeps forced-change sessions short and grants 30 days after change and relogin', async () => {
    const f = await identity('TMMIN_QUALITY', true);
    expect(f.row.idleExpiresAt.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(f.row.absoluteExpiresAt.getTime() - now.getTime()).toBe(12 * 60 * 60_000);
    const changed = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/change-password')
      .set('Cookie', f.cookie)
      .set('Origin', tmminOrigin)
      .set('X-CSRF-Token', f.login.body.csrfToken)
      .send({ currentPassword: initialPassword, newPassword: 'Session-Changed-Password-456' });
    expect(changed.status).toBe(204);
    expect((await inspect(f.realm, f.cookie)).status).toBe(401);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ ...f.credentials, password: 'Session-Changed-Password-456' });
    expect(login.status).toBe(200);
    expect(Date.parse(login.body.absoluteExpiresAt) - now.getTime()).toBe(30 * day);
    expect(login.body.idleExpiresAt).toBe(login.body.absoluteExpiresAt);
  });

  it.each(['password', 'authorization', 'user', 'supplier', 'source', 'logout', 'reset'])(
    'invalidates a long session after %s changes',
    async (kind) => {
      const f = await identity();
      now = new Date(now.getTime() + 7 * day);
      if (kind === 'password' || kind === 'authorization') {
        await prisma.user.update({
          where: { id: f.user.id },
          data: {
            [kind === 'password' ? 'passwordEpoch' : 'authorizationEpoch']: { increment: 1 },
          },
        });
      }
      if (kind === 'user')
        await prisma.user.update({ where: { id: f.user.id }, data: { status: 'INACTIVE' } });
      if (kind === 'supplier' || kind === 'source')
        await prisma.supplier.update({
          where: { id: f.supplier!.id },
          data: kind === 'source' ? { sourceEpoch: { increment: 1 } } : { active: false },
        });
      if (kind === 'logout') {
        const logout = await request(app.getHttpServer())
          .post('/api/v1/auth/supplier/logout')
          .set('Origin', supplierOrigin)
          .set('Cookie', f.cookie)
          .set('X-CSRF-Token', f.login.body.csrfToken)
          .send({});
        expect(logout.status).toBe(204);
      }
      if (kind === 'reset') await sessions.revokeUserSessions(f.user.id, 'PASSWORD_RESET');
      expect((await inspect(f.realm, f.cookie)).status).toBe(401);
    },
  );

  it('preserves legacy absolute bounds and never revives an idle-expired session', async () => {
    const f = await identity();
    const absolute = new Date(now.getTime() + 12 * 60 * 60_000);
    await prisma.userSession.update({
      where: { id: f.row.id },
      data: { idleExpiresAt: new Date(now.getTime() + 30 * 60_000), absoluteExpiresAt: absolute },
    });
    now = new Date(now.getTime() + 60_000);
    expect((await inspect(f.realm, f.cookie)).status).toBe(200);
    const active = await prisma.userSession.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(active.absoluteExpiresAt).toEqual(absolute);
    expect(active.idleExpiresAt).toEqual(absolute);
    await prisma.userSession.update({ where: { id: f.row.id }, data: { idleExpiresAt: now } });
    expect((await inspect(f.realm, f.cookie)).status).toBe(401);
  });

  it('keeps passive resolution read-only over days, including earlier stored deadlines', async () => {
    const f = await identity();
    now = new Date(now.getTime() + 7 * day);
    const raw = f.cookie.split(';')[0]!.split('=')[1]!;
    expect(await sessions.resolve(raw, 'SUPPLIER', false)).not.toBeNull();
    expect(await prisma.userSession.findUniqueOrThrow({ where: { id: f.row.id } })).toEqual(f.row);
    await prisma.userSession.update({ where: { id: f.row.id }, data: { idleExpiresAt: now } });
    expect(await sessions.resolve(raw, 'SUPPLIER', false)).toBeNull();
  });

  it('keeps delegated activity short without touching its 30-day parent and rejects expired parents', async () => {
    const actor = await identity('TMMIN_ADMIN');
    const target = await identity();
    const issue = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${target.supplier!.id}/supplier-admin/magic-link`)
      .set('Origin', tmminOrigin)
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.login.body.csrfToken)
      .send({});
    expect(issue.status).toBe(200);
    const redeemed = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/magic-link/redeem')
      .set('Origin', supplierOrigin)
      .send({ token: new URL(issue.body.url).hash.slice('#token='.length) });
    expect(redeemed.status).toBe(200);
    const cookie = (redeemed.headers['set-cookie'] as unknown as string[])[0]!;
    const delegated = await prisma.userSession.findFirstOrThrow({
      where: { impersonatedBySessionId: actor.row.id },
    });
    expect(delegated.idleExpiresAt.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(delegated.absoluteExpiresAt.getTime() - now.getTime()).toBe(12 * 60 * 60_000);
    now = new Date(now.getTime() + 60_000);
    expect((await inspect('supplier', cookie)).status).toBe(200);
    expect(await prisma.userSession.findUniqueOrThrow({ where: { id: actor.row.id } })).toEqual(
      actor.row,
    );
    now = new Date(now.getTime() + 30 * 60_000);
    expect((await inspect('supplier', cookie)).status).toBe(401);
    // Isolate the parent boundary while the child's stored deadlines are still valid.
    await prisma.userSession.update({
      where: { id: delegated.id },
      data: { idleExpiresAt: delegated.absoluteExpiresAt },
    });
    await prisma.userSession.update({
      where: { id: actor.row.id },
      data: { absoluteExpiresAt: now },
    });
    expect((await inspect('supplier', cookie)).status).toBe(401);
  });
});
