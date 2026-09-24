import { Controller, Get, Param, Req } from '@nestjs/common';

import {
  opaqueIdSchema,
  shiftListQuerySchema,
  type ShiftListQuery,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedQuery } from '../common/zod.js';
import { OperationalAccessService } from './operational-access.service.js';
import { ShiftService } from './shift.service.js';

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
