import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantScope } from '../common/scope.js';
import { PrismaClient } from '../generated/prisma/client.js';

const databaseUrl =
  process.env['DATABASE_URL'] ??
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

describe('platform persistence foundation', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces realm and supplier constraints in PostgreSQL', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "User" (
          id, realm, role, username, "normalizedUsername", "displayName",
          "passwordHash", "updatedAt"
        ) VALUES (
          ${randomUUID()}::uuid, 'SUPPLIER', 'SUPPLIER_ADMIN',
          'invalid', ${`invalid-${randomUUID()}`}, 'Invalid', 'not-a-real-hash', now()
        )
      `,
    ).rejects.toThrow();
  });

  it('makes audit records append-only at database level', async () => {
    const event = await prisma.auditEvent.create({
      data: {
        actorKind: 'SYSTEM',
        action: 'INTEGRATION_AUDIT_TEST',
        resourceType: 'Test',
        correlationId: randomUUID(),
        result: 'SUCCESS',
      },
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: event.id },
        data: { action: 'MUTATED' },
      }),
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it('rolls back outbox records with their domain transaction', async () => {
    const eventId = randomUUID();
    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.outboxEvent.create({
          data: {
            id: eventId,
            eventType: 'ROLLBACK_TEST',
            schemaVersion: 1,
            aggregateType: 'Test',
            aggregateId: randomUUID(),
            aggregateVersion: 1,
            actor: {},
            correlationId: randomUUID(),
            payload: {},
          },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(prisma.outboxEvent.findUnique({ where: { id: eventId } })).resolves.toBeNull();
  });

  it('supports explicit tenant scopes without cross-tenant matching', async () => {
    const supplierA = await prisma.supplier.create({
      data: {
        code: `A-${randomUUID()}`,
        normalizedCode: `a-${randomUUID()}`,
        name: 'Tenant A',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    const supplierB = await prisma.supplier.create({
      data: {
        code: `B-${randomUUID()}`,
        normalizedCode: `b-${randomUUID()}`,
        name: 'Tenant B',
        timezone: 'Asia/Jakarta',
        sourceMode: 'HOSTED',
      },
    });
    const user = await prisma.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId: supplierA.id,
        role: 'SUPPLIER_ADMIN',
        username: 'admin-a',
        normalizedUsername: `admin-a-${randomUUID()}`,
        displayName: 'Test Admin A',
        passwordHash: 'integration-only-hash',
      },
    });
    const scopeB = new TenantScope(supplierB.id);
    const outsideTenant = await prisma.user.findFirst({
      where: { id: user.id, supplierId: scopeB.supplierId },
    });
    expect(outsideTenant).toBeNull();
  });
});
