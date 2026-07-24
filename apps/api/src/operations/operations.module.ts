import { Module } from '@nestjs/common';

import { AssignmentIssueService } from '../shifts/assignment-issue.service.js';
import { OperationalAccessService } from '../shifts/operational-access.service.js';
import { ManMovementService } from './man-movement.service.js';
import { OperationalFinalizationService } from './operational-finalization.service.js';

@Module({
  providers: [
    AssignmentIssueService,
    ManMovementService,
    OperationalAccessService,
    OperationalFinalizationService,
  ],
  exports: [
    AssignmentIssueService,
    ManMovementService,
    OperationalAccessService,
    OperationalFinalizationService,
  ],
})
export class OperationsModule {}
