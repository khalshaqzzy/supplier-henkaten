import { z } from 'zod';

import {
  assignmentBoardSchema,
  assignmentIssuePageSchema,
  auditPageSchema,
  checklistDraftSchema,
  checklistVersionSchema,
  clonePrefillSchema,
  defaultAssignmentsSchema,
  henkatenDetailSchema,
  henkatenFormOptionsSchema,
  henkatenPageSchema,
  henkatenTransitionSchema,
  jobPageSchema,
  jobSchema,
  linePageSchema,
  lineSchema,
  memberCredentialResponseSchema,
  memberPageSchema,
  memberSchema,
  notificationPageSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  pushConfigSchema,
  pushSubscriptionSchema,
  partPageSchema,
  partSchema,
  preStartResolutionContextSchema,
  sessionResponseSchema,
  shiftRunDetailSchema,
  shiftRunPageSchema,
  shiftTemplatePageSchema,
  shiftTemplateSchema,
  supplierDashboardSchema,
  supplierSetupReadinessSchema,
  workingAssignmentSchema,
  type AuditQuery,
  type BoardQuery,
  type CreatePushSubscriptionRequest,
  type CreateHenkatenRequest,
  type DashboardQuery,
  type HenkatenFormOptionsQuery,
  type HenkatenListQuery,
  type MasterListQuery,
  type NotificationListQuery,
  type ShiftListQuery,
  type SupplierLoginRequest,
} from '@tmmin-henkaten/contracts';

import { ApiClient } from './core';

const versionsSchema = z.object({ items: z.array(checklistVersionSchema) }).strict();
const transitionsSchema = z.array(henkatenTransitionSchema);
const assignmentsSchema = z
  .object({ items: z.array(workingAssignmentSchema) })
  .strict()
  .transform(({ items }) => items);

export class SupplierApi {
  constructor(private readonly client: ApiClient) {}

  login(body: SupplierLoginRequest) {
    return this.client.request('/api/v1/auth/supplier/login', {
      method: 'POST',
      body,
      responseSchema: sessionResponseSchema,
      authenticated: false,
    });
  }

  session() {
    return this.client.request('/api/v1/auth/supplier/session', {
      responseSchema: sessionResponseSchema,
    });
  }

  changePassword(body: { currentPassword: string; newPassword: string }) {
    return this.client.request('/api/v1/auth/supplier/change-password', {
      method: 'POST',
      body,
      responseType: 'void',
    });
  }

  logout() {
    return this.client.request('/api/v1/auth/supplier/logout', {
      method: 'POST',
      responseType: 'void',
    });
  }

  setupReadiness() {
    return this.client.request('/api/v1/supplier/setup-readiness', {
      responseSchema: supplierSetupReadinessSchema,
    });
  }

  dashboard(query: DashboardQuery) {
    return this.client.request('/api/v1/supplier/dashboard', {
      query,
      responseSchema: supplierDashboardSchema,
    });
  }

  board(query: BoardQuery = {}) {
    return this.client.request('/api/v1/supplier/assignment-board', {
      query,
      responseSchema: assignmentBoardSchema,
    });
  }

  notifications(query: NotificationListQuery = { limit: 30 }) {
    return this.client.request('/api/v1/supplier/notifications', {
      query,
      responseSchema: notificationPageSchema,
    });
  }

  notificationCount() {
    return this.client.request('/api/v1/supplier/notifications/unread-count', {
      responseSchema: notificationUnreadCountSchema,
    });
  }

  setNotificationRead(id: string, body: { read: boolean; expectedVersion: number }) {
    return this.client.request(`/api/v1/supplier/notifications/${id}/read-state`, {
      method: 'PATCH',
      body,
      responseSchema: notificationSchema,
    });
  }

  pushConfig() {
    return this.client.request('/api/v1/supplier/push/config', {
      responseSchema: pushConfigSchema,
    });
  }

  createPushSubscription(body: CreatePushSubscriptionRequest) {
    return this.client.request('/api/v1/supplier/push-subscriptions', {
      method: 'POST',
      body,
      responseSchema: pushSubscriptionSchema,
    });
  }

