import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import { TenantScope } from '../common/scope.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { provisionRuntimeRole } from '../cli/migrate.js';
import { HenkatenService } from '../henkaten/henkaten.service.js';
import { ReadModelService, redactAuditSummary } from './read-model.service.js';

describe('audit isolation and passive session validation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let foreignId: string;
  let userId: string;
  beforeAll(async () => {
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['SHIFT_ROTATION_ENABLED'] = 'false';
    process.env['PCR_WORKER_ENABLED'] = 'false';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const suppliers = await Promise.all(
      [0, 1].map((i) =>
        prisma.supplier.create({
          data: {
            code: `AUD-${i}-${randomUUID()}`,
            normalizedCode: randomUUID(),
            name: 'Audit boundary supplier',
            sourceMode: 'HOSTED',
            timezone: 'Asia/Jakarta',
          },
        }),
      ),
    );
    supplierId = suppliers[0]!.id;
    foreignId = suppliers[1]!.id;
    userId = (
      await prisma.user.create({
        data: {
          realm: 'SUPPLIER',
          role: 'SUPPLIER_ADMIN',
          supplierId,
          username: randomUUID(),
          normalizedUsername: randomUUID(),
          displayName: 'Audit test',
          passwordHash: 'not-a-login-credential',
          mustChangePassword: false,
        },
      })
    ).id;
    await prisma.auditEvent.createMany({
      data: [supplierId, foreignId].flatMap((id) =>
        ['HENKATEN_OPENED', 'USER_CREATED'].map((action) => ({
          supplierId: id,
          actorKind: 'SYSTEM' as const,
          action,
          resourceType: 'Test',
          result: 'SUCCESS' as const,
          correlationId: randomUUID(),
        })),
      ),
    });
  });
  afterAll(async () => {
    await app.close();
  });
  function principal(role: RequestPrincipal['role']): RequestPrincipal {
    return {
      userId,
      displayName: 'Test',
      realm: 'SUPPLIER',
      supplierId,
      role,
      purpose: 'NORMAL',
      mustChangePassword: false,
      sessionId: randomUUID(),
      rawSessionToken: 'unused',
    };
  }
  it('keeps Admin and QC tenant predicates immutable with foreign, own and omitted filters', async () => {
    const service = app.get(ReadModelService);
    for (const role of ['SUPPLIER_ADMIN', 'QC'] as const) {
      expect(
        (
          await service.supplierAudit(new TenantScope(supplierId), principal(role), {
            limit: 100,
            supplierId: foreignId,
          })
        ).items,
      ).toHaveLength(0);
      for (const filter of [{}, { supplierId }]) {
        const page = await service.supplierAudit(new TenantScope(supplierId), principal(role), {
          limit: 100,
          ...filter,
        });
        expect(page.items).toHaveLength(2);
        expect(page.items.every((row) => row.supplierId === supplierId)).toBe(true);
      }
    }
  });
  it('retains TMMIN filtering and intersects Quality action restrictions', async () => {
    const service = app.get(ReadModelService);
    const admin = await service.tmminAudit(
      { ...principal('TMMIN_ADMIN'), realm: 'TMMIN' },
      { limit: 100, supplierId: foreignId },
      randomUUID(),
    );
    expect(admin.items).toHaveLength(2);
    const restricted = await service.tmminAudit(
      { ...principal('TMMIN_QUALITY'), realm: 'TMMIN' },
      { limit: 100, supplierId: foreignId, action: 'USER_CREATED' },
      randomUUID(),
    );
    expect(restricted.items).toHaveLength(0);
  });
  it('does not extend idle activity and rejects expired or revoked passive sessions', async () => {
    const sessions = app.get(SessionService);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const created = await sessions.create(user, 1, 'NORMAL', {});
    const past = new Date(Date.now() - 120_000);
    await prisma.userSession.update({ where: { id: created.id }, data: { lastActivityAt: past } });
    expect(await sessions.resolve(created.rawToken, 'SUPPLIER', false)).not.toBeNull();
    expect(
      (await prisma.userSession.findUniqueOrThrow({ where: { id: created.id } })).lastActivityAt,
    ).toEqual(past);
    await prisma.userSession.update({ where: { id: created.id }, data: { idleExpiresAt: past } });
    expect(await sessions.resolve(created.rawToken, 'SUPPLIER', false)).toBeNull();
    await prisma.userSession.update({
      where: { id: created.id },
      data: { idleExpiresAt: created.idleExpiresAt },
    });
    await sessions.revoke(created.id, 'LOGOUT');
    expect(await sessions.resolve(created.rawToken, 'SUPPLIER', false)).toBeNull();
  });

  it('excludes TMMIN, external-client, and TMMIN-only system audit rows from supplier audit and dashboard', async () => {
    const service = app.get(ReadModelService);
    const tmminUser = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username: `tmmin-${randomUUID()}`,
        normalizedUsername: `tmmin-${randomUUID()}`,
        displayName: 'TMMIN Secret Operator',
        passwordHash: 'not-a-login-credential',
        mustChangePassword: false,
      },
    });
    const secretReason = `confidential-tmmin-delete-reason-${randomUUID()}`;
    await prisma.auditEvent.createMany({
      data: [
        {
          supplierId,
          actorKind: 'USER',
          actorUserId: tmminUser.id,
          actorRole: 'TMMIN_ADMIN',
          action: 'HENKATEN_DELETED',
          resourceType: 'HenkatenDeletionCommand',
          resourceId: randomUUID(),
          reason: secretReason,
          result: 'SUCCESS',
          correlationId: randomUUID(),
        },
        {
          supplierId,
          actorKind: 'USER',
          actorUserId: tmminUser.id,
          actorRole: 'TMMIN_ADMIN',
          action: 'SUPPLIER_ADMIN_MAGIC_LINK_ISSUED',
          resourceType: 'SupplierAdminMagicLink',
          resourceId: randomUUID(),
          result: 'SUCCESS',
          correlationId: randomUUID(),
        },
        {
          supplierId,
          actorKind: 'EXTERNAL_CLIENT',
          action: 'EXTERNAL_INGEST_ACCEPTED',
          resourceType: 'ExternalHenkatenProjection',
          resourceId: randomUUID(),
          sourceMode: 'EXTERNAL',
          result: 'SUCCESS',
          correlationId: randomUUID(),
        },
        {
          supplierId,
          actorKind: 'SYSTEM',
          action: 'NOTIFICATION_GENERATED',
          resourceType: 'ExternalHenkatenProjection',
          resourceId: randomUUID(),
          result: 'SUCCESS',
          correlationId: randomUUID(),
        },
        {
          supplierId,
          actorKind: 'SYSTEM',
          action: 'SHIFT_TIMES_ROTATED',
          resourceType: 'ShiftRotationSchedule',
          resourceId: randomUUID(),
          result: 'SUCCESS',
          correlationId: randomUUID(),
        },
      ],
    });

    const supplierAudit = await service.supplierAudit(
      new TenantScope(supplierId),
      principal('SUPPLIER_ADMIN'),
      { limit: 100 },
    );
    const actions = supplierAudit.items.map((item) => item.action);
    expect(actions).toContain('SHIFT_TIMES_ROTATED');
    expect(actions).not.toContain('HENKATEN_DELETED');
    expect(actions).not.toContain('SUPPLIER_ADMIN_MAGIC_LINK_ISSUED');
    expect(actions).not.toContain('EXTERNAL_INGEST_ACCEPTED');
    expect(actions).not.toContain('NOTIFICATION_GENERATED');
    expect(supplierAudit.items.some((item) => item.reason === secretReason)).toBe(false);

    const dashboard = await service.supplierDashboard(
      new TenantScope(supplierId),
      principal('SUPPLIER_ADMIN'),
      { granularity: 'DAY' },
    );
    const recentActions = dashboard.recentActivity.map((item) => item.action);
    expect(recentActions).toContain('SHIFT_TIMES_ROTATED');
    expect(recentActions).not.toContain('HENKATEN_DELETED');
    expect(recentActions).not.toContain('SUPPLIER_ADMIN_MAGIC_LINK_ISSUED');
    expect(recentActions).not.toContain('NOTIFICATION_GENERATED');
    expect(
      dashboard.recentActivity.some((item) => item.actor.displayName === 'TMMIN Secret Operator'),
    ).toBe(false);
  });

  it('redacts historical HENKATEN_EXPORT_REQUESTED filters.part for TMMIN and impersonator UUIDs for supplier', async () => {
    const service = app.get(ReadModelService);
    const internalSecret = `INT-SECRET-${randomUUID().slice(0, 8)}`;
    await prisma.auditEvent.create({
      data: {
        supplierId,
        actorKind: 'USER',
        actorUserId: userId,
        actorRole: 'SUPPLIER_ADMIN',
        actorSupplierId: supplierId,
        action: 'HENKATEN_EXPORT_REQUESTED',
        resourceType: 'HenkatenExportJob',
        resourceId: randomUUID(),
        changeSummary: {
          filters: { part: internalSecret, status: 'OPEN' },
          tmminOperatorId: randomUUID(),
        },
        result: 'SUCCESS',
        correlationId: randomUUID(),
      },
    });

    const tmminPage = await service.tmminAudit(
      { ...principal('TMMIN_ADMIN'), realm: 'TMMIN' },
      { limit: 100, supplierId, action: 'HENKATEN_EXPORT_REQUESTED' },
      randomUUID(),
    );
    expect(tmminPage.items.length).toBeGreaterThan(0);
    const tmminSummary = tmminPage.items[0]!.changeSummary as Record<string, unknown>;
    expect(JSON.stringify(tmminSummary)).not.toContain(internalSecret);
    expect(tmminSummary.partFiltered).toBe(true);
    expect((tmminSummary.filters as Record<string, unknown>).status).toBe('OPEN');

    const supplierPage = await service.supplierAudit(
      new TenantScope(supplierId),
      principal('SUPPLIER_ADMIN'),
      { limit: 100, action: 'HENKATEN_EXPORT_REQUESTED' },
    );
    expect(supplierPage.items.length).toBeGreaterThan(0);
    const supplierSummary = supplierPage.items[0]!.changeSummary as Record<string, unknown>;
    expect(supplierSummary.tmminOperatorId).toBeUndefined();
    expect(supplierSummary.impersonated).toBe(true);

    // Fail-closed recursion depth test.
    let nested: Record<string, unknown> = { secretLeaf: 'should-redact' };
    for (let depth = 0; depth < 10; depth += 1) nested = { child: nested };
    const redacted = redactAuditSummary(nested as never, { realm: 'TMMIN' });
    expect(JSON.stringify(redacted)).not.toContain('should-redact');
    expect(JSON.stringify(redacted)).toContain('[REDACTED]');
  });

  it('hides and blocks search on supplier-internal part numbers in TMMIN Henkaten list and detail', async () => {
    const henkatens = app.get(HenkatenService);
    const internalCode = `SUP-INT-${randomUUID().slice(0, 8)}`;
    const tmminPartNumber = `TMMIN-PN-${randomUUID().slice(0, 8)}`;
    const line = await prisma.line.create({
      data: {
        supplierId,
        code: `L-${randomUUID().slice(0, 6)}`,
        normalizedCode: randomUUID(),
        name: 'Line Privacy',
        displayOrder: 1,
        createdById: userId,
        updatedById: userId,
      },
    });
    const job = await prisma.job.create({
      data: {
        supplierId,
        lineId: line.id,
        name: 'Job Privacy',
        normalizedName: randomUUID(),
        displayOrder: 1,
        createdById: userId,
        updatedById: userId,
      },
    });
    const part = await prisma.part.create({
      data: {
        supplierId,
        partNumber: tmminPartNumber,
        normalizedPartNumber: tmminPartNumber.toLowerCase(),
        partName: 'Part Privacy',
        normalizedPartName: 'part privacy',
        internalPartNumber: internalCode,
        normalizedInternalPartNumber: internalCode.toLowerCase(),
        createdById: userId,
        updatedById: userId,
      },
    });
    const template = await prisma.shiftTemplate.create({
      data: {
        supplierId,
        name: 'Shift Privacy',
        displayOrder: 1,
        timezone: 'Asia/Jakarta',
        startMinute: 480,
        endMinute: 960,
        createdById: userId,
        updatedById: userId,
      },
    });
    const member = await prisma.member.create({
      data: {
        supplierId,
        fullName: 'Leader Privacy',
        role: 'LINE_LEADER',
        registrationNumber: `REG-${randomUUID().slice(0, 8)}`,
        normalizedRegistrationNumber: randomUUID(),
        createdById: userId,
        updatedById: userId,
      },
    });
    const shiftRun = await prisma.shiftRun.create({
      data: {
        supplierId,
        lineId: line.id,
        shiftTemplateId: template.id,
        businessDate: new Date('2026-11-26T00:00:00.000Z'),
        timezoneSnapshot: 'Asia/Jakarta',
        scheduledStartAt: new Date('2026-11-26T01:00:00.000Z'),
        scheduledEndAt: new Date('2026-11-26T09:00:00.000Z'),
        lineCodeSnapshot: line.code,
        lineNameSnapshot: line.name,
        shiftNameSnapshot: template.name,
        shiftStartMinuteSnapshot: 480,
        shiftEndMinuteSnapshot: 960,
        defaultAssignmentSetVersion: 1,
        sourceEpoch: 1,
        supervisorMemberId: member.id,
        lineLeaderMemberId: member.id,
        latestPreflight: {},
        latestPreflightAt: new Date('2026-11-26T00:30:00.000Z'),
        createdById: userId,
      },
    });
    const henkaten = await prisma.henkaten.create({
      data: {
        supplierId,
        shiftRunId: shiftRun.id,
        lineId: line.id,
        jobId: job.id,
        partId: part.id,
        identifier: `HK-PRIV-${randomUUID().slice(0, 8)}`,
        dailySequence: 1,
        sourceMode: 'HOSTED',
        sourceEpoch: 1,
        category: 'MACHINE',
        status: 'OPEN',
        occurredAt: new Date('2026-11-26T02:00:00.000Z'),
        businessDate: new Date('2026-11-26T00:00:00.000Z'),
        timezoneSnapshot: 'Asia/Jakarta',
        shiftNameSnapshot: template.name,
        lineCodeSnapshot: line.code,
        lineNameSnapshot: line.name,
        jobNameSnapshot: job.name,
        partNumberSnapshot: part.partNumber,
        normalizedPartNumberSnapshot: part.normalizedPartNumber,
        partNameSnapshot: part.partName,
        creatorMemberId: member.id,
        creatorNameSnapshot: member.fullName,
        cause: 'Privacy check',
        detail: 'Verify internal part number isolation',
        affectedObject: 'Machine A',
        replacementObject: 'Machine B',
        submissionKey: randomUUID(),
        submissionPayloadHash: 'a'.repeat(64),
        createdById: userId,
        parts: {
          create: {
            position: 1,
            partId: part.id,
            partNumberSnapshot: part.partNumber,
            normalizedPartNumberSnapshot: part.normalizedPartNumber,
            partNameSnapshot: part.partName,
            internalPartNumberSnapshot: internalCode,
          },
        },
        approvalRoutes: {
          create: [
            { route: 'SUPERVISOR', status: 'PENDING' },
            { route: 'QC', status: 'PENDING' },
          ],
        },
      },
    });

    const scope = new TenantScope(supplierId);
    const tmminSearchByInternal = await henkatens.list(scope, { limit: 25, part: internalCode });
    expect(tmminSearchByInternal.items).toHaveLength(0);

    const tmminList = await henkatens.list(scope, { limit: 25, part: tmminPartNumber });
    expect(tmminList.items).toHaveLength(1);
    expect(tmminList.items[0]!.parts[0]!.internalNumber).toBeNull();

    const tmminDetail = await henkatens.get(scope, henkaten.id);
    expect(tmminDetail.parts[0]!.internalNumber).toBeNull();

    const supplierSearch = await henkatens.list(
      scope,
      { limit: 25, part: internalCode },
      principal('SUPPLIER_ADMIN'),
    );
    expect(supplierSearch.items).toHaveLength(1);
    expect(supplierSearch.items[0]!.parts[0]!.internalNumber).toBe(internalCode);

    const supplierDetail = await henkatens.get(scope, henkaten.id, principal('SUPPLIER_ADMIN'));
    expect(supplierDetail.parts[0]!.internalNumber).toBe(internalCode);
  });

  it('provisions a least-privilege non-superuser PostgreSQL runtime role and blocks privileged operations', async () => {
    const migrationDatabaseUrl = process.env['DATABASE_URL']!;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const appUser = `henkaten_app_${suffix}`;
    const appPassword = `AppRoleSecret_${randomUUID().replaceAll('-', '')}`;

    await provisionRuntimeRole({ migrationDatabaseUrl, appUser, appPassword });

    const appUrl = new URL(migrationDatabaseUrl);
    appUrl.username = encodeURIComponent(appUser);
    appUrl.password = encodeURIComponent(appPassword);
    const client = new pg.Client({ connectionString: appUrl.toString() });
    await client.connect();
    try {
      const superCheck = await client.query<{ is_superuser: string }>(
        "SELECT current_setting('is_superuser') AS is_superuser",
      );
      expect(superCheck.rows[0]?.is_superuser).toBe('off');

      // /ready reads _prisma_migrations; must remain permitted.
      await expect(
        client.query('SELECT count(*) FROM "_prisma_migrations"'),
      ).resolves.toBeDefined();

      // Appending AuditEvent and one-way hiddenAt hiding must work.
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO "AuditEvent" (id, "actorKind", action, "resourceType", "correlationId", result)
         VALUES ($1::uuid, 'SYSTEM', 'ROLE_TEST_EVENT', 'Test', $2, 'SUCCESS')`,
        [auditId, randomUUID()],
      );
      await client.query('UPDATE "AuditEvent" SET "hiddenAt" = NOW() WHERE id = $1::uuid', [
        auditId,
      ]);

      // Privileged/forbidden operations must all fail with insufficient privilege (42501).
      for (const sql of [
        'ALTER TABLE "AuditEvent" DISABLE TRIGGER ALL',
        'DELETE FROM "AuditEvent"',
        'TRUNCATE "AuditEvent"',
        `UPDATE "AuditEvent" SET action = 'TAMPERED' WHERE id = '${auditId}'::uuid`,
        'CREATE TABLE public.runtime_escape_test (id int)',
      ]) {
        await expect(client.query(sql)).rejects.toThrow(/permission denied|must be owner/i);
      }
    } finally {
      await client.end();
      const adminClient = new pg.Client({ connectionString: migrationDatabaseUrl });
      await adminClient.connect();
      try {
        await adminClient.query(
          `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "${appUser}"`,
        );
        await adminClient.query(
          `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "${appUser}"`,
        );
        await adminClient.query(`REVOKE USAGE ON SCHEMA public FROM "${appUser}"`);
        await adminClient.query(
          `REVOKE CONNECT ON DATABASE "${decodeURIComponent(appUrl.pathname.slice(1))}" FROM "${appUser}"`,
        );
        await adminClient.query(`DROP ROLE IF EXISTS "${appUser}"`);
      } finally {
        await adminClient.end();
      }
    }
  });
});
