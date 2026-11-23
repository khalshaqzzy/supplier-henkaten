import { Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';

import {
  createShiftRotationRequestSchema,
  masterDeleteRequestSchema,
  opaqueIdSchema,
  runShiftRotationRequestSchema,
  updateShiftRotationRequestSchema,
  type CreateShiftRotationRequest,
  type MasterDeleteKind,
  type MasterDeleteRequest,
  type UpdateShiftRotationRequest,
} from '@tmmin-henkaten/contracts';

import { mutationContext } from '../administration/mutation-context.js';
import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest, RequestPrincipal } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody } from '../common/zod.js';
import { MasterDataAccessService } from './master-data-access.service.js';
import { MasterDeleteService } from './master-delete.service.js';
import { ShiftRotationService } from './shift-rotation.service.js';

@Controller('/api/v1/supplier/master-data')
export class SupplierMasterDeleteController {
  constructor(
    private readonly access: MasterDataAccessService,
    private readonly deletes: MasterDeleteService,
  ) {}

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Get('/lines/:lineId/jobs/:id/delete-preview')
  async jobPreview(
    @Param('lineId') lineId: string,
    @Param('id') id: string,
    @Req() request: ContextRequest,
  ) {
    return this.deletes.preview(await this.access.assertWritable(principal(request)), {
      kind: 'JOB',
      id: parseWithSchema(opaqueIdSchema, id),
      lineId: parseWithSchema(opaqueIdSchema, lineId),
    });
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/jobs/:id/delete')
  async jobDelete(
    @Param('lineId') lineId: string,
    @Param('id') id: string,
    @ValidatedBody(masterDeleteRequestSchema) body: MasterDeleteRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deletes.delete(
      await this.access.assertWritable(principal(request)),
      {
        kind: 'JOB',
        id: parseWithSchema(opaqueIdSchema, id),
        lineId: parseWithSchema(opaqueIdSchema, lineId),
      },
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Get('/lines/:id/delete-preview')
  linePreview(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.previewOf('LINE', id, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:id/delete')
  lineDelete(
    @Param('id') id: string,
    @ValidatedBody(masterDeleteRequestSchema) body: MasterDeleteRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deleteOf('LINE', id, body, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Get('/members/:id/delete-preview')
  memberPreview(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.previewOf('MEMBER', id, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/members/:id/delete')
  memberDelete(
    @Param('id') id: string,
    @ValidatedBody(masterDeleteRequestSchema) body: MasterDeleteRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deleteOf('MEMBER', id, body, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Get('/parts/:id/delete-preview')
  partPreview(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.previewOf('PART', id, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/parts/:id/delete')
  partDelete(
    @Param('id') id: string,
    @ValidatedBody(masterDeleteRequestSchema) body: MasterDeleteRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deleteOf('PART', id, body, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Get('/shift-templates/:id/delete-preview')
  shiftTemplatePreview(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.previewOf('SHIFT_TEMPLATE', id, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/shift-templates/:id/delete')
  shiftTemplateDelete(
    @Param('id') id: string,
    @ValidatedBody(masterDeleteRequestSchema) body: MasterDeleteRequest,
    @Req() request: ContextRequest,
  ) {
    return this.deleteOf('SHIFT_TEMPLATE', id, body, request);
  }

  private async previewOf(kind: MasterDeleteKind, id: string, request: ContextRequest) {
    return this.deletes.preview(await this.access.assertWritable(principal(request)), {
      kind,
      id: parseWithSchema(opaqueIdSchema, id),
    });
  }

  private async deleteOf(
    kind: MasterDeleteKind,
    id: string,
    body: MasterDeleteRequest,
    request: ContextRequest,
  ) {
    return this.deletes.delete(
      await this.access.assertWritable(principal(request)),
      { kind, id: parseWithSchema(opaqueIdSchema, id) },
      body,
      mutationContext(request),
    );
  }
}

@Controller('/api/v1/supplier/master-data/shift-rotations')
export class SupplierShiftRotationController {
  constructor(
    private readonly access: MasterDataAccessService,
    private readonly rotations: ShiftRotationService,
  ) {}

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get()
  list(@Req() request: ContextRequest) {
    return this.rotations.list(this.access.supplierScope(request));
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post()
  async create(
    @ValidatedBody(createShiftRotationRequestSchema) body: CreateShiftRotationRequest,
    @Req() request: ContextRequest,
  ) {
    return this.rotations.create(
      await this.access.assertWritable(principal(request)),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/:id')
  async update(
    @Param('id') id: string,
    @ValidatedBody(updateShiftRotationRequestSchema) body: UpdateShiftRotationRequest,
    @Req() request: ContextRequest,
  ) {
    return this.rotations.update(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/run')
  async run(
    @Param('id') id: string,
    @ValidatedBody(runShiftRotationRequestSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.rotations.runNow(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/delete')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @ValidatedBody(runShiftRotationRequestSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    await this.rotations.remove(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }
}

function principal(request: ContextRequest): RequestPrincipal {
  if (!request.principal) throw new Error('PrincipalMissingAfterGuard');
  return request.principal;
}
