import { ApiClient, TmminApi } from '@tmmin-henkaten/api-client';

const apiOrigin = environmentString('VITE_API_ORIGIN') ?? 'http://localhost:3000';
let csrfToken: string | null = null;
let expired: (() => void) | null = null;

const client = new ApiClient({
  baseUrl: apiOrigin,
  realm: 'TMMIN',
  getCsrfToken: () => csrfToken,
  onSessionExpired: () => expired?.(),
});

export const tmminApi = new TmminApi(client);
export function setCsrfToken(value: string | null) {
  csrfToken = value;
}
export function setExpiredHandler(handler: (() => void) | null) {
  expired = handler;
}

function environmentString(name: string): string | undefined {
  const value: unknown = Reflect.get(import.meta.env, name);
  return typeof value === 'string' ? value : undefined;
}
