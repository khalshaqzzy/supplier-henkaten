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
    const created = await createManHenkaten();
    expect(created.status).toBe(201);
    const henkatenId = created.body.id as string;
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

  async function createManHenkaten() {
    return request(app.getHttpServer())
      .post('/api/v1/supplier/henkatens')
      .set('Origin', supplierOrigin)
      .set('Cookie', leaderCookie)
      .set('X-CSRF-Token', leaderCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        category: 'MAN',
        lineShiftId,
        lineShiftJobAssignmentId: job1AssignmentId,
        jobId: job1Id,
        partId,
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
          registrationNumber: `REG-${randomUUID()}`,
          normalizedRegistrationNumber: randomUUID(),
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
