import { Controller, Get, Param, Put, Req } from '@nestjs/common';
import {
  opaqueIdSchema,
  tanokoSaveSchema,
  tanokoHistoryQuerySchema,
  type TanokoSave,
  type TanokoHistoryQuery,
} from '@tmmin-henkaten/contracts';
import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { ValidatedBody, ValidatedQuery, parseWithSchema } from '../common/zod.js';
import { mutationContext } from '../administration/mutation-context.js';
import { TanokoService } from './tanoko.service.js';

@Controller('/api/v1/supplier/tanoko')
export class TanokoController {
  constructor(private readonly tanoko: TanokoService) {}
  @Get()
  @RequireCapabilities('SUPPLIER_TANOKO_READ')
  matrix(@Req() req: ContextRequest) {
    return this.tanoko.matrix(req.principal!);
  }
  @Get('/history')
  @RequireCapabilities('SUPPLIER_TANOKO_READ')
  history(
    @Req() req: ContextRequest,
    @ValidatedQuery(tanokoHistoryQuerySchema) query: TanokoHistoryQuery,
  ) {
    return this.tanoko.history(req.principal!, query);
  }
  @Put('/members/:memberId/jobs/:jobId')
  @RequireCapabilities('SUPPLIER_TANOKO_MANAGE')
  save(
    @Req() req: ContextRequest,
    @Param('memberId') memberId: string,
    @Param('jobId') jobId: string,
    @ValidatedBody(tanokoSaveSchema) body: TanokoSave,
  ) {
    return this.tanoko.save(
      req.principal!,
      parseWithSchema(opaqueIdSchema, memberId),
      parseWithSchema(opaqueIdSchema, jobId),
      body,
      mutationContext(req),
    );
  }
}
