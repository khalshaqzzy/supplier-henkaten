import { Injectable } from '@nestjs/common';

import { TenantScope } from '../common/scope.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class TenantUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(scope: TenantScope, id: string) {
    return this.prisma.user.findFirst({
      where: { id, supplierId: scope.supplierId, realm: 'SUPPLIER' },
    });
  }

  list(scope: TenantScope) {
    return this.prisma.user.findMany({
      where: { supplierId: scope.supplierId, realm: 'SUPPLIER' },
      orderBy: { id: 'asc' },
    });
  }
}
