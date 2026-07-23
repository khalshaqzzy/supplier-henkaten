import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import type { IdentityRealm } from '../generated/prisma/client.js';
import type { ContextRequest } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { CLOCK, type Clock } from '../common/scope.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { safeTokenEqual } from './auth.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class SessionAuthenticationGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const realm = realmFromPath(request.path);
    if (!realm) return true;
    const rawToken = request.cookies?.[cookieName(realm, this.config)] as string | undefined;
    if (rawToken) {
      const principal = await this.sessions.resolve(rawToken, realm);
      if (principal) request.principal = principal;
    }
    return true;
  }
}

@Injectable()
export class GlobalRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiterService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<ContextRequest>();
    const response = http.getResponse<{ setHeader(name: string, value: string): void }>();
    const result = this.limiter.consume('global-ip', request.ip ?? 'unknown', this.clock.now());
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new ProblemException({
        status: 429,
        code: 'RATE_LIMITED',
        title: 'Too many requests',
        detail: 'The request rate limit has been exceeded.',
      });
    }
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
    if (!request.principal) return true;
    const expectedOrigin =
      request.principal.realm === 'TMMIN'
        ? this.config.tmminAppOrigin
        : this.config.supplierAppOrigin;
    const suppliedOrigin = request.header('Origin');
    const suppliedToken = request.header('X-CSRF-Token');
    const expectedToken = this.sessions.csrfToken(
      request.principal.rawSessionToken,
      request.principal.sessionId,
      request.principal.realm,
    );
    if (
      suppliedOrigin !== expectedOrigin ||
      !suppliedToken ||
      !safeTokenEqual(suppliedToken, expectedToken)
    ) {
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Forbidden',
        detail: 'Request origin or CSRF token is invalid.',
      });
    }
    return true;
  }
}

export function realmFromPath(path: string): IdentityRealm | null {
  if (path.startsWith('/api/v1/auth/tmmin') || path.startsWith('/api/v1/tmmin')) return 'TMMIN';
  if (path.startsWith('/api/v1/auth/supplier') || path.startsWith('/api/v1/supplier')) {
    return 'SUPPLIER';
  }
  return null;
}

export function cookieName(realm: IdentityRealm, config: AppConfig): string {
  const realmName = realm === 'TMMIN' ? 'tmmin' : 'supplier';
  return config.nodeEnv === 'production'
    ? `__Host-tmmin_henkaten_${realmName}_session`
    : `tmmin_henkaten_${realmName}_session`;
}
