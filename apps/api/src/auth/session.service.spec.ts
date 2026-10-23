import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAppConfig } from '../config/app-config.js';
import type { PrismaService } from '../persistence/prisma.service.js';
import { SessionService } from './session.service.js';

const start = new Date('2026-10-20T03:00:00.000Z');
const day = 86_400_000;
const config = loadAppConfig({
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:55432/database',
  SESSION_CSRF_SECRET: 'session-test-csrf-secret-at-least-thirty-two',
  AUTH_THROTTLE_SECRET: 'session-test-throttle-secret-at-least-thirty-two',
});

function fixture() {
  let now = start;
  const user = {
    id: 'user',
    realm: 'TMMIN' as const,
    supplierId: null,
    memberId: null,
    passwordEpoch: 1,
    authorizationEpoch: 1,
    mustChangePassword: false,
    status: 'ACTIVE',
    displayName: 'Quality',
    role: 'TMMIN_QUALITY',
  };
  const row = {
    id: 'session',
    userId: user.id,
    realm: user.realm,
    purpose: 'NORMAL',
    supplierId: null,
    sourceEpoch: null,
    passwordEpoch: 1,
    authorizationEpoch: 1,
    lastActivityAt: start,
    idleExpiresAt: new Date(start.getTime() + 30 * day),
    absoluteExpiresAt: new Date(start.getTime() + 30 * day),
    revokedAt: null as Date | null,
    impersonatedByUserId: null as string | null,
    impersonatedBySessionId: null as string | null,
    version: 1,
  };
  const prisma = {
    userSession: {
      create: vi.fn().mockResolvedValue({ id: row.id }),
      findUnique: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(user) },
  };
  const service = new SessionService(prisma as unknown as PrismaService, config, {
    now: () => now,
  });
  return {
    user,
    row,
    prisma,
    service,
    advance: (ms: number) => (now = new Date(start.getTime() + ms)),
  };
}

