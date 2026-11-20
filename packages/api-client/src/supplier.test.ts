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

  it('requests board schedule fields with opt-in and falls back when an older API rejects includeSchedule', async () => {
    const legacyBoard = {
      version: 'v1',
      lastUpdatedAt: '2026-11-20T00:00:00.000Z',
      lines: [
        {
          shiftRunId: id(1),
          lineId: id(2),
          lineCode: 'L1',
          lineName: 'Line 1',
          shiftName: 'Shift 1',
          isCurrent: true,
          businessDate: '2026-11-20',
          supervisor: { memberId: null, name: null },
          lineLeaders: [],
          activeOverride: null,
          jobs: [],
        },
      ],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'https://henkaten.local/problems/validation-failed',
            title: 'Validation failed',
            status: 400,
            detail: 'Unrecognized key(s) in object: includeSchedule',
            code: 'VALIDATION_FAILED',
            correlationId: 'corr-1',
          }),
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(legacyBoard), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const api = new SupplierApi(
      new ApiClient({
        baseUrl: 'https://api.example.test',
        realm: 'SUPPLIER',
        fetch: fetchMock,
      }),
    );

    const board = await api.board({ shiftStatus: 'ALL' });
    expect(board.lines[0]?.shiftName).toBe('Shift 1');
    expect(board.lines[0]?.startTime).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urlOf = (input: Parameters<typeof fetch>[0]) =>
      input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    expect(urlOf(fetchMock.mock.calls[0]![0])).toContain('includeSchedule=true');
    expect(urlOf(fetchMock.mock.calls[1]![0])).not.toContain('includeSchedule');
  });
});
