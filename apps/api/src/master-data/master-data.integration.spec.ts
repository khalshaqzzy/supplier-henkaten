import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express from 'express';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supplierSetupReadinessSchema } from '@tmmin-henkaten/contracts';

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
    app.use(
      '/api/v1/supplier/master-data/parts/import',
      express.json({ limit: '80mb', type: 'application/json' }),
    );
    app.use(express.json({ limit: '5mb', type: 'application/json' }));
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

  it('returns contract-valid blockers for an empty Hosted supplier', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/supplier/setup-readiness')
      .set('Cookie', supplierCookie);
    expect(response.status).toBe(200);
    const readiness = supplierSetupReadinessSchema.parse(response.body);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ACTIVE_SHIFT_TEMPLATE_MISSING' }),
        expect.objectContaining({ code: 'ACTIVE_LINE_MISSING' }),
        expect.objectContaining({ code: 'LINE_SHIFT_CONFIGURATION_PENDING' }),
      ]),
    );
    expect(readiness.areas.find(({ area }) => area === 'DEFAULT_ASSIGNMENTS')).toMatchObject({
      ready: false,
      activeCount: 0,
      requiredCount: 1,
    });
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
    });
    expect(mp.status).toBe(201);
    expect(mp.body).not.toHaveProperty('credential');
    expect(mp.body.member).not.toHaveProperty('account');
    expect(mp.body.member.registrationNumber).toBeNull();
    mpId = mp.body.member.id;

    const invalidMp = await supplierPost('/api/v1/supplier/master-data/members', {
      role: 'MP',
      fullName: 'MP With Registration',
      registrationNumber: `REG-M-${randomUUID()}`,
    });
    expect(invalidMp.status).toBe(400);

    const readiness = await request(app.getHttpServer())
      .get('/api/v1/supplier/setup-readiness')
      .set('Cookie', supplierCookie);
    expect(readiness.status).toBe(200);
    expect(readiness.body.areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: 'PARTS', ready: true, requiredCount: 0 }),
      ]),
    );

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
    expect(
      (
        await supplierPost('/api/v1/supplier/master-data/parts', {
          partNumber: `PART-${randomUUID()}`,
          partName: 'Example Part',
        })
      ).status,
    ).toBe(201);
    const shiftTemplate = await supplierPost('/api/v1/supplier/master-data/shift-templates', {
      name: 'Night Shift',
      startTime: '22:00',
      endTime: '06:00',
      timezone: 'Asia/Jakarta',
    });
    expect(shiftTemplate.body.crossesMidnight).toBe(true);

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

    const secondJob = await supplierPost(`/api/v1/supplier/master-data/lines/${lineId}/jobs`, {
      name: 'Inspection Station',
    });
    expect(secondJob.status).toBe(201);
    const lineShift = await supplierPost(`/api/v1/supplier/master-data/lines/${lineId}/shifts`, {
      shiftTemplateId: shiftTemplate.body.id,
    });
    expect(lineShift.status).toBe(201);
    const lineShiftBody = lineShift.body as {
      id: string;
      version: number;
      assignments: Array<{ jobId: string }>;
    };
    const incompleteReadinessResponse = await request(app.getHttpServer())
      .get('/api/v1/supplier/setup-readiness')
      .set('Cookie', supplierCookie);
    expect(incompleteReadinessResponse.status).toBe(200);
    const incompleteReadiness = supplierSetupReadinessSchema.parse(
      incompleteReadinessResponse.body,
    );
    expect(incompleteReadiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LINE_SHIFT_SUPERVISOR_MISSING' }),
        expect.objectContaining({ code: 'LINE_SHIFT_LEADER_MISSING' }),
        expect.objectContaining({ code: 'LINE_SHIFT_MP_MISSING' }),
      ]),
    );
    expect(incompleteReadiness.blockers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'LINE_SHIFT_MISSING' })]),
    );
    const configured = await supplierPatch(
      `/api/v1/supplier/master-data/line-shifts/${lineShiftBody.id}/assignments`,
      {
        expectedVersion: lineShiftBody.version,
        supervisorMemberId: supervisorId,
        lineLeaderMemberId: leaderId,
        jobs: lineShiftBody.assignments.map((assignment) => ({
          jobId: assignment.jobId,
          mpMemberId: mpId,
        })),
      },
    );
    expect(configured.status).toBe(200);
    const configuredBody = configured.body as {
      assignments: Array<{ mpMemberId: string | null }>;
    };
    expect(configuredBody.assignments.every((assignment) => assignment.mpMemberId === mpId)).toBe(
      true,
    );

    const boardAll = await request(app.getHttpServer())
      .get('/api/v1/supplier/assignment-board?shiftStatus=ALL')
      .set('Cookie', supplierCookie);
    const boardCurrent = await request(app.getHttpServer())
      .get('/api/v1/supplier/assignment-board?shiftStatus=CURRENT')
      .set('Cookie', supplierCookie);
    const boardOther = await request(app.getHttpServer())
      .get('/api/v1/supplier/assignment-board?shiftStatus=OTHER')
      .set('Cookie', supplierCookie);
    expect([boardAll.status, boardCurrent.status, boardOther.status]).toEqual([200, 200, 200]);
    const allShifts = (
      boardAll.body as { lines: Array<{ shiftRunId: string; isCurrent: boolean }> }
    ).lines;
    const currentShifts = (
      boardCurrent.body as { lines: Array<{ shiftRunId: string; isCurrent: boolean }> }
    ).lines;
    const otherShifts = (
      boardOther.body as { lines: Array<{ shiftRunId: string; isCurrent: boolean }> }
    ).lines;
    expect(allShifts.map((item) => item.shiftRunId)).toContain(lineShiftBody.id);
    expect(currentShifts.every((item) => item.isCurrent)).toBe(true);
    expect(otherShifts.every((item) => !item.isCurrent)).toBe(true);
    expect(currentShifts.length + otherShifts.length).toBe(allShifts.length);

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
    ).toBe(false);
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
    expect(upload.body.photo).toMatchObject({
      version: 1,
      fullUrl: expect.stringContaining('/photo/full?v=1'),
      thumbnailUrl: expect.stringContaining('/photo/thumbnail?v=1'),
    });

    const replacementPng = await sharp({
      create: { width: 48, height: 48, channels: 3, background: '#cc5500' },
    })
      .png()
      .toBuffer();
    const replacement = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/members/${mpId}/photo`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .attach('photo', replacementPng, { filename: 'replacement.png', contentType: 'image/png' });
    expect(replacement.status).toBe(201);
    expect(replacement.body.photo).toMatchObject({
      version: 2,
      thumbnailUrl: expect.stringContaining('/photo/thumbnail?v=2'),
    });
    const unchanged = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/members/${mpId}/photo`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .attach('photo', replacementPng, {
        filename: 'replacement-again.png',
        contentType: 'image/png',
      });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.code).toBe('STATE_CONFLICT');
    await expect(
      prisma.memberPhoto.count({ where: { memberId: mpId, state: 'CURRENT' } }),
    ).resolves.toBe(1);

    const photo = await request(app.getHttpServer())
      .get(`/api/v1/supplier/master-data/members/${mpId}/photo/thumbnail`)
      .set('Cookie', supplierCookie);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toContain('image/webp');
    expect(photo.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(photo.headers['cache-control']).toContain('private');

    const staleRemoval = await supplierPost(
      `/api/v1/supplier/master-data/members/${mpId}/photo/remove`,
      { expectedVersion: 1 },
    );
    expect(staleRemoval.status).toBe(409);
    expect(staleRemoval.body.code).toBe('VERSION_CONFLICT');

    const removal = await supplierPost(
      `/api/v1/supplier/master-data/members/${mpId}/photo/remove`,
      { expectedVersion: 2 },
    );
    expect(removal.status).toBe(204);
    await expect(
      prisma.memberPhoto.count({ where: { memberId: mpId, state: 'CURRENT' } }),
    ).resolves.toBe(0);

    const restored = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/members/${mpId}/photo`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierCookie)
      .set('X-CSRF-Token', supplierCsrf)
      .attach('photo', png, { filename: 'restored.png', contentType: 'image/png' });
    expect(restored.status).toBe(201);
    expect(restored.body.photo).toMatchObject({
      version: 4,
      thumbnailUrl: expect.stringContaining('/photo/thumbnail?v=4'),
    });
    await expect(
      prisma.outboxEvent.count({
        where: { supplierId, eventType: 'MEMBER_PHOTO_CHANGED', aggregateId: mpId },
      }),
    ).resolves.toBe(4);

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

  it('reviews part conflicts and applies only selected import changes atomically', async () => {
    const suffix = randomUUID().slice(0, 8);
    const currentNumber = `IMP-EXIST-${suffix}`;
    const newNumber = `IMP-NEW-${suffix}`;
    const created = await supplierPost('/api/v1/supplier/master-data/parts', {
      partNumber: currentNumber,
      partName: 'Current name',
    });
    expect(created.status).toBe(201);
    const currentId = (created.body as { id: string }).id;
    const preview = await supplierPost('/api/v1/supplier/master-data/parts/import/preview', {
      rows: [
        { partNumber: currentNumber.toLowerCase(), partName: 'File name' },
        { partNumber: newNumber, partName: 'New part' },
      ],
    });
    expect(preview.status).toBe(201);
    const reviewed = preview.body as {
      rows: Array<{ existing: { id: string; version: number } | null }>;
    };
    expect(reviewed.rows[0]?.existing?.id).toBe(currentId);
    expect(reviewed.rows[1]?.existing).toBeNull();

    const committed = await supplierPost('/api/v1/supplier/master-data/parts/import/commit', {
      rows: [
        {
          partNumber: currentNumber,
          partName: 'File name',
          action: 'UPDATE',
          existingId: currentId,
          expectedVersion: reviewed.rows[0]?.existing?.version,
        },
        { partNumber: newNumber, partName: 'New part', action: 'CREATE' },
      ],
    });
    expect(committed.status).toBe(201);
    expect(committed.body).toEqual({ created: 1, updated: 1, skipped: 0 });
    const saved = await prisma.part.findFirst({
      where: { supplierId, normalizedPartNumber: newNumber.toLowerCase() },
    });
    expect(saved?.partName).toBe('New part');

    const staleNumber = `IMP-STALE-${suffix}`;
    const stale = await supplierPost('/api/v1/supplier/master-data/parts/import/commit', {
      rows: [
        {
          partNumber: currentNumber,
          partName: 'Stale name',
          action: 'UPDATE',
          existingId: currentId,
          expectedVersion: reviewed.rows[0]?.existing?.version,
        },
        { partNumber: staleNumber, partName: 'Must roll back', action: 'CREATE' },
      ],
    });
    expect(stale.status).toBe(409);
    expect(
      await prisma.part.count({
        where: { supplierId, normalizedPartNumber: staleNumber.toLowerCase() },
      }),
    ).toBe(0);

    const skipped = await supplierPost('/api/v1/supplier/master-data/parts/import/commit', {
      rows: [{ partNumber: currentNumber, partName: 'Ignored', action: 'SKIP' }],
    });
    expect(skipped.body).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it('commits 50,000 parts atomically with audit events', async () => {
    const prefix = `BULK-${randomUUID().slice(0, 8)}`;
    const auditBefore = await prisma.auditEvent.count({
      where: { supplierId, action: 'PART_CREATED' },
    });
    const rows = Array.from({ length: 50_000 }, (_, index) => ({
      partNumber: `${prefix}-${index}`,
      partName: `Part ${index}`.padEnd(200, 'X'),
    }));
    expect(Buffer.byteLength(JSON.stringify({ rows }))).toBeGreaterThan(5 * 1024 * 1024);
    const preview = await supplierPost('/api/v1/supplier/master-data/parts/import/preview', {
      rows,
    });
    expect(preview.status).toBe(201);
    expect((preview.body as { rows: unknown[] }).rows).toHaveLength(rows.length);
    const committed = await supplierPost('/api/v1/supplier/master-data/parts/import/commit', {
      rows: rows.map((row) => ({ ...row, action: 'CREATE' })),
    });
    expect(committed.status).toBe(201);
    expect(committed.body).toEqual({ created: rows.length, updated: 0, skipped: 0 });
    const created = await prisma.part.findMany({
      where: { supplierId, partNumber: { startsWith: prefix } },
      orderBy: { partNumber: 'asc' },
      select: { id: true, partNumber: true, version: true },
    });
    expect(created).toHaveLength(rows.length);
    expect(
      (await prisma.auditEvent.count({ where: { supplierId, action: 'PART_CREATED' } })) -
        auditBefore,
    ).toBe(rows.length);
    const changed = await supplierPost('/api/v1/supplier/master-data/parts/import/commit', {
      rows: created.slice(0, 510).map((part) => ({
        partNumber: part.partNumber,
        partName: 'Updated by bulk import',
        action: 'UPDATE',
        existingId: part.id,
        expectedVersion: part.version,
      })),
    });
    expect(changed.status).toBe(201);
    expect(changed.body).toEqual({ created: 0, updated: 510, skipped: 0 });
    expect(
      await prisma.part.count({
        where: {
          supplierId,
          partNumber: { startsWith: prefix },
          partName: 'Updated by bulk import',
        },
      }),
    ).toBe(510);
  }, 120_000);

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
