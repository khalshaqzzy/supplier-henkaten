import { describe, expect, it } from 'vitest';

import { supplierApiOrigin, supplierAssetUrl } from './api';

describe('supplierAssetUrl', () => {
  it('resolves API-owned relative assets against the configured API origin', () => {
    expect(supplierAssetUrl('/api/v1/supplier/master-data/members/member-1/photo/thumbnail')).toBe(
      new URL(
        '/api/v1/supplier/master-data/members/member-1/photo/thumbnail',
        supplierApiOrigin,
      ).toString(),
    );
  });

  it('preserves an absolute asset URL supplied by the API', () => {
    expect(supplierAssetUrl('https://cdn.example.test/member-1.webp')).toBe(
      'https://cdn.example.test/member-1.webp',
    );
  });
});
