import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import {
  SupplierHenkatenController,
  TmminHenkatenController,
  TmminWarningController,
  TmminGlobalHenkatenController,
} from './henkaten.controller.js';
import { HenkatenDeletionController } from './henkaten-deletion.controller.js';
import { HenkatenDeletionService } from './henkaten-deletion.service.js';
import { HenkatenService } from './henkaten.service.js';
import { ApprovalService } from './approval.service.js';
import { PcrModule } from '../pcr/pcr.module.js';
import { HenkatenExportService } from './henkaten-export.service.js';

@Module({
  imports: [OperationsModule, MasterDataModule, PcrModule],
  controllers: [
    HenkatenDeletionController,
    SupplierHenkatenController,
    TmminHenkatenController,
    TmminWarningController,
    TmminGlobalHenkatenController,
  ],
  providers: [HenkatenDeletionService, HenkatenService, ApprovalService, HenkatenExportService],
  exports: [HenkatenService],
})
export class HenkatenModule {}
