// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiMutationUncertainError } from '@tmmin-henkaten/api-client';
import { supplierApi } from '../app/api';
import { useSession } from '../app/session';
import { HenkatenCreatePage } from './HenkatenCreatePage';

vi.mock('../app/session', () => ({ useSession: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('retries an uncertain submission with the same key and displayed assignment context', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  const initial = {
    items: [
      {
        id: 'shift',
        version: 1,
        lineCode: 'L1',
        lineName: 'Line',
        shiftName: 'Shift',
        startTime: '00:00',
        endTime: '23:59',
        current: true,
        businessDate: '2026-09-30',
        effectiveStartAt: '2026-09-30T00:00:00Z',
        effectiveEndAt: '2026-09-30T23:59:00Z',
        assignments: [{ id: 'assignment', jobId: 'job', jobName: 'Job', mpMemberId: 'mp' }],
      },
    ],
  };
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue(initial as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [],
    replacementMembers: [],
    checklist: { id: 'checklist', items: [{ id: 'item', label: 'Checked' }] },
  } as never);
  const submit = vi
    .spyOn(supplierApi, 'createHenkaten')
    .mockRejectedValue(new ApiMutationUncertainError());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('option', { name: /^Job/ });
  await user.click(screen.getByRole('radio', { name: 'Machine' }));
  await user.selectOptions(screen.getByLabelText(/Job/), 'job');
  await user.selectOptions(screen.getByLabelText(/^Part/), 'OTHER');
  await user.type(screen.getByLabelText(/Objek terdampak/), 'A');
  await user.type(screen.getByLabelText(/Kondisi baru/), 'B');
  await user.type(screen.getByLabelText(/Penyebab/), 'Cause');
  await user.type(screen.getByLabelText(/Detail kejadian/), 'Detail');
  await user.click(screen.getByRole('button', { name: 'Yes' }));
  // Simulate a background refresh after the form was opened.
  const queries = client
    .getQueryCache()
    .findAll()
    .filter((query) => query.queryKey.includes('line-shift-operational-context'));
  for (const query of queries)
    client.setQueryData(query.queryKey, {
      items: [{ ...initial.items[0], version: 2, effectiveStartAt: '2026-10-01T00:00:00Z' }],
    });
  await user.click(screen.getByRole('button', { name: 'Submit Henkaten' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await screen.findByText('Henkaten tidak dapat disimpan.');
  for (const query of client
    .getQueryCache()
    .findAll()
    .filter((query) => query.queryKey.includes('henkaten-form-options'))) {
    client.setQueryData(query.queryKey, {
      parts: [],
      replacementMembers: [],
      checklist: { id: 'new-checklist', items: [{ id: 'new-item', label: 'New question' }] },
    });
  }
  expect(screen.getByLabelText(/Detail kejadian/).closest('fieldset')?.disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Submit Henkaten' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1]![1]).toBe(submit.mock.calls[0]![1]);
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
  expect(submit.mock.calls[0]![0]).toMatchObject({
    expectedLineShiftVersion: 1,
    expectedEffectiveStartAt: initial.items[0]!.effectiveStartAt,
  });
  client.clear();
});

it('recovers an unusable shift context when the assignment is corrected', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  const shift = {
    id: 'shift',
    version: 1,
    lineName: 'Corrected Line',
    effectiveStartAt: '2026-09-30T00:00:00Z',
    effectiveEndAt: '2026-09-30T23:59:00Z',
    assignments: [],
  };
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue({
    items: [shift, { ...shift, id: 'other' }],
  } as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [],
    replacementMembers: [],
    checklist: null,
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Assignment Line Leader perlu diperiksa oleh Supplier Admin.');
  for (const query of client
    .getQueryCache()
    .findAll()
    .filter((query) => query.queryKey.includes('line-shift-operational-context')))
    client.setQueryData(query.queryKey, { items: [shift] });
  await waitFor(() => expect(screen.getAllByText(/Corrected Line/).length).toBeGreaterThan(0));
  expect(screen.queryByText('Line shift tidak tersedia')).toBeNull();
  client.clear();
});
