import { describe, expect, it } from 'vitest';

import { bypassRuntimeCache, safePushDeepLink } from './sw-policy';

describe('supplier PWA service-worker policy', () => {
  const origin = 'https://supplier.example.com';

  it.each([
    ['GET', `${origin}/api/v1/supplier/session`],
    ['GET', `${origin}/api/v1/supplier/members/member-photos/photo`],
    ['POST', `${origin}/henkatens`],
    ['GET', 'https://evil.example/asset.js'],
    ['GET', `${origin}/manifest.webmanifest`],
    ['GET', `${origin}/sw.js`],
  ])('keeps sensitive or mutable request network-only: %s %s', (method, url) => {
    expect(bypassRuntimeCache(method, url, origin)).toBe(true);
  });

  it('allows same-origin immutable assets through runtime cache lookup', () => {
    expect(bypassRuntimeCache('GET', `${origin}/assets/index-deadbeef.js`, origin)).toBe(false);
  });

  it('accepts only relative same-origin push deep links', () => {
    expect(safePushDeepLink('/henkatens/123')).toBe('/henkatens/123');
    expect(safePushDeepLink('//evil.example/steal')).toBe('/notifications');
    expect(safePushDeepLink('https://evil.example/steal')).toBe('/notifications');
  });
});
