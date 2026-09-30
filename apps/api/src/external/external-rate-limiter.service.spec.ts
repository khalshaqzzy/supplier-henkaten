import { describe, expect, it } from 'vitest';
import { ExternalRateLimiterService } from './external-rate-limiter.service.js';

describe('external token throttle retention', () => {
  it('bounds unique invalid IDs without evicting an active throttled caller', () => {
    const limiter = new ExternalRateLimiterService({
      authThrottleSecret: 'test-throttle-secret',
    } as never);
    for (let i = 0; i < 10; i++) expect(limiter.token('target', 'ip', 0).allowed).toBe(true);
    for (let i = 0; i < ExternalRateLimiterService.MAX_TOKEN_BUCKETS - 1; i++)
      limiter.token(`invalid-${i}`, 'ip', 0);
    expect(limiter.token('overflow', 'ip', 0).allowed).toBe(false);
    expect(limiter.token('target', 'ip', 0).allowed).toBe(false);
    expect(limiter.token('overflow', 'ip', 60_000).allowed).toBe(true);
    expect(limiter.token('target', 'ip', 60_000).allowed).toBe(true);
  });
});
