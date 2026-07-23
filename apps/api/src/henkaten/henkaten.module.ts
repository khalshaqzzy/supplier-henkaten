import { Module } from '@nestjs/common';

import { ShiftsModule } from '../shifts/shifts.module.js';
import {
  SupplierHenkatenController,
  TmminHenkatenController,
  TmminWarningController,
} from './henkaten.controller.js';
import { HenkatenService } from './henkaten.service.js';

@Module({
  imports: [ShiftsModule],
  controllers: [SupplierHenkatenController, TmminHenkatenController, TmminWarningController],
  providers: [HenkatenService],
  exports: [HenkatenService],
})
export class HenkatenModule {}
