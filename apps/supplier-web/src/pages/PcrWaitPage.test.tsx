// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { supplierApi } from '../app/api';
import { useSession } from '../app/session';
import { PcrWaitPage } from './PcrWaitPage';

vi.mock('../app/session', () => ({ useSession: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000001';

function renderAssessment(
  status: 'PCR' | 'NO_PCR' | 'PENDING',
  submittedHere: boolean,
  role = 'LINE_LEADER',
  decisionSource: 'AI' | 'TMMIN' = 'AI',
) {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: id, role, purpose: 'NORMAL' },
      supplier: { id },
    },
  } as ReturnType<typeof useSession>);
  vi.spyOn(supplierApi, 'henkaten').mockResolvedValue({
    id,
    identifier: 'HEN-001',
    pcr: {
      status,
      decisionSource,
      assessment: status === 'PCR' ? 'Perubahan metode memengaruhi proses produksi.' : null,
    },
  } as Awaited<ReturnType<typeof supplierApi.henkaten>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/henkatens/${id}/assessment`,
            state: submittedHere ? { submittedHenkatenId: id } : null,
          },
        ]}
      >
        <Routes>
          <Route path="/henkatens/:henkatenId/assessment" element={<PcrWaitPage />} />
          <Route path="/henkatens/:henkatenId" element={<div>Detail Henkaten</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PCR guidance after Line Leader submission', () => {
  it('shows the action and contact guidance for a PCR result, then opens the detail', async () => {
    renderAssessment('PCR', true);
    const dialog = await screen.findByRole('dialog', { name: 'PCR diperlukan' });
    expect(dialog.textContent).toContain('Ajukan PCR melalui jalur yang berlaku.');
    expect(dialog.textContent).toContain('Hasil assessment AI');
    expect(dialog.textContent).toContain('Perubahan metode memengaruhi proses produksi.');
    expect(dialog.textContent).toContain('hubungi TMMIN QD');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lihat Henkaten' }));
    expect(await screen.findByText('Detail Henkaten')).toBeTruthy();
  });

  it('does not reopen the dialog for a direct URL, another role, or No-PCR', async () => {
    renderAssessment('PCR', false);
    expect(await screen.findByText('Detail Henkaten')).toBeTruthy();
    cleanup();
    vi.restoreAllMocks();

    renderAssessment('PCR', true, 'SUPERVISOR');
    expect(await screen.findByText('Detail Henkaten')).toBeTruthy();
    cleanup();
    vi.restoreAllMocks();

    renderAssessment('NO_PCR', true);
    expect(await screen.findByText('Detail Henkaten')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not attribute a TMMIN assessment to AI', async () => {
    renderAssessment('PCR', true, 'LINE_LEADER', 'TMMIN');
    const dialog = await screen.findByRole('dialog', { name: 'PCR diperlukan' });
    expect(dialog.textContent).toContain('Hasil penilaian PCR');
    expect(dialog.textContent).not.toContain('Hasil assessment AI');
  });
});
