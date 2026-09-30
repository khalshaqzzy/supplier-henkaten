import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../config/app-config.js';
import { MasterDataAccessService } from '../master-data/master-data-access.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService } from './session.service.js';
import { installJsonBodyParsers } from './import-body.middleware.js';

function setup() {
  const app = express();
  app.use(cookieParser());
  const sessions = { resolve: vi.fn().mockResolvedValue(null), csrfToken: () => 'csrf' };
  const access = { assertWritable: vi.fn().mockResolvedValue({}) };
  const config = { supplierAppOrigin: 'http://localhost:5173', nodeEnv: 'test' };
  const limiter = { consume: () => ({ allowed: true }) };
  const services = new Map<unknown, unknown>([
    [SessionService, sessions],
    [MasterDataAccessService, access],
    [APP_CONFIG, config],
    [RateLimiterService, limiter],
  ]);
  installJsonBodyParsers({
    get: (key: unknown) => services.get(key),
    use: app.use.bind(app),
  } as never);
  app.post(
    [
      '/api/v1/supplier/master-data/parts/import/preview',
      '/api/v1/supplier/master-data/setup-import/preview',
    ],
    (req, res) => res.json({ length: req.body?.data?.length }),
  );
  return { app, sessions, access };
}
const paths = [
  '/api/v1/supplier/master-data/parts/import/preview',
  '/api/v1/supplier/master-data/setup-import/preview',
];
const path = paths[0]!;
const principal = {
  realm: 'SUPPLIER',
  role: 'SUPPLIER_ADMIN',
  purpose: 'HOSTED_PREPARATION',
  rawSessionToken: 'token',
  sessionId: 'session',
  mustChangePassword: false,
};

describe('import parser boundary', () => {
  it.each(paths)('rejects anonymous malformed bodies before parsing at %s', async (path) => {
    const { app } = setup();
    expect((await request(app).post(path).type('json').send('{invalid')).status).toBe(403);
    expect(
      (
        await request(app)
          .post(path + '/extra')
          .type('json')
          .send('{invalid')
      ).status,
    ).toBe(403);
    expect((await request(app).get(path).type('json').send('{invalid')).status).toBe(403);
  });
  it('checks role, password state and CSRF before parsing', async () => {
    const { app, sessions } = setup();
    for (const value of [
      { ...principal, role: 'QC' },
      { ...principal, mustChangePassword: true },
      principal,
    ]) {
      sessions.resolve.mockResolvedValue(value);
      expect(
        (
          await request(app)
            .post(path)
            .set('Cookie', 'tmmin_henkaten_supplier_session=token')
            .type('json')
            .send('{invalid')
        ).status,
      ).toBe(403);
    }
  });
  it.each(paths)(
    'preserves authorized preparation imports above the general body limit at %s',
    async (path) => {
      const { app, sessions, access } = setup();
      sessions.resolve.mockResolvedValue(principal);
      const response = await request(app)
        .post(path)
        .set('Cookie', 'tmmin_henkaten_supplier_session=token')
        .set('Origin', 'http://localhost:5173')
        .set('X-CSRF-Token', 'csrf')
        .send({ data: 'x'.repeat(6 * 1024 * 1024) });
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(6 * 1024 * 1024);
      expect(access.assertWritable).toHaveBeenCalledWith(principal);
    },
  );
  it('caps pending imports before authentication and releases slots after rejection', async () => {
    const { app, sessions } = setup();
    let unblock!: (value: null) => void;
    const pending = new Promise<null>((resolve) => {
      unblock = resolve;
    });
    sessions.resolve.mockImplementation(() => pending);
    const flights = [0, 1].map(() =>
      request(app)
        .post(path)
        .set('Cookie', 'tmmin_henkaten_supplier_session=token')
        .send({})
        .then((response) => response),
    );
    await vi.waitFor(() => expect(sessions.resolve).toHaveBeenCalledTimes(2));
    const overflow = await request(app).post(path).type('json').send('{malformed');
    expect(overflow.status).toBe(429);
    expect(overflow.headers['retry-after']).toBe('1');
    unblock(null);
    expect((await Promise.all(flights)).map((response) => response.status)).toEqual([403, 403]);
    expect((await request(app).post(path).type('json').send('{malformed')).status).toBe(403);
  });
});
