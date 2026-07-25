import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { NotificationListQuery, NotificationReadRequest } from '@tmmin-henkaten/contracts';

import { decodeCursor, encodeCursor } from '../administration/presenters.js';
import { versionConflict } from '../administration/user-admin.service.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { missing } from '../master-data/member.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import type { ClaimedOutboxEvent } from '../persistence/outbox.service.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';

const NOTIFICATION_EVENTS = [
  'HENKATEN_OPENED',
  'HENKATEN_APPROVED',
  'HENKATEN_REJECTED',
  'HENKATEN_CANCELLED',
  'ASSIGNMENT_ISSUE_OPENED',
  'NOTIFICATION_REQUESTED',
  'SHIFT_STARTED_WITH_OVERRIDE',
  'EXTERNAL_PROJECTION_UPDATED',
  'EXTERNAL_INGEST_REJECTED',
] as const;

@Injectable()
export class NotificationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditWriter,
  ) {}

  onModuleInit(): void {
    for (const eventType of NOTIFICATION_EVENTS) {
      this.outbox.register(eventType, (event) => this.consume(event));
    }
  }

  async list(principal: RequestPrincipal, query: NotificationListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientUserId: principal.userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return {
      items: items.map(presentNotification),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)!.id) : null,
      },
    };
  }

  async unreadCount(principal: RequestPrincipal) {
    return {
      count: await this.prisma.notification.count({
        where: { recipientUserId: principal.userId, readAt: null },
      }),
    };
  }

  async setRead(
    principal: RequestPrincipal,
    id: string,
    input: NotificationReadRequest,
    correlationId: string,
  ) {
    const current = await this.prisma.notification.findFirst({
      where: { id, recipientUserId: principal.userId },
    });
    if (!current) throw missing('Notification');
    if (current.version !== input.expectedVersion) throw versionConflict();
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: input.read ? new Date() : null, version: { increment: 1 } },
    });
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: principal.userId,
      actorRole: principal.role,
      ...(principal.supplierId
        ? { actorSupplierId: principal.supplierId, supplierId: principal.supplierId }
        : {}),
      action: input.read ? 'NOTIFICATION_READ' : 'NOTIFICATION_UNREAD',
      resourceType: 'Notification',
      resourceId: id,
      correlationId,
    });
    return { ...presentNotification(updated), version: updated.version };
  }

  async consume(event: ClaimedOutboxEvent): Promise<void> {
    if (!event.supplierId) return;
    const template = this.template(event);
    if (!template) return;
    const recipients = await this.recipients(event);
    if (!recipients.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const recipientUserId of recipients) {
        await tx.notification.upsert({
          where: {
            sourceEventId_recipientUserId: {
              sourceEventId: event.id,
              recipientUserId,
            },
          },
          create: {
            supplierId: event.supplierId!,
            recipientUserId,
            sourceEventId: event.id,
            ...template,
          },
          update: {},
        });
      }
      await this.audit.write(
        {
          actorKind: 'SYSTEM',
          supplierId: event.supplierId!,
          action: 'NOTIFICATION_GENERATED',
          resourceType: event.aggregateType,
          resourceId: event.aggregateId,
          changeSummary: { sourceEventId: event.id, recipientCount: recipients.length },
          correlationId: event.correlationId,
        },
        tx,
      );
    });
  }

  private async recipients(event: ClaimedOutboxEvent): Promise<string[]> {
    const supplierId = event.supplierId!;
    if (event.eventType === 'EXTERNAL_PROJECTION_UPDATED') {
      const users = await this.prisma.user.findMany({
        where: {
          realm: 'TMMIN',
          role: { in: ['TMMIN_ADMIN', 'TMMIN_QUALITY'] },
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      return users.map(({ id }) => id);
    }
    if (event.eventType === 'EXTERNAL_INGEST_REJECTED') {
      const users = await this.prisma.user.findMany({
        where: { realm: 'TMMIN', role: 'TMMIN_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      return users.map(({ id }) => id);
    }
    const common = { supplierId, status: 'ACTIVE' as const };
    if (event.aggregateType === 'Henkaten') {
      const henkaten = await this.prisma.henkaten.findFirst({
        where: { id: event.aggregateId, supplierId },
        select: {
          createdById: true,
          approvalRoutes: { select: { route: true, currentResponsibleMemberId: true } },
        },
      });
      if (!henkaten) return [];
      if (event.eventType === 'HENKATEN_OPENED') {
        const supervisor = henkaten.approvalRoutes.find(({ route }) => route === 'SUPERVISOR');
        const users = await this.prisma.user.findMany({
          where: {
            ...common,
            OR: [
              { role: 'QC' },
              ...(supervisor?.currentResponsibleMemberId
                ? [{ memberId: supervisor.currentResponsibleMemberId }]
                : []),
            ],
          },
          select: { id: true },
        });
        return users.map(({ id }) => id);
      }
      const users = await this.prisma.user.findMany({
        where: {
          ...common,
          OR: [{ id: henkaten.createdById }, { role: 'SUPPLIER_ADMIN' }],
        },
        select: { id: true },
      });
      return users.map(({ id }) => id);
    }
    const payload = asRecord(event.payload);
    const lineId = typeof payload.lineId === 'string' ? payload.lineId : undefined;
    const users = await this.prisma.user.findMany({
      where: {
        ...common,
        OR: [
          { role: 'SUPPLIER_ADMIN' },
          ...(lineId
            ? [
                {
                  member: {
                    OR: [
                      { supervisedShiftRuns: { some: { lineId } } },
                      { ledShiftRuns: { some: { lineId } } },
                    ],
                  },
                },
              ]
            : []),
        ],
      },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }

  private template(event: ClaimedOutboxEvent) {
    const link = (path: string) => ({
      resourceType: event.aggregateType,
      resourceId: event.aggregateId,
      deepLink: path,
    });
    switch (event.eventType) {
      case 'HENKATEN_OPENED':
        return {
          kind: 'APPROVAL_PENDING',
          title: 'Henkaten requires approval',
          body: 'A new Henkaten is waiting for Supervisor and QC decisions.',
          ...link(`/henkatens/${event.aggregateId}`),
        };
      case 'HENKATEN_APPROVED':
        return {
          kind: 'HENKATEN_APPROVED',
          title: 'Henkaten approved',
          body: 'Both approval routes have approved the Henkaten.',
          ...link(`/henkatens/${event.aggregateId}`),
        };
      case 'HENKATEN_REJECTED':
        return {
          kind: 'HENKATEN_REJECTED',
          title: 'Henkaten rejected',
          body: 'An approval route rejected the Henkaten.',
          ...link(`/henkatens/${event.aggregateId}`),
        };
      case 'HENKATEN_CANCELLED':
        return {
          kind: 'HENKATEN_CANCELLED',
          title: 'Henkaten cancelled',
          body: 'The Henkaten was cancelled or withdrawn.',
          ...link(`/henkatens/${event.aggregateId}`),
        };
      case 'SHIFT_STARTED_WITH_OVERRIDE':
        return {
          kind: 'SHIFT_OVERRIDE',
          title: 'Shift started with override',
          body: 'A Supplier Admin started a shift despite preflight blockers.',
          ...link(`/shifts/${event.aggregateId}`),
        };
      case 'ASSIGNMENT_ISSUE_OPENED':
      case 'NOTIFICATION_REQUESTED':
        return {
          kind: 'ASSIGNMENT_VACANCY',
          title: 'Assignment requires resolution',
          body: 'A job is vacant or conflicted and requires assignment action.',
          ...link('/assignment-board'),
        };
      case 'EXTERNAL_PROJECTION_UPDATED': {
        const payload = asRecord(event.payload);
        const status = typeof payload.status === 'string' ? payload.status : 'UNKNOWN';
        const opened = status === 'OPEN';
        return {
          kind: 'EXTERNAL_WARNING',
          title: opened ? 'External Henkaten warning opened' : 'External Henkaten warning updated',
          body: opened
            ? 'An External supplier reported an open Henkaten warning.'
            : `An External Henkaten warning moved to ${status.toLowerCase()}.`,
          ...link(`/suppliers/${event.supplierId}/external/${event.aggregateId}`),
        };
      }
      case 'EXTERNAL_INGEST_REJECTED': {
        const payload = asRecord(event.payload);
        const safeCode = typeof payload.safeCode === 'string' ? payload.safeCode : 'REJECTED';
        return {
          kind: 'EXTERNAL_INGESTION_ERROR',
          title: 'External ingestion rejected',
          body: `An External ingestion attempt was rejected (${safeCode}).`,
          ...link(`/external-health?supplierId=${event.supplierId}`),
        };
      }
      default:
        return null;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function presentNotification(row: {
  id: string;
  supplierId: string;
  kind: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  deepLink: string | null;
  createdAt: Date;
  readAt: Date | null;
  version: number;
}) {
  return {
    id: row.id,
    supplierId: row.supplierId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    deepLink: row.deepLink,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    version: row.version,
  };
}
