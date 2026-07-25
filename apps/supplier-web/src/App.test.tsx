// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionResponse } from '@tmmin-henkaten/contracts';

import { App } from './App';
import { supplierApi } from './app/api';
import { consumeIntendedPath, rememberIntendedPath } from './app/session';

const supplierContext = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'SUP-001',
  name: 'Supplier Test',
  timezone: 'Asia/Jakarta',
  sourceMode: 'HOSTED' as const,
  sourceEpoch: 1,
};

function session(
  purpose: 'NORMAL' | 'HOSTED_PREPARATION',
  capabilities: SessionResponse['capabilities'],
  mustChangePassword = false,
): SessionResponse {
  return {
    principal: {
      userId: '00000000-0000-4000-8000-000000000002',
      supplierId: supplierContext.id,
      displayName: 'Admin Test',
      realm: 'SUPPLIER',
      role: 'SUPPLIER_ADMIN',
      purpose,
      mustChangePassword,
    },
    supplier: supplierContext,
    capabilities,
    idleExpiresAt: '2026-07-24T08:00:00.000Z',
    absoluteExpiresAt: '2026-07-24T16:00:00.000Z',
    csrfToken: 'csrf-token-that-is-long-enough-for-contract',
  };
}

describe('Supplier application foundation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps /design public and does not bootstrap a product session', async () => {
    window.history.replaceState({}, '', '/design');
    const sessionSpy = vi.spyOn(supplierApi, 'session');
    render(
      <MemoryRouter initialEntries={['/design']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Memuat Henkaten Design System/i)).toBeTruthy();
    await Promise.resolve();
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow',
    );
  });

  it('redirects Hosted Preparation home to authoritative setup progress', async () => {
    vi.spyOn(supplierApi, 'session').mockResolvedValue(
      session('HOSTED_PREPARATION', [
        'SUPPLIER_SELF_SERVICE',
        'SUPPLIER_MASTER_DATA_READ',
        'SUPPLIER_MASTER_DATA_MANAGE',
        'SUPPLIER_HOSTED_PREPARATION',
      ]),
    );
    vi.spyOn(supplierApi, 'setupReadiness').mockResolvedValue({
      generatedAt: '2026-07-24T00:00:00.000Z',
      ready: false,
      areas: [
        {
          area: 'SHIFT_TEMPLATES',
          ready: false,
          activeCount: 0,
          requiredCount: 1,
          blockerCount: 1,
        },
      ],
      blockers: [
        {
          area: 'SHIFT_TEMPLATES',
          code: 'SHIFT_TEMPLATE_REQUIRED',
          detail: 'Tambahkan satu Shift Template aktif.',
        },
      ],
      nextArea: 'SHIFT_TEMPLATES',
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Setup Supplier' })).toBeTruthy();
    expect(screen.queryByText('Assignment Board')).toBeNull();
    expect(screen.getByText('Mode persiapan aktif')).toBeTruthy();
  });

  it('renders forbidden for a valid route without its capability', async () => {
    vi.spyOn(supplierApi, 'session').mockResolvedValue(
      session('NORMAL', ['SUPPLIER_SELF_SERVICE']),
    );
    render(
      <MemoryRouter initialEntries={['/board']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /tidak memiliki akses/i })).toBeTruthy(),
    );
  });

  it('forces a temporary-password session into the password-change route', async () => {
    vi.spyOn(supplierApi, 'session').mockResolvedValue(
      session('NORMAL', ['SUPPLIER_SELF_SERVICE'], true),
    );
    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Ganti temporary password' })).toBeTruthy();
  });

  it('keeps logout available when the viewport is unsupported', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    vi.spyOn(supplierApi, 'session').mockResolvedValue(
      session('NORMAL', ['SUPPLIER_SELF_SERVICE']),
    );
    render(
      <MemoryRouter initialEntries={['/account']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/layar desktop minimal 1280 × 720/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeTruthy();
  });

  it('stores only relative same-realm intended destinations', () => {
    rememberIntendedPath('//evil.example/steal');
    expect(consumeIntendedPath()).toBe('/');
    rememberIntendedPath('/login?token=secret');
    expect(consumeIntendedPath()).toBe('/');
    rememberIntendedPath('/henkatens?status=OPEN');
    expect(consumeIntendedPath()).toBe('/henkatens?status=OPEN');
  });
});
