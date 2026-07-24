import { randomUUID } from './random-uuid';

import { problemDetailsSchema, type ProblemDetails } from '@tmmin-henkaten/contracts';
import type { z } from 'zod';

export type ApiRealm = 'SUPPLIER' | 'TMMIN';
export type QueryValue = string | number | boolean | null | undefined;
export type QueryRecord = Readonly<Record<string, QueryValue>>;

export class ApiProblemError extends Error {
  readonly problem: ProblemDetails;
  readonly retryAfterSeconds: number | null;

  constructor(problem: ProblemDetails, retryAfterSeconds: number | null = null) {
    super(problem.detail);
    this.name = 'ApiProblemError';
    this.problem = problem;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApiNetworkError extends Error {
  constructor(message = 'Tidak dapat terhubung ke layanan.') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

export class ApiContractError extends Error {
  readonly correlationId: string | null;

  constructor(correlationId: string | null) {
    super('Respons layanan tidak sesuai dengan kontrak aplikasi.');
    this.name = 'ApiContractError';
    this.correlationId = correlationId;
  }
}

export class ApiMutationUncertainError extends Error {
  constructor() {
    super('Status perubahan belum dapat dipastikan. Muat ulang data sebelum mencoba kembali.');
    this.name = 'ApiMutationUncertainError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  realm: ApiRealm;
  getCsrfToken?: () => string | null;
  onSessionExpired?: () => void;
  fetch?: typeof fetch;
}

export interface RequestOptions<TSchema extends z.ZodType = z.ZodType> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: QueryRecord;
  body?: unknown;
  formData?: FormData;
  responseSchema?: TSchema;
  responseType?: 'json' | 'blob' | 'void';
  signal?: AbortSignal;
  idempotencyKey?: string;
  authenticated?: boolean;
}

export class ApiClient {
  readonly realm: ApiRealm;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly getCsrfToken: () => string | null;
  private readonly onSessionExpired: () => void;

  constructor(options: ApiClientOptions) {
    this.baseUrl = normalizeApiBaseUrl(options.baseUrl);
    this.realm = options.realm;
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.getCsrfToken = options.getCsrfToken ?? (() => null);
    this.onSessionExpired = options.onSessionExpired ?? (() => undefined);
  }

  async request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema> & { responseSchema: TSchema },
  ): Promise<z.output<TSchema>>;
  async request(path: string, options: RequestOptions & { responseType: 'blob' }): Promise<Blob>;
  async request(path: string, options: RequestOptions & { responseType: 'void' }): Promise<void>;
  async request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
  ): Promise<z.output<TSchema> | Blob | void> {
    const method = options.method ?? 'GET';
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers({
      Accept: options.responseType === 'blob' ? '*/*' : 'application/json',
      'X-Correlation-ID': randomUUID(),
    });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    if (method !== 'GET' && options.authenticated !== false) {
      const csrfToken = this.getCsrfToken();
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    }

    let response: Response;
    try {
      const requestBody =
        options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      response = await this.fetchImplementation(url, {
        method,
        credentials: 'include',
        headers,
        ...(requestBody === undefined ? {} : { body: requestBody }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (method !== 'GET') throw new ApiMutationUncertainError();
      throw new ApiNetworkError();
    }

    const correlationId = response.headers.get('X-Correlation-ID');
    if (!response.ok) {
      const problem = await parseProblem(response, correlationId);
      if (problem.code === 'SESSION_EXPIRED') this.onSessionExpired();
      throw new ApiProblemError(problem, parseRetryAfter(response.headers.get('Retry-After')));
    }
    if (options.responseType === 'void' || response.status === 204) return;
    if (options.responseType === 'blob') return response.blob();

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiContractError(correlationId);
    }
    if (!options.responseSchema) return payload as z.output<TSchema>;
    const parsed = options.responseSchema.safeParse(payload);
    if (!parsed.success) throw new ApiContractError(correlationId);
    return parsed.data;
  }
}

export function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'API origin harus berupa HTTP(S) origin tanpa credential, query, atau fragment.',
    );
  }
  return url.toString().replace(/\/$/, '');
}

export function createIdempotencyKey(): string {
  return randomUUID();
}

async function parseProblem(
  response: Response,
  correlationId: string | null,
): Promise<ProblemDetails> {
  try {
    const parsed = problemDetailsSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data;
  } catch {
    // The safe fallback below intentionally does not expose the untrusted response body.
  }
  return {
    type: 'about:blank',
    title: 'Permintaan gagal',
    status: response.status,
    detail: 'Layanan tidak mengembalikan rincian masalah yang valid.',
    code: response.status === 401 ? 'SESSION_EXPIRED' : 'INTERNAL_ERROR',
    correlationId: correlationId ?? randomUUID(),
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
