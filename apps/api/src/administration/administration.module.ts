import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import {
  SupplierAdministrationController,
  TmminQualityAdminController,
} from './administration.controller.js';
import { SourceGovernanceService } from './source-governance.service.js';
import { HostedReadinessService } from './hosted-readiness.service.js';
import { SupplierAdminService } from './supplier-admin.service.js';
import { UserAdminService } from './user-admin.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TmminQualityAdminController, SupplierAdministrationController],
  providers: [
    UserAdminService,
    SupplierAdminService,
    SourceGovernanceService,
    HostedReadinessService,
  ],
  exports: [SourceGovernanceService, HostedReadinessService],
})
export class AdministrationModule {}
