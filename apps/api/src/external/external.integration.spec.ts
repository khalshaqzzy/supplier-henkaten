import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { NotificationService } from '../read-models/notification.service.js';

const tmminOrigin = 'http://localhost:5174';
const password = 'External-Integration-Password-123';

describe('External API credential and ingestion boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tmminCookie: string[];
  let tmminCsrf: string;
  let supplierId: string;
  let clientRecordId: string;
  let clientVersion: number;
  let clientId: string;
  let clientSecret: string;
  let accessToken: string;
  let projectionId: string;

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
    const username = `external-admin-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username,
        normalizedUsername: username.toLowerCase(),
        displayName: 'External Integration Admin',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ username, password });
    expect(login.status).toBe(200);
    tmminCookie = cookieHeader(login.headers['set-cookie']);
    tmminCsrf = login.body.csrfToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues one-time credentials and activates a pure External supplier', async () => {
    const createdSupplier = await tmminPost('/api/v1/tmmin/suppliers', {
      sourceMode: 'EXTERNAL',
      code: `EXT-${randomUUID()}`,
      name: 'External Integration Supplier',
      timezone: 'Asia/Jakarta',
    });
    expect(createdSupplier.status).toBe(201);
    expect(createdSupplier.body.supplier.active).toBe(false);
    supplierId = createdSupplier.body.supplier.id as string;

    const credential = await tmminPost(`/api/v1/tmmin/suppliers/${supplierId}/external-clients`, {
      name: 'Supplier production integration',
      ipAllowlist: [],
    });
    expect(credential.status).toBe(201);
    expect(credential.headers['cache-control']).toBe('no-store');
    clientRecordId = credential.body.client.id as string;
    clientVersion = credential.body.client.version as number;
    clientId = credential.body.client.clientId as string;
    clientSecret = credential.body.clientSecret as string;
    expect(clientSecret).toMatch(/^ecs_/);
    const stored = await prisma.externalApiSecret.findFirstOrThrow({
      where: { clientId: clientRecordId },
    });
    expect(stored.secretHash).not.toContain(clientSecret);

    const activated = await tmminPost(`/api/v1/tmmin/suppliers/${supplierId}/activate`, {
      expectedVersion: createdSupplier.body.supplier.version,
    });
    expect(activated.status).toBe(200);
    expect(activated.body.active).toBe(true);
  });

  it('issues a scoped opaque token and denies invalid credentials generically', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/external/auth/token')
      .send({ client_id: clientId, client_secret: `${clientSecret}-invalid` });
    expect(invalid.status).toBe(401);
    expect(invalid.body.code).toBe('AUTHENTICATION_FAILED');

    const token = await request(app.getHttpServer())
      .post('/api/v1/external/auth/token')
      .send({ client_id: clientId, client_secret: clientSecret });
    expect(token.status).toBe(200);
    expect(token.headers['cache-control']).toBe('no-store');
    expect(token.body.expires_in).toBe(900);
    expect(token.body.scope).toBe('henkaten:ingest');
    accessToken = token.body.access_token as string;
    expect(accessToken).toMatch(/^eat_/);
  });

  it('ingests sequential immutable events with exact retry and warning projection', async () => {
    const opened = event({
      eventId: 'external-event-1',
      sourceHenkatenId: 'supplier-henkaten-1',
      sourceVersion: 1,
      eventType: 'HENKATEN_OPENED',
      status: 'OPEN',
    });
    const accepted = await ingest(opened);
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('ACCEPTED');
    const duplicate = await ingest(opened);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.status).toBe('DUPLICATE');

    const conflicting = await ingest({
      ...opened,
      change: { ...opened.change, cause: 'Changed canonical payload' },
    });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const gap = await ingest(
      event({
        eventId: 'external-event-3',
        sourceHenkatenId: 'supplier-henkaten-1',
        sourceVersion: 3,
        eventType: 'HENKATEN_OPEN_UPDATED',
        status: 'OPEN',
      }),
    );
    expect(gap.status).toBe(422);
    expect(gap.body.code).toBe('SOURCE_VERSION_OUT_OF_ORDER');

    const approved = await ingest(
      event({
        eventId: 'external-event-2',
        sourceHenkatenId: 'supplier-henkaten-1',
        sourceVersion: 2,
        eventType: 'HENKATEN_APPROVED',
        status: 'APPROVED',
        decisions: [decision('SUPERVISOR', 'APPROVED'), decision('QC', 'APPROVED')],
      }),
    );
    expect(approved.status).toBe(202);
    const projection = await prisma.externalHenkatenProjection.findFirstOrThrow({
      where: { supplierId, sourceHenkatenId: 'supplier-henkaten-1' },
    });
    projectionId = projection.id;
    expect(projection.status).toBe('APPROVED');
    await expect(
      prisma.warningInstance.findUniqueOrThrow({
        where: { externalProjectionId: projection.id },
        select: { status: true, sourceMode: true },
      }),
    ).resolves.toEqual({ status: 'CLOSED', sourceMode: 'EXTERNAL' });
    const raw = await prisma.externalIngestionEvent.findFirstOrThrow({
      where: { eventId: 'external-event-1' },
    });
    await expect(
      prisma.externalIngestionEvent.update({
        where: { id: raw.id },
        data: { eventType: 'TAMPERED' },
      }),
    ).rejects.toThrow();
  });

  it('processes batch items independently and exposes TMMIN traceability', async () => {
    const valid = event({
      eventId: 'external-batch-1',
      sourceHenkatenId: 'supplier-henkaten-2',
      sourceVersion: 1,
      eventType: 'HENKATEN_OPENED',
      status: 'OPEN',
    });
    const batch = await request(app.getHttpServer())
      .post('/api/v1/external/henkaten/events/batch')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ events: [{ ...valid, email: 'forbidden@example.com' }, valid] });
    expect(batch.status).toBe(200);
    const batchBody = batch.body as { results: Array<{ status: string }> };
    expect(batchBody.results.map((item) => item.status)).toEqual(['REJECTED', 'ACCEPTED']);

    const projections = await request(app.getHttpServer())
      .get(`/api/v1/tmmin/suppliers/${supplierId}/external-projections`)
      .set('Cookie', tmminCookie);
    expect(projections.status).toBe(200);
    expect(projections.body.items.length).toBeGreaterThanOrEqual(2);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/tmmin/suppliers/${supplierId}/external-projections/${projectionId}`)
      .set('Cookie', tmminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.events).toHaveLength(2);

    const dashboard = await request(app.getHttpServer())
      .get('/api/v1/tmmin/dashboard')
      .set('Cookie', tmminCookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.suppliers.external).toBeGreaterThan(0);
    expect(dashboard.body.externalIngestion.accepted).toBeGreaterThanOrEqual(3);
    expect(dashboard.body.externalIngestion.recentRejected).toBeGreaterThan(0);

    const notificationEvent = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'EXTERNAL_PROJECTION_UPDATED', aggregateId: projectionId },
      orderBy: { createdAt: 'desc' },
    });
    await app.get(NotificationService).consume(notificationEvent);
    const notifications = await request(app.getHttpServer())
      .get('/api/v1/tmmin/notifications?unreadOnly=true')
      .set('Cookie', tmminCookie);
    expect(notifications.status).toBe(200);
    const notificationBody = notifications.body as { items: Array<{ kind: string }> };
    expect(
      notificationBody.items.some((notification) => notification.kind === 'EXTERNAL_WARNING'),
    ).toBe(true);
  });

  it('serializes concurrent identical delivery into one event and one projection version', async () => {
    const concurrent = event({
      eventId: 'external-concurrent-1',
      sourceHenkatenId: 'supplier-henkaten-concurrent',
      sourceVersion: 1,
      eventType: 'HENKATEN_OPENED',
      status: 'OPEN',
    });
    const responses = await Promise.all([ingest(concurrent), ingest(concurrent)]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 202]);
    const statuses = responses.map(({ body }) => (body as { status: string }).status).sort();
    expect(statuses).toEqual(['ACCEPTED', 'DUPLICATE']);
    expect(
      await prisma.externalIngestionEvent.count({
        where: { supplierId, eventId: concurrent.eventId },
      }),
    ).toBe(1);
    await expect(
      prisma.externalHenkatenProjection.findFirstOrThrow({
        where: { supplierId, sourceHenkatenId: concurrent.sourceHenkatenId },
        select: { sourceVersion: true },
      }),
    ).resolves.toEqual({ sourceVersion: 1 });
  });

  it('revokes secrets and all outstanding tokens immediately', async () => {
    const revoked = await tmminPost(
      `/api/v1/tmmin/suppliers/${supplierId}/external-clients/${clientRecordId}/revoke`,
      { expectedVersion: clientVersion },
    );
    expect(revoked.status).toBe(200);
    const denied = await request(app.getHttpServer())
      .get('/api/v1/external/ingestions/external-event-1')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(denied.status).toBe(401);
  });

  function tmminPost(path: string, body: object) {
    return request(app.getHttpServer())
      .post(path)
      .set('Origin', tmminOrigin)
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', tmminCsrf)
      .send(body);
  }

  function ingest(body: object) {
    return request(app.getHttpServer())
      .post('/api/v1/external/henkaten/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }
});

