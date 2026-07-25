import { Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import {
  createExternalClientRequestSchema,
  externalBatchRequestSchema,
  externalClientActionRequestSchema,
  externalEventIdSchema,
  externalHealthQuerySchema,
  externalHenkatenEventSchema,
  externalTokenRequestSchema,
  listQuerySchema,
  opaqueIdSchema,
  type CreateExternalClientRequest,
  type ExternalBatchRequest,
  type ExternalTokenRequest,
  type ExternalHealthQuery,
} from '@tmmin-henkaten/contracts';

import { mutationContext } from '../administration/mutation-context.js';
import { Public, RequireCapabilities } from '../common/policy.js';
import { ProblemException } from '../common/problem.js';
import type { ContextRequest } from '../common/request-context.js';
import { parseWithSchema, ValidatedBody, ValidatedQuery } from '../common/zod.js';
import { ExternalService } from './external.service.js';

@Controller('/api/v1/tmmin/suppliers/:supplierId/external-clients')
export class ExternalClientController {
  constructor(private readonly external: ExternalService) {}

  @RequireCapabilities('TMMIN_EXTERNAL_CLIENT_MANAGE')
  @Get()
  list(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(listQuerySchema) query: { cursor?: string; limit: number },
  ) {
    return this.external.listClients(
      parseWithSchema(opaqueIdSchema, supplierId),
      query.limit,
      query.cursor,
    );
  }

  @RequireCapabilities('TMMIN_EXTERNAL_CLIENT_MANAGE')
  @Post()
  create(
    @Param('supplierId') supplierId: string,
    @ValidatedBody(createExternalClientRequestSchema) body: CreateExternalClientRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.external.createClient(
      parseWithSchema(opaqueIdSchema, supplierId),
      body,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_EXTERNAL_CLIENT_MANAGE')
  @Post('/:id/rotate-secret')
  rotate(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @ValidatedBody(externalClientActionRequestSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.external.rotateClient(
      parseWithSchema(opaqueIdSchema, supplierId),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }

  @RequireCapabilities('TMMIN_EXTERNAL_CLIENT_MANAGE')
  @Post('/:id/revoke')
  @HttpCode(200)
  revoke(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @ValidatedBody(externalClientActionRequestSchema) body: { expectedVersion: number },
    @Req() request: ContextRequest,
  ) {
    return this.external.revokeClient(
      parseWithSchema(opaqueIdSchema, supplierId),
      parseWithSchema(opaqueIdSchema, id),
      body.expectedVersion,
      mutationContext(request),
    );
  }
}

@Controller('/api/v1/tmmin/suppliers/:supplierId/external-projections')
export class ExternalProjectionController {
  constructor(private readonly external: ExternalService) {}

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get()
  list(
    @Param('supplierId') supplierId: string,
    @ValidatedQuery(listQuerySchema) query: { cursor?: string; limit: number },
  ) {
    return this.external.listProjections(
      parseWithSchema(opaqueIdSchema, supplierId),
      query.limit,
      query.cursor,
    );
  }

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get('/:id')
  get(@Param('supplierId') supplierId: string, @Param('id') id: string) {
    return this.external.projection(
      parseWithSchema(opaqueIdSchema, supplierId),
      parseWithSchema(opaqueIdSchema, id),
    );
  }
}

@Controller('/api/v1/tmmin/external-health')
export class TmminExternalHealthController {
  constructor(private readonly external: ExternalService) {}

  @RequireCapabilities('TMMIN_HENKATEN_READ')
  @Get()
  health(@ValidatedQuery(externalHealthQuerySchema) query: ExternalHealthQuery) {
    return this.external.health(query);
  }
}

@Controller('/api/v1/external')
export class ExternalIngestionController {
  constructor(private readonly external: ExternalService) {}

  @Public()
  @Post('/auth/token')
  @HttpCode(200)
  async token(
    @ValidatedBody(externalTokenRequestSchema) body: ExternalTokenRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.external.token(body, request.ip ?? 'unknown', request.correlationId!);
    rateHeaders(response, issued.rate);
    response.setHeader('Cache-Control', 'no-store');
    return issued.response;
  }

  @Public()
  @Post('/henkaten/events')
  async single(
    @ValidatedBody(externalHenkatenEventSchema) body: Parameters<ExternalService['ingest']>[1],
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = await this.external.authenticate(
      request.header('Authorization'),
      request.ip ?? 'unknown',
    );
    const rate = this.external.consumeIngestLimit(principal.clientId);
    rateHeaders(response, rate);
    try {
      const result = await this.external.ingest(
        principal,
        body,
        request.correlationId!,
        request.ip ?? 'unknown',
      );
      response.status(result.status === 'ACCEPTED' ? 202 : 200);
      return result;
    } catch (error) {
      if (error instanceof ProblemException) {
        await this.external.recordRejected(
          principal,
          body.eventId,
          error.problem.code,
          request.correlationId!,
          request.ip ?? 'unknown',
        );
      }
      throw error;
    }
  }

  @Public()
  @Post('/henkaten/events/batch')
  @HttpCode(200)
  async batch(
    @ValidatedBody(externalBatchRequestSchema) body: ExternalBatchRequest,
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = await this.external.authenticate(
      request.header('Authorization'),
      request.ip ?? 'unknown',
    );
    const rate = this.external.consumeIngestLimit(principal.clientId);
    rateHeaders(response, rate);
    const parsed = body.events.map((event, index) => ({
      index,
      parsed: externalHenkatenEventSchema.safeParse(event),
    }));
    const results = body.events.map((): Record<string, unknown> | undefined => undefined);
    const valid = parsed
      .filter(
        (
          item,
        ): item is {
          index: number;
          parsed: { success: true; data: Parameters<ExternalService['ingest']>[1] };
        } => item.parsed.success,
      )
      .sort(
        (left, right) =>
          left.parsed.data.sourceHenkatenId.localeCompare(right.parsed.data.sourceHenkatenId) ||
          left.parsed.data.sourceVersion - right.parsed.data.sourceVersion,
      );
    for (const item of parsed.filter(({ parsed: item }) => !item.success)) {
      await this.external.recordRejected(
        principal,
        eventId(body.events[item.index]),
        'VALIDATION_FAILED',
        request.correlationId!,
        request.ip ?? 'unknown',
      );
      results[item.index] = {
        ingestionId: null,
        eventId: eventId(body.events[item.index]),
        status: 'REJECTED',
        code: 'VALIDATION_FAILED',
        correlationId: request.correlationId!,
      };
    }
    for (const item of valid) {
      try {
        results[item.index] = await this.external.ingest(
          principal,
          item.parsed.data,
          request.correlationId!,
          request.ip ?? 'unknown',
        );
      } catch (error) {
        if (!(error instanceof ProblemException)) throw error;
        await this.external.recordRejected(
          principal,
          item.parsed.data.eventId,
          error.problem.code,
          request.correlationId!,
          request.ip ?? 'unknown',
        );
        results[item.index] = {
          ingestionId: null,
          eventId: item.parsed.data.eventId,
          status: 'REJECTED',
          code: error.problem.code,
          correlationId: request.correlationId!,
        };
      }
    }
    return { results };
  }

  @Public()
  @Get('/ingestions/:eventId')
  async status(@Param('eventId') eventId: string, @Req() request: ContextRequest) {
    const principal = await this.external.authenticate(
      request.header('Authorization'),
      request.ip ?? 'unknown',
    );
    return this.external.ingestionStatus(
      principal,
      parseWithSchema(externalEventIdSchema, eventId),
    );
  }
}

function rateHeaders(
  response: Response,
  rate: { limit: number; remaining: number; resetAt: number; retryAfterSeconds: number },
) {
  response.setHeader('RateLimit-Limit', String(rate.limit));
  response.setHeader('RateLimit-Remaining', String(rate.remaining));
  response.setHeader('RateLimit-Reset', String(Math.ceil(rate.resetAt / 1_000)));
  if (rate.retryAfterSeconds) response.setHeader('Retry-After', String(rate.retryAfterSeconds));
}

function eventId(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'eventId' in value &&
    typeof value.eventId === 'string'
  ) {
    return value.eventId.slice(0, 200);
  }
  return 'unknown';
}
