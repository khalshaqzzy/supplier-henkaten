import { Injectable } from '@nestjs/common';
import { from, map, Observable, switchMap, timer } from 'rxjs';

import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { PrismaService } from '../persistence/prisma.service.js';

type StreamMessage = {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  retry?: number;
};

@Injectable()
export class RealtimeService {
  constructor(private readonly prisma: PrismaService) {}

  stream(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
  ): Observable<StreamMessage> {
    let cursor = lastEventId;
    return timer(0, 15_000).pipe(
      switchMap(() => from(this.next(scope, principal, lineId, cursor))),
      map((event) => {
        if (!event) {
          return {
            type: 'heartbeat',
            retry: 3_000,
            data: { at: new Date().toISOString() },
          };
        }
        cursor = event.id;
        return {
          id: event.id,
          type: 'invalidate',
          retry: 3_000,
          data: {
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            aggregateVersion: event.aggregateVersion,
            occurredAt: event.occurredAt.toISOString(),
            refresh: ['assignment-board', 'notifications', 'dashboard'],
          },
        };
      }),
    );
  }

  private async next(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
  ) {
    const cursor = lastEventId
      ? await this.prisma.outboxEvent.findFirst({
          where: { id: lastEventId, supplierId: scope.supplierId },
          select: { occurredAt: true, id: true },
        })
      : null;
    const allowedLineIds = await this.allowedLines(scope, principal);
    if (lineId && !allowedLineIds.includes(lineId)) return null;
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(cursor
          ? {
              OR: [
                { occurredAt: { gt: cursor.occurredAt } },
                { occurredAt: cursor.occurredAt, id: { gt: cursor.id } },
              ],
            }
          : { occurredAt: { gte: new Date(Date.now() - 30_000) } }),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    return (
      events.find((event) => {
        const payload =
          event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
            ? (event.payload as Record<string, unknown>)
            : {};
        const eventLine = typeof payload.lineId === 'string' ? payload.lineId : undefined;
        return (
          (!lineId || !eventLine || eventLine === lineId) &&
          (!eventLine || allowedLineIds.includes(eventLine))
        );
      }) ?? null
    );
  }

  private async allowedLines(scope: TenantScope, principal: RequestPrincipal): Promise<string[]> {
    if (['SUPPLIER_ADMIN', 'QC'].includes(principal.role)) {
      return (
        await this.prisma.line.findMany({
          where: { supplierId: scope.supplierId },
          select: { id: true },
        })
      ).map(({ id }) => id);
    }
    if (!principal.memberId) return [];
    const shifts = await this.prisma.shiftRun.findMany({
      where: {
        supplierId: scope.supplierId,
        ...(principal.role === 'SUPERVISOR'
          ? { supervisorMemberId: principal.memberId }
          : { lineLeaderMemberId: principal.memberId }),
      },
      distinct: ['lineId'],
      select: { lineId: true },
    });
    return shifts.map(({ lineId }) => lineId);
  }
}
