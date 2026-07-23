import { Module } from '@nestjs/common';

import { AssignmentIssueService } from './assignment-issue.service.js';
import { OperationalAccessService } from './operational-access.service.js';
import { ShiftService } from './shift.service.js';
import { SupplierShiftController, TmminShiftController } from './shift.controller.js';

@Module({
  controllers: [SupplierShiftController, TmminShiftController],
  providers: [AssignmentIssueService, OperationalAccessService, ShiftService],
  exports: [AssignmentIssueService, OperationalAccessService, ShiftService],
})
export class ShiftsModule {}
