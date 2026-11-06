import { describe, expect, it } from 'vitest';
import { deletePartsRequestSchema, swapShiftTimesRequestSchema } from './catalog-commands.js';

describe('catalog commands', () => {
  it('requires two different versioned identities and rejects extra scope fields', () => {
    const first = { id: '6e83fb6e-793a-41b1-a0da-2fcc6d64c23a', expectedVersion: 1 };
    const second = { id: '2c7e5eb9-4b0d-4b4b-9f1b-f595bfe6f322', expectedVersion: 2 };
    expect(swapShiftTimesRequestSchema.safeParse({ first, second }).success).toBe(true);
    expect(swapShiftTimesRequestSchema.safeParse({ first, second: first }).success).toBe(false);
    expect(
      swapShiftTimesRequestSchema.safeParse({ first, second, supplierId: first.id }).success,
    ).toBe(false);
    expect(
      swapShiftTimesRequestSchema.safeParse({ first: { ...first, expectedVersion: 0 }, second })
        .success,
    ).toBe(false);
  });
  it('requires the reviewed revision and forbids a filtered delete scope', () => {
    expect(deletePartsRequestSchema.safeParse({ revision: 'a'.repeat(64) }).success).toBe(true);
    expect(
      deletePartsRequestSchema.safeParse({ revision: 'a'.repeat(64), search: 'abc' }).success,
    ).toBe(false);
    expect(deletePartsRequestSchema.safeParse({ revision: '' }).success).toBe(false);
  });
});
