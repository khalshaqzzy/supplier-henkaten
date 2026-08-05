import { Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';

import {
  createPushSubscriptionRequestSchema,
  deletePushSubscriptionRequestSchema,
  opaqueIdSchema,
  type CreatePushSubscriptionRequest,
  type DeletePushSubscriptionRequest,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody } from '../common/zod.js';
import { PushSubscriptionService } from './push.service.js';

@Controller('/api/v1/supplier')
export class PushController {
  constructor(private readonly push: PushSubscriptionService) {}

  @RequireCapabilities('SUPPLIER_SELF_SERVICE')
  @Get('/push/config')
  config(@Req() request: ContextRequest) {
    return this.push.configFor(request.principal!, this.push.installationId(request));
  }

  @RequireCapabilities('SUPPLIER_SELF_SERVICE')
  @Post('/push-subscriptions')
  subscribe(
    @ValidatedBody(createPushSubscriptionRequestSchema) body: CreatePushSubscriptionRequest,
    @Req() request: ContextRequest,
  ) {
    return this.push.subscribe(
      request.principal!,
      this.push.installationId(request),
      body,
      request.correlationId!,
    );
  }

  @RequireCapabilities('SUPPLIER_SELF_SERVICE')
  @Delete('/push-subscriptions/:id')
  revoke(
    @Param('id') id: string,
    @ValidatedBody(deletePushSubscriptionRequestSchema) body: DeletePushSubscriptionRequest,
    @Req() request: ContextRequest,
  ) {
    return this.push.revoke(
      request.principal!,
      parseWithSchema(opaqueIdSchema, id),
      body,
      request.correlationId!,
    );
  }
}
