import { describe, expect, it } from 'vitest';

import { classifyPushFailure } from './push.gateway.js';

describe('Web Push delivery classification', () => {
  it.each([404, 410])('expires gone endpoints for status %s', (statusCode) => {
    expect(classifyPushFailure({ statusCode })).toEqual({
      disposition: 'EXPIRE_SUBSCRIPTION',
      safeClass: `PushEndpoint${statusCode}`,
    });
  });

  it('retries throttling and respects Retry-After', () => {
    expect(classifyPushFailure({ statusCode: 429, headers: { 'retry-after': '12' } })).toEqual({
      disposition: 'RETRY',
      safeClass: 'PushRateLimited',
      retryAfterMs: 12_000,
    });
    const date = new Date(Date.now() + 60_000).toUTCString();
    expect(
      classifyPushFailure({ statusCode: 503, headers: { 'retry-after': date } }).retryAfterMs,
    ).toBeGreaterThan(50_000);
  });

  it('treats validation and authentication responses as permanent failures', () => {
    expect(classifyPushFailure({ statusCode: 401 })).toEqual({
      disposition: 'PERMANENT',
      safeClass: 'PushRejected401',
    });
  });

  it('retries network failures without exposing their message', () => {
    expect(classifyPushFailure(new TypeError('secret endpoint details'))).toEqual({
      disposition: 'RETRY',
      safeClass: 'TypeError',
    });
  });
});
