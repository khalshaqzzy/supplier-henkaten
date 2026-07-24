import type { ContextRequest } from './request-context.js';
import { ProblemException } from './problem.js';

export function requiredIdempotencyKey(request: ContextRequest): string {
  const value = request.header('Idempotency-Key')?.trim();
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ProblemException({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Invalid Idempotency-Key',
      detail: 'Idempotency-Key is required and must contain 1–128 safe characters.',
    });
  }
  return value;
}
