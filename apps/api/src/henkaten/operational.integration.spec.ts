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
import { OutboxService } from '../persistence/outbox.service.js';
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
  let supervisorUsername: string;
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
  let supervisorCookie: string[];
  let supervisorCsrf: string;
  let qcCookie: string[];
  let qcCsrf: string;
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
    supervisorUsername = supervisor.username;
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
    const qc = await createMemberWithUser(
      'QC',
      'Operational QC',
      `ops-qc-${randomUUID()}`,
      passwordHash,
    );

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
    ({ cookie: supervisorCookie, csrf: supervisorCsrf } = await supplierLogin(supervisorUsername));
    ({ cookie: qcCookie, csrf: qcCsrf } = await supplierLogin(qc.username));
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

  it('serves submit-scoped current checklist, part search, and replacement movement context', async () => {
    const options = await request(app.getHttpServer())
      .get('/api/v1/supplier/henkatens/form-options?category=MAN&part=Operational')
      .set('Cookie', leaderCookie);
    expect(options.status).toBe(200);
    const body = responseBody<{
      checklist: { id: string; items: unknown[] } | null;
      parts: Array<{ id: string }>;
      replacementMembers: Array<{
        id: string;
        reserved: boolean;
        currentAssignment: { id: string; version: number } | null;
      }>;
    }>(options);
    expect(body.checklist?.id).toBe(checklists.get('MAN')!.versionId);
    expect(body.checklist?.items).toHaveLength(1);
    expect(body.parts.some((part) => part.id === partId)).toBe(true);
    expect(body.replacementMembers.some((member) => member.id === replacementMpId)).toBe(true);
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

  it('lists multiple Shift Runs without passing the array index as presenter data', async () => {
    const secondBusinessDate = '2026-07-24';
    const secondPlan = await adminPost('/api/v1/supplier/shifts/preflight', {
      lineId,
      shiftTemplateId,
      businessDate: secondBusinessDate,
    });
    expect(secondPlan.status).toBe(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/supplier/shifts?limit=25')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(responseBody<{ items: unknown[] }>(response).items).toHaveLength(2);
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
      expect(preparationDenied.status).toBe(403);
      expect(preparationDenied.body.code).toBe('FORBIDDEN');
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

  it('persists parallel approval evidence, exact retries, and reject-fast release', async () => {
    const approvedSubmission = await leaderPost(
      '/api/v1/supplier/henkatens',
      machinePayload(checklists.get('MACHINE')!),
      'phase7-machine-approve',
    );
    expect(approvedSubmission.status).toBe(201);
    const henkatenId = approvedSubmission.body.id as string;
    const supervisorDecision = {
      expectedVersion: 1,
      decision: 'APPROVED',
      comment: 'Supervisor conditions accepted.',
    };
    const first = await supplierRolePost(
      supervisorCookie,
      supervisorCsrf,
      `/api/v1/supplier/henkatens/${henkatenId}/decisions`,
      supervisorDecision,
      'phase7-supervisor-decision',
    );
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('OPEN');
    expect(first.body.routes.supervisor.status).toBe('APPROVED');
    expect(first.body.routes.qc.status).toBe('PENDING');
    const retry = await supplierRolePost(
      supervisorCookie,
      supervisorCsrf,
      `/api/v1/supplier/henkatens/${henkatenId}/decisions`,
      supervisorDecision,
      'phase7-supervisor-decision',
    );
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(henkatenId);
    const final = await supplierRolePost(
      qcCookie,
      qcCsrf,
      `/api/v1/supplier/henkatens/${henkatenId}/decisions`,
      { expectedVersion: 2, decision: 'APPROVED' },
      'phase7-qc-decision',
    );
    expect(final.status).toBe(201);
    expect(final.body.status).toBe('APPROVED');
    expect(final.body.routes.qc.decision.actorRole).toBe('QC');
    await expect(
      prisma.warningInstance.findUniqueOrThrow({
        where: { henkatenId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'CLOSED' });

    const target = await prisma.workingAssignment.findUniqueOrThrow({
      where: { id: targetWorkingAssignmentId },
    });
    const rejectedSubmission = await leaderPost(
      '/api/v1/supplier/henkatens',
      {
        category: 'MAN',
        shiftRunId,
        jobId: job1Id,
        partId,
        checklistVersionId: checklists.get('MAN')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('MAN')!.itemId, answer: 'YES' }],
        cause: 'Rejected operator rotation',
        detail: 'Exercise reject-fast reservation release.',
        targetWorkingAssignmentId,
        targetAssignmentVersion: target.version,
        replaced: { kind: 'MP', memberId: target.effectiveMpMemberId },
        replacementMpMemberId: replacementMpId,
      },
      'phase7-man-reject',
    );
    expect(rejectedSubmission.status).toBe(201);
    const rejected = await supplierRolePost(
      qcCookie,
      qcCsrf,
      `/api/v1/supplier/henkatens/${rejectedSubmission.body.id as string}/decisions`,
      { expectedVersion: 1, decision: 'REJECTED', comment: 'QC rejected the change.' },
      'phase7-qc-reject',
    );
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.routes.supervisor.status).toBe('NOT_REQUIRED');
    expect(rejected.body.man.reservationActive).toBe(false);
    await expect(
      prisma.workingAssignment.findUniqueOrThrow({
        where: { id: targetWorkingAssignmentId },
        select: { effectiveMpMemberId: true },
      }),
    ).resolves.toEqual({ effectiveMpMemberId: target.effectiveMpMemberId });
  });

  it('serves durable notifications, scoped board/dashboard, and redacted audit reads', async () => {
    await app.get(OutboxService).processBatch();

    const session = await request(app.getHttpServer())
      .get('/api/v1/auth/supplier/session')
      .set('Cookie', adminCookie);
    expect(session.status).toBe(200);
    expect(session.body.capabilities).toContain('SUPPLIER_DASHBOARD_READ');
    expect(session.body.supplier).toMatchObject({
      id: supplierId,
      code: supplierCode,
      timezone: 'Asia/Jakarta',
      sourceMode: 'HOSTED',
      sourceEpoch: 1,
    });

    const readiness = await request(app.getHttpServer())
      .get('/api/v1/supplier/setup-readiness')
      .set('Cookie', adminCookie);
    expect(readiness.status).toBe(200);
    expect(readiness.body.areas).toHaveLength(6);
    expect(readiness.body).toHaveProperty('nextArea');

    const supervisorNotifications = await request(app.getHttpServer())
      .get('/api/v1/supplier/notifications')
      .set('Cookie', supervisorCookie);
    expect(supervisorNotifications.status).toBe(200);
    expect(supervisorNotifications.body.items.length).toBeGreaterThan(0);
    const notification = supervisorNotifications.body.items[0] as {
      id: string;
      version: number;
    };
    const read = await request(app.getHttpServer())
      .patch(`/api/v1/supplier/notifications/${notification.id}/read-state`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supervisorCookie)
      .set('X-CSRF-Token', supervisorCsrf)
      .send({ read: true, expectedVersion: notification.version });
    expect(read.status).toBe(200);
    expect(read.body.readAt).toBeTypeOf('string');

    await prisma.memberPhoto.create({
      data: {
        supplierId,
        memberId: mp1Id,
        fullPath: `/tmp/${mp1Id}/full.webp`,
        thumbnailPath: `/tmp/${mp1Id}/thumbnail.webp`,
        fullChecksum: 'a'.repeat(64),
        thumbnailChecksum: 'b'.repeat(64),
        fullWidth: 64,
        fullHeight: 64,
        thumbnailWidth: 64,
        thumbnailHeight: 64,
        version: 7,
      },
    });

    const board = await request(app.getHttpServer())
      .get('/api/v1/supplier/assignment-board')
      .set('Cookie', adminCookie);
    expect(board.status).toBe(200);
    const boardBody = responseBody<{
      lines: Array<{
        lineId: string;
        activeOverride: unknown;
        jobs: Array<{
          indicators: unknown[];
          mp: {
            memberId: string | null;
            photoThumbnailUrl: string | null;
            initials: string | null;
          };
        }>;
      }>;
    }>(board);
    expect(boardBody.lines.some((line) => line.lineId === lineId)).toBe(true);
    const mainLine = boardBody.lines.find((line) => line.lineId === lineId)!;
    expect(mainLine).toHaveProperty('activeOverride');
    expect(mainLine.jobs).toHaveLength(2);
    expect(mainLine.jobs.some((job) => job.indicators.length > 0)).toBe(true);
    expect(mainLine.jobs.find((job) => job.mp.memberId === mp1Id)?.mp.photoThumbnailUrl).toBe(
      `/api/v1/supplier/master-data/members/${mp1Id}/photo/thumbnail?v=7`,
    );
    expect(
      mainLine.jobs.some((job) => job.mp.memberId !== mp1Id && job.mp.photoThumbnailUrl === null),
    ).toBe(true);

    const generatedLayout = await request(app.getHttpServer())
      .get(`/api/v1/supplier/assignment-board/layouts/${lineId}`)
      .set('Cookie', adminCookie);
    expect(generatedLayout.status).toBe(200);
    expect(generatedLayout.body).toMatchObject({
      lineId,
      source: 'GENERATED',
      version: null,
      canEdit: true,
      reconciliation: { addedJobIds: [], removedJobIds: [] },
    });
    expect(
      (generatedLayout.body.document.nodes as Array<{ type: string }>).filter(
        (node) => node.type === 'JOB_SLOT',
      ),
    ).toHaveLength(2);

    const leaderLayout = await request(app.getHttpServer())
      .get(`/api/v1/supplier/assignment-board/layouts/${lineId}`)
      .set('Cookie', leaderCookie);
    expect(leaderLayout.status).toBe(200);
    expect(leaderLayout.body.canEdit).toBe(true);
    const supervisorLayout = await request(app.getHttpServer())
      .get(`/api/v1/supplier/assignment-board/layouts/${lineId}`)
      .set('Cookie', supervisorCookie);
    expect(supervisorLayout.status).toBe(200);
    expect(supervisorLayout.body.canEdit).toBe(false);

    const document = generatedLayout.body.document as {
      nodes: unknown[];
      [key: string]: unknown;
    };
    const createLayout = await request(app.getHttpServer())
      .put(`/api/v1/supplier/assignment-board/layouts/${lineId}`)
      .set('Origin', supplierOrigin)
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        expectedVersion: null,
        document: {
          ...document,
          nodes: [
            ...document.nodes,
            {
              id: 'machine:integration-press',
              type: 'MACHINE_ASSET',
              assetKey: 'PRESS_STAMPING',
              opacity: 1,
              transform: {
                x: 1_600,
                y: 600,
                width: 410,
                height: 380,
                rotation: 0,
                zIndex: 50,
                locked: false,
              },
            },
          ],
        },
      });
    expect(createLayout.status).toBe(200);
    expect(createLayout.body).toMatchObject({ source: 'SAVED', version: 1, canEdit: true });

    const conflict = await request(app.getHttpServer())
      .put(`/api/v1/supplier/assignment-board/layouts/${lineId}`)
      .set('Origin', supplierOrigin)
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf)
      .send({ expectedVersion: null, document: createLayout.body.document });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('VERSION_CONFLICT');

    const forbiddenLayoutWrite = await request(app.getHttpServer())
      .put(`/api/v1/supplier/assignment-board/layouts/${lineId}`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supervisorCookie)
      .set('X-CSRF-Token', supervisorCsrf)
      .send({ expectedVersion: 1, document: createLayout.body.document });
    expect(forbiddenLayoutWrite.status).toBe(403);

    const tmminLayout = await request(app.getHttpServer())
      .get(`/api/v1/tmmin/suppliers/${supplierId}/assignment-board/layouts/${lineId}`)
      .set('Cookie', tmminCookie);
    expect(tmminLayout.status).toBe(200);
    expect(tmminLayout.body).toMatchObject({ source: 'SAVED', version: 1, canEdit: false });
    await expect(
      prisma.auditEvent.findFirstOrThrow({
        where: { resourceType: 'LineBoardLayout', resourceId: createLayout.body.id as string },
      }),
    ).resolves.toMatchObject({
      action: 'BOARD_LAYOUT_CREATED',
      changeSummary: expect.objectContaining({ nodeCount: 3, JOB_SLOT: 2, MACHINE_ASSET: 1 }),
    });
    await expect(
      prisma.outboxEvent.findFirstOrThrow({
        where: { aggregateType: 'LineBoardLayout', aggregateId: createLayout.body.id as string },
      }),
    ).resolves.toMatchObject({
      eventType: 'BOARD_LAYOUT_UPDATED',
      payload: { lineId, layoutId: createLayout.body.id, version: 1 },
    });

    const activityBaseTime = Date.now() + 60_000;
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 22 }, (_, index) => ({
        actorKind: index === 21 ? ('USER' as const) : ('SYSTEM' as const),
        actorUserId: index === 21 ? adminUserId : null,
        actorRole: index === 21 ? ('SUPPLIER_ADMIN' as const) : null,
        supplierId,
        lineId,
        action: `DASHBOARD_ACTIVITY_${index.toString().padStart(2, '0')}`,
        resourceType: index === 21 ? 'Henkaten' : 'ShiftRun',
        resourceId: index === 21 ? machineHenkatenId : randomUUID(),
        occurredAt: new Date(activityBaseTime + index * 1_000),
        correlationId: randomUUID(),
        sourceMode: 'HOSTED' as const,
        result: 'SUCCESS' as const,
      })),
    });

    const dashboard = await request(app.getHttpServer())
      .get('/api/v1/supplier/dashboard')
      .set('Cookie', adminCookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.totals.all).toBeGreaterThan(0);
    expect(dashboard.body.pendingApprovals.supervisor).toBeGreaterThanOrEqual(0);
    expect(dashboard.body.approvalAging).toHaveLength(4);
    expect(Array.isArray(dashboard.body.trend)).toBe(true);
    expect(Array.isArray(dashboard.body.assignmentIssues)).toBe(true);
    expect(Array.isArray(dashboard.body.recentOverrides)).toBe(true);
    const dashboardBody = responseBody<{
      recentActivity: Array<{
        action: string;
        occurredAt: string;
        actor: { kind: string; displayName: string | null; role: string | null };
        henkaten: null | {
          id: string;
          identifier: string;
          category: string;
          status: string;
          line: { code: string; name: string };
          jobName: string;
          part: { number: string; name: string };
        };
      }>;
    }>(dashboard);
    expect(dashboardBody.recentActivity).toHaveLength(20);
    expect(dashboardBody.recentActivity[0]?.action).toBe('DASHBOARD_ACTIVITY_21');
    expect(
      dashboardBody.recentActivity.some((item) => item.action === 'DASHBOARD_ACTIVITY_00'),
    ).toBe(false);
    expect(dashboardBody.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'DASHBOARD_ACTIVITY_20',
          actor: { kind: 'SYSTEM', displayName: null, role: null },
          henkaten: null,
        }),
      ]),
    );
    expect(
      dashboardBody.recentActivity.every(
        (item, index, items) =>
          index === 0 ||
          new Date(items[index - 1]!.occurredAt).getTime() >= new Date(item.occurredAt).getTime(),
      ),
    ).toBe(true);
    expect(dashboardBody.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: expect.objectContaining({
            kind: 'USER',
            displayName: expect.any(String),
          }),
          henkaten: expect.objectContaining({
            id: expect.any(String),
            identifier: expect.any(String),
            line: expect.objectContaining({ code: expect.any(String) }),
            part: expect.objectContaining({ number: expect.any(String) }),
          }),
        }),
      ]),
    );

    const hostedList = await request(app.getHttpServer())
      .get('/api/v1/supplier/henkatens?limit=1')
      .set('Cookie', adminCookie);
    expect(hostedList.status).toBe(200);
    expect(hostedList.body.items[0]).toMatchObject({ sourceMode: 'HOSTED', sourceEpoch: 1 });

    const audit = await request(app.getHttpServer())
      .get('/api/v1/supplier/audit')
      .set('Cookie', adminCookie);
    expect(audit.status).toBe(200);
    const auditBody = responseBody<{ items: Array<{ lineId: string | null }> }>(audit);
    expect(JSON.stringify(auditBody)).not.toMatch(/passwordHash|tokenHash|authorization/i);
    expect(auditBody.items.every((item) => 'lineId' in item)).toBe(true);

    const foreignLineId = randomUUID();
    await prisma.auditEvent.create({
      data: {
        actorKind: 'SYSTEM',
        supplierId,
        lineId: foreignLineId,
        action: 'FOREIGN_LINE_EVIDENCE',
        resourceType: 'ShiftRun',
        resourceId: randomUUID(),
        correlationId: randomUUID(),
        sourceMode: 'HOSTED',
        result: 'SUCCESS',
      },
    });
    const allowedSupervisorLines = new Set(
      (
        await prisma.shiftRun.findMany({
          where: { supplierId, supervisorMemberId: supervisorId },
          distinct: ['lineId'],
          select: { lineId: true },
        })
      ).map(({ lineId: allowedLineId }) => allowedLineId),
    );
    const supervisorAudit = await request(app.getHttpServer())
      .get('/api/v1/supplier/audit')
      .set('Cookie', supervisorCookie);
    expect(supervisorAudit.status).toBe(200);
    const supervisorAuditBody = responseBody<{
      items: Array<{ lineId: string | null; action: string }>;
    }>(supervisorAudit);
    expect(
      supervisorAuditBody.items.every(
        (item) => item.lineId !== null && allowedSupervisorLines.has(item.lineId),
      ),
    ).toBe(true);
    expect(supervisorAuditBody.items.some((item) => item.action === 'FOREIGN_LINE_EVIDENCE')).toBe(
      false,
    );
    const supervisorDashboard = await request(app.getHttpServer())
      .get('/api/v1/supplier/dashboard')
      .set('Cookie', supervisorCookie);
    expect(supervisorDashboard.status).toBe(200);
    const supervisorActivity = responseBody<{
      recentActivity: Array<{
        action: string;
        henkaten: null | { line: { code: string; name: string } };
      }>;
    }>(supervisorDashboard).recentActivity;
    expect(supervisorActivity.some((item) => item.action === 'FOREIGN_LINE_EVIDENCE')).toBe(false);

    const qcAudit = await request(app.getHttpServer())
      .get('/api/v1/supplier/audit')
      .set('Cookie', qcCookie);
    expect(qcAudit.status).toBe(200);

    const globalDashboard = await request(app.getHttpServer())
      .get('/api/v1/tmmin/dashboard')
      .set('Cookie', tmminCookie);
    expect(globalDashboard.status).toBe(200);
    expect(globalDashboard.body.suppliers.hosted).toBeGreaterThan(0);
    expect(globalDashboard.body.trend).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketStart: expect.any(String),
          hosted: expect.any(Number),
          total: expect.any(Number),
        }),
      ]),
    );
    expect(globalDashboard.body.freshnessSummary).toEqual({
      fresh: expect.any(Number),
      warning: expect.any(Number),
      stale: expect.any(Number),
      noData: expect.any(Number),
    });
    expect(globalDashboard.body.supplierOverview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supplierId,
          sourceMode: 'HOSTED',
          openHenkatens: expect.any(Number),
          over24HourWarnings: expect.any(Number),
        }),
      ]),
    );
  });

  it('applies approved Man movement once and End Shift cancels remaining work atomically', async () => {
    const target = await prisma.workingAssignment.findUniqueOrThrow({
      where: { id: targetWorkingAssignmentId },
    });
    const submission = await leaderPost(
      '/api/v1/supplier/henkatens',
      {
        category: 'MAN',
        shiftRunId,
        jobId: job1Id,
        partId,
        checklistVersionId: checklists.get('MAN')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('MAN')!.itemId, answer: 'YES' }],
        cause: 'Approved operator rotation',
        detail: 'Apply the qualified replacement to the active assignment.',
        targetWorkingAssignmentId,
        targetAssignmentVersion: target.version,
        replaced: { kind: 'MP', memberId: target.effectiveMpMemberId },
        replacementMpMemberId: replacementMpId,
      },
      'phase7-man-approve',
    );
    expect(submission.status).toBe(201);
    const henkatenId = submission.body.id as string;
    expect(
      (
        await supplierRolePost(
          supervisorCookie,
          supervisorCsrf,
          `/api/v1/supplier/henkatens/${henkatenId}/decisions`,
          { expectedVersion: 1, decision: 'APPROVED' },
          'phase7-man-supervisor',
        )
      ).status,
    ).toBe(201);
    const approved = await supplierRolePost(
      qcCookie,
      qcCsrf,
      `/api/v1/supplier/henkatens/${henkatenId}/decisions`,
      { expectedVersion: 2, decision: 'APPROVED' },
      'phase7-man-qc',
    );
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
    await expect(
      prisma.workingAssignment.findUniqueOrThrow({
        where: { id: targetWorkingAssignmentId },
        select: { effectiveMpMemberId: true },
      }),
    ).resolves.toEqual({ effectiveMpMemberId: replacementMpId });
    await expect(prisma.assignmentMovement.count({ where: { henkatenId } })).resolves.toBe(1);
    const decision = await prisma.approvalDecision.findFirstOrThrow({ where: { henkatenId } });
    await expect(
      prisma.approvalDecision.update({
        where: { id: decision.id },
        data: { comment: 'Tampered decision' },
      }),
    ).rejects.toThrow();
    await expect(prisma.assignmentMovement.delete({ where: { henkatenId } })).rejects.toThrow();

    const shift = await prisma.shiftRun.findUniqueOrThrow({ where: { id: shiftRunId } });
    const endBody = { expectedVersion: shift.version };
    const ended = await leaderPost(
      `/api/v1/supplier/shifts/${shiftRunId}/end`,
      endBody,
      'phase7-end-main-shift',
    );
    expect(ended.status).toBe(201);
    expect(ended.body.status).toBe('ENDED');
    expect(ended.body.endSummary.deactivatedWorkingAssignments).toBe(2);
    const endRetry = await leaderPost(
      `/api/v1/supplier/shifts/${shiftRunId}/end`,
      endBody,
      'phase7-end-main-shift',
    );
    expect(endRetry.status).toBe(201);
    await expect(
      prisma.workingAssignment.count({ where: { shiftRunId, active: true } }),
    ).resolves.toBe(0);
  });

  it('preserves and executes an approved pre-start Man resolution', async () => {
    const plannedLeader = await createMemberWithUser(
      'LINE_LEADER',
      'Planned Resolution Leader',
      `ops-planned-leader-${randomUUID()}`,
      await app.get(PasswordService).hash(password),
    );
    const plannedReplacement = await createMp('Planned Resolution MP');
    const plannedLine = await prisma.line.create({
      data: {
        supplierId,
        code: `PLANNED-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Planned Resolution Line',
        displayOrder: 4,
      },
    });
    const plannedJob = await prisma.job.create({
      data: {
        supplierId,
        lineId: plannedLine.id,
        name: 'Planned Vacant Job',
        normalizedName: randomUUID(),
        displayOrder: 1,
      },
    });
    await Promise.all([
      prisma.defaultLineSupervisor.create({
        data: { supplierId, lineId: plannedLine.id, supervisorMemberId: supervisorId },
      }),
      prisma.defaultLineLeader.create({
        data: {
          supplierId,
          lineId: plannedLine.id,
          lineLeaderMemberId: plannedLeader.memberId,
        },
      }),
    ]);
    const plannedLogin = await supplierLogin(plannedLeader.username);
    const plan = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      '/api/v1/supplier/shifts/preflight',
      { lineId: plannedLine.id, shiftTemplateId, businessDate },
    );
    expect(plan.status).toBe(201);
    const plannedAssignment = plan.body.workingAssignments[0] as {
      id: string;
      version: number;
    };
    const submitted = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      '/api/v1/supplier/henkatens',
      {
        category: 'MAN',
        shiftRunId: plan.body.id,
        jobId: plannedJob.id,
        partId,
        checklistVersionId: checklists.get('MAN')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('MAN')!.itemId, answer: 'YES' }],
        cause: 'Resolve planned vacancy',
        detail: 'Assign a qualified MP before the shift begins.',
        targetWorkingAssignmentId: plannedAssignment.id,
        targetAssignmentVersion: plannedAssignment.version,
        replaced: { kind: 'VACANT' },
        replacementMpMemberId: plannedReplacement,
      },
      'phase7-prestart-man',
    );
    expect(submitted.status).toBe(201);
    expect(
      (
        await supplierRolePost(
          supervisorCookie,
          supervisorCsrf,
          `/api/v1/supplier/henkatens/${submitted.body.id as string}/decisions`,
          { expectedVersion: 1, decision: 'APPROVED' },
          'phase7-prestart-supervisor',
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierRolePost(
          qcCookie,
          qcCsrf,
          `/api/v1/supplier/henkatens/${submitted.body.id as string}/decisions`,
          { expectedVersion: 2, decision: 'APPROVED' },
          'phase7-prestart-qc',
        )
      ).status,
    ).toBe(201);
    const refreshed = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      '/api/v1/supplier/shifts/preflight',
      { lineId: plannedLine.id, shiftTemplateId, businessDate },
    );
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.workingAssignments[0].id).toBe(plannedAssignment.id);
    expect(refreshed.body.eligible).toBe(true);
    const started = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      `/api/v1/supplier/shifts/${plan.body.id as string}/start`,
      { expectedVersion: refreshed.body.version },
    );
    expect(started.status).toBe(201);
    expect(started.body.workingAssignments[0].effectiveMpMemberId).toBe(plannedReplacement);

    const reroutedSupervisor = await createMemberWithUser(
      'SUPERVISOR',
      'Rerouted Operational Supervisor',
      `ops-rerouted-supervisor-${randomUUID()}`,
      await app.get(PasswordService).hash(password),
    );
    const reroutedLogin = await supplierLogin(reroutedSupervisor.username);
    const machine = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      '/api/v1/supplier/henkatens',
      {
        category: 'MACHINE',
        shiftRunId: plan.body.id,
        jobId: plannedJob.id,
        partId,
        checklistVersionId: checklists.get('MACHINE')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('MACHINE')!.itemId, answer: 'YES' }],
        cause: 'Reroute approval responsibility',
        detail: 'Preserve the original Supervisor while assigning the pending route.',
        affectedObject: 'Original machine condition',
        replacementObject: 'Controlled machine condition',
      },
      'phase7-reroute-henkaten',
    );
    expect(machine.status).toBe(201);
    const rerouted = await adminPost(
      `/api/v1/supplier/henkatens/${machine.body.id as string}/approval-routes/supervisor/reroute`,
      { expectedVersion: 1, supervisorMemberId: reroutedSupervisor.memberId },
      'phase7-reroute-command',
    );
    expect(rerouted.status).toBe(201);
    expect(rerouted.body.routes.supervisor.initialResponsibleMemberId).toBe(supervisorId);
    expect(rerouted.body.routes.supervisor.currentResponsibleMemberId).toBe(
      reroutedSupervisor.memberId,
    );
    const oldSupervisorDenied = await supplierRolePost(
      supervisorCookie,
      supervisorCsrf,
      `/api/v1/supplier/henkatens/${machine.body.id as string}/decisions`,
      { expectedVersion: 2, decision: 'APPROVED' },
      'phase7-old-supervisor-denied',
    );
    expect(oldSupervisorDenied.status).toBe(403);
    expect(
      (
        await supplierRolePost(
          reroutedLogin.cookie,
          reroutedLogin.csrf,
          `/api/v1/supplier/henkatens/${machine.body.id as string}/decisions`,
          { expectedVersion: 2, decision: 'APPROVED' },
          'phase7-rerouted-supervisor-decision',
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierRolePost(
          qcCookie,
          qcCsrf,
          `/api/v1/supplier/henkatens/${machine.body.id as string}/decisions`,
          { expectedVersion: 3, decision: 'REJECTED' },
          'phase7-rerouted-qc-reject',
        )
      ).status,
    ).toBe(201);

    const secondQc = await createMemberWithUser(
      'QC',
      'Concurrent Operational QC',
      `ops-concurrent-qc-${randomUUID()}`,
      await app.get(PasswordService).hash(password),
    );
    const secondQcLogin = await supplierLogin(secondQc.username);
    const concurrent = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      '/api/v1/supplier/henkatens',
      {
        category: 'METHOD',
        shiftRunId: plan.body.id,
        jobId: plannedJob.id,
        partId,
        checklistVersionId: checklists.get('METHOD')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('METHOD')!.itemId, answer: 'YES' }],
        cause: 'Concurrent QC decision',
        detail: 'Only the first QC command may lock the shared route.',
        affectedObject: 'Original work method',
        replacementObject: 'Controlled work method',
      },
      'phase7-concurrent-qc-henkaten',
    );
    const qcRace = await Promise.all([
      supplierRolePost(
        qcCookie,
        qcCsrf,
        `/api/v1/supplier/henkatens/${concurrent.body.id as string}/decisions`,
        { expectedVersion: 1, decision: 'APPROVED' },
        'phase7-concurrent-qc-one',
      ),
      supplierRolePost(
        secondQcLogin.cookie,
        secondQcLogin.csrf,
        `/api/v1/supplier/henkatens/${concurrent.body.id as string}/decisions`,
        { expectedVersion: 1, decision: 'REJECTED' },
        'phase7-concurrent-qc-two',
      ),
    ]);
    expect(qcRace.map(({ status }) => status).sort()).toEqual([201, 409]);

    const receivingMp = await createMp('Receiving Line MP');
    const issueResolutionMp = await createMp('Issue Resolution MP');
    const receivingLeader = await createMemberWithUser(
      'LINE_LEADER',
      'Receiving Resolution Leader',
      `ops-receiving-leader-${randomUUID()}`,
      await app.get(PasswordService).hash(password),
    );
    const receivingLogin = await supplierLogin(receivingLeader.username);
    const receivingLine = await prisma.line.create({
      data: {
        supplierId,
        code: `RECEIVING-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Receiving Resolution Line',
        displayOrder: 5,
      },
    });
    const receivingJob = await prisma.job.create({
      data: {
        supplierId,
        lineId: receivingLine.id,
        name: 'Receiving Resolution Job',
        normalizedName: randomUUID(),
        displayOrder: 1,
      },
    });
    await Promise.all([
      prisma.defaultLineSupervisor.create({
        data: { supplierId, lineId: receivingLine.id, supervisorMemberId: supervisorId },
      }),
      prisma.defaultLineLeader.create({
        data: {
          supplierId,
          lineId: receivingLine.id,
          lineLeaderMemberId: receivingLeader.memberId,
        },
      }),
      prisma.defaultJobMp.create({
        data: { supplierId, jobId: receivingJob.id, mpMemberId: receivingMp },
      }),
    ]);
    const receivingPlan = await supplierRolePost(
      receivingLogin.cookie,
      receivingLogin.csrf,
      '/api/v1/supplier/shifts/preflight',
      { lineId: receivingLine.id, shiftTemplateId, businessDate },
    );
    const receivingStarted = await supplierRolePost(
      receivingLogin.cookie,
      receivingLogin.csrf,
      `/api/v1/supplier/shifts/${receivingPlan.body.id as string}/start`,
      { expectedVersion: receivingPlan.body.version },
    );
    expect(receivingStarted.status).toBe(201);
    const receivingAssignment = receivingStarted.body.workingAssignments[0] as {
      id: string;
      version: number;
    };
    const plannedSourceAssignment = await prisma.workingAssignment.findUniqueOrThrow({
      where: { id: plannedAssignment.id },
    });
    const donorMove = await supplierRolePost(
      receivingLogin.cookie,
      receivingLogin.csrf,
      '/api/v1/supplier/henkatens',
      {
        category: 'MAN',
        shiftRunId: receivingPlan.body.id,
        jobId: receivingJob.id,
        partId,
        checklistVersionId: checklists.get('MAN')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('MAN')!.itemId, answer: 'YES' }],
        cause: 'Cross-shift operator movement',
        detail: 'Move the qualified MP and create a traceable donor vacancy.',
        targetWorkingAssignmentId: receivingAssignment.id,
        targetAssignmentVersion: receivingAssignment.version,
        replaced: { kind: 'MP', memberId: receivingMp },
        replacementMpMemberId: plannedReplacement,
        sourceWorkingAssignmentId: plannedSourceAssignment.id,
        sourceAssignmentVersion: plannedSourceAssignment.version,
      },
      'phase7-cross-shift-man',
    );
    expect(donorMove.status).toBe(201);
    expect(
      (
        await supplierRolePost(
          supervisorCookie,
          supervisorCsrf,
          `/api/v1/supplier/henkatens/${donorMove.body.id as string}/decisions`,
          { expectedVersion: 1, decision: 'APPROVED' },
          'phase7-cross-shift-supervisor',
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierRolePost(
          qcCookie,
          qcCsrf,
          `/api/v1/supplier/henkatens/${donorMove.body.id as string}/decisions`,
          { expectedVersion: 2, decision: 'APPROVED' },
          'phase7-cross-shift-qc',
        )
      ).status,
    ).toBe(201);
    const donorIssue = await prisma.assignmentIssue.findFirstOrThrow({
      where: {
        supplierId,
        shiftRunId: plan.body.id,
        jobId: plannedJob.id,
        status: 'OPEN',
        originHenkatenId: donorMove.body.id as string,
      },
    });
    expect(donorIssue.originMovementId).not.toBeNull();
    const donorAssignment = await prisma.workingAssignment.findUniqueOrThrow({
      where: { id: plannedAssignment.id },
    });
    expect(donorAssignment.effectiveMpMemberId).toBeNull();

    const resolution = await supplierRolePost(
      plannedLogin.cookie,
      plannedLogin.csrf,
      '/api/v1/supplier/henkatens',
      {
        category: 'MAN',
        shiftRunId: plan.body.id,
        jobId: plannedJob.id,
        partId,
        checklistVersionId: checklists.get('MAN')!.versionId,
        checklistAnswers: [{ itemId: checklists.get('MAN')!.itemId, answer: 'YES' }],
        cause: 'Resolve linked donor vacancy',
        detail: 'Fill only the explicitly linked issue after verifying its assignment.',
        targetWorkingAssignmentId: donorAssignment.id,
        targetAssignmentVersion: donorAssignment.version,
        replaced: { kind: 'VACANT' },
        replacementMpMemberId: issueResolutionMp,
        resolutionIssueId: donorIssue.id,
      },
      'phase7-linked-resolution-man',
    );
    expect(resolution.status).toBe(201);
    expect(
      (
        await supplierRolePost(
          supervisorCookie,
          supervisorCsrf,
          `/api/v1/supplier/henkatens/${resolution.body.id as string}/decisions`,
          { expectedVersion: 1, decision: 'APPROVED' },
          'phase7-linked-resolution-supervisor',
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await supplierRolePost(
          qcCookie,
          qcCsrf,
          `/api/v1/supplier/henkatens/${resolution.body.id as string}/decisions`,
          { expectedVersion: 2, decision: 'APPROVED' },
          'phase7-linked-resolution-qc',
        )
      ).status,
    ).toBe(201);
    await expect(
      prisma.assignmentIssue.findUniqueOrThrow({
        where: { id: donorIssue.id },
        select: { status: true, resolutionHenkatenId: true },
      }),
    ).resolves.toEqual({
      status: 'RESOLVED',
      resolutionHenkatenId: resolution.body.id,
    });

    for (const [activeShiftId, activeLogin] of [
      [receivingPlan.body.id as string, receivingLogin],
      [plan.body.id as string, plannedLogin],
    ] as const) {
      const activeShift = await prisma.shiftRun.findUniqueOrThrow({
        where: { id: activeShiftId },
      });
      const ended = await supplierRolePost(
        activeLogin.cookie,
        activeLogin.csrf,
        `/api/v1/supplier/shifts/${activeShiftId}/end`,
        { expectedVersion: activeShift.version },
        `phase7-end-${activeShiftId}`,
      );
      expect(ended.status).toBe(201);
    }
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
    role: 'SUPERVISOR' | 'LINE_LEADER' | 'QC',
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

  function supplierRolePost(
    cookie: string[],
    csrf: string,
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ) {
    const call = request(app.getHttpServer())
      .post(path)
      .set('Origin', supplierOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
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
