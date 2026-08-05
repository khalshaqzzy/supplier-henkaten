import 'reflect-metadata';

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { correlationMiddleware } from './common/request-context.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ENOENT')) throw error;
  }
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  const httpServer: unknown = app.getHttpAdapter().getInstance();
  if (!isExpressSettings(httpServer)) throw new Error('Express adapter settings are unavailable.');
  httpServer.set('query parser', 'simple');
  httpServer.set('trust proxy', config.trustProxyHops);
  app.use(correlationMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb', type: 'application/json' }));
  app.enableCors({
    credentials: true,
    origin: [...config.corsAllowedOrigins],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-ID',
      'X-CSRF-Token',
      'X-Device-Installation-ID',
    ],
    exposedHeaders: ['X-Correlation-ID', 'Retry-After'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.listen(config.port, config.host);
}

function isExpressSettings(value: unknown): value is {
  set(name: string, setting: unknown): unknown;
} {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'set' in value &&
    typeof value.set === 'function'
  );
}

void bootstrap();