function event(input: {
  eventId: string;
  sourceHenkatenId: string;
  sourceVersion: number;
  eventType:
    | 'HENKATEN_OPENED'
    | 'HENKATEN_OPEN_UPDATED'
    | 'HENKATEN_APPROVED'
    | 'HENKATEN_REJECTED'
    | 'HENKATEN_CANCELLED';
  status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decisions?: Array<ReturnType<typeof decision>>;
}) {
  return {
    schemaVersion: '1.0',
    ...input,
    occurredAt: '2026-07-23T02:00:00.000Z',
    line: { externalId: 'LINE-01', name: 'Main Assembly' },
    shift: {
      externalId: 'SHIFT-1',
      name: 'Shift 1',
      businessDate: '2026-07-23',
      timezone: 'Asia/Jakarta',
    },
    job: { externalId: 'JOB-01', name: 'Torque Check' },
    part: { number: '61023-0K100-A1', name: 'Example Part' },
    changePoint: 'MACHINE',
    change: {
      affectedObject: 'Impact wrench A',
      replacementObject: 'Impact wrench B',
      cause: 'Maintenance replacement',
      detail: 'Controlled temporary replacement',
    },
    checklist: {
      templateVersion: 'machine-v3',
      allPassed: true,
      items: [{ externalId: 'QC-01', label: 'Parameter verified', answer: 'YES' }],
    },
    decisions: input.decisions ?? [],
    metadata: { sourceSystem: 'supplier-app' },
  };
}

function decision(route: 'SUPERVISOR' | 'QC', value: 'APPROVED' | 'REJECTED') {
  return {
    route,
    decision: value,
    actorRef: `${route.toLowerCase()}-actor`,
    decidedAt: '2026-07-23T02:05:00.000Z',
  };
}

function cookieHeader(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}
