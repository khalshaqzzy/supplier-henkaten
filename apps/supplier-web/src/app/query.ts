import { QueryClient } from '@tanstack/react-query';

import { ApiProblemError } from '@tmmin-henkaten/api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        if (
          error instanceof ApiProblemError &&
          [401, 403, 409, 422, 429].includes(error.problem.status)
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export function scopedKey(
  identity: { userId: string; supplierId: string; purpose: string },
  resource: string,
  params?: unknown,
) {
  return [
    'SUPPLIER',
    identity.userId,
    identity.supplierId,
    identity.purpose,
    resource,
    params,
  ] as const;
}
