// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';

import type { SupplierSetupReadiness } from '@tmmin-henkaten/contracts';

import { supplierApi } from '../app/api';
import { useFocusTarget } from '../app/focus-target';
import * as sessionModule from '../app/session';
import { SetupPage } from './SetupPage';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const line = { id: id(1), code: 'L-01', name: 'Assembly' };
const shift = {
  lineShiftId: id(5),
  shiftTemplateId: id(90),
  name: 'Pagi',
  startTime: '06:00',
  endTime: '14:00',
  crossesMidnight: false,
  active: true,
};

const readiness: SupplierSetupReadiness = {
  generatedAt: '2026-11-10T00:00:00.000Z',
  ready: false,
  areas: [
    { area: 'SHIFT_TEMPLATES', ready: true, activeCount: 1, requiredCount: 1, blockerCount: 0 },
    { area: 'MEMBERS_ACCOUNTS', ready: false, activeCount: 0, requiredCount: 1, blockerCount: 1 },
    { area: 'LINES_JOBS', ready: true, activeCount: 2, requiredCount: 2, blockerCount: 0 },
    { area: 'PARTS', ready: true, activeCount: 0, requiredCount: 0, blockerCount: 0 },
    { area: 'CHECKLISTS', ready: true, activeCount: 0, requiredCount: 0, blockerCount: 0 },
    {
      area: 'DEFAULT_ASSIGNMENTS',
      ready: false,
      activeCount: 1,
      requiredCount: 4,
      blockerCount: 3,
    },
  ],
  blockers: [
    {
      area: 'MEMBERS_ACCOUNTS',
      code: 'OPERATIONAL_ACCOUNT_MISSING',
      detail: 'x',
      reason: 'ACCOUNT_INACTIVE',
      candidates: [{ kind: 'MEMBER', id: id(42), label: 'Rina', detail: 'QC', role: 'QC' }],
      candidateTotal: 1,
    },
    {
      area: 'DEFAULT_ASSIGNMENTS',
      code: 'LINE_SHIFT_SUPERVISOR_MISSING',
      detail: 'x',
      reason: 'UNASSIGNED',
      line,
      shift,
    },
    ...[10, 11].map((job) => ({
      area: 'DEFAULT_ASSIGNMENTS' as const,
      code: 'LINE_SHIFT_MP_MISSING',
      detail: 'x',
      reason: 'UNASSIGNED' as const,
      line,
      shift,
      job: { id: id(job), name: `Job ${job}`, displayOrder: job - 9 },
    })),
  ],
  nextArea: 'MEMBERS_ACCOUNTS',
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderSetup(data: SupplierSetupReadiness, entry = '/setup') {
  vi.spyOn(sessionModule, 'useSession').mockReturnValue({
    session: {
      principal: { userId: id(70), purpose: 'NORMAL', role: 'SUPPLIER_ADMIN' },
      supplier: { id: id(71), timezone: 'Asia/Jakarta' },
    },
  } as never);
  vi.spyOn(supplierApi, 'setupReadiness').mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<p>Halaman tujuan</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SetupPage blocker detail', () => {
  it('opens the first issue and reveals entity actions that deep-link to the fix', async () => {
    const user = userEvent.setup();
    renderSetup(readiness);
    const panel = await screen.findByRole('region', { name: /Perlu diselesaikan/ });
    expect(within(panel).getByText('4 blocker · 2 area')).toBeTruthy();
    const accounts = screen.getByRole('button', { name: /Belum ada akun operasional aktif/ });
    expect(accounts.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Aktifkan akun: Rina' }).getAttribute('href')).toBe(
      `/master-data/members/${id(42)}?focus=account`,
    );

    const mp = screen.getByRole('button', { name: /MP belum lengkap/ });
    expect(mp.getAttribute('aria-expanded')).toBe('false');
    const mpRegion = document.getElementById(mp.getAttribute('aria-controls')!)!;
    expect(mpRegion.hasAttribute('inert')).toBe(true);
    await user.click(mp);
    expect(mp.getAttribute('aria-expanded')).toBe('true');
    expect(mpRegion.hasAttribute('inert')).toBe(false);
    expect(within(mpRegion).getByText('L-01 · Assembly')).toBeTruthy();
    expect(within(mpRegion).getByText('Pagi · 06:00–14:00')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toContain(
      'open=MEMBERS_ACCOUNTS%3AOPERATIONAL_ACCOUNT_MISSING%2CDEFAULT_ASSIGNMENTS%3ALINE_SHIFT_MP_MISSING',
    );

    await user.click(
      within(mpRegion).getByRole('link', { name: 'Tetapkan MP: L-01 · Assembly · Pagi · Job 11' }),
    );
    expect(screen.getByText('Halaman tujuan')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe(
      `/master-data/line-setup?lineId=${line.id}&lineShiftId=${id(5)}&focus=job%3A${id(11)}`,
    );
  });

  it('restores expanded issues from the URL and toggles every issue', async () => {
    const user = userEvent.setup();
    renderSetup(readiness, '/setup?open=DEFAULT_ASSIGNMENTS%3ALINE_SHIFT_SUPERVISOR_MISSING');
    const supervisor = await screen.findByRole('button', { name: /Supervisor belum lengkap/ });
    expect(supervisor.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /Belum ada akun operasional aktif/ })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Buka semua' }));
    for (const trigger of screen.getAllByRole('button', { expanded: true })) {
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    }
    expect(screen.queryAllByRole('button', { expanded: false })).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Tutup semua' }));
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
  });

  it('reveals an area group from the rail count', async () => {
    const user = userEvent.setup();
    renderSetup(readiness, '/setup?open=');
    const reveal = await screen.findByRole('button', { name: 'Tampilkan 3 blocker Line Setup' });
    await user.click(reveal);
    expect(
      screen.getByRole('button', { name: /MP belum lengkap/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /Supervisor belum lengkap/ })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(document.activeElement?.id).toBe('setup-area-default-assignments');
    expect(screen.getByRole('link', { name: /^Member & akun/ }).getAttribute('href')).toBe(
      '/master-data/members',
    );
  });

  it('collapses long issue lists behind an explicit control', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 9 }, (_, index) => ({
      area: 'DEFAULT_ASSIGNMENTS' as const,
      code: 'LINE_SHIFT_MP_MISSING',
      detail: 'x',
      reason: 'UNASSIGNED' as const,
      line,
      shift,
      job: { id: id(100 + index), name: `Station ${index + 1}`, displayOrder: index + 1 },
    }));
    renderSetup(
      { ...readiness, blockers: many },
      '/setup?open=DEFAULT_ASSIGNMENTS%3ALINE_SHIFT_MP_MISSING',
    );
    expect(await screen.findByText('Station 6')).toBeTruthy();
    expect(screen.queryByText('Station 7')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tampilkan 3 lainnya' }));
    expect(screen.getByText('Station 9')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tampilkan lebih sedikit' })).toBeTruthy();
  });

  it('shows the ready state without a blocker panel', async () => {
    renderSetup({
      ...readiness,
      ready: true,
      blockers: [],
      nextArea: null,
      areas: readiness.areas.map((area) => ({ ...area, ready: true, blockerCount: 0 })),
    });
    expect(await screen.findByRole('heading', { name: 'Siap beroperasi' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Perlu diselesaikan/ })).toBeNull();
  });

  it('has no axe violations in the expanded panel', async () => {
    const { container } = renderSetup(readiness);
    await screen.findByRole('region', { name: /Perlu diselesaikan/ });
    const result = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});

function FocusHarness({ ready }: { ready: boolean }) {
  useFocusTarget(ready);
  const [params] = useSearchParams();
  return (
    <div>
      <output data-testid="focus-param">{params.get('focus') ?? ''}</output>
      <div data-focus-target="supervisor">
        <span>Supervisor</span>
        <button type="button">Pilih Supervisor</button>
      </div>
      <div data-focus-target="jobs">
        <button type="button">Urutkan</button>
        <input aria-label="Nama job baru" data-focus-initial />
      </div>
    </div>
  );
}

describe('useFocusTarget', () => {
  it('waits until ready, focuses the first control and clears the parameter', async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <MemoryRouter initialEntries={['/x?lineId=a&focus=supervisor']}>
        <FocusHarness ready={false} />
      </MemoryRouter>,
    );
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(screen.getByTestId('focus-param').textContent).toBe('supervisor');
    rerender(
      <MemoryRouter initialEntries={['/x?lineId=a&focus=supervisor']}>
        <FocusHarness ready />
      </MemoryRouter>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    const target = screen.getByText('Supervisor').parentElement!;
    expect(target.classList.contains('is-focus-target')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pilih Supervisor' }));
    expect(screen.getByTestId('focus-param').textContent).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(target.classList.contains('is-focus-target')).toBe(false);
    vi.useRealTimers();
  });

  it('prefers an explicitly marked initial control', async () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={['/x?focus=jobs']}>
        <FocusHarness ready />
      </MemoryRouter>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(document.activeElement).toBe(screen.getByLabelText('Nama job baru'));
    vi.useRealTimers();
  });
});
