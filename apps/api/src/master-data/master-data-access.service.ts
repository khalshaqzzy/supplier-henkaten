import { Injectable } from '@nestjs/common';

import type { ContextRequest, RequestPrincipal } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import { PrismaService } from '../persistence/prisma.service.js';

@Injectable()
export class MasterDataAccessService {
  constructor(private readonly prisma: PrismaService) {}

  supplierScope(request: ContextRequest): TenantScope {
    const principal = request.principal;
    if (!principal?.supplierId || principal.realm !== 'SUPPLIER') {
      throw forbidden('A supplier session is required.');
    }
    return new TenantScope(principal.supplierId);
  }

  async assertWritable(principal: RequestPrincipal): Promise<TenantScope> {
    if (!principal.supplierId || principal.role !== 'SUPPLIER_ADMIN') {
      throw forbidden('Supplier Admin permission is required.');
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: principal.supplierId },
      select: { id: true, active: true, sourceMode: true, sourceEpoch: true },
    });
    if (!supplier?.active || supplier.sourceEpoch !== principal.sourceEpoch) {
      throw sourceModeMismatch();
    }
    if (principal.purpose === 'NORMAL' && supplier.sourceMode === 'HOSTED') {
      return new TenantScope(supplier.id);
    }
    if (principal.purpose === 'HOSTED_PREPARATION' && supplier.sourceMode === 'EXTERNAL') {
      const preparation = await this.prisma.hostedPreparation.findFirst({
        where: {
          supplierId: supplier.id,
          status: 'ACTIVE',
          sourceEpoch: supplier.sourceEpoch,
          adminUserId: principal.userId,
        },
        select: { id: true },
      });
      if (preparation) return new TenantScope(supplier.id);
    }
    throw sourceModeMismatch();
  }

  async assertTmminReadable(supplierId: string, principal: RequestPrincipal): Promise<TenantScope> {
    if (principal.realm !== 'TMMIN') throw forbidden('TMMIN permission is required.');
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { sourceMode: true, hostedPreparations: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    if (!supplier) {
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource not found',
        detail: 'Supplier was not found.',
      });
    }
    const preparationVisible =
      principal.role === 'TMMIN_ADMIN' && supplier.hostedPreparations.length > 0;
    if (supplier.sourceMode !== 'HOSTED' && !preparationVisible) {
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource not found',
        detail: 'Hosted master data was not found.',
      });
    }
    return new TenantScope(supplierId);
  }
}

function forbidden(detail: string): ProblemException {
  return new ProblemException({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', detail });
}

function sourceModeMismatch(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'SOURCE_MODE_MISMATCH',
    title: 'Source mode mismatch',
    detail: 'Hosted master data writes are not allowed for this session and source mode.',
  });
}
