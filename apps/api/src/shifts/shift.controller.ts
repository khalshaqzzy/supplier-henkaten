import { Controller, Get, Param, Post, Req } from '@nestjs/common';

import {
  currentShiftQuerySchema,
  emergencyStartShiftRequestSchema,
  opaqueIdSchema,
  prepareShiftRequestSchema,
  shiftListQuerySchema,
  startShiftRequestSchema,
  type EmergencyStartShiftRequest,
  type PrepareShiftRequest,
  type ShiftListQuery,
} from '@tmmin-henkaten/contracts';

import { mutationContext } from '../administration/mutation-context.js';
import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { OperationalAccessService } from './operational-access.service.js';
import { ShiftService } from './shift.service.js';

@Controller('/api/v1/supplier/shifts')
export class SupplierShiftController {
  constructor(
    private readonly access: OperationalAccessService,
    private readonly shifts: ShiftService,
  ) {}

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get()
  list(
    @ValidatedQuery(shiftListQuerySchema) query: ShiftListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.shifts.list(
      this.access.supplierScope(request),
      query,
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/current')
  current(
    @ValidatedQuery(currentShiftQuerySchema) query: { lineId?: string },
    @Req() request: ContextRequest,
  ) {
    return this.shifts.current(
      this.access.supplierScope(request),
      query.lineId,
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SELF_SERVICE')
  @Post('/preflight')
  async preflight(
    @ValidatedBody(prepareShiftRequestSchema) body: PrepareShiftRequest,
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.shifts.prepare(
      await this.access.assertHostedOperational(principal),
      body,
      principal,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/assignment-issues')
  issues(@Req() request: ContextRequest) {
    return this.shifts.issues(
      this.access.supplierScope(request),
      undefined,
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/:id')
  get(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.shifts.get(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/:id/preflight')
  getPreflight(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.get(id, request);
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/:id/working-assignments')
  async working(@Param('id') id: string, @Req() request: ContextRequest) {
    const shift = await this.get(id, request);
    return { items: shift.workingAssignments };
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/:id/assignment-issues')
  issuesForShift(@Param('id') id: string, @Req() request: ContextRequest) {
    return this.shifts.issues(
      this.access.supplierScope(request),
      parseWithSchema(opaqueIdSchema, id),
      this.access.principal(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SHIFT_READ')
  @Get('/:id/resolution-context')
  async resolutionContext(@Param('id') id: string, @Req() request: ContextRequest) {
    const parsed = parseWithSchema(opaqueIdSchema, id);
    return {
      shift: await this.shifts.get(
        this.access.supplierScope(request),
        parsed,
        this.access.principal(request),
      ),
      issues: (
        await this.shifts.issues(
          this.access.supplierScope(request),
          parsed,
          this.access.principal(request),
        )
      ).items,
      proposedManResolutionSupported: false as const,
    };
  }

  @RequireCapabilities('SUPPLIER_SHIFT_OPERATE')
  @Post('/:id/start')
  async start(
    @Param('id') id: string,
    @ValidatedBody(startShiftRequestSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.shifts.start(
      await this.access.assertHostedOperational(principal),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      principal,
      mutationContext(request),
    );
  }

  @RequireCapabilities('SUPPLIER_SHIFT_OVERRIDE')
  @Post('/:id/emergency-start')
  async emergencyStart(
    @Param('id') id: string,
    @ValidatedBody(emergencyStartShiftRequestSchema) body: EmergencyStartShiftRequest,
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    return this.shifts.emergencyStart(
      await this.access.assertHostedOperational(principal),
      parseWithSchema(opaqueIdSchema, id),
      body,
      principal,
      mutationContext(request),
    );
  }
}

@Controller('/api/v1/tmmin/suppliers/:supplierId/shifts')
export class TmminShiftController {
  constructor(
    private readonly access: OperationalAccessService,
    private readonly shifts: ShiftService,
  ) {}

  @RequireCapabilities('TMMIN_SHIFT_READ')
  @Get()
  async list(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(shiftListQuerySchema) query: ShiftListQuery,
    @Req() request: ContextRequest,
  ) {
    const id = parseWithSchema(opaqueIdSchema, supplierId);
    return this.shifts.list(
      await this.access.assertTmminReadable(id, this.access.principal(request)),
      query,
    );
  }

  @RequireCapabilities('TMMIN_SHIFT_READ')
  @Get('/:id')
  async get(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Req() request: ContextRequest,
  ) {
    const target = parseWithSchema(opaqueIdSchema, supplierId);
    return this.shifts.get(
      await this.access.assertTmminReadable(target, this.access.principal(request)),
      parseWithSchema(opaqueIdSchema, id),
    );
  }
}
