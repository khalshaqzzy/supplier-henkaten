import { Controller, Get, Param, Patch, Req, Sse } from '@nestjs/common';

import {
  auditQuerySchema,
  boardQuerySchema,
  dashboardQuerySchema,
  notificationListQuerySchema,
  notificationReadRequestSchema,
  opaqueIdSchema,
  realtimeQuerySchema,
  tmminDashboardQuerySchema,
  type AuditQuery,
  type BoardQuery,
  type DashboardQuery,
  type NotificationListQuery,
  type NotificationReadRequest,
  type RealtimeQuery,
  type TmminDashboardQuery,
} from '@tmmin-henkaten/contracts';

import { RequireCapabilities } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { OperationalAccessService } from '../shifts/operational-access.service.js';
import { HostedReadinessService } from '../administration/hosted-readiness.service.js';
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
    private readonly hostedReadiness: HostedReadinessService,
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

  @RequireCapabilities('SUPPLIER_MASTER_DATA_READ')
  @Get('/setup-readiness')
  setupReadiness(@Req() request: ContextRequest) {
    const scope = this.access.supplierScope(request);
    return this.hostedReadiness.evaluate(scope.supplierId);
  }

  @RequireCapabilities('SUPPLIER_AUDIT_READ')
  @Get('/audit')
  audit(@ValidatedQuery(auditQuerySchema) query: AuditQuery, @Req() request: ContextRequest) {
    return this.reads.supplierAudit(
      this.access.supplierScope(request),
      this.access.principal(request),
      query,
    );
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
  constructor(
    private readonly access: OperationalAccessService,
    private readonly notifications: NotificationService,
    private readonly reads: ReadModelService,
  ) {}

  @RequireCapabilities('TMMIN_DASHBOARD_READ')
  @Get('/notifications')
  listNotifications(
    @ValidatedQuery(notificationListQuerySchema) query: NotificationListQuery,
    @Req() request: ContextRequest,
  ) {
    return this.notifications.list(this.access.principal(request), query);
  }

  @RequireCapabilities('TMMIN_DASHBOARD_READ')
  @Get('/notifications/unread-count')
  unreadCount(@Req() request: ContextRequest) {
    return this.notifications.unreadCount(this.access.principal(request));
  }

  @RequireCapabilities('TMMIN_DASHBOARD_READ')
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

  @RequireCapabilities('TMMIN_DASHBOARD_READ')
  @Get('/dashboard')
  dashboard(@ValidatedQuery(tmminDashboardQuerySchema) query: TmminDashboardQuery) {
    return this.reads.tmminDashboard(query);
  }

  @RequireCapabilities('TMMIN_SHIFT_READ')
  @Get('/suppliers/:supplierId/assignment-board')
  async assignmentBoard(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(boardQuerySchema) query: BoardQuery,
    @Req() request: ContextRequest,
  ) {
    const principal = this.access.principal(request);
    const scope = await this.access.assertTmminHostedCurrent(
      parseWithSchema(opaqueIdSchema, supplierId),
      principal,
    );
    return this.reads.board(scope, principal, query.lineId);
  }

  @RequireCapabilities('TMMIN_AUDIT_READ')
  @Get('/audit')
  audit(@ValidatedQuery(auditQuerySchema) query: AuditQuery, @Req() request: ContextRequest) {
    return this.reads.tmminAudit(this.access.principal(request), query, request.correlationId!);
  }
}
