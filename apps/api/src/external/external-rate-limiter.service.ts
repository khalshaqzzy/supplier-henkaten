import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

type Bucket = { tokens: number; updatedAt: number };
type Fixed = { count: number; resetAt: number };

@Injectable()
export class ExternalRateLimiterService {
  private readonly tokenAttempts = new Map<string, Fixed>();
  private readonly ingestBuckets = new Map<string, Bucket>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  token(clientId: string, ip: string, now = Date.now()) {
    const key = this.key(`token:${clientId}:${ip}`);
    const current = this.tokenAttempts.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + 60_000 };
    bucket.count += 1;
    this.tokenAttempts.set(key, bucket);
    return result(bucket.count <= 10, 10 - bucket.count, bucket.resetAt, now);
  }

  ingest(clientId: string, now = Date.now()) {
    const key = this.key(`ingest:${clientId}`);
    const current = this.ingestBuckets.get(key) ?? { tokens: 300, updatedAt: now };
    const elapsed = Math.max(0, now - current.updatedAt);
    current.tokens = Math.min(300, current.tokens + elapsed * (120 / 60_000));
    current.updatedAt = now;
    const allowed = current.tokens >= 1;
    if (allowed) current.tokens -= 1;
    this.ingestBuckets.set(key, current);
    return {
      allowed,
      limit: 120,
      remaining: Math.max(0, Math.floor(current.tokens)),
      retryAfterSeconds: allowed ? 0 : 1,
      resetAt: now + Math.ceil((300 - current.tokens) / (120 / 60_000)),
    };
  }

  private key(value: string): string {
    return createHmac('sha256', this.config.authThrottleSecret).update(value).digest('base64url');
  }
}

function result(allowed: boolean, remaining: number, resetAt: number, now: number) {
  return {
    allowed,
    limit: 10,
    remaining: Math.max(0, remaining),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
    resetAt,
  };
}
