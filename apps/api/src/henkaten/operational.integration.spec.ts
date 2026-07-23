import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { HenkatenCategory } from '../generated/prisma/client.js';
import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { SourceGovernanceService } from '../administration/source-governance.service.js';

const supplierOrigin = 'http://localhost:5173';
const tmminOrigin = 'http://localhost:5174';
const password = 'Operational-Integration-Password-123';
const businessDate = '2026-07-23';

type ShiftBody = {
  id: string;
  version: number;
  status: string;
  checks: Array<{ code: string }>;
  lineLeader: { memberId: string };
  startedWithOverride: boolean;
  workingAssignments: Array<{ id: string; jobId: string; version: number }>;
};

type HenkatenSummaryBody = {
  id?: string;
  identifier: string;
  part: { number: string };
};

type HenkatenPageBody = {
  items: Array<{ id: string; category: string }>;
  pageInfo: { hasNextPage: boolean; nextCursor: string | null };
};

type AffectedPartBody = {
  items: Array<{ supplierId: string; partNumber: string; openWarningCount: number }>;
};

describe('Hosted shift and Henkaten core', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let supplierCode: string;
  let adminUserId: string;
  let leaderUserId: string;
  let leaderId: string;
  let substituteLeaderId: string;
  let supervisorId: string;
  let mp1Id: string;
  let mp2Id: string;
  let replacementMpId: string;
  let lineId: string;
  let job1Id: string;
  let job2Id: string;
  let partId: string;
  let shiftTemplateId: string;
  let shiftRunId: string;
  let targetWorkingAssignmentId: string;
  let targetWorkingAssignmentVersion: number;
  let machineHenkatenId: string;
  let manHenkatenId: string;
  let adminCookie: string[];
  let adminCsrf: string;
  let leaderCookie: string[];
  let leaderCsrf: string;
  let tmminCookie: string[];
  const checklists = new Map<HenkatenCategory, { versionId: string; itemId: string }>();

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
    const passwordHash = await app.get(PasswordService).hash(password);

    supplierCode = `OPS-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code: supplierCode,
        normalizedCode: supplierCode.toLowerCase(),
        name: 'Operational Integration Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    supplierId = supplier.id;

    const adminUsername = `ops-admin-${randomUUID()}`;
    const admin = await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        role: 'SUPPLIER_ADMIN',
        username: adminUsername,
        normalizedUsername: adminUsername.toLowerCase(),
        displayName: 'Operational Supplier Admin',
        passwordHash,
        mustChangePassword: false,
      },
    });
    adminUserId = admin.id;

    const supervisor = await createMemberWithUser(
      'SUPERVISOR',
      'Operational Supervisor',
      `ops-supervisor-${randomUUID()}`,
      passwordHash,
    );
    supervisorId = supervisor.memberId;
    const leader = await createMemberWithUser(
      'LINE_LEADER',
      'Operational Line Leader',
      `ops-leader-${randomUUID()}`,
      passwordHash,
    );
    leaderId = leader.memberId;
    leaderUserId = leader.userId;
    const substitute = await createMemberWithUser(
      'LINE_LEADER',
      'Operational Substitute Leader',
      `ops-substitute-${randomUUID()}`,
      passwordHash,
    );
    substituteLeaderId = substitute.memberId;

    mp1Id = await createMp('Operational MP One');
    mp2Id = await createMp('Operational MP Two');
    replacementMpId = await createMp('Operational Replacement MP');

    const line = await prisma.line.create({
      data: {
        supplierId,
        code: `LINE-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Operational Assembly',
        displayOrder: 1,
      },
    });
    lineId = line.id;
    const [job1, job2, part, template] = await Promise.all([
      prisma.job.create({
        data: {
          supplierId,
          lineId,
          name: 'Operational Job One',
          normalizedName: `job-one-${randomUUID()}`,
          displayOrder: 1,
        },
      }),
      prisma.job.create({
        data: {
          supplierId,
          lineId,
          name: 'Operational Job Two',
          normalizedName: `job-two-${randomUUID()}`,
          displayOrder: 2,
        },
      }),
      prisma.part.create({
        data: {
          supplierId,
          partNumber: `PART-${randomUUID()}`,
          normalizedPartNumber: randomUUID(),
          partName: 'Operational Part',
          normalizedPartName: `operational-part-${randomUUID()}`,
        },
      }),
      prisma.shiftTemplate.create({
        data: {
          supplierId,
          name: 'Operational Night Shift',
          displayOrder: 1,
          startMinute: 22 * 60,
          endMinute: 6 * 60,
          timezone: 'Asia/Jakarta',
        },
      }),
    ]);
    job1Id = job1.id;
    job2Id = job2.id;
    partId = part.id;
    shiftTemplateId = template.id;

    await prisma.defaultAssignmentSet.create({ data: { supplierId } });
    await Promise.all([
      prisma.defaultLineSupervisor.create({
        data: { supplierId, lineId, supervisorMemberId: supervisorId },
      }),
      prisma.defaultLineLeader.create({
        data: { supplierId, lineId, lineLeaderMemberId: leaderId },
      }),
      prisma.defaultJobMp.create({
        data: { supplierId, jobId: job1Id, mpMemberId: mp1Id },
      }),
      prisma.defaultJobMp.create({
        data: { supplierId, jobId: job2Id, mpMemberId: mp2Id },
      }),
    ]);

    for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const) {
      const templateRow = await prisma.checklistTemplate.create({
        data: { supplierId, category },
      });
      const version = await prisma.checklistVersion.create({
        data: {
          supplierId,
          templateId: templateRow.id,
          category,
          versionNumber: 1,
          publishedById: adminUserId,
          items: {
            create: {
              label: `${category} condition accepted`,
              displayOrder: 1,
            },
          },
        },
        include: { items: true },
      });
      checklists.set(category, {
        versionId: version.id,
        itemId: version.items[0]!.id,
      });
    }

    const qualityUsername = `ops-quality-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        username: qualityUsername,
        normalizedUsername: qualityUsername.toLowerCase(),
        displayName: 'Operational TMMIN Quality',
        passwordHash,
        mustChangePassword: false,
      },
    });

    ({ cookie: adminCookie, csrf: adminCsrf } = await supplierLogin(adminUsername));
    ({ cookie: leaderCookie, csrf: leaderCsrf } = await supplierLogin(leader.username));
    const qualityLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ username: qualityUsername, password });
    expect(qualityLogin.status).toBe(200);
    tmminCookie = cookieHeader(qualityLogin.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates one durable slot under concurrent preflight and starts atomically once', async () => {
    const input = { lineId, shiftTemplateId, businessDate };
    const plans = await Promise.all([
      leaderPost('/api/v1/supplier/shifts/preflight', input),
      leaderPost('/api/v1/supplier/shifts/preflight', input),
    ]);
    const planBodies = plans.map((response) => responseBody<ShiftBody>(response));
    expect(plans.every(({ status }) => status === 201)).toBe(true);
    expect(new Set(planBodies.map(({ id }) => id)).size).toBe(1);
    shiftRunId = planBodies[0]!.id;
    await expect(
      prisma.shiftRun.count({ where: { supplierId, lineId, shiftTemplateId } }),
    ).resolves.toBe(1);

    const expectedVersion = Math.max(...planBodies.map(({ version }) => version));
    const starts = await Promise.all([
      leaderPost(`/api/v1/supplier/shifts/${shiftRunId}/start`, { expectedVersion }),
      leaderPost(`/api/v1/supplier/shifts/${shiftRunId}/start`, { expectedVersion }),
    ]);
    expect(starts.map(({ status }) => status).sort()).toEqual([201, 409]);
    const started = starts.find(({ status }) => status === 201)!;
    const startedBody = responseBody<ShiftBody>(started);
    expect(startedBody.status).toBe('ACTIVE');
    expect(startedBody.workingAssignments).toHaveLength(2);
    const target = startedBody.workingAssignments.find(
      (assignment) => assignment.jobId === job1Id,
    )!;
    targetWorkingAssignmentId = target.id;
    targetWorkingAssignmentVersion = target.version;
    await expect(
      prisma.auditEvent.count({
        where: { supplierId, action: 'SHIFT_STARTED' },
      }),
    ).resolves.toBe(1);
  });

  it('enforces all-YES evidence and idempotent immutable 4M submission', async () => {
    const checklist = checklists.get('MACHINE')!;
    const payload = machinePayload(checklist);
    const submitted = await leaderPost('/api/v1/supplier/henkatens', payload, 'machine-one');
    expect(submitted.status).toBe(201);
    expect(submitted.body.identifier).toMatch(new RegExp(`^HEN-${supplierCode}-20260723-\\d{4}$`));
    machineHenkatenId = submitted.body.id as string;

    const retry = await leaderPost('/api/v1/supplier/henkatens', payload, 'machine-one');
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(machineHenkatenId);
    const conflict = await leaderPost(
      '/api/v1/supplier/henkatens',
      { ...payload, cause: 'Different request body' },
      'machine-one',
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const rejected = await leaderPost(
      '/api/v1/supplier/henkatens',
      {
        ...payload,
        checklistAnswers: [{ itemId: checklist.itemId, answer: 'NO' }],
      },
      'machine-no',
    );
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('CHECKLIST_NOT_PUBLISHED');
  });

  it('allocates identifiers concurrently and preserves affected state while any warning is Open', async () => {
    const checklist = checklists.get('MATERIAL')!;
    const methodChecklist = checklists.get('METHOD')!;
    const submissions = await Promise.all([
      leaderPost('/api/v1/supplier/henkatens', materialPayload(checklist, 'A'), 'material-a'),
      leaderPost('/api/v1/supplier/henkatens', materialPayload(checklist, 'B'), 'material-b'),
      leaderPost('/api/v1/supplier/henkatens', methodPayload(methodChecklist), 'method-b'),
    ]);
    const submissionBodies = submissions.map((response) =>
      responseBody<HenkatenSummaryBody>(response),
    );
    expect(submissions.every(({ status }) => status === 201)).toBe(true);
    expect(new Set(submissionBodies.map(({ identifier }) => identifier)).size).toBe(3);

    const affected = await request(app.getHttpServer())
      .get('/api/v1/tmmin/warnings/affected-parts')
      .set('Cookie', tmminCookie);
    expect(affected.status).toBe(200);
    const group = responseBody<AffectedPartBody>(affected).items.find(
      (item) =>
        item.supplierId === supplierId && item.partNumber === submissionBodies[0]!.part.number,
    )!;
    expect(group.openWarningCount).toBeGreaterThanOrEqual(3);

    const withdrawn = await leaderPost(`/api/v1/supplier/henkatens/${machineHenkatenId}/withdraw`, {
      expectedVersion: 1,
      reason: 'Submitted as a duplicate during verification.',
    });
    expect(withdrawn.status).toBe(201);
    expect(withdrawn.body.status).toBe('CANCELLED');
    const remaining = await request(app.getHttpServer())
      .get('/api/v1/tmmin/warnings/affected-parts')
      .set('Cookie', tmminCookie);
    const remainingGroup = responseBody<AffectedPartBody>(remaining).items.find(
      (item) => item.supplierId === supplierId,
    )!;
    expect(remainingGroup.openWarningCount).toBeGreaterThanOrEqual(2);
    const detail = await request(app.getHttpServer())
      .get(
        `/api/v1/tmmin/warnings/affected-parts/${supplierId}/${encodeURIComponent(
          remainingGroup.partNumber,
        )}`,
      )
      .set('Cookie', tmminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.warnings).toHaveLength(remainingGroup.openWarningCount);
  });

  it('keeps filtered keyset pages stable when a newer matching Henkaten is inserted', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/supplier/henkatens')
      .query({
        limit: 1,
        status: 'OPEN',
        category: 'MATERIAL',
        lineId,
        shiftRunId,
      })
      .set('Cookie', leaderCookie);
    expect(first.status).toBe(200);
    const firstBody = responseBody<HenkatenPageBody>(first);
    expect(firstBody.pageInfo.hasNextPage).toBe(true);
    expect(firstBody.items).toHaveLength(1);

    const checklist = checklists.get('MATERIAL')!;
    const inserted = await leaderPost(
      '/api/v1/supplier/henkatens',
      materialPayload(checklist, 'C'),
      'material-c',
    );
    expect(inserted.status).toBe(201);

    const second = await request(app.getHttpServer())
      .get('/api/v1/supplier/henkatens')
      .query({
        limit: 1,
        status: 'OPEN',
        category: 'MATERIAL',
        lineId,
        shiftRunId,
        cursor: firstBody.pageInfo.nextCursor,
      })
      .set('Cookie', leaderCookie);
    expect(second.status).toBe(200);
    const secondBody = responseBody<HenkatenPageBody>(second);
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]!.id).not.toBe(firstBody.items[0]!.id);
  });

  it('reserves Man replacement/target atomically and releases only its reservation on withdraw', async () => {
    const checklist = checklists.get('MAN')!;
    const payload = {
      category: 'MAN',
      shiftRunId,
      jobId: job1Id,
      partId,
      checklistVersionId: checklist.versionId,
      checklistAnswers: [{ itemId: checklist.itemId, answer: 'YES' }],
      cause: 'Temporary operator rotation',
      detail: 'Reserve a qualified replacement pending approval.',
      targetWorkingAssignmentId,
      targetAssignmentVersion: targetWorkingAssignmentVersion,
      replaced: { kind: 'MP', memberId: mp1Id },
      replacementMpMemberId: replacementMpId,
    };
    const created = await leaderPost('/api/v1/supplier/henkatens', payload, 'man-one');
    expect(created.status).toBe(201);
    manHenkatenId = created.body.id as string;
    expect(created.body.man.reservationActive).toBe(true);

    const conflicting = await leaderPost('/api/v1/supplier/henkatens', payload, 'man-conflict');
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe('RESERVATION_CONFLICT');
    await expect(
      prisma.workingAssignment.findUniqueOrThrow({
        where: { id: targetWorkingAssignmentId },
        select: { effectiveMpMemberId: true },
      }),
    ).resolves.toEqual({ effectiveMpMemberId: mp1Id });

    const withdrawn = await leaderPost(`/api/v1/supplier/henkatens/${manHenkatenId}/withdraw`, {
      expectedVersion: 1,
      reason: 'The planned replacement is no longer required.',
    });
    expect(withdrawn.status).toBe(201);
    expect(withdrawn.body.man.reservationActive).toBe(false);
    await expect(
      prisma.mPReservation.count({
        where: { henkatenId: manHenkatenId, releasedAt: null },
      }),
    ).resolves.toBe(0);
  });

  it('rejects evidence/context mutation and enforces role, source-purpose, and TMMIN read boundaries', async () => {
    const snapshot = await prisma.henkatenChecklistSnapshot.findUniqueOrThrow({
      where: { henkatenId: manHenkatenId },
      include: { answers: true },
    });
    await expect(
      prisma.henkatenChecklistAnswer.update({
        where: { id: snapshot.answers[0]!.id },
        data: { labelSnapshot: 'Tampered evidence' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.henkaten.update({
        where: { id: manHenkatenId },
        data: { withdrawalReason: 'Tampered terminal record' },
      }),
    ).rejects.toThrow();

    const adminDenied = await adminPost(
      '/api/v1/supplier/henkatens',
      machinePayload(checklists.get('MACHINE')!),
      'admin-denied',
    );
    expect(adminDenied.status).toBe(403);

    await prisma.userSession.updateMany({
      where: { userId: leaderUserId, revokedAt: null },
      data: { purpose: 'HOSTED_PREPARATION' },
    });
    try {
      const preparationDenied = await leaderPost(
        '/api/v1/supplier/henkatens',
        machinePayload(checklists.get('MACHINE')!),
        'preparation-denied',
      );
      expect(preparationDenied.status).toBe(409);
      expect(preparationDenied.body.code).toBe('SOURCE_MODE_MISMATCH');
    } finally {
      await prisma.userSession.updateMany({
        where: { userId: leaderUserId, revokedAt: null },
        data: { purpose: 'NORMAL' },
      });
    }

    const tmminRead = await request(app.getHttpServer())
      .get(`/api/v1/tmmin/suppliers/${supplierId}/henkatens/${manHenkatenId}`)
      .set('Cookie', tmminCookie);
    expect(tmminRead.status).toBe(200);
    const crossTenantHidden = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/${randomUUID()}`)
      .set('Cookie', leaderCookie);
    expect(crossTenantHidden.status).toBe(404);
  });

  it('creates auditable vacancy issues for an emergency start with a substitute LL', async () => {
    const line = await prisma.line.create({
      data: {
        supplierId,
        code: `EMERGENCY-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Emergency Assembly',
        displayOrder: 2,
      },
    });
    const job = await prisma.job.create({
      data: {
        supplierId,
        lineId: line.id,
        name: 'Emergency Vacant Job',
        normalizedName: randomUUID(),
        displayOrder: 1,
      },
    });
    await prisma.defaultLineSupervisor.create({
      data: { supplierId, lineId: line.id, supervisorMemberId: supervisorId },
    });
    const plan = await adminPost('/api/v1/supplier/shifts/preflight', {
      lineId: line.id,
      shiftTemplateId,
      businessDate,
    });
    const planBody = responseBody<ShiftBody>(plan);
    expect(plan.status).toBe(201);
    expect(planBody.checks.some((check) => check.code === 'REQUIRED_JOB_VACANT')).toBe(true);

    const started = await adminPost(`/api/v1/supplier/shifts/${planBody.id}/emergency-start`, {
      expectedVersion: planBody.version,
      reason: 'Production continuity requires a controlled emergency start.',
      substituteLineLeaderMemberId: substituteLeaderId,
    });
    expect(started.status).toBe(201);
    expect(started.body.startedWithOverride).toBe(true);
    expect(started.body.lineLeader.memberId).toBe(substituteLeaderId);
    const persistedOverride = await prisma.shiftRun.findUniqueOrThrow({
      where: { id: planBody.id },
      select: { overrideFailedChecks: true },
    });
    expect(JSON.stringify(persistedOverride.overrideFailedChecks)).toContain('LINE_LEADER_MISSING');
    const issue = await prisma.assignmentIssue.findFirstOrThrow({
      where: { supplierId, jobId: job.id, status: 'OPEN' },
    });
    expect(issue.type).toBe('VACANCY');
    expect(issue.originKind).toBe('EMERGENCY_SHIFT_START');
  });

  it('keeps active snapshots stable and blocks deactivation/cutover while operations exist', async () => {
    await prisma.defaultJobMp.update({
      where: { jobId_supplierId: { jobId: job1Id, supplierId } },
      data: { mpMemberId: replacementMpId, version: { increment: 1 } },
    });
    await prisma.defaultAssignmentSet.update({
      where: { supplierId },
      data: { version: { increment: 1 } },
    });
    await expect(
      prisma.workingAssignment.findUniqueOrThrow({
        where: { id: targetWorkingAssignmentId },
        select: { effectiveMpMemberId: true, version: true },
      }),
    ).resolves.toEqual({
      effectiveMpMemberId: mp1Id,
      version: targetWorkingAssignmentVersion,
    });

    const part = await prisma.part.findUniqueOrThrow({ where: { id: partId } });
    const deactivation = await adminPost(
      `/api/v1/supplier/master-data/parts/${partId}/deactivate`,
      { expectedVersion: part.version },
    );
    expect(deactivation.status).toBe(409);
    expect(deactivation.body.code).toBe('RESOURCE_IN_USE');

    const cutover = await app.get(SourceGovernanceService).preflight(supplierId, 'EXTERNAL');
    expect(
      cutover.blockers.some(({ contributor }) => contributor === 'hosted-operational-state'),
    ).toBe(true);
  });

  it('recomputes commit checks and preserves a blocked-start audit for stale plans', async () => {
    const newLeader = await createMemberWithUser(
      'LINE_LEADER',
      'Stale Plan Line Leader',
      `ops-stale-leader-${randomUUID()}`,
      await app.get(PasswordService).hash(password),
    );
    const newMp = await createMp('Stale Plan MP');
    const line = await prisma.line.create({
      data: {
        supplierId,
        code: `STALE-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Stale Plan Assembly',
        displayOrder: 3,
      },
    });
    const job = await prisma.job.create({
      data: {
        supplierId,
        lineId: line.id,
        name: 'Stale Plan Job',
        normalizedName: randomUUID(),
        displayOrder: 1,
      },
    });
    await Promise.all([
      prisma.defaultLineSupervisor.create({
        data: { supplierId, lineId: line.id, supervisorMemberId: supervisorId },
      }),
      prisma.defaultLineLeader.create({
        data: {
          supplierId,
          lineId: line.id,
          lineLeaderMemberId: newLeader.memberId,
        },
      }),
      prisma.defaultJobMp.create({
        data: { supplierId, jobId: job.id, mpMemberId: newMp },
      }),
    ]);
    const login = await supplierLogin(newLeader.username);
    const postAsNewLeader = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', supplierOrigin)
        .set('Cookie', login.cookie)
        .set('X-CSRF-Token', login.csrf)
        .send(body);
    const plan = await postAsNewLeader('/api/v1/supplier/shifts/preflight', {
      lineId: line.id,
      shiftTemplateId,
      businessDate,
    });
    expect(plan.status).toBe(201);

    await prisma.defaultAssignmentSet.update({
      where: { supplierId },
      data: { version: { increment: 1 } },
    });
    const blocked = await postAsNewLeader(`/api/v1/supplier/shifts/${plan.body.id}/start`, {
      expectedVersion: plan.body.version,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('STATE_CONFLICT');
    await expect(
      prisma.auditEvent.count({
        where: {
          supplierId,
          resourceId: plan.body.id,
          action: 'SHIFT_START_BLOCKED',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.shiftRun.findUniqueOrThrow({
        where: { id: plan.body.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'NOT_STARTED' });
  });

  function machinePayload(checklist: { versionId: string; itemId: string }) {
    return {
      category: 'MACHINE',
      shiftRunId,
      jobId: job1Id,
      partId,
      checklistVersionId: checklist.versionId,
      checklistAnswers: [{ itemId: checklist.itemId, answer: 'YES' }],
      cause: 'Machine tooling change',
      detail: 'Tooling configuration changed for the current production run.',
      affectedObject: 'Previous tooling configuration',
      replacementObject: 'Qualified replacement tooling',
    };
  }

  function materialPayload(checklist: { versionId: string; itemId: string }, suffix: string) {
    return {
      category: 'MATERIAL',
      shiftRunId,
      jobId: job2Id,
      partId,
      checklistVersionId: checklist.versionId,
      checklistAnswers: [{ itemId: checklist.itemId, answer: 'YES' }],
      cause: `Material lot change ${suffix}`,
      detail: `Material lot ${suffix} introduced with full traceability.`,
      affectedObject: `Previous material lot ${suffix}`,
      replacementObject: `Replacement material lot ${suffix}`,
    };
  }

  function methodPayload(checklist: { versionId: string; itemId: string }) {
    return {
      category: 'METHOD',
      shiftRunId,
      jobId: job2Id,
      partId,
      checklistVersionId: checklist.versionId,
      checklistAnswers: [{ itemId: checklist.itemId, answer: 'YES' }],
      cause: 'Standard work method update',
      detail: 'The controlled work sequence changed for this production run.',
      affectedObject: 'Previous standard work sequence',
      replacementObject: 'Qualified replacement work sequence',
    };
  }

  async function createMemberWithUser(
    role: 'SUPERVISOR' | 'LINE_LEADER',
    fullName: string,
    username: string,
    passwordHash: string,
  ) {
    const member = await prisma.member.create({
      data: {
        supplierId,
        fullName,
        registrationNumber: `REG-${randomUUID()}`,
        normalizedRegistrationNumber: randomUUID(),
        role,
      },
    });
    const user = await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        memberId: member.id,
        role,
        username,
        normalizedUsername: username.toLowerCase(),
        displayName: fullName,
        passwordHash,
        mustChangePassword: false,
      },
    });
    return { memberId: member.id, userId: user.id, username };
  }

  async function createMp(fullName: string) {
    return (
      await prisma.member.create({
        data: {
          supplierId,
          fullName,
          registrationNumber: `REG-${randomUUID()}`,
          normalizedRegistrationNumber: randomUUID(),
          role: 'MP',
        },
      })
    ).id;
  }

  async function supplierLogin(username: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/supplier/login')
      .set('Origin', supplierOrigin)
      .send({ supplierCode, username, password });
    expect(response.status).toBe(200);
    return {
      cookie: cookieHeader(response.headers['set-cookie']),
      csrf: response.body.csrfToken as string,
    };
  }

  function leaderPost(path: string, body: unknown, idempotencyKey?: string) {
    const call = request(app.getHttpServer())
      .post(path)
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf);
    if (idempotencyKey) call.set('Idempotency-Key', idempotencyKey);
    return call.send(body as object);
  }

  function adminPost(path: string, body: unknown, idempotencyKey?: string) {
    const call = request(app.getHttpServer())
      .post(path)
      .set('Origin', supplierOrigin)
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf);
    if (idempotencyKey) call.set('Idempotency-Key', idempotencyKey);
    return call.send(body as object);
  }

  function cookieHeader(value: string | string[] | undefined): string[] {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  function responseBody<T>(response: { body: unknown }): T {
    return response.body as T;
  }
});
