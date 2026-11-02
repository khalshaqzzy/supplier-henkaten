import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangeMemberRoleRequest } from '@tmmin-henkaten/contracts';
import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { cookieName } from '../auth/auth.guards.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { correlationMiddleware } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { HenkatenService } from '../henkaten/henkaten.service.js';
import { ApprovalService } from '../henkaten/approval.service.js';
import { MemberRoleService } from './member-role.service.js';

type Role = ChangeMemberRoleRequest['role'];
const origin = 'http://localhost:5173';
describe('reviewed member role handover', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let roles: MemberRoleService;
  let passwordHash: string;
  beforeAll(async () => {
    process.env['OUTBOX_ENABLED'] = 'false';
    process.env['PCR_WORKER_ENABLED'] = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    roles = app.get(MemberRoleService);
    passwordHash = await app.get(PasswordService).hash('Role-Handover-Password-123');
  });
  afterAll(async () => app?.close());

  async function fixture() {
    const code = `ROLE-${randomUUID()}`;
    const supplier = await prisma.supplier.create({
      data: {
        code,
        normalizedCode: code.toLowerCase(),
        name: 'Role handover integration',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    const admin = await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId: supplier.id,
        role: 'SUPPLIER_ADMIN',
        username: code,
        normalizedUsername: code.toLowerCase(),
        displayName: 'Role Admin',
        passwordHash,
        mustChangePassword: false,
      },
    });
    const session = await sessions.create(admin, supplier.sourceEpoch, 'NORMAL', {});
    const principal = (await sessions.resolve(session.rawToken, 'SUPPLIER'))!;
    const scope = new TenantScope(supplier.id);
    const context = {
      actorUserId: admin.id,
      actorRole: 'SUPPLIER_ADMIN' as const,
      actorSupplierId: supplier.id,
      correlationId: randomUUID(),
    };
    const member = async (role: Role, active = true) => {
      const reg = randomUUID();
      const m = await prisma.member.create({
        data: {
          supplierId: supplier.id,
          role,
          active,
          fullName: `Member ${role} ${reg.slice(0, 8)}`,
          registrationNumber: reg,
          normalizedRegistrationNumber: reg,
        },
      });
      const user = await prisma.user.create({
        data: {
          supplierId: supplier.id,
          realm: 'SUPPLIER',
          memberId: m.id,
          role,
          username: reg,
          normalizedUsername: reg,
          displayName: m.fullName,
          passwordHash,
          mustChangePassword: false,
          status: active ? 'ACTIVE' : 'INACTIVE',
        },
      });
      return { member: m, user };
    };
    const apply = async (
      id: string,
      role: Role,
      replacements: string[] = [],
      key = randomUUID(),
    ) => {
      const preview = await roles.preview(scope, id, role);
      const body = {
        role,
        revision: preview.revision,
        reason: 'Perubahan penugasan',
        handovers: preview.dependencies.map((d, i) => ({
          kind: d.kind,
          id: d.id,
          replacementMemberId: replacements[i] ?? replacements[0]!,
        })),
      };
      const result = await roles.change(scope, id, body, key, principal, context);
      return { result, body, key };
    };
    const post = (path: string, body: unknown, key = randomUUID()) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set(
          'Cookie',
          `${cookieName('SUPPLIER', app.get<AppConfig>(APP_CONFIG))}=${session.rawToken}`,
        )
        .set('X-CSRF-Token', sessions.csrfToken(session.rawToken, session.id, 'SUPPLIER'))
        .set('Idempotency-Key', key)
        .send(body as object);
    return { supplier, admin, session, scope, principal, context, member, apply, post };
  }

  for (const from of ['LINE_LEADER', 'SUPERVISOR', 'QC'] as const)
    for (const to of ['LINE_LEADER', 'SUPERVISOR', 'QC'] as const) {
      if (from === to) continue;
      it(`${from} -> ${to} keeps person, login and password while revoking old authority`, async () => {
        const f = await fixture();
        const old = await f.member(from);
        const oldSession = await sessions.create(old.user, f.supplier.sourceEpoch, 'NORMAL', {});
        const beforeCount = await prisma.member.count({ where: { supplierId: f.supplier.id } });
        const changed = await f.apply(old.member.id, to);
        expect(changed.result.member).toMatchObject({
          id: old.member.id,
          role: to,
          registrationNumber: old.member.registrationNumber,
          active: true,
          account: { id: old.user.id, username: old.user.username, status: 'ACTIVE' },
        });
        expect(await prisma.user.findUnique({ where: { id: old.user.id } })).toMatchObject({
          role: to,
          passwordHash,
          mustChangePassword: false,
          authorizationEpoch: old.user.authorizationEpoch + 1,
        });
        expect(await sessions.resolve(oldSession.rawToken, 'SUPPLIER')).toBeNull();
        const next = await sessions.create(
          await prisma.user.findUniqueOrThrow({ where: { id: old.user.id } }),
          f.supplier.sourceEpoch,
          'NORMAL',
          {},
        );
        expect(await sessions.resolve(next.rawToken, 'SUPPLIER')).toMatchObject({ role: to });
        expect(await prisma.member.count({ where: { supplierId: f.supplier.id } })).toBe(
          beforeCount,
        );
        const replay = await roles.change(
          f.scope,
          old.member.id,
          changed.body,
          changed.key,
          f.principal,
          f.context,
        );
        expect(replay.commandId).toBe(changed.result.commandId);
        expect(await prisma.memberRoleChange.count({ where: { memberId: old.member.id } })).toBe(1);
        await expect(
          roles.change(
            f.scope,
            old.member.id,
            { ...changed.body, reason: 'Different' },
            changed.key,
            f.principal,
            f.context,
          ),
        ).rejects.toMatchObject({ problem: { code: 'IDEMPOTENCY_CONFLICT' } });
      });
    }

  it('keeps archived account inactive, then supports restore and explicit activation', async () => {
    const f = await fixture();
    const old = await f.member('LINE_LEADER', false);
    await prisma.user.update({
      where: { id: old.user.id },
      data: { failedLoginCount: 10, lockedUntil: new Date(Date.now() + 600000) },
    });
    const changed = await f.apply(old.member.id, 'SUPERVISOR');
    expect(changed.result.member).toMatchObject({ active: false, account: { status: 'INACTIVE' } });
    const base = `/api/v1/supplier/master-data/members/${old.member.id}`;
    expect(
      (
        await f.post(`${base}/account/activate`, {
          expectedVersion: changed.result.member.account!.version,
        })
      ).status,
    ).toBe(409);
    const restored = await f.post(`${base}/activate`, {
      expectedVersion: changed.result.member.version,
    });
    expect(restored.status).toBe(201);
    expect(restored.body.account.status).toBe('INACTIVE');
    const activated = await f.post(`${base}/account/activate`, {
      expectedVersion: restored.body.account.version,
    });
    expect(activated.status).toBe(201);
    expect(activated.body.member.account).toMatchObject({
      status: 'ACTIVE',
      mustChangePassword: true,
    });
    expect(activated.body.credential.temporaryPassword).toBeTypeOf('string');
    expect(await prisma.user.findUnique({ where: { id: old.user.id } })).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
    });
    expect(
      (await f.post(`${base}/account/activate`, { expectedVersion: restored.body.account.version }))
        .status,
    ).toBe(409);
  });

  it('rejects stale reviews, unrecorded SQL updates, MP targets and non-admin routes', async () => {
    const f = await fixture();
    const old = await f.member('LINE_LEADER');
    const preview = await roles.preview(f.scope, old.member.id, 'QC');
    await prisma.user.update({ where: { id: old.user.id }, data: { version: { increment: 1 } } });
    await expect(
      roles.change(
        f.scope,
        old.member.id,
        { role: 'QC', revision: preview.revision, reason: 'Stale', handovers: [] },
        randomUUID(),
        f.principal,
        f.context,
      ),
    ).rejects.toMatchObject({ problem: { code: 'VERSION_CONFLICT' } });
    await expect(
      prisma.member.update({ where: { id: old.member.id }, data: { role: 'QC' } }),
    ).rejects.toThrow();
    expect(
      (
        await f.post(`/api/v1/supplier/master-data/members/${old.member.id}/role/preview`, {
          role: 'MP',
        })
      ).status,
    ).toBe(400);
    const wrong = await fixture();
    expect(
      (
        await wrong.post(`/api/v1/supplier/master-data/members/${old.member.id}/role/preview`, {
          role: 'QC',
        })
      ).status,
    ).toBe(404);
    const token = await sessions.create(old.user, f.supplier.sourceEpoch, 'NORMAL', {});
    const denied = await request(app.getHttpServer())
      .post(`/api/v1/supplier/master-data/members/${old.member.id}/role/preview`)
      .set('Origin', origin)
      .set('Cookie', `${cookieName('SUPPLIER', app.get<AppConfig>(APP_CONFIG))}=${token.rawToken}`)
      .set('X-CSRF-Token', sessions.csrfToken(token.rawToken, token.id, 'SUPPLIER'))
      .send({ role: 'QC' });
    expect(denied.status).toBe(403);
  });

  async function graph(
    f: Awaited<ReturnType<typeof fixture>>,
    source: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['member']>>,
  ) {
    const leader = source.member.role === 'LINE_LEADER' ? source : await f.member('LINE_LEADER');
    const supervisor = source.member.role === 'SUPERVISOR' ? source : await f.member('SUPERVISOR');
    const line = await prisma.line.create({
      data: {
        supplierId: f.supplier.id,
        code: randomUUID(),
        normalizedCode: randomUUID(),
        name: 'Assembly',
        displayOrder: 1,
      },
    });
    const shift = await prisma.shiftTemplate.create({
      data: {
        supplierId: f.supplier.id,
        name: 'Morning',
        startMinute: 0,
        endMinute: 1439,
        displayOrder: 1,
        timezone: 'Asia/Jakarta',
      },
    });
    const ls = await prisma.lineShift.create({
      data: {
        supplierId: f.supplier.id,
        lineId: line.id,
        shiftTemplateId: shift.id,
        lineLeaderMemberId: leader.member.id,
        supervisorMemberId: supervisor.member.id,
      },
    });
    const job = await prisma.job.create({
      data: {
        supplierId: f.supplier.id,
        lineId: line.id,
        name: 'Welding',
        normalizedName: 'welding',
        displayOrder: 1,
      },
    });
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 3_600_000);
    const run = await prisma.shiftRun.create({
      data: {
        supplierId: f.supplier.id,
        lineId: line.id,
        shiftTemplateId: shift.id,
        businessDate: new Date('2026-11-02'),
        scheduledStartAt: start,
        scheduledEndAt: end,
        timezoneSnapshot: 'Asia/Jakarta',
        lineCodeSnapshot: line.code,
        lineNameSnapshot: line.name,
        shiftNameSnapshot: shift.name,
        shiftStartMinuteSnapshot: 0,
        shiftEndMinuteSnapshot: 1439,
        defaultAssignmentSetVersion: 1,
        latestPreflight: {},
        latestPreflightAt: new Date(),
        sourceEpoch: f.supplier.sourceEpoch,
        lineLeaderMemberId: leader.member.id,
        supervisorMemberId: supervisor.member.id,
      },
    });
    const h = await prisma.henkaten.create({
      data: {
        supplierId: f.supplier.id,
        shiftRunId: run.id,
        lineShiftId: ls.id,
        lineId: line.id,
        jobId: job.id,
        identifier: `ROLE-${randomUUID()}`,
        dailySequence: 1,
        sourceMode: 'HOSTED',
        sourceEpoch: f.supplier.sourceEpoch,
        category: 'MACHINE',
        businessDate: new Date('2026-11-02'),
        timezoneSnapshot: 'Asia/Jakarta',
        shiftNameSnapshot: shift.name,
        lineCodeSnapshot: line.code,
        lineNameSnapshot: line.name,
        jobNameSnapshot: job.name,
        partNumberSnapshot: 'Other',
        normalizedPartNumberSnapshot: 'other',
        partNameSnapshot: 'Other',
        creatorMemberId: leader.member.id,
        creatorNameSnapshot: leader.member.fullName,
        affectedObject: 'Old machine',
        replacementObject: 'New machine',
        cause: 'Machine change',
        detail: 'Operational review',
        occurredAt: new Date(),
        effectiveStartAt: start,
        effectiveEndAt: end,
        submissionKey: randomUUID(),
        submissionPayloadHash: 'a'.repeat(64),
        createdById: leader.user.id,
        approvalRoutes: {
          create: [
            {
              route: 'SUPERVISOR',
              initialResponsibleMemberId: supervisor.member.id,
              currentResponsibleMemberId: supervisor.member.id,
              initialResponsibleNameSnapshot: supervisor.member.fullName,
              currentResponsibleNameSnapshot: supervisor.member.fullName,
            },
            { route: 'QC' },
          ],
        },
      },
    });
    return { h, run, ls, leader, supervisor };
  }

  it('transfers LL Open authority twice without rewriting creator/occurrence and denies queued old writes', async () => {
    const f = await fixture();
    const source = await f.member('LINE_LEADER');
    const g = await graph(f, source);
    const replacement = await f.member('LINE_LEADER');
    const oldToken = await sessions.create(source.user, f.supplier.sourceEpoch, 'NORMAL', {});
    const oldPrincipal = (await sessions.resolve(oldToken.rawToken, 'SUPPLIER'))!;
    await f.apply(source.member.id, 'SUPERVISOR', [replacement.member.id]);
    expect(await prisma.lineShift.findUnique({ where: { id: g.ls.id } })).toMatchObject({
      lineLeaderMemberId: replacement.member.id,
    });
    expect(await prisma.henkaten.findUnique({ where: { id: g.h.id } })).toMatchObject({
      creatorMemberId: source.member.id,
      creatorNameSnapshot: source.member.fullName,
      createdById: source.user.id,
    });
    expect(await prisma.shiftRun.findUnique({ where: { id: g.run.id } })).toMatchObject({
      lineLeaderMemberId: source.member.id,
    });
    const nextReplacement = await f.member('LINE_LEADER');
    await f.apply(replacement.member.id, 'QC', [nextReplacement.member.id]);
    const token = await sessions.create(nextReplacement.user, f.supplier.sourceEpoch, 'NORMAL', {});
    const owner = (await sessions.resolve(token.rawToken, 'SUPPLIER'))!;
    const service = app.get(HenkatenService);
    const detail = await service.get(f.scope, g.h.id, owner);
    await expect(
      service.withdraw(
        f.scope,
        g.h.id,
        { expectedVersion: detail.version, reason: 'Wrong old authority' },
        oldPrincipal,
        { ...f.context, actorUserId: source.user.id, actorRole: 'LINE_LEADER' },
      ),
    ).rejects.toMatchObject({ problem: { code: 'FORBIDDEN' } });
    const withdrawn = await service.withdraw(
      f.scope,
      g.h.id,
      { expectedVersion: detail.version, reason: 'Withdraw by new LL' },
      owner,
      { ...f.context, actorUserId: owner.userId, actorRole: 'LINE_LEADER' },
    );
    expect(withdrawn.status).toBe('CANCELLED');
  });

  it('transfers pending Supervisor approval and preserves the original routing evidence', async () => {
    const f = await fixture();
    const source = await f.member('SUPERVISOR');
    const g = await graph(f, source);
    const replacement = await f.member('SUPERVISOR');
    const preview = await roles.preview(f.scope, source.member.id, 'QC');
    const invalid = {
      role: 'QC' as const,
      revision: preview.revision,
      reason: 'Missing mapping',
      handovers: [],
    };
    await expect(
      roles.change(f.scope, source.member.id, invalid, randomUUID(), f.principal, f.context),
    ).rejects.toThrow();
    expect(await prisma.memberRoleChange.count({ where: { memberId: source.member.id } })).toBe(0);
    expect(await prisma.lineShift.findUnique({ where: { id: g.ls.id } })).toMatchObject({
      supervisorMemberId: source.member.id,
    });
    await f.apply(source.member.id, 'QC', [replacement.member.id]);
    const route = await prisma.henkatenApprovalRoute.findUniqueOrThrow({
      where: { henkatenId_route: { henkatenId: g.h.id, route: 'SUPERVISOR' } },
    });
    expect(route).toMatchObject({
      initialResponsibleMemberId: source.member.id,
      currentResponsibleMemberId: replacement.member.id,
      status: 'PENDING',
    });
    const token = await sessions.create(replacement.user, f.supplier.sourceEpoch, 'NORMAL', {});
    const p = (await sessions.resolve(token.rawToken, 'SUPPLIER'))!;
    const current = await prisma.henkaten.findUniqueOrThrow({ where: { id: g.h.id } });
    const approved = await app
      .get(ApprovalService)
      .decide(
        f.scope,
        g.h.id,
        { expectedVersion: current.version, decision: 'APPROVED' },
        randomUUID(),
        p,
        { ...f.context, actorUserId: p.userId, actorRole: 'SUPERVISOR' },
      );
    expect(approved.routes.supervisor.decision?.actorRole).toBe('SUPERVISOR');
    expect(await prisma.approvalRouteRouting.count({ where: { henkatenId: g.h.id } })).toBe(1);
  });

  it('prevents the last QC abandoning pending work, permits coverage and retains creator self-approval policy', async () => {
    const f = await fixture();
    const qc = await f.member('QC');
    const creator = await f.member('LINE_LEADER');
    const g = await graph(f, creator);
    expect((await roles.preview(f.scope, qc.member.id, 'SUPERVISOR')).blockers).not.toHaveLength(0);
    const ll = await f.member('LINE_LEADER');
    await f.apply(creator.member.id, 'QC', [ll.member.id]);
    await f.apply(qc.member.id, 'SUPERVISOR');
    const creatorUser = await prisma.user.findUniqueOrThrow({ where: { id: creator.user.id } });
    const token = await sessions.create(creatorUser, f.supplier.sourceEpoch, 'NORMAL', {});
    const p = (await sessions.resolve(token.rawToken, 'SUPPLIER'))!;
    const h = await prisma.henkaten.findUniqueOrThrow({ where: { id: g.h.id } });
    const decision = await app
      .get(ApprovalService)
      .decide(
        f.scope,
        g.h.id,
        { expectedVersion: h.version, decision: 'APPROVED' },
        randomUUID(),
        p,
        { ...f.context, actorUserId: p.userId, actorRole: 'QC' },
      );
    expect(decision.routes.qc.decision?.actorRole).toBe('QC');
  });

  it('rejects missing, duplicate, extra, cross-role and foreign handovers with no partial changes', async () => {
    const f = await fixture();
    const source = await f.member('LINE_LEADER');
    const g = await graph(f, source);
    const replacement = await f.member('LINE_LEADER');
    const wrongRole = await f.member('QC');
    const foreign = await fixture();
    const foreignMember = await foreign.member('LINE_LEADER');
    const review = await roles.preview(f.scope, source.member.id, 'SUPERVISOR');
    const valid = review.dependencies.map((d) => ({
      kind: d.kind,
      id: d.id,
      replacementMemberId: replacement.member.id,
    }));
    for (const handovers of [
      [],
      [...valid, valid[0]!],
      [
        ...valid,
        { kind: 'HENKATEN' as const, id: randomUUID(), replacementMemberId: replacement.member.id },
      ],
      valid.map((d) => ({ ...d, replacementMemberId: wrongRole.member.id })),
      valid.map((d) => ({ ...d, replacementMemberId: foreignMember.member.id })),
    ]) {
      await expect(
        roles.change(
          f.scope,
          source.member.id,
          { role: 'SUPERVISOR', revision: review.revision, reason: 'Invalid mapping', handovers },
          randomUUID(),
          f.principal,
          f.context,
        ),
      ).rejects.toThrow();
    }
    expect(await prisma.memberRoleChange.count({ where: { memberId: source.member.id } })).toBe(0);
    expect(await prisma.lineShift.findUnique({ where: { id: g.ls.id } })).toMatchObject({
      lineLeaderMemberId: source.member.id,
    });
    expect(await prisma.member.findUnique({ where: { id: source.member.id } })).toMatchObject({
      role: 'LINE_LEADER',
    });
  });

  it('rejects an occupied replacement LL and stale work introduced after review', async () => {
    const f = await fixture();
    const source = await f.member('LINE_LEADER');
    const g = await graph(f, source);
    const occupied = await f.member('LINE_LEADER');
    await graph(f, occupied);
    const available = await f.member('LINE_LEADER');
    const review = await roles.preview(f.scope, source.member.id, 'SUPERVISOR');
    expect(review.candidates.find((c) => c.id === occupied.member.id)?.available).toBe(false);
    const body = {
      role: 'SUPERVISOR' as const,
      revision: review.revision,
      reason: 'Handover',
      handovers: review.dependencies.map((d) => ({
        kind: d.kind,
        id: d.id,
        replacementMemberId: occupied.member.id,
      })),
    };
    await expect(
      roles.change(f.scope, source.member.id, body, randomUUID(), f.principal, f.context),
    ).rejects.toThrow();
    await prisma.henkaten.update({ where: { id: g.h.id }, data: { version: { increment: 1 } } });
    await expect(
      roles.change(
        f.scope,
        source.member.id,
        {
          ...body,
          handovers: body.handovers.map((d) => ({
            ...d,
            replacementMemberId: available.member.id,
          })),
        },
        randomUUID(),
        f.principal,
        f.context,
      ),
    ).rejects.toMatchObject({ problem: { code: 'VERSION_CONFLICT' } });
  });

  it('supports preparation and delegated Admin boundaries with operator attribution', async () => {
    const f = await fixture();
    const source = await f.member('LINE_LEADER');
    await prisma.supplier.update({
      where: { id: f.supplier.id },
      data: { sourceMode: 'EXTERNAL' },
    });
    const prep = await prisma.hostedPreparation.create({
      data: {
        supplierId: f.supplier.id,
        sourceEpoch: f.supplier.sourceEpoch,
        adminUserId: f.admin.id,
        startedById: f.admin.id,
        reason: 'Preparation test',
        privacyAcknowledgedAt: new Date(),
      },
    });
    const token = await sessions.create(f.admin, f.supplier.sourceEpoch, 'HOSTED_PREPARATION', {});
    const p = (await sessions.resolve(token.rawToken, 'SUPPLIER'))!;
    const review = await roles.preview(f.scope, source.member.id, 'SUPERVISOR');
    await roles.change(
      f.scope,
      source.member.id,
      {
        role: 'SUPERVISOR',
        revision: review.revision,
        reason: 'Preparation correction',
        handovers: [],
      },
      randomUUID(),
      p,
      f.context,
    );
    await prisma.hostedPreparation.update({
      where: { id: prep.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: f.admin.id },
    });
    const nextReview = await roles.preview(f.scope, source.member.id, 'QC');
    await expect(
      roles.change(
        f.scope,
        source.member.id,
        { role: 'QC', revision: nextReview.revision, reason: 'Expired preparation', handovers: [] },
        randomUUID(),
        p,
        f.context,
      ),
    ).rejects.toThrow();
    await prisma.supplier.update({ where: { id: f.supplier.id }, data: { sourceMode: 'HOSTED' } });
    const actor = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username: randomUUID(),
        normalizedUsername: randomUUID(),
        displayName: 'Support operator',
        passwordHash,
        mustChangePassword: false,
      },
    });
    const actorSession = await sessions.create(actor, null, 'NORMAL', {});
    await prisma.user.update({ where: { id: f.admin.id }, data: { mustChangePassword: true } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: f.admin.id } });
    const delegated = await sessions.create(
      admin,
      f.supplier.sourceEpoch,
      'NORMAL',
      {},
      actor.id,
      actorSession.id,
    );
    const support = (await sessions.resolve(delegated.rawToken, 'SUPPLIER'))!;
    const currentReview = await roles.preview(f.scope, source.member.id, 'QC');
    const result = await roles.change(
      f.scope,
      source.member.id,
      { role: 'QC', revision: currentReview.revision, reason: 'Support correction', handovers: [] },
      randomUUID(),
      support,
      f.context,
    );
    expect(result.member.role).toBe('QC');
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        supplierId: f.supplier.id,
        action: 'MEMBER_ROLE_CHANGED',
        resourceId: source.member.id,
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit.changeSummary).toMatchObject({ operatorUserId: actor.id });
  });

  it('rolls back completed handovers, role, session revocation and receipt if audit persistence fails', async () => {
    const f = await fixture();
    const source = await f.member('LINE_LEADER');
    const g = await graph(f, source);
    const replacement = await f.member('LINE_LEADER');
    const token = await sessions.create(source.user, f.supplier.sourceEpoch, 'NORMAL', {});
    const audit = vi
      .spyOn(app.get(AuditWriter), 'write')
      .mockRejectedValueOnce(new Error('Audit unavailable'));
    try {
      await expect(
        f.apply(source.member.id, 'SUPERVISOR', [replacement.member.id]),
      ).rejects.toThrow('Audit unavailable');
    } finally {
      audit.mockRestore();
    }
    expect(await prisma.lineShift.findUnique({ where: { id: g.ls.id } })).toMatchObject({
      lineLeaderMemberId: source.member.id,
    });
    expect(
      await prisma.henkatenLineLeaderResponsibility.findUnique({ where: { henkatenId: g.h.id } }),
    ).toBeNull();
    expect(await prisma.memberRoleChange.count({ where: { memberId: source.member.id } })).toBe(0);
    expect(await prisma.member.findUnique({ where: { id: source.member.id } })).toMatchObject({
      role: 'LINE_LEADER',
    });
    expect(await sessions.resolve(token.rawToken, 'SUPPLIER')).toMatchObject({
      role: 'LINE_LEADER',
    });
  });

  it('keeps a completed decision role after the actor changes roles', async () => {
    const f = await fixture();
    const qc = await f.member('QC');
    const creator = await f.member('LINE_LEADER');
    const g = await graph(f, creator);
    const token = await sessions.create(qc.user, f.supplier.sourceEpoch, 'NORMAL', {});
    const p = (await sessions.resolve(token.rawToken, 'SUPPLIER'))!;
    await app
      .get(ApprovalService)
      .decide(
        f.scope,
        g.h.id,
        { expectedVersion: g.h.version, decision: 'APPROVED' },
        randomUUID(),
        p,
        { ...f.context, actorUserId: p.userId, actorRole: 'QC' },
      );
    await f.apply(qc.member.id, 'SUPERVISOR');
    const decision = await prisma.approvalDecision.findFirstOrThrow({
      where: { henkatenId: g.h.id, actorUserId: qc.user.id },
    });
    expect(decision.actorRole).toBe('QC');
    expect(await prisma.user.findUnique({ where: { id: qc.user.id } })).toMatchObject({
      role: 'SUPERVISOR',
    });
  });

  it('serializes competing role changes and rejects revoked admin commands without partial writes', async () => {
    const f = await fixture();
    const source = await f.member('LINE_LEADER');
    const a = await roles.preview(f.scope, source.member.id, 'QC');
    const b = await roles.preview(f.scope, source.member.id, 'SUPERVISOR');
    const results = await Promise.allSettled([
      roles.change(
        f.scope,
        source.member.id,
        { role: 'QC', revision: a.revision, reason: 'Concurrent A', handovers: [] },
        randomUUID(),
        f.principal,
        f.context,
      ),
      roles.change(
        f.scope,
        source.member.id,
        { role: 'SUPERVISOR', revision: b.revision, reason: 'Concurrent B', handovers: [] },
        randomUUID(),
        f.principal,
        f.context,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.memberRoleChange.count({ where: { memberId: source.member.id } })).toBe(1);
    const next = await f.member('SUPERVISOR');
    const review = await roles.preview(f.scope, next.member.id, 'QC');
    await prisma.userSession.update({
      where: { id: f.session.id },
      data: { revokedAt: new Date(), revocationReason: 'LOGOUT' },
    });
    await expect(
      roles.change(
        f.scope,
        next.member.id,
        { role: 'QC', revision: review.revision, reason: 'Revoked session', handovers: [] },
        randomUUID(),
        f.principal,
        f.context,
      ),
    ).rejects.toMatchObject({ problem: { code: 'FORBIDDEN' } });
    expect(await prisma.member.findUnique({ where: { id: next.member.id } })).toMatchObject({
      role: 'SUPERVISOR',
    });
  });
});
