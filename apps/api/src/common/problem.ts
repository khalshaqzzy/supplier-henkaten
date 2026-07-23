import { Catch, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import type { PublicErrorCode } from '@tmmin-henkaten/contracts';

export type ProblemOptions = {
  status: number;
  code: PublicErrorCode;
  title: string;
  detail: string;
  fieldErrors?: Array<{ path: string; code: string; message: string }>;
};

export class ProblemException extends HttpException {
  readonly problem: ProblemOptions;

  constructor(problem: ProblemOptions) {
    super(problem, problem.status);
    this.problem = problem;
  }
}

export function validationProblem(error: ZodError): ProblemException {
  return new ProblemException({
    status: HttpStatus.BAD_REQUEST,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    detail: 'One or more request fields are invalid.',
    fieldErrors: error.issues.map((issue) => ({
      path: issue.path.join('.') || '$',
      code: issue.code,
      message: issue.message,
    })),
  });
}

@Catch()
@Injectable()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { correlationId?: string }>();
    const response = context.getResponse<Response>();
    const correlationId = request.correlationId ?? 'unavailable';

    const problem =
      exception instanceof ProblemException
        ? exception.problem
        : isPrismaConflict(exception)
          ? {
              status: 409,
              code: 'STATE_CONFLICT' as const,
              title: 'State conflict',
              detail: 'The requested value conflicts with an existing resource.',
            }
          : isPayloadTooLarge(exception)
            ? {
                status: 413,
                code: 'PAYLOAD_TOO_LARGE' as const,
                title: 'Payload too large',
                detail: 'The JSON request body exceeds the 5 MiB limit.',
              }
            : exception instanceof HttpException
              ? {
                  status: exception.getStatus(),
                  code: mapStatusToCode(exception.getStatus()),
                  title: HttpStatus[exception.getStatus()] ?? 'Request failed',
                  detail: safeHttpDetail(exception),
                }
              : {
                  status: 500,
                  code: 'INTERNAL_ERROR' as const,
                  title: 'Internal server error',
                  detail: 'The request could not be completed.',
                };

    if (!(exception instanceof ProblemException) && !(exception instanceof HttpException)) {
      this.logger.error({
        correlationId,
        safeErrorClass: exception instanceof Error ? exception.name : 'UnknownError',
        safeErrorCode: safeErrorCode(exception),
        safeDatabaseCode: safeDatabaseCode(exception),
      });
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .setHeader('X-Correlation-ID', correlationId)
      .send({
        type: `https://supplier-henkaten.qd-tmmin.site/problems/${problem.code.toLowerCase()}`,
        title: problem.title,
        status: problem.status,
        detail: problem.detail,
        code: problem.code,
        correlationId,
        ...('fieldErrors' in problem && problem.fieldErrors
          ? { fieldErrors: problem.fieldErrors }
          : {}),
      });
  }
}

function safeErrorCode(exception: unknown): string | undefined {
  if (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    typeof exception.code === 'string'
  ) {
    return exception.code;
  }
  return undefined;
}

function safeDatabaseCode(exception: unknown): string | undefined {
  if (
    typeof exception === 'object' &&
    exception !== null &&
    'meta' in exception &&
    typeof exception.meta === 'object' &&
    exception.meta !== null &&
    'code' in exception.meta &&
    typeof exception.meta.code === 'string'
  ) {
    return exception.meta.code;
  }
  const driver = getDriverAdapterError(exception);
  const cause =
    driver && typeof driver['cause'] === 'object' && driver['cause'] !== null
      ? driver['cause']
      : undefined;
  return cause && 'originalCode' in cause && typeof cause.originalCode === 'string'
    ? cause.originalCode
    : undefined;
}

function getDriverAdapterError(exception: unknown): Record<string, unknown> | undefined {
  if (
    typeof exception !== 'object' ||
    exception === null ||
    !('meta' in exception) ||
    typeof exception.meta !== 'object' ||
    exception.meta === null ||
    !('driverAdapterError' in exception.meta) ||
    typeof exception.meta.driverAdapterError !== 'object' ||
    exception.meta.driverAdapterError === null
  ) {
    return undefined;
  }
  return exception.meta.driverAdapterError as Record<string, unknown>;
}

function isPrismaConflict(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    (exception.code === 'P2002' ||
      exception.code === 'P2034' ||
      (exception.code === 'P2010' &&
        (safeDatabaseCode(exception) === '40001' || safeDatabaseCode(exception) === '40P01')))
  );
}

function isPayloadTooLarge(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'status' in exception &&
    exception.status === 413
  );
}

function mapStatusToCode(status: number): PublicErrorCode {
  if (status === 401) return 'AUTHENTICATION_FAILED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'STATE_CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'NOT_READY';
  return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
}

function safeHttpDetail(exception: HttpException): string {
  const payload = exception.getResponse();
  if (typeof payload === 'string') return payload;
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }
  return 'The request could not be completed.';
}
