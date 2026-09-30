import { randomUUID, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETUP_SHEETS, type SetupRow, type SetupCommit } from '@tmmin-henkaten/contracts';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import type { RequestPrincipal } from '../common/request-context.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { SetupService } from './setup.service.js';
import { createSetupTemplate } from './setup-template.js';

const password = 'Setup-Integration-Password-2026';
describe('Supplier workbook import and reset', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: SetupService;
  let principal: RequestPrincipal;
  let context: MutationContext;
  let rows: SetupRow[];
  let supplierId: string;
  let originalMemberId: string;
  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] ??=
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'integration-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'integration-test-throttle-secret-32';
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['PCR_WORKER_ENABLED'] = 'false';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(SetupService);
    await service.beforeApplicationShutdown();
    const code = `SETUP-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code,
        normalizedCode: code.toLowerCase(),
        name: 'Workbook test',
        sourceMode: 'HOSTED',
        timezone: 'Asia/Jakarta',
      },
    });
    supplierId = supplier.id;
    const user = await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        role: 'SUPPLIER_ADMIN',
        username: 'admin',
        normalizedUsername: 'admin',
        displayName: 'Setup Admin',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        supplierId,
        realm: 'SUPPLIER',
        sourceEpoch: supplier.sourceEpoch,
        passwordEpoch: user.passwordEpoch,
        authorizationEpoch: user.authorizationEpoch,
        tokenHash: randomBytes(32),
        lastActivityAt: new Date(),
        idleExpiresAt: new Date(Date.now() + 3600000),
        absoluteExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    principal = {
      userId: user.id,
      displayName: user.displayName,
      role: 'SUPPLIER_ADMIN',
      realm: 'SUPPLIER',
      supplierId,
      sourceEpoch: supplier.sourceEpoch,
      purpose: 'NORMAL',
      mustChangePassword: false,
      sessionId: session.id,
      rawSessionToken: '',
    };
    context = {
      actorUserId: user.id,
      actorRole: 'SUPPLIER_ADMIN',
      actorSupplierId: supplierId,
      correlationId: randomUUID(),
    };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createSetupTemplate('Asia/Jakarta')) as unknown as ExcelJS.Buffer,
    );
    rows = SETUP_SHEETS.flatMap((spec) => {
      const sheet = workbook.getWorksheet(spec.name)!;
      const result: SetupRow[] = [];
      sheet.eachRow((row, index) => {
        if (index > 1 && row.getCell(1).value)
          result.push({
            sheet: spec.name,
            sourceRow: index,
            data: Object.fromEntries(
              spec.columns.map((column, i) => [column.key, row.getCell(i + 1).text]),
            ),
          });
      });
      return result;
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  const commit = async (inputRows: SetupRow[], decisions: SetupCommit['decisions'] = []) => {
    const preview = await service.preview(principal, inputRows, decisions);
    expect(preview.issues).toEqual([]);
    const body = { rows: inputRows, decisions, revision: preview.revision };
    const key = randomUUID();
    const queued = await service.commit(principal, body, key, context);
    expect(queued.status).toBe('QUEUED');
    expect(await service.commit(principal, body, key, context)).toEqual(queued);
    const credentialRow = inputRows.find((row) => row.data['password']);
    if (credentialRow)
      await expect(
        service.commit(
          principal,
          {
            ...body,
            rows: inputRows.map((row) =>
              row === credentialRow
                ? { ...row, data: { ...row.data, password: `${row.data['password']}-changed` } }
                : row,
            ),
          },
          key,
          context,
        ),
      ).rejects.toMatchObject({ problem: { status: 409 } });
    const persisted = await prisma.setupOperation.findUniqueOrThrow({ where: { id: queued.id } });
    for (const row of inputRows)
      if (row.data['password'])
        expect(JSON.stringify(persisted.payload)).not.toContain(row.data['password']);
    await service.processNext();
    const completed = await service.operation(principal, queued.id);
    expect(completed.error).toBeNull();
    expect(completed.status).toBe('COMPLETED');
    expect(
      (await prisma.setupOperation.findUniqueOrThrow({ where: { id: queued.id } })).payload,
    ).toBeNull();
    return completed;
  };
  it('imports the complete valid template atomically and preserves account credentials securely', async () => {
    const completed = await commit(rows);
    expect(completed.result.reduce((sum, r) => sum + r.created, 0)).toBe(37);
    expect(await prisma.member.count({ where: { supplierId, active: true } })).toBe(10);
    expect(await prisma.lineShift.count({ where: { supplierId, active: true } })).toBe(4);
    expect(
      await prisma.lineShiftJobAssignment.count({
        where: { supplierId, mpMemberId: { not: null } },
      }),
    ).toBe(8);
    const assignmentIds = (
      await prisma.lineShiftJobAssignment.findMany({ where: { supplierId }, select: { id: true } })
    ).map((assignment) => assignment.id);
    const assignmentAudits = await prisma.auditEvent.findMany({
      where: { supplierId, action: 'SETUP_CREATED', resourceType: 'Assignment MP' },
    });
    expect(assignmentAudits).toHaveLength(8);
    expect(assignmentAudits.every((event) => assignmentIds.includes(event.resourceId!))).toBe(true);
    expect(
      await prisma.checklistTemplate.count({
        where: { supplierId, active: true, currentVersionId: { not: null } },
      }),
    ).toBe(4);
    expect(
      await prisma.part.findFirst({ where: { supplierId, partNumber: '001234567890' } }),
    ).not.toBeNull();
    const member = await prisma.member.findFirstOrThrow({
      where: { supplierId, importCode: 'GL-01' },
      include: { users: true },
    });
    originalMemberId = member.id;
    expect(
      await prisma.checklistVersionItem.count({ where: { checklistVersion: { supplierId } } }),
    ).toBe(12);
    expect(member.users[0]!.mustChangePassword).toBe(true);
    expect(
      await app
        .get(PasswordService)
        .verify(member.users[0]!.passwordHash, rows[0]!.data['password']!),
    ).toBe(true);
  });
  it('repeated workbook data creates no duplicates', async () => {
    const preview = await service.preview(principal, rows);
    expect(preview.issues).toEqual([]);
    expect(preview.rows.every((r) => r.status === 'SAME')).toBe(true);
    await commit(rows);
    expect(await prisma.member.count({ where: { supplierId } })).toBe(10);
  });
  it('reviews Update/Skip, keeps omitted data, and retains existing passwords', async () => {
    const changed = [
      {
        ...rows[0]!,
        data: {
          ...rows[0]!.data,
          name: 'Supervisor revised',
          password: 'Do-not-replace-this-password',
        },
      },
    ];
    const preview = await service.preview(principal, changed);
    expect(preview.rows[0]!.status).toBe('CHANGED');
    await commit(changed, [{ key: preview.rows[0]!.key, action: 'SKIP' }]);
    expect(
      (await prisma.member.findUniqueOrThrow({ where: { id: originalMemberId } })).fullName,
    ).toBe('Supervisor contoh');
    await commit(changed, [{ key: preview.rows[0]!.key, action: 'UPDATE' }]);
    const member = await prisma.member.findUniqueOrThrow({
      where: { id: originalMemberId },
      include: { users: true },
    });
    expect(member.fullName).toBe('Supervisor revised');
    expect(
      await app
        .get(PasswordService)
        .verify(member.users[0]!.passwordHash, rows[0]!.data['password']!),
    ).toBe(true);
    expect(await prisma.part.count({ where: { supplierId } })).toBe(3);
  });
  it('rejects invalid references, duplicate active leaders, and stale review revisions', async () => {
    const broken = rows
      .filter((r) => r.sheet === 'Line Shift')
      .map((r) => ({ ...r, data: { ...r.data, leader: 'LL-01' } }));
    expect((await service.preview(principal, broken)).issues.length).toBeGreaterThan(0);
    const invalid = [
      {
        sheet: 'Assignment MP' as const,
        sourceRow: 2,
        data: { line: 'missing', shift: 'PAGI', job: 'JOB-01', mp: 'MP-01' },
      },
    ];
    expect((await service.preview(principal, invalid)).issues.length).toBeGreaterThan(0);
    const preview = await service.preview(principal, rows);
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { setupRevision: { increment: 1 } },
    });
    await expect(
      service.commit(
        principal,
        { rows, decisions: [], revision: preview.revision },
        randomUUID(),
        context,
      ),
    ).rejects.toMatchObject({ problem: { detail: expect.stringContaining('Setup berubah') } });
  });
  it('blocks reset with any Open Henkaten and preserves closed history', async () => {
    const line = await prisma.line.findFirstOrThrow({ where: { supplierId } });
    const job = await prisma.job.findFirstOrThrow({ where: { supplierId } });
    const shift = await prisma.shiftTemplate.findFirstOrThrow({ where: { supplierId } });
    const now = new Date();
    const run = await prisma.shiftRun.create({
      data: {
        supplierId,
        lineId: line.id,
        shiftTemplateId: shift.id,
        businessDate: now,
        scheduledStartAt: now,
        scheduledEndAt: new Date(now.getTime() + 3600000),
        timezoneSnapshot: 'Asia/Jakarta',
        lineCodeSnapshot: line.code,
        lineNameSnapshot: line.name,
        shiftNameSnapshot: shift.name,
        shiftStartMinuteSnapshot: shift.startMinute,
        shiftEndMinuteSnapshot: shift.endMinute,
        defaultAssignmentSetVersion: 1,
        sourceEpoch: principal.sourceEpoch!,
        latestPreflight: {},
        latestPreflightAt: now,
      },
    });
    const record = await prisma.henkaten.create({
      data: {
        supplierId,
        shiftRunId: run.id,
        lineId: line.id,
        jobId: job.id,
        identifier: 'SETUP-HISTORY-1',
        dailySequence: 1,
        sourceMode: 'HOSTED',
        sourceEpoch: principal.sourceEpoch!,
        category: 'MACHINE',
        businessDate: now,
        timezoneSnapshot: 'Asia/Jakarta',
        shiftNameSnapshot: shift.name,
        lineCodeSnapshot: line.code,
        lineNameSnapshot: line.name,
        jobNameSnapshot: job.name,
        partNumberSnapshot: 'OTHER',
        normalizedPartNumberSnapshot: 'other',
        partNameSnapshot: 'Other',
        creatorNameSnapshot: 'History creator',
        cause: 'Test',
        detail: 'Preserve history',
        affectedObject: 'Machine A',
        replacementObject: 'Machine B',
        occurredAt: now,
        submissionKey: randomUUID(),
        submissionPayloadHash: 'a'.repeat(64),
        createdById: principal.userId,
      },
    });
    const preview = await service.resetPreview(principal);
    expect(preview.openCount).toBe(1);
    await expect(
      service.reset(principal, { revision: preview.revision, password }, randomUUID(), context),
    ).rejects.toMatchObject({ problem: { detail: expect.stringContaining('Henkaten Open') } });
    expect(await prisma.member.count({ where: { supplierId, active: true } })).toBe(10);
    await prisma.henkaten.update({
      where: { id: record.id },
      data: { status: 'APPROVED', finalizedAt: new Date() },
    });
  });
  it('reset requires the admin password, archives setup and restores identities through review', async () => {
    const preview = await service.resetPreview(principal);
    await expect(
      service.reset(
        principal,
        { revision: preview.revision, password: 'wrong-password' },
        randomUUID(),
        context,
      ),
    ).rejects.toThrow();
    expect(await prisma.member.count({ where: { supplierId, active: true } })).toBe(10);
    const receipt = await service.reset(
      principal,
      { revision: preview.revision, password },
      randomUUID(),
      context,
    );
    expect(receipt.status).toBe('COMPLETED');
    expect(
      await prisma.henkaten.count({
        where: { supplierId, status: 'APPROVED', detail: 'Preserve history' },
      }),
    ).toBe(1);
    expect(await prisma.member.count({ where: { supplierId, active: true } })).toBe(0);
    expect(
      await prisma.member.count({ where: { supplierId, resetArchivedAt: { not: null } } }),
    ).toBe(10);
    expect(await prisma.checklistVersion.count({ where: { supplierId } })).toBe(4);
    expect(
      await prisma.checklistTemplate.count({
        where: { supplierId, currentVersionId: { not: null } },
      }),
    ).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: principal.userId } })).status).toBe(
      'ACTIVE',
    );
    expect(
      await prisma.user.count({
        where: { supplierId, role: { not: 'SUPPLIER_ADMIN' }, status: 'ACTIVE' },
      }),
    ).toBe(0);
    const restore = await service.preview(principal, rows);
    expect(restore.issues).toEqual([]);
    expect(restore.rows.every((r) => r.status === 'INACTIVE')).toBe(true);
    await commit(
      rows,
      restore.rows.map((r) => ({ key: r.key, action: 'RESTORE' })),
    );
    expect(
      (await prisma.member.findFirstOrThrow({ where: { supplierId, importCode: 'GL-01' } })).id,
    ).toBe(originalMemberId);
    expect(await prisma.checklistVersion.count({ where: { supplierId } })).toBe(8);
  });
  it('a queued operation cannot execute after its session is revoked', async () => {
    const added: SetupRow[] = [
      { sheet: 'Part', sourceRow: 2, data: { code: 'REVOKED', name: 'Never imported' } },
    ];
    const preview = await service.preview(principal, added);
    const queued = await service.commit(
      principal,
      { rows: added, decisions: [], revision: preview.revision },
      randomUUID(),
      context,
    );
    await prisma.userSession.update({
      where: { id: principal.sessionId },
      data: { revokedAt: new Date(), revocationReason: 'LOGOUT' },
    });
    await service.processNext();
    expect(
      (await prisma.setupOperation.findUniqueOrThrow({ where: { id: queued.id } })).status,
    ).toBe('FAILED');
    expect(await prisma.part.count({ where: { supplierId, partNumber: 'REVOKED' } })).toBe(0);
  });
});
