import { describe, expect, it, vi } from 'vitest';

import {
  henkatenDetailSchema,
  henkatenPageSchema,
  tmminHostedHenkatenDetailSchema,
  tmminHostedHenkatenPageSchema,
} from '@tmmin-henkaten/contracts';

import { ApiClient, ApiContractError } from './core';
import { TmminApi } from './tmmin';

const id = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`;

function hostedSummaryPayload(internalNumber: string | null | undefined) {
  const part: Record<string, unknown> = {
    id: id(10),
    number: 'TMMIN-001',
    name: 'Bracket',
  };
  if (internalNumber !== undefined) {
    part.internalNumber = internalNumber;
  }
  return {
    id: id(1),
    identifier: 'HEN-SUP-20261126-0001',
    shiftRunId: id(2),
    lineShiftId: id(3),
    lineId: id(4),
    jobId: id(5),
    partId: id(10),
    status: 'OPEN',
    sourceMode: 'HOSTED',
    sourceEpoch: 1,
    category: 'MACHINE',
    businessDate: '2026-11-26',
    occurredAt: '2026-11-26T00:00:00.000Z',
    effectiveStartAt: '2026-11-26T00:00:00.000Z',
    effectiveEndAt: null,
    line: { code: 'L1', name: 'Line 1' },
    shiftName: 'Shift 1',
    jobName: 'Welding',
    part: { number: 'TMMIN-001', name: 'Bracket' },
    parts: [part],
    routes: {
      supervisor: {
        route: 'SUPERVISOR',
        status: 'PENDING',
        initialResponsibleMemberId: null,
        initialResponsibleName: null,
        currentResponsibleMemberId: null,
        currentResponsibleName: null,
        version: 1,
        decision: null,
      },
      qc: {
        route: 'QC',
        status: 'PENDING',
        initialResponsibleMemberId: null,
        initialResponsibleName: null,
        currentResponsibleMemberId: null,
        currentResponsibleName: null,
        version: 1,
        decision: null,
      },
    },
    version: 1,
    pcr: null,
  };
}

function hostedDetailPayload(internalNumber: string | null | undefined) {
  return {
    ...hostedSummaryPayload(internalNumber),
    timezone: 'Asia/Jakarta',
    creatorName: 'Leader One',
    cause: 'Tool wear',
    detail: 'Replaced tip',
    affectedObject: 'Tip A',
    replacementObject: 'Tip B',
    cancellationReason: null,
    withdrawalReason: null,
    clonedFromHenkatenId: null,
    checklist: null,
    man: null,
    movement: null,
    history: [],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TmminApi mixed-version compatibility (H-01)', () => {
  it('scrubs legacy string internalNumber to null during mixed-version rollback on list and detail', async () => {
    const legacyPage = {
      items: [hostedSummaryPayload('SUP-SECRET-INT-99')],
      pageInfo: { hasNextPage: false, nextCursor: null },
    };
    const legacyDetail = hostedDetailPayload('SUP-SECRET-INT-99');

    // Server/OpenAPI contract must remain strict and reject legacy strings.
    expect(tmminHostedHenkatenPageSchema.safeParse(legacyPage).success).toBe(false);
    expect(tmminHostedHenkatenDetailSchema.safeParse(legacyDetail).success).toBe(false);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(legacyPage))
      .mockResolvedValueOnce(jsonResponse(legacyDetail));
    const api = new TmminApi(
      new ApiClient({
        baseUrl: 'https://api.example.test',
        realm: 'TMMIN',
        fetch: fetchMock,
      }),
    );

    const page = await api.supplierHenkatens(id(99));
    expect(page.items[0]?.parts[0]?.internalNumber).toBeNull();
    expect(JSON.stringify(page)).not.toContain('SUP-SECRET-INT-99');

    const detail = await api.hostedHenkaten(id(99), id(1));
    expect(detail.parts[0]?.internalNumber).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('SUP-SECRET-INT-99');
  });

  it('supports bidirectional compatibility across Release 1 (null), Release 2 (omitted), and legacy clients', async () => {
    const release1Page = {
      items: [hostedSummaryPayload(null)],
      pageInfo: { hasNextPage: false, nextCursor: null },
    };
    const release1Detail = hostedDetailPayload(null);
    const release2Page = {
      items: [hostedSummaryPayload(undefined)],
      pageInfo: { hasNextPage: false, nextCursor: null },
    };

    // Legacy main clients (using henkatenPageSchema / henkatenDetailSchema) accept Release 1 payloads.
    expect(henkatenPageSchema.safeParse(release1Page).success).toBe(true);
    expect(henkatenDetailSchema.safeParse(release1Detail).success).toBe(true);

    // PR TmminApi accepts both Release 1 (null) and Release 2 (omitted), while rejecting extra keys.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(release1Page))
      .mockResolvedValueOnce(jsonResponse(release2Page))
      .mockResolvedValueOnce(
        jsonResponse({
          ...release1Detail,
          parts: [{ ...release1Detail.parts[0], unexpectedField: 'boom' }],
        }),
      );
    const api = new TmminApi(
      new ApiClient({
        baseUrl: 'https://api.example.test',
        realm: 'TMMIN',
        fetch: fetchMock,
      }),
    );

    const r1 = await api.supplierHenkatens(id(99));
    expect(r1.items[0]?.parts[0]?.internalNumber).toBeNull();

    const r2 = await api.supplierHenkatens(id(99));
    expect(r2.items[0]?.parts[0]?.internalNumber).toBeUndefined();

    await expect(api.hostedHenkaten(id(99), id(1))).rejects.toBeInstanceOf(ApiContractError);
  });
});
