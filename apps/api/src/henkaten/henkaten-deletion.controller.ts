import { Controller, Delete, Get, HttpCode, Param, Req } from '@nestjs/common';
import {
  deleteHenkatenRequestSchema,
  deleteSupplierHenkatensRequestSchema,
  opaqueIdSchema,
  pcrRecordKindSchema,
  type DeleteHenkatenRequest,
  type DeleteSupplierHenkatensRequest,
} from '@tmmin-henkaten/contracts';
import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody } from '../common/zod.js';
import { requiredIdempotencyKey } from '../common/idempotency.js';
import { mutationContext } from '../administration/mutation-context.js';
import { OperationalAccessService } from '../shifts/operational-access.service.js';
import { HenkatenDeletionService } from './henkaten-deletion.service.js';

@Controller('/api/v1/tmmin')
export class HenkatenDeletionController {
  constructor(
    private readonly access: OperationalAccessService,
    private readonly deletion: HenkatenDeletionService,
  ) {}

  @RequireCapabilities('TMMIN_HENKATEN_DELETE')
  @Get('/suppliers/:supplierId/henkaten-deletion-preview')
  preview(@Param('supplierId') supplierId: string, @Req() request: ContextRequest) {
    return this.deletion.preview(
      parseWithSchema(opaqueIdSchema, supplierId),
      this.access.principal(request),
    );
  }

  @RequireCapabilities('TMMIN_HENKATEN_DELETE')
  @Delete('/henkatens/:kind/:supplierId/:recordId')
  @HttpCode(200)
  individual(
    @Param('kind') kind: string,
    @Param('supplierId') supplierId: string,
    @Param('recordId') recordId: string,
    @ValidatedBody(deleteHenkatenRequestSchema) body: DeleteHenkatenRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deletion.remove(
      parseWithSchema(opaqueIdSchema, supplierId),
      this.access.principal(request),
      requiredIdempotencyKey(request),
      body,
      {
        kind: parseWithSchema(pcrRecordKindSchema, kind),
        id: parseWithSchema(opaqueIdSchema, recordId),
      },
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_HENKATEN_DELETE')
  @Delete('/suppliers/:supplierId/henkatens')
  @HttpCode(200)
  all(
    @Param('supplierId') supplierId: string,
    @ValidatedBody(deleteSupplierHenkatensRequestSchema) body: DeleteSupplierHenkatensRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deletion.remove(
      parseWithSchema(opaqueIdSchema, supplierId),
      this.access.principal(request),
      requiredIdempotencyKey(request),
      body,
      null,
      mutationContext(request),
    );
  }
}
