import { describe, expect, it } from 'vitest';

import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { tmminMutationProblem } from './AdminPages';

describe('tmminMutationProblem', () => {
  it('shows an authoritative administration blocker detail', () => {
    const error = new ApiProblemError({
      type: 'https://henkaten.test/problems/source-not-ready',
      title: 'Supplier belum siap',
      status: 409,
      detail: 'Supplier External memerlukan client aktif sebelum aktivasi.',
      code: 'STATE_CONFLICT',
      correlationId: '01J00000000000000000000000',
    });

    expect(tmminMutationProblem(error)).toBe(
      'Supplier External memerlukan client aktif sebelum aktivasi.',
    );
  });

  it('does not expose an arbitrary internal failure message', () => {
    expect(tmminMutationProblem(new Error('internal detail'))).toBe(
      'Perubahan tidak dapat disimpan. Muat ulang sebelum mencoba kembali.',
    );
  });
});
