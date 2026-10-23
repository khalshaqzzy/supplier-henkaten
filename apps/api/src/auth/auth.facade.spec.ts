import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { loadAppConfig } from '../config/app-config.js';
import { AuthControllerFacade } from './auth.facade.js';

// Cookie serialization must keep the existing production boundaries when lifetime changes.
describe('persistent session cookies', () => {
  it.each(['TMMIN', 'SUPPLIER'] as const)(
    'keeps %s production cookie scope and fixed expiry',
    async (realm) => {
      const absoluteExpiresAt = new Date('2026-11-19T03:00:00.000Z');
      const supplier = { id: 'supplier', code: 'TEST', name: 'Supplier', sourceEpoch: 1 };
      const facade = new AuthControllerFacade(
        {
          login: vi.fn().mockResolvedValue({
            user: {
              id: 'user',
              realm,
              role: realm === 'TMMIN' ? 'TMMIN_QUALITY' : 'SUPPLIER_ADMIN',
              supplierId: realm === 'SUPPLIER' ? supplier.id : null,
              mustChangePassword: false,
            },
            session: {
              id: 'session',
              rawToken: 'opaque-token',
              idleExpiresAt: absoluteExpiresAt,
              absoluteExpiresAt,
            },
          }),
        } as never,
        { purpose: vi.fn().mockResolvedValue('NORMAL'), csrfToken: () => 'csrf-token' } as never,
        { supplier: { findUniqueOrThrow: vi.fn().mockResolvedValue(supplier) } } as never,
        loadAppConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/test',
          SESSION_CSRF_SECRET: 'cookie-test-secret-at-least-thirty-two-characters',
          AUTH_THROTTLE_SECRET: 'cookie-test-throttle-at-least-thirty-two-characters',
        }),
        {} as never,
      );
      const cookie = vi.fn();
      const setHeader = vi.fn();
      await facade.login(
        realm,
        { username: 'test', password: 'test' },
        {
          header: (name: string) =>
            name === 'Origin'
              ? realm === 'TMMIN'
                ? 'http://localhost:5174'
                : 'http://localhost:5173'
              : undefined,
          is: () => true,
        } as unknown as Request,
        { cookie, setHeader } as unknown as Response,
      );
      expect(cookie).toHaveBeenCalledWith(
        `__Host-tmmin_henkaten_${realm.toLowerCase()}_session`,
        'opaque-token',
        { httpOnly: true, secure: true, sameSite: 'strict', path: '/', expires: absoluteExpiresAt },
      );
      expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    },
  );
});
