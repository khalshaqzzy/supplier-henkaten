import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../config/app-config.js';
import { RateLimiterService } from './rate-limiter.service.js';

describe('login account throttle', () => {
  it('counts failures while allowing successful logins to clear the account bucket', () => {
    const limiter = new RateLimiterService({
      authThrottleSecret: 'test-throttle-secret',
      authIpLoginLimit: 100,
      authGlobalLimitPerMinute: 100,
    } as AppConfig);
    const now = new Date('2026-09-24T00:00:00.000Z');
    const account = 'SUPPLIER:NPM:line-leader';

    for (let successfulLogin = 0; successfulLogin < 6; successfulLogin += 1) {
      expect(limiter.checkAccount(account, now).allowed).toBe(true);
      limiter.clearAccount(account);
    }

    for (let failure = 0; failure < 5; failure += 1) {
      expect(limiter.checkAccount(account, now).allowed).toBe(true);
      limiter.consume('login-account', account, now);
    }
    expect(limiter.checkAccount(account, now).allowed).toBe(false);
    expect(limiter.checkAccount(account, new Date(now.getTime() + 15 * 60_000)).allowed).toBe(true);
    expect(limiter.consume('login-ip', '127.0.0.1', now).allowed).toBe(true);
  });
});
