import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import {
  cancelHostedPreparationRequestSchema,
  createSupplierRequestSchema,
  createTmminQualityRequestSchema,
  expectedVersionSchema,
  opaqueIdSchema,
  replaceSupplierAdminRequestSchema,
  sourceCutoverRequestSchema,
  sourceModeSchema,
  supplierListQuerySchema,
  startHostedPreparationRequestSchema,
  updateSupplierRequestSchema,
  qualityUserListQuerySchema,
  type CancelHostedPreparationRequest,
  type CreateSupplierRequest,
  type CreateTmminQualityRequest,
  type ReplaceSupplierAdminRequest,
  type SourceCutoverRequest,
  type StartHostedPreparationRequest,
  type UpdateSupplierRequest,
  type SupplierListQuery,
  type QualityUserListQuery,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { mutationContext } from './mutation-context.js';
import { SourceGovernanceService } from './source-governance.service.js';
import { SupplierAdminService } from './supplier-admin.service.js';
import { UserAdminService } from './user-admin.service.js';

const sourcePreflightSchema = z.object({ targetMode: sourceModeSchema }).strict();

@Controller('/api/v1/tmmin/quality-users')
export class TmminQualityAdminController {
  constructor(private readonly users: UserAdminService) {}

  @RequireCapabilities('TMMIN_QUALITY_MANAGE')
  @Get()
  list(@ValidatedQuery(qualityUserListQuerySchema) query: QualityUserListQuery) {
    return this.users.listQuality(query);
  }

  @RequireCapabilities('TMMIN_QUALITY_MANAGE')
  @Get('/:id')
  get(@Param('id') id: string) {
    return this.users.getQuality(parseWithSchema(opaqueIdSchema, id));
  }

  @RequireCapabilities('TMMIN_QUALITY_MANAGE')
  @Post()
  async create(
    @ValidatedBody(createTmminQualityRequestSchema) body: CreateTmminQualityRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.users.createQuality(body, mutationContext(request));
  }

  @RequireCapabilities('TMMIN_QUALITY_MANAGE')
  @Post('/:id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.users.setQualityStatus(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_QUALITY_MANAGE')
  @Post('/:id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.users.setQualityStatus(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_QUALITY_MANAGE')
  @Post('/:id/reset-password')
  @HttpCode(200)
  async reset(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.users.resetQuality(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }
}

@Controller('/api/v1/tmmin/suppliers')
export class SupplierAdministrationController {
  constructor(
    private readonly suppliers: SupplierAdminService,
    private readonly source: SourceGovernanceService,
  ) {}

  @RequireCapabilities('TMMIN_SUPPLIER_READ')
  @Get()
  list(@ValidatedQuery(supplierListQuerySchema) query: SupplierListQuery) {
    return this.suppliers.list(query);
  }

  @RequireCapabilities('TMMIN_SUPPLIER_READ')
  @Get('/:id')
  get(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.suppliers.detail(
      parseWithSchema(opaqueIdSchema, id),
      this.principal(request).role === 'TMMIN_ADMIN',
    );
  }

  @RequireCapabilities('TMMIN_SUPPLIER_READ')
  @Get('/:id/source')
  sourceSummary(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.source.summary(
      parseWithSchema(opaqueIdSchema, id),
      this.principal(request).role === 'TMMIN_ADMIN',
    );
  }

  @RequireCapabilities('TMMIN_SUPPLIER_MANAGE')
  @Post()
  async create(
    @ValidatedBody(createSupplierRequestSchema) body: CreateSupplierRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.suppliers.create(body, mutationContext(request));
  }

  @RequireCapabilities('TMMIN_SUPPLIER_MANAGE')
  @Patch('/:id')
  update(
    @Param('id') id: string,
    @ValidatedBody(updateSupplierRequestSchema) body: UpdateSupplierRequest,
    @Req() request: ContextRequest,
  ) {
    return this.suppliers.update(
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SUPPLIER_MANAGE')
  @Post('/:id/activate')
  @HttpCode(200)
  activate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.suppliers.setActive(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SUPPLIER_MANAGE')
  @Post('/:id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.suppliers.setActive(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SUPPLIER_MANAGE')
  @Post('/:id/supplier-admin/replace')
  @HttpCode(200)
  async replaceAdmin(
    @Param('id') id: string,
    @ValidatedBody(replaceSupplierAdminRequestSchema)
    body: ReplaceSupplierAdminRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.suppliers.replaceAdmin(
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SUPPLIER_MANAGE')
  @Post('/:id/supplier-admin/reset-password')
  @HttpCode(200)
  async resetAdmin(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.suppliers.resetAdmin(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SOURCE_MANAGE')
  @Post('/:id/source/preparation')
  async startPreparation(
    @Param('id') id: string,
    @ValidatedBody(startHostedPreparationRequestSchema)
    body: StartHostedPreparationRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.suppliers.startPreparation(
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SOURCE_MANAGE')
  @Post('/:id/source/preparation/cancel')
  @HttpCode(200)
  cancelPreparation(
    @Param('id') id: string,
    @ValidatedBody(cancelHostedPreparationRequestSchema)
    body: CancelHostedPreparationRequest,
    @Req() request: ContextRequest,
  ) {
    return this.suppliers.cancelPreparation(
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      body.reason,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_SOURCE_MANAGE')
  @Post('/:id/source/preflight')
  @HttpCode(200)
  preflight(@Param('id') id: string, @Body() untrustedBody: unknown) {
    const body = parseWithSchema(sourcePreflightSchema, untrustedBody);
    return this.source.preflight(parseWithSchema(opaqueIdSchema, id), body.targetMode);
  }

  @RequireCapabilities('TMMIN_SOURCE_MANAGE')
  @Post('/:id/source/cutover')
  @HttpCode(200)
  cutover(
    @Param('id') id: string,
    @ValidatedBody(sourceCutoverRequestSchema) body: SourceCutoverRequest,
    @Req() request: ContextRequest,
  ) {
    return this.source.cutover(parseWithSchema(opaqueIdSchema, id), body, mutationContext(request));
  }

  private principal(request: ContextRequest) {
    if (!request.principal) throw new Error('PrincipalMissingAfterGuard');
    return request.principal;
  }
}
