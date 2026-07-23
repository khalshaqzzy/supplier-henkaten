import { Controller, Get, Param, Patch, Req, Sse } from '@nestjs/common';

import {
  auditQuerySchema,
  boardQuerySchema,
  dashboardQuerySchema,
  notificationListQuerySchema,
  notificationReadRequestSchema,
  opaqueIdSchema,
  realtimeQuerySchema,
  type AuditQuery,
  type BoardQuery,
  type DashboardQuery,
  type NotificationListQuery,
  type NotificationReadRequest,
  type RealtimeQuery,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { OperationalAccessService } from '../shifts/operational-access.service.js';
import { NotificationService } from './notification.service.js';
import { ReadModelService } from './read-model.service.js';
import { RealtimeService } from './realtime.service.js';

@Controller('/api/v1/supplier')
export class SupplierReadModelController {
  constructor(
    private readonly access: OperationalAccessService,
    private readonly notifications: NotificationService,
    private readonly reads: ReadModelService,
    private readonly realtime: RealtimeService,
  ) {}

  @RequireCapabilities('SUPPLIER_NOTIFICATION_READ')
  @Get('/notifications')
  listNotifications(
    @ValidatedQuery(notificationListQuerySchema) query: NotificationListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.notifications.list(this.access.principal(request), query);
  }

  @RequireCapabilities('SUPPLIER_NOTIFICATION_READ')
  @Get('/notifications/unread-count')
  unreadCount(@Req() request: ContextRequest) {
    return this.notifications.unreadCount(this.access.principal(request));
  }

  @RequireCapabilities('SUPPLIER_NOTIFICATION_READ')
  @Patch('/notifications/:id/read-state')
  setRead(
    @Param('id') id: string,
    @ValidatedBody(notificationReadRequestSchema) body: NotificationReadRequest,
    @Req() request: ContextRequest,
  ) {
    return this.notifications.setRead(
      this.access.principal(request),
      parseWithSchema(opaqueIdSchema, id),
      body,
      request.correlationId!,
    );
  }

  @RequireCapabilities('SUPPLIER_BOARD_READ')
  @Get('/assignment-board')
  board(@ValidatedQuery(boardQuerySchema) query: BoardQuery, @Req() request: ContextRequest) {
    return this.reads.board(
      this.access.supplierScope(request),
      this.access.principal(request),
      query.lineId,
    );
  }

  @RequireCapabilities('SUPPLIER_DASHBOARD_READ')
  @Get('/dashboard')
  dashboard(
    @ValidatedQuery(dashboardQuerySchema) query: DashboardQuery,
    @Req() request: ContextRequest,
  ) {
    return this.reads.supplierDashboard(
      this.access.supplierScope(request),
      this.access.principal(request),
      query,
    );
  }

  @RequireCapabilities('SUPPLIER_AUDIT_READ')
  @Get('/audit')
  audit(@ValidatedQuery(auditQuerySchema) query: AuditQuery, @Req() request: ContextRequest) {
    return this.reads.supplierAudit(this.access.supplierScope(request), query);
  }

  @RequireCapabilities('SUPPLIER_BOARD_READ')
  @Sse('/realtime')
  realtimeEvents(
    @ValidatedQuery(realtimeQuerySchema) query: RealtimeQuery,
    @Req() request: ContextRequest,
  ) {
    return this.realtime.stream(
      this.access.supplierScope(request),
      this.access.principal(request),
      query.lineId,
      request.header('Last-Event-ID'),
    );
  }
}

@Controller('/api/v1/tmmin')
export class TmminReadModelController {
  constructor(private readonly reads: ReadModelService) {}

  @RequireCapabilities('TMMIN_DASHBOARD_READ')
  @Get('/dashboard')
  dashboard() {
    return this.reads.tmminDashboard();
  }

  @RequireCapabilities('TMMIN_AUDIT_READ')
  @Get('/audit')
  audit(@ValidatedQuery(auditQuerySchema) query: AuditQuery) {
    return this.reads.tmminAudit(query);
  }
}
