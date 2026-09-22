import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from './core';
import { SupplierApi } from './supplier';

const id = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`;

describe('SupplierApi', () => {
  it('removes a member photo with optimistic versioning and accepts 204', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new SupplierApi(
      new ApiClient({
        baseUrl: 'https://api.example.test',
        realm: 'SUPPLIER',
        fetch: fetchMock,
      }),
    );

    await expect(api.removeMemberPhoto(id(8), 4)).resolves.toBeUndefined();

    const [url, request] = fetchMock.mock.calls[0]!;
    const requestUrl = url instanceof URL ? url.href : typeof url === 'string' ? url : url.url;
    expect(requestUrl).toBe(
      `https://api.example.test/api/v1/supplier/master-data/members/${id(8)}/photo/remove`,
    );
    expect(request?.method).toBe('POST');
    expect(request?.body).toBe(JSON.stringify({ expectedVersion: 4 }));
  });
});
