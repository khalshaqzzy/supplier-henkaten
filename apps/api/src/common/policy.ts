import { Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Capability } from '@tmmin-henkaten/contracts';

import type { ContextRequest, RequestPrincipal } from './request-context.js';
import { ProblemException } from './problem.js';

const POLICY_KEY = 'route-policy';
type RoutePolicy =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'capabilities'; capabilities: Capability[] };

export const Public = () => SetMetadata(POLICY_KEY, { kind: 'public' } satisfies RoutePolicy);
export const Authenticated = () =>
  SetMetadata(POLICY_KEY, { kind: 'authenticated' } satisfies RoutePolicy);
export const RequireCapabilities = (...capabilities: Capability[]) =>
  SetMetadata(POLICY_KEY, { kind: 'capabilities', capabilities } satisfies RoutePolicy);

export const CAPABILITIES: Readonly<Record<RequestPrincipal['role'], ReadonlySet<Capability>>> = {
  TMMIN_ADMIN: new Set([
    'TMMIN_SUPPLIER_READ',
    'TMMIN_SUPPLIER_MANAGE',
    'TMMIN_QUALITY_MANAGE',
    'TMMIN_SOURCE_MANAGE',
    'TMMIN_MASTER_DATA_READ',
  ]),
  TMMIN_QUALITY: new Set(['TMMIN_SUPPLIER_READ', 'TMMIN_MASTER_DATA_READ']),
  SUPPLIER_ADMIN: new Set([
    'SUPPLIER_SELF_SERVICE',
    'SUPPLIER_MASTER_DATA_READ',
    'SUPPLIER_MASTER_DATA_MANAGE',
  ]),
  SUPERVISOR: new Set(['SUPPLIER_SELF_SERVICE']),
  LINE_LEADER: new Set(['SUPPLIER_SELF_SERVICE']),
  QC: new Set(['SUPPLIER_SELF_SERVICE']),
};

@Injectable()
export class RoutePolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<RoutePolicy>(POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) {
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Route policy missing',
        detail: 'Access is denied by the default policy.',
      });
    }
    if (policy.kind === 'public') return true;

    const principal = context.switchToHttp().getRequest<ContextRequest>().principal;
    if (!principal) throw new UnauthorizedException('Authentication is required.');
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const passwordChangeAllowed =
      request.path.endsWith('/session') ||
      request.path.endsWith('/logout') ||
      request.path.endsWith('/change-password');
    if (principal.mustChangePassword && !passwordChangeAllowed) {
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Password change required',
        detail: 'The temporary password must be changed before using this capability.',
      });
    }
    if (policy.kind === 'authenticated') return true;

    const granted = CAPABILITIES[principal.role];
    if (!policy.capabilities.every((capability) => granted.has(capability))) {
      throw new ProblemException({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Forbidden',
        detail: 'The authenticated account does not have the required capability.',
      });
    }
    return true;
  }
}
