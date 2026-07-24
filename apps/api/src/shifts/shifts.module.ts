import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import { ShiftService } from './shift.service.js';
import { SupplierShiftController, TmminShiftController } from './shift.controller.js';

@Module({
  imports: [OperationsModule],
  controllers: [SupplierShiftController, TmminShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftsModule {}
