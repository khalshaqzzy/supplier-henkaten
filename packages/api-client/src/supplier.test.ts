import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from './core';
import { SupplierApi } from './supplier';

const id = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`;

describe('SupplierApi', () => {
  it('accepts the detailed current Shift response required by Henkaten creation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: id(1),
          lineId: id(2),
          shiftTemplateId: id(3),
          status: 'ACTIVE',
          businessDate: '2026-07-27',
          scheduledStartAt: '2026-07-27T00:00:00.000Z',
          scheduledEndAt: '2026-07-27T08:00:00.000Z',
          timezone: 'Asia/Jakarta',
          line: { code: 'LINE-1', name: 'Line 1' },
          shift: { name: 'Shift Pagi', startMinute: 420, endMinute: 900 },
          defaultAssignmentSetVersion: 1,
          supervisor: { memberId: id(4), name: 'Supervisor Test' },
          lineLeader: { memberId: id(5), name: 'Line Leader Test' },
          eligible: true,
          checks: [],
          latestPreflightAt: '2026-07-27T00:00:00.000Z',
          startedAt: '2026-07-27T00:01:00.000Z',
          startedWithOverride: false,
          overrideReason: null,
          endedAt: null,
          endSummary: null,
          version: 2,
          workingAssignments: [
            {
              id: id(6),
              shiftRunId: id(1),
              lineId: id(2),
              jobId: id(7),
              jobName: 'Inspection',
              jobDisplayOrder: 1,
              effectiveMpMemberId: id(8),
              candidateMpMemberId: id(8),
              mpName: 'Operator Test',
              mpRegistrationNumber: 'REG-001',
              state: 'ASSIGNED',
              active: true,
              version: 1,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const api = new SupplierApi(
      new ApiClient({
        baseUrl: 'https://api.example.test',
        realm: 'SUPPLIER',
        fetch: fetchMock,
      }),
    );

    await expect(api.currentShift()).resolves.toMatchObject({
      status: 'ACTIVE',
      workingAssignments: [{ jobName: 'Inspection' }],
    });
  });

  it('unwraps the working-assignment collection used for Henkaten target selection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: id(6),
              shiftRunId: id(1),
              lineId: id(2),
              jobId: id(7),
              jobName: 'Inspection',
              jobDisplayOrder: 1,
              effectiveMpMemberId: id(8),
              candidateMpMemberId: id(8),
              mpName: 'Operator Test',
              mpRegistrationNumber: 'REG-001',
              state: 'ASSIGNED',
              active: true,
              version: 1,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const api = new SupplierApi(
      new ApiClient({
        baseUrl: 'https://api.example.test',
        realm: 'SUPPLIER',
        fetch: fetchMock,
      }),
    );

    await expect(api.workingAssignments(id(1))).resolves.toEqual([
      expect.objectContaining({ jobName: 'Inspection' }),
    ]);
  });

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
