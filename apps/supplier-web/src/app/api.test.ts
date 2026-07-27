import { describe, expect, it } from 'vitest';

import { supplierAssetUrl } from './api';

describe('supplierAssetUrl', () => {
  it('resolves API-owned relative assets against the configured API origin', () => {
    expect(supplierAssetUrl('/api/v1/supplier/master-data/members/member-1/photo/thumbnail')).toBe(
      'http://localhost:3000/api/v1/supplier/master-data/members/member-1/photo/thumbnail',
    );
  });

  it('preserves an absolute asset URL supplied by the API', () => {
    expect(supplierAssetUrl('https://cdn.example.test/member-1.webp')).toBe(
      'https://cdn.example.test/member-1.webp',
    );
  });
});
