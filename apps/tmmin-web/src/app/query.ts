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
          [401, 403, 404, 409, 422, 429].includes(error.problem.status)
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export function tmminKey(userId: string, resource: string, params?: unknown) {
  return ['TMMIN', userId, resource, params] as const;
}
