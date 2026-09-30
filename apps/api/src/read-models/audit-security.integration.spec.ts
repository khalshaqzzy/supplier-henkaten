import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import { TenantScope } from '../common/scope.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { ReadModelService } from './read-model.service.js';

describe('audit isolation and passive session validation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let foreignId: string;
  let userId: string;
  beforeAll(async () => {
    process.env['OUTBOX_ENABLED'] = 'false';
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
});
