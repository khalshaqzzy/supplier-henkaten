// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiMutationUncertainError, ApiProblemError } from '@tmmin-henkaten/api-client';
import type { SetupPreview } from '@tmmin-henkaten/contracts';
import { supplierApi } from '../app/api';
import { SetupImportDialog } from './SetupImportDialog';

vi.mock('../app/session', () => ({
  useSession: () => ({ session: { supplier: { id: 'supplier' }, principal: { userId: 'admin' } } }),
}));
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
const rows = [
  {
    sheet: 'Member' as const,
    sourceRow: 2,
    data: {
      code: 'QC-01',
      name: 'Intan',
      role: 'QC',
      registration: '001',
      username: 'intan',
      password: 'Secret-for-new-account',
    },
  },
];
const preview: SetupPreview = {
  revision: 2,
  issues: [],
  warnings: [],
  candidates: [],
  rows: [
    {
      key: 'Member:2',
      sheet: 'Member',
      sourceRow: 2,
      label: 'Intan',
      status: 'NEW',
      existingId: null,
      version: null,
      linked: false,
      changes: [],
    },
  ],
};
beforeEach(() => {
  workers.length = 0;
  sessionStorage.clear();
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mountAndRead() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SetupImportDialog memberOnly />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Import CSV / Excel' }));
  await userEvent.upload(
    screen.getByLabelText('Pilih file member'),
    new File(['csv'], 'members.csv', { type: 'text/csv' }),
  );
  return workers.at(-1)!;
}
async function finishReading(worker: FakeWorker) {
  act(() => {
    worker.onmessage?.({ data: { result: { rows, issues: [], warnings: [] } } });
  });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import data' }).disabled).toBe(
      false,
    ),
  );
}
describe('focused member import dialog', () => {
  it('masks passwords and retries an uncertain commit with the identical payload and key', async () => {
    vi.spyOn(supplierApi, 'previewMemberImport').mockResolvedValue(preview);
    const save = vi
      .spyOn(supplierApi, 'commitMemberImport')
      .mockRejectedValueOnce(new ApiMutationUncertainError())
      .mockResolvedValueOnce({
        id: 'operation',
        kind: 'IMPORT',
        status: 'COMPLETED',
        error: null,
        result: [{ sheet: 'Member', created: 1, updated: 0, skipped: 0 }],
        createdAt: '2026-11-02T00:00:00Z',
        finishedAt: '2026-11-02T00:00:01Z',
      });
    const worker = await mountAndRead();
    await finishReading(worker);
    expect(document.body.textContent).not.toContain(rows[0]!.data.password);
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Periksa hasil' }));
    await screen.findByText('Data berhasil diimport');
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
    expect(sessionStorage.length).toBe(0);
    await userEvent.click(screen.getByRole('link', { name: /Lihat member/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Import CSV / Excel' }));
    expect(screen.getByRole('heading', { name: 'Tambahkan member dari file' })).toBeTruthy();
  });
  it('discards stale preview and requires matching again before another commit', async () => {
    const match = vi.spyOn(supplierApi, 'previewMemberImport').mockResolvedValue(preview);
    vi.spyOn(supplierApi, 'commitMemberImport').mockRejectedValue(
      new ApiProblemError({
        type: 'https://henkaten.test/problems/state-conflict',
        status: 409,
        code: 'STATE_CONFLICT',
        title: 'Setup berubah',
        detail: 'Periksa data kembali.',
        correlationId: 'test',
      }),
    );
    await finishReading(await mountAndRead());
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Periksa data' }));
    await waitFor(() => expect(match).toHaveBeenCalledTimes(2));
  });
  it('terminates replaced parsing and ignores its late result', async () => {
    const match = vi.spyOn(supplierApi, 'previewMemberImport').mockResolvedValue(preview);
    const first = await mountAndRead();
    await userEvent.upload(
      screen.getByLabelText('Pilih file member'),
      new File(['second'], 'replacement.csv', { type: 'text/csv' }),
    );
    expect(first.terminate).toHaveBeenCalled();
    act(() => {
      first.onmessage?.({ data: { result: { rows, issues: [], warnings: [] } } });
    });
    expect(match).not.toHaveBeenCalled();
    await finishReading(workers.at(-1)!);
    expect(match).toHaveBeenCalledTimes(1);
    expect(screen.getByText('replacement.csv')).toBeTruthy();
  });
});
