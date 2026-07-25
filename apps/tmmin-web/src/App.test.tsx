// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Capability, SessionResponse } from '@tmmin-henkaten/contracts';

import { App } from './App';
import { tmminApi } from './app/api';
import { consumeIntendedPath, rememberIntendedPath } from './app/session';

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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Suppliers' })).toBeTruthy());
    expect(screen.getByText('Source Governance')).not.toBeNull();
    expect(screen.queryByText('Quality Users')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create supplier' })).toBeNull();
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
