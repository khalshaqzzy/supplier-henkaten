import { describe, expect, it, vi } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns ready when foundation and unresolved-migration checks pass and ignores rolled-back rows superseded by a successful retry', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ tables: 17n, trigger_count: 2n, unfinished_migrations: 0n }]);
    const controller = new HealthController(
      { $queryRaw: queryRaw } as never,
      { ensureReady: vi.fn().mockResolvedValue(undefined) } as never,
      { releaseSha: '0123456789abcdef0123456789abcdef01234567' } as never,
    );
    const status = vi.fn();

    const body = await controller.ready({ status } as never);

    expect(body.status).toBe('ready');
    expect(status).not.toHaveBeenCalled();
    const sqlStrings = (queryRaw.mock.calls[1]![0] as readonly string[]).join('');
    expect(sqlStrings).toContain('NOT EXISTS');
    expect(sqlStrings).toContain('ok.migration_name = m.migration_name');
    expect(sqlStrings).toContain('ok.finished_at IS NOT NULL');
    expect(sqlStrings).toContain('ok.rolled_back_at IS NULL');
  });

  it('returns 503 not_ready when an unresolved or un-retried rolled-back migration exists', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ tables: 17n, trigger_count: 2n, unfinished_migrations: 1n }]);
    const controller = new HealthController(
      { $queryRaw: queryRaw } as never,
      { ensureReady: vi.fn().mockResolvedValue(undefined) } as never,
      { releaseSha: '0123456789abcdef0123456789abcdef01234567' } as never,
    );
    const status = vi.fn();

    const body = await controller.ready({ status } as never);

    expect(body.status).toBe('not_ready');
    expect(status).toHaveBeenCalledWith(503);
  });
});
