import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import {
  SupplierHenkatenController,
  TmminHenkatenController,
  TmminWarningController,
} from './henkaten.controller.js';
import { HenkatenService } from './henkaten.service.js';
import { ApprovalService } from './approval.service.js';

@Module({
  imports: [OperationsModule],
  controllers: [SupplierHenkatenController, TmminHenkatenController, TmminWarningController],
  providers: [HenkatenService, ApprovalService],
  exports: [HenkatenService],
})
export class HenkatenModule {}
