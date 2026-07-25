import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ApiClient,
  ApiContractError,
  ApiMutationUncertainError,
  ApiNetworkError,
  ApiProblemError,
  normalizeApiBaseUrl,
} from './core';

const responseSchema = z.object({ ok: z.literal(true) }).strict();

describe('ApiClient', () => {
  it('sends credentials, correlation, query and CSRF then validates a response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': 'server-id' },
      }),
    );
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      getCsrfToken: () => 'csrf-value',
      fetch: fetchMock,
    });
    await expect(
      client.request('/api/v1/example', {
        method: 'POST',
        query: { cursor: 'opaque', ignored: undefined },
        body: { name: 'value' },
        responseSchema,
      }),
    ).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof Request ? url.url : url.toString()).toContain('cursor=opaque');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-value');
    expect(new Headers(init?.headers).get('X-Correlation-ID')).toBeTruthy();
  });

  it('maps valid problem details and retry-after', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'https://example.test/problems/rate',
          title: 'Rate limited',
          status: 429,
          detail: 'Wait before retrying.',
          code: 'RATE_LIMITED',
          correlationId: 'correlation-1',
        }),
        { status: 429, headers: { 'Retry-After': '12' } },
      ),
    );
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      fetch: fetchMock,
    });
    const error = await client
      .request('/api/v1/example', { responseSchema })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiProblemError);
    expect((error as ApiProblemError).retryAfterSeconds).toBe(12);
  });

  it('rejects malformed success responses and uncertain mutation failures', async () => {
    const invalidClient = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: false }))),
    });
    await expect(
      invalidClient.request('/api/v1/example', { responseSchema }),
    ).rejects.toBeInstanceOf(ApiContractError);

    const failingClient = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });
    await expect(
      failingClient.request('/api/v1/example', {
        method: 'POST',
        body: {},
        responseSchema,
      }),
    ).rejects.toBeInstanceOf(ApiMutationUncertainError);
  });

  it('handles 204, blob, multipart, safe-read network failure, and abort', async () => {
    const responses = [
      new Response(null, { status: 204 }),
      new Response('binary-data', { status: 200 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(responses.shift()!));
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      fetch: fetchMock,
    });
    await expect(
      client.request('/api/v1/no-content', { method: 'POST', responseType: 'void' }),
    ).resolves.toBeUndefined();
    await expect(client.request('/api/v1/file', { responseType: 'blob' })).resolves.toBeInstanceOf(
      Blob,
    );
    const formData = new FormData();
    formData.set('photo', new Blob(['image']), 'photo.webp');
    await expect(
      client.request('/api/v1/upload', { method: 'POST', formData, responseSchema }),
    ).resolves.toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).has('Content-Type')).toBe(false);

    const offline = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });
    await expect(offline.request('/api/v1/safe-read', { responseSchema })).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
    const aborted = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    });
    await expect(aborted.request('/api/v1/safe-read', { responseSchema })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('clears the application session on SESSION_EXPIRED', async () => {
    const expired = vi.fn();
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'SUPPLIER',
      onSessionExpired: expired,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Expired',
            status: 401,
            detail: 'Session expired.',
            code: 'SESSION_EXPIRED',
            correlationId: 'correlation-expired',
          }),
          { status: 401 },
        ),
      ),
    });
    await expect(client.request('/api/v1/session', { responseSchema })).rejects.toBeInstanceOf(
      ApiProblemError,
    );
    expect(expired).toHaveBeenCalledOnce();
  });

  it('schema-validates an explicitly accepted 503 readiness response', async () => {
    const notReadySchema = z.object({ status: z.literal('not_ready') }).strict();
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      realm: 'TMMIN',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ status: 'not_ready' }), { status: 503 })),
    });
    await expect(
      client.request('/ready', {
        responseSchema: notReadySchema,
        acceptedStatuses: [503],
      }),
    ).resolves.toEqual({ status: 'not_ready' });
  });
});

describe('normalizeApiBaseUrl', () => {
  it('normalizes safe origins and rejects embedded credentials', () => {
    expect(normalizeApiBaseUrl('https://api.example.test/')).toBe('https://api.example.test');
    expect(() => normalizeApiBaseUrl('https://user:secret@api.example.test')).toThrow();
  });
});
