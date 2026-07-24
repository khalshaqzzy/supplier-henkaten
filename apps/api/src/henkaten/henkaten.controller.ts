import { Controller, Get, Param, Post, Req } from '@nestjs/common';

import {
  createHenkatenRequestSchema,
  decideHenkatenRequestSchema,
  henkatenListQuerySchema,
  henkatenFormOptionsQuerySchema,
  opaqueIdSchema,
  rerouteSupervisorRequestSchema,
  withdrawHenkatenRequestSchema,
  type CreateHenkatenRequest,
  type DecideHenkatenRequest,
  type HenkatenListQuery,
  type HenkatenFormOptionsQuery,
  type RerouteSupervisorRequest,
} from '@tmmin-henkaten/contracts';

import { mutationContext } from '../administration/mutation-context.js';
import { requiredIdempotencyKey } from '../common/idempotency.js';
import { RequireCapabilities } from '../common/policy.js';
import { ProblemException } from '../common/problem.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { OperationalAccessService } from '../shifts/operational-access.service.js';
import { HenkatenService } from './henkaten.service.js';
import { ApprovalService } from './approval.service.js';

@Controller('/api/v1/supplier/henkatens')
export class SupplierHenkatenController {
  constructor(
    private readonly access: OperationalAccessService,
    private readonly henkatens: HenkatenService,
    private readonly approvals: ApprovalService,
  ) {}

  @RequireCapabilities('SUPPLIER_HENKATEN_READ')
  @Get()
  list(
    @ValidatedQuery(henkatenListQuerySchema) query: HenkatenListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.henkatens.list(
      this.access.supplierScope(request),
      query,
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_SUBMIT')
  @Post()
  async create(
    @ValidatedBody(createHenkatenRequestSchema) body: CreateHenkatenRequest,
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.henkatens.create(
      await this.access.assertHostedOperational(principal),
      body,
      requiredIdempotencyKey(request),
      principal,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_SUBMIT')
  @Get('/form-options')
  formOptions(
    @ValidatedQuery(henkatenFormOptionsQuerySchema) query: HenkatenFormOptionsQuery,
    @Req() request: ContextRequest,
  ) {
    return this.henkatens.formOptions(this.access.supplierScope(request), query);
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_DECIDE')
  @Post('/:id/decisions')
  async decide(
    @Param('id') id: string,
    @ValidatedBody(decideHenkatenRequestSchema) body: DecideHenkatenRequest,
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.approvals.decide(
      await this.access.assertHostedOperational(principal),
      parseWithSchema(opaqueIdSchema, id),
      body,
      requiredIdempotencyKey(request),
      principal,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_APPROVAL_REROUTE')
  @Post('/:id/approval-routes/supervisor/reroute')
  async rerouteSupervisor(
    @Param('id') id: string,
    @ValidatedBody(rerouteSupervisorRequestSchema) body: RerouteSupervisorRequest,
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.approvals.rerouteSupervisor(
      await this.access.assertHostedOperational(principal),
      parseWithSchema(opaqueIdSchema, id),
      body,
      requiredIdempotencyKey(request),
      principal,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_READ')
  @Get('/:id')
  get(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.henkatens.get(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_READ')
  @Get('/:id/history')
  async history(@Param('id') id: string, @Req() request: ContextRequest) {
    const detail = await this.get(id, request);
    return { items: detail.history };
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_READ')
  @Get('/:id/clone-prefill')
  clonePrefill(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.henkatens.clonePrefill(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_HENKATEN_WITHDRAW')
  @Post('/:id/withdraw')
  async withdraw(
    @Param('id') id: string,
    @ValidatedBody(withdrawHenkatenRequestSchema)
    body: { expectedVersion: number; reason: string },
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.henkatens.withdraw(
      await this.access.assertHostedOperational(principal),
      parseWithSchema(opaqueIdSchema, id),
      body,
      principal,
      mutationContext(request),
    );
  }
}

@Controller('/api/v1/tmmin/suppliers/:supplierId/henkatens')
export class TmminHenkatenController {
  constructor(
    private readonly access: OperationalAccessService,
    private readonly henkatens: HenkatenService,
  ) {}

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get()
  async list(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(henkatenListQuerySchema) query: HenkatenListQuery,
    @Req() request: ContextRequest,
  ) {
    const id = parseWithSchema(opaqueIdSchema, supplierId);
    return this.henkatens.list(
      await this.access.assertTmminReadable(id, this.access.principal(request)),
      query,
    );
  }

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get('/warnings')
  async warnings(@Param('supplierId') supplierId: string, @Req() request: ContextRequest) {
    const id = parseWithSchema(opaqueIdSchema, supplierId);
    return this.henkatens.warnings(
      await this.access.assertTmminReadable(id, this.access.principal(request)),
    );
  }

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get('/warnings/:warningId')
  async warning(
    @Param('supplierId') supplierId: string,
    @Param('warningId') warningId: string,
    @Req() request: ContextRequest,
  ) {
    const id = parseWithSchema(opaqueIdSchema, supplierId);
    return this.henkatens.warning(
      await this.access.assertTmminReadable(id, this.access.principal(request)),
      parseWithSchema(opaqueIdSchema, warningId),
    );
  }

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get('/:id')
  async get(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Req() request: ContextRequest,
  ) {
    const target = parseWithSchema(opaqueIdSchema, supplierId);
    return this.henkatens.get(
      await this.access.assertTmminReadable(target, this.access.principal(request)),
      parseWithSchema(opaqueIdSchema, id),
    );
  }
}

@Controller('/api/v1/tmmin/warnings')
export class TmminWarningController {
  constructor(private readonly henkatens: HenkatenService) {}

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get('/affected-parts')
  affectedParts() {
    return this.henkatens.affectedParts();
  }

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get('/affected-parts/:supplierId/:partNumber')
  affectedPart(@Param('supplierId') supplierId: string, @Param('partNumber') partNumber: string) {
    const parsedSupplier = parseWithSchema(opaqueIdSchema, supplierId);
    if (!partNumber.trim() || partNumber.length > 100) {
      throw new ProblemException({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Invalid part number',
        detail: 'Part number must contain 1–100 characters.',
      });
    }
    return this.henkatens.affectedPart(parsedSupplier, partNumber);
  }
}
