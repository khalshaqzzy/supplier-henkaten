import { Injectable } from '@nestjs/common';

import type { ContextRequest, RequestPrincipal } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import { PrismaService } from '../persistence/prisma.service.js';

@Injectable()
export class OperationalAccessService {
  constructor(private readonly prisma: PrismaService) {}

  supplierScope(request: ContextRequest): TenantScope {
    const principal = this.principal(request);
    if (principal.realm !== 'SUPPLIER' || !principal.supplierId) throw forbidden();
    return new TenantScope(principal.supplierId);
  }

  principal(request: ContextRequest): RequestPrincipal {
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

  async assertHostedOperational(principal: RequestPrincipal): Promise<TenantScope> {
    if (principal.realm !== 'SUPPLIER' || !principal.supplierId || principal.purpose !== 'NORMAL') {
      throw sourceMismatch();
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: principal.supplierId },
      select: { active: true, sourceMode: true, sourceEpoch: true },
    });
    if (
      !supplier?.active ||
      supplier.sourceMode !== 'HOSTED' ||
      supplier.sourceEpoch !== principal.sourceEpoch
    ) {
      throw sourceMismatch();
    }
    return new TenantScope(principal.supplierId);
  }

  async assertTmminReadable(supplierId: string, principal: RequestPrincipal): Promise<TenantScope> {
    if (principal.realm !== 'TMMIN') throw forbidden();
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource not found',
        detail: 'Supplier was not found.',
      });
    }
    return new TenantScope(supplierId);
  }

  async assertTmminHostedCurrent(
    supplierId: string,
    principal: RequestPrincipal,
  ): Promise<TenantScope> {
    if (principal.realm !== 'TMMIN') throw forbidden();
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { active: true, sourceMode: true },
    });
    if (!supplier) {
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource not found',
        detail: 'Supplier was not found.',
      });
    }
    if (!supplier.active || supplier.sourceMode !== 'HOSTED') {
      throw new ProblemException({
        status: 409,
        code: 'SOURCE_MODE_MISMATCH',
        title: 'Hosted board unavailable',
        detail: 'Assignment Board is available only for an active supplier using Hosted source.',
      });
    }
    return new TenantScope(supplierId);
  }
}

function sourceMismatch(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'SOURCE_MODE_MISMATCH',
    title: 'Source mode mismatch',
    detail: 'Hosted operational writes require a normal session for the active Hosted source.',
  });
}

function forbidden(): ProblemException {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'The authenticated account does not have access to this operational resource.',
  });
}
