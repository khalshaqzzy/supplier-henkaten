// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmminApi } from '../app/api';
import { HenkatenDeletion } from './HenkatenDeletion';

vi.mock('../app/session', () => ({
  useTmminSession: () => ({
    session: { principal: { userId: 'quality-user' } },
    hasCapability: () => true,
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Henkaten deletion interaction', () => {
  it('keeps the same request and key after an uncertain response even when reopened', async () => {
    const remove = vi
      .spyOn(tmminApi, 'deleteHenkaten')
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({
        commandId: '00000000-0000-4000-8000-000000000001',
        deletedAt: new Date().toISOString(),
        hosted: 1,
        external: 0,
        total: 1,
      });
    const done = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <HenkatenDeletion
          supplierId="supplier"
          target={{ kind: 'HOSTED', id: 'record', label: 'HK-01', version: 7 }}
          onDeleted={done}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Hapus Henkaten' }));
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: 'Hapus Henkaten' }).disabled).toBe(
      true,
    );
    await user.type(dialog.getByLabelText('Alasan penghapusan'), 'Duplikat');
    await user.click(dialog.getByRole('button', { name: 'Hapus Henkaten' }));
    await screen.findByText('Periksa hasil penghapusan');
    expect(dialog.getByLabelText<HTMLTextAreaElement>('Alasan penghapusan').disabled).toBe(true);
    await user.click(dialog.getByRole('button', { name: 'Batal' }));
    await user.click(screen.getByRole('button', { name: 'Hapus Henkaten' }));
    dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(remove.mock.calls).toHaveLength(2);
    expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
    expect(remove.mock.calls[0]?.[3]).toEqual({ expectedVersion: 7, reason: 'Duplikat' });
    client.clear();
  });
});
