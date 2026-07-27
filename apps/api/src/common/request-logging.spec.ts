import { describe, expect, it } from 'vitest';

import {
  completedRequestLog,
  failedRequestLog,
  serializeLoggedRequest,
} from './request-logging.js';

describe('completed request logging', () => {
  it('captures the resolved route template at response completion', () => {
    expect(
      completedRequestLog(
        { method: 'GET', route: { path: '/api/v1/supplier/shifts/:id' } },
        { res: { statusCode: 200 } },
      ),
    ).toEqual({
      req: { method: 'GET' },
      routeTemplate: '/api/v1/supplier/shifts/:id',
      res: { statusCode: 200 },
    });
  });

  it('does not fall back to a raw URL for unmatched requests or errors', () => {
    expect(
      failedRequestLog({ method: 'GET' }, new Error('request failed'), {
        res: { statusCode: 404 },
      }),
    ).toEqual({
      req: { method: 'GET' },
      routeTemplate: 'UNMATCHED',
      res: { statusCode: 404 },
    });
  });

  it('preserves the completed route when pino applies the request serializer again', () => {
    expect(
      serializeLoggedRequest({
        method: 'GET',
        route: '/api/v1/supplier/shifts/:id',
      }),
    ).toEqual({
      method: 'GET',
      route: '/api/v1/supplier/shifts/:id',
    });
  });

  it('prefers the route captured after Nest route resolution', () => {
    expect(
      completedRequestLog(
        {
          method: 'GET',
          logRoute: '/api/v1/supplier/shifts/:id',
        },
        {},
      ),
    ).toEqual({
      req: { method: 'GET' },
      routeTemplate: '/api/v1/supplier/shifts/:id',
    });
  });
});
