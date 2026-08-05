import { Module } from '@nestjs/common';

import { PushController } from './push.controller.js';
import { PushDeliveryService } from './push-delivery.service.js';
import { PushDeliveryWorker } from './push-delivery.worker.js';
import { StandardsWebPushGateway, WEB_PUSH_GATEWAY } from './push.gateway.js';
import { PushSubscriptionService } from './push.service.js';

@Module({
  controllers: [PushController],
  providers: [
    PushSubscriptionService,
    PushDeliveryService,
    PushDeliveryWorker,
    StandardsWebPushGateway,
    { provide: WEB_PUSH_GATEWAY, useExisting: StandardsWebPushGateway },
  ],
  exports: [PushSubscriptionService, PushDeliveryService],
})
export class PushModule {}
