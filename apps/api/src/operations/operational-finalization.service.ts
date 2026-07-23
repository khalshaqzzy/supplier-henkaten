import { Injectable } from '@nestjs/common';

import type { HenkatenStatus, Prisma, UserRole } from '../generated/prisma/client.js';
import { OutboxService } from '../persistence/outbox.service.js';

type FinalizationActor = {
  userId: string;
  role: UserRole;
  name: string;
  correlationId: string;
};

@Injectable()
export class OperationalFinalizationService {
  constructor(private readonly outbox: OutboxService) {}

  async closeTerminalEffects(
    tx: Prisma.TransactionClient,
    input: {
      supplierId: string;
      henkatenId: string;
      henkatenVersion: number;
      toStatus: Exclude<HenkatenStatus, 'OPEN'>;
      reason: string;
      actor: FinalizationActor;
      markPendingRoutesNotRequired: boolean;
      releaseReservation: boolean;
    },
  ): Promise<{ releasedReservations: number; closedWarnings: number; routesNotRequired: number }> {
    const now = new Date();
    const routes = input.markPendingRoutesNotRequired
      ? await tx.henkatenApprovalRoute.updateMany({
          where: {
            supplierId: input.supplierId,
            henkatenId: input.henkatenId,
            status: 'PENDING',
          },
          data: { status: 'NOT_REQUIRED', version: { increment: 1 } },
        })
      : { count: 0 };
    const reservations = input.releaseReservation
      ? await tx.mPReservation.updateMany({
          where: {
            supplierId: input.supplierId,
            henkatenId: input.henkatenId,
            releasedAt: null,
          },
          data: {
            releasedAt: now,
            releaseReason: input.reason,
            version: { increment: 1 },
          },
        })
      : { count: 0 };
    const warnings = await tx.warningInstance.updateMany({
      where: {
        supplierId: input.supplierId,
        henkatenId: input.henkatenId,
        status: 'OPEN',
      },
      data: {
        status: 'CLOSED',
        closedAt: now,
        closeReason: input.reason,
        version: { increment: 1 },
      },
    });
    await tx.henkatenTransition.create({
      data: {
        supplierId: input.supplierId,
        henkatenId: input.henkatenId,
        fromStatus: 'OPEN',
        toStatus: input.toStatus,
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        actorName: input.actor.name,
        reason: input.reason,
        correlationId: input.actor.correlationId,
      },
    });
    const terminalEvent =
      input.toStatus === 'APPROVED'
        ? 'HENKATEN_APPROVED'
        : input.toStatus === 'REJECTED'
          ? 'HENKATEN_REJECTED'
          : 'HENKATEN_CANCELLED';
    await this.outbox.enqueue(event(terminalEvent, input, { reason: input.reason }), tx);
    if (warnings.count) {
      await this.outbox.enqueue(event('WARNING_CLOSED', input, { reason: input.reason }), tx);
    }
    if (reservations.count) {
      await this.outbox.enqueue(
        event('MP_RESERVATION_RELEASED', input, { reason: input.reason }),
        tx,
      );
    }
    return {
      releasedReservations: reservations.count,
      closedWarnings: warnings.count,
      routesNotRequired: routes.count,
    };
  }
}

function event(
  eventType: string,
  input: {
    supplierId: string;
    henkatenId: string;
    henkatenVersion: number;
    actor: FinalizationActor;
  },
  payload: Record<string, unknown>,
) {
  return {
    eventType,
    aggregateType: 'Henkaten',
    aggregateId: input.henkatenId,
    aggregateVersion: input.henkatenVersion,
    supplierId: input.supplierId,
    actor: { userId: input.actor.userId, role: input.actor.role },
    correlationId: input.actor.correlationId,
    payload,
  };
}
