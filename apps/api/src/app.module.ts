import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AdministrationModule } from './administration/administration.module.js';
import { CsrfGuard, GlobalRateLimitGuard, SessionAuthenticationGuard } from './auth/auth.guards.js';
import { AuthModule } from './auth/auth.module.js';
import { ProblemExceptionFilter } from './common/problem.js';
import { RoutePolicyGuard } from './common/policy.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { RuntimeConfigModule } from './config/runtime-config.module.js';
import { HealthController } from './health/health.controller.js';
import { HenkatenModule } from './henkaten/henkaten.module.js';
import { OpenApiController } from './openapi/openapi.controller.js';
import { PersistenceModule } from './persistence/persistence.module.js';
import { MasterDataModule } from './master-data/master-data.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { ShiftsModule } from './shifts/shifts.module.js';
import { ReadModelModule } from './read-models/read-model.module.js';
import { ExternalModule } from './external/external.module.js';

@Module({
  imports: [
    RuntimeConfigModule,
    LoggerModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          ...(config.logPretty
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { colorize: true, singleLine: true },
                },
              }
            : {}),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body',
              'req.query',
              '*.password',
              '*.token',
              '*.secret',
              '*.passwordHash',
              '*.tokenHash',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (request: { method?: string; route?: { path?: string } }) => ({
              method: request.method,
              route: request.route?.path,
            }),
            res: (response: { statusCode?: number }) => ({
              statusCode: response.statusCode,
            }),
          },
        },
      }),
    }),
    PersistenceModule,
    AuthModule,
    AdministrationModule,
    MasterDataModule,
    OperationsModule,
    ShiftsModule,
    HenkatenModule,
    ReadModelModule,
    ExternalModule,
  ],
  controllers: [HealthController, OpenApiController],
  providers: [
    { provide: APP_GUARD, useExisting: GlobalRateLimitGuard },
    { provide: APP_GUARD, useExisting: SessionAuthenticationGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useClass: RoutePolicyGuard },
    { provide: APP_FILTER, useClass: ProblemExceptionFilter },
  ],
})
export class AppModule {}
