export function bypassRuntimeCache(method: string, requestUrl: string, origin: string): boolean {
  const url = new URL(requestUrl, origin);
  return (
    method !== 'GET' ||
    url.origin !== origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/member-photos/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.endsWith('/sw.js')
  );
}

export function safePushDeepLink(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/notifications';
}
