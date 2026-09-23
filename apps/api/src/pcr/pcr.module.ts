import { Module } from '@nestjs/common';

import { PcrController } from './pcr.controller.js';
import { PcrService } from './pcr.service.js';

@Module({ controllers: [PcrController], providers: [PcrService], exports: [PcrService] })
export class PcrModule {}
