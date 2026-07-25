import {
  affectedPartDetailSchema,
  affectedPartPageSchema,
  assignmentBoardSchema,
  auditPageSchema,
  createExternalClientRequestSchema,
  externalClientCredentialSchema,
  externalClientSchema,
  externalClientPageSchema,
  externalHealthSchema,
  externalProjectionDetailSchema,
  externalProjectionPageSchema,
  henkatenDetailSchema,
  henkatenPageSchema,
  hostedPreparationCredentialSchema,
  linePageSchema,
  memberPageSchema,
  notificationPageSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  partPageSchema,
  qualityUserListQuerySchema,
  readinessResponseSchema,
  sessionResponseSchema,
  shiftTemplatePageSchema,
  shiftRunDetailSchema,
  shiftRunPageSchema,
  sourceGovernanceSummarySchema,
  sourcePreflightResponseSchema,
  supplierCredentialResponseSchema,
  supplierDetailSchema,
  supplierListQuerySchema,
  supplierPageSchema,
  supplierSummarySchema,
  tmminDashboardExtendedSchema,
  tmminHenkatenPageSchema,
  tmminHenkatenQuerySchema,
  userCredentialResponseSchema,
  userPageSchema,
  userSummarySchema,
  type AuditQuery,
  type CreateExternalClientRequest,
  type CreateSupplierRequest,
  type CreateTmminQualityRequest,
  type ExternalHealthQuery,
  type NotificationListQuery,
  type QualityUserListQuery,
  type SupplierListQuery,
  type TmminDashboardQuery,
  type TmminHenkatenQuery,
  type TmminLoginRequest,
  type UpdateSupplierRequest,
} from '@tmmin-henkaten/contracts';

import { ApiClient, type QueryRecord } from './core';

export class TmminApi {
  constructor(private readonly client: ApiClient) {}

  login(body: TmminLoginRequest) {
    return this.client.request('/api/v1/auth/tmmin/login', {
      method: 'POST',
      body,
      responseSchema: sessionResponseSchema,
      authenticated: false,
    });
  }

  session() {
    return this.client.request('/api/v1/auth/tmmin/session', {
      responseSchema: sessionResponseSchema,
    });
  }

  changePassword(body: { currentPassword: string; newPassword: string }) {
    return this.client.request('/api/v1/auth/tmmin/change-password', {
      method: 'POST',
      body,
      responseType: 'void',
    });
  }

  logout() {
    return this.client.request('/api/v1/auth/tmmin/logout', {
      method: 'POST',
      responseType: 'void',
    });
  }

  readiness() {
    return this.client.request('/ready', {
      responseSchema: readinessResponseSchema,
      authenticated: false,
      acceptedStatuses: [503],
    });
  }

  dashboard(query: TmminDashboardQuery) {
    return this.client.request('/api/v1/tmmin/dashboard', {
      query: asQuery(query),
      responseSchema: tmminDashboardExtendedSchema,
    });
  }

  suppliers(query: SupplierListQuery) {
    return this.client.request('/api/v1/tmmin/suppliers', {
      query: asQuery(supplierListQuerySchema.parse(query)),
      responseSchema: supplierPageSchema,
    });
  }

