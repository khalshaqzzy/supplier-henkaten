import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import { ShiftService } from './shift.service.js';
import { TmminShiftController } from './shift.controller.js';

@Module({
  imports: [OperationsModule],
  controllers: [TmminShiftController],
  providers: [ShiftService],
})
export class ShiftsModule {}
