import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  setupCommitRequestSchema,
  setupPreviewRequestSchema,
  setupResetRequestSchema,
  type SetupCommit,
  type SetupDecision,
  type SetupRow,
} from '@tmmin-henkaten/contracts';
import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';
import { ValidatedBody } from '../common/zod.js';
import { requiredIdempotencyKey } from '../common/idempotency.js';
import { mutationContext } from '../administration/mutation-context.js';
import { MasterDataAccessService } from './master-data-access.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { SetupService } from './setup.service.js';
import { createSetupTemplate } from './setup-template.js';

@Controller('/api/v1/supplier/master-data')
@RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
export class SetupController {
  constructor(
    private readonly service: SetupService,
    private readonly access: MasterDataAccessService,
    private readonly prisma: PrismaService,
  ) {}
  @Get('/setup-import/template')
  async template(@Req() request: ContextRequest, @Res() response: Response) {
    const scope = await this.access.assertWritable(principal(request));
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: scope.supplierId },
    });
    response
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', 'attachment; filename="template-setup-supplier.xlsx"');
    response.setHeader('Cache-Control', 'no-store');
    response.send(await createSetupTemplate(supplier.timezone));
  }
  @Post('/setup-import/preview')
  preview(
    @Req() request: ContextRequest,
    @ValidatedBody(setupPreviewRequestSchema)
    body: { rows: SetupRow[]; decisions?: SetupDecision[] },
  ) {
    return this.service.preview(principal(request), body.rows, body.decisions);
  }
  @Post('/setup-import/commit')
  commit(
    @Req() request: ContextRequest,
    @ValidatedBody(setupCommitRequestSchema) body: SetupCommit,
  ) {
    return this.service.commit(
      principal(request),
      body,
      requiredIdempotencyKey(request),
      mutationContext(request),
    );
  }
  @Get('/setup-import/operations/:id')
  operation(@Req() request: ContextRequest, @Param('id') id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Operasi tidak ditemukan',
        detail: 'Operasi setup tidak tersedia.',
      });
    return this.service.operation(principal(request), id);
  }
  @Get('/setup-reset/preview')
  resetPreview(@Req() request: ContextRequest) {
    return this.service.resetPreview(principal(request));
  }
  @Post('/setup-reset')
  reset(
    @Req() request: ContextRequest,
    @ValidatedBody(setupResetRequestSchema) body: { revision: number; password: string },
  ) {
    return this.service.reset(
      principal(request),
      body,
      requiredIdempotencyKey(request),
      mutationContext(request),
    );
  }
}
function principal(request: ContextRequest) {
  if (!request.principal)
    throw new ProblemException({
      status: 401,
      code: 'SESSION_EXPIRED',
      title: 'Sesi berakhir',
      detail: 'Masuk kembali.',
    });
  return request.principal;
}
