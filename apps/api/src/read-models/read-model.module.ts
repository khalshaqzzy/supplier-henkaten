import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { NotificationService } from './notification.service.js';
import { SupplierReadModelController, TmminReadModelController } from './read-model.controller.js';
import { ReadModelService } from './read-model.service.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeEventPump } from './realtime-event-pump.js';
import { PushModule } from '../push/push.module.js';
import { BoardLayoutService } from './board-layout.service.js';

@Module({
  imports: [OperationsModule, AdministrationModule, PushModule],
  controllers: [SupplierReadModelController, TmminReadModelController],
  providers: [
    NotificationService,
    ReadModelService,
    BoardLayoutService,
    RealtimeEventPump,
    RealtimeService,
  ],
  exports: [ReadModelService, NotificationService],
})
export class ReadModelModule {}