  deletePushSubscription(id: string, expectedVersion: number) {
    return this.client.request(`/api/v1/supplier/push-subscriptions/${id}`, {
      method: 'DELETE',
      body: { expectedVersion },
      responseSchema: pushSubscriptionSchema,
    });
  }

  audit(query: AuditQuery = { limit: 50 }) {
    return this.client.request('/api/v1/supplier/audit', {
      query,
      responseSchema: auditPageSchema,
    });
  }

  members(query: MasterListQuery = { limit: 50, active: 'ALL' }) {
    return this.client.request('/api/v1/supplier/master-data/members', {
      query,
      responseSchema: memberPageSchema,
    });
  }

  member(id: string) {
    return this.client.request(`/api/v1/supplier/master-data/members/${id}`, {
      responseSchema: memberSchema,
    });
  }

  createMember(body: unknown) {
    return this.client.request('/api/v1/supplier/master-data/members', {
      method: 'POST',
      body,
      responseSchema: memberCredentialResponseSchema,
    });
  }

  updateMember(id: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/members/${id}`, {
      method: 'PATCH',
      body,
      responseSchema: memberSchema,
    });
  }

  memberAction(id: string, action: 'activate' | 'deactivate', body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/members/${id}/${action}`, {
      method: 'POST',
      body,
      responseSchema: memberSchema,
    });
  }

  resetMemberPassword(id: string, body: unknown) {
    return this.client.request(
      `/api/v1/supplier/master-data/members/${id}/account/reset-password`,
      {
        method: 'POST',
        body,
        responseSchema: memberCredentialResponseSchema,
      },
    );
  }

  uploadMemberPhoto(id: string, file: File) {
    const formData = new FormData();
    formData.set('photo', file);
    return this.client.request(`/api/v1/supplier/master-data/members/${id}/photo`, {
      method: 'POST',
      formData,
      responseSchema: memberSchema,
    });
  }

  removeMemberPhoto(id: string, expectedVersion: number): Promise<void> {
    return this.client.request(`/api/v1/supplier/master-data/members/${id}/photo/remove`, {
      method: 'POST',
      body: { expectedVersion },
      responseType: 'void',
    });
  }

  memberPhoto(id: string, variant: 'full' | 'thumbnail') {
    return this.client.request(`/api/v1/supplier/master-data/members/${id}/photo/${variant}`, {
      responseType: 'blob',
    });
  }

  lines(query: MasterListQuery = { limit: 50, active: 'ALL' }) {
    return this.client.request('/api/v1/supplier/master-data/lines', {
      query,
      responseSchema: linePageSchema,
    });
  }

  line(id: string) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${id}`, {
      responseSchema: lineSchema,
    });
  }

  createLine(body: unknown) {
    return this.client.request('/api/v1/supplier/master-data/lines', {
      method: 'POST',
      body,
      responseSchema: lineSchema,
    });
  }

  updateLine(id: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${id}`, {
      method: 'PATCH',
      body,
      responseSchema: lineSchema,
    });
  }

  lineAction(id: string, action: 'activate' | 'deactivate', body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${id}/${action}`, {
      method: 'POST',
      body,
      responseSchema: lineSchema,
    });
  }

  jobs(lineId: string, query: MasterListQuery = { limit: 50, active: 'ALL' }) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${lineId}/jobs`, {
      query,
      responseSchema: jobPageSchema,
    });
  }

  createJob(lineId: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${lineId}/jobs`, {
      method: 'POST',
      body,
      responseSchema: jobSchema,
    });
  }

  updateJob(lineId: string, id: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${lineId}/jobs/${id}`, {
      method: 'PATCH',
      body,
      responseSchema: jobSchema,
    });
  }

  jobAction(lineId: string, id: string, action: 'activate' | 'deactivate', body: unknown) {
    return this.client.request(
      `/api/v1/supplier/master-data/lines/${lineId}/jobs/${id}/${action}`,
      { method: 'POST', body, responseSchema: jobSchema },
    );
  }

  reorderJobs(lineId: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/lines/${lineId}/jobs/reorder`, {
      method: 'POST',
      body,
      responseType: 'void',
    });
  }

  parts(query: MasterListQuery = { limit: 50, active: 'ALL' }) {
    return this.client.request('/api/v1/supplier/master-data/parts', {
      query,
      responseSchema: partPageSchema,
    });
  }

  part(id: string) {
    return this.client.request(`/api/v1/supplier/master-data/parts/${id}`, {
      responseSchema: partSchema,
    });
  }

  createPart(body: unknown) {
    return this.client.request('/api/v1/supplier/master-data/parts', {
      method: 'POST',
      body,
      responseSchema: partSchema,
    });
  }

  updatePart(id: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/parts/${id}`, {
      method: 'PATCH',
      body,
      responseSchema: partSchema,
    });
  }

  partAction(id: string, action: 'activate' | 'deactivate', body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/parts/${id}/${action}`, {
      method: 'POST',
      body,
      responseSchema: partSchema,
    });
  }

  shiftTemplates(query: MasterListQuery = { limit: 50, active: 'ALL' }) {
    return this.client.request('/api/v1/supplier/master-data/shift-templates', {
      query,
      responseSchema: shiftTemplatePageSchema,
    });
  }

  shiftTemplate(id: string) {
    return this.client.request(`/api/v1/supplier/master-data/shift-templates/${id}`, {
      responseSchema: shiftTemplateSchema,
    });
  }

  createShiftTemplate(body: unknown) {
    return this.client.request('/api/v1/supplier/master-data/shift-templates', {
      method: 'POST',
      body,
      responseSchema: shiftTemplateSchema,
    });
  }

  updateShiftTemplate(id: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/shift-templates/${id}`, {
      method: 'PATCH',
      body,
      responseSchema: shiftTemplateSchema,
    });
  }

  shiftTemplateAction(id: string, action: 'activate' | 'deactivate', body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/shift-templates/${id}/${action}`, {
      method: 'POST',
      body,
      responseSchema: shiftTemplateSchema,
    });
  }

  checklistDraft(category: string) {
    return this.client.request(`/api/v1/supplier/master-data/checklists/${category}/draft`, {
      responseSchema: checklistDraftSchema,
    });
  }

  updateChecklistDraft(category: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/checklists/${category}/draft`, {
      method: 'PATCH',
      body,
      responseSchema: checklistDraftSchema,
    });
  }

  publishChecklist(category: string, body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/checklists/${category}/publish`, {
      method: 'POST',
      body,
      responseSchema: checklistVersionSchema,
    });
  }

  checklistVersions(category: string) {
    return this.client.request(`/api/v1/supplier/master-data/checklists/${category}/versions`, {
      responseSchema: versionsSchema,
    });
  }

  checklistAction(category: string, action: 'activate' | 'deactivate', body: unknown) {
    return this.client.request(`/api/v1/supplier/master-data/checklists/${category}/${action}`, {
      method: 'POST',
      body,
      responseSchema: checklistDraftSchema,
    });
  }

  defaultAssignments(query: { lineId?: string } = {}) {
    return this.client.request('/api/v1/supplier/master-data/default-assignments', {
      query,
      responseSchema: defaultAssignmentsSchema,
    });
  }

  assignDefault(kind: 'supervisor' | 'leader' | 'mp', resourceId: string, body: unknown) {
    const path =
      kind === 'supervisor'
        ? `/api/v1/supplier/master-data/lines/${resourceId}/default-supervisor`
        : kind === 'leader'
          ? `/api/v1/supplier/master-data/lines/${resourceId}/default-line-leader`
          : `/api/v1/supplier/master-data/jobs/${resourceId}/default-mp`;
    return this.client.request(path, {
      method: 'POST',
      body,
      responseSchema: defaultAssignmentsSchema,
    });
  }

  moveDefault(kind: 'leader' | 'mp', resourceId: string, body: unknown) {
    const path =
      kind === 'leader'
        ? `/api/v1/supplier/master-data/lines/${resourceId}/default-line-leader/move`
        : `/api/v1/supplier/master-data/jobs/${resourceId}/default-mp/move`;
    return this.client.request(path, {
      method: 'POST',
      body,
      responseSchema: defaultAssignmentsSchema,
    });
  }

  removeAssignment(
    kind: 'supervisors' | 'line-leaders' | 'mps',
    resourceId: string,
    body: unknown,
  ) {
    return this.client.request(`/api/v1/supplier/master-data/${kind}/${resourceId}/remove`, {
      method: 'POST',
      body,
      responseSchema: defaultAssignmentsSchema,
    });
  }

  shifts(query: ShiftListQuery = { limit: 30 }) {
    return this.client.request('/api/v1/supplier/shifts', {
      query,
      responseSchema: shiftRunPageSchema,
    });
  }

  currentShift(query: { lineId?: string } = {}) {
    return this.client.request('/api/v1/supplier/shifts/current', {
      query,
      responseSchema: shiftRunDetailSchema.nullable(),
    });
  }

  prepareShift(body: unknown) {
    return this.client.request('/api/v1/supplier/shifts/preflight', {
      method: 'POST',
      body,
      responseSchema: shiftRunDetailSchema,
    });
  }

  shift(id: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}`, {
      responseSchema: shiftRunDetailSchema,
    });
  }

  shiftPreflight(id: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}/preflight`, {
      responseSchema: shiftRunDetailSchema,
    });
  }

  startShift(id: string, body: unknown, idempotencyKey: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}/start`, {
      method: 'POST',
      body,
      idempotencyKey,
      responseSchema: shiftRunDetailSchema,
    });
  }

  emergencyStartShift(id: string, body: unknown, idempotencyKey: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}/emergency-start`, {
      method: 'POST',
      body,
      idempotencyKey,
      responseSchema: shiftRunDetailSchema,
    });
  }

  endShift(id: string, body: unknown, idempotencyKey: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}/end`, {
      method: 'POST',
      body,
      idempotencyKey,
      responseSchema: shiftRunDetailSchema,
    });
  }

  shiftIssues(id?: string) {
    return this.client.request(
      id
        ? `/api/v1/supplier/shifts/${id}/assignment-issues`
        : '/api/v1/supplier/shifts/assignment-issues',
      { responseSchema: assignmentIssuePageSchema },
    );
  }

  resolutionContext(id: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}/resolution-context`, {
      responseSchema: preStartResolutionContextSchema,
    });
  }

  workingAssignments(id: string) {
    return this.client.request(`/api/v1/supplier/shifts/${id}/working-assignments`, {
      responseSchema: assignmentsSchema,
    });
  }

  henkatens(query: HenkatenListQuery = { limit: 30 }) {
    return this.client.request('/api/v1/supplier/henkatens', {
      query,
      responseSchema: henkatenPageSchema,
    });
  }

  henkatenFormOptions(query: HenkatenFormOptionsQuery) {
    return this.client.request('/api/v1/supplier/henkatens/form-options', {
      query,
      responseSchema: henkatenFormOptionsSchema,
    });
  }

  createHenkaten(body: CreateHenkatenRequest, idempotencyKey: string) {
    return this.client.request('/api/v1/supplier/henkatens', {
      method: 'POST',
      body,
      idempotencyKey,
      responseSchema: henkatenDetailSchema,
    });
  }

  henkaten(id: string) {
    return this.client.request(`/api/v1/supplier/henkatens/${id}`, {
      responseSchema: henkatenDetailSchema,
    });
  }

  henkatenHistory(id: string) {
    return this.client.request(`/api/v1/supplier/henkatens/${id}/history`, {
      responseSchema: transitionsSchema,
    });
  }

  clonePrefill(id: string) {
    return this.client.request(`/api/v1/supplier/henkatens/${id}/clone-prefill`, {
      responseSchema: clonePrefillSchema,
    });
  }

  withdrawHenkaten(id: string, body: unknown, idempotencyKey: string) {
    return this.client.request(`/api/v1/supplier/henkatens/${id}/withdraw`, {
      method: 'POST',
      body,
      idempotencyKey,
      responseSchema: henkatenDetailSchema,
    });
  }

  decideHenkaten(id: string, body: unknown, idempotencyKey: string) {
    return this.client.request(`/api/v1/supplier/henkatens/${id}/decisions`, {
      method: 'POST',
      body,
      idempotencyKey,
      responseSchema: henkatenDetailSchema,
    });
  }

  rerouteSupervisor(id: string, body: unknown, idempotencyKey: string) {
    return this.client.request(
      `/api/v1/supplier/henkatens/${id}/approval-routes/supervisor/reroute`,
      { method: 'POST', body, idempotencyKey, responseSchema: henkatenDetailSchema },
    );
  }
}
