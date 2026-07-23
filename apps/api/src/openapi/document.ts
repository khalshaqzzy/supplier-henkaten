import { z } from 'zod';
import { createDocument } from 'zod-openapi';

import {
  createSupplierRequestSchema,
  createTmminQualityRequestSchema,
  cancelHostedPreparationRequestSchema,
  expectedVersionSchema,
  healthResponseSchema,
  hostedPreparationSchema,
  passwordChangeRequestSchema,
  problemDetailsSchema,
  readinessResponseSchema,
  replaceSupplierAdminRequestSchema,
  sessionResponseSchema,
  sourceCutoverRequestSchema,
  sourcePreflightResponseSchema,
  sourceModeSchema,
  startHostedPreparationRequestSchema,
  supplierCredentialResponseSchema,
  supplierLoginRequestSchema,
  supplierPageSchema,
  supplierSummarySchema,
  tmminLoginRequestSchema,
  updateSupplierRequestSchema,
  userCredentialResponseSchema,
  userPageSchema,
  userSummarySchema,
  assignmentMoveRequestSchema,
  assignmentMutationRequestSchema,
  assignmentRemoveRequestSchema,
  checklistDraftSchema,
  checklistVersionSchema,
  createJobRequestSchema,
  createLineRequestSchema,
  createMemberRequestSchema,
  createPartRequestSchema,
  createShiftTemplateRequestSchema,
  defaultAssignmentsSchema,
  jobPageSchema,
  jobSchema,
  linePageSchema,
  lineSchema,
  masterListQuerySchema,
  memberCredentialResponseSchema,
  memberPageSchema,
  memberSchema,
  partPageSchema,
  partSchema,
  reorderRequestSchema,
  shiftTemplatePageSchema,
  shiftTemplateSchema,
  updateChecklistDraftRequestSchema,
  updateJobRequestSchema,
  updateLineRequestSchema,
  updateMemberAccountRequestSchema,
  updateMemberRequestSchema,
  updatePartRequestSchema,
  updateShiftTemplateRequestSchema,
  affectedPartPageSchema,
  affectedPartDetailSchema,
  assignmentIssuePageSchema,
  clonePrefillSchema,
  createHenkatenRequestSchema,
  decideHenkatenRequestSchema,
  currentShiftQuerySchema,
  emergencyStartShiftRequestSchema,
  endShiftRequestSchema,
  henkatenDetailSchema,
  henkatenListQuerySchema,
  henkatenPageSchema,
  henkatenTransitionSchema,
  prepareShiftRequestSchema,
  preStartResolutionContextSchema,
  rerouteSupervisorRequestSchema,
  shiftListQuerySchema,
  shiftRunDetailSchema,
  shiftRunPageSchema,
  startShiftRequestSchema,
  warningInstanceSchema,
  withdrawHenkatenRequestSchema,
  workingAssignmentSchema,
  assignmentBoardSchema,
  auditPageSchema,
  auditQuerySchema,
  boardQuerySchema,
  dashboardQuerySchema,
  notificationListQuerySchema,
  notificationPageSchema,
  notificationReadRequestSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  supplierDashboardSchema,
  tmminDashboardSchema,
  createExternalClientRequestSchema,
  externalBatchRequestSchema,
  externalBatchResponseSchema,
  externalClientActionRequestSchema,
  externalClientCredentialSchema,
  externalClientPageSchema,
  externalClientSchema,
  externalHenkatenEventSchema,
  externalProjectionDetailSchema,
  externalProjectionPageSchema,
  externalTokenRequestSchema,
  externalTokenResponseSchema,
  ingestionResultSchema,
  ingestionStatusSchema,
} from '@tmmin-henkaten/contracts';

const noContent = { description: 'No content' };
const problem = {
  description: 'Problem Details',
  content: { 'application/problem+json': { schema: problemDetailsSchema } },
};
const json = (description: string, schema: z.ZodType) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const idPath = { path: z.object({ id: z.string().uuid() }) };
const preparationResponseSchema = z
  .object({
    preparation: hostedPreparationSchema,
    user: userSummarySchema,
    credential: z.object({
      username: z.string(),
      temporaryPassword: z.string(),
    }),
  })
  .strict();

