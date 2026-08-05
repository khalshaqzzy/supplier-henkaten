import { describe, expect, it } from 'vitest';

import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { masterMutationProblem } from './MasterDataPages';

describe('masterMutationProblem', () => {
  it('keeps the authoritative API blocker detail for retryable UI feedback', () => {
    const error = new ApiProblemError({
      type: 'https://henkaten.test/problems/resource-in-use',
      title: 'Resource masih digunakan',
      status: 409,
      detail: 'Part masih direferensikan oleh Henkaten OPEN.',
      code: 'RESOURCE_IN_USE',
      correlationId: '01J00000000000000000000000',
    });

    expect(masterMutationProblem(error)).toBe('Part masih direferensikan oleh Henkaten OPEN.');
  });

  it('returns a safe retry instruction for non-problem failures', () => {
    expect(masterMutationProblem(new Error('internal detail'))).toBe(
      'Perubahan tidak dapat disimpan. Muat ulang sebelum mencoba kembali.',
    );
  });
});
