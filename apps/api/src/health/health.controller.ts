import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../common/policy.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { PhotoService } from '../master-data/photo.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('/health')
  health() {
    return {
      status: 'ok' as const,
      service: 'supplier-henkaten-api',
      releaseSha: this.config.releaseSha,
      checkedAt: new Date().toISOString(),
    };
  }

  @Public()
  @Get('/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.photos.ensureReady();
      const [foundation] = await this.prisma.$queryRaw<
        Array<{ tables: bigint; trigger_count: bigint; unfinished_migrations: bigint }>
      >`
        SELECT
          (SELECT count(*) FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN (
                'Supplier', 'User', 'UserSession', 'AuditEvent', 'OutboxEvent',
                'Member', 'Line', 'Job', 'Part', 'ShiftTemplate', 'ChecklistTemplate',
                'Notification', 'ExternalApiClient', 'ExternalApiSecret',
                'ExternalAccessToken', 'ExternalIngestionEvent', 'ExternalHenkatenProjection'
              )) AS tables,
          (SELECT count(*) FROM pg_trigger
            WHERE tgname IN (
              'AuditEvent_prevent_update_delete',
              'ExternalIngestionEvent_prevent_update_delete'
            )) AS trigger_count,
          (SELECT count(*) FROM "_prisma_migrations"
            WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS unfinished_migrations
      `;
      if (
        foundation === undefined ||
        Number(foundation.tables) !== 17 ||
        Number(foundation.trigger_count) !== 2 ||
        Number(foundation.unfinished_migrations) !== 0
      ) {
        throw new Error('FoundationNotReady');
      }
      return {
        status: 'ready' as const,
        service: 'supplier-henkaten-api',
        releaseSha: this.config.releaseSha,
        checkedAt: new Date().toISOString(),
        checks: [
          { name: 'database', status: 'ready' as const },
          { name: 'migrations', status: 'ready' as const },
          { name: 'photo_storage', status: 'ready' as const },
        ],
      };
    } catch {
      response.status(503);
      return {
        status: 'not_ready' as const,
        service: 'supplier-henkaten-api',
        releaseSha: this.config.releaseSha,
        checkedAt: new Date().toISOString(),
        checks: [
          { name: 'database', status: 'not_ready' as const },
          { name: 'migrations', status: 'not_ready' as const },
          { name: 'photo_storage', status: 'not_ready' as const },
        ],
      };
    }
  }
}
