import type { INestApplication } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Response } from 'express';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { ContextRequest } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { MasterDataAccessService } from '../master-data/master-data-access.service.js';
import { cookieName } from './auth.guards.js';
import { safeTokenEqual } from './auth.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService } from './session.service.js';

// Only authorized imports receive the larger body budget. Reserve a slot before
// asynchronous authentication so neither parsing nor pending checks grow unbounded.
export function installJsonBodyParsers(app: INestApplication) {
  const sessions = app.get(SessionService);
  const access = app.get(MasterDataAccessService);
  const limiter = app.get(RateLimiterService);
  const config = app.get<AppConfig>(APP_CONFIG);
  const parser = express.json({ limit: '80mb', type: 'application/json' });
  let active = 0;
  app.use(
    '/api/v1/supplier/master-data/parts/import',
    async (req: ContextRequest, res: Response, next: NextFunction) => {
      if (req.method === 'OPTIONS') return next();
      const reject = (status: number, detail: string) =>
        res.status(status).json({
          status,
          code: status === 429 ? 'RATE_LIMITED' : 'FORBIDDEN',
          title: 'Import unavailable',
          detail,
          correlationId: req.correlationId,
        });
      if (req.method !== 'POST' || !/^\/(preview|commit)\/?$/i.test(req.path))
        return reject(403, 'Import route is invalid.');
      const rate = limiter.consume('import-ip', req.ip ?? 'unknown', new Date());
      if (!rate.allowed || active >= 2) {
        res.setHeader('Retry-After', rate.allowed ? '1' : String(rate.retryAfterSeconds));
        return reject(429, 'Too many imports. Try again.');
      }
      active += 1;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          active -= 1;
          clearTimeout(timeout);
        }
      };
      const timeout = setTimeout(() => {
        release();
        res.destroy();
      }, 60_000);
      res.once('close', release);
      res.once('finish', release);
      try {
        const raw = req.cookies?.[cookieName('SUPPLIER', config)] as string | undefined;
        const principal = raw ? await sessions.resolve(raw, 'SUPPLIER') : null;
        if (!principal || principal.role !== 'SUPPLIER_ADMIN' || principal.mustChangePassword) {
          return reject(403, 'Supplier Admin session is required.');
        }
        const csrf = req.header('X-CSRF-Token');
        if (
          req.header('Origin') !== config.supplierAppOrigin ||
          !csrf ||
          !safeTokenEqual(
            csrf,
            sessions.csrfToken(principal.rawSessionToken, principal.sessionId, 'SUPPLIER'),
          )
        ) {
          return reject(403, 'Request origin or CSRF token is invalid.');
        }
        await access.assertWritable(principal);
        if (released || res.destroyed) return;
        parser(req, res, next);
      } catch (error) {
        if (error instanceof ProblemException)
          return res.status(error.problem.status).json(error.problem);
        release();
        next(error);
      }
    },
  );
  app.use(express.json({ limit: '5mb', type: 'application/json' }));
}
