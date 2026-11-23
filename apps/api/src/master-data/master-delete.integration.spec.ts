import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignmentBoardSchema,
  boardLayoutResponseSchema,
  henkatenDetailSchema,
  masterDeletePreviewSchema,
  shiftRotationSchema,
  shiftTemplateSchema,
} from '@tmmin-henkaten/contracts';

import { AppModule } from '../app.module.js';
import { installJsonBodyParsers } from '../auth/import-body.middleware.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { ShiftRotationService } from './shift-rotation.service.js';

const origin = 'http://localhost:5173';
const password = 'Delete-Modes-Password-123';
const base = '/api/v1/supplier/master-data';

type Session = { cookie: string; csrf: string };

const weekdays = (startTime: string, endTime: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) =>
    dayOfWeek <= 5 ? { dayOfWeek, isOff: false, startTime, endTime } : { dayOfWeek, isOff: true },
  );
const everyDay = (startTime: string, endTime: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, isOff: false, startTime, endTime }));

describe('master data delete modes, weekly schedules, rotation and cross-line visibility', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let supplierCode: string;
  let admin: Session;
  let assignedSupervisor: Session;
  let otherSupervisor: Session;
  let otherLeader: Session;
  let supervisorMemberId: string;
  let leaderMemberId: string;
  let mpMemberId: string;
  let lineId: string;
  let jobId: string;
  let shiftId: string;
  let lineShiftId: string;
  let henkatenId: string;

  const http = () => request(app.getHttpServer());
  const post = (session: Session, path: string, body: unknown) =>
    http()
      .post(path)
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body as object);
  const patch = (session: Session, path: string, body: unknown) =>
    http()
      .patch(path)
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body as object);
  const get = (session: Session, path: string) => http().get(path).set('Cookie', session.cookie);

  async function login(username: string): Promise<Session> {
    const response = await http()
      .post('/api/v1/auth/supplier/login')
      .set('Origin', origin)
      .send({ supplierCode, username, password });
    expect(response.status).toBe(200);
    return {
      cookie: response.headers['set-cookie'] ?? '',
      csrf: response.body.csrfToken as string,
    };
  }

  async function memberWithAccount(role: 'SUPERVISOR' | 'LINE_LEADER', hash: string) {
    const suffix = randomUUID().slice(0, 8);
    const member = await prisma.member.create({
      data: {
        supplierId,
        fullName: `${role} ${suffix}`,
        role,
        registrationNumber: `REG-${suffix}`,
        normalizedRegistrationNumber: `reg-${suffix}`,
      },
    });
    const username = `${role.toLowerCase()}-${suffix}`;
    await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        role,
        memberId: member.id,
        username,
        normalizedUsername: username,
        displayName: member.fullName,
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    return { member, username };
  }

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'integration-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'integration-test-throttle-secret-32';
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['SHIFT_ROTATION_ENABLED'] = 'false';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    installJsonBodyParsers(app);
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await app.get(PasswordService).hash(password);
    supplierCode = `DELETE-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code: supplierCode,
        normalizedCode: supplierCode.toLowerCase(),
        name: 'Delete Modes Supplier',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    supplierId = supplier.id;
    const adminUsername = `admin-${randomUUID()}`;
    await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId,
        role: 'SUPPLIER_ADMIN',
        username: adminUsername,
        normalizedUsername: adminUsername,
        displayName: 'Delete Admin',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    const spv = await memberWithAccount('SUPERVISOR', hash);
    const spv2 = await memberWithAccount('SUPERVISOR', hash);
    const ll = await memberWithAccount('LINE_LEADER', hash);
    const ll2 = await memberWithAccount('LINE_LEADER', hash);
    supervisorMemberId = spv.member.id;
    leaderMemberId = ll.member.id;
    const mp = await prisma.member.create({
      data: { supplierId, fullName: 'Operator Satu', role: 'MP' },
    });
    mpMemberId = mp.id;
    admin = await login(adminUsername);
    assignedSupervisor = await login(spv.username);
    otherSupervisor = await login(spv2.username);
    otherLeader = await login(ll2.username);
    void ll;

    const line = await post(admin, `${base}/lines`, { code: 'DEL-L1', name: 'Delete Line' });
    expect(line.status).toBe(201);
    lineId = line.body.id;
    const job = await post(admin, `${base}/lines/${lineId}/jobs`, {
      name: 'Assembly',
      skillCategory: 'MEDIUM',
    });
    expect(job.status).toBe(201);
    jobId = job.body.id;
    const shift = await post(admin, `${base}/shift-templates`, {
      name: 'Shift Pagi',
      timezone: 'Asia/Jakarta',
      weeklySchedule: everyDay('00:00', '23:59'),
    });
    expect(shift.status).toBe(201);
    shiftId = shift.body.id;
    const lineShift = await prisma.lineShift.create({
      data: {
        supplierId,
        lineId,
        shiftTemplateId: shiftId,
        supervisorMemberId,
        lineLeaderMemberId: leaderMemberId,
        lineLeaders: { create: { memberId: leaderMemberId, position: 1 } },
      },
    });
    lineShiftId = lineShift.id;
    await prisma.lineShiftJobAssignment.create({
      data: { supplierId, lineShiftId, jobId, mpMemberId },
    });
    const now = new Date();
    const shiftRun = await prisma.shiftRun.create({
      data: {
        supplierId,
        lineId,
        shiftTemplateId: shiftId,
        businessDate: new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
        scheduledStartAt: new Date(now.getTime() - 3_600_000),
        scheduledEndAt: new Date(now.getTime() + 3_600_000),
        timezoneSnapshot: 'Asia/Jakarta',
        lineCodeSnapshot: 'DEL-L1',
        lineNameSnapshot: 'Delete Line',
        shiftNameSnapshot: 'Shift Pagi',
        shiftStartMinuteSnapshot: 0,
        shiftEndMinuteSnapshot: 1439,
        defaultAssignmentSetVersion: 1,
        sourceEpoch: 1,
        latestPreflight: {},
        latestPreflightAt: now,
        supervisorMemberId,
        lineLeaderMemberId: leaderMemberId,
      },
    });
    const adminUser = await prisma.user.findFirstOrThrow({ where: { username: adminUsername } });
    const henkaten = await prisma.henkaten.create({
      data: {
        supplierId,
        shiftRunId: shiftRun.id,
        lineShiftId,
        lineId,
        jobId,
        identifier: `HEN-DEL-${randomUUID().slice(0, 6)}`,
        dailySequence: 1,
        sourceMode: 'HOSTED',
        sourceEpoch: 1,
        category: 'METHOD',
        affectedObject: 'SOP lama',
        replacementObject: 'SOP baru',
        businessDate: shiftRun.businessDate,
        timezoneSnapshot: 'Asia/Jakarta',
        shiftNameSnapshot: 'Shift Pagi',
        lineCodeSnapshot: 'DEL-L1',
        lineNameSnapshot: 'Delete Line',
        jobNameSnapshot: 'Assembly',
        partNumberSnapshot: 'P-1',
        normalizedPartNumberSnapshot: 'p-1',
        partNameSnapshot: 'Part 1',
        creatorNameSnapshot: 'Delete Admin',
        cause: 'Perubahan metode',
        detail: 'Detail',
        occurredAt: now,
        submissionKey: randomUUID(),
        submissionPayloadHash: 'a'.repeat(64),
        createdById: adminUser.id,
        approvalRoutes: {
          create: [
            {
              route: 'SUPERVISOR',
              initialResponsibleMemberId: supervisorMemberId,
              initialResponsibleNameSnapshot: 'Supervisor',
              currentResponsibleMemberId: supervisorMemberId,
              currentResponsibleNameSnapshot: 'Supervisor',
            },
            { route: 'QC' },
          ],
        },
      },
    });
    henkatenId = henkaten.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores per-day hours with off days and returns them in the shift contract', async () => {
    const created = await post(admin, `${base}/shift-templates`, {
      name: 'Shift Kantor',
      timezone: 'Asia/Jakarta',
      weeklySchedule: weekdays('07:00', '16:00'),
    });
    expect(created.status).toBe(201);
    const shift = shiftTemplateSchema.parse(created.body);
    expect(shift.isUniform).toBe(false);
    expect(shift.startTime).toBe('07:00');
    expect(shift.weeklySchedule[6]).toMatchObject({ dayOfWeek: 7, isOff: true });
    const uniform = await patch(admin, `${base}/shift-templates/${shift.id}`, {
      expectedVersion: shift.version,
      weeklySchedule: everyDay('08:00', '17:00'),
    });
    expect(uniform.status).toBe(200);
    expect(shiftTemplateSchema.parse(uniform.body).isUniform).toBe(true);
    const invalid = await post(admin, `${base}/shift-templates`, {
      name: 'Tanpa hari kerja',
      timezone: 'Asia/Jakarta',
      weeklySchedule: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, isOff: true })),
    });
    expect(invalid.status).toBe(400);
  });

  it('lets unassigned Supervisors and Line Leaders read every line but not act on it', async () => {
    const list = await get(otherSupervisor, '/api/v1/supplier/henkatens?limit=25');
    expect(list.status).toBe(200);
    const ids = (body: unknown) =>
      (body as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids(list.body)).toContain(henkatenId);
    const mine = await get(otherSupervisor, '/api/v1/supplier/henkatens?limit=25&scope=ASSIGNED');
    expect(ids(mine.body)).not.toContain(henkatenId);

    const detail = henkatenDetailSchema.parse(
      (await get(otherSupervisor, `/api/v1/supplier/henkatens/${henkatenId}`)).body,
    );
    expect(detail.permissions).toEqual({
      assigned: false,
      canDecide: false,
      canWithdraw: false,
      canClone: false,
      canReroute: false,
    });
    const owner = henkatenDetailSchema.parse(
      (await get(assignedSupervisor, `/api/v1/supplier/henkatens/${henkatenId}`)).body,
    );
    expect(owner.permissions).toMatchObject({ assigned: true, canDecide: true });
    const leader = henkatenDetailSchema.parse(
      (await get(otherLeader, `/api/v1/supplier/henkatens/${henkatenId}`)).body,
    );
    expect(leader.permissions).toMatchObject({ assigned: false, canWithdraw: false });

    const clone = await get(otherLeader, `/api/v1/supplier/henkatens/${henkatenId}/clone-prefill`);
    expect(clone.status).toBe(404);

    const board = assignmentBoardSchema.parse(
      (await get(otherSupervisor, '/api/v1/supplier/assignment-board?shiftStatus=ALL')).body,
    );
    expect(board.lines.find((line) => line.lineId === lineId)?.assigned).toBe(false);
    const ownBoard = assignmentBoardSchema.parse(
      (
        await get(
          otherSupervisor,
          '/api/v1/supplier/assignment-board?shiftStatus=ALL&scope=ASSIGNED',
        )
      ).body,
    );
    expect(ownBoard.lines.some((line) => line.lineId === lineId)).toBe(false);
  });

  it('lets the assigned Supervisor edit the board layout and keeps others read-only', async () => {
    const path = `/api/v1/supplier/assignment-board/layouts/${lineId}`;
    const readOnly = boardLayoutResponseSchema.parse((await get(otherSupervisor, path)).body);
    expect(readOnly.canEdit).toBe(false);
    const editable = boardLayoutResponseSchema.parse((await get(assignedSupervisor, path)).body);
    expect(editable.canEdit).toBe(true);
    const body = { expectedVersion: editable.version, document: editable.document };
    const denied = await http()
      .put(path)
      .set('Origin', origin)
      .set('Cookie', otherSupervisor.cookie)
      .set('X-CSRF-Token', otherSupervisor.csrf)
      .send(body);
    expect(denied.status).toBe(403);
    const saved = await http()
      .put(path)
      .set('Origin', origin)
      .set('Cookie', assignedSupervisor.cookie)
      .set('X-CSRF-Token', assignedSupervisor.csrf)
      .send(body);
    expect(saved.status).toBeLessThan(300);
  });

  it('blocks deleting a line with Open Henkaten and lists them', async () => {
    const preview = masterDeletePreviewSchema.parse(
      (await get(admin, `${base}/lines/${lineId}/delete-preview`)).body,
    );
    expect(preview.openHenkatenTotal).toBe(1);
    expect(preview.openHenkatens[0]?.id).toBe(henkatenId);
    expect(preview.canDelete).toBe(false);
    expect(preview.impact).toMatchObject({ jobs: 1, lineShifts: 1 });
    const denied = await post(admin, `${base}/lines/${lineId}/delete`, {
      expectedVersion: preview.resource.version,
      mode: 'ARCHIVE',
    });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('RESOURCE_IN_USE');
  });

  it('archives a line with its jobs and assignments, then frees the code on permanent delete', async () => {
    await prisma.henkaten.update({
      where: { id: henkatenId },
      data: { status: 'CANCELLED', cancellationReason: 'WITHDRAWN', finalizedAt: new Date() },
    });
    const preview = masterDeletePreviewSchema.parse(
      (await get(admin, `${base}/lines/${lineId}/delete-preview`)).body,
    );
    expect(preview.canArchive).toBe(true);
    const archived = await post(admin, `${base}/lines/${lineId}/delete`, {
      expectedVersion: preview.resource.version,
      mode: 'ARCHIVE',
    });
    expect(archived.status).toBe(201);
    const [line, job, lineShift, leaders, assignment] = await Promise.all([
      prisma.line.findUniqueOrThrow({ where: { id: lineId } }),
      prisma.job.findUniqueOrThrow({ where: { id: jobId } }),
      prisma.lineShift.findUniqueOrThrow({ where: { id: lineShiftId } }),
      prisma.lineShiftLineLeader.count({ where: { lineShiftId } }),
      prisma.lineShiftJobAssignment.findFirstOrThrow({ where: { lineShiftId } }),
    ]);
    expect(line).toMatchObject({ active: false, deletedAt: null });
    expect(job.active).toBe(false);
    expect(lineShift).toMatchObject({ active: false, supervisorMemberId: null });
    expect(leaders).toBe(0);
    expect(assignment.mpMemberId).toBeNull();

    const reserved = await post(admin, `${base}/lines`, { code: 'DEL-L1', name: 'Again' });
    expect(reserved.status).toBe(409);

    const again = masterDeletePreviewSchema.parse(
      (await get(admin, `${base}/lines/${lineId}/delete-preview`)).body,
    );
    expect(again.canArchive).toBe(false);
    const removed = await post(admin, `${base}/lines/${lineId}/delete`, {
      expectedVersion: again.resource.version,
      mode: 'PERMANENT',
    });
    expect(removed.status).toBe(201);
    expect((await get(admin, `${base}/lines/${lineId}`)).status).toBe(404);
    const recreated = await post(admin, `${base}/lines`, { code: 'DEL-L1', name: 'Again' });
    expect(recreated.status).toBe(201);
    // Henkaten history keeps its snapshot of the removed line.
    const history = await prisma.henkaten.findUniqueOrThrow({ where: { id: henkatenId } });
    expect(history.lineCodeSnapshot).toBe('DEL-L1');
  });

  it('frees a registration number and username when a member is permanently deleted', async () => {
    const created = await post(admin, `${base}/members`, {
      fullName: 'Supervisor Sementara',
      registrationNumber: 'TEMP-001',
      role: 'SUPERVISOR',
      username: 'temp-spv',
    });
    expect(created.status).toBe(201);
    const memberId = created.body.member.id as string;
    const preview = masterDeletePreviewSchema.parse(
      (await get(admin, `${base}/members/${memberId}/delete-preview`)).body,
    );
    expect(preview.impact.accountUsername).toBe('temp-spv');
    const removed = await post(admin, `${base}/members/${memberId}/delete`, {
      expectedVersion: preview.resource.version,
      mode: 'PERMANENT',
    });
    expect(removed.status).toBe(201);
    const user = await prisma.user.findFirstOrThrow({ where: { memberId } });
    expect(user.status).toBe('INACTIVE');
    expect(user.deletedAt).not.toBeNull();
    const reused = await post(admin, `${base}/members`, {
      fullName: 'Supervisor Baru',
      registrationNumber: 'TEMP-001',
      role: 'SUPERVISOR',
      username: 'temp-spv',
    });
    expect(reused.status).toBe(201);
  });

  it('frees a part number on permanent delete', async () => {
    const part = await post(admin, `${base}/parts`, { partNumber: 'DEL-P-1', partName: 'Bracket' });
    expect(part.status).toBe(201);
    const removed = await post(admin, `${base}/parts/${part.body.id}/delete`, {
      expectedVersion: part.body.version,
      mode: 'PERMANENT',
    });
    expect(removed.status).toBe(201);
    const reused = await post(admin, `${base}/parts`, {
      partNumber: 'DEL-P-1',
      partName: 'Bracket',
    });
    expect(reused.status).toBe(201);
  });

  it('rotates shift hours on demand and on schedule, once per slot', async () => {
    const night = await post(admin, `${base}/shift-templates`, {
      name: 'Shift Malam',
      timezone: 'Asia/Jakarta',
      weeklySchedule: everyDay('20:00', '05:00'),
    });
    const day = await post(admin, `${base}/shift-templates`, {
      name: 'Shift Siang',
      timezone: 'Asia/Jakarta',
      weeklySchedule: weekdays('08:00', '17:00'),
    });
    expect(night.status).toBe(201);
    expect(day.status).toBe(201);
    const created = await post(admin, `${base}/shift-rotations`, {
      name: 'Rotasi mingguan',
      shiftTemplateIds: [day.body.id, night.body.id],
      dayOfWeek: 1,
      executeTime: '06:00',
      timezone: 'Asia/Jakarta',
    });
    expect(created.status).toBe(201);
    const rotation = shiftRotationSchema.parse(created.body);
    expect(rotation.nextRunAt).not.toBeNull();

    const overlap = await post(admin, `${base}/shift-rotations`, {
      name: 'Bentrok',
      shiftTemplateIds: [night.body.id, day.body.id],
      dayOfWeek: 3,
      executeTime: '06:00',
      timezone: 'Asia/Jakarta',
    });
    expect(overlap.status).toBe(409);

    const run = await post(admin, `${base}/shift-rotations/${rotation.id}/run`, {
      expectedVersion: rotation.version,
    });
    expect(run.status).toBe(201);
    const dayAfter = shiftTemplateSchema.parse(
      (await get(admin, `${base}/shift-templates/${day.body.id}`)).body,
    );
    expect(dayAfter.isUniform).toBe(true);
    expect(dayAfter.startTime).toBe('20:00');
    const nightAfter = shiftTemplateSchema.parse(
      (await get(admin, `${base}/shift-templates/${night.body.id}`)).body,
    );
    expect(nightAfter.weeklySchedule[5]?.isOff).toBe(true);

    const past = new Date(Date.now() - 20 * 86_400_000);
    await prisma.shiftRotationSchedule.update({
      where: { id: rotation.id },
      data: { nextRunAt: past },
    });
    const service = app.get(ShiftRotationService);
    const now = new Date();
    expect(await service.runDue(now)).toBe(1);
    expect(await service.runDue(now)).toBe(0);
    const stored = await prisma.shiftRotationSchedule.findUniqueOrThrow({
      where: { id: rotation.id },
      include: { executions: true },
    });
    expect(stored.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(stored.executions.map((execution) => execution.trigger).sort()).toEqual([
      'MANUAL',
      'SCHEDULE',
    ]);
    const restored = shiftTemplateSchema.parse(
      (await get(admin, `${base}/shift-templates/${day.body.id}`)).body,
    );
    expect(restored.weeklySchedule[5]?.isOff).toBe(true);

    const archive = masterDeletePreviewSchema.parse(
      (await get(admin, `${base}/shift-templates/${night.body.id}/delete-preview`)).body,
    );
    expect(archive.impact.rotationSchedules.map(({ id }) => id)).toEqual([rotation.id]);
    const archived = await post(admin, `${base}/shift-templates/${night.body.id}/delete`, {
      expectedVersion: archive.resource.version,
      mode: 'ARCHIVE',
    });
    expect(archived.status).toBe(201);
    const paused = await prisma.shiftRotationSchedule.findUniqueOrThrow({
      where: { id: rotation.id },
    });
    expect(paused.enabled).toBe(false);
  });
});