export function buildOpenApiDocument(): Record<string, unknown> {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'TMMIN Supplier Henkaten API',
      version: '1.0.0',
      description: 'Hosted platform API foundation and TMMIN administration contract.',
    },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/health': { get: { responses: { '200': json('Healthy', healthResponseSchema) } } },
      '/ready': {
        get: {
          responses: {
            '200': json('Ready', readinessResponseSchema),
            '503': json('Not ready', readinessResponseSchema),
          },
        },
      },
      '/api/v1/openapi.json': {
        get: { responses: { '200': { description: 'OpenAPI 3.1 document' } } },
      },
      '/api/v1/auth/supplier/login': {
        post: {
          requestBody: body(supplierLoginRequestSchema),
          responses: { '200': json('Session', sessionResponseSchema), '401': problem },
        },
      },
      '/api/v1/auth/tmmin/login': {
        post: {
          requestBody: body(tmminLoginRequestSchema),
          responses: { '200': json('Session', sessionResponseSchema), '401': problem },
        },
      },
      '/api/v1/auth/supplier/session': sessionPath(),
      '/api/v1/auth/tmmin/session': sessionPath(),
      '/api/v1/auth/supplier/change-password': passwordPath(),
      '/api/v1/auth/tmmin/change-password': passwordPath(),
      '/api/v1/auth/supplier/logout': logoutPath(),
      '/api/v1/auth/tmmin/logout': logoutPath(),
      '/api/v1/tmmin/quality-users': {
        get: { responses: { '200': json('TMMIN Quality users', userPageSchema) } },
        post: {
          requestBody: body(createTmminQualityRequestSchema),
          responses: { '201': json('Created user and credential', userCredentialResponseSchema) },
        },
      },
      '/api/v1/tmmin/quality-users/{id}': {
        get: {
          requestParams: idPath,
          responses: { '200': json('TMMIN Quality user', userSummarySchema), '404': problem },
        },
      },
      '/api/v1/tmmin/quality-users/{id}/deactivate': userActionPath(userSummarySchema),
      '/api/v1/tmmin/quality-users/{id}/reactivate': userActionPath(userSummarySchema),
      '/api/v1/tmmin/quality-users/{id}/reset-password': userActionPath(
        userCredentialResponseSchema,
      ),
      '/api/v1/tmmin/suppliers': {
        get: { responses: { '200': json('Suppliers', supplierPageSchema) } },
        post: {
          requestBody: body(createSupplierRequestSchema),
          responses: {
            '201': json('Created supplier', supplierCredentialResponseSchema),
            '409': problem,
          },
        },
      },
      '/api/v1/tmmin/suppliers/{id}': {
        get: {
          requestParams: idPath,
          responses: { '200': json('Supplier', supplierSummarySchema), '404': problem },
        },
        patch: {
          requestParams: idPath,
          requestBody: body(updateSupplierRequestSchema),
          responses: {
            '200': json('Updated supplier', supplierSummarySchema),
            '409': problem,
          },
        },
      },
      '/api/v1/tmmin/suppliers/{id}/activate': supplierActionPath(
        expectedVersionSchema,
        supplierSummarySchema,
      ),
      '/api/v1/tmmin/suppliers/{id}/deactivate': supplierActionPath(
        expectedVersionSchema,
        supplierSummarySchema,
      ),
      '/api/v1/tmmin/suppliers/{id}/supplier-admin/replace': supplierActionPath(
        replaceSupplierAdminRequestSchema,
        userCredentialResponseSchema,
      ),
      '/api/v1/tmmin/suppliers/{id}/supplier-admin/reset-password': supplierActionPath(
        expectedVersionSchema,
        userCredentialResponseSchema,
      ),
      '/api/v1/tmmin/suppliers/{id}/source/preparation': {
        post: {
          requestParams: idPath,
          requestBody: body(startHostedPreparationRequestSchema),
          responses: {
            '201': json('Hosted Preparation started', preparationResponseSchema),
            '409': problem,
          },
        },
      },
      '/api/v1/tmmin/suppliers/{id}/source/preparation/cancel': supplierActionPath(
        cancelHostedPreparationRequestSchema,
        supplierSummarySchema,
      ),
      '/api/v1/tmmin/suppliers/{id}/source/preflight': {
        post: {
          requestParams: idPath,
          requestBody: body(z.object({ targetMode: sourceModeSchema }).strict()),
          responses: {
            '200': json('Source cutover preflight', sourcePreflightResponseSchema),
            '404': problem,
          },
        },
      },
      '/api/v1/tmmin/suppliers/{id}/source/cutover': {
        post: {
          requestParams: idPath,
          requestBody: body(sourceCutoverRequestSchema),
          responses: {
            '200': json('Updated source mode', supplierSummarySchema),
            '409': problem,
          },
        },
      },
      ...masterDataPaths(),
      ...operationalPaths(),
      ...readModelPaths(),
      ...externalPaths(),
    },
  }) as unknown as Record<string, unknown>;
}

