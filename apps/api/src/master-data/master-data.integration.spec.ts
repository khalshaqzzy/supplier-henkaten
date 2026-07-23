import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { SourceGovernanceService } from '../administration/source-governance.service.js';

const supplierOrigin = 'http://localhost:5173';
const tmminOrigin = 'http://localhost:5174';

describe('supplier master data', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let supplierCookie: string;
  let supplierCsrf: string;
  let tmminQualityCookie: string;
  let supervisorId: string;
  let leaderId: string;
  let mpId: string;
  let lineId: string;
  let jobId: string;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'integration-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'integration-test-throttle-secret-32';
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['PHOTO_STORAGE_ROOT'] = `.local/test-member-photos-${randomUUID()}`;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const supplierPassword = 'Supplier-Master-Password-123';
    const qualityPassword = 'Quality-Master-Password-123';
    const [supplierHash, qualityHash] = await Promise.all([
      passwords.hash(supplierPassword),
      passwords.hash(qualityPassword),
    ]);
    const supplierCode = `MASTER-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code: supplierCode,
        normalizedCode: supplierCode.toLowerCase(),
        name: 'Master Data Integration Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    supplierId = supplier.id;
    const adminUsername = `supplier-admin-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        role: 'SUPPLIER_ADMIN',
        username: adminUsername,
        normalizedUsername: adminUsername,
        displayName: 'Supplier Master Admin',
        passwordHash: supplierHash,
        mustChangePassword: false,
      },
    });
    const qualityUsername = `tmmin-quality-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        username: qualityUsername,
        normalizedUsername: qualityUsername,
        displayName: 'TMMIN Quality Master Reader',
        passwordHash: qualityHash,
        mustChangePassword: false,
      },
    });
    const supplierLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/login')
      .set('Origin', supplierOrigin)
      .send({
        supplierCode: supplier.code,
        username: adminUsername,
        password: supplierPassword,
      });
    expect(supplierLogin.status).toBe(200);
    supplierCookie = supplierLogin.headers['set-cookie'] ?? '';
    supplierCsrf = supplierLogin.body.csrfToken as string;
    const qualityLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ username: qualityUsername, password: qualityPassword });
    expect(qualityLogin.status).toBe(200);
    tmminQualityCookie = qualityLogin.headers['set-cookie'] ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions role-linked members while MP remains credential-free', async () => {
    const supervisor = await supplierPost('/api/v1/supplier/master-data/members', {
      role: 'SUPERVISOR',
      fullName: 'Example Supervisor',
      registrationNumber: `REG-S-${randomUUID()}`,
      username: `supervisor-${randomUUID()}`,
    });
    expect(supervisor.status).toBe(201);
    expect(supervisor.body.credential.temporaryPassword).toBeTypeOf('string');
    supervisorId = supervisor.body.member.id;

    const leader = await supplierPost('/api/v1/supplier/master-data/members', {
      role: 'LINE_LEADER',
      fullName: 'Example Line Leader',
      registrationNumber: `REG-L-${randomUUID()}`,
      username: `leader-${randomUUID()}`,
    });
    expect(leader.status).toBe(201);
    leaderId = leader.body.member.id;

    const mp = await supplierPost('/api/v1/supplier/master-data/members', {
      role: 'MP',
      fullName: 'Example MP',
      registrationNumber: `REG-M-${randomUUID()}`,
    });
    expect(mp.status).toBe(201);
    expect(mp.body).not.toHaveProperty('credential');
    expect(mp.body.member).not.toHaveProperty('account');
    mpId = mp.body.member.id;

    await expect(
      prisma.member.update({ where: { id: mpId }, data: { role: 'QC' } }),
    ).rejects.toThrow();
  });

  it('configures catalog, immutable checklists, assignments, and source preflight', async () => {
    const line = await supplierPost('/api/v1/supplier/master-data/lines', {
      code: `LINE-${randomUUID()}`,
      name: 'Main Assembly',
    });
    expect(line.status).toBe(201);
    lineId = line.body.id;
    const reordered = await supplierPost('/api/v1/supplier/master-data/lines/reorder', {
      items: [{ id: lineId, expectedVersion: line.body.version }],
    });
    expect(reordered.status).toBe(201);
    expect(reordered.body.reordered).toBe(1);
    const job = await supplierPost(`/api/v1/supplier/master-data/lines/${lineId}/jobs`, {
      name: 'Torque Station',
    });
    expect(job.status).toBe(201);
    jobId = job.body.id;
    expect(
      (
        await supplierPost('/api/v1/supplier/master-data/parts', {
          partNumber: `PART-${randomUUID()}`,
          partName: 'Example Part',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierPost('/api/v1/supplier/master-data/shift-templates', {
          name: 'Night Shift',
          startTime: '22:00',
          endTime: '06:00',
          timezone: 'Asia/Jakarta',
        })
      ).body.crossesMidnight,
    ).toBe(true);

    for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD']) {
      const draft = await supplierPatch(
        `/api/v1/supplier/master-data/checklists/${category}/draft`,
        { items: [{ label: `${category} condition verified` }] },
      );
      expect(draft.status).toBe(200);
      const published = await supplierPost(
        `/api/v1/supplier/master-data/checklists/${category}/publish`,
        { expectedVersion: draft.body.version },
      );
      expect(published.status).toBe(201);
      expect(published.body.versionNumber).toBe(1);
      await expect(
        prisma.checklistVersion.update({
          where: { id: published.body.id },
          data: { versionNumber: 2 },
        }),
      ).rejects.toThrow();
    }

    expect(
      (
        await supplierPost(`/api/v1/supplier/master-data/lines/${lineId}/default-supervisor`, {
          memberId: supervisorId,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierPost(`/api/v1/supplier/master-data/lines/${lineId}/default-line-leader`, {
          memberId: leaderId,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierPost(`/api/v1/supplier/master-data/jobs/${jobId}/default-mp`, {
          memberId: mpId,
        })
      ).status,
    ).toBe(201);

    const blocked = await supplierPost(`/api/v1/supplier/master-data/members/${mpId}/deactivate`, {
      expectedVersion: 1,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('RESOURCE_IN_USE');

    const source = app.get(SourceGovernanceService);
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { sourceMode: 'EXTERNAL' },
    });
    const preflight = await source.preflight(supplierId, 'HOSTED');
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { sourceMode: 'HOSTED' },
    });
    expect(
      preflight.blockers.some(({ contributor }) => contributor === 'phase-4-hosted-configuration'),
    ).toBe(false);
    expect(
      preflight.blockers.some(
        ({ contributor }) => contributor === 'phase-9-external-credentials-and-projection',
      ),
    ).toBe(true);
  });

  it('enforces pure External and Hosted Preparation master-data boundaries', async () => {
    const admin = await prisma.user.findFirstOrThrow({
      where: { supplierId, role: 'SUPPLIER_ADMIN', status: 'ACTIVE' },
    });
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { sourceMode: 'EXTERNAL' },
    });
    let preparationId: string | undefined;
    try {
      const pureExternal = await supplierPost('/api/v1/supplier/master-data/parts', {
        partNumber: `PURE-EXTERNAL-${randomUUID()}`,
        partName: 'Must Be Rejected',
      });
      expect(pureExternal.status).toBe(409);
      expect(pureExternal.body.code).toBe('SOURCE_MODE_MISMATCH');

      const preparation = await prisma.hostedPreparation.create({
        data: {
          supplierId,
          adminUserId: admin.id,
          sourceEpoch: 1,
          reason: 'Integration preparation boundary',
          privacyAcknowledgedAt: new Date(),
          startedById: admin.id,
        },
      });
      preparationId = preparation.id;
      await prisma.userSession.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { purpose: 'HOSTED_PREPARATION' },
      });

      const preparationWrite = await supplierPost('/api/v1/supplier/master-data/parts', {
        partNumber: `PREPARATION-${randomUUID()}`,
        partName: 'Preparation Part',
      });
      expect(preparationWrite.status).toBe(201);

      const qualityDenied = await request(app.getHttpServer())
        .get(`/api/v1/tmmin/suppliers/${supplierId}/master-data/members`)
        .set('Cookie', tmminQualityCookie);
      expect(qualityDenied.status).toBe(404);
    } finally {
      await prisma.userSession.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { purpose: 'NORMAL' },
      });
      if (preparationId) {
        await prisma.hostedPreparation.update({
          where: { id: preparationId },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: admin.id },
        });
      }
      await prisma.supplier.update({
        where: { id: supplierId },
        data: { sourceMode: 'HOSTED' },
      });
    }
  });

  it('normalizes and serves private photos and audits TMMIN Quality reads', async () => {
    const malformed = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/members/${mpId}/photo`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .attach('photo', Buffer.from('not-a-png'), {
        filename: 'malformed.png',
        contentType: 'image/png',
      });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_IMAGE');

    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/members/${mpId}/photo`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .attach('photo', png, { filename: 'avatar.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);

    const photo = await request(app.getHttpServer())
      .get(`/api/v1/supplier/master-data/members/${mpId}/photo/thumbnail`)
      .set('Cookie', supplierCookie);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toContain('image/webp');

    const otherSupplierCode = `OTHER-${randomUUID()}`;
    const otherSupplier = await prisma.supplier.create({
      data: {
        code: otherSupplierCode,
        normalizedCode: otherSupplierCode.toLowerCase(),
        name: 'Other Hosted Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    const otherMember = await prisma.member.create({
      data: {
        supplierId: otherSupplier.id,
        fullName: 'Other Tenant Member',
        registrationNumber: `OTHER-${randomUUID()}`,
        normalizedRegistrationNumber: randomUUID(),
        role: 'MP',
      },
    });
    const crossTenantPhoto = await request(app.getHttpServer())
      .get(`/api/v1/supplier/master-data/members/${otherMember.id}/photo/thumbnail`)
      .set('Cookie', supplierCookie);
    expect(crossTenantPhoto.status).toBe(404);

    const tmminRead = await request(app.getHttpServer())
      .get(`/api/v1/tmmin/suppliers/${supplierId}/master-data/members`)
      .set('Cookie', tmminQualityCookie);
    expect(tmminRead.status).toBe(200);
    const tmminItems = (tmminRead.body as { items: Array<{ registrationNumber: string }> }).items;
    expect(tmminItems.some(({ registrationNumber }) => Boolean(registrationNumber))).toBe(true);
    await expect(
      prisma.auditEvent.count({
        where: { supplierId, action: 'TMMIN_MEMBER_LIST_VIEWED' },
      }),
    ).resolves.toBeGreaterThan(0);

    const forbiddenMutation = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/parts`)
      .set('Origin', tmminOrigin)
      .set('Cookie', tmminQualityCookie)
      .send({ partNumber: 'NO', partName: 'NO' });
    expect(forbiddenMutation.status).toBe(401);
  });

  function supplierPost(path: string, body: unknown) {
    return request(app.getHttpServer())
      .post(path)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .send(body as object);
  }

  function supplierPatch(path: string, body: unknown) {
    return request(app.getHttpServer())
      .patch(path)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .send(body as object);
  }
});
