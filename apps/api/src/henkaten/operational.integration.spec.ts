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
import { PcrService } from '../pcr/pcr.service.js';
import { NotificationService } from '../read-models/notification.service.js';
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
  let outsideLineShiftId: string;

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
    await prisma.lineShiftJobAssignment.create({
      data: {
        supplierId,
        lineShiftId: outsideConfig.id,
        jobId: outsideJob.id,
        mpMemberId: defaultMpId,
      },
    });
    ({ cookie: leaderCookie, csrf: leaderCsrf } = await supplierLogin(leader.username));
    ({ cookie: outsideLeaderCookie } = await supplierLogin(outsideLeader.username));
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

  async function createManHenkaten(idempotencyKey = randomUUID(), otherPart = false) {
    return request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        category: 'MAN',
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
