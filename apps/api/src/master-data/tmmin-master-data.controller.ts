import { createReadStream } from 'node:fs';

import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import {
  henkatenCategorySchema,
  masterListQuerySchema,
  opaqueIdSchema,
  type HenkatenCategory,
  type MasterListQuery,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import { ProblemException } from '../common/problem.js';
import type { ContextRequest, RequestPrincipal } from '../common/request-context.js';
import { parseWithSchema, ValidatedQuery } from '../common/zod.js';
import { mutationContext } from '../administration/mutation-context.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { AssignmentService } from './assignment.service.js';
import { CatalogService } from './catalog.service.js';
import { ChecklistService } from './checklist.service.js';
import { MasterDataAccessService } from './master-data-access.service.js';
import { masterAudit } from './master-data-audit.js';
import { MemberService } from './member.service.js';
import { PhotoService } from './photo.service.js';

@Controller('/api/v1/tmmin/suppliers/:supplierId/master-data')
export class TmminMasterDataController {
  constructor(
    private readonly access: MasterDataAccessService,
    private readonly members: MemberService,
    private readonly catalog: CatalogService,
    private readonly checklists: ChecklistService,
    private readonly assignments: AssignmentService,
    private readonly photos: PhotoService,
    private readonly audit: AuditWriter,
  ) {}

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/members')
  async memberList(
    @Param('supplierId') supplierIdInput: string,
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierIdInput, request, 'MEMBER_LIST_VIEWED');
    return this.members.list(
      scope,
      query,
      false,
      `/api/v1/tmmin/suppliers/${scope.supplierId}/master-data/members`,
    );
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/members/:id')
  async member(
    @Param('supplierId') supplierIdInput: string,
    @Param('id') id: string,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierIdInput, request, 'MEMBER_VIEWED', id);
    return this.members.get(
      scope,
      parseWithSchema(opaqueIdSchema, id),
      false,
      `/api/v1/tmmin/suppliers/${scope.supplierId}/master-data/members`,
    );
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/members/:id/photo/:variant')
  async photo(
    @Param('supplierId') supplierIdInput: string,
    @Param('id') id: string,
    @Param('variant') variantInput: string,
    @Req() request: ContextRequest,
    @Res() response: Response,
  ) {
    const scope = await this.scope(supplierIdInput, request, 'MEMBER_PHOTO_VIEWED', id);
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
    const asset = await this.photos.asset(scope, parseWithSchema(opaqueIdSchema, id), variant);
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('ETag', `"${asset.checksum}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(asset.path).pipe(response);
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/lines')
  async lines(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierId, request, 'LINE_LIST_VIEWED');
    return this.catalog.listLines(scope, query);
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/lines/:lineId/jobs')
  async jobs(
    @Param('supplierId') supplierId: string,
    @Param('lineId') lineId: string,
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierId, request, 'JOB_LIST_VIEWED', lineId);
    return this.catalog.listJobs(scope, parseWithSchema(opaqueIdSchema, lineId), query);
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/parts')
  async parts(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierId, request, 'PART_LIST_VIEWED');
    return this.catalog.listParts(scope, query);
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/shift-templates')
  async shifts(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(masterListQuerySchema) query: MasterListQuery,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierId, request, 'SHIFT_TEMPLATE_LIST_VIEWED');
    return this.catalog.listShiftTemplates(scope, query);
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/checklists/:category/versions')
  async versions(
    @Param('supplierId') supplierId: string,
    @Param('category') category: string,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierId, request, 'CHECKLIST_VERSIONS_VIEWED');
    return this.checklists.versions(scope, categoryValue(category));
  }

  @RequireCapabilities('TMMIN_MASTER_DATA_READ')
  @Get('/default-assignments')
  async defaultAssignments(
    @Param('supplierId') supplierId: string,
    @Req() request: ContextRequest,
  ) {
    const scope = await this.scope(supplierId, request, 'DEFAULT_ASSIGNMENTS_VIEWED');
    return this.assignments.get(scope);
  }

  private async scope(
    supplierIdInput: string,
    request: ContextRequest,
    action: string,
    resourceId?: string,
  ) {
    const supplierId = parseWithSchema(opaqueIdSchema, supplierIdInput);
    const scope = await this.access.assertTmminReadable(supplierId, principal(request));
    await this.audit.write(
      masterAudit(
        mutationContext(request),
        supplierId,
        `TMMIN_${action}`,
        'MasterData',
        resourceId && opaqueIdSchema.safeParse(resourceId).success ? resourceId : undefined,
      ),
    );
    return scope;
  }
}

function principal(request: ContextRequest): RequestPrincipal {
  if (!request.principal) throw new Error('PrincipalMissingAfterGuard');
  return request.principal;
}

function categoryValue(value: string): HenkatenCategory {
  return parseWithSchema(henkatenCategorySchema, value.toUpperCase());
}
