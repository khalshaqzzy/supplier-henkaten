import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { NotificationService } from './notification.service.js';
import { SupplierReadModelController, TmminReadModelController } from './read-model.controller.js';
import { ReadModelService } from './read-model.service.js';
import { RealtimeService } from './realtime.service.js';

@Module({
  imports: [OperationsModule, AdministrationModule],
  controllers: [SupplierReadModelController, TmminReadModelController],
  providers: [NotificationService, ReadModelService, RealtimeService],
  exports: [ReadModelService, NotificationService],
})
export class ReadModelModule {}
