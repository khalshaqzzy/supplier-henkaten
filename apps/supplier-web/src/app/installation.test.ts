import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getInstallationId', () => {
  it('uses the valid persisted installation identifier', async () => {
    const persisted = '00000000-0000-4000-8000-000000000001';
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => persisted),
      setItem: vi.fn(),
    });
    const { getInstallationId } = await import('./installation');

    expect(getInstallationId()).toBe(persisted);
  });

  it('keeps a stable in-memory identifier when storage access is denied', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new DOMException('Storage disabled', 'SecurityError');
      }),
      setItem: vi.fn(),
    });
    const { getInstallationId } = await import('./installation');

    const first = getInstallationId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(getInstallationId()).toBe(first);
  });

  it('keeps a stable in-memory identifier when persistence is denied', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('Storage disabled', 'SecurityError');
      }),
    });
    const { getInstallationId } = await import('./installation');

    const first = getInstallationId();
    expect(getInstallationId()).toBe(first);
  });
});
