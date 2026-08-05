import { Inject, Injectable } from '@nestjs/common';
import webpush from 'web-push';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

export const WEB_PUSH_GATEWAY = Symbol('WEB_PUSH_GATEWAY');

export type PushGatewaySubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export interface WebPushGateway {
  send(subscription: PushGatewaySubscription, payload: string, ttlSeconds: number): Promise<void>;
}

@Injectable()
export class StandardsWebPushGateway implements WebPushGateway {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.pushEnabled) {
      webpush.setVapidDetails(
        config.pushVapidSubject,
        config.pushVapidPublicKey,
        config.pushVapidPrivateKey,
      );
    }
  }

  async send(
    subscription: PushGatewaySubscription,
    payload: string,
    ttlSeconds: number,
  ): Promise<void> {
    await webpush.sendNotification(subscription, payload, { TTL: ttlSeconds });
  }
}

export type PushFailure = {
  disposition: 'RETRY' | 'EXPIRE_SUBSCRIPTION' | 'PERMANENT';
  safeClass: string;
  retryAfterMs?: number;
};

export function classifyPushFailure(error: unknown): PushFailure {
  const statusCode = numericProperty(error, 'statusCode');
  if (statusCode === 404 || statusCode === 410) {
    return { disposition: 'EXPIRE_SUBSCRIPTION', safeClass: `PushEndpoint${statusCode}` };
  }
  if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
    const retryAfterMs = retryAfter(error);
    return {
      disposition: 'RETRY',
      safeClass: statusCode === 429 ? 'PushRateLimited' : 'PushServiceUnavailable',
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  if (statusCode !== undefined && statusCode >= 400) {
    return { disposition: 'PERMANENT', safeClass: `PushRejected${statusCode}` };
  }
  return {
    disposition: 'RETRY',
    safeClass: error instanceof Error ? error.name.slice(0, 100) : 'PushNetworkError',
  };
}

function numericProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate: unknown = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' ? candidate : undefined;
}

function retryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const headers: unknown = (error as Record<string, unknown>)['headers'];
  if (!headers || typeof headers !== 'object') return undefined;
  const value: unknown = (headers as Record<string, unknown>)['retry-after'];
  if (typeof value !== 'string') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}
