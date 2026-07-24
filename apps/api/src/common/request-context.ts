import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { correlationIdSchema } from '@tmmin-henkaten/contracts';

export type RequestPrincipal = {
  userId: string;
  displayName: string;
  realm: 'TMMIN' | 'SUPPLIER';
  role: 'TMMIN_ADMIN' | 'TMMIN_QUALITY' | 'SUPPLIER_ADMIN' | 'SUPERVISOR' | 'LINE_LEADER' | 'QC';
  supplierId?: string;
  memberId?: string;
  sourceEpoch?: number;
  purpose: 'NORMAL' | 'HOSTED_PREPARATION';
  mustChangePassword: boolean;
  sessionId: string;
  rawSessionToken: string;
};

export type ContextRequest = Request & {
  correlationId?: string;
  principal?: RequestPrincipal;
};

export function correlationMiddleware(
  request: ContextRequest,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header('X-Correlation-ID');
  request.correlationId = correlationIdSchema.safeParse(incoming).success
    ? (incoming as string)
    : randomUUID();
  response.setHeader('X-Correlation-ID', request.correlationId);
  next();
}
