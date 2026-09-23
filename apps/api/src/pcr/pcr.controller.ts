import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import {
  opaqueIdSchema,
  pcrCorrectionRequestSchema,
  pcrRecordKindSchema,
  type PcrCorrectionRequest,
} from '@tmmin-henkaten/contracts';

import { mutationContext } from '../administration/mutation-context.js';
import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody } from '../common/zod.js';
import { PcrService } from './pcr.service.js';

@Controller('/api/v1/tmmin/henkatens')
export class PcrController {
  constructor(private readonly pcr: PcrService) {}

  @RequireCapabilities('TMMIN_PCR_CORRECT')
  @Post('/:kind/:supplierId/:recordId/pcr-decision')
  @HttpCode(200)
  correct(
    @Param('kind') kind: string,
    @Param('supplierId') supplierId: string,
    @Param('recordId') recordId: string,
    @ValidatedBody(pcrCorrectionRequestSchema) body: PcrCorrectionRequest,
    @Req() request: ContextRequest,
  ) {
    return this.pcr.correct(
      parseWithSchema(pcrRecordKindSchema, kind),
      parseWithSchema(opaqueIdSchema, supplierId),
      parseWithSchema(opaqueIdSchema, recordId),
      body,
      mutationContext(request),
    );
  }
}
