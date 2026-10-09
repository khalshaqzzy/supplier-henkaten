import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import cookieParser from 'cookie-parser';
import ExcelJS from 'exceljs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import unzipper from 'unzipper';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { PcrService } from '../pcr/pcr.service.js';
import { NotificationService } from '../read-models/notification.service.js';
import { CatalogService } from '../master-data/catalog.service.js';
import { LineShiftService } from '../master-data/line-shift.service.js';
import { TenantScope } from '../common/scope.js';
import { HenkatenService } from './henkaten.service.js';

const supplierOrigin = 'http://localhost:5173';
const password = 'Line-Shift-Integration-Password-123';

describe('Line Shift Henkaten operations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let supplierCode: string;
  let lineShiftId: string;
  let job1Id: string;
  let job2Id: string;
  let job1AssignmentId: string;
  let partId: string;
  let defaultMpId: string;
  let replacementMpId: string;
  let checklistVersionId: string;
  let checklistItemId: string;
  let leaderCookie: string[];
  let leaderCsrf: string;
  let supervisorCookie: string[];
  let supervisorCsrf: string;
  let outsideLeaderCookie: string[];
  let outsideLeaderCsrf: string;
  let outsideLineShiftId: string;
  let outsideJobId: string;
  let outsideAssignmentId: string;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'integration-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'integration-test-throttle-secret-32';
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['PCR_WORKER_ENABLED'] = 'false';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await app.get(PasswordService).hash(password);
    supplierCode = `LINE-SHIFT-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code: supplierCode,
        normalizedCode: supplierCode.toLowerCase(),
        name: 'Line Shift Integration Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    supplierId = supplier.id;
    const supervisor = await createMemberWithUser(
      'SUPERVISOR',
      `line-shift-supervisor-${randomUUID()}`,
      passwordHash,
    );
    const leader = await createMemberWithUser(
      'LINE_LEADER',
      `line-shift-leader-${randomUUID()}`,
      passwordHash,
    );
    const outsideLeader = await createMemberWithUser(
      'LINE_LEADER',
      `outside-shift-leader-${randomUUID()}`,
      passwordHash,
    );
    await createMemberWithUser('QC', `line-shift-qc-${randomUUID()}`, passwordHash);
    defaultMpId = await createMp('Default MP');
    replacementMpId = await createMp('Replacement MP');
    const line = await prisma.line.create({
      data: {
        supplierId,
        code: `LINE-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Assembly Line',
        displayOrder: 1,
      },
    });
    const [job1, job2, part, shift] = await Promise.all([
      prisma.job.create({
        data: {
          supplierId,
          lineId: line.id,
          name: 'Job One',
          normalizedName: `job-one-${randomUUID()}`,
          displayOrder: 1,
        },
      }),
      prisma.job.create({
        data: {
          supplierId,
          lineId: line.id,
          name: 'Job Two',
          normalizedName: `job-two-${randomUUID()}`,
          displayOrder: 2,
        },
      }),
      prisma.part.create({
        data: {
          supplierId,
          partNumber: `PART-${randomUUID()}`,
          normalizedPartNumber: randomUUID(),
          partName: 'Test Part',
          normalizedPartName: `test-part-${randomUUID()}`,
        },
      }),
      prisma.shiftTemplate.create({
        data: {
          supplierId,
          name: 'Full Day Shift',
          displayOrder: 1,
          startMinute: 0,
          endMinute: 1_439,
          timezone: 'Asia/Jakarta',
        },
      }),
    ]);
    job1Id = job1.id;
    job2Id = job2.id;
    partId = part.id;
    await prisma.tanokoMapping.createMany({
      data: [
        { supplierId, memberId: replacementMpId, jobId: job1Id, level: 3 },
        { supplierId, memberId: replacementMpId, jobId: job2Id, level: 3 },
      ],
    });
    const lineShift = await prisma.lineShift.create({
      data: {
        supplierId,
        lineId: line.id,
        shiftTemplateId: shift.id,
        supervisorMemberId: supervisor.memberId,
        lineLeaderMemberId: leader.memberId,
      },
    });
    lineShiftId = lineShift.id;
    const assignments = await Promise.all(
      [job1, job2].map((job) =>
        prisma.lineShiftJobAssignment.create({
          data: {
            supplierId,
            lineShiftId,
            jobId: job.id,
            mpMemberId: job.id === job1.id ? defaultMpId : replacementMpId,
          },
        }),
      ),
    );
    job1AssignmentId = assignments[0]!.id;
    const checklistTemplate = await prisma.checklistTemplate.create({
      data: { supplierId, category: 'MAN' },
    });
    const checklist = await prisma.checklistVersion.create({
      data: {
        supplierId,
        templateId: checklistTemplate.id,
        category: 'MAN',
        versionNumber: 1,
        items: { create: { label: 'Condition accepted', displayOrder: 1 } },
      },
      include: { items: true },
    });
    await prisma.checklistTemplate.update({
      where: { id: checklistTemplate.id },
      data: { currentVersionId: checklist.id },
    });
    checklistVersionId = checklist.id;
    checklistItemId = checklist.items[0]!.id;
    const nowMinute = jakartaMinute(new Date());
    const outsideLine = await prisma.line.create({
      data: {
        supplierId,
        code: `OUTSIDE-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Outside Shift Line',
        displayOrder: 2,
      },
    });
    const outsideJob = await prisma.job.create({
      data: {
        supplierId,
        lineId: outsideLine.id,
        name: 'Outside Job',
        normalizedName: randomUUID(),
        displayOrder: 1,
      },
    });
    outsideJobId = outsideJob.id;
    await prisma.tanokoMapping.create({
      data: { supplierId, memberId: replacementMpId, jobId: outsideJobId, level: 3 },
    });
    const outsideShift = await prisma.shiftTemplate.create({
      data: {
        supplierId,
        name: 'Next Shift',
        displayOrder: 2,
        startMinute: (nowMinute + 60) % 1_440,
        endMinute: (nowMinute + 120) % 1_440,
        timezone: 'Asia/Jakarta',
      },
    });
    const outsideConfig = await prisma.lineShift.create({
      data: {
        supplierId,
        lineId: outsideLine.id,
        shiftTemplateId: outsideShift.id,
        supervisorMemberId: supervisor.memberId,
        lineLeaderMemberId: outsideLeader.memberId,
      },
    });
    outsideLineShiftId = outsideConfig.id;
    const outsideAssignment = await prisma.lineShiftJobAssignment.create({
      data: {
        supplierId,
        lineShiftId: outsideConfig.id,
        jobId: outsideJob.id,
        mpMemberId: defaultMpId,
      },
    });
    outsideAssignmentId = outsideAssignment.id;
    ({ cookie: leaderCookie, csrf: leaderCsrf } = await supplierLogin(leader.username));
    ({ cookie: outsideLeaderCookie, csrf: outsideLeaderCsrf } = await supplierLogin(
      outsideLeader.username,
    ));
    ({ cookie: supervisorCookie, csrf: supervisorCsrf } = await supplierLogin(supervisor.username));
  });

  afterAll(async () => app.close());

  it('removes supplier Shift Run lifecycle endpoints', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/supplier/shifts')
      .set('Cookie', leaderCookie);
    const preflight = await request(app.getHttpServer())
      .post('/api/v1/supplier/shifts/preflight')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .send({});
    const start = await request(app.getHttpServer())
      .post(`/api/v1/supplier/shifts/${randomUUID()}/start`)
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ expectedVersion: 1 });
    const end = await request(app.getHttpServer())
      .post(`/api/v1/supplier/shifts/${randomUUID()}/end`)
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ expectedVersion: 1 });
    expect([list.status, preflight.status, start.status, end.status]).toEqual([404, 404, 404, 404]);
  });

  it('derives the current Line Shift from time', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/supplier/master-data/line-shifts/operational-context')
      .set('Cookie', leaderCookie);
    expect(response.status).toBe(200);
    expect(response.body.currentLineShiftId).toBe(lineShiftId);
    expect(response.body.items[0]).toMatchObject({ id: lineShiftId, current: true });
  });

  it('keeps Other part private and creates one warning per Henkaten', async () => {
    const initialPartCount = await prisma.part.count({ where: { supplierId } });
    const retryKey = randomUUID();
    const first = await createManHenkaten(retryKey, true);
    const retry = await createManHenkaten(retryKey, true);
    const second = await createManHenkaten(randomUUID(), true);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(second.status).toBe(201);
    expect(await prisma.part.count({ where: { supplierId } })).toBe(initialPartCount);
    expect(first.body.partId).toBeNull();
    expect(first.body.part).toEqual({ number: 'Other', name: '' });
    const saved = await prisma.henkaten.findMany({
      where: { id: { in: [first.body.id as string, second.body.id as string] } },
    });
    expect(saved).toHaveLength(2);
    expect(saved.every(({ partId }) => partId === null)).toBe(true);
    const warningGroups = await app.get(HenkatenService).affectedParts();
    const other = warningGroups.items.filter(
      ({ supplierId: id, partNumber }) => id === supplierId && partNumber === 'Other',
    );
    expect(other).toHaveLength(2);
    expect(other[0]!.warningKey).not.toBe(other[1]!.warningKey);
    for (const group of other) {
      const detail = await app.get(HenkatenService).affectedPart(supplierId, group.warningKey);
      expect(detail.openWarningCount).toBe(1);
    }
    const clone = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/${first.body.id as string}/clone-prefill`)
      .set('Cookie', leaderCookie);
    expect(clone.status).toBe(200);
    expect(clone.body).toMatchObject({ partId: null, partStillValid: true });
    for (const created of [first, second]) {
      const withdrawn = await request(app.getHttpServer())
        .post(`/api/v1/supplier/henkatens/${created.body.id as string}/withdraw`)
        .set('Origin', supplierOrigin)
        .set('Cookie', leaderCookie)
        .set('X-CSRF-Token', leaderCsrf)
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: created.body.version, reason: 'Cleanup Other test' });
      expect(withdrawn.status).toBe(201);
    }
  });

  it('returns the next occurrence for an LL outside shift time', async () => {
    const before = Date.now();
    const response = await request(app.getHttpServer())
      .get('/api/v1/supplier/master-data/line-shifts/operational-context')
      .set('Cookie', outsideLeaderCookie);
    expect(response.status).toBe(200);
    expect(response.body.currentLineShiftId).toBeNull();
    expect(response.body.items[0]).toMatchObject({ id: outsideLineShiftId, current: false });
    expect(new Date(response.body.items[0].effectiveStartAt).getTime()).toBeGreaterThan(before);
    const created = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', outsideLeaderCookie)
      .set('X-CSRF-Token', outsideLeaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MAN',
        jobId: outsideJobId,
        lineShiftJobAssignmentId: outsideAssignmentId,
        partId,
        replacementMpMemberId: replacementMpId,
        cause: 'Planned replacement',
        detail: 'Next occurrence assignment',
        checklistVersionId,
        checklistAnswers: [{ itemId: checklistItemId, answer: 'YES' }],
      });
    expect(created.status).toBe(201);
    expect(created.body.lineShiftId).toBe(outsideLineShiftId);
    expect(new Date(created.body.effectiveStartAt).getTime()).toBeGreaterThan(before);
  });

  it('derives the Line–Shift from the LL and rejects a stale displayed occurrence', async () => {
    const context = await request(app.getHttpServer())
      .get('/api/v1/supplier/master-data/line-shifts/operational-context')
      .set('Cookie', leaderCookie);
    const expectedStart = context.body.items[0].effectiveStartAt as string;
    const created = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MAN',
        expectedEffectiveStartAt: expectedStart,
        jobId: job1Id,
        lineShiftJobAssignmentId: job1AssignmentId,
        partId,
        replacementMpMemberId: replacementMpId,
        cause: 'Replacement',
        detail: 'Resolved from LL',
        checklistVersionId,
        checklistAnswers: [{ itemId: checklistItemId, answer: 'YES' }],
      });
    expect(created.status).toBe(201);
    expect(created.body.lineShiftId).toBe(lineShiftId);
    const listed = await request(app.getHttpServer())
      .get('/api/v1/supplier/henkatens?limit=25')
      .set('Cookie', leaderCookie);
    expect(listed.status).toBe(200);
    const items = listed.body.items as Array<{ id: string; shiftName: string }>;
    expect(items.find((item) => item.id === created.body.id)).toMatchObject({
      shiftName: created.body.shiftName,
    });
    const stale = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MAN',
        expectedEffectiveStartAt: '2020-01-01T00:00:00.000Z',
        jobId: job1Id,
        lineShiftJobAssignmentId: job1AssignmentId,
        partId,
        replacementMpMemberId: replacementMpId,
        cause: 'Replacement',
        detail: 'Stale assignment',
        checklistVersionId,
        checklistAnswers: [{ itemId: checklistItemId, answer: 'YES' }],
      });
    expect(stale.status).toBe(409);
    const withdrawn = await request(app.getHttpServer())
      .post(`/api/v1/supplier/henkatens/${created.body.id}/withdraw`)
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.body.version, reason: 'Cleanup inferred shift test' });
    expect(withdrawn.status).toBe(201);
  });

  it('applies a duplicate MP immediately without reservation and restores on reject', async () => {
    const idempotencyKey = randomUUID();
    const created = await createManHenkaten(idempotencyKey);
    expect(created.status).toBe(201);
    const henkatenId = created.body.id as string;
    const assessment = await prisma.pcrAssessment.findUniqueOrThrow({
      where: { henkatenId },
    });
    expect(assessment.status).toBe('PENDING');
    expect(created.body.pcr).toMatchObject({ status: 'PENDING', version: 1 });
    const replayed = await createManHenkaten(idempotencyKey);
    expect(replayed.body.id).toBe(henkatenId);
    expect(await prisma.pcrAssessment.count({ where: { henkatenId } })).toBe(1);
    const occurrence = await prisma.shiftRun.findUniqueOrThrow({
      where: { id: created.body.shiftRunId as string },
      include: { workingAssignments: true },
    });
    expect(
      occurrence.workingAssignments.filter(
        ({ effectiveMpMemberId }) => effectiveMpMemberId === replacementMpId,
      ),
    ).toHaveLength(2);
    expect(await prisma.mPReservation.count({ where: { henkatenId } })).toBe(0);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/supplier/henkatens/${henkatenId}/decisions`)
      .set('Origin', supplierOrigin)
      .set('Cookie', supervisorCookie)
      .set('X-CSRF-Token', supervisorCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedVersion: created.body.version,
        decision: 'REJECTED',
        comment: 'Reject test',
      });
    expect(rejected.status).toBe(201);
    const restored = await prisma.workingAssignment.findFirstOrThrow({
      where: { shiftRunId: occurrence.id, jobId: job1Id },
    });
    expect(restored.effectiveMpMemberId).toBe(defaultMpId);
  });

  it('restores the default assignment on withdraw', async () => {
    const created = await createManHenkaten();
    expect(created.status).toBe(201);
    const withdrawn = await request(app.getHttpServer())
      .post(`/api/v1/supplier/henkatens/${created.body.id}/withdraw`)
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.body.version, reason: 'Withdraw test' });
    expect(withdrawn.status).toBe(201);
    const restored = await prisma.workingAssignment.findFirstOrThrow({
      where: { shiftRunId: created.body.shiftRunId, jobId: job1Id },
    });
    expect(restored.effectiveMpMemberId).toBe(defaultMpId);
  });

  it('keeps a valid Line Shift Job in clone prefill and labels its warning with the Henkaten identifier', async () => {
    const created = await createManHenkaten();
    expect(created.status).toBe(201);
    const part = await prisma.part.findUniqueOrThrow({ where: { id: partId } });
    const warning = await app.get(HenkatenService).affectedPart(supplierId, part.partNumber);
    expect(warning.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          henkatenId: created.body.id,
          displayIdentifier: created.body.identifier,
        }),
      ]),
    );

    await prisma.shiftRun.update({
      where: { id: created.body.shiftRunId as string },
      data: { status: 'NOT_STARTED' },
    });
    const prefill = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/${created.body.id}/clone-prefill`)
      .set('Cookie', leaderCookie);
    expect(prefill.status).toBe(200);
    expect(prefill.body).toMatchObject({
      lineShiftId,
      shiftStillValid: true,
      jobId: job1Id,
      jobStillValid: true,
    });
  });

  it('lets TMMIN Quality correct PCR with a reason and rejects stale or Supplier corrections', async () => {
    const created = await createManHenkaten();
    expect(created.status).toBe(201);
    const henkatenId = created.body.id as string;
    const username = `pcr-quality-${randomUUID()}`;
    const quality = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_QUALITY',
        username,
        normalizedUsername: username.toLowerCase(),
        displayName: 'PCR Quality Reviewer',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', 'http://localhost:5174')
      .send({ username, password });
    expect(login.status).toBe(200);
    const tmminCookie = Array.isArray(login.headers['set-cookie'])
      ? login.headers['set-cookie']
      : [login.headers['set-cookie'] as string];
    const path = `/api/v1/tmmin/henkatens/HOSTED/${supplierId}/${henkatenId}/pcr-decision`;
    const correction = {
      status: 'PCR',
      reason: 'Manufacturing method and approved tool settings have changed.',
      expectedVersion: 1,
    };
    const supplierAttempt = await request(app.getHttpServer())
      .post(path)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .send(correction);
    expect(supplierAttempt.status).toBe(401);

    // Hold an in-flight model result while TMMIN makes the authoritative correction.
    const assessment = await prisma.pcrAssessment.findUniqueOrThrow({ where: { henkatenId } });
    await prisma.pcrAssessment.updateMany({
      where: { status: 'PENDING', id: { not: assessment.id } },
      data: { status: 'REVIEW' },
    });
    const pcrWorker = app.get(PcrService);
    const originalInfer = Reflect.get(pcrWorker, 'infer');
    let releaseInference = () => {};
    const inferenceGate = new Promise<void>((resolve) => {
      releaseInference = resolve;
    });
    let signalInference = () => {};
    const inferenceStarted = new Promise<void>((resolve) => {
      signalInference = resolve;
    });
    Reflect.set(pcrWorker, 'infer', async () => {
      signalInference();
      await inferenceGate;
      return {
        model: 'test-model',
        output: { needsPcr: false, confidence: 0.99, matchedControlItems: [], assessment: null },
      };
    });
    const lateWorker = pcrWorker.processOne();
    await inferenceStarted;

    const corrected = await request(app.getHttpServer())
      .post(path)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', login.body.csrfToken as string)
      .send(correction);
    releaseInference();
    await lateWorker;
    Reflect.set(pcrWorker, 'infer', originalInfer);
    expect(corrected.status).toBe(200);
    expect(corrected.body).toMatchObject({
      status: 'PCR',
      decisionSource: 'TMMIN',
      assessment: correction.reason,
      version: 2,
    });
    expect((await prisma.pcrAssessment.findUniqueOrThrow({ where: { henkatenId } })).status).toBe(
      'PCR',
    );
    const stale = await request(app.getHttpServer())
      .post(path)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', login.body.csrfToken as string)
      .send(correction);
    expect(stale.status).toBe(409);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/${henkatenId}`)
      .set('Cookie', leaderCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.pcr.assessment).toBe(correction.reason);

    const pcrEvent = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: henkatenId, eventType: 'PCR_DECISION_CORRECTED', aggregateVersion: 2 },
    });
    const notifications = app.get(NotificationService);
    await notifications.consume(pcrEvent);
    await notifications.consume(pcrEvent);
    const createdById = (await prisma.henkaten.findUniqueOrThrow({ where: { id: henkatenId } }))
      .createdById;
    const pcrNotifications = await prisma.notification.findMany({
      where: { sourceEventId: pcrEvent.id },
    });
    expect(pcrNotifications.some(({ recipientUserId }) => recipientUserId === quality.id)).toBe(
      true,
    );
    expect(pcrNotifications.some(({ recipientUserId }) => recipientUserId === createdById)).toBe(
      true,
    );
    expect(
      pcrNotifications.filter(({ recipientUserId }) => recipientUserId === createdById),
    ).toHaveLength(1);

    const removed = await request(app.getHttpServer())
      .post(path)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', login.body.csrfToken as string)
      .send({
        status: 'NO_PCR',
        reason: 'Review confirms no controlled process change.',
        expectedVersion: 2,
      });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ status: 'NO_PCR', assessment: null, version: 3 });
    const removedEvent = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: henkatenId, eventType: 'PCR_DECISION_CORRECTED', aggregateVersion: 3 },
    });
    await notifications.consume(removedEvent);
    const supplierNotice = await prisma.notification.findUniqueOrThrow({
      where: {
        sourceEventId_recipientUserId: {
          sourceEventId: removedEvent.id,
          recipientUserId: createdById,
        },
      },
    });
    expect(supplierNotice.body).toContain('No-PCR');
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: henkatenId, eventType: 'PCR_DECISION_CORRECTED' },
      }),
    ).toBe(2);

    const historical = await createManHenkaten();
    expect(historical.status).toBe(201);
    await prisma.pcrAssessment.delete({ where: { henkatenId: historical.body.id as string } });
    const historicalPath = `/api/v1/tmmin/henkatens/HOSTED/${supplierId}/${historical.body.id as string}/pcr-decision`;
    const firstDecision = await request(app.getHttpServer())
      .post(historicalPath)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', login.body.csrfToken as string)
      .send({
        status: 'PCR',
        reason: 'Historical evidence confirms a new manufacturing tool and process setting.',
        expectedVersion: 0,
      });
    expect(firstDecision.status).toBe(200);
    expect(firstDecision.body).toMatchObject({
      status: 'PCR',
      decisionSource: 'TMMIN',
      version: 1,
    });
    const staleFirstDecision = await request(app.getHttpServer())
      .post(historicalPath)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', login.body.csrfToken as string)
      .send({
        status: 'PCR',
        reason: 'Historical evidence confirms a new manufacturing tool and process setting.',
        expectedVersion: 0,
      });
    expect(staleFirstDecision.status).toBe(409);
  });

  it('exports Hosted traceability with summary graphics for Supplier and TMMIN Admin', async () => {
    const created = await createManHenkaten();
    expect(created.status).toBe(201);
    const supplierUsername = `export-admin-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        role: 'SUPPLIER_ADMIN',
        username: supplierUsername,
        normalizedUsername: supplierUsername.toLowerCase(),
        displayName: 'Export Supplier Admin',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const supplierAdmin = await supplierLogin(supplierUsername);
    const denied = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens/exports')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .send({});
    expect(denied.status).toBe(403);
    const record = await prisma.henkaten.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    const date = record.businessDate.toISOString().slice(0, 10);
    const requested = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens/exports')
      .set('Origin', supplierOrigin)
      .set('Cookie', supplierAdmin.cookie)
      .set('X-CSRF-Token', supplierAdmin.csrf)
      .send({ from: date, to: date, lineId: record.lineId });
    expect(requested.status).toBe(201);
    const exportId = requested.body.id as string;
    let status = requested.body.status as string;
    for (let attempt = 0; attempt < 60 && status !== 'READY' && status !== 'FAILED'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const response = await request(app.getHttpServer())
        .get(`/api/v1/supplier/henkatens/exports/${exportId}`)
        .set('Cookie', supplierAdmin.cookie);
      expect(response.status).toBe(200);
      status = response.body.status as string;
    }
    expect(status).toBe('READY');
    const downloaded = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/exports/${exportId}/file`)
      .set('Cookie', supplierAdmin.cookie);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    const workbook = new ExcelJS.Workbook();
    const config = app.get<AppConfig>(APP_CONFIG);
    await workbook.xlsx.readFile(join(config.exportStorageRoot, `${exportId}.xlsx`));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Ringkasan',
      'Henkaten',
      'Approval',
      'Checklist',
      'Riwayat',
    ]);
    const records = workbook.getWorksheet('Henkaten')!;
    const identifiers = Array.from(
      { length: records.rowCount - 1 },
      (_, index) => records.getCell(index + 2, 1).value,
    );
    expect(identifiers).toContain(record.identifier);
    expect(workbook.getWorksheet('Checklist')!.rowCount).toBeGreaterThan(1);
    expect(workbook.getWorksheet('Approval')!.rowCount).toBeGreaterThan(1);
    const summary = workbook.getWorksheet('Ringkasan')!;
    expect(summary.getCell('A1').value).toBe('HENKATEN  /  RINGKASAN');
    expect(summary.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FF18365B' } });
    expect(summary.getCell('A10').value).toBe(records.rowCount - 1);
    expect(
      ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED']
        .map((_, index) => summary.getCell(`B${77 + index}`).value)
        .reduce((sum, value) => Number(sum) + Number(value), 0),
    ).toBe(records.rowCount - 1);
    expect(summary.getCell('A85').value).toContain(record.lineCodeSnapshot);
    const shortLineLabel = summary.getCell('G85').value;
    expect(typeof shortLineLabel).toBe('string');
    if (typeof shortLineLabel !== 'string') throw new Error('Line chart label is missing');
    expect(shortLineLabel.length).toBeLessThanOrEqual(20);
    expect(
      ['B', 'C', 'D', 'E'].reduce(
        (sum, column) => sum + Number(summary.getCell(`${column}85`).value),
        0,
      ),
    ).toBe(Number(summary.getCell('F85').value));
    for (let row = 85; row <= 96; row++) {
      const month = summary.getCell(`H${row}`).value;
      if (!month) continue;
      expect(
        ['I', 'J', 'K', 'L'].reduce(
          (sum, column) => sum + Number(summary.getCell(`${column}${row}`).value),
          0,
        ),
      ).toBe(Number(summary.getCell(`M${row}`).value));
    }
    const exported = await unzipper.Open.file(join(config.exportStorageRoot, `${exportId}.xlsx`));
    expect(
      exported.files.filter((entry) => /^xl\/charts\/chart\d+\.xml$/.test(entry.path)),
    ).toHaveLength(6);
    const monthlyChart = await exported.files
      .find((entry) => entry.path === 'xl/charts/chart4.xml')!
      .buffer();
    expect(monthlyChart.toString()).toContain('Ringkasan!$I$85:');
    expect(monthlyChart.toString()).toContain('<c:grouping val="stacked"/>');
    expect(monthlyChart.toString().match(/<c:ser>/g) ?? []).toHaveLength(4);
    const partChart = await exported.files
      .find((entry) => entry.path === 'xl/charts/chart5.xml')!
      .buffer();
    expect(partChart.toString()).toContain('Ringkasan!$N$85:');

    const tmminUsername = `export-tmmin-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username: tmminUsername,
        normalizedUsername: tmminUsername.toLowerCase(),
        displayName: 'Export TMMIN Admin',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const tmminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', 'http://localhost:5174')
      .send({ username: tmminUsername, password });
    expect(tmminLogin.status).toBe(200);
    const tmminCookie = Array.isArray(tmminLogin.headers['set-cookie'])
      ? tmminLogin.headers['set-cookie']
      : [tmminLogin.headers['set-cookie'] as string];
    const tmminRequested = await request(app.getHttpServer())
      .post(`/api/v1/tmmin/suppliers/${supplierId}/henkatens/exports`)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', tmminCookie)
      .set('X-CSRF-Token', tmminLogin.body.csrfToken as string)
      .send({ from: date, to: date });
    expect(tmminRequested.status).toBe(201);
  });

  it('rejects changed assignments even when the occurrence is unchanged', async () => {
    const current = await prisma.lineShift.findUniqueOrThrow({ where: { id: lineShiftId } });
    await prisma.lineShift.update({
      where: { id: lineShiftId },
      data: { version: { increment: 1 } },
    });
    const stale = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MAN',
        lineShiftId,
        expectedLineShiftVersion: current.version,
        lineShiftJobAssignmentId: job1AssignmentId,
        jobId: job1Id,
        partId,
        replacementMpMemberId: replacementMpId,
        cause: 'Changed assignment',
        detail: 'Same occurrence',
        checklistVersionId,
        checklistAnswers: [{ itemId: checklistItemId, answer: 'YES' }],
      });
    expect(stale.status).toBe(409);
    const staleMp = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MAN',
        lineShiftId,
        expectedReplacedMpMemberId: randomUUID(),
        lineShiftJobAssignmentId: job1AssignmentId,
        jobId: job1Id,
        partId,
        replacementMpMemberId: replacementMpId,
        cause: 'Changed MP',
        detail: 'Same occurrence',
        checklistVersionId,
        checklistAnswers: [{ itemId: checklistItemId, answer: 'YES' }],
      });
    expect(staleMp.status).toBe(409);
  });

  it('materializes a job added after the current occurrence already exists', async () => {
    const shift = await prisma.lineShift.findUniqueOrThrow({ where: { id: lineShiftId } });
    const actor = await prisma.user.findFirstOrThrow({
      where: { supplierId, role: 'LINE_LEADER' },
    });
    const context = {
      actorUserId: actor.id,
      actorRole: 'SUPPLIER_ADMIN' as const,
      correlationId: randomUUID(),
    };
    const job = await app
      .get(CatalogService)
      .createJob(
        new TenantScope(supplierId),
        shift.lineId,
        { name: 'Added mid-occurrence' },
        context,
      );
    const template = await prisma.checklistTemplate.create({
      data: { supplierId, category: 'MACHINE' },
    });
    const checklist = await prisma.checklistVersion.create({
      data: {
        supplierId,
        templateId: template.id,
        category: 'MACHINE',
        versionNumber: 1,
        items: { create: { label: 'Checked', displayOrder: 1 } },
      },
      include: { items: true },
    });
    await prisma.checklistTemplate.update({
      where: { id: template.id },
      data: { currentVersionId: checklist.id },
    });
    const result = await request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MACHINE',
        jobId: job.id,
        partId,
        cause: 'New job',
        detail: 'Current occurrence',
        affectedObject: 'Tool A',
        replacementObject: 'Tool B',
        checklistVersionId: checklist.id,
        checklistAnswers: [{ itemId: checklist.items[0]!.id, answer: 'YES' }],
      });
    expect(result.status).toBe(201);
    expect(await prisma.workingAssignment.count({ where: { supplierId, jobId: job.id } })).toBe(1);
    expect(
      await prisma.workingAssignment.count({ where: { supplierId, jobId: job1Id } }),
    ).toBeGreaterThan(0);
  });

  it('rejects inactive references when reactivating a shift and permits repaired references', async () => {
    const current = await prisma.lineShift.findUniqueOrThrow({ where: { id: lineShiftId } });
    const actor = await prisma.user.findFirstOrThrow({
      where: { supplierId, role: 'LINE_LEADER' },
    });
    const context = {
      actorUserId: actor.id,
      actorRole: 'SUPPLIER_ADMIN' as const,
      correlationId: randomUUID(),
    };
    const service = app.get(LineShiftService);
    await service.setActive(
      new TenantScope(supplierId),
      lineShiftId,
      current.version,
      false,
      context,
    );
    await prisma.member.update({
      where: { id: current.lineLeaderMemberId! },
      data: { active: false },
    });
    await expect(
      service.setActive(
        new TenantScope(supplierId),
        lineShiftId,
        current.version + 1,
        true,
        context,
      ),
    ).rejects.toThrow();
    expect((await prisma.lineShift.findUniqueOrThrow({ where: { id: lineShiftId } })).active).toBe(
      false,
    );
    await prisma.member.update({
      where: { id: current.lineLeaderMemberId! },
      data: { active: true },
    });
    const repaired = await service.setActive(
      new TenantScope(supplierId),
      lineShiftId,
      current.version + 1,
      true,
      context,
    );
    expect(repaired.active).toBe(true);
  });

  it('lets both TMMIN roles remove every lifecycle status while retaining evidence and effective MP', async () => {
    for (const role of ['TMMIN_ADMIN', 'TMMIN_QUALITY'] as const) {
      const auth = await deletionLogin(role);
      for (const status of ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
        const created = await createManHenkaten();
        expect(created.status).toBe(201);
        const id = created.body.id as string;
        if (status !== 'OPEN')
          await prisma.henkaten.update({
            where: { id },
            data: {
              status,
              finalizedAt: new Date(),
              finalizedById: auth.id,
              ...(status === 'CANCELLED' ? { cancellationReason: 'WITHDRAWN' } : {}),
              version: { increment: 1 },
            },
          });
        const before = await prisma.henkaten.findUniqueOrThrow({ where: { id } });
        const assignment = await prisma.workingAssignment.findFirstOrThrow({
          where: { shiftRunId: before.shiftRunId, jobId: before.jobId },
        });
        const contextBefore = await request(app.getHttpServer())
          .get('/api/v1/supplier/master-data/line-shifts/operational-context')
          .set('Cookie', leaderCookie);
        expect(contextBefore.status).toBe(200);
        const body = {
          expectedVersion: before.version,
          reason: 'Remove duplicate operational record',
        };
        const key = randomUUID();
        const path = `/api/v1/tmmin/henkatens/HOSTED/${supplierId}/${id}`;
        const remove = () =>
          request(app.getHttpServer())
            .delete(path)
            .set('Origin', 'http://localhost:5174')
            .set('Cookie', auth.cookie)
            .set('X-CSRF-Token', auth.csrf)
            .set('Idempotency-Key', key)
            .send(body);
        const removed = await remove();
        expect(removed.status).toBe(200);
        expect(removed.body.total).toBe(1);
        expect((await remove()).body).toEqual(removed.body);
        const changedRetry = await request(app.getHttpServer())
          .delete(path)
          .set('Origin', 'http://localhost:5174')
          .set('Cookie', auth.cookie)
          .set('X-CSRF-Token', auth.csrf)
          .set('Idempotency-Key', key)
          .send({ ...body, reason: 'Different request' });
        expect(changedRetry.status).toBe(409);
        const retained = await prisma.henkaten.findUniqueOrThrow({ where: { id } });
        expect(retained.deletedAt).not.toBeNull();
        expect(retained.status).toBe(status);
        expect(retained.cause).toBe(before.cause);
        expect(retained.cancellationReason).toBe(before.cancellationReason);
        expect(await prisma.henkatenChecklistSnapshot.count({ where: { henkatenId: id } })).toBe(1);
        expect(
          (await prisma.workingAssignment.findUniqueOrThrow({ where: { id: assignment.id } }))
            .effectiveMpMemberId,
        ).toBe(assignment.effectiveMpMemberId);
        const contextAfter = await request(app.getHttpServer())
          .get('/api/v1/supplier/master-data/line-shifts/operational-context')
          .set('Cookie', leaderCookie);
        expect(contextAfter.status).toBe(200);
        expect(contextAfter.body.items).toEqual(contextBefore.body.items);
        const visible = await request(app.getHttpServer())
          .get(`/api/v1/tmmin/suppliers/${supplierId}/henkatens/${id}`)
          .set('Cookie', auth.cookie);
        expect(visible.status).toBe(404);
        const supplierRead = await request(app.getHttpServer())
          .get(`/api/v1/supplier/henkatens/${id}`)
          .set('Cookie', leaderCookie);
        expect(supplierRead.status).toBe(404);
        expect(
          (await prisma.warningInstance.findUniqueOrThrow({ where: { henkatenId: id } })).hiddenAt,
        ).not.toBeNull();
        expect(
          (await prisma.pcrAssessment.findUniqueOrThrow({ where: { henkatenId: id } })).hiddenAt,
        ).not.toBeNull();
        await expect(
          prisma.henkaten.update({ where: { id }, data: { deletedAt: null } }),
        ).rejects.toThrow();
        await expect(prisma.henkaten.delete({ where: { id } })).rejects.toThrow();
        await expect(
          prisma.henkatenChecklistSnapshot.deleteMany({ where: { henkatenId: id } }),
        ).rejects.toThrow();
      }
    }
  });

  it('rejects Supplier deletion, stale versions and cross-supplier record IDs', async () => {
    const auth = await deletionLogin('TMMIN_QUALITY');
    const created = await createManHenkaten();
    expect(created.status).toBe(201);
    const body = { expectedVersion: created.body.version + 1, reason: 'Version check' };
    const path = `/api/v1/tmmin/henkatens/HOSTED/${supplierId}/${created.body.id}`;
    const forbidden = await request(app.getHttpServer())
      .delete(path)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect([401, 403]).toContain(forbidden.status);
    const stale = await request(app.getHttpServer())
      .delete(path)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(stale.status).toBe(409);
    const cross = await request(app.getHttpServer())
      .delete(`/api/v1/tmmin/henkatens/HOSTED/${randomUUID()}/${created.body.id}`)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, expectedVersion: created.body.version });
    expect(cross.status).toBe(404);
    expect(
      (await prisma.henkaten.findUniqueOrThrow({ where: { id: created.body.id } })).deletedAt,
    ).toBeNull();
  });

  it('removes all supplier records across sources and epochs with a stale-preview check and safe bulk retry', async () => {
    const auth = await deletionLogin('TMMIN_QUALITY');
    const exportOwner = await deletionLogin('TMMIN_ADMIN');
    const oldExport = await prisma.henkatenExportJob.create({
      data: {
        supplierId,
        requestedById: exportOwner.id,
        requestedRealm: 'TMMIN',
        status: 'READY',
        filters: {},
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const exportPath = `/api/v1/tmmin/suppliers/${supplierId}/henkatens/exports/${oldExport.id}`;
    expect(
      (await request(app.getHttpServer()).get(exportPath).set('Cookie', exportOwner.cookie)).status,
    ).toBe(200);
    const previewPath = `/api/v1/tmmin/suppliers/${supplierId}/henkaten-deletion-preview`;
    const preview = await request(app.getHttpServer()).get(previewPath).set('Cookie', auth.cookie);
    expect(preview.status).toBe(200);
    const added = await createManHenkaten();
    expect(added.status).toBe(201);
    const path = `/api/v1/tmmin/suppliers/${supplierId}/henkatens`;
    const mutate = (body: object, key = randomUUID()) =>
      request(app.getHttpServer())
        .delete(path)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf)
        .set('Idempotency-Key', key)
        .send(body);
    expect(
      (
        await mutate({
          expectedRevision: preview.body.revision,
          supplierCode,
          reason: 'Remove supplier records',
        })
      ).status,
    ).toBe(409);
    const snapshot = { externalId: 'history', name: 'Historical external context' };
    const external = await prisma.externalHenkatenProjection.create({
      data: {
        supplierId,
        sourceEpoch: 99,
        sourceHenkatenId: randomUUID(),
        sourceVersion: 1,
        status: 'APPROVED',
        category: 'MACHINE',
        occurredAt: new Date(),
        lineSnapshot: snapshot,
        shiftSnapshot: snapshot,
        jobSnapshot: snapshot,
        partSnapshot: { number: 'History part', name: '' },
        changeSnapshot: {},
        checklistSnapshot: {},
        decisionsSnapshot: [],
        lastEventId: randomUUID(),
      },
    });
    const sibling = await prisma.supplier.create({
      data: {
        code: `KEEP-${randomUUID()}`,
        normalizedCode: randomUUID(),
        name: 'Unrelated supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'EXTERNAL',
      },
    });
    const unrelated = await prisma.externalHenkatenProjection.create({
      data: {
        supplierId: sibling.id,
        sourceEpoch: 1,
        sourceHenkatenId: randomUUID(),
        sourceVersion: 1,
        status: 'OPEN',
        category: 'MACHINE',
        occurredAt: new Date(),
        lineSnapshot: snapshot,
        shiftSnapshot: snapshot,
        jobSnapshot: snapshot,
        partSnapshot: snapshot,
        changeSnapshot: {},
        checklistSnapshot: {},
        decisionsSnapshot: [],
        lastEventId: randomUUID(),
      },
    });
    const current = await request(app.getHttpServer()).get(previewPath).set('Cookie', auth.cookie);
    expect(current.body.external).toBe(1);
    const body = {
        expectedRevision: current.body.revision,
        supplierCode,
        reason: 'Remove supplier records',
      },
      key = randomUUID();
    const removed = await mutate(body, key);
    expect(removed.status).toBe(200);
    expect(removed.body.total).toBe(current.body.total);
    expect(
      (await prisma.externalHenkatenProjection.findUniqueOrThrow({ where: { id: external.id } }))
        .deletedAt,
    ).not.toBeNull();
    expect(
      (await prisma.externalHenkatenProjection.findUniqueOrThrow({ where: { id: unrelated.id } }))
        .deletedAt,
    ).toBeNull();
    const empty = await request(app.getHttpServer()).get(previewPath).set('Cookie', auth.cookie);
    expect(empty.body.total).toBe(0);
    const newRecord = await createManHenkaten();
    expect(newRecord.status).toBe(201);
    expect((await mutate(body, key)).body).toEqual(removed.body);
    expect(
      (await prisma.henkaten.findUniqueOrThrow({ where: { id: newRecord.body.id } })).deletedAt,
    ).toBeNull();
    expect(
      await prisma.henkatenExportJob.count({ where: { supplierId, invalidatedAt: null } }),
    ).toBe(0);
    expect(
      (await request(app.getHttpServer()).get(exportPath).set('Cookie', exportOwner.cookie)).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${exportPath}/file`)
          .set('Cookie', exportOwner.cookie)
      ).status,
    ).toBe(404);
    for (const surface of [
      `/api/v1/tmmin/henkatens?supplierId=${supplierId}`,
      `/api/v1/tmmin/dashboard?supplierId=${supplierId}`,
      `/api/v1/tmmin/audit?supplierId=${supplierId}`,
      `/api/v1/tmmin/suppliers/${supplierId}`,
      `/api/v1/tmmin/suppliers/${supplierId}/henkatens/warnings`,
      '/api/v1/supplier/dashboard',
      '/api/v1/supplier/audit',
      '/api/v1/supplier/assignment-board',
    ]) {
      const response = await request(app.getHttpServer())
        .get(surface)
        .set('Cookie', surface.includes('/tmmin/') ? auth.cookie : leaderCookie);
      expect(response.status, surface).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain(added.body.id as string);
      expect(JSON.stringify(response.body)).not.toContain(external.id);
    }
    const staleEvents = await prisma.outboxEvent.findMany({
      where: { supplierId, suppressedAt: { not: null } },
    });
    for (const event of staleEvents) await app.get(NotificationService).consume(event);
    expect(
      await prisma.notification.count({
        where: {
          supplierId,
          hiddenAt: null,
          resourceId: { in: staleEvents.map((row) => row.aggregateId) },
        },
      }),
    ).toBe(0);
  });

  it('serializes duplicate deletion and concurrent submission without removing unconfirmed new data', async () => {
    const auth = await deletionLogin('TMMIN_ADMIN');
    const target = await createManHenkaten();
    expect(target.status).toBe(201);
    const key = randomUUID();
    const remove = () =>
      request(app.getHttpServer())
        .delete(`/api/v1/tmmin/henkatens/HOSTED/${supplierId}/${target.body.id}`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf)
        .set('Idempotency-Key', key)
        .send({ expectedVersion: target.body.version, reason: 'Concurrent retry' });
    const [first, second] = await Promise.all([remove(), remove()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.henkatenDeletionCommand.count({ where: { supplierId, key } })).toBe(1);
    const preview = await request(app.getHttpServer())
      .get(`/api/v1/tmmin/suppliers/${supplierId}/henkaten-deletion-preview`)
      .set('Cookie', auth.cookie);
    const [bulk, created] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/api/v1/tmmin/suppliers/${supplierId}/henkatens`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.csrf)
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedRevision: preview.body.revision,
          supplierCode,
          reason: 'Concurrent submission',
        }),
      createManHenkaten(),
    ]);
    expect([200, 409]).toContain(bulk.status);
    expect(created.status).toBe(201);
    expect(
      (await prisma.henkaten.findUniqueOrThrow({ where: { id: created.body.id } })).deletedAt,
    ).toBeNull();
  });

  it('keeps a surviving clone and discards a PCR result leased before its source was removed', async () => {
    const auth = await deletionLogin('TMMIN_ADMIN');
    const source = await createManHenkaten();
    expect(source.status).toBe(201);
    const sourceId = source.body.id as string;
    const claim = await prisma.pcrAssessment.update({
      where: { henkatenId: sourceId },
      data: { leaseToken: randomUUID(), leasedAt: new Date() },
    });
    const terminal = await prisma.henkaten.update({
      where: { id: sourceId },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'WITHDRAWN',
        finalizedAt: new Date(),
        finalizedById: auth.id,
        version: { increment: 1 },
      },
    });
    const clone = await createManHenkaten(randomUUID(), false, sourceId);
    expect(clone.status).toBe(201);
    expect(clone.body.clonedFromHenkatenId).toBe(sourceId);
    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/tmmin/henkatens/HOSTED/${supplierId}/${sourceId}`)
      .set('Origin', 'http://localhost:5174')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: terminal.version, reason: 'Duplicate source' });
    expect(removed.status).toBe(200);
    // Deliver the completed inference to the real persistence boundary after its lease was invalidated.
    const service = app.get(PcrService);
    const finish = Reflect.get(service, 'finish') as (
      leased: typeof claim,
      result: { status: 'REVIEW'; model: null; output: null },
    ) => Promise<void>;
    await finish.call(service, claim, { status: 'REVIEW', model: null, output: null });
    const retained = await prisma.pcrAssessment.findUniqueOrThrow({ where: { id: claim.id } });
    expect(retained.status).toBe(claim.status);
    expect(retained.version).toBe(claim.version);
    expect(retained.hiddenAt).not.toBeNull();
    expect(retained.leaseToken).toBeNull();
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: sourceId, eventType: 'PCR_REVIEW_REQUIRED', suppressedAt: null },
      }),
    ).toBe(0);
    const surviving = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/${clone.body.id}`)
      .set('Cookie', leaderCookie);
    expect(surviving.status).toBe(200);
    expect(surviving.body.clonedFromHenkatenId).toBeNull();
    const hiddenPrefill = await request(app.getHttpServer())
      .get(`/api/v1/supplier/henkatens/${sourceId}/clone-prefill`)
      .set('Cookie', leaderCookie);
    expect(hiddenPrefill.status).toBe(404);
  });

  async function deletionLogin(role: 'TMMIN_ADMIN' | 'TMMIN_QUALITY') {
    const username = `delete-${role.toLowerCase()}-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role,
        username,
        normalizedUsername: username,
        displayName: 'Deletion reviewer',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', 'http://localhost:5174')
      .send({ username, password });
    expect(login.status).toBe(200);
    return {
      id: user.id,
      cookie: login.headers['set-cookie'] as unknown as string[],
      csrf: login.body.csrfToken as string,
    };
  }

  async function createManHenkaten(
    idempotencyKey = randomUUID(),
    otherPart = false,
    clonedFromHenkatenId?: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        category: 'MAN',
        ...(clonedFromHenkatenId ? { clonedFromHenkatenId } : {}),
        lineShiftId,
        lineShiftJobAssignmentId: job1AssignmentId,
        jobId: job1Id,
        ...(otherPart ? { otherPart: true } : { partId }),
        replacementMpMemberId: replacementMpId,
        cause: 'Replacement required',
        detail: 'Immediate occurrence assignment',
        checklistVersionId,
        checklistAnswers: [{ itemId: checklistItemId, answer: 'YES' }],
      });
  }

  async function createMemberWithUser(
    role: 'SUPERVISOR' | 'LINE_LEADER' | 'QC',
    username: string,
    passwordHash: string,
  ) {
    const member = await prisma.member.create({
      data: {
        supplierId,
        role,
        fullName: username,
        registrationNumber: `REG-${randomUUID()}`,
        normalizedRegistrationNumber: randomUUID(),
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
        displayName: username,
        passwordHash,
        mustChangePassword: false,
      },
    });
    return { memberId: member.id, userId: user.id, username };
  }

  async function createMp(name: string) {
    return (
      await prisma.member.create({
        data: {
          supplierId,
          role: 'MP',
          fullName: name,
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
      cookie: Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie'] as string],
      csrf: response.body.csrfToken as string,
    };
  }
});

function jakartaMinute(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return Number(values['hour']) * 60 + Number(values['minute']);
}
