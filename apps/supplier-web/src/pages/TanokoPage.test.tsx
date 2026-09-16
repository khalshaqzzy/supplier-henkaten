// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TanokoMatrix } from '@tmmin-henkaten/contracts';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import TanokoPage from './TanokoPage';
import { supplierApi } from '../app/api';

vi.mock('../app/session', () => ({
  useSession: () => ({
    session: {
      principal: { userId: 'user', supplierId: 'supplier', purpose: 'NORMAL' },
      supplier: { timezone: 'Asia/Jakarta' },
    },
  }),
}));
const fixture: TanokoMatrix = {
  canEdit: true,
  members: [
    { id: 'mp-1', name: 'Budi Nama Panjang', active: true },
    { id: 'mp-2', name: 'Dewi', active: true },
  ],
  jobs: [
    {
      id: 'job-1',
      name: 'Spec Engine',
      lineId: 'line-1',
      lineName: 'Assembly',
      lineCode: 'L01',
      category: 'HIGH',
      active: true,
    },
  ],
  mappings: [
    {
      memberId: 'mp-1',
      jobId: 'job-1',
      level: 2,
      version: 1,
      updatedAt: '2026-09-16T01:00:00.000Z',
    },
  ],
};
let client: QueryClient;
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TanokoPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.spyOn(supplierApi, 'tanoko').mockResolvedValue(structuredClone(fixture));
  vi.spyOn(supplierApi, 'tanokoHistory').mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
});

describe('Tanoko editing interactions', () => {
  it('preserves unsaved work when switching tabs and supports explicit discard', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Budi Nama Panjang, Spec Engine/ }));
    await user.click(screen.getByRole('radio', { name: /3 · Mandiri/ }));
    await user.click(screen.getByRole('tab', { name: 'Riwayat' }));
    expect(screen.getByRole('alert').textContent).toContain('Perubahan belum disimpan');
    expect(screen.getByRole('tab', { name: 'Matriks' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Lanjut edit' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /3 · Mandiri/ }).checked).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Riwayat' }));
    await user.click(screen.getByRole('button', { name: 'Buang perubahan' }));
    expect(await screen.findByText('Belum ada perubahan skill')).toBeTruthy();
  });
  it('does not overwrite a concurrent edit and reloads the new version explicitly', async () => {
    const save = vi.spyOn(supplierApi, 'saveTanoko').mockRejectedValue(
      new ApiProblemError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'VERSION_CONFLICT',
        detail: 'Concurrent update',
        correlationId: 'correlation-123',
      }),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Budi Nama Panjang, Spec Engine/ }));
    await user.click(screen.getByRole('radio', { name: /3 · Mandiri/ }));
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(await screen.findByText('Mapping sudah diperbarui')).toBeTruthy();
    expect(save).toHaveBeenCalledWith('mp-1', 'job-1', { expectedVersion: 1, level: 3, note: '' });
    vi.spyOn(supplierApi, 'tanoko').mockResolvedValue({
      ...fixture,
      mappings: [{ ...fixture.mappings[0]!, version: 2, level: 4 }],
    });
    await user.click(screen.getByRole('button', { name: 'Muat nilai terbaru' }));
    await screen.findByText('Memenuhi syarat skill pengganti Man');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /4 · Dapat melatih/ }).checked).toBe(
      true,
    );
  });
  it('offers detail without edit controls for read-only users', async () => {
    vi.spyOn(supplierApi, 'tanoko').mockResolvedValue({ ...fixture, canEdit: false });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Budi Nama Panjang, Spec Engine/ }));
    const panel = screen.getByRole('complementary');
    expect(within(panel).queryByRole('button', { name: 'Simpan perubahan' })).toBeNull();
    expect(
      within(panel)
        .getByRole('radio', { name: /3 · Mandiri/ })
        .closest('fieldset')?.disabled,
    ).toBe(true);
  });
});
