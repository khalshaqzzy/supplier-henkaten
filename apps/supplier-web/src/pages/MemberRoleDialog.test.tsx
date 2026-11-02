// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { MemberRolePreview } from '@tmmin-henkaten/contracts';
import { supplierApi } from '../app/api';
import { MemberRoleDialog } from './MemberRoleDialog';
const id = '00000000-0000-4000-8000-000000000001';
const replacementId = '00000000-0000-4000-8000-000000000002';
const member: MemberRolePreview['member'] = {
  id,
  fullName: 'Arrizqo',
  registrationNumber: '120185',
  role: 'LINE_LEADER',
  active: true,
  initials: 'A',
  photo: null,
  version: 1,
  createdAt: '2026-11-02T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  account: { id, username: '120185', status: 'ACTIVE', version: 1, mustChangePassword: false },
};
const scope = { userId: id, supplierId: replacementId, purpose: 'NORMAL' };
const preview: MemberRolePreview = {
  member,
  role: 'SUPERVISOR',
  revision: 'a'.repeat(64),
  dependencies: [
    {
      kind: 'LINE_SHIFT',
      id,
      label: 'Assembly · Pagi',
      detail: 'Assignment aktif',
      version: 1,
      active: true,
    },
  ],
  candidates: [
    {
      id: replacementId,
      fullName: 'Dimas Prasetyo',
      registrationNumber: '120210',
      available: true,
      unavailableReason: null,
    },
  ],
  pendingQcCount: 0,
  blockers: [],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemberRoleDialog member={member} scope={scope} />
    </QueryClientProvider>,
  );
}
async function choose() {
  await userEvent.click(screen.getByRole('button', { name: 'Ubah role' }));
  await userEvent.click(screen.getByRole('radio', { name: /Supervisor/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Tinjau tanggung jawab' }));
}
describe('member role change flow', () => {
  it('requires a replacement and a reason before committing the reviewed mapping', async () => {
    vi.spyOn(supplierApi, 'previewMemberRole').mockResolvedValue(preview);
    const save = vi
      .spyOn(supplierApi, 'changeMemberRole')
      .mockResolvedValue({ member: { ...member, role: 'SUPERVISOR' }, commandId: replacementId });
    mount();
    await choose();
    const next = await screen.findByRole('button', { name: 'Tinjau perubahan' });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText(/Pengganti/), replacementId);
    await userEvent.click(next);
    const commit = screen.getByRole('button', { name: 'Simpan perubahan role' });
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Alasan perubahan/), 'Promosi menjadi Supervisor');
    await userEvent.click(commit);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        id,
        {
          role: 'SUPERVISOR',
          revision: preview.revision,
          reason: 'Promosi menjadi Supervisor',
          handovers: [{ kind: 'LINE_SHIFT', id, replacementMemberId: replacementId }],
        },
        expect.any(String),
      ),
    );
  });
  it('holds the exact payload and key after an uncertain network result', async () => {
    vi.spyOn(supplierApi, 'previewMemberRole').mockResolvedValue({ ...preview, dependencies: [] });
    const save = vi
      .spyOn(supplierApi, 'changeMemberRole')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        member: { ...member, role: 'SUPERVISOR' },
        commandId: replacementId,
      });
    mount();
    await choose();
    await userEvent.type(
      await screen.findByLabelText<HTMLTextAreaElement>(/Alasan perubahan/),
      'Penugasan baru',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan role' }));
    const retry = await screen.findByRole('button', { name: 'Periksa hasil penyimpanan' });
    expect(screen.getByLabelText<HTMLTextAreaElement>(/Alasan perubahan/).disabled).toBe(true);
    await userEvent.click(retry);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  });
  it('shows stale review recovery and requires fresh replacement decisions', async () => {
    const load = vi.spyOn(supplierApi, 'previewMemberRole').mockResolvedValue(preview);
    vi.spyOn(supplierApi, 'changeMemberRole').mockRejectedValue(
      new ApiProblemError({
        type: 'about:blank',
        status: 409,
        code: 'VERSION_CONFLICT',
        title: 'Changed',
        detail: 'Assignment berubah.',
        correlationId: 'test',
      }),
    );
    mount();
    await choose();
    await userEvent.selectOptions(
      await screen.findByLabelText<HTMLSelectElement>(/Pengganti/),
      replacementId,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tinjau perubahan' }));
    await userEvent.type(screen.getByLabelText(/Alasan perubahan/), 'Penugasan baru');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan role' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Muat ulang tinjauan' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect((await screen.findByLabelText<HTMLSelectElement>(/Pengganti/)).value).toBe('');
  });
  it('uses one replacement for every assignment and Henkaten, including large sets', async () => {
    const dependencies = Array.from({ length: 26 }, (_, index) => ({
      ...preview.dependencies[0]!,
      kind: (['LINE_SHIFT', 'DEFAULT_LINE', 'HENKATEN'] as const)[index % 3]!,
      id: crypto.randomUUID(),
      label: `Responsibility ${index + 1}`,
    }));
    vi.spyOn(supplierApi, 'previewMemberRole').mockResolvedValue({ ...preview, dependencies });
    const save = vi
      .spyOn(supplierApi, 'changeMemberRole')
      .mockResolvedValue({ member: { ...member, role: 'SUPERVISOR' }, commandId: replacementId });
    mount();
    await choose();
    await screen.findByText('Seluruh assignment dan Henkaten');
    expect(screen.getAllByLabelText(/Pengganti/)).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText(/Pengganti/), replacementId);
    await userEvent.click(screen.getByRole('button', { name: 'Tinjau perubahan' }));
    expect(screen.getByText('Pengganti seluruh tanggung jawab')).toBeTruthy();
    await userEvent.type(
      screen.getByLabelText(/Alasan perubahan/),
      'Pengalihan semua tanggung jawab',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan role' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![1].handovers).toEqual(
      dependencies.map((d) => ({ kind: d.kind, id: d.id, replacementMemberId: replacementId })),
    );
  });
  it('keeps blocked work visible with a disabled next action', async () => {
    vi.spyOn(supplierApi, 'previewMemberRole').mockResolvedValue({
      ...preview,
      candidates: [],
      blockers: ['Belum ada Line Leader pengganti yang tersedia.'],
    });
    mount();
    await choose();
    expect(await screen.findByText('Belum ada Line Leader pengganti yang tersedia.')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Tinjau perubahan' }).disabled,
    ).toBe(true);
  });
});
