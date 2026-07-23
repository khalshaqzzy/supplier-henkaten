import type { ContextRequest } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';

export type MutationContext = {
  actorUserId: string;
  actorRole:
    'TMMIN_ADMIN' | 'TMMIN_QUALITY' | 'SUPPLIER_ADMIN' | 'SUPERVISOR' | 'LINE_LEADER' | 'QC';
  actorSupplierId?: string;
  correlationId: string;
  sourceIp?: string;
  userAgent?: string;
};

export function mutationContext(request: ContextRequest): MutationContext {
  if (!request.principal) {
    throw new ProblemException({
      status: 401,
      code: 'SESSION_EXPIRED',
      title: 'Session expired',
      detail: 'An active session is required.',
    });
  }
  const userAgent = request.header('User-Agent');
  return {
    actorUserId: request.principal.userId,
    actorRole: request.principal.role,
    ...(request.principal.supplierId ? { actorSupplierId: request.principal.supplierId } : {}),
    correlationId: request.correlationId ?? 'unavailable',
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
