import { describe, expect, it } from 'vitest';

import {
  correlationIdSchema,
  opaqueIdSchema,
  optimisticVersionSchema,
  paginationRequestSchema,
  problemDetailsSchema,
  utcTimestampSchema,
} from './common.js';

describe('common contracts', () => {
  it('accepts an opaque UUID and rejects non-UUID identifiers', () => {
    expect(opaqueIdSchema.parse('00000000-0000-4000-8000-000000000001')).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(() => opaqueIdSchema.parse('1')).toThrow();
  });

  it('requires a timestamp offset and normalizes output to UTC', () => {
    expect(utcTimestampSchema.parse('2026-07-23T09:00:00+07:00')).toBe('2026-07-23T02:00:00.000Z');
    expect(() => utcTimestampSchema.parse('2026-07-23T09:00:00')).toThrow();
  });

  it('applies pagination defaults and bounds', () => {
    expect(paginationRequestSchema.parse({})).toEqual({ limit: 25 });
    expect(paginationRequestSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(() => paginationRequestSchema.parse({ limit: 0 })).toThrow();
    expect(() => paginationRequestSchema.parse({ limit: 101 })).toThrow();
  });

  it('validates correlation IDs and positive optimistic versions', () => {
    expect(correlationIdSchema.parse('request:abc-123')).toBe('request:abc-123');
    expect(() => correlationIdSchema.parse('unsafe value')).toThrow();
    expect(optimisticVersionSchema.parse(1)).toBe(1);
    expect(() => optimisticVersionSchema.parse(0)).toThrow();
  });

  it('accepts field-addressable Problem Details and rejects unknown fields', () => {
    const value = {
      type: 'https://example.invalid/problems/validation-failed',
      title: 'Validation failed',
      status: 400,
      detail: 'One or more fields are invalid.',
      code: 'VALIDATION_FAILED',
      correlationId: 'request-123',
      fieldErrors: [
        {
          path: 'limit',
          code: 'too_big',
          message: 'Must be less than or equal to 100.',
        },
      ],
    };

    expect(problemDetailsSchema.parse(value)).toEqual(value);
    expect(() => problemDetailsSchema.parse({ ...value, stack: 'secret' })).toThrow();
  });
});
