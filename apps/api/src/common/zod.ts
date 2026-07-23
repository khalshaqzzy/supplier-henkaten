import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';

import { validationProblem } from './problem.js';

export function parseWithSchema<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationProblem(result.error);
  return result.data;
}

export function ValidatedBody<T>(schema: ZodType<T>): ParameterDecorator {
  return createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return parseWithSchema(schema, request.body);
  })();
}

export function ValidatedQuery<T>(schema: ZodType<T>): ParameterDecorator {
  return createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return parseWithSchema(schema, request.query);
  })();
}
