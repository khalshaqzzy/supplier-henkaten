import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      connectionTimeoutMillis: config.dbConnectionTimeoutMs,
      idleTimeoutMillis: config.dbIdleTimeoutMs,
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
