import type { MutationContext } from '../administration/mutation-context.js';

export function masterAudit(
  context: MutationContext,
  supplierId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  changeSummary?: Record<string, unknown>,
) {
  return {
    actorKind: 'USER' as const,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
    supplierId,
    action,
    resourceType,
    ...(resourceId ? { resourceId } : {}),
    ...(changeSummary ? { changeSummary } : {}),
    correlationId: context.correlationId,
    ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  };
}
