// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Capability, SessionResponse } from '@tmmin-henkaten/contracts';

import { App } from './App';
import { tmminApi } from './app/api';
import { consumeIntendedPath, rememberIntendedPath } from './app/session';

function QueryProbe() {
  return <output data-testid="query">{useLocation().search}</output>;
}

function session(
  role: 'TMMIN_ADMIN' | 'TMMIN_QUALITY',
  capabilities: Capability[],
  forced = false,
): SessionResponse {
  return {
    principal: {
      userId: '00000000-0000-4000-8000-000000000002',
      displayName: 'TMMIN User',
      realm: 'TMMIN',
      role,
      purpose: 'NORMAL',
      mustChangePassword: forced,
    },
    capabilities,
    idleExpiresAt: '2026-07-25T08:00:00.000Z',
    absoluteExpiresAt: '2026-07-25T16:00:00.000Z',
    csrfToken: 'csrf-token-that-is-long-enough-for-contract',
  };
}

describe('TMMIN application boundary', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    vi.spyOn(tmminApi, 'suppliers').mockResolvedValue({
      items: [],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
    vi.spyOn(tmminApi, 'notificationCount').mockResolvedValue({ count: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps /design public without session bootstrap', async () => {
    window.history.replaceState({}, '', '/design');
    const sessionSpy = vi.spyOn(tmminApi, 'session');
    render(
      <MemoryRouter initialEntries={['/design']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Memuat Henkaten Design System/i)).toBeTruthy();
    await Promise.resolve();
    expect(sessionSpy).not.toHaveBeenCalled();
  });

  it('forces temporary-password identities to the reset guard', async () => {
    vi.spyOn(tmminApi, 'session').mockResolvedValue(
      session('TMMIN_ADMIN', ['TMMIN_SUPPLIER_READ'], true),
    );
    render(
      <MemoryRouter initialEntries={['/suppliers']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Ganti temporary password' })).toBeTruthy();
  });

  it('shows Quality monitoring without admin mutation navigation', async () => {
    vi.spyOn(tmminApi, 'session').mockResolvedValue(
      session('TMMIN_QUALITY', [
        'TMMIN_SUPPLIER_READ',
        'TMMIN_DASHBOARD_READ',
        'TMMIN_HENKATEN_READ',
        'TMMIN_AUDIT_READ',
      ]),
    );
    render(
      <MemoryRouter initialEntries={['/suppliers']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Supplier' })).toBeTruthy());
    expect(screen.getByText('Tata Kelola Sumber')).not.toBeNull();
    expect(screen.queryByText('Pengguna Quality')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Buat supplier' })).toBeNull();
  });

  it('renders the Indonesian dashboard composition and collapsible navigation', async () => {
    vi.spyOn(tmminApi, 'session').mockResolvedValue(
      session('TMMIN_ADMIN', [
        'TMMIN_SUPPLIER_READ',
        'TMMIN_DASHBOARD_READ',
        'TMMIN_HENKATEN_READ',
        'TMMIN_AUDIT_READ',
      ]),
    );
    const dashboard = vi.spyOn(tmminApi, 'dashboard').mockResolvedValue({
      generatedAt: '2026-07-26T00:00:00.000Z',
      filterOptions: { suppliers: [] },
      suppliers: { active: 2, hosted: 1, external: 1, withWarnings: 1 },
      openHenkatens: 3,
      affectedParts: 2,
      emergencyOverrides: 1,
      externalIngestion: { accepted: 8, duplicate: 1, rejected: 2, recentRejected: 2 },
      aging: [
        { bucket: 'UNDER_4_HOURS', count: 1 },
        { bucket: 'FOUR_TO_EIGHT_HOURS', count: 0 },
        { bucket: 'EIGHT_TO_24_HOURS', count: 1 },
        { bucket: 'OVER_24_HOURS', count: 1 },
      ],
      bySourceMode: [],
      byCategory: [],
      outcomes: [],
      rankings: {
        suppliers: [{ label: 'Supplier Alpha', count: 3 }],
        lines: [{ label: 'Line Utama', count: 2 }],
        parts: [{ label: 'Part A', count: 1 }],
      },
      trend: [
        {
          bucketStart: '2026-07-26T00:00:00.000Z',
          hosted: 1,
          external: 1,
          total: 2,
          open: 1,
          approved: 1,
          rejected: 0,
          cancelled: 0,
        },
      ],
      freshnessSummary: { fresh: 1, warning: 1, stale: 0, noData: 0 },
      supplierOverview: [],
      freshness: [],
      recentOverrides: [],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
        <QueryProbe />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Ringkasan Global' })).toBeTruthy();
    expect(await screen.findByText('Supplier aktif berdasarkan sumber')).toBeTruthy();
    expect(screen.getByText('Ringkasan risiko supplier')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ciutkan navigasi' }));
    expect(screen.getByRole('button', { name: 'Perluas navigasi' })).toBeTruthy();
    await user.type(screen.getByPlaceholderText('Semua line'), 'Line 1');
    await user.click(screen.getByRole('button', { name: 'Terapkan' }));
    await waitFor(() =>
      expect(dashboard).toHaveBeenLastCalledWith(expect.objectContaining({ line: 'Line 1' })),
    );
    expect(screen.getByTestId('query').textContent).toMatch(/line=Line(?:\+|%20)1/);
    await user.click(screen.getByRole('tab', { name: 'Line' }));
    expect(screen.getByText('Line Utama')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText<HTMLInputElement>('Semua line').value).toBe(''),
    );
    expect(screen.getByTestId('query').textContent).toBe('');
  });

  it('keeps secure logout available on an unsupported viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    vi.spyOn(tmminApi, 'session').mockResolvedValue(
      session('TMMIN_ADMIN', ['TMMIN_SUPPLIER_READ']),
    );
    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/desktop minimal 1280 × 720/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Keluar dengan aman/i })).toBeTruthy();
  });

  it('stores only safe same-origin intended destinations', () => {
    rememberIntendedPath('//evil.example/steal');
    expect(consumeIntendedPath()).toBe('/');
    rememberIntendedPath('/login?token=secret');
    expect(consumeIntendedPath()).toBe('/');
    rememberIntendedPath('/henkatens?sourceMode=EXTERNAL');
    expect(consumeIntendedPath()).toBe('/henkatens?sourceMode=EXTERNAL');
  });
});
