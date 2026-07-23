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
    },
  }) as unknown as Record<string, unknown>;
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
      patch: {
        requestParams: jobPath,
        requestBody: body(updateJobRequestSchema),
        responses: { '200': json('Updated job', jobSchema), '409': problem },
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
    '/api/v1/supplier/master-data/lines/{resourceId}/default-supervisor': assignmentPath(
      assignmentMutationRequestSchema,
    ),
    '/api/v1/supplier/master-data/lines/{resourceId}/default-line-leader': assignmentPath(
      assignmentMutationRequestSchema,
    ),
    '/api/v1/supplier/master-data/jobs/{resourceId}/default-mp': assignmentPath(
      assignmentMutationRequestSchema,
    ),
    '/api/v1/supplier/master-data/lines/{resourceId}/default-line-leader/move': assignmentPath(
      assignmentMoveRequestSchema,
    ),
    '/api/v1/supplier/master-data/jobs/{resourceId}/default-mp/move': assignmentPath(
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
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/parts': tmminListPath(partPageSchema),
    '/api/v1/tmmin/suppliers/{supplierId}/master-data/shift-templates':
      tmminListPath(shiftTemplatePageSchema),
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

function assignmentPath(requestSchema: z.ZodType) {
  return {
    post: {
      requestParams: { path: z.object({ resourceId: z.string().uuid() }) },
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
