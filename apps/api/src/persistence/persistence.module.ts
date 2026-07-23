import { Global, Module } from '@nestjs/common';

import { AuditWriter } from './audit-writer.js';
import { OutboxService } from './outbox.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantUserRepository } from './tenant-user.repository.js';

@Global()
@Module({
  providers: [PrismaService, AuditWriter, OutboxService, TenantUserRepository],
  exports: [PrismaService, AuditWriter, OutboxService, TenantUserRepository],
})
export class PersistenceModule {}
