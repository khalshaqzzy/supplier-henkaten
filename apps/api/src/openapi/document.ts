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
    },
  }) as unknown as Record<string, unknown>;
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
