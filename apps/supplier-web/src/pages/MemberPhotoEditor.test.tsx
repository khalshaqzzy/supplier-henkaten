// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { supplierApi } from '../app/api';
import { MemberLifecycle } from './MasterDataPages';

const memberId = '00000000-0000-4000-8000-000000000001';
const scope = {
  userId: '00000000-0000-4000-8000-000000000002',
  supplierId: '00000000-0000-4000-8000-000000000003',
  purpose: 'NORMAL',
} as const;

const member = {
  id: memberId,
  fullName: 'Operator Photo Test',
  registrationNumber: 'MP-001',
  role: 'MP' as const,
  active: true,
  initials: 'OP',
  photo: null,
  version: 1,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Member photo editor', () => {
  it('validates files, uploads the same file again, and shows success feedback', async () => {
    const uploadedMember = {
      ...member,
      photo: {
        id: '00000000-0000-4000-8000-000000000004',
        fullUrl: `/api/v1/supplier/master-data/members/${memberId}/photo/full?v=1`,
        thumbnailUrl: `/api/v1/supplier/master-data/members/${memberId}/photo/thumbnail?v=1`,
        version: 1,
      },
    };
    const upload = vi.spyOn(supplierApi, 'uploadMemberPhoto').mockResolvedValue(uploadedMember);
    const { invalidateQueries, setQueryData } = renderEditor(member);
    const user = userEvent.setup({ applyAccept: false });
    const input = screen.getByLabelText('Set foto');

    await user.upload(input, new File(['plain'], 'avatar.txt', { type: 'text/plain' }));
    expect(screen.getByText('Format foto harus JPG, PNG, atau WebP.')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();

    const png = new File(['png'], 'avatar.png', { type: 'image/png' });
    await user.upload(input, png);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Foto berhasil diset.')).toBeTruthy();
    expect(setQueryData).toHaveBeenCalledWith(
      [
        'SUPPLIER',
        scope.userId,
        scope.supplierId,
        scope.purpose,
        'master-members-detail',
        memberId,
      ],
      uploadedMember,
    );

    await user.upload(input, png);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('previews and removes a versioned photo with confirmation', async () => {
    const withPhoto = {
      ...member,
      photo: {
        id: '00000000-0000-4000-8000-000000000004',
        fullUrl: `/api/v1/supplier/master-data/members/${memberId}/photo/full?v=4`,
        thumbnailUrl: `/api/v1/supplier/master-data/members/${memberId}/photo/thumbnail?v=4`,
        version: 4,
      },
    };
    const remove = vi.spyOn(supplierApi, 'removeMemberPhoto').mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEditor(withPhoto);

    const preview = screen.getByRole('img', { name: 'Foto Operator Photo Test' });
    expect(preview.getAttribute('src')).toBe(
      `http://localhost:3000/api/v1/supplier/master-data/members/${memberId}/photo/thumbnail?v=4`,
    );
    fireEvent.error(preview);
    expect(screen.getByLabelText('Initials Operator Photo Test').textContent).toBe('OP');
    await userEvent.click(screen.getByRole('button', { name: 'Hapus foto' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(memberId, 4));
    expect(
      await screen.findByText('Foto berhasil dihapus. Initials kembali digunakan sebagai avatar.'),
    ).toBeTruthy();
  });
});

function renderEditor(value: Parameters<typeof MemberLifecycle>[0]['member']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const setQueryData = vi.spyOn(queryClient, 'setQueryData');
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemberLifecycle, {
        member: value,
        scope,
      }),
    ),
  );
  return { invalidateQueries, setQueryData };
}
