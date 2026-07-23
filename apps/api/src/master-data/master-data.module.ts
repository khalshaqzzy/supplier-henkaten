import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AssignmentService } from './assignment.service.js';
import { CatalogService } from './catalog.service.js';
import { ChecklistService } from './checklist.service.js';
import {
  SupplierCatalogController,
  SupplierConfigurationController,
  SupplierMemberController,
} from './master-data.controller.js';
import { MasterDataAccessService } from './master-data-access.service.js';
import { MemberService } from './member.service.js';
import { PhotoService } from './photo.service.js';
import { TmminMasterDataController } from './tmmin-master-data.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [
    SupplierMemberController,
    SupplierCatalogController,
    SupplierConfigurationController,
    TmminMasterDataController,
  ],
  providers: [
    MasterDataAccessService,
    MemberService,
    CatalogService,
    ChecklistService,
    AssignmentService,
    PhotoService,
  ],
  exports: [MasterDataAccessService, ChecklistService, AssignmentService, PhotoService],
})
export class MasterDataModule {}