  supplier(id: string) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}`, {
      responseSchema: supplierDetailSchema,
    });
  }

  createSupplier(body: CreateSupplierRequest) {
    return this.client.request('/api/v1/tmmin/suppliers', {
      method: 'POST',
      body,
      responseSchema: supplierCredentialResponseSchema,
    });
  }

  updateSupplier(id: string, body: UpdateSupplierRequest) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}`, {
      method: 'PATCH',
      body,
      responseSchema: supplierSummarySchema,
    });
  }

  supplierAction(id: string, action: 'activate' | 'deactivate', expectedVersion: number) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/${action}`, {
      method: 'POST',
      body: { expectedVersion },
      responseSchema: supplierSummarySchema,
    });
  }

  replaceSupplierAdmin(
    id: string,
    body: { expectedVersion: number; username: string; displayName: string },
  ) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/supplier-admin/replace`, {
      method: 'POST',
      body,
      responseSchema: userCredentialResponseSchema,
    });
  }

  resetSupplierAdmin(id: string, expectedVersion: number) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/supplier-admin/reset-password`, {
      method: 'POST',
      body: { expectedVersion },
      responseSchema: userCredentialResponseSchema,
    });
  }

  source(id: string) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/source`, {
      responseSchema: sourceGovernanceSummarySchema,
    });
  }

  sourcePreflight(id: string, targetMode: 'HOSTED' | 'EXTERNAL') {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/source/preflight`, {
      method: 'POST',
      body: { targetMode },
      responseSchema: sourcePreflightResponseSchema,
    });
  }

  startHostedPreparation(
    id: string,
    body: {
      expectedVersion: number;
      reason: string;
      privacyAcknowledged: true;
      supplierAdmin: { username: string; displayName: string };
    },
  ) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/source/preparation`, {
      method: 'POST',
      body,
      responseSchema: hostedPreparationCredentialSchema,
    });
  }

  cancelHostedPreparation(id: string, body: { expectedVersion: number; reason: string }) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/source/preparation/cancel`, {
      method: 'POST',
      body,
      responseSchema: supplierSummarySchema,
    });
  }

  sourceCutover(
    id: string,
    body: {
      targetMode: 'HOSTED' | 'EXTERNAL';
      expectedVersion: number;
      reason: string;
      privacyAcknowledged: true;
    },
  ) {
    return this.client.request(`/api/v1/tmmin/suppliers/${id}/source/cutover`, {
      method: 'POST',
      body,
      responseSchema: supplierSummarySchema,
    });
  }

  qualityUsers(query: QualityUserListQuery) {
    return this.client.request('/api/v1/tmmin/quality-users', {
      query: asQuery(qualityUserListQuerySchema.parse(query)),
      responseSchema: userPageSchema,
    });
  }

  createQualityUser(body: CreateTmminQualityRequest) {
    return this.client.request('/api/v1/tmmin/quality-users', {
      method: 'POST',
      body,
      responseSchema: userCredentialResponseSchema,
    });
  }

  qualityUser(id: string) {
    return this.client.request(`/api/v1/tmmin/quality-users/${id}`, {
      responseSchema: userSummarySchema,
    });
  }

  qualityUserAction(
    id: string,
    action: 'deactivate' | 'reactivate' | 'reset-password',
    expectedVersion: number,
  ) {
    return this.client.request(`/api/v1/tmmin/quality-users/${id}/${action}`, {
      method: 'POST',
      body: { expectedVersion },
      responseSchema:
        action === 'reset-password' ? userCredentialResponseSchema : userSummarySchema,
    });
  }

  henkatens(query: TmminHenkatenQuery) {
    return this.client.request('/api/v1/tmmin/henkatens', {
      query: asQuery(tmminHenkatenQuerySchema.parse(query)),
      responseSchema: tmminHenkatenPageSchema,
    });
  }

  supplierHenkatens(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/henkatens`, {
      query,
      responseSchema: henkatenPageSchema,
    });
  }

  hostedHenkaten(supplierId: string, id: string) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/henkatens/${id}`, {
      responseSchema: henkatenDetailSchema,
    });
  }

  affectedParts(query: QueryRecord = {}) {
    return this.client.request('/api/v1/tmmin/warnings/affected-parts', {
      query,
      responseSchema: affectedPartPageSchema,
    });
  }

  affectedPart(supplierId: string, partNumber: string) {
    return this.client.request(
      `/api/v1/tmmin/warnings/affected-parts/${supplierId}/${encodeURIComponent(partNumber)}`,
      { responseSchema: affectedPartDetailSchema },
    );
  }

  externalClients(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/external-clients`, {
      query,
      responseSchema: externalClientPageSchema,
    });
  }

  createExternalClient(supplierId: string, body: CreateExternalClientRequest) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/external-clients`, {
      method: 'POST',
      body: createExternalClientRequestSchema.parse(body),
      responseSchema: externalClientCredentialSchema,
    });
  }

  externalClientAction(
    supplierId: string,
    id: string,
    action: 'rotate-secret' | 'revoke',
    expectedVersion: number,
  ) {
    return this.client.request(
      `/api/v1/tmmin/suppliers/${supplierId}/external-clients/${id}/${action}`,
      {
        method: 'POST',
        body: { expectedVersion },
        responseSchema:
          action === 'rotate-secret' ? externalClientCredentialSchema : externalClientSchema,
      },
    );
  }

  externalProjections(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/external-projections`, {
      query,
      responseSchema: externalProjectionPageSchema,
    });
  }

  externalProjection(supplierId: string, id: string) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/external-projections/${id}`, {
      responseSchema: externalProjectionDetailSchema,
    });
  }

  externalHealth(query: ExternalHealthQuery) {
    return this.client.request('/api/v1/tmmin/external-health', {
      query: asQuery(query),
      responseSchema: externalHealthSchema,
    });
  }

  shifts(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/shifts`, {
      query,
      responseSchema: shiftRunPageSchema,
    });
  }

  shift(supplierId: string, id: string) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/shifts/${id}`, {
      responseSchema: shiftRunDetailSchema,
    });
  }

  assignmentBoard(supplierId: string, lineId?: string) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/assignment-board`, {
      query: { lineId },
      responseSchema: assignmentBoardSchema,
    });
  }

  hostedMembers(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/master-data/members`, {
      query,
      responseSchema: memberPageSchema,
    });
  }

  hostedLines(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/master-data/lines`, {
      query,
      responseSchema: linePageSchema,
    });
  }

  hostedParts(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(`/api/v1/tmmin/suppliers/${supplierId}/master-data/parts`, {
      query,
      responseSchema: partPageSchema,
    });
  }

  hostedShiftTemplates(supplierId: string, query: QueryRecord = {}) {
    return this.client.request(
      `/api/v1/tmmin/suppliers/${supplierId}/master-data/shift-templates`,
      { query, responseSchema: shiftTemplatePageSchema },
    );
  }

  audit(query: AuditQuery) {
    return this.client.request('/api/v1/tmmin/audit', {
      query: asQuery(query),
      responseSchema: auditPageSchema,
    });
  }

  notifications(query: NotificationListQuery) {
    return this.client.request('/api/v1/tmmin/notifications', {
      query: asQuery(query),
      responseSchema: notificationPageSchema,
    });
  }

  notificationCount() {
    return this.client.request('/api/v1/tmmin/notifications/unread-count', {
      responseSchema: notificationUnreadCountSchema,
    });
  }

  setNotificationRead(id: string, read: boolean, expectedVersion: number) {
    return this.client.request(`/api/v1/tmmin/notifications/${id}/read-state`, {
      method: 'PATCH',
      body: { read, expectedVersion },
      responseSchema: notificationSchema,
    });
  }
}

function asQuery(value: object): QueryRecord {
  return value as QueryRecord;
}