function externalPaths() {
  const supplier = { path: z.object({ supplierId: z.string().uuid() }) };
  const supplierAndId = {
    path: z.object({ supplierId: z.string().uuid(), id: z.string().uuid() }),
  };
  const bearer = { header: z.object({ Authorization: z.string().startsWith('Bearer ') }) };
  return {
    '/api/v1/tmmin/suppliers/{supplierId}/external-clients': {
      get: {
        requestParams: supplier,
        responses: { '200': json('External API clients', externalClientPageSchema) },
      },
      post: {
        requestParams: supplier,
        requestBody: body(createExternalClientRequestSchema),
        responses: {
          '201': json('Issued external client credential', externalClientCredentialSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/external-clients/{id}/rotate-secret': {
      post: {
        requestParams: supplierAndId,
        requestBody: body(externalClientActionRequestSchema),
        responses: {
          '201': json('Rotated external client secret', externalClientCredentialSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/external-clients/{id}/revoke': {
      post: {
        requestParams: supplierAndId,
        requestBody: body(externalClientActionRequestSchema),
        responses: { '200': json('Revoked external client', externalClientSchema), '409': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/external-projections': {
      get: {
        requestParams: supplier,
        responses: { '200': json('External Henkaten projections', externalProjectionPageSchema) },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/external-projections/{id}': {
      get: {
        requestParams: supplierAndId,
        responses: {
          '200': json('External Henkaten projection detail', externalProjectionDetailSchema),
          '404': problem,
        },
      },
    },
    '/api/v1/external/auth/token': {
      post: {
        requestBody: body(externalTokenRequestSchema),
        responses: {
          '200': json('Short-lived external bearer token', externalTokenResponseSchema),
          '401': problem,
          '429': problem,
        },
      },
    },
    '/api/v1/external/henkaten/events': {
      post: {
        requestParams: bearer,
        requestBody: body(externalHenkatenEventSchema),
        responses: {
          '202': json('Accepted external event', ingestionResultSchema),
          '200': json('Duplicate external event', ingestionResultSchema),
          '409': problem,
          '422': problem,
          '429': problem,
        },
      },
    },
    '/api/v1/external/henkaten/events/batch': {
      post: {
        requestParams: bearer,
        requestBody: body(externalBatchRequestSchema),
        responses: {
          '200': json('Per-item external ingestion results', externalBatchResponseSchema),
          '400': problem,
          '413': problem,
          '429': problem,
        },
      },
    },
    '/api/v1/external/ingestions/{eventId}': {
      get: {
        requestParams: {
          ...bearer,
          path: z.object({ eventId: z.string().min(1).max(200) }),
        },
        responses: {
          '200': json('External ingestion status', ingestionStatusSchema),
          '404': problem,
        },
      },
    },
  };
}

function readModelPaths() {
  return {
    '/api/v1/supplier/notifications': {
      get: {
        requestParams: { query: notificationListQuerySchema },
        responses: { '200': json('Current user notifications', notificationPageSchema) },
      },
    },
    '/api/v1/supplier/notifications/unread-count': {
      get: {
        responses: { '200': json('Unread notification count', notificationUnreadCountSchema) },
      },
    },
    '/api/v1/supplier/notifications/{id}/read-state': {
      patch: {
        requestParams: idPath,
        requestBody: body(notificationReadRequestSchema),
        responses: { '200': json('Updated notification', notificationSchema), '409': problem },
      },
    },
    '/api/v1/supplier/assignment-board': {
      get: {
        requestParams: { query: boardQuerySchema },
        responses: { '200': json('Current assignment board', assignmentBoardSchema) },
      },
    },
    '/api/v1/supplier/dashboard': {
      get: {
        requestParams: { query: dashboardQuerySchema },
        responses: { '200': json('Supplier dashboard', supplierDashboardSchema) },
      },
    },
    '/api/v1/supplier/audit': {
      get: {
        requestParams: { query: auditQuerySchema },
        responses: { '200': json('Supplier audit timeline', auditPageSchema) },
      },
    },
    '/api/v1/supplier/realtime': {
      get: {
        requestParams: { query: boardQuerySchema },
        responses: {
          '200': {
            description:
              'Authenticated SSE invalidation stream. REST read models remain canonical.',
            content: { 'text/event-stream': { schema: z.string() } },
          },
        },
      },
    },
    '/api/v1/tmmin/dashboard': {
      get: { responses: { '200': json('TMMIN global dashboard', tmminDashboardSchema) } },
    },
    '/api/v1/tmmin/notifications': {
      get: {
        requestParams: { query: notificationListQuerySchema },
        responses: { '200': json('Current TMMIN user notifications', notificationPageSchema) },
      },
    },
    '/api/v1/tmmin/notifications/unread-count': {
      get: {
        responses: {
          '200': json('Unread TMMIN notification count', notificationUnreadCountSchema),
        },
      },
    },
    '/api/v1/tmmin/notifications/{id}/read-state': {
      patch: {
        requestParams: idPath,
        requestBody: body(notificationReadRequestSchema),
        responses: { '200': json('Updated notification', notificationSchema), '409': problem },
      },
    },
    '/api/v1/tmmin/audit': {
      get: {
        requestParams: { query: auditQuerySchema },
        responses: { '200': json('TMMIN privileged audit timeline', auditPageSchema) },
      },
    },
  };
}

function operationalPaths() {
  const shiftId = { path: z.object({ id: z.string().uuid() }) };
  const supplierAndId = {
    path: z.object({ supplierId: z.string().uuid(), id: z.string().uuid() }),
  };
  const supplierOnly = { path: z.object({ supplierId: z.string().uuid() }) };
  return {
    '/api/v1/supplier/shifts': {
      get: {
        requestParams: { query: shiftListQuerySchema },
        responses: { '200': json('Shift Runs', shiftRunPageSchema) },
      },
    },
    '/api/v1/supplier/shifts/current': {
      get: {
        requestParams: { query: currentShiftQuerySchema },
        responses: {
          '200': json('Current Shift Run', shiftRunDetailSchema.nullable()),
        },
      },
    },
    '/api/v1/supplier/shifts/preflight': {
      post: {
        requestBody: body(prepareShiftRequestSchema),
        responses: {
          '201': json('Durable Shift Run plan and preflight', shiftRunDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/supplier/shifts/assignment-issues': {
      get: {
        responses: { '200': json('Assignment Issues', assignmentIssuePageSchema) },
      },
    },
    '/api/v1/supplier/shifts/{id}': {
      get: {
        requestParams: shiftId,
        responses: { '200': json('Shift Run', shiftRunDetailSchema), '404': problem },
      },
    },
    '/api/v1/supplier/shifts/{id}/preflight': {
      get: {
        requestParams: shiftId,
        responses: { '200': json('Shift Run preflight', shiftRunDetailSchema), '404': problem },
      },
    },
    '/api/v1/supplier/shifts/{id}/working-assignments': {
      get: {
        requestParams: shiftId,
        responses: {
          '200': json(
            'Working Assignments',
            z.object({ items: z.array(workingAssignmentSchema) }).strict(),
          ),
        },
      },
    },
    '/api/v1/supplier/shifts/{id}/assignment-issues': {
      get: {
        requestParams: shiftId,
        responses: { '200': json('Assignment Issues', assignmentIssuePageSchema) },
      },
    },
    '/api/v1/supplier/shifts/{id}/resolution-context': {
      get: {
        requestParams: shiftId,
        responses: {
          '200': json('Pre-start resolution context', preStartResolutionContextSchema),
        },
      },
    },
    '/api/v1/supplier/shifts/{id}/start': {
      post: {
        requestParams: shiftId,
        requestBody: body(startShiftRequestSchema),
        responses: { '201': json('Started Shift Run', shiftRunDetailSchema), '409': problem },
      },
    },
    '/api/v1/supplier/shifts/{id}/emergency-start': {
      post: {
        requestParams: shiftId,
        requestBody: body(emergencyStartShiftRequestSchema),
        responses: {
          '201': json('Emergency-started Shift Run', shiftRunDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/supplier/shifts/{id}/end': {
      post: {
        requestParams: {
          ...shiftId,
          header: z.object({ 'Idempotency-Key': z.string().min(1).max(128) }),
        },
        requestBody: body(endShiftRequestSchema),
        responses: {
          '201': json('Ended Shift Run', shiftRunDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/shifts': {
      get: {
        requestParams: { ...supplierOnly, query: shiftListQuerySchema },
        responses: { '200': json('Supplier Shift Runs', shiftRunPageSchema), '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/shifts/{id}': {
      get: {
        requestParams: supplierAndId,
        responses: { '200': json('Supplier Shift Run', shiftRunDetailSchema), '404': problem },
      },
    },
    '/api/v1/supplier/henkatens': {
      get: {
        requestParams: { query: henkatenListQuerySchema },
        responses: { '200': json('Henkaten records', henkatenPageSchema) },
      },
      post: {
        requestParams: {
          header: z.object({ 'Idempotency-Key': z.string().min(1).max(128) }),
        },
        requestBody: body(createHenkatenRequestSchema),
        responses: {
          '201': json('Submitted Henkaten', henkatenDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/supplier/henkatens/{id}': {
      get: {
        requestParams: shiftId,
        responses: { '200': json('Henkaten detail', henkatenDetailSchema), '404': problem },
      },
    },
    '/api/v1/supplier/henkatens/{id}/history': {
      get: {
        requestParams: shiftId,
        responses: {
          '200': json(
            'Henkaten lifecycle history',
            z.object({ items: z.array(henkatenTransitionSchema) }).strict(),
          ),
        },
      },
    },
    '/api/v1/supplier/henkatens/{id}/withdraw': {
      post: {
        requestParams: shiftId,
        requestBody: body(withdrawHenkatenRequestSchema),
        responses: {
          '201': json('Withdrawn Henkaten', henkatenDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/supplier/henkatens/{id}/decisions': {
      post: {
        requestParams: {
          ...shiftId,
          header: z.object({ 'Idempotency-Key': z.string().min(1).max(128) }),
        },
        requestBody: body(decideHenkatenRequestSchema),
        responses: {
          '201': json('Recorded approval decision', henkatenDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/supplier/henkatens/{id}/approval-routes/supervisor/reroute': {
      post: {
        requestParams: {
          ...shiftId,
          header: z.object({ 'Idempotency-Key': z.string().min(1).max(128) }),
        },
        requestBody: body(rerouteSupervisorRequestSchema),
        responses: {
          '201': json('Rerouted Supervisor approval', henkatenDetailSchema),
          '409': problem,
        },
      },
    },
    '/api/v1/supplier/henkatens/{id}/clone-prefill': {
      get: {
        requestParams: shiftId,
        responses: { '200': json('Clone prefill', clonePrefillSchema), '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/henkatens': {
      get: {
        requestParams: { ...supplierOnly, query: henkatenListQuerySchema },
        responses: { '200': json('Supplier Henkaten records', henkatenPageSchema) },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/henkatens/warnings': {
      get: {
        requestParams: supplierOnly,
        responses: {
          '200': json(
            'Supplier warning instances',
            z.object({
              items: z.array(warningInstanceSchema),
              pageInfo: z.object({
                hasNextPage: z.boolean(),
                nextCursor: z.string().nullable(),
              }),
            }),
          ),
        },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/henkatens/warnings/{warningId}': {
      get: {
        requestParams: {
          path: z.object({
            supplierId: z.string().uuid(),
            warningId: z.string().uuid(),
          }),
        },
        responses: { '200': json('Warning instance', warningInstanceSchema), '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/henkatens/{id}': {
      get: {
        requestParams: supplierAndId,
        responses: {
          '200': json('Supplier Henkaten detail', henkatenDetailSchema),
          '404': problem,
        },
      },
    },
    '/api/v1/tmmin/warnings/affected-parts': {
      get: {
        responses: { '200': json('Affected part groups', affectedPartPageSchema) },
      },
    },
    '/api/v1/tmmin/warnings/affected-parts/{supplierId}/{partNumber}': {
      get: {
        requestParams: {
          path: z.object({
            supplierId: z.string().uuid(),
            partNumber: z.string().min(1).max(100),
          }),
        },
        responses: {
          '200': json('Affected part detail', affectedPartDetailSchema),
          '404': problem,
        },
      },
    },
  };
}

function masterDataPaths() {
  const memberPath = { path: z.object({ id: z.string().uuid() }) };
  const linePath = { path: z.object({ lineId: z.string().uuid() }) };
  const jobPath = {
    path: z.object({ lineId: z.string().uuid(), id: z.string().uuid() }),
  };
  const resourcePath = { path: z.object({ resourceId: z.string().uuid() }) };
  const categoryPath = {
    path: z.object({ category: z.enum(['MAN', 'MACHINE', 'MATERIAL', 'METHOD']) }),
  };
  const listParams = { query: masterListQuerySchema };
  const action = (response: z.ZodType) => ({
    post: {
      requestParams: memberPath,
      requestBody: body(expectedVersionSchema),
      responses: { '200': json('Action completed', response), '409': problem },
    },
  });
  return {
    '/api/v1/supplier/master-data/members': {
      get: {
        requestParams: listParams,
        responses: { '200': json('Members', memberPageSchema) },
      },
      post: {
        requestBody: body(createMemberRequestSchema),
        responses: {
          '201': json('Member and optional credential', memberCredentialResponseSchema),
        },
      },
    },
    '/api/v1/supplier/master-data/members/{id}': {
      get: {
        requestParams: memberPath,
        responses: { '200': json('Member', memberSchema), '404': problem },
      },
      patch: {
        requestParams: memberPath,
        requestBody: body(updateMemberRequestSchema),
        responses: { '200': json('Updated member', memberSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/members/{id}/activate': action(memberSchema),
    '/api/v1/supplier/master-data/members/{id}/deactivate': action(memberSchema),
    '/api/v1/supplier/master-data/members/{id}/account': {
      patch: {
        requestParams: memberPath,
        requestBody: body(updateMemberAccountRequestSchema),
        responses: { '200': json('Updated member', memberSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/members/{id}/account/activate': action(
      memberCredentialResponseSchema,
    ),
    '/api/v1/supplier/master-data/members/{id}/account/deactivate': action(
      memberCredentialResponseSchema,
    ),
    '/api/v1/supplier/master-data/members/{id}/account/reset-password': action(
      memberCredentialResponseSchema,
    ),
    '/api/v1/supplier/master-data/members/{id}/photo': {
      post: {
        requestParams: memberPath,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: z.object({ photo: z.file().max(2 * 1024 * 1024) }),
            },
          },
        },
        responses: { '201': json('Member with photo', memberSchema), '400': problem },
      },
    },
    '/api/v1/supplier/master-data/members/{id}/photo/remove': {
      post: {
        requestParams: memberPath,
        requestBody: body(expectedVersionSchema),
        responses: { '204': noContent, '409': problem },
      },
    },
    '/api/v1/supplier/master-data/members/{id}/photo/{variant}': {
      get: {
        requestParams: {
          path: z.object({ id: z.string().uuid(), variant: z.enum(['full', 'thumbnail']) }),
        },
        responses: { '200': { description: 'Private normalized WebP image' }, '404': problem },
      },
    },
    '/api/v1/supplier/master-data/lines': collectionPath(
      listParams,
      linePageSchema,
      createLineRequestSchema,
      lineSchema,
    ),
    '/api/v1/supplier/master-data/lines/{id}': mutablePath(updateLineRequestSchema, lineSchema),
    '/api/v1/supplier/master-data/lines/{id}/activate': action(lineSchema),
    '/api/v1/supplier/master-data/lines/{id}/deactivate': action(lineSchema),
    '/api/v1/supplier/master-data/lines/{lineId}/jobs': {
      get: {
        requestParams: { ...linePath, query: masterListQuerySchema },
        responses: { '200': json('Jobs', jobPageSchema) },
      },
      post: {
        requestParams: linePath,
        requestBody: body(createJobRequestSchema),
        responses: { '201': json('Created job', jobSchema) },
      },
    },
    '/api/v1/supplier/master-data/lines/{lineId}/jobs/{id}': {
      get: {
        requestParams: jobPath,
        responses: { '200': json('Job', jobSchema), '404': problem },
      },
      patch: {
        requestParams: jobPath,
        requestBody: body(updateJobRequestSchema),
        responses: { '200': json('Updated job', jobSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/lines/{lineId}/jobs/{id}/activate': {
      post: {
        requestParams: jobPath,
        requestBody: body(expectedVersionSchema),
        responses: { '201': json('Activated job', jobSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/lines/{lineId}/jobs/{id}/deactivate': {
      post: {
        requestParams: jobPath,
        requestBody: body(expectedVersionSchema),
        responses: { '201': json('Deactivated job', jobSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/lines/{lineId}/jobs/reorder': {
      post: {
        requestParams: linePath,
        requestBody: body(reorderRequestSchema),
        responses: { '201': { description: 'Jobs reordered' }, '409': problem },
      },
    },
    '/api/v1/supplier/master-data/parts': collectionPath(
      listParams,
      partPageSchema,
      createPartRequestSchema,
      partSchema,
    ),
    '/api/v1/supplier/master-data/parts/{id}': mutablePath(updatePartRequestSchema, partSchema),
    '/api/v1/supplier/master-data/parts/{id}/activate': action(partSchema),
    '/api/v1/supplier/master-data/parts/{id}/deactivate': action(partSchema),
    '/api/v1/supplier/master-data/shift-templates': collectionPath(
      listParams,
      shiftTemplatePageSchema,
      createShiftTemplateRequestSchema,
      shiftTemplateSchema,
    ),
    '/api/v1/supplier/master-data/shift-templates/{id}': mutablePath(
      updateShiftTemplateRequestSchema,
      shiftTemplateSchema,
    ),
    '/api/v1/supplier/master-data/shift-templates/{id}/activate': action(shiftTemplateSchema),
    '/api/v1/supplier/master-data/shift-templates/{id}/deactivate': action(shiftTemplateSchema),
    '/api/v1/supplier/master-data/{collection}/reorder': {
      post: {
        requestBody: body(reorderRequestSchema),
        responses: { '201': { description: 'Collection reordered' }, '409': problem },
      },
    },
    '/api/v1/supplier/master-data/checklists/{category}/draft': {
      get: {
        requestParams: categoryPath,
        responses: { '200': json('Checklist draft', checklistDraftSchema) },
      },
      patch: {
        requestParams: categoryPath,
        requestBody: body(updateChecklistDraftRequestSchema),
        responses: { '200': json('Updated checklist draft', checklistDraftSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/checklists/{category}/publish': {
      post: {
        requestParams: categoryPath,
        requestBody: body(expectedVersionSchema),
        responses: { '201': json('Published checklist', checklistVersionSchema), '409': problem },
      },
    },
    '/api/v1/supplier/master-data/checklists/{category}/versions': {
      get: {
        requestParams: categoryPath,
        responses: {
          '200': json('Checklist versions', z.object({ items: z.array(checklistVersionSchema) })),
        },
      },
    },
    '/api/v1/supplier/master-data/checklists/{category}/activate': checklistStatusPath(),
    '/api/v1/supplier/master-data/checklists/{category}/deactivate': checklistStatusPath(),
    '/api/v1/supplier/master-data/default-assignments': {
      get: { responses: { '200': json('Default assignments', defaultAssignmentsSchema) } },
    },
    '/api/v1/supplier/master-data/lines/{lineId}/default-supervisor': assignmentPath(
      'lineId',
      assignmentMutationRequestSchema,
    ),
    '/api/v1/supplier/master-data/lines/{lineId}/default-line-leader': assignmentPath(
      'lineId',
      assignmentMutationRequestSchema,
    ),
    '/api/v1/supplier/master-data/jobs/{jobId}/default-mp': assignmentPath(
      'jobId',
      assignmentMutationRequestSchema,
    ),
    '/api/v1/supplier/master-data/lines/{lineId}/default-line-leader/move': assignmentPath(
      'lineId',
      assignmentMoveRequestSchema,
    ),
    '/api/v1/supplier/master-data/jobs/{jobId}/default-mp/move': assignmentPath(
      'jobId',
      assignmentMoveRequestSchema,
    ),
    '/api/v1/supplier/master-data/{kind}/{resourceId}/remove': {
      post: {
        requestParams: resourcePath,
        requestBody: body(assignmentRemoveRequestSchema),
        responses: { '201': json('Default assignments', defaultAssignmentsSchema), '409': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/members': {
      get: {
        requestParams: {
          path: z.object({ supplierId: z.string().uuid() }),
          query: masterListQuerySchema,
        },
        responses: { '200': json('Hosted members', memberPageSchema), '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/members/{id}': {
      get: {
        requestParams: {
          path: z.object({ supplierId: z.string().uuid(), id: z.string().uuid() }),
        },
        responses: { '200': json('Hosted member', memberSchema), '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/members/{id}/photo/{variant}': {
      get: {
        requestParams: {
          path: z.object({
            supplierId: z.string().uuid(),
            id: z.string().uuid(),
            variant: z.enum(['full', 'thumbnail']),
          }),
        },
        responses: { '200': { description: 'Private normalized WebP image' }, '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/lines': tmminListPath(linePageSchema),
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/lines/{lineId}/jobs': {
      get: {
        requestParams: {
          path: z.object({
            supplierId: z.string().uuid(),
            lineId: z.string().uuid(),
          }),
          query: masterListQuerySchema,
        },
        responses: { '200': json('Hosted jobs', jobPageSchema), '404': problem },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/parts': tmminListPath(partPageSchema),
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/shift-templates':
      tmminListPath(shiftTemplatePageSchema),
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/checklists/{category}/versions': {
      get: {
        requestParams: {
          path: z.object({
            supplierId: z.string().uuid(),
            category: z.enum(['MAN', 'MACHINE', 'MATERIAL', 'METHOD']),
          }),
        },
        responses: {
          '200': json(
            'Hosted checklist versions',
            z.object({ items: z.array(checklistVersionSchema) }),
          ),
          '404': problem,
        },
      },
    },
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/default-assignments': {
      get: {
        requestParams: { path: z.object({ supplierId: z.string().uuid() }) },
        responses: { '200': json('Default assignments', defaultAssignmentsSchema), '404': problem },
      },
    },
  };
}

function collectionPath(
  requestParams: Record<string, unknown>,
  pageSchema: z.ZodType,
  createSchema: z.ZodType,
  responseSchema: z.ZodType,
) {
  return {
    get: { requestParams, responses: { '200': json('Collection', pageSchema) } },
    post: {
      requestBody: body(createSchema),
      responses: { '201': json('Created resource', responseSchema), '409': problem },
    },
  };
}

function mutablePath(updateSchema: z.ZodType, responseSchema: z.ZodType) {
  return {
    get: {
      requestParams: { path: z.object({ id: z.string().uuid() }) },
      responses: { '200': json('Resource', responseSchema), '404': problem },
    },
    patch: {
      requestParams: { path: z.object({ id: z.string().uuid() }) },
      requestBody: body(updateSchema),
      responses: { '200': json('Updated resource', responseSchema), '409': problem },
    },
  };
}

function checklistStatusPath() {
  return {
    post: {
      requestParams: {
        path: z.object({ category: z.enum(['MAN', 'MACHINE', 'MATERIAL', 'METHOD']) }),
      },
      requestBody: body(expectedVersionSchema),
      responses: { '201': json('Checklist template', checklistDraftSchema), '409': problem },
    },
  };
}

function assignmentPath(parameter: 'jobId' | 'lineId', requestSchema: z.ZodType) {
  return {
    post: {
      requestParams: { path: z.object({ [parameter]: z.string().uuid() }) },
      requestBody: body(requestSchema),
      responses: { '201': json('Default assignments', defaultAssignmentsSchema), '409': problem },
    },
  };
}

function tmminListPath(schema: z.ZodType) {
  return {
    get: {
      requestParams: {
        path: z.object({ supplierId: z.string().uuid() }),
        query: masterListQuerySchema,
      },
      responses: { '200': json('Hosted master data', schema), '404': problem },
    },
  };
}

function sessionPath() {
  return {
    get: {
      responses: { '200': json('Current session', sessionResponseSchema), '401': problem },
    },
  };
}

function passwordPath() {
  return {
    post: {
      requestBody: body(passwordChangeRequestSchema),
      responses: { '204': noContent, '401': problem, '409': problem },
    },
  };
}

function logoutPath() {
  return { post: { responses: { '204': noContent, '401': problem } } };
}

function userActionPath(responseSchema: z.ZodType) {
  return {
    post: {
      requestParams: idPath,
      requestBody: body(expectedVersionSchema),
      responses: { '200': json('Action completed', responseSchema), '409': problem },
    },
  };
}

function supplierActionPath(requestSchema: z.ZodType, responseSchema: z.ZodType) {
  return {
    post: {
      requestParams: idPath,
      requestBody: body(requestSchema),
      responses: {
        '200': json('Action completed', responseSchema),
        '404': problem,
        '409': problem,
      },
    },
  };
}
