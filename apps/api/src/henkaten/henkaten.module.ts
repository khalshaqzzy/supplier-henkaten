import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import {
  SupplierHenkatenController,
  TmminHenkatenController,
  TmminWarningController,
  TmminGlobalHenkatenController,
} from './henkaten.controller.js';
import { HenkatenService } from './henkaten.service.js';
import { ApprovalService } from './approval.service.js';
import { PcrModule } from '../pcr/pcr.module.js';

@Module({
  imports: [OperationsModule, MasterDataModule, PcrModule],
  controllers: [
    SupplierHenkatenController,
    TmminHenkatenController,
    TmminWarningController,
    TmminGlobalHenkatenController,
  ],
  providers: [HenkatenService, ApprovalService],
  exports: [HenkatenService],
})
export class HenkatenModule {}
