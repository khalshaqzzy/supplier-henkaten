import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { IdentityRealm } from '../generated/prisma/client.js';
import { ProblemException } from '../common/problem.js';
import type { ContextRequest } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { cookieName } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthControllerFacade {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(
    realm: IdentityRealm,
    body: { username: string; password: string },
    request: Request,
    response: Response,
    supplierCode?: string,
  ) {
    this.assertLoginBoundary(realm, request);
    const userAgent = request.header('User-Agent');
    const { user, session } = await this.auth.login({
      realm,
      ...(supplierCode ? { supplierCode } : {}),
      username: body.username,
      password: body.password,
      sourceIp: request.ip ?? 'unknown',
      correlationId:
        'correlationId' in request && typeof request.correlationId === 'string'
          ? request.correlationId
          : 'unavailable',
      ...(userAgent ? { userAgent } : {}),
    });
    setSessionCookie(response, realm, session.rawToken, session.absoluteExpiresAt, this.config);
    response.setHeader('Cache-Control', 'no-store');
    return {
      principal: {
        userId: user.id,
        displayName: user.displayName,
        realm: user.realm,
        role: user.role,
        ...(user.supplierId ? { supplierId: user.supplierId } : {}),
        purpose:
          user.supplierId && realm === 'SUPPLIER'
            ? await this.sessions.purpose(session.id)
            : 'NORMAL',
        mustChangePassword: user.mustChangePassword,
      },
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      csrfToken: this.sessions.csrfToken(session.rawToken, session.id, realm),
    };
  }

  async session(request: ContextRequest) {
    const principal = requirePrincipal(request);
    const expiry = await this.sessions.expiry(principal.sessionId);
    return {
      principal: {
        userId: principal.userId,
        displayName: principal.displayName,
        realm: principal.realm,
        role: principal.role,
        ...(principal.supplierId ? { supplierId: principal.supplierId } : {}),
        purpose: principal.purpose,
        mustChangePassword: principal.mustChangePassword,
      },
      idleExpiresAt: expiry.idleExpiresAt.toISOString(),
      absoluteExpiresAt: expiry.absoluteExpiresAt.toISOString(),
      csrfToken: this.sessions.csrfToken(
        principal.rawSessionToken,
        principal.sessionId,
        principal.realm,
      ),
    };
  }

  async changePassword(
    body: { currentPassword: string; newPassword: string },
    request: ContextRequest,
    response: Response,
  ): Promise<void> {
    const principal = requirePrincipal(request);
    await this.auth.changePassword(principal.userId, body.currentPassword, body.newPassword);
    clearSessionCookie(response, principal.realm, this.config);
    response.status(204);
  }

  async logout(request: ContextRequest, response: Response): Promise<void> {
    const principal = requirePrincipal(request);
    await this.sessions.revoke(principal.sessionId, 'LOGOUT');
    clearSessionCookie(response, principal.realm, this.config);
    response.status(204);
  }

  private assertLoginBoundary(realm: IdentityRealm, request: Request): void {
    const expectedOrigin =
      realm === 'TMMIN' ? this.config.tmminAppOrigin : this.config.supplierAppOrigin;
    if (request.header('Origin') !== expectedOrigin || !request.is('application/json')) {
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Forbidden',
        detail: 'Login origin or content type is invalid.',
      });
    }
  }
}

function requirePrincipal(request: ContextRequest) {
  if (!request.principal) {
    throw new ProblemException({
      status: 401,
      code: 'SESSION_EXPIRED',
      title: 'Session expired',
      detail: 'An active session is required.',
    });
  }
  return request.principal;
}

function setSessionCookie(
  response: Response,
  realm: IdentityRealm,
  rawToken: string,
  expires: Date,
  config: AppConfig,
): void {
  response.cookie(cookieName(realm, config), rawToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    expires,
  });
}

function clearSessionCookie(response: Response, realm: IdentityRealm, config: AppConfig): void {
  response.clearCookie(cookieName(realm, config), {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
  });
}
