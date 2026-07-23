import { createReadStream } from 'node:fs';

import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import {
  assignmentMoveRequestSchema,
  assignmentMutationRequestSchema,
  assignmentRemoveRequestSchema,
  createJobRequestSchema,
  createLineRequestSchema,
  createMemberRequestSchema,
  createPartRequestSchema,
  createShiftTemplateRequestSchema,
  expectedVersionSchema,
  henkatenCategorySchema,
  masterListQuerySchema,
  opaqueIdSchema,
  reorderRequestSchema,
  updateChecklistDraftRequestSchema,
  updateJobRequestSchema,
  updateLineRequestSchema,
  updateMemberAccountRequestSchema,
  updateMemberRequestSchema,
  updatePartRequestSchema,
  updateShiftTemplateRequestSchema,
  type CreateMemberRequest,
  type HenkatenCategory,
  type MasterListQuery,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import { ProblemException } from '../common/problem.js';
import type { ContextRequest, RequestPrincipal } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { mutationContext } from '../administration/mutation-context.js';
import { AssignmentService } from './assignment.service.js';
import { CatalogService } from './catalog.service.js';
import { ChecklistService } from './checklist.service.js';
import { MasterDataAccessService } from './master-data-access.service.js';
import { MemberService } from './member.service.js';
import { PhotoService } from './photo.service.js';

@Controller('/api/v1/supplier/master-data/members')
export class SupplierMemberController {
  constructor(
    private readonly access: MasterDataAccessService,
    private readonly members: MemberService,
    private readonly photos: PhotoService,
  ) {}

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get()
  list(
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.members.list(this.access.supplierScope(request), query);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/:id')
  get(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.members.get(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post()
  async create(
    @ValidatedBody(createMemberRequestSchema) body: CreateMemberRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.access.assertWritable(principal(request));
    response.setHeader('Cache-Control', 'no-store');
    return this.members.create(scope, body, mutationContext(request));
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/:id')
  async update(
    @Param('id') id: string,
    @ValidatedBody(updateMemberRequestSchema)
    body: { expectedVersion: number; fullName?: string; registrationNumber?: string },
    @Req() request: ContextRequest,
  ) {
    return this.members.update(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/activate')
  actionActivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.memberStatus(id, body.expectedVersion, true, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/deactivate')
  actionDeactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.memberStatus(id, body.expectedVersion, false, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/:id/account')
  async accountUpdate(
    @Param('id') id: string,
    @ValidatedBody(updateMemberAccountRequestSchema)
    body: { expectedVersion: number; username: string },
    @Req() request: ContextRequest,
  ) {
    return this.members.updateAccount(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/account/activate')
  accountActivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.accountStatus(id, body.expectedVersion, true, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/account/deactivate')
  accountDeactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.accountStatus(id, body.expectedVersion, false, request);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/account/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.members.resetPassword(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    @Req() request: ContextRequest,
  ) {
    if (!file) {
      throw new ProblemException({
        status: 400,
        code: 'INVALID_IMAGE',
        title: 'Invalid image',
        detail: 'Multipart field photo is required.',
      });
    }
    const scope = await this.access.assertWritable(principal(request));
    await this.photos.upload(
      scope,
      parseWithSchema(opaqueIdSchema, id),
      file,
      mutationContext(request),
    );
    return this.members.get(scope, parseWithSchema(opaqueIdSchema, id));
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:id/photo/remove')
  @HttpCode(204)
  async removePhoto(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    await this.photos.remove(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/:id/photo/:variant')
  async photo(
    @Param('id') id: string,
    @Param('variant') variantInput: string,
    @Req() request: ContextRequest,
    @Res() response: Response,
  ) {
    const variant =
      variantInput === 'full' ? 'full' : variantInput === 'thumbnail' ? 'thumbnail' : null;
    if (!variant) {
      throw new ProblemException({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource not found',
        detail: 'Photo variant was not found.',
      });
    }
    const asset = await this.photos.asset(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
      variant,
    );
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('ETag', `"${asset.checksum}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(asset.path).pipe(response);
  }

  private async memberStatus(
    id: string,
    version: number,
    active: boolean,
    request: ContextRequest,
  ) {
    return this.members.setActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      version,
      active,
      mutationContext(request),
    );
  }

  private async accountStatus(
    id: string,
    version: number,
    active: boolean,
    request: ContextRequest,
  ) {
    return this.members.setAccountActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      version,
      active,
      mutationContext(request),
    );
  }
}

@Controller('/api/v1/supplier/master-data')
export class SupplierCatalogController {
  constructor(
    private readonly access: MasterDataAccessService,
    private readonly catalog: CatalogService,
  ) {}

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/lines')
  lines(
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.catalog.listLines(this.access.supplierScope(request), query);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines')
  async createLine(
    @ValidatedBody(createLineRequestSchema) body: { code: string; name: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.createLine(
      await this.access.assertWritable(principal(request)),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/lines/:id')
  line(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.catalog.getLine(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/lines/:id')
  async updateLine(
    @Param('id') id: string,
    @ValidatedBody(updateLineRequestSchema)
    body: { expectedVersion: number; code?: string; name?: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.updateLine(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:id/activate')
  async lineActivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setLineActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:id/deactivate')
  async lineDeactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setLineActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/lines/:lineId/jobs')
  jobs(
    @Param('lineId') lineId: string,
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.catalog.listJobs(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, lineId),
      query,
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/jobs')
  async createJob(
    @Param('lineId') lineId: string,
    @ValidatedBody(createJobRequestSchema) body: { name: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.createJob(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, lineId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/lines/:lineId/jobs/:id')
  job(@Param('lineId') lineId: string, @Param('id') id: string, @Req() request: ContextRequest) {
    return this.catalog.getJob(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, lineId),
      parseWithSchema(opaqueIdSchema, id),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/lines/:lineId/jobs/:id')
  async updateJob(
    @Param('lineId') lineId: string,
    @Param('id') id: string,
    @ValidatedBody(updateJobRequestSchema) body: { expectedVersion: number; name: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.updateJob(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, lineId),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/jobs/:id/activate')
  async jobActivate(
    @Param('lineId') lineId: string,
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setJobActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, lineId),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/jobs/:id/deactivate')
  async jobDeactivate(
    @Param('lineId') lineId: string,
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setJobActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, lineId),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/parts')
  parts(
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.catalog.listParts(this.access.supplierScope(request), query);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/parts')
  async createPart(
    @ValidatedBody(createPartRequestSchema) body: { partNumber: string; partName: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.createPart(
      await this.access.assertWritable(principal(request)),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/parts/:id')
  part(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.catalog.getPart(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/parts/:id')
  async updatePart(
    @Param('id') id: string,
    @ValidatedBody(updatePartRequestSchema)
    body: { expectedVersion: number; partNumber?: string; partName?: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.updatePart(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/parts/:id/activate')
  async partActivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setPartActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/parts/:id/deactivate')
  async partDeactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setPartActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/shift-templates')
  shifts(
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.catalog.listShiftTemplates(this.access.supplierScope(request), query);
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/shift-templates')
  async createShift(
    @ValidatedBody(createShiftTemplateRequestSchema)
    body: { name: string; startTime: string; endTime: string; timezone: string },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.createShiftTemplate(
      await this.access.assertWritable(principal(request)),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/shift-templates/:id')
  shift(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.catalog.getShiftTemplate(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/shift-templates/:id')
  async updateShift(
    @Param('id') id: string,
    @ValidatedBody(updateShiftTemplateRequestSchema)
    body: {
      expectedVersion: number;
      name?: string;
      startTime?: string;
      endTime?: string;
      timezone?: string;
    },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.updateShiftTemplate(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/shift-templates/:id/activate')
  async shiftActivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setShiftTemplateActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/shift-templates/:id/deactivate')
  async shiftDeactivate(
    @Param('id') id: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.setShiftTemplateActive(
      await this.access.assertWritable(principal(request)),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:collection/reorder')
  async reorder(
    @Param('collection') collection: string,
    @ValidatedBody(reorderRequestSchema)
    body: { items: Array<{ id: string; expectedVersion: number }> },
    @Req() request: ContextRequest,
  ) {
    const kind =
      collection === 'lines' ? 'line' : collection === 'shift-templates' ? 'shift' : null;
    if (!kind) throw new Error('InvalidReorderCollection');
    return this.catalog.reorder(
      await this.access.assertWritable(principal(request)),
      kind,
      body.items,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/jobs/reorder')
  async reorderJobs(
    @Param('lineId') lineId: string,
    @ValidatedBody(reorderRequestSchema)
    body: { items: Array<{ id: string; expectedVersion: number }> },
    @Req() request: ContextRequest,
  ) {
    return this.catalog.reorder(
      await this.access.assertWritable(principal(request)),
      'job',
      body.items,
      mutationContext(request),
      parseWithSchema(opaqueIdSchema, lineId),
    );
  }
}

@Controller('/api/v1/supplier/master-data')
export class SupplierConfigurationController {
  constructor(
    private readonly access: MasterDataAccessService,
    private readonly checklists: ChecklistService,
    private readonly assignments: AssignmentService,
  ) {}

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/checklists/:category/draft')
  draft(@Param('category') category: string, @Req() request: ContextRequest) {
    return this.checklists.draft(this.access.supplierScope(request), categoryValue(category));
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Patch('/checklists/:category/draft')
  async updateDraft(
    @Param('category') category: string,
    @ValidatedBody(updateChecklistDraftRequestSchema)
    body: { expectedVersion?: number; items: Array<{ label: string }> },
    @Req() request: ContextRequest,
  ) {
    return this.checklists.updateDraft(
      await this.access.assertWritable(principal(request)),
      categoryValue(category),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/checklists/:category/publish')
  async publish(
    @Param('category') category: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.checklists.publish(
      await this.access.assertWritable(principal(request)),
      categoryValue(category),
      body.expectedVersion,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/checklists/:category/versions')
  versions(@Param('category') category: string, @Req() request: ContextRequest) {
    return this.checklists.versions(this.access.supplierScope(request), categoryValue(category));
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/checklists/:category/activate')
  async activateChecklist(
    @Param('category') category: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.checklists.setActive(
      await this.access.assertWritable(principal(request)),
      categoryValue(category),
      body.expectedVersion,
      true,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/checklists/:category/deactivate')
  async deactivateChecklist(
    @Param('category') category: string,
    @ValidatedBody(expectedVersionSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.checklists.setActive(
      await this.access.assertWritable(principal(request)),
      categoryValue(category),
      body.expectedVersion,
      false,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/default-assignments')
  assignmentsGet(@Req() request: ContextRequest) {
    return this.assignments.get(this.access.supplierScope(request));
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/default-supervisor')
  async supervisor(
    @Param('lineId') lineId: string,
    @ValidatedBody(assignmentMutationRequestSchema)
    body: { memberId: string; expectedAssignmentVersion?: number },
    @Req() request: ContextRequest,
  ) {
    return this.assignments.assign(
      await this.access.assertWritable(principal(request)),
      'supervisor',
      parseWithSchema(opaqueIdSchema, lineId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/default-line-leader')
  async leader(
    @Param('lineId') lineId: string,
    @ValidatedBody(assignmentMutationRequestSchema)
    body: { memberId: string; expectedAssignmentVersion?: number },
    @Req() request: ContextRequest,
  ) {
    return this.assignments.assign(
      await this.access.assertWritable(principal(request)),
      'leader',
      parseWithSchema(opaqueIdSchema, lineId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/jobs/:jobId/default-mp')
  async mp(
    @Param('jobId') jobId: string,
    @ValidatedBody(assignmentMutationRequestSchema)
    body: { memberId: string; expectedAssignmentVersion?: number },
    @Req() request: ContextRequest,
  ) {
    return this.assignments.assign(
      await this.access.assertWritable(principal(request)),
      'mp',
      parseWithSchema(opaqueIdSchema, jobId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/lines/:lineId/default-line-leader/move')
  async moveLeader(
    @Param('lineId') lineId: string,
    @ValidatedBody(assignmentMoveRequestSchema)
    body: {
      memberId: string;
      fromResourceId: string;
      expectedSourceVersion: number;
      expectedTargetVersion?: number;
    },
    @Req() request: ContextRequest,
  ) {
    return this.assignments.move(
      await this.access.assertWritable(principal(request)),
      'leader',
      parseWithSchema(opaqueIdSchema, lineId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/jobs/:jobId/default-mp/move')
  async moveMp(
    @Param('jobId') jobId: string,
    @ValidatedBody(assignmentMoveRequestSchema)
    body: {
      memberId: string;
      fromResourceId: string;
      expectedSourceVersion: number;
      expectedTargetVersion?: number;
    },
    @Req() request: ContextRequest,
  ) {
    return this.assignments.move(
      await this.access.assertWritable(principal(request)),
      'mp',
      parseWithSchema(opaqueIdSchema, jobId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_MASTER_DATA_MANAGE')
  @Post('/:kind/:resourceId/remove')
  async remove(
    @Param('kind') kindInput: string,
    @Param('resourceId') resourceId: string,
    @ValidatedBody(assignmentRemoveRequestSchema) body: { expectedAssignmentVersion: number },
    @Req() request: ContextRequest,
  ) {
    const kind =
      kindInput === 'supervisors'
        ? 'supervisor'
        : kindInput === 'line-leaders'
          ? 'leader'
          : kindInput === 'mps'
            ? 'mp'
            : null;
    if (!kind) throw new Error('InvalidAssignmentKind');
    return this.assignments.remove(
      await this.access.assertWritable(principal(request)),
      kind,
      parseWithSchema(opaqueIdSchema, resourceId),
      body.expectedAssignmentVersion,
      mutationContext(request),
    );
  }
}

function principal(request: ContextRequest): RequestPrincipal {
  if (!request.principal) throw new Error('PrincipalMissingAfterGuard');
  return request.principal;
}

function categoryValue(value: string): HenkatenCategory {
  return parseWithSchema(henkatenCategorySchema, value.toUpperCase());
}
