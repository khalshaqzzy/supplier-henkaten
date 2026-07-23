import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

type Bucket = { count: number; resetAt: number };

@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  consume(
    category: 'login-account' | 'login-ip' | 'global-ip',
    rawKey: string,
    now: Date,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const limit =
      category === 'login-account'
        ? 5
        : category === 'login-ip'
          ? this.config.authIpLoginLimit
          : this.config.authGlobalLimitPerMinute;
    const windowMs = category === 'global-ip' ? 60_000 : 15 * 60_000;
    const key = `${category}:${this.digest(rawKey)}`;
    const nowMs = now.getTime();
    const existing = this.buckets.get(key);
    const bucket =
      existing && existing.resetAt > nowMs ? existing : { count: 0, resetAt: nowMs + windowMs };
    bucket.count += 1;
    this.buckets.set(key, bucket);
    this.prune(nowMs);
    return {
      allowed: bucket.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1_000)),
    };
  }

  private digest(value: string): string {
    return createHmac('sha256', this.config.authThrottleSecret).update(value).digest('base64url');
  }

  private prune(nowMs: number): void {
    if (this.buckets.size < 5_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= nowMs) this.buckets.delete(key);
    }
  }
}