describe('SessionService lifetime', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    f = fixture();
  });

  it('issues a fixed 30-day deadline and persists only the random token hash', async () => {
    const created = await f.service.create(f.user, null, 'NORMAL', {});
    expect(created.idleExpiresAt).toEqual(new Date(start.getTime() + 30 * day));
    expect(created.absoluteExpiresAt).toEqual(created.idleExpiresAt);
    const data = f.prisma.userSession.create.mock.calls[0]![0].data;
    expect(data.tokenHash).toEqual(
      Uint8Array.from(createHash('sha256').update(created.rawToken).digest()),
    );
    expect(created.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data).not.toHaveProperty('rawToken');
  });

  it.each(['forced', 'actor-user', 'actor-session'] as const)(
    'retains short issuance for %s',
    async (kind) => {
      const result = await f.service.create(
        { ...f.user, mustChangePassword: kind === 'forced' },
        null,
        'NORMAL',
        {},
        kind === 'actor-user' ? 'actor' : undefined,
        kind === 'actor-session' ? 'actor-session' : undefined,
      );
      expect(result.idleExpiresAt.getTime() - start.getTime()).toBe(30 * 60_000);
      expect(result.absoluteExpiresAt.getTime() - start.getTime()).toBe(12 * 60 * 60_000);
    },
  );

  it.each([31 * 60_000, 13 * 60 * 60_000, 7 * day, 30 * day - 1])(
    'survives %i ms of inactivity without changing passive state',
    async (elapsed) => {
      f.advance(elapsed);
      expect(await f.service.resolve('raw', 'TMMIN', false)).not.toBeNull();
      expect(f.prisma.userSession.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([30 * day, 30 * day + 1])('rejects the fixed deadline at %i ms', async (elapsed) => {
    f.advance(elapsed);
    expect(await f.service.resolve('raw', 'TMMIN')).toBeNull();
    expect(f.prisma.userSession.updateMany).not.toHaveBeenCalled();
  });

  it.each([30 * 60_000, 12 * 60 * 60_000])(
    'rejects a short session at its idle or absolute boundary (%i ms)',
    async (elapsed) => {
      f.user.mustChangePassword = true;
      f.row.absoluteExpiresAt = new Date(start.getTime() + 12 * 60 * 60_000);
      f.row.idleExpiresAt = new Date(start.getTime() + elapsed);
      f.advance(elapsed);
      expect(await f.service.resolve('raw', 'TMMIN')).toBeNull();
      expect(f.prisma.userSession.updateMany).not.toHaveBeenCalled();
    },
  );

  it('throttles activity without moving persistent deadlines', async () => {
    f.advance(59_999);
    await f.service.resolve('raw', 'TMMIN');
    expect(f.prisma.userSession.updateMany).not.toHaveBeenCalled();
    f.advance(60_000);
    await f.service.resolve('raw', 'TMMIN');
    expect(f.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: f.row.id,
        version: 1,
        revokedAt: null,
        idleExpiresAt: { gt: new Date(start.getTime() + 60_000) },
        absoluteExpiresAt: { gt: new Date(start.getTime() + 60_000) },
      },
      data: {
        lastActivityAt: new Date(start.getTime() + 60_000),
        idleExpiresAt: f.row.absoluteExpiresAt,
        version: { increment: 1 },
      },
    });
  });

  it('caps short sliding activity at its original absolute deadline', async () => {
    f.user.mustChangePassword = true;
    f.row.absoluteExpiresAt = new Date(start.getTime() + 12 * 60 * 60_000);
    f.row.idleExpiresAt = f.row.absoluteExpiresAt;
    f.advance(12 * 60 * 60_000 - 60_000);
    await f.service.resolve('raw', 'TMMIN');
    const data = f.prisma.userSession.updateMany.mock.calls[0]![0].data;
    expect(data.idleExpiresAt).toEqual(f.row.absoluteExpiresAt);
    expect(data).not.toHaveProperty('absoluteExpiresAt');
  });

  it('slides short idle activity while passive resolution leaves it untouched', async () => {
    f.user.mustChangePassword = true;
    f.row.idleExpiresAt = new Date(start.getTime() + 30 * 60_000);
    f.advance(60_000);
    await f.service.resolve('raw', 'TMMIN', false);
    expect(f.prisma.userSession.updateMany).not.toHaveBeenCalled();
    await f.service.resolve('raw', 'TMMIN');
    expect(f.prisma.userSession.updateMany.mock.calls[0]![0].data.idleExpiresAt).toEqual(
      new Date(start.getTime() + 31 * 60_000),
    );
  });

  it('normalizes a still-valid legacy direct idle deadline without extending its 12-hour bound', async () => {
    f.row.idleExpiresAt = new Date(start.getTime() + 30 * 60_000);
    f.row.absoluteExpiresAt = new Date(start.getTime() + 12 * 60 * 60_000);
    f.advance(60_000);
    await f.service.resolve('raw', 'TMMIN');
    expect(f.prisma.userSession.updateMany.mock.calls[0]![0].data.idleExpiresAt).toEqual(
      f.row.absoluteExpiresAt,
    );
  });

  it.each(['idle', 'revoked', 'password', 'authorization', 'inactive', 'realm'])(
    'does not revive an invalid %s session',
    async (reason) => {
      f.advance(60_000);
      if (reason === 'idle') f.row.idleExpiresAt = start;
      if (reason === 'revoked') f.row.revokedAt = start;
      if (reason === 'password') f.user.passwordEpoch += 1;
      if (reason === 'authorization') f.user.authorizationEpoch += 1;
      if (reason === 'inactive') f.user.status = 'INACTIVE';
      expect(await f.service.resolve('raw', reason === 'realm' ? 'SUPPLIER' : 'TMMIN')).toBeNull();
      expect(f.prisma.userSession.updateMany).not.toHaveBeenCalled();
    },
  );
});
