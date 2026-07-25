import { describe, expect, it } from 'vitest';

import { loadAppConfig } from './app-config.js';

const baseline = {
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:55432/database',
  SESSION_CSRF_SECRET: 'csrf-secret-that-is-at-least-thirty-two-characters',
  AUTH_THROTTLE_SECRET: 'throttle-secret-at-least-thirty-two-characters',
};

describe('application configuration', () => {
  it('fails fast below the Argon2id OWASP floor', () => {
    expect(() => loadAppConfig({ ...baseline, ARGON2_MEMORY_KIB: '19455' })).toThrow();
  });

  it('uses bounded platform defaults', () => {
    const config = loadAppConfig(baseline);
    expect(config.dbPoolMax).toBe(10);
    expect(config.outboxBatchSize).toBe(50);
    expect(config.realtimePollMs).toBe(1_000);
    expect(config.argon2MemoryKib).toBe(19_456);
  });

  it('bounds realtime polling below the observable propagation target', () => {
    expect(() => loadAppConfig({ ...baseline, REALTIME_POLL_MS: '99' })).toThrow();
    expect(() => loadAppConfig({ ...baseline, REALTIME_POLL_MS: '5001' })).toThrow();
    expect(loadAppConfig({ ...baseline, REALTIME_POLL_MS: '250' }).realtimePollMs).toBe(250);
  });
});
