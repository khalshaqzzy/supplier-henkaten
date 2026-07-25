import { Injectable } from '@nestjs/common';
import {
  defer,
  filter,
  from,
  interval,
  map,
  merge,
  of,
  startWith,
  switchMap,
  type Observable,
} from 'rxjs';

import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { RealtimeEventPump, type RealtimeOutboxEvent } from './realtime-event-pump.js';

type StreamMessage = {
  id?: string;
  type: 'heartbeat' | 'invalidate' | 'resync';
  data: Record<string, unknown>;
  retry?: number;
};

const replayLimit = 500;

@Injectable()
export class RealtimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pump: RealtimeEventPump,
  ) {}

  stream(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string | undefined,
    lastEventId: string | undefined,
  ): Observable<StreamMessage> {
    return defer(() => this.allowedLines(scope, principal)).pipe(
      switchMap((allowedLineIds) => {
        const authorized = !lineId || allowedLineIds.includes(lineId);
        const heartbeat = interval(15_000).pipe(
          startWith(0),
          map((): StreamMessage => ({
            type: 'heartbeat',
            retry: 3_000,
            data: { at: new Date().toISOString() },
          })),
        );
        if (!authorized) return heartbeat;

        const replay = from(this.replay(scope.supplierId, lastEventId)).pipe(
          switchMap((result) =>
            result.resync
              ? of<StreamMessage>({
                  type: 'resync',
                  retry: 3_000,
                  data: { reason: 'CURSOR_UNAVAILABLE', at: new Date().toISOString() },
                })
              : from(result.events).pipe(map((event) => this.invalidation(event))),
          ),
        );
        const live = this.pump.events().pipe(
          filter((event) => event.supplierId === scope.supplierId),
          map((event) => this.invalidation(event)),
        );
        const seen = new Set<string>();
        const seenOrder: string[] = [];

        return merge(heartbeat, replay, live).pipe(
          filter((message) => this.inScope(message, lineId, allowedLineIds)),
          filter((message) => {
            if (!message.id) return true;
            if (seen.has(message.id)) return false;
            seen.add(message.id);
            seenOrder.push(message.id);
            if (seenOrder.length > replayLimit) {
              const expired = seenOrder.shift();
              if (expired) seen.delete(expired);
            }
            return true;
          }),
        );
      }),
    );
  }

  private async replay(
    supplierId: string,
    lastEventId: string | undefined,
  ): Promise<{ events: RealtimeOutboxEvent[]; resync: boolean }> {
    let cursor: { occurredAt: Date; id: string } | null = null;
    if (lastEventId) {
      cursor = await this.prisma.outboxEvent.findFirst({
        where: { id: lastEventId, supplierId },
        select: { occurredAt: true, id: true },
      });
      if (!cursor) return { events: [], resync: true };
    }
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        supplierId,
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
      take: replayLimit + 1,
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        aggregateVersion: true,
        supplierId: true,
        occurredAt: true,
        payload: true,
      },
    });
    if (events.length > replayLimit) return { events: [], resync: true };
    return { events, resync: false };
  }

  private invalidation(event: RealtimeOutboxEvent): StreamMessage {
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
        lineId: this.eventLineId(event),
      },
    };
  }

  private inScope(
    message: StreamMessage,
    requestedLineId: string | undefined,
    allowedLineIds: readonly string[],
  ): boolean {
    if (message.type !== 'invalidate') return true;
    const eventLineId = typeof message.data.lineId === 'string' ? message.data.lineId : undefined;
    return (
      (!requestedLineId || !eventLineId || eventLineId === requestedLineId) &&
      (!eventLineId || allowedLineIds.includes(eventLineId))
    );
  }

  private eventLineId(event: RealtimeOutboxEvent): string | undefined {
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
      return undefined;
    }
    const lineId = (event.payload as Record<string, unknown>).lineId;
    return typeof lineId === 'string' ? lineId : undefined;
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
