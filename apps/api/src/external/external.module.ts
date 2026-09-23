import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import {
  ExternalClientController,
  ExternalIngestionController,
  ExternalProjectionController,
  TmminExternalHealthController,
} from './external.controller.js';
import { ExternalRateLimiterService } from './external-rate-limiter.service.js';
import { PcrModule } from '../pcr/pcr.module.js';
import { ExternalService } from './external.service.js';

@Module({
  imports: [AuthModule, PcrModule],
  controllers: [
    ExternalClientController,
    ExternalProjectionController,
    ExternalIngestionController,
    TmminExternalHealthController,
  ],
  providers: [ExternalService, ExternalRateLimiterService],
  exports: [ExternalService],
})
export class ExternalModule {}
