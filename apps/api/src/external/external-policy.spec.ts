import { describe, expect, it } from 'vitest';

import type { ExternalHenkatenEvent } from '@tmmin-henkaten/contracts';

import { loadAppConfig } from '../config/app-config.js';
import { ExternalRateLimiterService } from './external-rate-limiter.service.js';
import {
  assertExternalOrdering,
  canonicalizeExternalJson,
  externalIpAllowed,
} from './external.service.js';

describe('external policy helpers', () => {
  it('canonicalizes object keys while preserving array order', () => {
    expect(canonicalizeExternalJson({ z: 1, a: { d: 2, b: 1 }, list: [2, 1] })).toBe(
      '{"a":{"b":1,"d":2},"list":[2,1],"z":1}',
    );
    expect(canonicalizeExternalJson({ list: [1, 2] })).not.toBe(
      canonicalizeExternalJson({ list: [2, 1] }),
    );
  });

  it('fails closed for non-allowlisted IPs', () => {
    expect(externalIpAllowed([], '127.0.0.1')).toBe(true);
    expect(externalIpAllowed(['127.0.0.1'], '127.0.0.1')).toBe(true);
    expect(externalIpAllowed(['203.0.113.10'], '127.0.0.1')).toBe(false);
  });

  it('enforces first, contiguous, and terminal source ordering', () => {
    expect(() => assertExternalOrdering(null, stubEvent(1, 'HENKATEN_OPENED'))).not.toThrow();
    expectProblem(
      () => assertExternalOrdering(null, stubEvent(2, 'HENKATEN_OPEN_UPDATED')),
      'SOURCE_VERSION_OUT_OF_ORDER',
    );
    expectProblem(
      () =>
        assertExternalOrdering(
          { sourceVersion: 1, status: 'OPEN' },
          stubEvent(3, 'HENKATEN_OPEN_UPDATED'),
        ),
      'SOURCE_VERSION_OUT_OF_ORDER',
    );
    expectProblem(
      () =>
        assertExternalOrdering(
          { sourceVersion: 1, status: 'OPEN' },
          stubEvent(2, 'HENKATEN_OPENED'),
        ),
      'INVALID_TRANSITION',
    );
    expectProblem(
      () =>
        assertExternalOrdering(
          { sourceVersion: 2, status: 'APPROVED' },
          stubEvent(3, 'HENKATEN_OPEN_UPDATED'),
        ),
      'INVALID_TRANSITION',
    );
  });
});

describe('external fixed-window and token-bucket limits', () => {
  it('enforces token attempts by client/IP and resets the fixed window', () => {
    const limiter = new ExternalRateLimiterService(config());
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = limiter.token('client', '127.0.0.1', 1_000);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBe(0);
    }
    const denied = limiter.token('client', '127.0.0.1', 1_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.token('client', '127.0.0.2', 1_000).allowed).toBe(true);
    expect(limiter.token('client', '127.0.0.1', 61_001).allowed).toBe(true);
  });

  it('allows a 300 request burst and refills at 120 requests per minute', () => {
    const limiter = new ExternalRateLimiterService(config());
    for (let request = 0; request < 300; request += 1) {
      expect(limiter.ingest('client', 1_000).allowed).toBe(true);
    }
    expect(limiter.ingest('client', 1_000).allowed).toBe(false);
    expect(limiter.ingest('client', 1_499).allowed).toBe(false);
    expect(limiter.ingest('client', 1_500).allowed).toBe(true);
  });
});

function config() {
  return loadAppConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
    SESSION_CSRF_SECRET: 'unit-test-csrf-secret-at-least-32-characters',
    AUTH_THROTTLE_SECRET: 'unit-test-throttle-secret-at-least-32',
  });
}

function expectProblem(operation: () => void, code: string) {
  expect(operation).toThrow(
    expect.objectContaining({ problem: expect.objectContaining({ code }) }) as Error,
  );
}

function stubEvent(
  sourceVersion: number,
  eventType: ExternalHenkatenEvent['eventType'],
): ExternalHenkatenEvent {
  return { sourceVersion, eventType } as ExternalHenkatenEvent;
}
