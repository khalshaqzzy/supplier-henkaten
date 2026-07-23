import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { correlationMiddleware } from '../common/request-context.js';
import { ExternalService } from '../external/external.service.js';
import { PrismaService } from '../persistence/prisma.service.js';

const tmminOrigin = 'http://localhost:5174';
const password = 'Compact-Baseline-Password-123';
const supplierCount = 42;
const linesPerSupplier = 20;
const membersPerSupplier = 300;
const jobsPerSupplier = 500;
const projectionsPerSupplier = 500;
const auditsPerSupplier = 1_000;

type Metric = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRate: number;
  targetP95Ms: number;
};

describe('Compact backend performance baseline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string[];
  let csrf: string;
  let baselineSupplierId: string;
  let mutationSupplierId: string;
  let baselineLineId: string;
  let accessToken: string;
  const queryPlans: Record<string, string[]> = {};

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test';
    process.env['SESSION_CSRF_SECRET'] = 'baseline-test-csrf-secret-at-least-32';
    process.env['AUTH_THROTTLE_SECRET'] = 'baseline-test-throttle-secret-at-least-32';
    process.env['OUTBOX_ENABLED'] = 'false';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(correlationMiddleware);
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const databases = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database
    `;
    expect(databases[0]?.database.endsWith('_test')).toBe(true);
    expect(await prisma.supplier.count()).toBe(0);

    const prefix = randomUUID().slice(0, 8);
    await prisma.supplier.createMany({
      data: Array.from({ length: supplierCount }, (_, index) => ({
        code: `BASE-${prefix}-${index}`,
        normalizedCode: `base-${prefix}-${index}`,
        name: `Compact Supplier ${String(index).padStart(2, '0')}`,
        timezone: 'Asia/Jakarta',
        sourceMode: 'EXTERNAL' as const,
        sourceEpoch: 1,
        active: true,
      })),
    });
    const suppliers = await prisma.supplier.findMany({
      where: { normalizedCode: { startsWith: `base-${prefix}-` } },
      orderBy: { normalizedCode: 'asc' },
    });
    baselineSupplierId = suppliers[0]!.id;
    mutationSupplierId = suppliers[1]!.id;

    for (const [supplierIndex, supplier] of suppliers.entries()) {
      await prisma.line.createMany({
        data: Array.from({ length: linesPerSupplier }, (_, index) => ({
          supplierId: supplier.id,
          code: `L-${supplierIndex}-${index}`,
          normalizedCode: `l-${supplierIndex}-${index}`,
          name: `Line ${supplierIndex}-${index}`,
          displayOrder: index + 1,
        })),
      });
      const lines = await prisma.line.findMany({
        where: { supplierId: supplier.id },
        orderBy: { displayOrder: 'asc' },
        select: { id: true },
      });
      if (supplier.id === baselineSupplierId) baselineLineId = lines[0]!.id;
      await prisma.job.createMany({
        data: Array.from({ length: jobsPerSupplier }, (_, index) => ({
          supplierId: supplier.id,
          lineId: lines[index % lines.length]!.id,
          name: `Job ${supplierIndex}-${index}`,
          normalizedName: `job-${supplierIndex}-${index}`,
          displayOrder: index + 1,
        })),
      });
      await prisma.member.createMany({
        data: Array.from({ length: membersPerSupplier }, (_, index) => ({
          supplierId: supplier.id,
          fullName: `Member ${supplierIndex}-${String(index).padStart(3, '0')}`,
          registrationNumber: `REG-${supplierIndex}-${index}`,
          normalizedRegistrationNumber: `reg-${supplierIndex}-${index}`,
          role: index % 10 === 0 ? ('SUPERVISOR' as const) : ('MP' as const),
        })),
      });
      await prisma.externalHenkatenProjection.createMany({
        data: Array.from({ length: projectionsPerSupplier }, (_, index) => ({
          supplierId: supplier.id,
          sourceEpoch: 1,
          sourceHenkatenId: `source-${supplierIndex}-${index}`,
          sourceVersion: 1,
          status: index % 5 === 0 ? ('OPEN' as const) : ('APPROVED' as const),
          category: ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'][index % 4] as
            'MAN' | 'MACHINE' | 'MATERIAL' | 'METHOD',
          occurredAt: new Date(Date.now() - index * 60_000),
          lineSnapshot: { externalId: `L-${supplierIndex}-${index % 20}`, name: 'Line' },
          shiftSnapshot: {
            externalId: 'SHIFT-1',
            name: 'Shift 1',
            businessDate: '2026-07-23',
            timezone: 'Asia/Jakarta',
          },
          jobSnapshot: { externalId: `J-${index}`, name: 'Job' },
          partSnapshot: { number: `PART-${index % 25}`, name: 'Part' },
          changeSnapshot: { affectedObject: 'A', replacementObject: 'B', cause: 'Baseline' },
          checklistSnapshot: { templateVersion: '1', allPassed: true, items: [] },
          decisionsSnapshot: [],
          lastEventId: `seed-event-${supplierIndex}-${index}`,
        })),
      });
      await prisma.auditEvent.createMany({
        data: Array.from({ length: auditsPerSupplier }, (_, index) => ({
          supplierId: supplier.id,
          actorKind: 'SYSTEM',
          action: index % 2 === 0 ? 'BASELINE_READ' : 'BASELINE_MUTATION',
          resourceType: 'CompactFixture',
          resourceId: supplier.id,
          correlationId: `baseline-${supplierIndex}-${index}`,
          result: 'SUCCESS' as const,
          sourceMode: 'EXTERNAL' as const,
          sourceEpoch: 1,
          occurredAt: new Date(Date.now() - index * 1_000),
        })),
      });
    }

    const adminUsername = `baseline-admin-${randomUUID()}`;
    const admin = await prisma.user.create({
      data: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        username: adminUsername,
        normalizedUsername: adminUsername.toLowerCase(),
        displayName: 'Compact Baseline Admin',
        passwordHash: await app.get(PasswordService).hash(password),
        mustChangePassword: false,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/tmmin/login')
      .set('Origin', tmminOrigin)
      .send({ username: adminUsername, password });
    expect(login.status).toBe(200);
    cookie = cookieHeader(login.headers['set-cookie']);
    csrf = login.body.csrfToken as string;

    const external = app.get(ExternalService);
    const credential = await external.createClient(
      baselineSupplierId,
      { name: 'Compact baseline client', ipAllowlist: [] },
      {
        actorUserId: admin.id,
        actorRole: 'TMMIN_ADMIN',
        correlationId: randomUUID(),
        sourceIp: '127.0.0.1',
      },
    );
    const token = await external.token(
      { client_id: credential.client.clientId, client_secret: credential.clientSecret },
      '127.0.0.1',
      randomUUID(),
    );
    accessToken = token.response.access_token;
    await prisma.$executeRaw`ANALYZE`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses bounded indexes for high-cardinality tenant reads', async () => {
    queryPlans.jobs = planNodes(
      await prisma.$queryRaw`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id
        FROM "Job"
        WHERE "supplierId" = ${baselineSupplierId}::uuid
          AND "lineId" = ${baselineLineId}::uuid
          AND active = true
        ORDER BY "displayOrder", id
        LIMIT 100
      `,
    );
    queryPlans.members = planNodes(
      await prisma.$queryRaw`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id
        FROM "Member"
        WHERE "supplierId" = ${baselineSupplierId}::uuid
          AND active = true
        ORDER BY "fullName", id
        LIMIT 100
      `,
    );
    queryPlans.externalProjections = planNodes(
      await prisma.$queryRaw`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id
        FROM "ExternalHenkatenProjection"
        WHERE "supplierId" = ${baselineSupplierId}::uuid
        ORDER BY "updatedAt" DESC, id DESC
        LIMIT 100
      `,
    );
    queryPlans.audit = planNodes(
      await prisma.$queryRaw`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id
        FROM "AuditEvent"
        WHERE "supplierId" = ${baselineSupplierId}::uuid
        ORDER BY "occurredAt" DESC, id DESC
        LIMIT 100
      `,
    );

    for (const nodes of Object.values(queryPlans)) {
      expect(nodes.some((node) => node.includes('Index'))).toBe(true);
    }
  });

  it('meets preliminary server-boundary latency and error targets', async () => {
    const metrics: Record<string, Metric> = {};
    metrics.tmminDashboard = await measureHttp(30, 3_000, () =>
      request(app.getHttpServer()).get('/api/v1/tmmin/dashboard').set('Cookie', cookie),
    );
    metrics.externalProjectionList = await measureHttp(30, 2_000, () =>
      request(app.getHttpServer())
        .get(`/api/v1/tmmin/suppliers/${baselineSupplierId}/external-projections?limit=100`)
        .set('Cookie', cookie),
    );
    metrics.auditList = await measureHttp(30, 2_000, () =>
      request(app.getHttpServer()).get('/api/v1/tmmin/audit?limit=100').set('Cookie', cookie),
    );
    metrics.notificationList = await measureHttp(30, 2_000, () =>
      request(app.getHttpServer())
        .get('/api/v1/tmmin/notifications?limit=100')
        .set('Cookie', cookie),
    );

    let expectedVersion = 1;
    metrics.standardMutation = await measureHttp(
      20,
      3_000,
      async () => {
        const response = await request(app.getHttpServer())
          .patch(`/api/v1/tmmin/suppliers/${mutationSupplierId}`)
          .set('Origin', tmminOrigin)
          .set('Cookie', cookie)
          .set('X-CSRF-Token', csrf)
          .send({
            expectedVersion,
            name: `Compact Mutation Supplier ${expectedVersion}`,
          });
        if (response.status === 200) expectedVersion = response.body.version as number;
        return response;
      },
      200,
    );
    let eventIndex = 0;
    metrics.externalIngest = await measureHttp(
      30,
      2_000,
      () => {
        eventIndex += 1;
        return request(app.getHttpServer())
          .post('/api/v1/external/henkaten/events')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(externalEvent(eventIndex));
      },
      202,
    );

    const report = {
      profile: {
        suppliers: supplierCount,
        linesPerSupplier,
        membersPerSupplier,
        jobsPerSupplier,
        projectionsPerSupplier,
        auditsPerSupplier,
      },
      metrics,
      queryPlans,
    };
    process.stdout.write(`BACKEND_BASELINE ${JSON.stringify(report)}\n`);
    expect(Object.values(metrics).every(({ errorRate }) => errorRate < 0.01)).toBe(true);
  });
});

async function measureHttp(
  samples: number,
  targetP95Ms: number,
  operation: () => PromiseLike<{ status: number }>,
  expectedStatus = 200,
): Promise<Metric> {
  for (let warmup = 0; warmup < 3; warmup += 1) await operation();
  const durations: number[] = [];
  let errors = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    const response = await operation();
    durations.push(performance.now() - startedAt);
    if (response.status !== expectedStatus) errors += 1;
  }
  durations.sort((left, right) => left - right);
  const metric = {
    samples,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: durations.at(-1) ?? 0,
    errorRate: errors / samples,
    targetP95Ms,
  };
  expect(metric.p95Ms).toBeLessThanOrEqual(targetP95Ms);
  expect(metric.errorRate).toBeLessThan(0.01);
  return metric;
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return Number((sorted[index] ?? 0).toFixed(2));
}

function planNodes(plan: unknown): string[] {
  const nodes: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record['Node Type'] === 'string') {
      nodes.push(
        [record['Node Type'], record['Index Name']]
          .filter((item): item is string => typeof item === 'string')
          .join(':'),
      );
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(plan);
  return nodes;
}

function externalEvent(index: number) {
  return {
    schemaVersion: '1.0',
    eventId: `baseline-event-${index}`,
    sourceHenkatenId: `baseline-source-${index}`,
    sourceVersion: 1,
    eventType: 'HENKATEN_OPENED',
    status: 'OPEN',
    occurredAt: '2026-07-23T02:00:00.000Z',
    line: { externalId: `BASELINE-LINE-${index % 20}`, name: 'Baseline Line' },
    shift: {
      externalId: 'SHIFT-1',
      name: 'Shift 1',
      businessDate: '2026-07-23',
      timezone: 'Asia/Jakarta',
    },
    job: { externalId: `BASELINE-JOB-${index}`, name: 'Baseline Job' },
    part: { number: `BASELINE-PART-${index % 25}`, name: 'Baseline Part' },
    changePoint: 'MACHINE',
    change: {
      affectedObject: 'Impact wrench A',
      replacementObject: 'Impact wrench B',
      cause: 'Compact baseline',
      detail: 'Measured external ingestion.',
    },
    checklist: {
      templateVersion: 'machine-v1',
      allPassed: true,
      items: [{ externalId: 'QC-01', label: 'Parameter verified', answer: 'YES' }],
    },
    decisions: [],
    metadata: { sourceSystem: 'compact-baseline' },
  };
}

function cookieHeader(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}
