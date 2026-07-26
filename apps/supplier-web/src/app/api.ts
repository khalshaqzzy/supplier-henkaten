import { ApiClient, SupplierApi } from '@tmmin-henkaten/api-client';

const apiOrigin = environmentString('VITE_API_ORIGIN') ?? 'http://localhost:3000';
let csrfToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

export const supplierClient = new ApiClient({
  baseUrl: apiOrigin,
  realm: 'SUPPLIER',
  getCsrfToken: () => csrfToken,
  onSessionExpired: () => sessionExpiredHandler?.(),
});

export const supplierApi = new SupplierApi(supplierClient);
export const supplierApiOrigin = apiOrigin;

export function setCsrfToken(value: string | null): void {
  csrfToken = value;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

function environmentString(name: string): string | undefined {
  const value: unknown = Reflect.get(import.meta.env, name);
  return typeof value === 'string' ? value : undefined;
}
